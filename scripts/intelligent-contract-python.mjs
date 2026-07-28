import {execFile as execFileCallback,spawn} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const execFile=promisify(execFileCallback);

export const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

export function parsePythonVersion(output){
  const match=/^Python (\d+)\.(\d+)\.(\d+)$/.exec(output.trim());
  if(!match)throw new Error("invalid Python version");
  const version={major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3])};
  if(version.major!==3||version.minor<12)throw new Error("Python 3.12 or newer is required");
  return version;
}

export function pythonPaths(root=repositoryRoot,platform=process.platform){
  const venvBin=path.join(root,".venv",platform==="win32"?"Scripts":"bin");
  return{
    venvPython:path.join(venvBin,platform==="win32"?"python.exe":"python"),
    venvBin,
    cacheRoot:path.join(root,".cache","genlayer-sentinel"),
  };
}

export function pythonEnvironment(paths,ambient=process.env){
  const env={
    PATH:`${paths.venvBin}${path.delimiter}${ambient.PATH??""}`,
  };
  for(const name of ["TMPDIR","TEMP","TMP","LANG","LC_ALL","SYSTEMROOT","SSL_CERT_FILE","SSL_CERT_DIR"]){
    if(typeof ambient[name]==="string"&&ambient[name]!=="")env[name]=ambient[name];
  }
  env.XDG_CACHE_HOME=paths.cacheRoot;
  env.PYTHONDONTWRITEBYTECODE="1";
  env.PYTHONNOUSERSITE="1";
  return env;
}

export async function findPython312(executor=async(command,args)=>execFile(command,args,{encoding:"utf8"})){
  for(const command of ["python3.12","python3"]){
    try{
      const result=await executor(command,["--version"]);
      parsePythonVersion(`${result.stdout??""}${result.stderr??""}`);
      return command;
    }catch{}
  }
  throw new Error("Python 3.12 or newer was not found; install it before setup");
}

export function runFile(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{
      cwd:options.cwd??repositoryRoot,
      env:options.env??process.env,
      stdio:options.stdio??"inherit",
      shell:false,
    });
    child.once("error",reject);
    child.once("exit",(code,signal)=>{
      if(code===0)resolve();
      else reject(new Error(`${path.basename(command)} exited with ${signal??code}`));
    });
  });
}
