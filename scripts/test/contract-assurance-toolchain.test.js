import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assuranceEnvironment,
  assurancePaths,
  findPython312,
  loadAssuranceConfig,
  parsePythonVersion,
  selectAssurancePlatform,
  validateRequirementsLock,
  verifyAssuranceInstallation,
} from "../contract-assurance-toolchain.mjs";
import {
  downloadVerifiedCompiler,
  setupContractAssurance,
} from "../setup-contract-assurance.mjs";

const expectedConfig = {
  version: 1,
  requirementsSha256: "b911699b9e21ffe7b1152d5d2ada51f67bc80d17ed12ca6fc2256b28924658d9",
  versions: {
    python: ">=3.12.0 <3.13.0",
    slither: "0.11.5",
    solc: "0.8.30",
  },
  platforms: {
    "darwin-arm64": {
      url: "https://binaries.soliditylang.org/macosx-amd64/solc-macosx-amd64-v0.8.30+commit.73712a01",
      sha256: "738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683",
      execution: "ROSETTA_X86_64",
    },
    "linux-x64": {
      url: "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.30+commit.73712a01",
      sha256: "f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7",
      execution: "NATIVE",
    },
  },
};

test("accepts only the reviewed toolchain pins", () => {
  assert.deepEqual(loadAssuranceConfig(expectedConfig), expectedConfig);
});

test("rejects a changed complete requirements graph", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-assurance-lock-drift-"));
  const paths = assurancePaths(root, process.platform);
  await fs.mkdir(path.dirname(paths.venvPython), { recursive: true });
  await fs.mkdir(paths.solcRoot, { recursive: true });
  await fs.writeFile(paths.venvPython, "python");
  await fs.writeFile(paths.slither, "slither");
  await fs.writeFile(paths.solc, "compiler");
  await fs.mkdir(path.dirname(paths.lock), { recursive: true });
  await fs.writeFile(
    paths.lock,
    "slither-analyzer==0.11.5 \\\n    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
  );
  try {
    const config = loadAssuranceConfig(expectedConfig);
    await assert.rejects(
      verifyAssuranceInstallation(
        paths,
        config,
        { id: "linux-x64", ...config.platforms["linux-x64"] },
        {
          hashFile: async (target) => target === paths.lock
            ? "0".repeat(64)
            : config.platforms["linux-x64"].sha256,
          runFile: async () => ({ stdout: "", stderr: "", code: 0 }),
        },
      ),
      /requirements lock checksum mismatch/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects missing, extra, and malformed toolchain fields", () => {
  assert.throws(
    () => loadAssuranceConfig({ ...expectedConfig, unexpected: true }),
    /toolchain config has unexpected key: unexpected/,
  );
  assert.throws(
    () => loadAssuranceConfig({ ...expectedConfig, versions: { slither: "0.11.5", solc: "0.8.30" } }),
    /toolchain config versions is missing key: python/,
  );
  assert.throws(
    () => loadAssuranceConfig({
      ...expectedConfig,
      platforms: {
        ...expectedConfig.platforms,
        "linux-x64": { ...expectedConfig.platforms["linux-x64"], sha256: "abc" },
      },
    }),
    /invalid SHA-256/,
  );
  assert.throws(
    () => loadAssuranceConfig({
      ...expectedConfig,
      versions: { ...expectedConfig.versions, solc: "0.8.29" },
    }),
    /expected solc 0.8.30/,
  );
});

test("maps only the two audited host platforms", () => {
  const config = loadAssuranceConfig(expectedConfig);
  assert.deepEqual(
    selectAssurancePlatform(config, { platform: "darwin", arch: "arm64" }),
    { id: "darwin-arm64", ...expectedConfig.platforms["darwin-arm64"] },
  );
  assert.deepEqual(
    selectAssurancePlatform(config, { platform: "linux", arch: "x64" }),
    { id: "linux-x64", ...expectedConfig.platforms["linux-x64"] },
  );
  assert.throws(
    () => selectAssurancePlatform(config, { platform: "win32", arch: "x64" }),
    /unsupported assurance platform: win32-x64/,
  );
});

test("accepts Python 3.12 and rejects every other interpreter line", () => {
  assert.deepEqual(parsePythonVersion("Python 3.12.13\n"), {
    major: 3,
    minor: 12,
    patch: 13,
  });
  assert.throws(() => parsePythonVersion("Python 3.11.9"), /requires Python 3.12.x/);
  assert.throws(() => parsePythonVersion("Python 3.13.0"), /requires Python 3.12.x/);
  assert.throws(() => parsePythonVersion("not-python"), /invalid Python version/);
});

test("selects the first Python 3.12 candidate without a shell", async () => {
  const calls = [];
  const env = {
    PATH: "/reviewed/bin",
    LANG: "C",
  };
  const result = await findPython312({
    candidates: ["/opt/python3.12", "python3.12", "python3"],
    env,
    runFile: async (command, args, options) => {
      calls.push([command, args, options]);
      assert.equal(options.env, env);
      assert.equal(options.env.PRIVATE_KEY, undefined);
      if (command === "/opt/python3.12") throw new Error("missing");
      if (command === "python3.12") return { stdout: "Python 3.12.13\n", stderr: "", code: 0 };
      return { stdout: "Python 3.13.1\n", stderr: "", code: 0 };
    },
  });
  assert.equal(result, "python3.12");
  assert.deepEqual(calls, [
    ["/opt/python3.12", ["--version"], { env }],
    ["python3.12", ["--version"], { env }],
  ]);
});

test("fails with the setup instruction when Python 3.12 is absent", async () => {
  const env = { PATH: "/reviewed/bin", LANG: "C" };
  await assert.rejects(
    findPython312({
      candidates: ["python3.12", "python3"],
      env,
      runFile: async (command, _args, options) => {
        assert.equal(options.env, env);
        return {
          stdout: command === "python3.12" ? "Python 3.11.9\n" : "Python 3.13.1\n",
          stderr: "",
          code: 0,
        };
      },
    }),
    /Python 3.12.x was not found/,
  );
});

test("refuses to probe Python without an explicit sanitized environment", async () => {
  await assert.rejects(
    findPython312({
      candidates: ["python3.12"],
      runFile: async () => ({ stdout: "Python 3.12.13\n", stderr: "", code: 0 }),
    }),
    /sanitized environment/,
  );
});

test("keeps assurance executables and cache inside the repository", () => {
  assert.deepEqual(assurancePaths("/sentinel", "darwin"), {
    root: "/sentinel",
    venvRoot: "/sentinel/.venv-assurance",
    venvBin: "/sentinel/.venv-assurance/bin",
    venvPython: "/sentinel/.venv-assurance/bin/python",
    slither: "/sentinel/.venv-assurance/bin/slither",
    cacheRoot: "/sentinel/.cache/contract-assurance",
    solcRoot: "/sentinel/.cache/contract-assurance/solc",
    solc: "/sentinel/.cache/contract-assurance/solc/solc-0.8.30",
    config: "/sentinel/config/contract-assurance-toolchain.json",
    lock: "/sentinel/requirements/contract-assurance.lock",
  });
});

test("constructs a credential-free deterministic child environment", () => {
  const paths = assurancePaths("/sentinel", "darwin");
  const env = assuranceEnvironment(paths, {
    PATH: "/custom/bin:/usr/bin",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    SSL_CERT_FILE: "/etc/ssl/cert.pem",
    SSL_CERT_DIR: "/etc/ssl/certs",
    REQUESTS_CA_BUNDLE: "/etc/ssl/bundle.pem",
    PRIVATE_KEY: "secret",
    MNEMONIC: "secret",
    RPC_URL: "https://rpc.example",
    API_KEY: "secret",
    AWS_SECRET_ACCESS_KEY: "secret",
    GOOGLE_APPLICATION_CREDENTIALS: "/secret.json",
    SESSION_TOKEN: "secret",
  });
  assert.deepEqual(env, {
    PATH: `${paths.venvBin}${path.delimiter}/custom/bin:/usr/bin`,
    LANG: "C",
    LC_ALL: "C",
    SSL_CERT_FILE: "/etc/ssl/cert.pem",
    SSL_CERT_DIR: "/etc/ssl/certs",
    REQUESTS_CA_BUNDLE: "/etc/ssl/bundle.pem",
    VIRTUAL_ENV: paths.venvRoot,
    PYTHONHASHSEED: "0",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  });
});

test("rejects credentials embedded in retained environment values", () => {
  const paths = assurancePaths("/sentinel", "linux");
  assert.throws(
    () => assuranceEnvironment(paths, {
      PATH: "/usr/bin",
      REQUESTS_CA_BUNDLE: "https://user:password@example.test/bundle.pem",
    }),
    /unsafe retained environment value/,
  );
});

test("rejects unhashed, unpinned, and wrong-version Python locks", () => {
  const valid = [
    "crytic-compile==0.3.10 \\",
    "    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "slither-analyzer==0.11.5 \\",
    "    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "",
  ].join("\n");
  assert.deepEqual(validateRequirementsLock(valid, "0.11.5"), {
    requirements: ["crytic-compile==0.3.10", "slither-analyzer==0.11.5"],
  });
  assert.throws(
    () => validateRequirementsLock("slither-analyzer==0.11.5\n", "0.11.5"),
    /missing SHA-256 hash/,
  );
  assert.throws(
    () => validateRequirementsLock(
      "slither-analyzer>=0.11.5 \\\n    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
      "0.11.5",
    ),
    /not exactly pinned/,
  );
  assert.throws(
    () => validateRequirementsLock(
      "slither-analyzer==0.11.4 \\\n    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
      "0.11.5",
    ),
    /expected slither-analyzer 0.11.5/,
  );
});

test("fails closed when the assurance installation is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-assurance-missing-"));
  try {
    await assert.rejects(
      verifyAssuranceInstallation(
        assurancePaths(root, process.platform),
        loadAssuranceConfig(expectedConfig),
        { id: "linux-x64", ...expectedConfig.platforms["linux-x64"] },
      ),
      /assurance environment is missing; run npm run setup:assurance/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects compiler checksum and executable version drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-assurance-drift-"));
  const paths = assurancePaths(root, process.platform);
  await fs.mkdir(path.dirname(paths.venvPython), { recursive: true });
  await fs.mkdir(paths.solcRoot, { recursive: true });
  await fs.writeFile(paths.venvPython, "python");
  await fs.writeFile(paths.slither, "slither");
  await fs.writeFile(paths.solc, "wrong compiler bytes");
  await fs.mkdir(path.dirname(paths.lock), { recursive: true });
  await fs.writeFile(
    paths.lock,
    "slither-analyzer==0.11.5 \\\n    --hash=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
  );
  try {
    await assert.rejects(
      verifyAssuranceInstallation(
        paths,
        loadAssuranceConfig(expectedConfig),
        { id: "linux-x64", ...expectedConfig.platforms["linux-x64"] },
        {
          hashFile: async (target) => target === paths.lock
            ? expectedConfig.requirementsSha256
            : "0".repeat(64),
          runFile: async () => ({ stdout: "", stderr: "", code: 0 }),
        },
      ),
      /compiler checksum mismatch/,
    );

    const config = loadAssuranceConfig(expectedConfig);
    await assert.rejects(
      verifyAssuranceInstallation(
        paths,
        config,
        { id: "linux-x64", ...config.platforms["linux-x64"] },
        {
          hashFile: async (target) => target === paths.lock
            ? config.requirementsSha256
            : config.platforms["linux-x64"].sha256,
          runFile: async (command) => {
            if (command === paths.venvPython) {
              return { stdout: "Python 3.12.13\n", stderr: "", code: 0 };
            }
            if (command === paths.slither) {
              return { stdout: "0.11.4\n", stderr: "", code: 0 };
            }
            return {
              stdout: "Version: 0.8.30+commit.73712a01",
              stderr: "",
              code: 0,
            };
          },
        },
      ),
      /Slither version mismatch/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("downloads the compiler to a temporary path and renames only after verification", async () => {
  const calls = [];
  const paths = assurancePaths("/sentinel", "darwin");
  const platform = { id: "darwin-arm64", ...expectedConfig.platforms["darwin-arm64"] };
  await downloadVerifiedCompiler(platform, paths, {
    randomId: () => "fixed",
    mkdir: async (target, options) => calls.push(["mkdir", target, options]),
    pathExists: async () => false,
    downloadToFile: async (url, target, options) => calls.push(["download", url, target, options]),
    hashFile: async (target) => {
      calls.push(["hash", target]);
      return platform.sha256;
    },
    chmod: async (target, mode) => calls.push(["chmod", target, mode]),
    rename: async (from, to) => calls.push(["rename", from, to]),
    remove: async (target) => calls.push(["remove", target]),
  });
  const staged = `${paths.solc}.fixed.part`;
  assert.deepEqual(calls, [
    ["mkdir", paths.solcRoot, { recursive: true }],
    ["download", platform.url, staged, { maxRedirects: 0 }],
    ["hash", staged],
    ["chmod", staged, 0o755],
    ["rename", staged, paths.solc],
    ["remove", staged],
  ]);
});

test("removes a staged compiler and never renames it when checksum verification fails", async () => {
  const calls = [];
  const paths = assurancePaths("/sentinel", "linux");
  const platform = { id: "linux-x64", ...expectedConfig.platforms["linux-x64"] };
  await assert.rejects(
    downloadVerifiedCompiler(platform, paths, {
      randomId: () => "bad",
      mkdir: async () => {},
      pathExists: async () => false,
      downloadToFile: async (_url, target) => calls.push(["download", target]),
      hashFile: async () => "0".repeat(64),
      chmod: async (target) => calls.push(["chmod", target]),
      rename: async (from, to) => calls.push(["rename", from, to]),
      remove: async (target) => calls.push(["remove", target]),
    }),
    /downloaded compiler checksum mismatch/,
  );
  assert.deepEqual(calls, [
    ["download", `${paths.solc}.bad.part`],
    ["remove", `${paths.solc}.bad.part`],
  ]);
});

test("bootstraps with hash-locked pip, proves Rosetta, then verifies exact versions", async () => {
  const calls = [];
  const root = "/sentinel";
  const paths = assurancePaths(root, "darwin");
  const isolation = {
    root: `${paths.cacheRoot}/setup-fixed`,
    pipConfig: `${paths.cacheRoot}/setup-fixed/pip.conf`,
    netrc: `${paths.cacheRoot}/setup-fixed/.netrc`,
    xdgConfigHome: `${paths.cacheRoot}/setup-fixed/xdg`,
  };
  const config = loadAssuranceConfig(expectedConfig);
  const versions = {
    python: "3.12.13",
    slither: "0.11.5",
    solc: "0.8.30+commit.73712a01",
    platform: "darwin-arm64",
  };
  const result = await setupContractAssurance({
    root,
    host: { platform: "darwin", arch: "arm64" },
    config,
    validateLock: async (actualPaths, actualConfig) => {
      calls.push(["validateLock", actualPaths.lock, actualConfig.versions.slither]);
    },
    pathExists: async (target) => {
      calls.push(["exists", target]);
      return false;
    },
    createSetupIsolation: async (actualPaths) => {
      calls.push(["createIsolation", actualPaths.cacheRoot]);
      return isolation;
    },
    removeSetupIsolation: async (actualIsolation) => {
      calls.push(["removeIsolation", actualIsolation.root]);
    },
    environmentInput: {
      PATH: "/custom/bin:/usr/bin",
      PRIVATE_KEY: "must-not-leak",
      PIP_INDEX_URL: "https://user:password@example.test/simple",
      PIP_CONFIG_FILE: "/home/user/.config/pip/pip.conf",
      NETRC: "/home/user/.netrc",
      HOME: "/home/user",
    },
    findPython: async (options) => {
      calls.push(["findPython", options.env]);
      return "/opt/homebrew/bin/python3.12";
    },
    runFile: async (command, args, options) => {
      calls.push(["run", command, args, options.env]);
      if (command === paths.venvPython && args[0] === "--version") {
        return { stdout: "Python 3.12.13\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    downloadCompiler: async (platform, actualPaths) => {
      calls.push(["downloadCompiler", platform.id, actualPaths.solc]);
    },
    verifyInstallation: async (actualPaths, actualConfig, platform) => {
      calls.push(["verify", actualPaths.solc, actualConfig.versions.slither, platform.id]);
      return versions;
    },
  });
  assert.deepEqual(result, versions);
  assert.deepEqual(calls.map((entry) => entry.slice(0, 3)), [
    ["validateLock", paths.lock, "0.11.5"],
    ["createIsolation", paths.cacheRoot],
    ["exists", paths.venvPython],
    ["findPython", {
      PATH: `${paths.venvBin}${path.delimiter}/custom/bin:/usr/bin`,
      LANG: "C",
      LC_ALL: "C",
      VIRTUAL_ENV: paths.venvRoot,
      PYTHONHASHSEED: "0",
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      HOME: isolation.root,
      XDG_CONFIG_HOME: isolation.xdgConfigHome,
      PIP_CONFIG_FILE: isolation.pipConfig,
      NETRC: isolation.netrc,
      PIP_KEYRING_PROVIDER: "disabled",
    }],
    ["run", "/opt/homebrew/bin/python3.12", ["-m", "venv", paths.venvRoot]],
    ["run", paths.venvPython, ["--version"]],
    ["run", paths.venvPython, [
      "-I",
      "-m",
      "pip",
      "--isolated",
      "--keyring-provider",
      "disabled",
      "install",
      "--require-hashes",
      "-r",
      paths.lock,
    ]],
    ["run", "/usr/bin/arch", ["-x86_64", "/usr/bin/true"]],
    ["downloadCompiler", "darwin-arm64", paths.solc],
    ["verify", paths.solc, "0.11.5"],
    ["removeIsolation", isolation.root],
  ]);
  for (const call of calls.filter(([kind]) => kind === "run")) {
    const env = call[3];
    assert.equal(env.PRIVATE_KEY, undefined);
    assert.equal(env.RPC_URL, undefined);
    assert.equal(env.LANG, "C");
    assert.equal(env.PIP_INDEX_URL, undefined);
    assert.equal(env.HOME, isolation.root);
    assert.equal(env.PIP_CONFIG_FILE, isolation.pipConfig);
    assert.equal(env.NETRC, isolation.netrc);
    assert.equal(env.PIP_KEYRING_PROVIDER, "disabled");
  }
});

test("rejects a stale assurance venv before invoking pip", async () => {
  const calls = [];
  const root = "/sentinel";
  const paths = assurancePaths(root, "linux");
  const isolation = {
    root: `${paths.cacheRoot}/setup-stale`,
    pipConfig: `${paths.cacheRoot}/setup-stale/pip.conf`,
    netrc: `${paths.cacheRoot}/setup-stale/.netrc`,
    xdgConfigHome: `${paths.cacheRoot}/setup-stale/xdg`,
  };
  await assert.rejects(
    setupContractAssurance({
      root,
      host: { platform: "linux", arch: "x64" },
      config: loadAssuranceConfig(expectedConfig),
      validateLock: async () => {},
      pathExists: async () => true,
      createSetupIsolation: async () => isolation,
      removeSetupIsolation: async () => {},
      runFile: async (command, args) => {
        calls.push([command, args]);
        return { stdout: "Python 3.11.9\n", stderr: "", code: 0 };
      },
    }),
    /requires Python 3.12.x/,
  );
  assert.deepEqual(calls, [[paths.venvPython, ["--version"]]]);
});
