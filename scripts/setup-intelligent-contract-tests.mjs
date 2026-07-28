import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  findPython312,
  pythonEnvironment,
  pythonPaths,
  repositoryRoot,
  runFile,
} from "./intelligent-contract-python.mjs";

const paths=pythonPaths(repositoryRoot);
const lock=path.join(repositoryRoot,"requirements","intelligent-contract-test.lock");
const venv=path.join(repositoryRoot,".venv");

if(!fs.existsSync(lock))throw new Error("GenLayer test dependency lock is missing");
fs.mkdirSync(paths.cacheRoot,{recursive:true});
if(!fs.existsSync(paths.venvPython)){
  const bootstrap=await findPython312();
  await runFile(bootstrap,["-m","venv",venv]);
}

const env=pythonEnvironment(paths);
await runFile(paths.venvPython,["-m","pip","install","--require-hashes","-r",lock],{env});
const linter=path.join(paths.venvBin,process.platform==="win32"?"genvm-lint.exe":"genvm-lint");
await runFile(linter,["check","intelligent-contract/sentinel_policy.py"],{env});
await runFile(paths.venvPython,["--version"],{env});
await runFile(paths.venvPython,["-m","pip","show","genlayer-test","genvm-linter","pytest"],{env});
console.log(`GenLayer SDK cache: ${path.relative(repositoryRoot,paths.cacheRoot)}`);
