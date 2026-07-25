export type DemoPhase=
  |"DISABLED"|"WALLET_REQUIRED"|"WALLET_CONNECTING"|"WALLET_FAILED"|"WRONG_CHAIN"|"WRONG_OWNER"
  |"READY"|"QUOTING"|"QUOTE_FAILED"
  |"QUOTED"|"WALLET_CONFIRMATION"|"USER_REJECTED"|"SOURCE_REVERTED"
  |"SOURCE_FAILED"|"SUBMITTED"|"COORDINATOR_PENDING"|"POLICY_REJECTED"
  |"SENTINEL_EXECUTED"|"SENTINEL_INCIDENT";

export interface DemoState {
  phase:DemoPhase;
  account?:string;
  nativeFee?:string;
  transactionHash?:string;
  guid?:string;
  errorCode?:string;
  coordinatorStage?:string;
}

export type DemoEvent=
  |{type:"CAPABILITY_AVAILABLE"}
  |{type:"WALLET_CONNECT_REQUESTED"}
  |{type:"WALLET_READY";account:string}
  |{type:"WALLET_FAILED";code:string}
  |{type:"INPUT_CHANGED"}
  |{type:"QUOTE_REQUESTED"}
  |{type:"QUOTE_READY";nativeFee:string}
  |{type:"QUOTE_FAILED";code:string}
  |{type:"SEND_REQUESTED"}
  |{type:"SOURCE_SUBMITTED";transactionHash:string}
  |{type:"SOURCE_PREFLIGHT_FAILED";code:string}
  |{type:"SOURCE_FAILED";code:string}
  |{type:"GUID_OBSERVED";transactionHash:string;guid:string}
  |{type:"COORDINATOR_STAGE";stage:string}
  |{type:"COORDINATOR_INCIDENT";code:string}
  |{type:"INVALIDATED"}
  |{type:string;[key:string]:unknown};

const addressPattern=/^0x[0-9a-fA-F]{40}$/;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
const pendingStages=new Set([
  "DETECTED","CONFIRMING","CONFIRMED","DETERMINISTIC_VERIFIED",
  "POLICY_PENDING","POLICY_FINALIZED","SIGNING","QUORUM_REACHED",
  "SUBMITTING","VERIFIED"
]);

export function initialDemoState(phase:DemoPhase="DISABLED"):DemoState{return{phase}}

export function reduceDemoState(state:DemoState,event:DemoEvent):DemoState {
  if(event.type==="INVALIDATED"){
    if(state.phase==="WALLET_CONFIRMATION"||state.transactionHash)return state;
    return initialDemoState("WALLET_REQUIRED");
  }
  if(state.phase==="DISABLED"&&event.type==="CAPABILITY_AVAILABLE")
    return initialDemoState("WALLET_REQUIRED");
  if(state.phase==="WALLET_REQUIRED"&&event.type==="WALLET_CONNECT_REQUESTED")
    return initialDemoState("WALLET_CONNECTING");
  if(state.phase==="WALLET_CONNECTING"&&event.type==="WALLET_READY"&&validAddress(event.account))
    return{phase:"READY",account:event.account.toLowerCase()};
  if(state.phase==="WALLET_CONNECTING"&&event.type==="WALLET_FAILED"&&validWalletFailureCode(event.code))
    return{phase:event.code==="WRONG_CHAIN"||event.code==="WRONG_OWNER"?event.code:"WALLET_FAILED",errorCode:event.code};
  if((state.phase==="READY"||state.phase==="QUOTING"||state.phase==="QUOTED"||state.phase==="QUOTE_FAILED")&&
    event.type==="INPUT_CHANGED"&&state.account)
    return{phase:"READY",account:state.account};
  if(state.phase==="READY"&&event.type==="QUOTE_REQUESTED"&&state.account)
    return{phase:"QUOTING",account:state.account};
  if(state.phase==="QUOTING"&&event.type==="QUOTE_READY"&&state.account&&validFee(event.nativeFee))
    return{phase:"QUOTED",account:state.account,nativeFee:event.nativeFee};
  if(state.phase==="QUOTING"&&event.type==="QUOTE_FAILED"&&validCode(event.code))
    return{phase:"QUOTE_FAILED",account:state.account,errorCode:event.code};
  if(state.phase==="QUOTED"&&event.type==="SEND_REQUESTED"&&state.account&&state.nativeFee)
    return{...state,phase:"WALLET_CONFIRMATION"};
  if(state.phase==="WALLET_CONFIRMATION"&&event.type==="SOURCE_PREFLIGHT_FAILED"&&
    (event.code==="WRONG_CHAIN"||event.code==="WRONG_OWNER"||event.code==="ACCOUNT_UNAVAILABLE"))
    return{phase:event.code==="ACCOUNT_UNAVAILABLE"?"WALLET_FAILED":event.code,errorCode:event.code};
  if(state.phase==="WALLET_CONFIRMATION"&&event.type==="SOURCE_SUBMITTED"&&validHash(event.transactionHash))
    return{...state,phase:"SUBMITTED",transactionHash:event.transactionHash.toLowerCase()};
  if(state.phase==="WALLET_CONFIRMATION"&&event.type==="SOURCE_FAILED"&&validSourceFailureCode(event.code))
    return{phase:event.code==="USER_REJECTED"?"USER_REJECTED":event.code==="SOURCE_REVERTED"?"SOURCE_REVERTED":"SOURCE_FAILED",account:state.account,errorCode:event.code};
  if(state.phase==="SUBMITTED"&&event.type==="SOURCE_FAILED"&&validSourceFailureCode(event.code))
    return{...state,phase:event.code==="SOURCE_REVERTED"?"SOURCE_REVERTED":"SOURCE_FAILED",errorCode:event.code};
  if(state.phase==="SUBMITTED"&&event.type==="GUID_OBSERVED"&&
    validHash(event.transactionHash)&&validHash(event.guid)&&
    state.transactionHash?.toLowerCase()===event.transactionHash.toLowerCase())
    return{...state,phase:"COORDINATOR_PENDING",guid:event.guid.toLowerCase()};
  if(state.phase==="COORDINATOR_PENDING"&&event.type==="COORDINATOR_STAGE"){
    if(event.stage==="REJECTED")return{...state,phase:"POLICY_REJECTED",coordinatorStage:event.stage};
    if(event.stage==="EXECUTED")return{...state,phase:"SENTINEL_EXECUTED",coordinatorStage:event.stage};
    if(typeof event.stage==="string"&&pendingStages.has(event.stage))
      return{...state,coordinatorStage:event.stage};
  }
  if(state.phase==="COORDINATOR_PENDING"&&event.type==="COORDINATOR_INCIDENT"&&validCode(event.code))
    return{...state,phase:"SENTINEL_INCIDENT",errorCode:event.code};
  if(state.phase==="SENTINEL_INCIDENT"&&event.type==="COORDINATOR_STAGE"&&event.stage==="EXECUTED")
    return{...state,phase:"SENTINEL_EXECUTED",coordinatorStage:"EXECUTED",errorCode:undefined};
  throw new Error("invalid demo transition");
}

function validAddress(value:unknown):value is string {
  return typeof value==="string"&&addressPattern.test(value)&&!/^0x0{40}$/i.test(value);
}
function validHash(value:unknown):value is string {
  return typeof value==="string"&&hashPattern.test(value)&&!/^0x0{64}$/i.test(value);
}
function validFee(value:unknown):value is string {
  return typeof value==="string"&&/^[1-9][0-9]*$/.test(value);
}
function validCode(value:unknown):value is string {
  return typeof value==="string"&&/^[A-Z][A-Z0-9_]{1,63}$/.test(value);
}
function validWalletFailureCode(value:unknown):value is string {
  return value==="WALLET_UNAVAILABLE"||value==="ACCOUNT_UNAVAILABLE"||
    value==="WRONG_CHAIN"||value==="WRONG_OWNER"||value==="CONFIG_INVALID";
}
function validSourceFailureCode(value:unknown):value is string {
  return value==="INSUFFICIENT_LOCAL_FUNDS"||value==="USER_REJECTED"||
    value==="SOURCE_REVERTED"||value==="SOURCE_RECEIPT_UNAVAILABLE"||
    value==="ACTION_EVENT_MISSING"||value==="ACTION_EVENT_AMBIGUOUS";
}
