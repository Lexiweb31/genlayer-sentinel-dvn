export const solidityBuildConfig = Object.freeze({
  version: "0.8.30",
  nativeVersion: "0.8.30+commit.73712a01",
  solcJsVersion: "0.8.30+commit.73712a01.Emscripten.clang",
  evmVersion: "shanghai",
  optimizer: Object.freeze({ enabled: true, runs: 200 }),
});

export function assertSolcJsVersion(actual) {
  if (actual !== solidityBuildConfig.solcJsVersion) {
    throw new Error(
      `solc-js version drift: expected ${solidityBuildConfig.solcJsVersion}`,
    );
  }
}

export function compilationSettings(outputSelection) {
  return {
    evmVersion: solidityBuildConfig.evmVersion,
    optimizer: { ...solidityBuildConfig.optimizer },
    outputSelection,
  };
}

export function nativeSolcArguments(
  root,
  includePath,
  buildConfig = solidityBuildConfig,
) {
  if (buildConfig.optimizer.enabled !== true) {
    throw new Error("native optimizer must remain enabled");
  }
  return [
    "--base-path",
    root,
    "--include-path",
    includePath,
    "--evm-version",
    buildConfig.evmVersion,
    "--optimize",
    "--optimize-runs",
    String(buildConfig.optimizer.runs),
  ];
}
