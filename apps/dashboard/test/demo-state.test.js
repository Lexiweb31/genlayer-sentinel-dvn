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
  state=reduceDemoState(state,{type:"WALLET_CONNECT_REQUESTED"});
  state=reduceDemoState(state,{type:"WALLET_READY",account});
  return state;
}

test("serializes wallet connection before accepting the selected account",()=>{
  let state=initialDemoState();
  state=reduceDemoState(state,{type:"CAPABILITY_AVAILABLE"});
  state=reduceDemoState(state,{type:"WALLET_CONNECT_REQUESTED"});
  assert.equal(state.phase,"WALLET_CONNECTING");
  assert.throws(()=>reduceDemoState(state,{type:"WALLET_CONNECT_REQUESTED"}),/invalid demo transition/);
  state=reduceDemoState(state,{type:"WALLET_READY",account});
  assert.deepEqual(state,{phase:"READY",account});
});

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

test("only later coordinator execution evidence can resolve a displayed incident",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  state=reduceDemoState(state,{type:"SOURCE_SUBMITTED",transactionHash});
  state=reduceDemoState(state,{type:"GUID_OBSERVED",transactionHash,guid});
  state=reduceDemoState(state,{type:"COORDINATOR_INCIDENT",code:"LOCAL_EXECUTION_RECOVERY_REQUIRED"});
  assert.equal(state.phase,"SENTINEL_INCIDENT");
  assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
  state=reduceDemoState(state,{type:"COORDINATOR_STAGE",stage:"EXECUTED"});
  assert.equal(state.phase,"SENTINEL_EXECUTED");
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

test("wallet invalidation cannot erase a submitted transaction or observed GUID",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  state=reduceDemoState(state,{type:"SOURCE_SUBMITTED",transactionHash});
  assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
  state=reduceDemoState(state,{type:"GUID_OBSERVED",transactionHash,guid});
  assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
});

test("wallet invalidation cannot preempt an in-flight source confirmation",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  assert.equal(state.phase,"WALLET_CONFIRMATION");
  assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
});

test("a failed submit preflight unlocks the wallet without inventing a transaction",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"SEND_REQUESTED"});
  state=reduceDemoState(state,{type:"SOURCE_PREFLIGHT_FAILED",code:"WRONG_CHAIN"});
  assert.deepEqual(state,{phase:"WRONG_CHAIN",errorCode:"WRONG_CHAIN"});
});

test("a terminal demo result cannot be reset for a second source action",()=>{
  let pending=ready();
  pending=reduceDemoState(pending,{type:"QUOTE_REQUESTED"});
  pending=reduceDemoState(pending,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  pending=reduceDemoState(pending,{type:"SEND_REQUESTED"});
  pending=reduceDemoState(pending,{type:"SOURCE_SUBMITTED",transactionHash});
  pending=reduceDemoState(pending,{type:"GUID_OBSERVED",transactionHash,guid});
  const terminalStates=[
    reduceDemoState(pending,{type:"COORDINATOR_STAGE",stage:"EXECUTED"}),
    reduceDemoState(pending,{type:"COORDINATOR_STAGE",stage:"REJECTED"}),
    reduceDemoState(pending,{type:"COORDINATOR_INCIDENT",code:"DESTINATION_DELIVERY_FAILED"})
  ];
  for(const state of terminalStates)
    assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
});

test("input changes discard only the quote while wallet failures and mined-source failures stay explicit",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  state=reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"});
  state=reduceDemoState(state,{type:"INPUT_CHANGED"});
  assert.deepEqual(state,{phase:"READY",account});

  state=initialDemoState("WALLET_REQUIRED");
  state=reduceDemoState(state,{type:"WALLET_CONNECT_REQUESTED"});
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

test("input changes cancel an in-flight quote before a stale result can be accepted",()=>{
  let state=ready();
  state=reduceDemoState(state,{type:"QUOTE_REQUESTED"});
  assert.equal(state.phase,"QUOTING");
  state=reduceDemoState(state,{type:"INPUT_CHANGED"});
  assert.deepEqual(state,{phase:"READY",account});
  assert.throws(
    ()=>reduceDemoState(state,{type:"QUOTE_READY",nativeFee:"1000000000000"}),
    /invalid demo transition/
  );
});
