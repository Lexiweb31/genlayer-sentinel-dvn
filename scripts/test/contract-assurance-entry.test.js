import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assurancePaths,
  hostPlatform,
  readAssuranceConfig,
  repositoryRoot,
  selectAssurancePlatform,
} from "../contract-assurance-toolchain.mjs";
import {runSlitherAssurance} from "../run-slither-assurance.mjs";

test("package scripts expose the complete contract assurance gate", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["test:properties"],
    "node --test contracts/assurance/*.property.test.js",
  );
  assert.equal(
    packageJson.scripts["check:assurance"],
    "npm run build && npm run test:properties && npm run analyze:contracts",
  );
  assert.match(packageJson.scripts.check, /npm run check:assurance/);
});

test("the assurance entry point fails offline with the setup instruction", async () => {
  const unavailableRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "sentinel-assurance-entry-missing-"),
  );
  try {
    const installedPaths = assurancePaths(repositoryRoot);
    const unavailablePaths = {
      ...installedPaths,
      ...assurancePaths(unavailableRoot),
      root: repositoryRoot,
      config: installedPaths.config,
      lock: installedPaths.lock,
    };
    const config = await readAssuranceConfig(installedPaths.config);
    const platform = selectAssurancePlatform(config, hostPlatform());
    await assert.rejects(
      runSlitherAssurance({
        root: repositoryRoot,
        paths: unavailablePaths,
        config,
        platform,
      }),
      /run npm run setup:assurance/,
    );
  } finally {
    await fs.rm(unavailableRoot, {recursive: true, force: true});
  }
});
