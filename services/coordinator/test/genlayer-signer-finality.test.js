import test from"node:test";
import assert from"node:assert/strict";
import{GenLayerSignerFinalityAttestor}from"../../../dist/services/coordinator/src/genlayer-signer-finality.js";
import{genLayerRequestBindingFromInput}from"../../../dist/services/coordinator/src/genlayer-record.js";

const h=value=>`0x${value.repeat(64)}`;
const a=value=>`0x${value.repeat(40)}`;
const policyContract=a("9");
const envelope={
  chainId:421614n,
  adapter:a("1"),
  verificationTarget:a("2"),
  guid:h("3"),
  packetDigest:h("4"),
  evidenceDigest:h("5"),
  callData:"0x1234",
  expiry:200n,
};
const authorization={
  witness:{
    transactionId:h("8"),
    evidenceUri:"https://governance.example/proposal/7",
    decodedAction:"transfer 1 token",
    policy:"Require exact authorization.",
  },
  result:{
    guid:envelope.guid,
    packetDigest:envelope.packetDigest,
    evidenceDigest:envelope.evidenceDigest,
    decision:"ALLOW",
    reasonCode:"GENLAYER_FINALIZED_ALLOW",
    finalizedAt:100,
    policyVersion:"treasury-v1",
  },
};
const input={
  guid:envelope.guid,
  packetDigest:envelope.packetDigest,
  evidenceUri:authorization.witness.evidenceUri,
  evidenceDigest:envelope.evidenceDigest,
  decodedAction:authorization.witness.decodedAction,
  policy:authorization.witness.policy,
};
const binding=genLayerRequestBindingFromInput(input,"treasury-v1");
const record=`v1|ALLOW|${envelope.packetDigest}|${envelope.evidenceDigest}|treasury-v1|${binding}|authorized`;
const transaction={
  recipient:policyContract,
  functionName:"evaluate",
  args:[
    envelope.guid,
    envelope.packetDigest,
    authorization.witness.evidenceUri,
    envelope.evidenceDigest,
    authorization.witness.decodedAction,
    authorization.witness.policy,
  ],
  executionResultName:"FINISHED_WITH_RETURN",
};

function fixture(change={}){
  const calls=[];
  const status=change.statusReader??{
    getTransactionStatus:async transactionId=>{
      calls.push(["status",transactionId]);
      return change.status??{status:"FINALIZED",statusCode:7};
    },
  };
  const witness=change.witnessReader??{
    getTransactionWitness:async transactionId=>{
      calls.push(["transaction",transactionId]);
      return change.transaction??transaction;
    },
    readPolicyRecord:async(contract,guid)=>{
      calls.push(["record",contract,guid]);
      return change.record??record;
    },
  };
  return{
    calls,
    attestor:new GenLayerSignerFinalityAttestor(
      status,
      witness,
      change.policyContract??policyContract,
    ),
  };
}

test("requires finalized successful evaluate and the exact bound record",async()=>{
  const{attestor,calls}=fixture();
  await attestor.assertFinalized(envelope,authorization);
  assert.deepEqual(calls,[
    ["status",authorization.witness.transactionId],
    ["transaction",authorization.witness.transactionId],
    ["record",policyContract,envelope.guid],
  ]);
});

test("fails closed on every transaction and record mismatch",async()=>{
  const cases=[
    {status:{status:"ACCEPTED",statusCode:5}},
    {transaction:{...transaction,executionResultName:"FINISHED_WITH_ERROR"}},
    {transaction:{...transaction,recipient:a("7")}},
    {transaction:{...transaction,functionName:"other"}},
    ...transaction.args.map((_,index)=>({
      transaction:{
        ...transaction,
        args:transaction.args.map((value,position)=>
          position===index?(index===2||index===4||index===5?`${value} changed`:h("f")):value
        ),
      },
    })),
    {record:record.replace("|ALLOW|","|DENY|")},
    {record:record.replace("|treasury-v1|","|treasury-v2|")},
    {record:record.replace(binding,h("0"))},
  ];
  for(const change of cases){
    const{attestor}=fixture(change);
    await assert.rejects(
      attestor.assertFinalized(envelope,authorization),
      /GenLayer signer finality mismatch/,
    );
  }
  const{attestor}=fixture();
  await assert.rejects(
    attestor.assertFinalized(envelope,{
      ...authorization,
      result:{...authorization.result,reasonCode:"AUTHORIZED"},
    }),
    /GenLayer signer finality mismatch/,
  );
});

test("sanitizes status, transaction, and record dependency failures",async()=>{
  const secret="secret provider token";
  const cases=[
    {
      change:{statusReader:{getTransactionStatus:async()=>{throw new Error(secret)}}},
      message:"GenLayer signer status unavailable",
    },
    {
      change:{witnessReader:{
        getTransactionWitness:async()=>{throw new Error(secret)},
        readPolicyRecord:async()=>record,
      }},
      message:"GenLayer signer transaction unavailable",
    },
    {
      change:{witnessReader:{
        getTransactionWitness:async()=>transaction,
        readPolicyRecord:async()=>{throw new Error(secret)},
      }},
      message:"GenLayer signer record unavailable",
    },
  ];
  for(const{change,message}of cases){
    const{attestor}=fixture(change);
    await assert.rejects(
      attestor.assertFinalized(envelope,authorization),
      error=>error.message===message&&!error.message.includes(secret),
    );
  }
});
