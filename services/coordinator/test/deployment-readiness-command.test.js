import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import{mkdtemp,readFile,readdir,rm,writeFile}from"node:fs/promises";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{getAddress}from"ethers";
import{canonicalJson}from"../../../dist/services/coordinator/src/canonical-json.js";
import{
  runDeploymentReadinessCommand,
  writeReadinessFileExclusive
}from"../../../dist/services/coordinator/src/deployment-readiness-command.js";

const root=process.cwd(),manifestPath=join(tmpdir(),"sentinel-public-readiness.json");
const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const sorted=values=>values.map(address).sort((left,right)=>left.toLowerCase().localeCompare(right.toLowerCase()));
const digest=value=>value.repeat(64);
const manifestText=canonicalJson({
  schemaVersion:1,classification:"LAYERZERO_DVN_CANDIDATE",sourceCommit:"1".repeat(40),
  audit:{date:"2026-07-29",evidenceSha256:digest("a"),networkConfigSha256:digest("b")},
  source:{name:"ethereum-sepolia",chainId:11155111,eid:40161},
  destination:{name:"arbitrum-sepolia",chainId:421614,eid:40231},
  owner:address(0xabc),delegate:address(0xabd),
  signers:sorted([0x101,0x102,0x103,0x104,0x105]),quorum:3,
  recoveryOperators:sorted([0x201,0x202,0x203,0x204,0x205]),
  confirmations:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
  artifacts:{
    SentinelDVNAdapter:{abiSha256:digest("c"),creationBytecodeSha256:digest("d")},
    TreasuryPolicyOApp:{abiSha256:digest("e"),creationBytecodeSha256:digest("f")}
  },
  acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED"
});

function bundle(status){
  return{
    schemaVersion:1,toolVersion:"sentinel-readiness/v1",evaluationDate:"2026-07-29",status,
    truthLabel:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED",userApprovalRequired:true,
    transactions:[]
  };
}
function dependencies(status="BLOCKED_DVN_CONFORMANCE"){
  return{
    repositoryRoot:root,
    readText:async path=>path===manifestPath?manifestText:readFile(path,"utf8"),
    gitState:async()=>({commit:"1".repeat(40),dirty:false}),
    evaluationDate:()=>"2026-07-29",
    writeExclusive:writeReadinessFileExclusive,
    inspect:()=>({}),
    build:()=>bundle(status)
  };
}
function io(){
  const stdout=[],stderr=[];
  return{stdout,stderr,value:{stdout:value=>stdout.push(value),stderr:value=>stderr.push(value)}};
}

test("writes a ready canonical bundle to stdout and returns zero",async()=>{
  const output=io(),code=await runDeploymentReadinessCommand(
    ["--manifest",manifestPath],output.value,dependencies("READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL")
  );
  assert.equal(code,0);assert.equal(output.stderr.join(""),"");
  assert.deepEqual(JSON.parse(output.stdout.join("")),bundle("READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL"));
  assert.equal(output.stdout.join("").endsWith("\n"),true);
});

test("writes a blocked canonical bundle to stdout and returns two",async()=>{
  const output=io(),code=await runDeploymentReadinessCommand(
    ["--manifest",manifestPath],output.value,dependencies()
  );
  assert.equal(code,2);assert.equal(output.stderr.join(""),"");
  assert.equal(JSON.parse(output.stdout.join("")).status,"BLOCKED_DVN_CONFORMANCE");
});

test("writes an output file once without printing the bundle",async()=>{
  const output=io(),calls=[],deps=dependencies();
  deps.writeExclusive=async(path,contents)=>calls.push({path,contents});
  const target=join(tmpdir(),"sentinel-readiness-output.json");
  const code=await runDeploymentReadinessCommand(
    ["--manifest",manifestPath,"--output",target],output.value,deps
  );
  assert.equal(code,2);assert.deepEqual(output.stdout,[]);assert.deepEqual(output.stderr,[]);
  assert.equal(calls.length,1);assert.equal(calls[0].path,target);
  assert.equal(JSON.parse(calls[0].contents).status,"BLOCKED_DVN_CONFORMANCE");
});

test("rejects every argument shape outside the exact absolute-path grammar",async()=>{
  const invalid=[
    [],["--manifest"],["--manifest","relative.json"],["--manifest","-"],
    ["--manifest",'{"schemaVersion":1}'],["--manifest",`${manifestPath}\0x`],
    ["--other",manifestPath],["--manifest",manifestPath,"extra"],
    ["--manifest",manifestPath,"--output"],["--manifest",manifestPath,"--output","relative.json"],
    ["--manifest",manifestPath,"--manifest",manifestPath],
    ["--manifest",manifestPath,"--output",join(tmpdir(),"x"),"extra"]
  ];
  for(const args of invalid){
    const output=io(),code=await runDeploymentReadinessCommand(args,output.value,dependencies());
    assert.equal(code,1);assert.deepEqual(output.stdout,[]);
    assert.equal(output.stderr.join(""),'{"error":"READINESS_MANIFEST_INVALID"}\n');
  }
});

test("rejects malformed or noncanonical manifest JSON without echoing it",async()=>{
  for(const raw of['{"privateKey":"do-not-echo"}\n','{"z":1,"a":2}\n']){
    const output=io(),deps=dependencies();
    deps.readText=async path=>path===manifestPath?raw:readFile(path,"utf8");
    assert.equal(await runDeploymentReadinessCommand(["--manifest",manifestPath],output.value,deps),1);
    assert.deepEqual(output.stdout,[]);
    assert.equal(output.stderr.join("").includes(raw.trim()),false);
    assert.match(output.stderr.join(""),/^\{"error":"READINESS_[A-Z_]+"}\n$/);
  }
});

test("maps dependency failures to stable sanitized codes",async()=>{
  const cases=[
    ["readText","READINESS_INPUT_READ_FAILED"],
    ["gitState","READINESS_GIT_FAILED"],
    ["inspect","READINESS_BINDING_FAILED"],
    ["build","READINESS_BUILD_FAILED"],
    ["writeExclusive","READINESS_OUTPUT_FAILED"]
  ];
  for(const [operation,errorCode]of cases){
    const output=io(),deps=dependencies();
    deps[operation]=async()=>{throw new Error(`raw ${operation} secret`)};
    const args=operation==="writeExclusive"
      ?["--manifest",manifestPath,"--output",join(tmpdir(),"sentinel-output.json")]
      :["--manifest",manifestPath];
    assert.equal(await runDeploymentReadinessCommand(args,output.value,deps),1);
    assert.deepEqual(output.stdout,[]);
    assert.equal(output.stderr.join(""),`{"error":"${errorCode}"}\n`);
    assert.equal(output.stderr.join("").includes("secret"),false);
  }
});

test("preserves stable output-exists failures",async()=>{
  const output=io(),deps=dependencies();
  deps.writeExclusive=async()=>{const error=new Error("raw path");error.code="READINESS_OUTPUT_EXISTS";throw error};
  assert.equal(await runDeploymentReadinessCommand(
    ["--manifest",manifestPath,"--output",join(tmpdir(),"sentinel-output.json")],output.value,deps
  ),1);
  assert.equal(output.stderr.join(""),'{"error":"READINESS_OUTPUT_EXISTS"}\n');
});

test("exclusive output closes and cleans the exact temporary file after each stage failure",async()=>{
  for(const stage of["write","sync","link"]){
    let opened,closed=0;const unlinked=[];
    const handle={
      writeFile:async()=>{if(stage==="write")throw Object.assign(new Error("raw"),{code:"EIO"})},
      sync:async()=>{if(stage==="sync")throw Object.assign(new Error("raw"),{code:"EIO"})},
      close:async()=>{closed++}
    };
    const port={
      open:async path=>{opened=path;return handle},
      link:async()=>{if(stage==="link")throw Object.assign(new Error("raw"),{code:"EIO"})},
      unlink:async path=>{unlinked.push(path)}
    };
    await assert.rejects(
      writeReadinessFileExclusive(join(tmpdir(),`sentinel-${stage}.json`),"{}\n",port),
      error=>error.code==="READINESS_OUTPUT_FAILED"
    );
    assert.equal(closed,1);assert.deepEqual(unlinked,[opened]);
  }
});

test("exclusive output never overwrites an existing file and leaves no sibling temporary file",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"sentinel-readiness-exclusive-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const target=join(directory,"bundle.json"),original=Buffer.from("original\n");
  await writeFile(target,original,{mode:0o600});
  await assert.rejects(
    writeReadinessFileExclusive(target,"replacement\n"),
    error=>error.code==="READINESS_OUTPUT_EXISTS"
  );
  assert.deepEqual(await readFile(target),original);
  assert.deepEqual(await readdir(directory),["bundle.json"]);
});

test("never accesses prohibited capability properties",async()=>{
  const deps=dependencies(),forbidden=[
    "wallet","signer","privateKey","mnemonic","provider","rpc","cloud","environment"
  ];
  for(const name of forbidden)Object.defineProperty(deps,name,{get(){throw new Error(`accessed ${name}`)}});
  const output=io();
  assert.equal(await runDeploymentReadinessCommand(["--manifest",manifestPath],output.value,deps),2);
  assert.equal(output.stderr.join(""),"");
});

test("ambient secret-like variables cannot influence injected output",async()=>{
  const key="SENTINEL_TEST_PRIVATE_KEY",before=process.env[key];
  try{
    const first=io(),second=io(),deps=dependencies();
    delete process.env[key];
    assert.equal(await runDeploymentReadinessCommand(["--manifest",manifestPath],first.value,deps),2);
    process.env[key]="must-not-appear";
    assert.equal(await runDeploymentReadinessCommand(["--manifest",manifestPath],second.value,deps),2);
    assert.equal(first.stdout.join(""),second.stdout.join(""));
    assert.equal(second.stdout.join("").includes(process.env[key]),false);
  }finally{
    if(before===undefined)delete process.env[key];else process.env[key]=before;
  }
});

test("readiness invocation leaves deployment records byte-identical",async()=>{
  const before=await treeDigest(join(root,"deployments")),output=io();
  assert.equal(await runDeploymentReadinessCommand(["--manifest",manifestPath],output.value,dependencies()),2);
  assert.equal(await treeDigest(join(root,"deployments")),before);
});

async function treeDigest(directory){
  const hash=createHash("sha256");
  async function walk(path,prefix=""){
    for(const entry of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const relative=join(prefix,entry.name);hash.update(relative);
      if(entry.isDirectory())await walk(join(path,entry.name),relative);
      else hash.update(await readFile(join(path,entry.name)));
    }
  }
  await walk(directory);return hash.digest("hex");
}
