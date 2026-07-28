import fs from "node:fs";
import {
  intelligentContractToolInvocation,
  pythonEnvironment,
  pythonPaths,
  repositoryRoot,
  runFile,
} from "./intelligent-contract-python.mjs";

const mode=process.argv[2];
const extra=process.argv.slice(3);
const paths=pythonPaths(repositoryRoot);

if(!fs.existsSync(paths.venvPython)){
  throw new Error("GenLayer test environment is missing; run npm run setup:ic:direct");
}

const env=pythonEnvironment(paths);
const invocation=intelligentContractToolInvocation(mode,extra,paths);
await runFile(invocation.command,invocation.args,{env});
