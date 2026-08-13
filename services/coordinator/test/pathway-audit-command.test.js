import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import{mkdtemp,readFile,readdir,rm,stat,writeFile}from"node:fs/promises";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{getAddress}from"ethers";
import{canonicalJson}from"../../../dist/services/coordinator/src/canonical-json.js";
import{
  readPathwayAuditTextFile,runPathwayAuditCommand,writePathwayAuditFileExclusive
}from"../../../dist/services/coordinator/src/pathway-audit-command.js";

const root=process.cwd();
const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const digest=value=>value.repeat(64);
const manifestPath=join(tmpdir(),"sentinel-pathway-command-manifest.json");
const repositoryFiles=[
  "config/pathway-auditor.json","config/networks.json",
  "docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
  "config/rpc-provider-audit.json","config/dvn-operator-audit.json",
  "config/official-runtime-code-audit.json",
  "dist/contracts/build-manifest.json","dist/contracts/SentinelDVNAdapter.json",
  "dist/contracts/TreasuryPolicyOApp.json"
];

function manifest(){return{
  schemaVersion:1,networkAuditSha256:digest("a"),
  source:{
    name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:3,
    contracts:{endpointV2:address(1),sendUln302:address(2),executor:address(3),deadDvn:address(4)},
    rpcs:[
      {label:"source-a",url:"https://source-a.example/",operatorFamily:"operator-a",originSha256:digest("b")},
      {label:"source-b",url:"https://source-b.example/",operatorFamily:"operator-b",originSha256:digest("c")}
    ]
  },
  destination:{
    name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:20,
    contracts:{endpointV2:address(5),receiveUln302:address(6),deadDvn:address(7)},
    rpcs:[
      {label:"destination-a",url:"https://destination-a.example/",operatorFamily:"operator-c",originSha256:digest("d")},
      {label:"destination-b",url:"https://destination-b.example/rpc",operatorFamily:"operator-d",originSha256:digest("e")}
    ]
  },
  deployment:null,confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
  acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
}}

function output(){
  const stdout=[],stderr=[];
  return{stdout,stderr,io:{stdout:value=>stdout.push(value),stderr:value=>stderr.push(value)}};
}

function dependencyFixture(status="BLOCKED_PATHWAY_CONFIGURATION"){
  const reads=[],clients=[],timestampCalls={count:0};
  const dependencies={
    repositoryRoot:root,
    readText:async path=>{
      reads.push(path);
      if(path===manifestPath)return canonicalJson(manifest());
      if(repositoryFiles.map(value=>join(root,value)).includes(path))return"repository evidence\n";
      throw new Error("unexpected read");
    },
    now:()=>{timestampCalls.count++;return"2026-08-09T12:34:56.789Z"},
    writeExclusive:writePathwayAuditFileExclusive,
    bind:input=>({input}),
    createClient:endpoint=>{
      const client={descriptor:()=>({label:endpoint.label,originSha256:endpoint.originSha256,operatorFamily:endpoint.operatorFamily}),call:async()=>{throw new Error("unused")}};
      clients.push(client);return client;
    },
    observe:async input=>({status,input}),
    build:({observation,runTimestamp})=>({status:observation.status,runTimestamp}),
    encode:bundle=>canonicalJson(bundle)
  };
  return{dependencies,reads,clients,timestampCalls};
}

test("prints one canonical consistent artifact and returns zero",async()=>{
  const capture=output(),fixture=dependencyFixture("OBSERVED_PATHWAY_CONSISTENT");
  const code=await runPathwayAuditCommand(["--manifest",manifestPath],capture.io,fixture.dependencies);
  assert.equal(code,0);assert.deepEqual(capture.stderr,[]);assert.equal(capture.stdout.length,1);
  assert.deepEqual(JSON.parse(capture.stdout[0]),{runTimestamp:"2026-08-09T12:34:56.789Z",status:"OBSERVED_PATHWAY_CONSISTENT"});
  assert.equal(capture.stdout[0].endsWith("\n"),true);
  assert.equal(fixture.timestampCalls.count,1);assert.equal(fixture.clients.length,4);
  assert.deepEqual(fixture.reads,[manifestPath,...repositoryFiles.map(value=>join(root,value))]);
});

test("prints one blocked canonical artifact and returns two",async()=>{
  const capture=output(),fixture=dependencyFixture();
  const code=await runPathwayAuditCommand(["--manifest",manifestPath],capture.io,fixture.dependencies);
  assert.equal(code,2);assert.deepEqual(capture.stderr,[]);assert.equal(capture.stdout.length,1);
  assert.equal(JSON.parse(capture.stdout[0]).status,"BLOCKED_PATHWAY_CONFIGURATION");
});

test("accepts only the two exact absolute-path argument shapes",async()=>{
  const invalid=[
    [],["--manifest"],["--manifest","relative.json"],["--manifest","-"],
    ["--manifest",'{"schemaVersion":1}'],["--manifest",`${manifestPath}\0x`],
    ["--other",manifestPath],["--manifest",manifestPath,"extra"],
    ["--manifest",manifestPath,"--output"],["--manifest",manifestPath,"--output","relative.json"],
    ["--manifest",manifestPath,"--manifest",manifestPath],
    ["--manifest",manifestPath,"--output",join(tmpdir(),"x"),"extra"]
  ];
  for(const args of invalid){
    const capture=output(),fixture=dependencyFixture();
    assert.equal(await runPathwayAuditCommand(args,capture.io,fixture.dependencies),1);
    assert.deepEqual(capture.stdout,[]);
    assert.equal(capture.stderr.join(""),'{"error":"PATHWAY_AUDIT_MANIFEST_INVALID"}\n');
  }
});

test("rejects malformed and secret-bearing manifests without echoing input",async()=>{
  for(const raw of['{"z":1,"a":2}\n','{"privateKey":"must-not-echo"}\n']){
    const capture=output(),fixture=dependencyFixture();
    fixture.dependencies.readText=async path=>path===manifestPath?raw:"repository evidence\n";
    assert.equal(await runPathwayAuditCommand(["--manifest",manifestPath],capture.io,fixture.dependencies),1);
    assert.deepEqual(capture.stdout,[]);assert.equal(capture.stderr.join("").includes("must-not-echo"),false);
    assert.match(capture.stderr.join(""),/^\{"error":"PATHWAY_AUDIT_(?:MANIFEST_INVALID|SECRET_FIELD_REJECTED)"\}\n$/);
  }
});

test("maps read, policy, transport, observation, build, and output failures to sanitized codes",async()=>{
  const cases=[
    ["readText","PATHWAY_AUDIT_INPUT_READ_FAILED"],
    ["bind","PATHWAY_AUDIT_POLICY_BINDING_FAILED"],
    ["createClient","PATHWAY_AUDIT_OBSERVATION_FAILED"],
    ["observe","PATHWAY_AUDIT_OBSERVATION_FAILED"],
    ["build","PATHWAY_AUDIT_BUILD_FAILED"],
    ["encode","PATHWAY_AUDIT_BUILD_FAILED"],
    ["writeExclusive","PATHWAY_AUDIT_OUTPUT_FAILED"]
  ];
  for(const[operation,errorCode]of cases){
    const capture=output(),fixture=dependencyFixture();
    fixture.dependencies[operation]=(operation==="createClient"||operation==="encode")
      ?()=>{throw new Error(`raw ${operation} private value`)}
      :async()=>{throw new Error(`raw ${operation} private value`)};
    const args=operation==="writeExclusive"
      ?["--manifest",manifestPath,"--output",join(tmpdir(),"sentinel-pathway-output.json")]
      :["--manifest",manifestPath];
    assert.equal(await runPathwayAuditCommand(args,capture.io,fixture.dependencies),1,operation);
    assert.deepEqual(capture.stdout,[],operation);
    assert.equal(capture.stderr.join(""),`{"error":"${errorCode}"}\n`,operation);
  }
  const transport=output(),fixture=dependencyFixture();
  fixture.dependencies.observe=async()=>{throw Object.assign(new Error("raw rpc url"),{code:"PATHWAY_AUDIT_TRANSPORT_FAILED"})};
  assert.equal(await runPathwayAuditCommand(["--manifest",manifestPath],transport.io,fixture.dependencies),1);
  assert.equal(transport.stderr.join(""),'{"error":"PATHWAY_AUDIT_TRANSPORT_FAILED"}\n');
});

test("maps artifact and every repository evidence read failure to input-read failure",async()=>{
  for(const failed of[manifestPath,...repositoryFiles.map(value=>join(root,value))]){
    const capture=output(),fixture=dependencyFixture();
    const original=fixture.dependencies.readText;
    fixture.dependencies.readText=async path=>{if(path===failed)throw new Error(`raw path ${path}`);return original(path)};
    assert.equal(await runPathwayAuditCommand(["--manifest",manifestPath],capture.io,fixture.dependencies),1,failed);
    assert.deepEqual(capture.stdout,[],failed);
    assert.equal(capture.stderr.join(""),'{"error":"PATHWAY_AUDIT_INPUT_READ_FAILED"}\n',failed);
    assert.equal(capture.stderr.join("").includes(failed),false,failed);
  }
});

test("uses exclusive mode 0600 and refuses an existing output without replacing it",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"sentinel-pathway-command-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const target=join(directory,"evidence.json"),capture=output(),fixture=dependencyFixture();
  assert.equal(await runPathwayAuditCommand(["--manifest",manifestPath,"--output",target],capture.io,fixture.dependencies),2);
  assert.deepEqual(capture.stdout,[]);assert.deepEqual(capture.stderr,[]);
  assert.equal((await stat(target)).mode&0o777,0o600);
  const first=await readFile(target,"utf8");
  const second=output(),secondFixture=dependencyFixture("OBSERVED_PATHWAY_CONSISTENT");
  assert.equal(await runPathwayAuditCommand(["--manifest",manifestPath,"--output",target],second.io,secondFixture.dependencies),1);
  assert.equal(second.stderr.join(""),'{"error":"PATHWAY_AUDIT_OUTPUT_EXISTS"}\n');
  assert.equal(await readFile(target,"utf8"),first);
});

test("the pathway-specific bounded reader rejects links and nonfiles",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"sentinel-pathway-read-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,"manifest.json"),link=join(directory,"link.json");
  await writeFile(file,"safe\n");
  const{symlink}=await import("node:fs/promises");await symlink(file,link);
  assert.equal(await readPathwayAuditTextFile(file),"safe\n");
  await assert.rejects(readPathwayAuditTextFile(link),error=>error?.code==="PATHWAY_AUDIT_INPUT_READ_FAILED");
  await assert.rejects(readPathwayAuditTextFile(directory),error=>error?.code==="PATHWAY_AUDIT_INPUT_READ_FAILED");
});

test("a blocked run cannot touch dangerous capabilities or mutate repository evidence",async()=>{
  const capture=output(),fixture=dependencyFixture(),dangerous=[
    "wallet","signer","privateKey","mnemonic","provider","deploy","sendTransaction","fund","cloud","environment"
  ];
  for(const property of dangerous)Object.defineProperty(fixture.dependencies,property,{enumerable:true,get(){throw new Error(`accessed ${property}`)}});
  const immutable=[
    "contracts/src/SentinelDVNAdapter.sol","contracts/src/TreasuryPolicyOApp.sol",
    "dist/contracts/SentinelDVNAdapter.json","dist/contracts/TreasuryPolicyOApp.json","dist/contracts/build-manifest.json",
    "config/networks.json","config/pathway-auditor.json","config/rpc-provider-audit.json","config/dvn-operator-audit.json","config/official-runtime-code-audit.json"
  ];
  const before={files:await fileDigests(immutable),deployments:await treeDigest(join(root,"deployments"))};
  assert.equal(await runPathwayAuditCommand(["--manifest",manifestPath],capture.io,fixture.dependencies),2);
  assert.deepEqual({files:await fileDigests(immutable),deployments:await treeDigest(join(root,"deployments"))},before);
});

async function treeDigest(directory){
  const hash=createHash("sha256");
  async function walk(path,prefix=""){
    for(const entry of(await readdir(path,{withFileTypes:true})).sort((left,right)=>left.name.localeCompare(right.name))){
      const relative=join(prefix,entry.name);hash.update(relative);
      if(entry.isDirectory())await walk(join(path,entry.name),relative);else hash.update(await readFile(join(path,entry.name)));
    }
  }
  await walk(directory);return hash.digest("hex");
}

async function fileDigests(paths){
  return Object.fromEntries(await Promise.all(paths.map(async path=>[
    path,createHash("sha256").update(await readFile(join(root,path))).digest("hex")
  ])));
}
