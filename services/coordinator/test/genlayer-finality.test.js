import test from "node:test";
import assert from "node:assert/strict";
import {GenLayerRpcFinality} from "../../../dist/services/coordinator/src/genlayer-finality.js";
import {genLayerRequestBinding} from "../../../dist/services/coordinator/src/genlayer-record.js";

const h=n=>`0x${n.repeat(64)}`;
const packet={guid:h("1"),srcEid:40161,dstEid:40231,nonce:1n,sender:h("2"),receiver:h("3"),message:"0x",payloadHash:h("4"),encodedPayloadHash:h("8"),txHash:h("5"),blockHash:h("6"),blockNumber:1n};
const request={packet,evidence:{uri:"https://governance.example/proposal/1",digest:h("7"),observedAt:9,validUntil:100},decodedAction:"transfer 1 token",policy:"authorization required"};
const binding=genLayerRequestBinding(request,"v1");

function clients(status={status:"FINALIZED",statusCode:7},tx={txExecutionResultName:"FINISHED_WITH_RETURN"},record=`v1|ALLOW|${h("4")}|${h("7")}|v1|${binding}|authorized`){
  const calls=[];
  return{
    status:{getTransactionStatus:async id=>{calls.push(["status",id]);return status}},
    contract:{writeContract:async args=>{calls.push(["write",args]);return h("9")},getTransaction:async args=>{calls.push(["transaction",args]);return tx},readContract:async args=>{calls.push(["read",args]);return record}},
    calls
  };
}

test("requires FINALIZED/7, successful execution and a latest-final bound record",async()=>{
  const c=clients(),finality=new GenLayerRpcFinality(c.contract,c.status,h("a"),()=>20);
  const id=await finality.submit(request),result=await finality.finalized(id);
  assert.deepEqual(c.calls[0][1].args,[h("1"),h("4"),request.evidence.uri,h("7"),request.decodedAction,request.policy]);
  assert.deepEqual(c.calls.find(call=>call[0]==="status"),["status",h("9")]);
  assert.deepEqual(c.calls.find(call=>call[0]==="transaction"),["transaction",{hash:h("9")}]);
  assert.deepEqual(c.calls.find(call=>call[0]==="read")[1],{address:h("a"),functionName:"get_record",args:[h("1")],transactionHashVariant:"latest-final"});
  assert.equal(result.decision,"ALLOW");
  assert.equal(result.finalizedAt,20);
});

test("keeps every documented non-final status away from transaction and record reads",async()=>{
  const all=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","FINALIZED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"];
  for(const status of all.filter(value=>value!=="FINALIZED")){
    const c=clients({status,statusCode:all.indexOf(status)}),finality=new GenLayerRpcFinality(c.contract,c.status,h("a")),id=await finality.submit(request);
    assert.equal(await finality.finalized(id),undefined);
    assert.equal(c.calls.some(call=>call[0]==="transaction"||call[0]==="read"),false);
  }
  const contradictory=clients({status:"FINALIZED",statusCode:5}),finality=new GenLayerRpcFinality(contradictory.contract,contradictory.status,h("a")),id=await finality.submit(request);
  assert.equal(await finality.finalized(id),undefined);
  assert.equal(contradictory.calls.some(call=>call[0]==="transaction"||call[0]==="read"),false);
});

test("fails closed after finality when execution or record binding is invalid",async()=>{
  for(const tx of [{},{txExecutionResultName:"FINISHED_WITH_ERROR"}]){
    const c=clients({status:"FINALIZED",statusCode:7},tx),finality=new GenLayerRpcFinality(c.contract,c.status,h("a")),id=await finality.submit(request);
    await assert.rejects(finality.finalized(id),/execution did not succeed/);
    assert.equal(c.calls.some(call=>call[0]==="read"),false);
  }
  const mismatch=clients({status:"FINALIZED",statusCode:7},{txExecutionResultName:"FINISHED_WITH_RETURN"},`v1|ALLOW|${h("0")}|${h("7")}|v1|${binding}|bad`),finality=new GenLayerRpcFinality(mismatch.contract,mismatch.status,h("a")),id=await finality.submit(request);
  await assert.rejects(finality.finalized(id),/record binding mismatch/);
  const actionMismatch={...request,decodedAction:"transfer 2 tokens"};
  const altered=clients(),bound=new GenLayerRpcFinality(altered.contract,altered.status,h("a"));
  bound.register(h("9"),actionMismatch);
  await assert.rejects(bound.finalized(h("9")),/record binding mismatch/);
  const malformed=clients({status:"FINALIZED",statusCode:7},{txExecutionResultName:"FINISHED_WITH_RETURN"},{decision:"ALLOW"}),invalid=new GenLayerRpcFinality(malformed.contract,malformed.status,h("a")),invalidId=await invalid.submit(request);
  await assert.rejects(invalid.finalized(invalidId),/invalid GenLayer policy record/);
});

test("restores exactly one durable request binding without resubmission",async()=>{
  const c=clients(),finality=new GenLayerRpcFinality(c.contract,c.status,h("a"),()=>20);
  finality.register(h("9"),request);
  assert.equal((await finality.finalized(h("9"))).decision,"ALLOW");
  assert.equal(c.calls.some(call=>call[0]==="write"),false);
  assert.throws(()=>finality.register(h("9"),{...request,policy:"different"}),/binding conflict/);
  await assert.rejects(finality.finalized(h("0")),/unknown GenLayer request/);
});
