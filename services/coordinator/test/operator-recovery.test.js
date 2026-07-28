import test from"node:test";
import assert from"node:assert/strict";
import{Wallet,solidityPackedKeccak256}from"ethers";
import{encodePacketV1}from"../../../dist/packages/core/src/packet-v1.js";
import{recoveryTypedData}from"../../../dist/services/coordinator/src/recovery-proposal.js";
import{OperatorRecoveryService,RecoveryError}from"../../../dist/services/coordinator/src/operator-recovery.js";
import{executionDigest}from"../../../dist/services/coordinator/src/signing.js";

const h=value=>`0x${value.repeat(64)}`,a=value=>`0x${value.repeat(40)}`,b=value=>`0x${"0".repeat(24)}${value.repeat(40)}`,zero=h("0");
const recoveryWallets=[6,7,8,9,10].map(value=>new Wallet(`0x${value.toString(16).padStart(64,"0")}`)).sort((left,right)=>left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
const recoveryOperators=recoveryWallets.map(wallet=>wallet.address.toLowerCase());
const config={
  pathway:{name:"sepolia-arbitrum",sourceChainId:11155111,destinationChainId:421614,srcEid:40161,dstEid:40231,endpoint:a("1"),sendLibrary:a("2"),sourceOAppAddress:a("3"),sourceOApp:b("3"),destinationOApp:b("4"),sentinelDvn:a("5"),requiredDvns:[a("c")],optionalDvns:[a("5")],confirmations:15n},
  destination:{chainId:421614,oapp:a("4"),adapter:a("9"),receiveLibrary:a("8"),authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")]},
  genlayer:{policyContract:a("6")},
  recovery:{operators:recoveryOperators,quorum:3,minimumDelaySeconds:900,maximumLifetimeSeconds:3600}
};
const guid=solidityPackedKeccak256(["uint64","uint32","bytes32","uint32","bytes32"],[1n,40161,b("3"),40231,b("4")]);
const encodedPayload=encodePacketV1({nonce:1n,srcEid:40161,sender:b("3"),dstEid:40231,receiver:b("4"),guid,message:"0x1234"});
const detected={transactionHash:h("a"),blockHash:h("b"),blockNumber:90n,encodedPayload,options:"0x0102",sendLibrary:a("2"),requiredDvns:[a("c")],optionalDvns:[a("5")],fees:[2n,3n]};

async function signedBundle(proposal,count=3){
  const typed=recoveryTypedData(config,proposal),approvals=await Promise.all(recoveryWallets.slice(0,count).map(async wallet=>({address:wallet.address.toLowerCase(),signature:await wallet.signTypedData(typed.domain,typed.types,typed.value)})));
  approvals.sort((left,right)=>left.address.localeCompare(right.address));
  return{proposal,approvals};
}
function receipt(input,appliedAt,resultCode){
  return{...input,resultCode,approvalCount:3,appliedAt,previousReceiptHash:zero,receiptHash:h("9")};
}
function ingestionFixture(overrides={}){
  let now=100,dead={transactionHash:h("a"),blockNumber:90n,attempts:3,errorCode:"INGESTION_FAILED",firstFailedAt:70,lastFailedAt:90,packet:structuredClone(detected)},storedReceipt;
  const calls=[],state={active:false,badProof:false};
  const store={
    findDead:async(key,tx)=>key===config.pathway.name&&tx.toLowerCase()===h("a")&&dead?structuredClone(dead):undefined,
    getRecoveryReceipt:async actionId=>storedReceipt?.actionId===actionId?storedReceipt:undefined,
    resolveWithAudit:async(key,tx,input,appliedAt)=>{calls.push("resolve");if(!dead||key!==config.pathway.name||tx.toLowerCase()!==h("a"))throw new Error("state mismatch");dead=undefined;storedReceipt=receipt(input,appliedAt,"INGESTION_REQUEUED");return storedReceipt},
    listRecoveryReceipts:async()=>storedReceipt?[storedReceipt]:[]
  };
  const inbox={requeue:async packet=>{calls.push("requeue");assert.equal(packet.transactionHash.toLowerCase(),h("a"))}};
  const sourceVerifier={verify:async packet=>{calls.push("source-verify");if(state.badProof)throw new Error("provider secret detail");const base={blockHash:packet.blockHash,payloadHash:packet.payloadHash,configurationDigest:h("c"),confirmations:15n};return[{...base,provider:"https://a.example"},{...base,provider:"https://b.example"}]}};
  const lease={
    acquireRecovery:async()=>{calls.push("lease-acquire");if(state.active)throw new Error("runtime active")},
    releaseRecovery:async()=>calls.push("lease-release")
  };
  const service=new OperatorRecoveryService({config,recoveryStore:store,inbox,outbox:{},sourceVerifier,destinationPath:{},destinationVerifier:{},lease,now:()=>now,nonce:()=>h("f"),...overrides});
  return{service,calls,state,store,get dead(){return dead},set dead(value){dead=value},setNow:value=>{now=value}};
}

test("prepares without mutation and requeues only after repeated source proof and quorum",async()=>{
  const fixture=ingestionFixture(),proposal=await fixture.service.prepareIngestion(h("A"));
  assert.equal(proposal.subject,h("a"));assert.equal(proposal.expectedState,"DEAD");assert.equal(proposal.executeAfter,"1000");assert.equal(fixture.dead.attempts,3);assert.deepEqual(await fixture.store.listRecoveryReceipts(),[]);
  fixture.calls.length=0;fixture.setNow(1000);
  const applied=await fixture.service.apply(await signedBundle(proposal));
  assert.equal(applied.resultCode,"INGESTION_REQUEUED");assert.equal(fixture.dead,undefined);
  assert.deepEqual(fixture.calls,["lease-acquire","source-verify","requeue","resolve","lease-release"]);
});

test("fails closed for missing, unproven, unauthorized, active, changed or expired ingestion recovery",async()=>{
  await assert.rejects(ingestionFixture({}).service.prepareIngestion("not-a-hash"),error=>error instanceof RecoveryError&&error.code==="RECOVERY_NOT_FOUND"&&!error.message.includes("hash"));
  await assert.rejects(ingestionFixture({}).service.prepareIngestion(h("b")),error=>error instanceof RecoveryError&&error.code==="RECOVERY_NOT_FOUND");
  const unproven=ingestionFixture();unproven.state.badProof=true;
  await assert.rejects(unproven.service.prepareIngestion(h("a")),error=>error.code==="RECOVERY_SOURCE_PROOF_FAILED"&&!error.message.includes("secret"));
  const insufficient=ingestionFixture(),proposal=await insufficient.service.prepareIngestion(h("a"));insufficient.setNow(1000);
  await assert.rejects(insufficient.service.apply(await signedBundle(proposal,2)),error=>error.code==="RECOVERY_INVALID_BUNDLE");assert(!insufficient.calls.includes("lease-acquire"));
  const active=ingestionFixture(),activeProposal=await active.service.prepareIngestion(h("a"));active.state.active=true;active.setNow(1000);
  await assert.rejects(active.service.apply(await signedBundle(activeProposal)),error=>error.code==="RECOVERY_RUNTIME_ACTIVE");assert(active.dead);
  const changed=ingestionFixture(),changedProposal=await changed.service.prepareIngestion(h("a"));changed.dead.packet.options="0xffff";changed.setNow(1000);
  await assert.rejects(changed.service.apply(await signedBundle(changedProposal)),error=>error.code==="RECOVERY_STATE_CHANGED");assert(changed.dead);assert.equal((await changed.store.listRecoveryReceipts()).length,0);
  const expired=ingestionFixture(),expiredProposal=await expired.service.prepareIngestion(h("a"));expired.setNow(3700);
  await assert.rejects(expired.service.apply(await signedBundle(expiredProposal)),error=>error.code==="RECOVERY_INVALID_BUNDLE");assert(expired.dead);
});

const envelope={chainId:421614n,adapter:a("9"),verificationTarget:a("8"),guid:h("3"),packetDigest:h("4"),evidenceDigest:h("5"),callData:"0x1234",expiry:2000n};
const destinationDigest=executionDigest(envelope),dvnShares=[a("1"),a("2"),a("3")].map((address,index)=>({address,digest:destinationDigest,signature:`0x${String(index+1).repeat(130)}`}));
function destinationFixture(result={status:"CONFIRMED",confirmations:64n}){
  let now=100,storedReceipt,record={guid:h("3"),digest:destinationDigest,envelope,shares:dvnShares,state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS",createdAt:50,updatedAt:90};
  const calls=[],state={active:false,result};
  const outbox={
    get:async requested=>requested.toLowerCase()===record.guid?structuredClone(record):undefined,
    getRecoveryReceipt:async actionId=>storedReceipt?.actionId===actionId?storedReceipt:undefined,
    listRecoveryReceipts:async()=>storedReceipt?[storedReceipt]:[],
    recoverConfirmed:async(_guid,_digest,_failure,transactionHash,confirmations,input,appliedAt)=>{calls.push("recover-confirmed");if(input.preconditionDigest!==proposalPrecondition)throw new Error("audit mismatch");record={...record,state:"CONFIRMED",transactionHash,confirmations,updatedAt:appliedAt};delete record.failureCode;storedReceipt=receipt(input,appliedAt,"DESTINATION_CONFIRMED");return{record,receipt:storedReceipt}}
  };
  const candidates=[];
  const destinationPath={verify:async()=>{calls.push("destination-path");return{configurationDigest:h("7")}}};
  const destinationVerifier={confirm:async candidate=>{calls.push("destination-confirm");candidates.push(candidate);return state.result}};
  const lease={acquireRecovery:async()=>{calls.push("lease-acquire");if(state.active)throw new Error("runtime active")},releaseRecovery:async()=>calls.push("lease-release")};
  let proposalPrecondition;
  const service=new OperatorRecoveryService({config,recoveryStore:{},inbox:{},outbox,sourceVerifier:{},destinationPath,destinationVerifier,lease,now:()=>now,nonce:()=>h("e")});
  return{service,calls,state,candidates,outbox,get record(){return record},set record(value){record=value},setProposal:value=>{proposalPrecondition=value.preconditionDigest},setNow:value=>{now=value}};
}

test("confirms an ambiguous destination hash only after repeating path and receipt proof",async()=>{
  const fixture=destinationFixture(),proposal=await fixture.service.prepareDestination(h("3"),h("c"));fixture.setProposal(proposal);
  assert.equal(fixture.record.state,"RECOVERY_REQUIRED");assert.equal(fixture.candidates[0].state,"SUBMITTED");assert.equal(fixture.candidates[0].transactionHash,h("c"));assert.equal(fixture.candidates[0].failureCode,undefined);
  fixture.calls.length=0;fixture.candidates.length=0;fixture.setNow(1000);
  const applied=await fixture.service.apply(await signedBundle(proposal));
  assert.equal(applied.resultCode,"DESTINATION_CONFIRMED");assert.equal(fixture.record.state,"CONFIRMED");
  assert.deepEqual(fixture.calls,["lease-acquire","destination-path","destination-confirm","recover-confirmed","lease-release"]);
  assert.equal(fixture.candidates[0].state,"SUBMITTED");assert.equal(fixture.candidates[0].transactionHash,h("c"));
  fixture.calls.length=0;assert.deepEqual(await fixture.service.apply(await signedBundle(proposal)),applied);assert.deepEqual(fixture.calls,[]);
});

test("never mutates destination state for pending, failed, changed, active or audit-conflicting recovery",async()=>{
  await assert.rejects(destinationFixture().service.prepareDestination("not-a-guid",h("c")),error=>error instanceof RecoveryError&&error.code==="RECOVERY_NOT_FOUND"&&!error.message.includes("hash"));
  const corrupt=destinationFixture();corrupt.record={...corrupt.record,digest:h("f")};
  await assert.rejects(corrupt.service.prepareDestination(h("3"),h("c")),error=>error instanceof RecoveryError&&error.code==="RECOVERY_STATE_CHANGED"&&!error.message.includes("digest"));
  for(const result of[{status:"PENDING"},{status:"FAILED",code:"EVENT_MISMATCH"},{status:"FAILED",code:"ADAPTER_UNUSED"},{status:"FAILED",code:"RPC_UNAVAILABLE"}]){
    const fixture=destinationFixture(result);
    await assert.rejects(fixture.service.prepareDestination(h("3"),h("c")),error=>error.code===`RECOVERY_DESTINATION_${result.status}`);
    assert.equal(fixture.record.state,"RECOVERY_REQUIRED");assert.equal((await fixture.outbox.listRecoveryReceipts()).length,0);
  }
  const changed=destinationFixture(),proposal=await changed.service.prepareDestination(h("3"),h("c"));changed.setProposal(proposal);changed.record={...changed.record,updatedAt:91};changed.setNow(1000);
  await assert.rejects(changed.service.apply(await signedBundle(proposal)),error=>error.code==="RECOVERY_STATE_CHANGED");assert(!changed.calls.includes("recover-confirmed"));
  const active=destinationFixture(),activeProposal=await active.service.prepareDestination(h("3"),h("c"));active.setProposal(activeProposal);active.state.active=true;active.setNow(1000);
  await assert.rejects(active.service.apply(await signedBundle(activeProposal)),error=>error.code==="RECOVERY_RUNTIME_ACTIVE");assert.equal(active.record.state,"RECOVERY_REQUIRED");
  const conflict=destinationFixture(),conflictProposal=await conflict.service.prepareDestination(h("3"),h("c"));conflict.setProposal({...conflictProposal,preconditionDigest:h("f")});conflict.setNow(1000);
  await assert.rejects(conflict.service.apply(await signedBundle(conflictProposal)),error=>error.code==="RECOVERY_APPLY_FAILED");assert.equal((await conflict.outbox.listRecoveryReceipts()).length,0);
});
