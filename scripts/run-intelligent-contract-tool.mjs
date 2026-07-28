import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
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
if(mode==="lint"){
  const linter=path.join(paths.venvBin,process.platform==="win32"?"genvm-lint.exe":"genvm-lint");
  await runFile(linter,["check","intelligent-contract/sentinel_policy.py",...extra],{env});
}else if(mode==="test"){
  await runFile(paths.venvPython,["-m","pytest","intelligent-contract/tests","-q",...extra],{env});
}else{
  throw new Error("expected lint or test");
}
