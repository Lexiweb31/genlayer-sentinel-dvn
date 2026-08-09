const REJECTION="PATHWAY_AUDIT_ARTIFACT_REJECTED";
const TRUTH_LABEL="READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED";
const DIGEST=/^[a-f0-9]{64}$/;
const HASH=/^0x[a-f0-9]{64}$/;
const ADDRESS=/^0x[a-fA-F0-9]{40}$/;
const DECIMAL=/^(?:0|[1-9][0-9]*)$/;
const IDENTIFIER=/^[A-Za-z0-9](?:[A-Za-z0-9 ._:-]{0,126}[A-Za-z0-9])?$/;
const UINT64=(1n<<64n)-1n;
const KECCAK_ROTATIONS=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const KECCAK_ROUNDS=[
  0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,
  0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
  0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n
];
const FORBIDDEN_KEYS=new Set([
  "url","uri","rpcurl","websocket","privatekey","secret","mnemonic","seed","keystore","wallet",
  "credential","token","password","apikey","environment","cloud","signerkey","path","filepath",
  "filesystempath","databasepath","sqlitepath","cwd","homedir","packet","packetguid","rawpacket","guid",
  "payload","payloadhash","encodedpayload","message","nonce","sender","receiver","packetsent","genlayer",
  "genlayerdecision","decision","policy","finality","consensus","intelligentcontract","ghostcontract",
  "signershare","signershares","signature","signatures","execution","executionstate","executiondigest",
  "calldata","input","transactioninput","rawtransaction","destinationsubmission"
]);

const BLOCKERS={
  AUDIT_NETWORK_METADATA_MISMATCH:["INPUT_BINDING","RECHECK_NETWORK_AUDIT"],
  AUDIT_NETWORK_AUDIT_STALE:["INPUT_BINDING","RECHECK_NETWORK_AUDIT"],
  AUDIT_PROVIDER_EVIDENCE_MISSING:["RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"],
  AUDIT_PROVIDER_EVIDENCE_STALE:["RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"],
  AUDIT_PROVIDER_OPERATOR_DUPLICATED:["RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"],
  AUDIT_RPC_UNAVAILABLE:["RPC_CONSENSUS","REPLACE_RPC_TRANSPORT"],
  AUDIT_CHAIN_MISMATCH:["RPC_CONSENSUS","REPLACE_RPC_TRANSPORT"],
  AUDIT_BLOCK_DISAGREEMENT:["RPC_CONSENSUS","RETRY_AT_STABLE_BLOCK"],
  AUDIT_BLOCK_UNSTABLE:["RPC_CONSENSUS","RETRY_AT_STABLE_BLOCK"],
  AUDIT_PROVIDER_RESULT_DISAGREEMENT:["RPC_CONSENSUS","REPLACE_RPC_TRANSPORT"],
  AUDIT_CODE_MISSING:["CODE_IDENTITY","PIN_REVIEWED_CODE_IDENTITY"],
  AUDIT_CODE_IDENTITY_UNPROVEN:["CODE_IDENTITY","PIN_REVIEWED_CODE_IDENTITY"],
  AUDIT_DEPLOYMENT_EVIDENCE_MISSING:["CODE_IDENTITY","SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"],
  AUDIT_DEPLOYMENT_ARTIFACT_MISMATCH:["CODE_IDENTITY","SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"],
  AUDIT_PATHWAY_DEPLOYMENTS_MISSING:["PATHWAY_CONFIGURATION","SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"],
  AUDIT_DEFAULT_LIBRARY:["PATHWAY_CONFIGURATION","CONFIGURE_EXPLICIT_LIBRARIES"],
  AUDIT_INHERITED_ULN_CONFIG:["PATHWAY_CONFIGURATION","CONFIGURE_EXPLICIT_LIBRARIES"],
  AUDIT_UNSUPPORTED_EID:["PATHWAY_CONFIGURATION","CONFIGURE_MATCHING_ULN"],
  AUDIT_PEER_MISMATCH:["PATHWAY_CONFIGURATION","CORRECT_PEERS"],
  AUDIT_EXECUTOR_MISMATCH:["PATHWAY_CONFIGURATION","CORRECT_EXECUTOR"],
  AUDIT_DVN_ORDER_INVALID:["PATHWAY_CONFIGURATION","SELECT_INDEPENDENT_DVNS"],
  AUDIT_DVN_THRESHOLD_INVALID:["PATHWAY_CONFIGURATION","SELECT_INDEPENDENT_DVNS"],
  AUDIT_DVN_REVIEW_MISSING:["PATHWAY_CONFIGURATION","SELECT_INDEPENDENT_DVNS"],
  AUDIT_DEAD_DVN_PRESENT:["PATHWAY_CONFIGURATION","REMOVE_DEAD_DVN"],
  AUDIT_ULN_MISMATCH:["PATHWAY_CONFIGURATION","CONFIGURE_MATCHING_ULN"],
  AUDIT_SENTINEL_NOT_OPTIONAL:["PATHWAY_CONFIGURATION","CONFIGURE_SENTINEL_OPTIONAL"],
  AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER:["PATHWAY_CONFIGURATION","SELECT_INDEPENDENT_DVNS"],
  AUDIT_ADAPTER_BINDING_MISMATCH:["PATHWAY_CONFIGURATION","CORRECT_ADAPTER_BINDINGS"],
  AUDIT_SIGNER_MEMBERSHIP_MISMATCH:["PATHWAY_CONFIGURATION","CORRECT_SIGNER_MEMBERSHIP"]
};

const SOURCE_CODE_NAMES=["sourceEndpointV2","sourceSendUln302","sourceExecutor"];
const DESTINATION_CODE_NAMES=["destinationEndpointV2","destinationReceiveUln302"];

export async function validatePathwayAuditView(value){
  try{
    rejectUnsafeGraph(value,new Set());
    const bundle=await bundleValue(value);
    return publicView(bundle);
  }catch{throw rejected()}
}

export async function parsePathwayAuditViewText(text){
  try{
    const value=parseCanonicalJsonDocument(text);
    return await validatePathwayAuditView(value);
  }catch{throw rejected()}
}

export function renderPathwayAudit(elements,value,formatTime){
  elements.status.textContent=value.status;
  elements.truthLabel.textContent=value.truthLabel;
  elements.observedAt.textContent=formatTime(value.runTimestamp);
  elements.evidenceDigest.textContent=value.evidenceSha256;
  elements.configurationDigest.textContent=value.configurationSha256??"NOT OBSERVED";
  elements.sourceBlock.textContent=formatBlock(value.blocks.source);
  elements.destinationBlock.textContent=formatBlock(value.blocks.destination);
  elements.blockers.textContent=value.blockers.length?value.blockers.map(item=>`${item.code} · ${item.remediation}`).join("\n"):"NONE";
  elements.notice.textContent="VERIFIED LOCALLY · NOTHING UPLOADED";
}

export function renderPathwayAuditUnavailable(elements,reason){
  for(const element of Object.values(elements))element.textContent="";
  elements.status.textContent="NOT OBSERVED";
  elements.notice.textContent=reason;
}

export function createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime}){
  let selected=null,inFlightGeneration=null,generation=0,disposed=false,hasValidObservation=false;
  inspectButton.disabled=true;
  const forgetSelection=()=>{selected=null;inspectButton.disabled=true;fileInput.value=""};
  const active=token=>!disposed&&generation===token&&inFlightGeneration===token;
  const onChange=()=>{
    if(disposed)return;
    if(inFlightGeneration!==null){forgetSelection();status.textContent="INSPECTION IN PROGRESS";return}
    generation++;
    selected=fileInput.files?.length===1?fileInput.files[0]:null;
    inspectButton.disabled=selected===null;
    status.textContent=selected?"READY TO INSPECT":"NOT OBSERVED";
  };
  const onInspect=async()=>{
    if(disposed||inFlightGeneration!==null||!selected)return;
    let file=selected;
    forgetSelection();
    const token=++generation;inFlightGeneration=token;status.textContent="INSPECTION IN PROGRESS";
    let textPromise;
    try{textPromise=Promise.resolve(file.text())}catch(error){textPromise=Promise.reject(error)}
    file=null;
    let view;
    try{
      const text=await textPromise;if(!active(token))return;
      view=await parsePathwayAuditViewText(text);if(!active(token))return;
    }catch{
      if(!active(token))return;
      inFlightGeneration=null;
      if(hasValidObservation)elements.notice.textContent="ARTIFACT REJECTED";
      else renderPathwayAuditUnavailable(elements,"ARTIFACT REJECTED");
      status.textContent="ARTIFACT REJECTED";
      return;
    }
    inFlightGeneration=null;
    renderPathwayAudit(elements,view,formatTime);
    hasValidObservation=true;
    status.textContent="INSPECTED LOCALLY";
  };
  fileInput.addEventListener("change",onChange);
  inspectButton.addEventListener("click",onInspect);
  return{dispose(){if(disposed)return;disposed=true;generation++;inFlightGeneration=null;forgetSelection();fileInput.removeEventListener("change",onChange);inspectButton.removeEventListener("click",onInspect)}};
}

async function bundleValue(value){
  const root=record(value);
  exactKeys(root,[
    "schemaVersion","toolVersion","runTimestamp","status","truthLabel","repositoryBindingSha256",
    "rpcIndependence","providerAgreement","blocks","officialCode","deployments","source","destination",
    "configurationSha256","blockers","evidenceSha256"
  ]);
  if(field(root,"schemaVersion")!==1||field(root,"toolVersion")!=="sentinel-pathway-auditor/v1")fail();
  const runTimestamp=isoTimestamp(field(root,"runTimestamp"));
  const observation=await observationValue(root);
  const body={schemaVersion:1,toolVersion:"sentinel-pathway-auditor/v1",runTimestamp,...observation};
  const evidenceSha256=digest(field(root,"evidenceSha256"));
  if(evidenceSha256!==await sha256(canonicalJson(body)))fail();
  return{...body,evidenceSha256};
}

async function observationValue(root){
  const truthLabel=field(root,"truthLabel");if(truthLabel!==TRUTH_LABEL)fail();
  const blockers=blockerArray(field(root,"blockers"));
  if(canonicalJson(field(root,"blockers"))!==canonicalJson(blockers))fail();
  const status=statusValue(field(root,"status"));if(status!==statusFor(blockers))fail();
  const rpc=record(field(root,"rpcIndependence"));exactKeys(rpc,["source","destination"]);
  const agreement=record(field(root,"providerAgreement"));exactKeys(agreement,["source","destination"]);
  const blocks=record(field(root,"blocks"));exactKeys(blocks,["source","destination"]);
  const official=record(field(root,"officialCode"));exactKeys(official,["source","destination"]);
  const deploymentsRaw=field(root,"deployments"),sourceRaw=field(root,"source"),destinationRaw=field(root,"destination");
  const result={
    status,truthLabel,repositoryBindingSha256:digest(field(root,"repositoryBindingSha256")),
    rpcIndependence:{source:independence(field(rpc,"source")),destination:independence(field(rpc,"destination"))},
    providerAgreement:{source:agreementValue(field(agreement,"source")),destination:agreementValue(field(agreement,"destination"))},
    blocks:{source:nullable(blockValue,field(blocks,"source"),"11155111"),destination:nullable(blockValue,field(blocks,"destination"),"421614")},
    officialCode:{source:codeArray(field(official,"source"),SOURCE_CODE_NAMES),destination:codeArray(field(official,"destination"),DESTINATION_CODE_NAMES)},
    deployments:deploymentsRaw===null?null:deploymentsValue(deploymentsRaw),
    source:sourceRaw===null?null:sourcePath(sourceRaw),destination:destinationRaw===null?null:destinationPath(destinationRaw),
    configurationSha256:nullable(digest,field(root,"configurationSha256")),blockers
  };
  await assertObservationDigests(result);
  assertConsistentCompleteness(result);
  return result;
}

async function assertObservationDigests(value){
  const expectedConfiguration=value.source&&value.destination?await sha256(canonicalJson({destination:value.destination,source:value.source})):null;
  const expectedSource=value.blocks.source?await sha256(canonicalJson({
    block:value.blocks.source,deployments:value.deployments?{adapter:value.deployments.sourceAdapter,oapp:value.deployments.sourceOApp}:null,
    officialCode:value.officialCode.source,path:value.source
  })):null;
  const expectedDestination=value.blocks.destination?await sha256(canonicalJson({
    block:value.blocks.destination,deployments:value.deployments?{adapter:value.deployments.destinationAdapter,oapp:value.deployments.destinationOApp}:null,
    officialCode:value.officialCode.destination,path:value.destination
  })):null;
  if(value.configurationSha256!==expectedConfiguration||value.providerAgreement.source.resultSha256!==expectedSource||value.providerAgreement.destination.resultSha256!==expectedDestination)fail();
}

function assertConsistentCompleteness(value){
  if(value.status!=="OBSERVED_PATHWAY_CONSISTENT")return;
  if(value.rpcIndependence.source!=="OPERATOR_INDEPENDENCE_REVIEWED"||value.rpcIndependence.destination!=="OPERATOR_INDEPENDENCE_REVIEWED"||
    value.providerAgreement.source.state!=="TWO_TRANSPORTS_AGREE"||value.providerAgreement.destination.state!=="TWO_TRANSPORTS_AGREE"||
    value.providerAgreement.source.resultSha256===null||value.providerAgreement.destination.resultSha256===null||
    value.blocks.source===null||value.blocks.destination===null||value.officialCode.source.length!==3||value.officialCode.destination.length!==2||
    [...value.officialCode.source,...value.officialCode.destination].some(item=>item.identity!=="CODE_IDENTITY_REVIEWED")||
    value.deployments===null||Object.values(value.deployments).some(item=>item===null)||value.source===null||value.destination===null||value.configurationSha256===null)fail();
  assertConsistentEvidence(value);
}

function assertConsistentEvidence(value){
  const {source,destination,deployments}=value;
  const sourceOApp=deployments.sourceOApp,destinationOApp=deployments.destinationOApp,sourceAdapter=deployments.sourceAdapter,destinationAdapter=deployments.destinationAdapter;
  const sourceAdapterArguments=adapterArguments(sourceAdapter),destinationAdapterArguments=adapterArguments(destinationAdapter),sourceOAppArguments=oappArguments(sourceOApp),destinationOAppArguments=oappArguments(destinationOApp);
  assertDistinctProviderPair(value.providerAgreement.source.providers);assertDistinctProviderPair(value.providerAgreement.destination.providers);
  const providers=[...value.providerAgreement.source.providers,...value.providerAgreement.destination.providers];
  if(new Set(providers.map(item=>item.label)).size!==4||new Set(providers.map(item=>item.originSha256)).size!==4)fail();
  if(!sameCanonical(sourceOApp.providerIdentities,value.providerAgreement.source.providers)||!sameCanonical(sourceAdapter.providerIdentities,value.providerAgreement.source.providers)||
    !sameCanonical(destinationOApp.providerIdentities,value.providerAgreement.destination.providers)||!sameCanonical(destinationAdapter.providerIdentities,value.providerAgreement.destination.providers))fail();
  if(!source.supportedEid||!destination.supportedEid||source.isDefaultSendLibrary||destination.isDefaultReceiveLibrary||source.dstEid!==40231||destination.srcEid!==40161||
    source.adapter.quorum!=="3"||destination.adapter.quorum!=="3"||!source.adapter.signersAuthorized.every(Boolean)||!destination.adapter.signersAuthorized.every(Boolean))fail();
  if(!sameAddress(sourceOApp.address,source.sourceOApp)||!sameAddress(destinationOApp.address,destination.oapp)||!sameAddress(sourceAdapter.address,source.adapter.address)||
    !sameAddress(destinationAdapter.address,destination.adapter.address)||!sameAddress(sourceOAppArguments.endpoint,source.endpoint)||!sameAddress(destinationOAppArguments.endpoint,destination.endpoint)||
    !sameAddress(sourceAdapterArguments.messageLib,source.adapter.messageLib)||!sameAddress(sourceAdapterArguments.verificationTarget,source.adapter.verificationTarget)||
    !sameAddress(destinationAdapterArguments.messageLib,destination.adapter.messageLib)||!sameAddress(destinationAdapterArguments.verificationTarget,destination.adapter.verificationTarget)||
    source.adapter.supportedDstEid!==source.dstEid||destination.adapter.supportedDstEid!==source.dstEid||sourceAdapterArguments.supportedDstEid!==source.dstEid||
    destinationAdapterArguments.supportedDstEid!==source.dstEid||!sameAddress(source.adapter.messageLib,source.sendLibrary)||!sameAddress(destination.adapter.verificationTarget,destination.receiveLibrary)||
    !sameCanonical(sourceAdapterArguments.signers,destinationAdapterArguments.signers)||!sameArtifactProvenance(sourceOApp,destinationOApp)||!sameArtifactProvenance(sourceAdapter,destinationAdapter))fail();
  const sentinelCode=source.dvnCodeKeccak256.find(item=>sameAddress(item.address,source.adapter.address));
  if(!sentinelCode||sentinelCode.codeKeccak256!==sourceAdapter.runtimeCodeKeccak256)fail();
  if(source.destinationPeer!==addressPeer(destination.oapp)||destination.sourcePeer!==addressPeer(source.sourceOApp)||source.uln.confirmations!=="15"||destination.rawAppUln.confirmations!=="64"||
    !sameCanonical(destination.rawAppUln,destination.resolvedUln)||!validUln(source.uln,source.adapter.address)||!validUln(destination.rawAppUln,destination.adapter.address)||
    !sameAddresses(source.uln.requiredDvns,destination.rawAppUln.requiredDvns)||!sameCanonical(normalizedOptional(source.uln.optionalDvns,source.adapter.address),normalizedOptional(destination.rawAppUln.optionalDvns,destination.adapter.address))||
    source.uln.optionalDvnThreshold!==destination.rawAppUln.optionalDvnThreshold)fail();
  if(!sameAddress(value.officialCode.source[0].address,source.endpoint)||!sameAddress(value.officialCode.source[1].address,source.sendLibrary)||
    !sameAddress(value.officialCode.source[2].address,source.executor.address)||!sameAddress(value.officialCode.destination[0].address,destination.endpoint)||
    !sameAddress(value.officialCode.destination[1].address,destination.receiveLibrary)||BigInt(sourceOApp.deploymentBlockNumber)>BigInt(value.blocks.source.blockNumber)||
    BigInt(sourceAdapter.deploymentBlockNumber)>BigInt(value.blocks.source.blockNumber)||BigInt(destinationOApp.deploymentBlockNumber)>BigInt(value.blocks.destination.blockNumber)||
    BigInt(destinationAdapter.deploymentBlockNumber)>BigInt(value.blocks.destination.blockNumber))fail();
}

function agreementValue(value){
  const root=record(value);exactKeys(root,["state","providers","resultSha256"]);
  const state=field(root,"state");if(state!=="TWO_TRANSPORTS_AGREE"&&state!=="PROVIDER_DISAGREEMENT")fail();
  const providers=denseArray(field(root,"providers"));if(providers.length!==2)fail();
  return{state,providers:[providerIdentity(providers[0]),providerIdentity(providers[1])],resultSha256:nullable(digest,field(root,"resultSha256"))};
}

function providerIdentity(value){
  const root=record(value);exactKeys(root,["label","originSha256","operatorFamily"]);
  return{label:identifier(field(root,"label")),originSha256:digest(field(root,"originSha256")),operatorFamily:identifier(field(root,"operatorFamily"))};
}

function blockValue(value,expectedChainId){
  const root=record(value);exactKeys(root,["chainId","blockNumber","blockHash","parentHash","stateRoot","transactionsRoot","timestamp"]);
  const chainId=decimal(field(root,"chainId"));if(chainId!==expectedChainId)fail();
  return{chainId,blockNumber:decimal(field(root,"blockNumber")),blockHash:hash(field(root,"blockHash")),parentHash:hash(field(root,"parentHash")),stateRoot:hash(field(root,"stateRoot")),transactionsRoot:hash(field(root,"transactionsRoot")),timestamp:decimal(field(root,"timestamp"))};
}

function codeArray(value,allowed){
  const items=denseArray(value).map(codeValue),positions=items.map(item=>allowed.indexOf(item.name));
  if(positions.some(position=>position<0)||positions.some((position,index)=>index>0&&position<=positions[index-1]))fail();
  return items;
}

function codeValue(value){
  const root=record(value);exactKeys(root,["name","address","byteLength","runtimeCodeKeccak256","identity"]);
  const name=identifier(field(root,"name")),identity=field(root,"identity");
  if(!["CODE_IDENTITY_REVIEWED","CODE_PRESENT_IDENTITY_UNPROVEN","CODE_MISSING","PROVIDER_DISAGREEMENT"].includes(identity))fail();
  const byteLength=field(root,"byteLength"),runtimeHash=field(root,"runtimeCodeKeccak256"),present=identity==="CODE_IDENTITY_REVIEWED"||identity==="CODE_PRESENT_IDENTITY_UNPROVEN";
  if(present&&(byteLength===null||runtimeHash===null)||!present&&(byteLength!==null||runtimeHash!==null))fail();
  return{name,address:address(field(root,"address")),byteLength:byteLength===null?null:uint(byteLength,false),runtimeCodeKeccak256:runtimeHash===null?null:hash(runtimeHash),identity};
}

function deploymentsValue(value){
  const root=record(value);exactKeys(root,["sourceOApp","destinationOApp","sourceAdapter","destinationAdapter"]);
  return{sourceOApp:deploymentValue(field(root,"sourceOApp"),"TreasuryPolicyOApp","11155111"),destinationOApp:deploymentValue(field(root,"destinationOApp"),"TreasuryPolicyOApp","421614"),sourceAdapter:deploymentValue(field(root,"sourceAdapter"),"SentinelDVNAdapter","11155111"),destinationAdapter:deploymentValue(field(root,"destinationAdapter"),"SentinelDVNAdapter","421614")};
}

function deploymentValue(value,expectedName,expectedChainId){
  if(value===null)return null;
  const root=record(value);exactKeys(root,[
    "contractName","chainId","address","deployer","providerIdentities","deploymentTxHash","deploymentBlockNumber","deploymentBlockHash",
    "creationBytecodeSha256","deployedBytecodeSha256","immutableReferencesSha256","transactionInputSha256","runtimeCodeKeccak256","constructorArguments"
  ]);
  if(field(root,"contractName")!==expectedName||decimal(field(root,"chainId"))!==expectedChainId)fail();
  const providers=denseArray(field(root,"providerIdentities"));if(providers.length!==2)fail();
  return{contractName:expectedName,chainId:expectedChainId,address:address(field(root,"address")),deployer:address(field(root,"deployer")),providerIdentities:[providerIdentity(providers[0]),providerIdentity(providers[1])],deploymentTxHash:hash(field(root,"deploymentTxHash")),deploymentBlockNumber:decimal(field(root,"deploymentBlockNumber")),deploymentBlockHash:hash(field(root,"deploymentBlockHash")),creationBytecodeSha256:digest(field(root,"creationBytecodeSha256")),deployedBytecodeSha256:digest(field(root,"deployedBytecodeSha256")),immutableReferencesSha256:digest(field(root,"immutableReferencesSha256")),transactionInputSha256:digest(field(root,"transactionInputSha256")),runtimeCodeKeccak256:hash(field(root,"runtimeCodeKeccak256")),constructorArguments:constructorArguments(field(root,"constructorArguments"),expectedName)};
}

function constructorArguments(value,name){
  const root=record(value);
  if(name==="TreasuryPolicyOApp"){exactKeys(root,["endpoint","delegate"]);return{endpoint:address(field(root,"endpoint")),delegate:address(field(root,"delegate"))}}
  exactKeys(root,["messageLib","verificationTarget","supportedDstEid","signers","quorum"]);
  const signers=addressArray(field(root,"signers"));if(signers.length!==5||field(root,"quorum")!=="3")fail();
  return{messageLib:address(field(root,"messageLib")),verificationTarget:address(field(root,"verificationTarget")),supportedDstEid:uint(field(root,"supportedDstEid"),false),signers,quorum:"3"};
}

function sourcePath(value){
  const root=record(value);exactKeys(root,["endpoint","sourceOApp","dstEid","sendLibrary","isDefaultSendLibrary","supportedEid","uln","dvnCodeKeccak256","executor","destinationPeer","adapter"]);
  const uln=ulnValue(field(root,"uln")),entries=denseArray(field(root,"dvnCodeKeccak256")).map(dvnCode),expected=[...uln.requiredDvns,...uln.optionalDvns].map(item=>item.toLowerCase());
  if(entries.length!==expected.length||entries.some((item,index)=>item.address.toLowerCase()!==expected[index]))fail();
  const executor=record(field(root,"executor"));exactKeys(executor,["maxMessageSize","address"]);
  return{endpoint:address(field(root,"endpoint")),sourceOApp:address(field(root,"sourceOApp")),dstEid:uint(field(root,"dstEid"),false),sendLibrary:address(field(root,"sendLibrary")),isDefaultSendLibrary:boolean(field(root,"isDefaultSendLibrary")),supportedEid:boolean(field(root,"supportedEid")),uln,dvnCodeKeccak256:entries,executor:{maxMessageSize:uint(field(executor,"maxMessageSize"),true),address:address(field(executor,"address"))},destinationPeer:hash(field(root,"destinationPeer")),adapter:adapterValue(field(root,"adapter"))};
}

function destinationPath(value){
  const root=record(value);exactKeys(root,["endpoint","oapp","srcEid","receiveLibrary","isDefaultReceiveLibrary","supportedEid","rawAppUln","resolvedUln","sourcePeer","adapter"]);
  return{endpoint:address(field(root,"endpoint")),oapp:address(field(root,"oapp")),srcEid:uint(field(root,"srcEid"),false),receiveLibrary:address(field(root,"receiveLibrary")),isDefaultReceiveLibrary:boolean(field(root,"isDefaultReceiveLibrary")),supportedEid:boolean(field(root,"supportedEid")),rawAppUln:ulnValue(field(root,"rawAppUln")),resolvedUln:ulnValue(field(root,"resolvedUln")),sourcePeer:hash(field(root,"sourcePeer")),adapter:adapterValue(field(root,"adapter"))};
}

function ulnValue(value){
  const root=record(value);exactKeys(root,["confirmations","requiredDvns","optionalDvns","optionalDvnThreshold"]);
  return{confirmations:decimal(field(root,"confirmations")),requiredDvns:addressArray(field(root,"requiredDvns")),optionalDvns:addressArray(field(root,"optionalDvns")),optionalDvnThreshold:uint(field(root,"optionalDvnThreshold"),true)};
}

function adapterValue(value){
  const root=record(value);exactKeys(root,["address","messageLib","verificationTarget","supportedDstEid","quorum","signersAuthorized"]);
  const authorized=denseArray(field(root,"signersAuthorized")).map(boolean);if(authorized.length!==5)fail();
  return{address:address(field(root,"address")),messageLib:address(field(root,"messageLib")),verificationTarget:address(field(root,"verificationTarget")),supportedDstEid:uint(field(root,"supportedDstEid"),false),quorum:decimal(field(root,"quorum")),signersAuthorized:authorized};
}

function dvnCode(value){const root=record(value);exactKeys(root,["address","codeKeccak256"]);return{address:address(field(root,"address")),codeKeccak256:hash(field(root,"codeKeccak256"))}}

function blockerArray(value){
  const blockers=denseArray(value).map(blockerValue),sorted=[...blockers].sort(compareBlockers);
  if(new Set(sorted.map(item=>item.code)).size!==sorted.length)fail();return sorted;
}

function blockerValue(value){
  const root=record(value);exactKeys(root,["code","category","remediation"]);
  const code=field(root,"code"),definition=typeof code==="string"?BLOCKERS[code]:undefined;if(!definition)fail();
  const[category,remediation]=definition;if(field(root,"category")!==category||field(root,"remediation")!==remediation)fail();
  return{code,category,remediation};
}

function statusFor(blockers){
  const precedence=[["INPUT_BINDING","BLOCKED_INPUT_BINDING"],["RPC_INDEPENDENCE","BLOCKED_RPC_INDEPENDENCE"],["RPC_CONSENSUS","BLOCKED_RPC_CONSENSUS"],["CODE_IDENTITY","BLOCKED_CODE_IDENTITY"],["PATHWAY_CONFIGURATION","BLOCKED_PATHWAY_CONFIGURATION"]];
  return precedence.find(([category])=>blockers.some(blocker=>blocker.category===category))?.[1]??"OBSERVED_PATHWAY_CONSISTENT";
}

function statusValue(value){if(!["BLOCKED_INPUT_BINDING","BLOCKED_RPC_INDEPENDENCE","BLOCKED_RPC_CONSENSUS","BLOCKED_CODE_IDENTITY","BLOCKED_PATHWAY_CONFIGURATION","OBSERVED_PATHWAY_CONSISTENT"].includes(value))fail();return value}
function independence(value){if(value!=="OPERATOR_INDEPENDENCE_UNPROVEN"&&value!=="OPERATOR_INDEPENDENCE_REVIEWED")fail();return value}
function addressArray(value){const result=denseArray(value).map(address),normalized=result.map(item=>item.toLowerCase());if(!strictlySorted(normalized))fail();return result}
function strictlySorted(value){return value.every((item,index)=>index===0||value[index-1]<item)}
function compareBlockers(left,right){return`${left.category}:${left.code}:${left.remediation}`.localeCompare(`${right.category}:${right.code}:${right.remediation}`)}
function nullable(parser,value,...args){return value===null?null:parser(value,...args)}

function adapterArguments(value){if(!Object.hasOwn(value.constructorArguments,"messageLib"))fail();return value.constructorArguments}
function oappArguments(value){if(!Object.hasOwn(value.constructorArguments,"endpoint"))fail();return value.constructorArguments}
function assertDistinctProviderPair(value){if(new Set(value.map(item=>item.label)).size!==2||new Set(value.map(item=>item.originSha256)).size!==2||new Set(value.map(item=>item.operatorFamily)).size!==2)fail()}
function sameArtifactProvenance(left,right){return left.creationBytecodeSha256===right.creationBytecodeSha256&&left.deployedBytecodeSha256===right.deployedBytecodeSha256&&left.immutableReferencesSha256===right.immutableReferencesSha256}
function validUln(value,sentinel){const combined=[...value.requiredDvns,...value.optionalDvns].map(item=>item.toLowerCase()),threshold=value.optionalDvns.length===0?value.optionalDvnThreshold===0:value.optionalDvnThreshold>=1&&value.optionalDvnThreshold<=value.optionalDvns.length;return combined.length===new Set(combined).size&&threshold&&!value.requiredDvns.some(item=>sameAddress(item,sentinel))&&value.optionalDvns.filter(item=>sameAddress(item,sentinel)).length===1&&(value.requiredDvns.length>0||value.optionalDvnThreshold>1)}
function normalizedOptional(value,sentinel){return value.map(item=>sameAddress(item,sentinel)?"SENTINEL_OPTIONAL":item.toLowerCase()).sort()}
function sameAddresses(left,right){return left.length===right.length&&left.every((item,index)=>sameAddress(item,right[index]))}
function sameAddress(left,right){return left.toLowerCase()===right.toLowerCase()}
function sameCanonical(left,right){return canonicalJson(left)===canonicalJson(right)}
function addressPeer(value){return`0x${"0".repeat(24)}${value.slice(2).toLowerCase()}`}

function publicView(bundle){
  return{
    schemaVersion:bundle.schemaVersion,toolVersion:bundle.toolVersion,runTimestamp:bundle.runTimestamp,status:bundle.status,truthLabel:bundle.truthLabel,
    repositoryBindingSha256:bundle.repositoryBindingSha256,
    rpcIndependence:{...bundle.rpcIndependence},
    providerAgreement:{source:publicAgreement(bundle.providerAgreement.source),destination:publicAgreement(bundle.providerAgreement.destination)},
    blocks:{source:publicBlock(bundle.blocks.source),destination:publicBlock(bundle.blocks.destination)},
    pathway:{source:publicSourcePath(bundle.source),destination:publicDestinationPath(bundle.destination)},
    configurationSha256:bundle.configurationSha256,blockers:bundle.blockers.map(item=>({...item})),evidenceSha256:bundle.evidenceSha256
  };
}

function publicAgreement(value){return{state:value.state,resultSha256:value.resultSha256}}
function publicBlock(value){return value===null?null:{chainId:value.chainId,blockNumber:value.blockNumber,blockHash:value.blockHash,timestamp:value.timestamp}}
function publicSourcePath(value){return value===null?null:{chainId:"11155111",eid:40161,remoteEid:value.dstEid,oapp:value.sourceOApp,adapter:value.adapter.address,library:value.sendLibrary}}
function publicDestinationPath(value){return value===null?null:{chainId:"421614",eid:40231,remoteEid:value.srcEid,oapp:value.oapp,adapter:value.adapter.address,library:value.receiveLibrary}}
function formatBlock(value){return value?`${value.chainId} · block ${value.blockNumber} · ${value.blockHash}`:"NOT OBSERVED"}

function parseCanonicalJsonDocument(text){
  const value=parseJsonDocument(text);if(canonicalJson(value)!==text)fail();return value;
}

function parseJsonDocument(text){
  if(typeof text!=="string"||text.includes("\0"))fail();
  let offset=0;
  const whitespace=()=>{while(offset<text.length&&/[ \t\r\n]/.test(text[offset]))offset++};
  const string=()=>{
    if(text[offset]!=="\"")fail();const start=offset++;
    while(offset<text.length){const character=text[offset++];if(character==='"'){try{return JSON.parse(text.slice(start,offset))}catch{fail()}}if(character==="\\"){const escaped=text[offset++];if(!escaped||!/^['"\\/bfnrtu]$/.test(escaped))fail();if(escaped==="u"){if(!/^[0-9a-fA-F]{4}$/.test(text.slice(offset,offset+4)))fail();offset+=4}}else if(character.charCodeAt(0)<0x20)fail()}
    fail();
  };
  const value=()=>{
    whitespace();const character=text[offset];
    if(character==='"')return string();
    if(character==="{"){offset++;whitespace();const result={},keys=new Set();if(text[offset]==="}"){offset++;return result}while(true){whitespace();const key=string();if(keys.has(key))fail();keys.add(key);whitespace();if(text[offset++]!==":")fail();Object.defineProperty(result,key,{value:value(),enumerable:true,writable:true,configurable:true});whitespace();const separator=text[offset++];if(separator==="}")return result;if(separator!==",")fail()}}
    if(character==="["){offset++;whitespace();const result=[];if(text[offset]==="]"){offset++;return result}while(true){result.push(value());whitespace();const separator=text[offset++];if(separator==="]")return result;if(separator!==",")fail()}}
    for(const[literal,parsed]of[["true",true],["false",false],["null",null]])if(text.startsWith(literal,offset)){offset+=literal.length;return parsed}
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));if(!match)fail();offset+=match[0].length;const parsed=Number(match[0]);if(!Number.isFinite(parsed))fail();return parsed;
  };
  const result=value();whitespace();if(offset!==text.length)fail();return result;
}

function canonicalJson(value){return`${encodeCanonical(value,new Set())}\n`}
function encodeCanonical(value,active){
  if(value===null)return"null";
  if(typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"){if(!Number.isFinite(value))fail();return JSON.stringify(value)}
  if(!value||typeof value!=="object"||active.has(value))fail();active.add(value);
  try{
    if(Array.isArray(value))return encodeCanonicalArray(value,active);
    const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=="string"))fail();
    return`{${keys.sort().map(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)fail();return`${JSON.stringify(key)}:${encodeCanonical(descriptor.value,active)}`}).join(",")}}`;
  }finally{active.delete(value)}
}
function encodeCanonicalArray(value,active){
  const values=exactArrayValues(value),encoded=[];
  for(let index=0;index<values.length;index++)encoded.push(encodeCanonical(values[index],active));
  return`[${encoded.join(",")}]`;
}

function rejectUnsafeGraph(value,active){
  if(!value||typeof value!=="object")return;
  if(active.has(value))fail();
  const isArray=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(isArray?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)fail();
  active.add(value);
  try{
    if(isArray){
      for(const item of exactArrayValues(value))rejectUnsafeGraph(item,active);
      return;
    }
    const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=="string"))fail();
    for(const key of keys){
      if(FORBIDDEN_KEYS.has(key.replace(/[^A-Za-z0-9]/g,"").toLowerCase()))fail();
      const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)fail();
      rejectUnsafeGraph(descriptor.value,active);
    }
  }finally{active.delete(value)}
}

function record(value){if(!value||typeof value!=="object"||Array.isArray(value))fail();const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)fail();return value}
function denseArray(value){return exactArrayValues(value)}
function exactArrayValues(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail();
  const keys=Reflect.ownKeys(value),lengthDescriptor=Object.getOwnPropertyDescriptor(value,"length");
  if(!lengthDescriptor||!("value"in lengthDescriptor)||lengthDescriptor.value!==value.length||lengthDescriptor.enumerable||keys.length!==value.length+1)fail();
  const result=[];
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)fail();
    result.push(descriptor.value);
  }
  return result;
}
function exactKeys(value,expected){const keys=Reflect.ownKeys(value);if(keys.length!==expected.length||keys.some(key=>typeof key!=="string"||!expected.includes(key)))fail()}
function field(value,key){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)fail();return descriptor.value}
function isoTimestamp(value){if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))fail();const parsed=new Date(value);if(Number.isNaN(parsed.getTime())||parsed.toISOString()!==value)fail();return value}
function digest(value){if(typeof value!=="string"||!DIGEST.test(value)||value==="0".repeat(64))fail();return value}
function hash(value){if(typeof value!=="string"||!HASH.test(value)||value===`0x${"0".repeat(64)}`)fail();return value}
function address(value){
  if(typeof value!=="string"||!ADDRESS.test(value)||/^0x0{40}$/.test(value))fail();
  if(value!==value.toLowerCase()&&checksumAddress(value)!==value)fail();
  return value;
}
function decimal(value){if(typeof value!=="string"||!DECIMAL.test(value))fail();return value}
function identifier(value){if(typeof value!=="string"||!IDENTIFIER.test(value))fail();return value}
function uint(value,allowZero){if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||(!allowZero&&value===0))fail();return value}
function boolean(value){if(typeof value!=="boolean")fail();return value}
async function sha256(value){const bytes=new TextEncoder().encode(value),digestBytes=await globalThis.crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digestBytes),byte=>byte.toString(16).padStart(2,"0")).join("")}
function checksumAddress(value){
  const lower=value.slice(2).toLowerCase(),digest=keccak256Ascii(lower);
  return`0x${Array.from(lower,(character,index)=>/[a-f]/.test(character)&&Number.parseInt(digest[index],16)>=8?character.toUpperCase():character).join("")}`;
}
function keccak256Ascii(value){
  const rate=136,bytes=[...new TextEncoder().encode(value),1];
  while(bytes.length%rate!==rate-1)bytes.push(0);bytes.push(0x80);
  const state=Array(25).fill(0n);
  for(let offset=0;offset<bytes.length;offset+=rate){
    for(let lane=0;lane<rate/8;lane++)for(let byte=0;byte<8;byte++)state[lane]^=BigInt(bytes[offset+lane*8+byte])<<BigInt(byte*8);
    keccakPermutation(state);
  }
  const output=[];
  for(let lane=0;output.length<32;lane++)for(let byte=0;byte<8&&output.length<32;byte++)output.push(Number(state[lane]>>BigInt(byte*8)&0xffn));
  return output.map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function keccakPermutation(state){
  for(const round of KECCAK_ROUNDS){
    const columns=Array(5).fill(0n),mixed=Array(5).fill(0n),rotated=Array(25).fill(0n);
    for(let x=0;x<5;x++)for(let y=0;y<5;y++)columns[x]^=state[x+5*y];
    for(let x=0;x<5;x++)mixed[x]=columns[(x+4)%5]^rotate64(columns[(x+1)%5],1);
    for(let x=0;x<5;x++)for(let y=0;y<5;y++)state[x+5*y]=(state[x+5*y]^mixed[x])&UINT64;
    for(let x=0;x<5;x++)for(let y=0;y<5;y++)rotated[y+5*((2*x+3*y)%5)]=rotate64(state[x+5*y],KECCAK_ROTATIONS[x+5*y]);
    for(let x=0;x<5;x++)for(let y=0;y<5;y++)state[x+5*y]=(rotated[x+5*y]^((~rotated[(x+1)%5+5*y])&rotated[(x+2)%5+5*y]))&UINT64;
    state[0]=(state[0]^round)&UINT64;
  }
}
function rotate64(value,shift){const distance=BigInt(shift);return((value<<distance)|(value>>(64n-distance)))&UINT64}
function rejected(){return new Error(REJECTION)}
function fail(){throw rejected()}
