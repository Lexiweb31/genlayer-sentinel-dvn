import {deliveryTimelineIndex,verificationSummary} from "./timeline.js";
import {renderRuntimeStatus,renderRuntimeUnavailable,validateRuntimeStatus} from "./runtime-status.js";
import {createPathwayAuditFileController} from "./pathway-audit.js";
export function normalizeConsoleQuery(value){
  return String(value??"").trim().toLowerCase();
}
export function matchesConsoleQuery(job,query){
  const haystack=[job.packet.guid,job.packet.txHash,job.packet.srcEid,job.packet.dstEid,job.stage]
    .filter(value=>value!=null).join(" ").toLowerCase();
  return query===""||haystack.includes(query);
}
export function createConsoleSelectionModel(initialGuid){
  let selectedGuid=typeof initialGuid==="string"&&initialGuid?initialGuid:undefined,observedGuid,explicitSelection=selectedGuid!==undefined;
  return{
    get selectedGuid(){return selectedGuid},
    get observedGuid(){return observedGuid},
    selectManual(guid){selectedGuid=guid;observedGuid=undefined;explicitSelection=true},
    selectObserved(guid){if(explicitSelection)return;selectedGuid=guid;observedGuid=guid.toLowerCase()},
    resolve(jobs){
      if(selectedGuid!==undefined){
        const job=jobs.find(item=>sameGuid(item.packet.guid,selectedGuid));
        return job?{state:"selected",job}:{state:"unavailable",guid:selectedGuid};
      }
      const job=jobs.at(-1);
      if(!job)return{state:"empty"};
      selectedGuid=job.packet.guid;
      return{state:"selected",job};
    }
  };
}
const stages=["Packet detected","RPC confirmations","Semantic evaluation","Policy finality","Signing intent","Signer quorum","Destination submission","DVN adapter verification","OApp execution"],stageIndex={DETECTED:0,CONFIRMED:1,POLICY_PENDING:2,POLICY_FINALIZED:3,QUORUM_REACHED:5,VERIFIED:7,EXECUTED:8,REJECTED:3};
const timeline=document.querySelector("#timeline"),status=document.querySelector("#connection-status"),notice=document.querySelector("#live-notice"),select=document.querySelector("#job-select"),inspector=document.querySelector("#inspector"),consoleSearch=document.querySelector("#console-search"),messageList=document.querySelector("#message-list"),consoleEmpty=document.querySelector("#console-empty"),refreshed=document.querySelector("#refresh-time"),runtimeMode=document.querySelector("#runtime-mode");
const consoleParams=new URLSearchParams(location.search),initialConsoleQuery=normalizeConsoleQuery(consoleParams.get("q")),initialConsoleGuid=consoleParams.get("guid");
const runtimeElements={badge:document.querySelector("#runtime-status-badge"),lifecycle:document.querySelector("#runtime-lifecycle"),lease:document.querySelector("#runtime-lease"),phase:document.querySelector("#runtime-phase"),heartbeat:document.querySelector("#runtime-heartbeat"),lastTick:document.querySelector("#runtime-last-tick"),recoveryPosture:document.querySelector("#runtime-recovery-posture")};
const fileInput=document.querySelector("#pathway-audit-file"),inspectButton=document.querySelector("#pathway-audit-inspect"),pathwayStatus=document.querySelector("#pathway-audit-status"),loadEvidenceButton=document.querySelector("#pathway-audit-load"),uploadEvidenceButton=document.querySelector("#pathway-audit-upload");
const pathwayElements={status:document.querySelector("#pathway-audit-result"),truthLabel:document.querySelector("#pathway-audit-truth-label"),observedAt:document.querySelector("#pathway-audit-observed-at"),evidenceDigest:document.querySelector("#pathway-audit-evidence-digest"),configurationDigest:document.querySelector("#pathway-audit-configuration-digest"),sourceBlock:document.querySelector("#pathway-audit-source-block"),destinationBlock:document.querySelector("#pathway-audit-destination-block"),blockers:document.querySelector("#pathway-audit-blockers"),notice:document.querySelector("#pathway-audit-notice")};
const walletConnect=document.querySelector("#wallet-connect"),walletAccount=document.querySelector("#wallet-account"),testnetReadinessCheck=document.querySelector("#testnet-readiness-check"),testnetReadinessStatus=document.querySelector("#testnet-readiness-status"),layerzeroEndpointCheck=document.querySelector("#layerzero-endpoint-check"),layerzeroEndpointStatus=document.querySelector("#layerzero-endpoint-status");
const walletProvider=window.ethereum;
const ethereumSepoliaChainId="0xaa36a7";
const arbitrumSepoliaChainId="0x66eee";
const endpointV2Address="0x6EDCE65403992e310A62460808c4b910D972f10f";
let connectedWalletAccount;
const walletShort=value=>`${value.slice(0,6)}…${value.slice(-4)}`;
function walletState(message,connected=false){
  if(!walletAccount||!walletConnect)return;
  walletAccount.textContent=message;
  walletConnect.textContent=connected?"Wallet connected":"Connect wallet";
  walletConnect.disabled=false;
}
function readinessState(message){if(testnetReadinessStatus)testnetReadinessStatus.textContent=message}
function endpointState(message){if(layerzeroEndpointStatus)layerzeroEndpointStatus.textContent=message}
async function refreshWalletAccount(accounts){
  if(!Array.isArray(accounts)||typeof accounts[0]!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0])){connectedWalletAccount=undefined;walletState("Wallet not connected");readinessState("Testnet balances not checked");return}
  connectedWalletAccount=accounts[0];
  try{
    const chain=await walletProvider.request({method:"eth_chainId"});
    const network=chain===ethereumSepoliaChainId?"Ethereum Sepolia":typeof chain==="string"?`Switch to Ethereum Sepolia (${chain})`:"network unknown";
    walletState(`${walletShort(accounts[0])} · ${network}`,true);
  }catch{walletState(`${walletShort(accounts[0])} · network unavailable`,true)}
}
async function connectReadOnlyWallet(){
  if(!walletProvider||typeof walletProvider.request!=="function"){walletState("No browser wallet found");return}
  walletConnect.disabled=true;walletConnect.textContent="Connecting…";
  try{
    const accounts=await walletProvider.request({method:"eth_requestAccounts"});
    await walletProvider.request({method:"wallet_switchEthereumChain",params:[{chainId:ethereumSepoliaChainId}]});
    await refreshWalletAccount(accounts);
  }catch{walletState("Connected wallet needs Ethereum Sepolia")}
}
function formatTestEth(value){
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]+$/.test(value))throw new Error();
  const wei=BigInt(value),whole=wei/1000000000000000000n,fraction=(wei%1000000000000000000n).toString().padStart(18,"0").slice(0,5).replace(/0+$/,"");
  return `${whole}${fraction?`.${fraction}`:""} ETH`;
}
async function readTestnetBalance(chainId,label){
  await walletProvider.request({method:"wallet_switchEthereumChain",params:[{chainId}]});
  const value=await walletProvider.request({method:"eth_getBalance",params:[connectedWalletAccount,"latest"]});
  return `${label}: ${formatTestEth(value)}`;
}
async function checkTestnetReadiness(){
  if(!walletProvider?.request){readinessState("No browser wallet found");return}
  if(!connectedWalletAccount){await connectReadOnlyWallet();if(!connectedWalletAccount)return}
  testnetReadinessCheck.disabled=true;testnetReadinessCheck.textContent="Checking…";readinessState("Checking Sepolia and Arbitrum Sepolia balances…");
  try{
    const sepolia=await readTestnetBalance(ethereumSepoliaChainId,"Sepolia");
    const arbitrum=await readTestnetBalance(arbitrumSepoliaChainId,"Arbitrum Sepolia");
    readinessState(`${sepolia} · ${arbitrum}`);
    await refreshWalletAccount([connectedWalletAccount]);
  }catch{readinessState("Could not read both testnet balances")}
  finally{testnetReadinessCheck.disabled=false;testnetReadinessCheck.textContent="Check testnet funds"}
}
async function readEndpointCode(chainId,label){
  await walletProvider.request({method:"wallet_switchEthereumChain",params:[{chainId}]});
  const code=await walletProvider.request({method:"eth_getCode",params:[endpointV2Address,"latest"]});
  if(typeof code!=="string"||!/^0x[0-9a-fA-F]+$/.test(code))throw new Error("endpoint code missing");
  return `${label}: code detected`;
}
async function checkLayerZeroEndpointCode(){
  if(!walletProvider?.request){endpointState("No browser wallet found");return}
  if(!connectedWalletAccount){await connectReadOnlyWallet();if(!connectedWalletAccount)return}
  layerzeroEndpointCheck.disabled=true;layerzeroEndpointCheck.textContent="Verifying…";endpointState("Checking configured EndpointV2 code on both testnets…");
  try{
    const sepolia=await readEndpointCode(ethereumSepoliaChainId,"Ethereum Sepolia");
    const arbitrum=await readEndpointCode(arbitrumSepoliaChainId,"Arbitrum Sepolia");
    endpointState(`${sepolia} · ${arbitrum} · code presence only`);
    await refreshWalletAccount([connectedWalletAccount]);
  }catch{endpointState("Could not read configured EndpointV2 code on both testnets")}
  finally{layerzeroEndpointCheck.disabled=false;layerzeroEndpointCheck.textContent="Verify LZ endpoints"}
}
if(walletConnect){
  walletConnect.addEventListener("click",()=>void connectReadOnlyWallet());
  if(walletProvider?.request){
    void walletProvider.request({method:"eth_accounts"}).then(refreshWalletAccount).catch(()=>walletState("Wallet not connected"));
    walletProvider.on?.("accountsChanged",refreshWalletAccount);
    walletProvider.on?.("chainChanged",()=>void walletProvider.request({method:"eth_accounts"}).then(refreshWalletAccount).catch(()=>walletState("Wallet not connected")));
  }
}
if(testnetReadinessCheck)testnetReadinessCheck.addEventListener("click",()=>void checkTestnetReadiness());
if(layerzeroEndpointCheck)layerzeroEndpointCheck.addEventListener("click",()=>void checkLayerZeroEndpointCode());
for(const button of[loadEvidenceButton,uploadEvidenceButton])button.addEventListener("click",()=>fileInput.click());
const pathwayController=createPathwayAuditFileController({fileInput,inspectButton,status:pathwayStatus,elements:pathwayElements,formatTime:value=>new Date(value).toLocaleString()});
window.addEventListener("pagehide",()=>pathwayController.dispose(),{once:true});
const consoleSelection=createConsoleSelectionModel(initialConsoleGuid);
let jobs=[],deliveryByGuid=new Map(),pollingStarted=false,consoleQuery=initialConsoleQuery;
consoleSearch.value=consoleQuery;
const short=value=>typeof value==="string"&&value.length>22?`${value.slice(0,10)}…${value.slice(-8)}`:String(value??"—");
const text=(parent,label,value)=>{const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=String(value??"—");dd.title=String(value??"");parent.append(dt,dd)};
function renderTimeline(job){const delivery=deliveryByGuid.get(job.packet.guid.toLowerCase()),deliveryIndex=deliveryTimelineIndex(delivery),current=Math.max(stageIndex[job.stage]??0,deliveryIndex??0),incident=job.stage==="REJECTED"||delivery?.state==="FAILED"||delivery?.state==="RECOVERY_REQUIRED"||delivery?.executionFailureCode;timeline.replaceChildren(...stages.map((label,index)=>{const el=document.createElement("div");el.className=`step ${index<current?"complete":index===current?(incident?"rejected":"current"):""}`;const n=document.createElement("span");n.textContent=String(index+1).padStart(2,"0");const box=document.createElement("div"),strong=document.createElement("strong"),small=document.createElement("small");strong.textContent=label;small.textContent=index<current?"Complete":index===current?(delivery&&deliveryIndex===current?(delivery.executionFailureCode?"execution recovery required":delivery.state.replaceAll("_"," ").toLowerCase()):job.stage==="REJECTED"?"Rejected":job.stage.replaceAll("_"," ").toLowerCase()):"Not started";box.append(strong,small);el.append(n,box);return el}))}
function renderInspector(job){inspector.hidden=false;const packet=document.querySelector("#packet-details");packet.replaceChildren();for(const [label,value] of [["GUID",job.packet.guid],["Pathway",`${job.packet.srcEid} → ${job.packet.dstEid}`],["Nonce",job.packet.nonce],["Transaction",job.packet.txHash],["Block",`${job.packet.blockNumber} · ${short(job.packet.blockHash)}`],["Payload hash",job.packet.payloadHash],["Encoded payload",job.packet.encodedPayloadHash]])text(packet,label,value);
  const checks=document.querySelector("#verification-details");checks.replaceChildren();if(!job.verifications?.length){const empty=document.createElement("p");empty.className="empty";empty.textContent="No packet verification recorded.";checks.append(empty)}else for(const check of job.verifications){const card=document.createElement("div"),name=document.createElement("strong"),confirmations=document.createElement("b"),hash=document.createElement("small");name.textContent=check.provider;confirmations.textContent=`${check.confirmations} confirmations`;hash.textContent=verificationSummary(check,short);card.append(name,confirmations,hash);checks.append(card)}
  const policy=document.querySelector("#policy-details");policy.replaceChildren();const result=job.result;if(result){const engine=result.policyVersion==="local-demo-v1"||result.reasonCode?.startsWith("LOCAL_FIXTURE_")?"LOCAL_POLICY_FIXTURE":"GENLAYER FINALIZED RECORD";for(const [label,value] of [["Engine",engine],["Decision",result.decision],["Reason",result.reasonCode],["Policy version",result.policyVersion],["Evidence digest",result.evidenceDigest],["Finalized",new Date(result.finalizedAt*1000).toLocaleString()]])text(policy,label,value)}else text(policy,"Decision",job.stage==="POLICY_PENDING"?"Awaiting finalized semantic result":"Not requested");
  const signer=document.querySelector("#signer-details");signer.replaceChildren();const count=job.signers?.length??0,summary=document.createElement("p"),meter=document.createElement("div");summary.className="quorum";summary.textContent=`${count} of 3 target signatures recorded`;meter.className="meter";meter.setAttribute("aria-label",`${count} of 3 signatures`);for(let i=0;i<3;i++){const segment=document.createElement("i");if(i<count)segment.className="filled";meter.append(segment)}signer.append(summary,meter);for(const address of job.signers??[]){const item=document.createElement("code");item.textContent=address;signer.append(item)}
  const destination=document.querySelector("#destination-details"),delivery=deliveryByGuid.get(job.packet.guid.toLowerCase());destination.replaceChildren();if(delivery){for(const [label,value] of [["State",delivery.state],["Transaction",delivery.transactionHash],["Confirmations",delivery.confirmations],["Failure",delivery.executionFailureCode??delivery.failureCode],["Updated",new Date(delivery.updatedAt*1000).toLocaleString()]])text(destination,label,value)}else text(destination,"State","Not prepared")}
function render(job){renderTimeline(job);renderInspector(job);status.textContent=job.stage;status.className=`status ${job.stage==="REJECTED"?"bad":"live"}`;notice.textContent=`Live coordinator state · GUID ${short(job.packet.guid)}`}
function sameGuid(left,right){return typeof left==="string"&&typeof right==="string"&&left.toLowerCase()===right.toLowerCase()}
function replaceSelectedGuid(guid){const params=new URLSearchParams(location.search);params.set("guid",guid);const query=params.toString(),next=`${location.pathname}${query?`?${query}`:""}${location.hash}`;history.replaceState(null,"",next)}
function selectJob(job,{updateUrl=false,manual=false}={}){if(manual)consoleSelection.selectManual(job.packet.guid);select.value=consoleSelection.selectedGuid;if(updateUrl)replaceSelectedGuid(consoleSelection.selectedGuid);render(job);renderMessageList(jobs.filter(item=>matchesConsoleQuery(item,consoleQuery)))}
function messageObservedAt(job){return Number.isSafeInteger(job.evidence?.observedAt)?new Date(job.evidence.observedAt*1000).toLocaleString():"Not observed"}
function renderMessageList(visibleJobs){messageList.replaceChildren(...visibleJobs.map(job=>{const row=document.createElement("tr");row.className="message-row";row.setAttribute("aria-current",sameGuid(job.packet.guid,consoleSelection.selectedGuid)?"true":"false");for(const [value,kind] of [[job.packet.srcEid,"origin"],[job.packet.dstEid,"destination"],[job.packet.guid,"identifier"],[messageObservedAt(job),"observed"],[job.stage,"stage"]]){const cell=document.createElement("td");if(kind==="identifier"){const button=document.createElement("button");button.type="button";button.textContent=short(value);button.title=String(value);button.setAttribute("aria-label",`Inspect packet ${value}`);button.addEventListener("click",()=>selectJob(job,{updateUrl:true,manual:true}));cell.append(button)}else{cell.textContent=String(value??"—");if(kind==="stage")cell.className="message-stage"}row.append(cell)}return row}))}
function showEmpty(message,state="NO PACKETS DETECTED"){messageList.replaceChildren();timeline.replaceChildren();inspector.hidden=true;consoleEmpty.hidden=false;consoleEmpty.textContent=message;select.disabled=true;status.textContent=state;status.className="status"}
function showSelectionUnavailable(){timeline.replaceChildren();inspector.hidden=true;consoleEmpty.hidden=false;consoleEmpty.textContent="Selected packet is not currently observed.";select.disabled=jobs.length===0;select.value="";status.textContent="SELECTION UNAVAILABLE";status.className="status bad"}
function populate(){const visibleJobs=jobs.filter(job=>matchesConsoleQuery(job,consoleQuery));renderMessageList(visibleJobs);select.replaceChildren(...visibleJobs.map(job=>{const option=document.createElement("option");option.value=job.packet.guid;option.textContent=`${short(job.packet.guid)} · ${job.stage}`;return option}));const resolution=consoleSelection.resolve(consoleSelection.selectedGuid===undefined?visibleJobs:jobs);if(resolution.state==="unavailable"){showSelectionUnavailable();return}if(!visibleJobs.length){showEmpty(consoleQuery?"No observed packet matches this query.":"No packets are currently observed.",consoleQuery?"NO QUERY MATCH":"NO PACKETS DETECTED");return}consoleEmpty.hidden=true;select.disabled=false;if(resolution.state==="selected")selectJob(resolution.job)}
function unavailable(message){showEmpty(message,"COORDINATOR UNAVAILABLE");status.className="status bad";notice.textContent=message}
async function refresh(){try{const response=await fetch("/api/jobs",{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error(`status ${response.status}`);jobs=await response.json();if(!Array.isArray(jobs))throw new Error("invalid response");refreshed.textContent=`Refreshed ${new Date().toLocaleTimeString()}`;populate();if(jobs.length===0&&consoleSelection.selectedGuid===undefined)notice.textContent="Coordinator connected. No packet jobs exist."}catch(error){unavailable(`No coordinator data: ${error.message}. No simulated state is shown.`)}}
const deadLetters=document.querySelector("#dead-letters"),quarantineStatus=document.querySelector("#quarantine-status"),deliveries=document.querySelector("#deliveries"),deliveryStatus=document.querySelector("#delivery-status"),recoveryActions=document.querySelector("#recovery-actions"),recoveryActionStatus=document.querySelector("#recovery-action-status");
async function refreshDeadLetters(){try{const response=await fetch("/api/dead-letters",{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error(`status ${response.status}`);const records=await response.json();if(!Array.isArray(records))throw new Error("invalid response");deadLetters.replaceChildren();quarantineStatus.textContent=records.length?`${records.length} QUARANTINED`:"CLEAR";quarantineStatus.className=`status ${records.length?"bad":"live"}`;if(!records.length){const empty=document.createElement("p");empty.className="empty";empty.textContent="No packets are durably quarantined.";deadLetters.append(empty);return}for(const record of records){const row=document.createElement("div");row.className="dead-letter";for(const value of[short(record.transactionHash),`Block ${record.blockNumber}`,`${record.attempts} attempts`,record.errorCode,new Date(record.lastFailedAt*1000).toLocaleString()]){const cell=document.createElement("span");cell.textContent=String(value);row.append(cell)}deadLetters.append(row)}}catch(error){quarantineStatus.textContent="UNAVAILABLE";quarantineStatus.className="status bad";deadLetters.replaceChildren();const message=document.createElement("p");message.className="empty";message.textContent=`No quarantine data: ${error.message}.`;deadLetters.append(message)}}
const deliveryDescriptions={SIGNING:"intent durable; collecting 3-of-5",READY:"quorum durable; awaiting submission",ATTEMPTING:"broadcast outcome pending",SUBMITTED:"awaiting configured confirmation checks",CONFIRMED:"adapter verification confirmed by configured checks",FAILED:"delivery failed",RECOVERY_REQUIRED:"operator reconciliation required"};
async function refreshDeliveries(){try{const response=await fetch("/api/deliveries",{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error(`status ${response.status}`);const records=await response.json();if(!Array.isArray(records))throw new Error("invalid response");deliveryByGuid=new Map(records.filter(record=>typeof record.guid==="string").map(record=>[record.guid.toLowerCase(),record]));const selected=jobs.find(job=>sameGuid(job.packet.guid,consoleSelection.selectedGuid));if(selected)render(selected);deliveries.replaceChildren();const incidents=records.filter(record=>record.state==="FAILED"||record.state==="RECOVERY_REQUIRED"||record.executionFailureCode).length;deliveryStatus.textContent=incidents?`${incidents} INCIDENT${incidents===1?"":"S"}`:records.length?`${records.length} TRACKED`:"EMPTY";deliveryStatus.className=`status ${incidents?"bad":"live"}`;if(!records.length){const empty=document.createElement("p");empty.className="empty";empty.textContent="No destination deliveries have been prepared.";deliveries.append(empty);return}for(const record of records){const incident=record.state==="FAILED"||record.state==="RECOVERY_REQUIRED"||record.executionFailureCode,row=document.createElement("div");row.className=`delivery-row ${incident?"incident":""}`;const description=record.executionFailureCode?"destination OApp execution recovery required":deliveryDescriptions[record.state]??"unknown state";for(const value of[short(record.guid),`${record.state} · ${description}`,short(record.transactionHash),record.confirmations?`${record.confirmations} confirmations`:"Not confirmed",record.executionFailureCode??record.failureCode??new Date(record.updatedAt*1000).toLocaleString()]){const cell=document.createElement("span");cell.textContent=String(value);row.append(cell)}deliveries.append(row)}}catch(error){deliveryStatus.textContent="UNAVAILABLE";deliveryStatus.className="status bad";deliveries.replaceChildren();const message=document.createElement("p");message.className="empty";message.textContent=`No delivery data: ${error.message}.`;deliveries.append(message)}}
async function refreshRecoveryActions(){try{const response=await fetch("/api/recovery-actions",{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error(`status ${response.status}`);const records=await response.json();if(!Array.isArray(records))throw new Error("invalid response");recoveryActions.replaceChildren();recoveryActionStatus.textContent=records.length?`${records.length} APPLIED`:"EMPTY";recoveryActionStatus.className="status live";if(!records.length){const empty=document.createElement("p");empty.className="empty";empty.textContent="No operator recovery action has been applied.";recoveryActions.append(empty);return}for(const record of records){const row=document.createElement("div");row.className="recovery-action";for(const value of[record.kind?.replaceAll("_"," "),short(record.subject),record.candidateTransactionHash===`0x${"0".repeat(64)}`?"Source requeue":short(record.candidateTransactionHash),"3 of 5 approvals",record.resultCode,new Date(record.appliedAt*1000).toLocaleString(),short(record.receiptHash)]){const cell=document.createElement("span");cell.textContent=String(value);row.append(cell)}recoveryActions.append(row)}}catch(error){recoveryActionStatus.textContent="UNAVAILABLE";recoveryActionStatus.className="status bad";recoveryActions.replaceChildren();const message=document.createElement("p");message.className="empty";message.textContent=`No recovery audit data: ${error.message}.`;recoveryActions.append(message)}}
async function refreshRuntime(){try{const response=await fetch("/health",{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error(`status ${response.status}`);const value=await response.json();if(value?.presentationMode==="LOCAL_TEST")runtimeMode.textContent="LOCAL TEST";else if(value?.presentationMode==="EXTERNAL_INJECTED")runtimeMode.textContent="EXTERNAL INJECTED";else throw new Error("invalid mode")}catch{runtimeMode.textContent="MODE UNAVAILABLE"}}
async function refreshRuntimeStatus(){try{const response=await fetch("/api/runtime-status",{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error(`status ${response.status}`);renderRuntimeStatus(runtimeElements,validateRuntimeStatus(await response.json()),value=>new Date(value*1000).toLocaleString())}catch{renderRuntimeUnavailable(runtimeElements)}}
consoleSearch.addEventListener("input",()=>{consoleQuery=normalizeConsoleQuery(consoleSearch.value);populate()});
select.addEventListener("change",()=>{const job=jobs.find(item=>sameGuid(item.packet.guid,select.value));if(job)selectJob(job,{updateUrl:true,manual:true})});
window.addEventListener("sentinel:guid-observed",event=>{const guid=event.detail?.guid;if(typeof guid!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(guid))return;consoleSelection.selectObserved(guid);const job=jobs.find(item=>sameGuid(item.packet.guid,consoleSelection.selectedGuid));if(job)selectJob(job);else showSelectionUnavailable()});
window.addEventListener("sentinel:demo-bootstrap",event=>{
  if(event.detail?.state==="OPERATIONS_ALLOWED")startPolling();
  else if(event.detail?.state==="RESTORED_UNAVAILABLE")showUnverifiedRestore();
});
function startPolling(){if(pollingStarted)return;pollingStarted=true;refreshRuntime();refreshRuntimeStatus();refresh();refreshDeadLetters();refreshDeliveries();refreshRecoveryActions();setInterval(refreshRuntime,5000);setInterval(refreshRuntimeStatus,5000);setInterval(refresh,5000);setInterval(refreshDeadLetters,5000);setInterval(refreshDeliveries,5000);setInterval(refreshRecoveryActions,5000)}
function showUnverifiedRestore(){runtimeMode.textContent="MODE UNVERIFIED";renderRuntimeUnavailable(runtimeElements);refreshed.textContent="Polling paused";unavailable("Coordinator polling is paused until the saved local harness identity can be verified. No simulated state is shown.");for(const [state,container,message] of[[quarantineStatus,deadLetters,"Quarantine polling paused."],[deliveryStatus,deliveries,"Delivery polling paused."],[recoveryActionStatus,recoveryActions,"Recovery-audit polling paused."]]){state.textContent="RESTORE UNVERIFIED";state.className="status bad";container.replaceChildren();const item=document.createElement("p");item.className="empty";item.textContent=message;container.append(item)}}
