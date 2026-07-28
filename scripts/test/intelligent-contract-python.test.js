import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  parsePythonVersion,
  pythonPaths,
  findPython312,
  pythonEnvironment,
  intelligentContractToolInvocation,
} from "../intelligent-contract-python.mjs";

test("rejects an interpreter below Python 3.12",()=>{
  assert.deepEqual(parsePythonVersion("Python 3.12.13\n"),{major:3,minor:12,patch:13});
  assert.throws(()=>parsePythonVersion("Python 3.11.9"),/Python 3.12 or newer/);
  assert.throws(()=>parsePythonVersion("not python"),/invalid Python version/);
});

test("keeps the virtual environment and SDK cache inside the repository",()=>{
  const root="/sentinel";
  assert.deepEqual(pythonPaths(root,"darwin"),{
    venvPython:path.join(root,".venv","bin","python"),
    venvBin:path.join(root,".venv","bin"),
    cacheRoot:path.join(root,".cache","genlayer-sentinel"),
  });
  assert.equal(pythonPaths(root,"win32").venvPython,path.join(root,".venv","Scripts","python.exe"));
});

test("selects the first compatible interpreter without invoking a shell",async()=>{
  const calls=[];
  const exec=async(command,args)=>{
    calls.push([command,args]);
    if(command==="python3.12")return{stdout:"Python 3.12.13\n"};
    throw new Error("missing");
  };
  assert.equal(await findPython312(exec),"python3.12");
  assert.deepEqual(calls,[["python3.12",["--version"]]]);
});

test("continues past missing and incompatible interpreters",async()=>{
  const calls=[];
  const exec=async(command,args)=>{
    calls.push([command,args]);
    if(command==="python3.12")throw new Error("missing");
    return{stdout:"Python 3.13.2\n"};
  };
  assert.equal(await findPython312(exec),"python3");
  assert.deepEqual(calls,[["python3.12",["--version"]],["python3",["--version"]]]);
});

test("fails clearly when no compatible interpreter exists",async()=>{
  await assert.rejects(
    findPython312(async command=>({stdout:command==="python3.12"?"Python 3.11.9\n":"invalid"})),
    /Python 3.12 or newer was not found/,
  );
});

test("does not forward ambient credentials into GenLayer tooling",()=>{
  const paths=pythonPaths("/sentinel","darwin");
  const env=pythonEnvironment(paths,{
    PATH:"/usr/bin",
    TMPDIR:"/private/tmp",
    LANG:"en_US.UTF-8",
    API_KEY:"must-not-pass",
    PRIVATE_KEY:"must-not-pass",
    AWS_SECRET_ACCESS_KEY:"must-not-pass",
  });
  assert.deepEqual(env,{
    PATH:`${paths.venvBin}${path.delimiter}/usr/bin`,
    TMPDIR:"/private/tmp",
    LANG:"en_US.UTF-8",
    XDG_CACHE_HOME:paths.cacheRoot,
    PYTHONDONTWRITEBYTECODE:"1",
    PYTHONNOUSERSITE:"1",
  });
});

test("loads only the direct pytest plugin and disables the Studio plugin",()=>{
  const paths=pythonPaths("/sentinel","darwin");
  assert.deepEqual(intelligentContractToolInvocation("test",["-k","record"],paths,"darwin"),{
    command:paths.venvPython,
    args:[
      "-m","pytest",
      "-p","no:gltest",
      "-W","error",
      "intelligent-contract/tests",
      "-q",
      "-k","record",
    ],
  });
  assert.deepEqual(intelligentContractToolInvocation("lint",[],paths,"darwin"),{
    command:path.join(paths.venvBin,"genvm-lint"),
    args:["check","intelligent-contract/sentinel_policy.py"],
  });
  assert.throws(()=>intelligentContractToolInvocation("studio",[],paths,"darwin"),/expected lint or test/);
});
