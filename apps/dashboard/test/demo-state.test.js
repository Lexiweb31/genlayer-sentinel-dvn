import test from "node:test";
import assert from "node:assert/strict";
import {
  initialDemoState,
  reduceDemoState
} from "../../../dist/apps/dashboard/src/demo-state.js";

const account="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const transactionHash=`0x${"6".repeat(64)}`;
const guid=`0x${"7".repeat(64)}`;

function ready(){
  let state=initialDemoState();
  state=reduceDemoState(state,{type:"CAPABILITY_AVAILABLE"});
  state=reduceDemoState(state,{type:"WALLET_READY",account});
  return state;
}

test("keeps source mining separate from coordinator policy and execution",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  state=reduceDemoState(state,{type:"SOURCE_SUBMITTED",transactionHash});
  assert.equal(state.phase,"SUBMITTED");
  state=reduceDemoState(state,{type:"GUID_OBSERVED",transactionHash,guid});
  assert.equal(state.phase,"COORDINATOR_PENDING");
  assert.equal(state.transactionHash,transactionHash);
  assert.equal(state.guid,guid);
  assert.throws(()=>reduceDemoState(state,{type:"SENTINEL_EXECUTED"}),/invalid demo transition/);
  state=reduceDemoState(state,{type:"COORDINATOR_STAGE",stage:"POLICY_PENDING"});
  assert.equal(state.phase,"COORDINATOR_PENDING");
  state=reduceDemoState(state,{type:"COORDINATOR_STAGE",stage:"EXECUTED"});
  assert.equal(state.phase,"SENTINEL_EXECUTED");
});

test("only coordinator evidence can produce rejection or an execution incident",()=>{
  const pending=reduceDemoState(
    reduceDemoState(
      reduceDemoState(
        reduceDemoState(
          reduceDemoState(ready(),{type:"QUOTE_REQUESTED"}),
          {type:"QUOTE_READY",nativeFee:"1000000000000"}
        ),
        {type:"SEND_REQUESTED"}
      ),
      {type:"SOURCE_SUBMITTED",transactionHash}
    ),
    {type:"GUID_OBSERVED",transactionHash,guid}
  );
  assert.equal(reduceDemoState(pending,{type:"COORDINATOR_STAGE",stage:"REJECTED"}).phase,"POLICY_REJECTED");
  assert.equal(reduceDemoState(pending,{type:"COORDINATOR_INCIDENT",code:"SUBMISSION_AMBIGUOUS"}).phase,"SENTINEL_INCIDENT");
});

test("preserves stable wallet and source failure phases without inventing a GUID",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_FAILED",code:"QUOTE_REVERTED"});
  assert.deepEqual({phase:state.phase,errorCode:state.errorCode,guid:state.guid},{phase:"QUOTE_FAILED",errorCode:"QUOTE_REVERTED",guid:undefined});
  state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  state=reduceDemoState(state,{type:"SOURCE_FAILED",code:"USER_REJECTED"});
  assert.equal(state.phase,"USER_REJECTED");
  assert.equal(state.guid,undefined);
});

test("account or chain invalidation clears quote and transaction state",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"INVALIDATED"});
  assert.deepEqual(state,initialDemoState("WALLET_REQUIRED"));
});

test("input changes discard only the quote while wallet failures and mined-source failures stay explicit",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"INPUT_CHANGED"});
  assert.deepEqual(state,{phase:"READY",account});

  state=initialDemoState("WALLET_REQUIRED");
  state=reduceDemoState(state,{type:"WALLET_FAILED",code:"WRONG_CHAIN"});
  assert.deepEqual(state,{phase:"WRONG_CHAIN",errorCode:"WRONG_CHAIN"});

  state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  state=reduceDemoState(state,{type:"SOURCE_SUBMITTED",transactionHash});
  state=reduceDemoState(state,{type:"SOURCE_FAILED",code:"SOURCE_RECEIPT_UNAVAILABLE"});
  assert.deepEqual(
    {phase:state.phase,errorCode:state.errorCode,transactionHash:state.transactionHash,guid:state.guid},
    {phase:"SOURCE_FAILED",errorCode:"SOURCE_RECEIPT_UNAVAILABLE",transactionHash,guid:undefined}
  );
});
