import test from"node:test";
import assert from"node:assert/strict";
import{mkdtempSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{runRecoveryCommand}from"../../../dist/services/coordinator/src/recovery-command.js";
import{RecoveryError}from"../../../dist/services/coordinator/src/operator-recovery.js";

const h=value=>`0x${value.repeat(64)}`;
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),"sentinel-recovery-command-")),manifest=join(directory,"runtime.json"),bundlePath=join(directory,"bundle.json");
  const calls=[],stdout=[],stderr=[],config={name:"parsed"},proposal={version:1,kind:"INGESTION_REQUEUE",subject:h("1"),preparedAt:"100"},receipt={actionId:h("2"),approvalCount:3,appliedAt:1000};
  const service={
    prepareIngestion:async transaction=>{calls.push(["prepare-ingestion",transaction]);return proposal},
    prepareDestination:async(guid,transaction)=>{calls.push(["prepare-destination",guid,transaction]);return{...proposal,kind:"DESTINATION_CONFIRM",subject:guid,candidateTransactionHash:transaction}},
    apply:async value=>{calls.push(["apply",value]);return receipt}
  };
  const dependencies={
    readText:async path=>{calls.push(["read",path]);if(path===manifest)return'{"manifest":true}';if(path===bundlePath)return'{"proposal":{"version":1},"approvals":[]}';throw new Error("secret path")},
    parseConfig:value=>{calls.push(["parse",value]);return config},
    open:parsed=>{calls.push(["open",parsed]);return{service,close:()=>calls.push(["close"])}}
  };
  Object.defineProperties(dependencies,{privateKey:{get(){throw new Error("private key requested")}},wallet:{get(){throw new Error("wallet requested")}},signer:{get(){throw new Error("signer requested")}}});
  return{directory,manifest,bundlePath,calls,stdout,stderr,dependencies,io:{stdout:value=>stdout.push(value),stderr:value=>stderr.push(value)},proposal,receipt,close:()=>rmSync(directory,{recursive:true,force:true})};
}

test("prepares exact ingestion and destination proposals as one canonical JSON line",async()=>{
  const value=fixture();
  try{
    assert.equal(await runRecoveryCommand(["prepare","ingestion","--manifest",value.manifest,"--transaction",h("a")],value.io,value.dependencies),0);
    assert.deepEqual(value.stdout,[`${JSON.stringify(value.proposal)}\n`]);assert.deepEqual(value.stderr,[]);assert.deepEqual(value.calls.slice(-2),[["prepare-ingestion",h("a")],["close"]]);
    value.stdout.length=0;value.calls.length=0;
    assert.equal(await runRecoveryCommand(["prepare","destination","--manifest",value.manifest,"--guid",h("b"),"--transaction",h("c")],value.io,value.dependencies),0);
    assert.equal(JSON.parse(value.stdout[0]).candidateTransactionHash,h("c"));assert.deepEqual(value.calls.slice(-2),[["prepare-destination",h("b"),h("c")],["close"]]);
  }finally{value.close()}
});

test("applies a detached bundle without requesting any key or signer capability",async()=>{
  const value=fixture();
  try{
    assert.equal(await runRecoveryCommand(["apply","--manifest",value.manifest,"--bundle",value.bundlePath],value.io,value.dependencies),0);
    assert.deepEqual(value.stdout,[`${JSON.stringify(value.receipt)}\n`]);assert.deepEqual(value.stderr,[]);
    assert.deepEqual(value.calls.slice(-3),[["read",value.bundlePath],["apply",{proposal:{version:1},approvals:[]}],["close"]]);
  }finally{value.close()}
});

test("rejects relative, environment-only, malformed, unknown and extra command arguments",async()=>{
  const cases=[
    ["prepare","ingestion","--manifest","relative.json","--transaction",h("a")],
    ["prepare","ingestion","--transaction",h("a")],
    ["prepare","ingestion","--manifest","/tmp/a.json","--transaction","0x12"],
    ["prepare","unknown","--manifest","/tmp/a.json","--transaction",h("a")],
    ["apply","--manifest","/tmp/a.json"],
    ["apply","--manifest","/tmp/a.json","--bundle","relative.json"],
    ["apply","--manifest","/tmp/a.json","--bundle","/tmp/b.json","extra"]
  ];
  for(const args of cases){const value=fixture();try{assert.equal(await runRecoveryCommand(args,value.io,value.dependencies),2);assert.deepEqual(value.stdout,[]);assert.deepEqual(value.stderr,['{"error":"RECOVERY_CLI_USAGE"}\n']);assert(!value.calls.some(call=>call[0]==="open"))}finally{value.close()}}
});

test("sanitizes JSON and service failures and always closes acquired resources",async()=>{
  const malformed=fixture();malformed.dependencies.readText=async()=>"{";
  try{assert.equal(await runRecoveryCommand(["apply","--manifest",malformed.manifest,"--bundle",malformed.bundlePath],malformed.io,malformed.dependencies),1);assert.deepEqual(malformed.stderr,['{"error":"RECOVERY_CLI_INPUT"}\n']);assert.doesNotMatch(malformed.stderr[0],/Syntax|path|secret/)}finally{malformed.close()}
  const failed=fixture();failed.dependencies.open=()=>({service:{prepareIngestion:async()=>{throw new Error("database /private/secret")}},close:()=>failed.calls.push(["close"])});
  try{assert.equal(await runRecoveryCommand(["prepare","ingestion","--manifest",failed.manifest,"--transaction",h("a")],failed.io,failed.dependencies),1);assert.deepEqual(failed.stderr,['{"error":"RECOVERY_CLI_FAILED"}\n']);assert.deepEqual(failed.calls.at(-1),["close"])}finally{failed.close()}
  const coded=fixture();coded.dependencies.open=()=>({service:{apply:async()=>{throw new RecoveryError("RECOVERY_RUNTIME_ACTIVE")}},close:()=>coded.calls.push(["close"])});
  try{assert.equal(await runRecoveryCommand(["apply","--manifest",coded.manifest,"--bundle",coded.bundlePath],coded.io,coded.dependencies),1);assert.deepEqual(coded.stderr,['{"error":"RECOVERY_RUNTIME_ACTIVE"}\n']);assert.deepEqual(coded.calls.at(-1),["close"])}finally{coded.close()}
});
