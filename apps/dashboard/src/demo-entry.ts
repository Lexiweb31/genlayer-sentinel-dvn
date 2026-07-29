import {
  WalletActionClient,
  WalletActionError,
  parsePublicDemoConfig,
  subscribeInvalidation,
  type Eip1193Provider,
  type PreparedQuote,
  type PublicDemoConfig,
  type WalletSession
} from "./wallet-action.js";
import {
  initialDemoState,
  reduceDemoState,
  type DemoEvent,
  type DemoState
} from "./demo-state.js";
import {resolveDemoBootstrap} from "./demo-bootstrap.js";
import {
  writeDemoSession,
  type DemoSessionLocator,
  type StorageLike
} from "./demo-session.js";

const elements={
  workspace:required<HTMLElement>("demo-workspace"),
  status:required<HTMLElement>("demo-status"),
  connect:required<HTMLButtonElement>("demo-connect"),
  account:required<HTMLElement>("demo-account"),
  chain:required<HTMLElement>("demo-chain"),
  input:required<HTMLInputElement>("demo-record-label"),
  argument:required<HTMLElement>("demo-argument"),
  match:required<HTMLElement>("demo-match"),
  quote:required<HTMLButtonElement>("demo-quote"),
  fee:required<HTMLElement>("demo-fee"),
  send:required<HTMLButtonElement>("demo-send"),
  transaction:required<HTMLElement>("demo-transaction"),
  guid:required<HTMLElement>("demo-guid"),
  message:required<HTMLElement>("demo-message"),
  sourceOApp:required<HTMLElement>("demo-source-oapp"),
  destinationEid:required<HTMLElement>("demo-destination-eid"),
  target:required<HTMLElement>("demo-target"),
  signature:required<HTMLElement>("demo-signature")
};

let state=initialDemoState();
let config:PublicDemoConfig|undefined;
let client:WalletActionClient|undefined;
let session:WalletSession|undefined;
let prepared:PreparedQuote|undefined;
let cleanupProvider:()=>void=()=>{};
let pollHandle:number|undefined;
let quoteGeneration=0;
const demoStorage=browserSessionStorage();

elements.connect.addEventListener("click",()=>void connectWallet());
elements.quote.addEventListener("click",()=>void quoteAction());
elements.send.addEventListener("click",()=>void sendAction());
elements.input.addEventListener("input",()=>{
  quoteGeneration++;
  prepared=undefined;
  if(state.phase==="READY"||state.phase==="QUOTING"||state.phase==="QUOTED"||state.phase==="QUOTE_FAILED")
    transition({type:"INPUT_CHANGED"});
  else render();
});
window.addEventListener("pagehide",()=>{cleanupProvider();if(pollHandle!==undefined)window.clearTimeout(pollHandle)},{once:true});

void bootstrapDemo();

async function bootstrapDemo():Promise<void>{
  const result=await resolveDemoBootstrap(demoStorage,fetchCapability);
  if(result.kind==="DISABLED"){
    disable("The local wallet action capability is unavailable. Start the explicit local demo harness to enable it.");
    announceOperations("OPERATIONS_ALLOWED");
    return;
  }
  if(result.kind==="RESTORED_UNAVAILABLE"){
    showStoredIdentifiers(result.locator);
    transition({
      type:"ACTION_RESTORE_UNAVAILABLE",
      transactionHash:result.locator.transactionHash,
      guid:result.locator.guid
    });
    announceOperations("RESTORED_UNAVAILABLE");
    return;
  }
  config=result.config;
  showCapability(config);
  transition({type:"CAPABILITY_AVAILABLE"});
  if(result.kind==="RESUME"){
    transition({
      type:"ACTION_RESTORED",
      transactionHash:result.locator.transactionHash,
      guid:result.locator.guid
    });
    window.dispatchEvent(new CustomEvent("sentinel:guid-observed",{detail:{guid:result.locator.guid}}));
  }
  announceOperations("OPERATIONS_ALLOWED");
  if(result.kind==="RESUME")scheduleCoordinatorPoll(result.locator.guid,0);
}

async function fetchCapability():Promise<PublicDemoConfig>{
  const response=await fetch("/api/demo/config",{headers:{accept:"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error();
  return parsePublicDemoConfig(await response.json());
}

function showCapability(value:PublicDemoConfig):void{
  elements.input.value=value.approvedRecordLabel;
  elements.sourceOApp.textContent=value.sourceOApp;
  elements.destinationEid.textContent=String(value.destinationEid);
  elements.target.textContent=value.authorizedTarget;
  elements.signature.textContent=value.actionSignature;
}

function showStoredIdentifiers(value:DemoSessionLocator):void{
  elements.sourceOApp.textContent=value.sourceOApp;
  elements.destinationEid.textContent=String(value.destinationEid);
  elements.target.textContent="Unavailable";
  elements.signature.textContent="Unavailable";
}

function announceOperations(state:"OPERATIONS_ALLOWED"|"RESTORED_UNAVAILABLE"):void{
  window.dispatchEvent(new CustomEvent("sentinel:demo-bootstrap",{detail:{state}}));
}

async function connectWallet():Promise<void>{
  if(!config||state.phase==="WALLET_CONNECTING"||state.phase==="WALLET_CONFIRMATION"||state.transactionHash)return;
  quoteGeneration++;
  if(state.phase!=="WALLET_REQUIRED")transition({type:"INVALIDATED"});
  transition({type:"WALLET_CONNECT_REQUESTED"});
  const provider=(window as unknown as{ethereum?:Eip1193Provider}).ethereum;
  if(!provider){transition({type:"WALLET_FAILED",code:"WALLET_UNAVAILABLE"});return}
  try{
    client=new WalletActionClient(provider);
    session=await client.connect(config);
    cleanupProvider();
    cleanupProvider=subscribeInvalidation(provider,()=>{
      quoteGeneration++;
      session=undefined;prepared=undefined;transition({type:"INVALIDATED"});
    });
    transition({type:"WALLET_READY",account:session.account});
  }catch(error){transition({type:"WALLET_FAILED",code:walletCode(error)})}
}

async function quoteAction():Promise<void>{
  if(!config||!client||!session||state.phase!=="READY")return;
  const generation=++quoteGeneration,quotedSession=session,recordLabel=elements.input.value;
  transition({type:"QUOTE_REQUESTED"});
  try{
    const result=await client.quote(config,quotedSession,recordLabel);
    if(!quoteIsCurrent(generation,quotedSession,recordLabel))return;
    prepared=result;
    transition({type:"QUOTE_READY",nativeFee:prepared.nativeFee.toString()});
  }catch(error){
    if(!quoteIsCurrent(generation,quotedSession,recordLabel))return;
    prepared=undefined;
    transition({type:"QUOTE_FAILED",code:error instanceof WalletActionError?error.code:"QUOTE_REVERTED"});
  }
}

function quoteIsCurrent(generation:number,quotedSession:WalletSession,recordLabel:string):boolean{
  return generation===quoteGeneration&&state.phase==="QUOTING"&&session===quotedSession&&elements.input.value===recordLabel;
}

async function sendAction():Promise<void>{
  if(!config||!client||!session||!prepared||state.phase!=="QUOTED")return;
  transition({type:"SEND_REQUESTED"});
  try{
    const submission=await client.submit(config,session,prepared,transactionHash=>{
      transition({type:"SOURCE_SUBMITTED",transactionHash});
    });
    transition({type:"GUID_OBSERVED",transactionHash:submission.transactionHash,guid:submission.guid});
    writeDemoSession(demoStorage,config,submission);
    window.dispatchEvent(new CustomEvent("sentinel:guid-observed",{detail:{guid:submission.guid}}));
    scheduleCoordinatorPoll(submission.guid,0);
  }catch(error){
    const code=error instanceof WalletActionError?error.code:"SOURCE_RECEIPT_UNAVAILABLE";
    if(code==="WRONG_CHAIN"||code==="WRONG_OWNER"||code==="ACCOUNT_UNAVAILABLE"){
      session=undefined;prepared=undefined;transition({type:"SOURCE_PREFLIGHT_FAILED",code});
      return;
    }
    transition({type:"SOURCE_FAILED",code});
  }
}

function scheduleCoordinatorPoll(guid:string,delay:number):void{
  if(pollHandle!==undefined)window.clearTimeout(pollHandle);
  pollHandle=window.setTimeout(()=>void pollCoordinator(guid),delay);
}

async function pollCoordinator(guid:string):Promise<void>{
  if(isTerminal(state.phase))return;
  try{
    const response=await fetch(`/api/jobs/${guid}`,{headers:{accept:"application/json"},cache:"no-store"});
    if(response.status===404){
      setMessage("The matching harness has not ingested this GUID yet. Sentinel will keep checking without resending.");
      scheduleCoordinatorPoll(guid,1000);
      return;
    }
    if(!response.ok)throw new Error();
    const job=await response.json() as unknown;
    const stage=boundJobStage(job,guid);
    if(state.phase!=="SENTINEL_INCIDENT"||stage==="EXECUTED")transition({type:"COORDINATOR_STAGE",stage});
    if(isTerminal(state.phase))return;
    const deliveriesResponse=await fetch("/api/deliveries",{headers:{accept:"application/json"},cache:"no-store"});
    if(!deliveriesResponse.ok)throw new Error();
    const deliveries=await deliveriesResponse.json() as unknown;
    const incident=deliveryIncident(deliveries,guid);
    if(incident){
      if(state.phase!=="SENTINEL_INCIDENT")transition({type:"COORDINATOR_INCIDENT",code:incident});
      scheduleCoordinatorPoll(guid,1000);return;
    }
    scheduleCoordinatorPoll(guid,1000);
  }catch{
    setMessage("Coordinator status is temporarily unavailable. The source transaction will not be resent.",true);
    scheduleCoordinatorPoll(guid,2000);
  }
}

function transition(event:DemoEvent):void{
  state=reduceDemoState(state,event);
  render();
}

function render():void{
  const sourceActionLocked=state.phase==="WALLET_CONFIRMATION"||Boolean(state.transactionHash);
  elements.status.textContent=state.phase.replaceAll("_"," ");
  elements.status.className=`status ${isSuccess(state.phase)?"live":isFailure(state.phase)?"bad":""}`;
  elements.connect.disabled=!config||state.phase==="WALLET_CONNECTING"||sourceActionLocked;
  elements.input.disabled=!config||sourceActionLocked;
  elements.quote.disabled=state.phase!=="READY";
  elements.send.disabled=state.phase!=="QUOTED";
  elements.account.textContent=state.account??"Not connected";
  elements.chain.textContent=state.account?"31337 · owner verified":"Not checked";
  elements.argument.textContent=prepared?.argument??"—";
  elements.match.textContent=prepared&&config?(prepared.argument===config.approvedArgument?"Exact fixture authorization":"Semantic mismatch · expected denial"):"Not evaluated";
  elements.fee.textContent=state.nativeFee?`${state.nativeFee} wei`:"—";
  elements.transaction.textContent=state.transactionHash??"—";
  elements.guid.textContent=state.guid??"—";
  setMessage(phaseMessage(state));
}

function phaseMessage(value:DemoState):string{
  if(value.errorCode)return codeMessage(value.errorCode);
  switch(value.phase){
    case"DISABLED":return"The wallet action is disabled.";
    case"RESTORED_UNAVAILABLE":return"Saved public transaction and GUID retained. The current local harness cannot be verified, so Sentinel will not poll or resend.";
    case"WALLET_REQUIRED":return"Connect wallet to verify local chain 31337 and the source OApp owner.";
    case"WALLET_CONNECTING":return"Waiting for the wallet account, local chain, and source OApp owner checks.";
    case"READY":return"Wallet verified. Quote the immutable action before submitting.";
    case"QUOTING":return"Reading the LayerZero native fee from the source OApp.";
    case"QUOTED":return"Fee quoted. Review the fixed action boundary before wallet confirmation.";
    case"WALLET_CONFIRMATION":return"Confirm once in your wallet. Sentinel never receives the wallet key.";
    case"SUBMITTED":return"Source transaction submitted. Waiting for a successful mined receipt.";
    case"COORDINATOR_PENDING":return value.restored
      ?"Saved public locator restored. Loading authoritative coordinator evidence; no wallet request or source resend occurred."
      :"Packet emitted; Sentinel decision pending";
    case"POLICY_REJECTED":return"Fixture policy finalized DENY. No signer quorum or destination submission is authorized. Start a fresh harness for another action.";
    case"SENTINEL_EXECUTED":return"Coordinator confirms signer quorum, DVN adapter verification, and destination OApp execution. Start a fresh harness for another action.";
    case"SENTINEL_INCIDENT":return"Coordinator reports a destination delivery incident. Operator recovery is required; this action cannot be resent.";
    default:return"Local demo state requires attention.";
  }
}

function codeMessage(code:string):string{
  const messages:Record<string,string>={
    WALLET_UNAVAILABLE:"No injected wallet is available.",
    ACCOUNT_UNAVAILABLE:"The wallet did not provide one account.",
    WRONG_CHAIN:"Switch the wallet to the isolated local chain 31337.",
    WRONG_OWNER:"The selected account is not the configured source OApp owner.",
    CONFIG_INVALID:"The action configuration failed strict validation.",
    QUOTE_REVERTED:"The source OApp rejected the fee quote.",
    INSUFFICIENT_LOCAL_FUNDS:"The local account could not submit the source transaction.",
    USER_REJECTED:"The wallet request was rejected. No transaction was sent.",
    SOURCE_REVERTED:"The source transaction reverted. Sentinel did not approve an action.",
    SOURCE_RECEIPT_UNAVAILABLE:"The source receipt could not be confirmed. The transaction will not be resent.",
    ACTION_EVENT_MISSING:"The mined receipt did not contain the bound ActionSent event.",
    ACTION_EVENT_AMBIGUOUS:"The mined receipt contained ambiguous ActionSent evidence."
  };
  return messages[code]??"Sentinel stopped on a sanitized local-demo error.";
}

function setMessage(message:string,failed=isFailure(state.phase)):void{
  elements.message.textContent=message;
  elements.message.className=`notice demo-message ${failed?"bad":isSuccess(state.phase)?"good":""}`;
}

function disable(message:string):void{
  state=initialDemoState();
  elements.workspace.dataset.enabled="false";
  elements.connect.disabled=true;elements.input.disabled=true;elements.quote.disabled=true;elements.send.disabled=true;
  elements.status.textContent="DISABLED";
  elements.status.className="status";
  setMessage(message);
}

function boundJobStage(value:unknown,guid:string):string{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();
  const record=value as{stage?:unknown;packet?:unknown};
  if(typeof record.stage!=="string"||!record.packet||typeof record.packet!=="object"||Array.isArray(record.packet))throw new Error();
  const packet=record.packet as{guid?:unknown};
  if(typeof packet.guid!=="string"||packet.guid.toLowerCase()!==guid.toLowerCase())throw new Error();
  const stages=new Set(["DETECTED","CONFIRMED","POLICY_PENDING","POLICY_FINALIZED","QUORUM_REACHED","VERIFIED","EXECUTED","REJECTED"]);
  if(!stages.has(record.stage))throw new Error();
  return record.stage;
}

function deliveryIncident(value:unknown,guid:string):string|undefined{
  if(!Array.isArray(value))throw new Error();
  const record=value.find(item=>item&&typeof item==="object"&&!Array.isArray(item)&&
    typeof(item as{guid?:unknown}).guid==="string"&&
    ((item as{guid:string}).guid.toLowerCase()===guid.toLowerCase())) as{state?:unknown;failureCode?:unknown;executionFailureCode?:unknown}|undefined;
  if(!record)return undefined;
  if(typeof record.executionFailureCode==="string"&&/^[A-Z][A-Z0-9_]{1,63}$/.test(record.executionFailureCode))return record.executionFailureCode;
  if(record.state!=="FAILED"&&record.state!=="RECOVERY_REQUIRED")return undefined;
  return typeof record.failureCode==="string"&&/^[A-Z][A-Z0-9_]{1,63}$/.test(record.failureCode)?record.failureCode:"DESTINATION_DELIVERY_FAILED";
}

function walletCode(error:unknown):string{
  return error instanceof WalletActionError?error.code:"WALLET_UNAVAILABLE";
}
function isTerminal(phase:string):boolean{return phase==="POLICY_REJECTED"||phase==="SENTINEL_EXECUTED"}
function isSuccess(phase:string):boolean{return phase==="READY"||phase==="QUOTED"||phase==="SENTINEL_EXECUTED"}
function isFailure(phase:string):boolean{return phase==="RESTORED_UNAVAILABLE"||phase==="WALLET_FAILED"||phase==="WRONG_CHAIN"||phase==="WRONG_OWNER"||phase==="QUOTE_FAILED"||phase==="USER_REJECTED"||phase==="SOURCE_REVERTED"||phase==="SOURCE_FAILED"||phase==="POLICY_REJECTED"||phase==="SENTINEL_INCIDENT"}
function browserSessionStorage():StorageLike|undefined{
  try{return window.sessionStorage}catch{return undefined}
}
function required<T extends HTMLElement>(id:string):T{
  const value=document.getElementById(id);
  if(!value)throw new Error(`missing dashboard target ${id}`);
  return value as T;
}
