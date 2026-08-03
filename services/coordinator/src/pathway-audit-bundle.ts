import{createHash}from"node:crypto";
import{getAddress}from"ethers";
import{canonicalJson,parseCanonicalJsonDocument}from"./canonical-json.js";
import{PathwayAuditError,type PathwayAuditBlocker,type PathwayAuditStatus}from"./pathway-audit-model.js";
import type{
  PathwayAuditObservation,PathwayDeploymentObservations,ProviderAgreementObservation,
  PublicAdapterObservation,PublicDeploymentEvidence,PublicDestinationPathObservation,
  PublicSourcePathObservation,PublicUlnObservation,RuntimeCodeObservation
}from"./pathway-audit-observer.js";
import type{PinnedBlockObservation}from"./pathway-audit-block.js";

export interface PathwayAuditBundle extends PathwayAuditObservation{
  schemaVersion:1;
  toolVersion:"sentinel-pathway-auditor/v1";
  runTimestamp:string;
  evidenceSha256:string;
}

export interface BuildPathwayAuditBundleInput{
  observation:PathwayAuditObservation;
  runTimestamp:string;
}

type PathwayAuditBundleBody=Omit<PathwayAuditBundle,"evidenceSha256">;
type PlainRecord=Record<string,unknown>;

const truthLabel="READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"as const;
const digestPattern=/^[a-f0-9]{64}$/;
const hashPattern=/^0x[a-f0-9]{64}$/;
const addressPattern=/^0x[a-fA-F0-9]{40}$/;
const decimalPattern=/^(?:0|[1-9][0-9]*)$/;
const identifierPattern=/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/;
const secretKey=/(?:private|secret|mnemonic|seed|keystore|rpcurl|websocket|wallet|credential|token|password|apikey|environment|cloud|signerkey)/i;

const blockerDefinitions:Record<PathwayAuditBlocker["code"],readonly[PathwayAuditBlocker["category"],PathwayAuditBlocker["remediation"]]>={
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

const sourceCodeNames=["sourceEndpointV2","sourceSendUln302","sourceExecutor"]as const;
const destinationCodeNames=["destinationEndpointV2","destinationReceiveUln302"]as const;

export function buildPathwayAuditBundle(input:BuildPathwayAuditBundleInput):PathwayAuditBundle{
  const root=record(input);rejectSecretKeys(root,new Set<object>());exactKeys(root,["observation","runTimestamp"]);
  const observation=observationValue(field(root,"observation"),false);
  const body:PathwayAuditBundleBody={
    schemaVersion:1,toolVersion:"sentinel-pathway-auditor/v1",runTimestamp:isoTimestamp(field(root,"runTimestamp")),
    ...observation,status:statusFor(observation.blockers)
  };
  return{...body,evidenceSha256:sha256(canonicalJson(body))};
}

export function encodePathwayAuditBundle(bundle:PathwayAuditBundle):string{
  return canonicalJson(bundleValue(bundle));
}

export function parsePathwayAuditBundleText(text:string):PathwayAuditBundle{
  try{
    const parsed=parseCanonicalJsonDocument(text);
    rejectSecretKeys(parsed,new Set<object>());
    return bundleValue(parsed);
  }catch(error){
    if(error instanceof PathwayAuditError)throw error;
    return invalid();
  }
}

function bundleValue(value:unknown):PathwayAuditBundle{
  const root=record(value);rejectSecretKeys(root,new Set<object>());
  exactKeys(root,[
    "schemaVersion","toolVersion","runTimestamp","status","truthLabel","repositoryBindingSha256",
    "rpcIndependence","providerAgreement","blocks","officialCode","deployments","source","destination",
    "configurationSha256","blockers","evidenceSha256"
  ]);
  if(field(root,"schemaVersion")!==1||field(root,"toolVersion")!=="sentinel-pathway-auditor/v1")invalid();
  const observation=observationValue(root,true);
  const body:PathwayAuditBundleBody={
    schemaVersion:1,toolVersion:"sentinel-pathway-auditor/v1",runTimestamp:isoTimestamp(field(root,"runTimestamp")),...observation
  };
  const evidenceSha256=digest(field(root,"evidenceSha256"));
  if(evidenceSha256!==sha256(canonicalJson(body)))invalid();
  return{...body,evidenceSha256};
}

function observationValue(value:unknown,fromBundle:boolean):PathwayAuditObservation{
  const root=record(value);
  const keys=[
    "status","truthLabel","repositoryBindingSha256","rpcIndependence","providerAgreement","blocks",
    "officialCode","deployments","source","destination","configurationSha256","blockers"
  ];
  if(!fromBundle)exactKeys(root,keys);
  const label=field(root,"truthLabel");if(label!==truthLabel)invalid();
  const blockers=blockerArray(field(root,"blockers"));
  if(fromBundle&&canonicalJson(field(root,"blockers"))!==canonicalJson(blockers))invalid();
  const suppliedStatus=statusValue(field(root,"status")),derivedStatus=statusFor(blockers);
  if(fromBundle&&suppliedStatus!==derivedStatus)invalid();
  const rpc=record(field(root,"rpcIndependence"));exactKeys(rpc,["source","destination"]);
  const agreement=record(field(root,"providerAgreement"));exactKeys(agreement,["source","destination"]);
  const blocks=record(field(root,"blocks"));exactKeys(blocks,["source","destination"]);
  const official=record(field(root,"officialCode"));exactKeys(official,["source","destination"]);
  const deploymentsRaw=field(root,"deployments"),sourceRaw=field(root,"source"),destinationRaw=field(root,"destination");
  const result:PathwayAuditObservation={
    status:fromBundle?suppliedStatus:derivedStatus,truthLabel:label,
    repositoryBindingSha256:digest(field(root,"repositoryBindingSha256")),
    rpcIndependence:{source:independence(field(rpc,"source")),destination:independence(field(rpc,"destination"))},
    providerAgreement:{
      source:agreementValue(field(agreement,"source")),destination:agreementValue(field(agreement,"destination"))
    },
    blocks:{
      source:nullable(blockValue,field(blocks,"source"),"11155111"),
      destination:nullable(blockValue,field(blocks,"destination"),"421614")
    },
    officialCode:{
      source:codeArray(field(official,"source"),sourceCodeNames),
      destination:codeArray(field(official,"destination"),destinationCodeNames)
    },
    deployments:deploymentsRaw===null?null:deploymentsValue(deploymentsRaw),
    source:sourceRaw===null?null:sourcePath(sourceRaw),
    destination:destinationRaw===null?null:destinationPath(destinationRaw),
    configurationSha256:nullable(digest,field(root,"configurationSha256")),blockers
  };
  assertConsistentCompleteness(result);
  return result;
}

function assertConsistentCompleteness(value:PathwayAuditObservation):void{
  if(value.status!=="OBSERVED_PATHWAY_CONSISTENT")return;
  if(value.rpcIndependence.source!=="OPERATOR_INDEPENDENCE_REVIEWED"||
    value.rpcIndependence.destination!=="OPERATOR_INDEPENDENCE_REVIEWED"||
    value.providerAgreement.source.state!=="TWO_TRANSPORTS_AGREE"||
    value.providerAgreement.destination.state!=="TWO_TRANSPORTS_AGREE"||
    value.providerAgreement.source.resultSha256===null||value.providerAgreement.destination.resultSha256===null||
    value.blocks.source===null||value.blocks.destination===null||
    value.officialCode.source.length!==sourceCodeNames.length||value.officialCode.destination.length!==destinationCodeNames.length||
    [...value.officialCode.source,...value.officialCode.destination].some(item=>item.identity!=="CODE_IDENTITY_REVIEWED")||
    value.deployments===null||Object.values(value.deployments).some(item=>item===null)||
    value.source===null||value.destination===null||value.configurationSha256===null)invalid();
}

function agreementValue(value:unknown):ProviderAgreementObservation{
  const root=record(value);exactKeys(root,["state","providers","resultSha256"]);
  const state=field(root,"state");
  if(state!=="TWO_TRANSPORTS_AGREE"&&state!=="PROVIDER_DISAGREEMENT")invalid();
  const identities=denseArray(field(root,"providers"));if(identities.length!==2)invalid();
  return{
    state,providers:[providerIdentity(identities[0]),providerIdentity(identities[1])],
    resultSha256:nullable(digest,field(root,"resultSha256"))
  };
}

function providerIdentity(value:unknown):{label:string;originSha256:string;operatorFamily:string}{
  const root=record(value);exactKeys(root,["label","originSha256","operatorFamily"]);
  return{
    label:identifier(field(root,"label")),originSha256:digest(field(root,"originSha256")),
    operatorFamily:identifier(field(root,"operatorFamily"))
  };
}

function blockValue(value:unknown,expectedChainId:string):PinnedBlockObservation{
  const root=record(value);exactKeys(root,["chainId","blockNumber","blockHash","parentHash","stateRoot","transactionsRoot","timestamp"]);
  const chainId=decimal(field(root,"chainId"));if(chainId!==expectedChainId)invalid();
  return{
    chainId,blockNumber:decimal(field(root,"blockNumber")),blockHash:hash(field(root,"blockHash")),
    parentHash:hash(field(root,"parentHash")),stateRoot:hash(field(root,"stateRoot")),
    transactionsRoot:hash(field(root,"transactionsRoot")),timestamp:decimal(field(root,"timestamp"))
  };
}

function codeArray(value:unknown,allowed:readonly string[]):RuntimeCodeObservation[]{
  const items=denseArray(value).map(codeValue),positions=items.map(item=>allowed.indexOf(item.name));
  if(positions.some(position=>position<0)||positions.some((position,index)=>index>0&&position<=positions[index-1]!))invalid();
  return items;
}

function codeValue(value:unknown):RuntimeCodeObservation{
  const root=record(value);exactKeys(root,["name","address","byteLength","runtimeCodeKeccak256","identity"]);
  const name=identifier(field(root,"name")),identity=field(root,"identity");
  if(identity!=="CODE_IDENTITY_REVIEWED"&&identity!=="CODE_PRESENT_IDENTITY_UNPROVEN"&&identity!=="CODE_MISSING"&&identity!=="PROVIDER_DISAGREEMENT")invalid();
  const byteLengthRaw=field(root,"byteLength"),codeHashRaw=field(root,"runtimeCodeKeccak256");
  const present=identity==="CODE_IDENTITY_REVIEWED"||identity==="CODE_PRESENT_IDENTITY_UNPROVEN";
  if(present&&(byteLengthRaw===null||codeHashRaw===null)||!present&&(byteLengthRaw!==null||codeHashRaw!==null))invalid();
  return{
    name,address:address(field(root,"address")),byteLength:byteLengthRaw===null?null:uint(byteLengthRaw,false),
    runtimeCodeKeccak256:codeHashRaw===null?null:hash(codeHashRaw),identity
  };
}

function deploymentsValue(value:unknown):PathwayDeploymentObservations{
  const root=record(value);exactKeys(root,["sourceOApp","destinationOApp","sourceAdapter","destinationAdapter"]);
  return{
    sourceOApp:deploymentValue(field(root,"sourceOApp"),"TreasuryPolicyOApp","11155111"),
    destinationOApp:deploymentValue(field(root,"destinationOApp"),"TreasuryPolicyOApp","421614"),
    sourceAdapter:deploymentValue(field(root,"sourceAdapter"),"SentinelDVNAdapter","11155111"),
    destinationAdapter:deploymentValue(field(root,"destinationAdapter"),"SentinelDVNAdapter","421614")
  };
}

function deploymentValue(value:unknown,expectedName:"TreasuryPolicyOApp"|"SentinelDVNAdapter",expectedChainId:string):PublicDeploymentEvidence|null{
  if(value===null)return null;
  const root=record(value);exactKeys(root,[
    "contractName","chainId","address","deployer","providerIdentities","deploymentTxHash","deploymentBlockNumber",
    "deploymentBlockHash","creationBytecodeSha256","deployedBytecodeSha256","immutableReferencesSha256",
    "transactionInputSha256","runtimeCodeKeccak256","constructorArguments"
  ]);
  if(field(root,"contractName")!==expectedName||decimal(field(root,"chainId"))!==expectedChainId)invalid();
  const providers=denseArray(field(root,"providerIdentities"));if(providers.length!==2)invalid();
  return{
    contractName:expectedName,chainId:expectedChainId,address:address(field(root,"address")),deployer:address(field(root,"deployer")),
    providerIdentities:[providerIdentity(providers[0]),providerIdentity(providers[1])],
    deploymentTxHash:hash(field(root,"deploymentTxHash")),deploymentBlockNumber:decimal(field(root,"deploymentBlockNumber")),
    deploymentBlockHash:hash(field(root,"deploymentBlockHash")),creationBytecodeSha256:digest(field(root,"creationBytecodeSha256")),
    deployedBytecodeSha256:digest(field(root,"deployedBytecodeSha256")),immutableReferencesSha256:digest(field(root,"immutableReferencesSha256")),
    transactionInputSha256:digest(field(root,"transactionInputSha256")),runtimeCodeKeccak256:hash(field(root,"runtimeCodeKeccak256")),
    constructorArguments:constructorArguments(field(root,"constructorArguments"),expectedName)
  };
}

function constructorArguments(value:unknown,name:"TreasuryPolicyOApp"|"SentinelDVNAdapter"){
  const root=record(value);
  if(name==="TreasuryPolicyOApp"){
    exactKeys(root,["endpoint","delegate"]);return{endpoint:address(field(root,"endpoint")),delegate:address(field(root,"delegate"))};
  }
  exactKeys(root,["messageLib","verificationTarget","supportedDstEid","signers","quorum"]);
  const signers=addressArray(field(root,"signers"));if(signers.length!==5||field(root,"quorum")!=="3")invalid();
  return{
    messageLib:address(field(root,"messageLib")),verificationTarget:address(field(root,"verificationTarget")),
    supportedDstEid:uint(field(root,"supportedDstEid"),false),signers:signers as[string,string,string,string,string],quorum:"3"as const
  };
}

function sourcePath(value:unknown):PublicSourcePathObservation{
  const root=record(value);exactKeys(root,[
    "endpoint","sourceOApp","dstEid","sendLibrary","isDefaultSendLibrary","supportedEid","uln",
    "dvnCodeKeccak256","executor","destinationPeer","adapter"
  ]);
  const uln=ulnValue(field(root,"uln"));
  const entries=denseArray(field(root,"dvnCodeKeccak256")).map(dvnCode),entryAddresses=entries.map(entry=>entry.address.toLowerCase());
  const expectedDvnAddresses=[...uln.requiredDvns,...uln.optionalDvns].map(item=>item.toLowerCase());
  if(entryAddresses.length!==expectedDvnAddresses.length||entryAddresses.some((item,index)=>item!==expectedDvnAddresses[index]))invalid();
  const executor=record(field(root,"executor"));exactKeys(executor,["maxMessageSize","address"]);
  return{
    endpoint:address(field(root,"endpoint")),sourceOApp:address(field(root,"sourceOApp")),dstEid:uint(field(root,"dstEid"),false),
    sendLibrary:address(field(root,"sendLibrary")),isDefaultSendLibrary:boolean(field(root,"isDefaultSendLibrary")),
    supportedEid:boolean(field(root,"supportedEid")),uln,dvnCodeKeccak256:entries,
    executor:{maxMessageSize:uint(field(executor,"maxMessageSize"),true),address:address(field(executor,"address"))},
    destinationPeer:hash(field(root,"destinationPeer")),adapter:adapterValue(field(root,"adapter"))
  };
}

function destinationPath(value:unknown):PublicDestinationPathObservation{
  const root=record(value);exactKeys(root,[
    "endpoint","oapp","srcEid","receiveLibrary","isDefaultReceiveLibrary","supportedEid",
    "rawAppUln","resolvedUln","sourcePeer","adapter"
  ]);
  return{
    endpoint:address(field(root,"endpoint")),oapp:address(field(root,"oapp")),srcEid:uint(field(root,"srcEid"),false),
    receiveLibrary:address(field(root,"receiveLibrary")),isDefaultReceiveLibrary:boolean(field(root,"isDefaultReceiveLibrary")),
    supportedEid:boolean(field(root,"supportedEid")),rawAppUln:ulnValue(field(root,"rawAppUln")),
    resolvedUln:ulnValue(field(root,"resolvedUln")),sourcePeer:hash(field(root,"sourcePeer")),
    adapter:adapterValue(field(root,"adapter"))
  };
}

function ulnValue(value:unknown):PublicUlnObservation{
  const root=record(value);exactKeys(root,["confirmations","requiredDvns","optionalDvns","optionalDvnThreshold"]);
  return{
    confirmations:decimal(field(root,"confirmations")),requiredDvns:addressArray(field(root,"requiredDvns")),
    optionalDvns:addressArray(field(root,"optionalDvns")),optionalDvnThreshold:uint(field(root,"optionalDvnThreshold"),true)
  };
}

function adapterValue(value:unknown):PublicAdapterObservation{
  const root=record(value);exactKeys(root,["address","messageLib","verificationTarget","supportedDstEid","quorum","signersAuthorized"]);
  const authorized=denseArray(field(root,"signersAuthorized")).map(boolean);if(authorized.length!==5)invalid();
  return{
    address:address(field(root,"address")),messageLib:address(field(root,"messageLib")),
    verificationTarget:address(field(root,"verificationTarget")),supportedDstEid:uint(field(root,"supportedDstEid"),false),
    quorum:decimal(field(root,"quorum")),signersAuthorized:authorized
  };
}

function dvnCode(value:unknown):{address:string;codeKeccak256:string}{
  const root=record(value);exactKeys(root,["address","codeKeccak256"]);
  return{address:address(field(root,"address")),codeKeccak256:hash(field(root,"codeKeccak256"))};
}

function blockerArray(value:unknown):PathwayAuditBlocker[]{
  const blockers=denseArray(value).map(blockerValue),sorted=[...blockers].sort(compareBlockers);
  if(new Set(sorted.map(item=>item.code)).size!==sorted.length)invalid();
  return sorted;
}

function blockerValue(value:unknown):PathwayAuditBlocker{
  const root=record(value);exactKeys(root,["code","category","remediation"]);
  const code=field(root,"code");if(typeof code!=="string"||!Object.hasOwn(blockerDefinitions,code))invalid();
  const typedCode=code as PathwayAuditBlocker["code"],[category,remediation]=blockerDefinitions[typedCode];
  if(field(root,"category")!==category||field(root,"remediation")!==remediation)invalid();
  return{code:typedCode,category,remediation};
}

function statusFor(blockers:PathwayAuditBlocker[]):PathwayAuditStatus{
  const precedence:readonly[PathwayAuditBlocker["category"],PathwayAuditStatus][]= [
    ["INPUT_BINDING","BLOCKED_INPUT_BINDING"],["RPC_INDEPENDENCE","BLOCKED_RPC_INDEPENDENCE"],
    ["RPC_CONSENSUS","BLOCKED_RPC_CONSENSUS"],["CODE_IDENTITY","BLOCKED_CODE_IDENTITY"],
    ["PATHWAY_CONFIGURATION","BLOCKED_PATHWAY_CONFIGURATION"]
  ];
  return precedence.find(([category])=>blockers.some(blocker=>blocker.category===category))?.[1]??"OBSERVED_PATHWAY_CONSISTENT";
}

function statusValue(value:unknown):PathwayAuditStatus{
  if(value!=="BLOCKED_INPUT_BINDING"&&value!=="BLOCKED_RPC_INDEPENDENCE"&&value!=="BLOCKED_RPC_CONSENSUS"&&
    value!=="BLOCKED_CODE_IDENTITY"&&value!=="BLOCKED_PATHWAY_CONFIGURATION"&&value!=="OBSERVED_PATHWAY_CONSISTENT")invalid();
  return value;
}

function independence(value:unknown):"OPERATOR_INDEPENDENCE_UNPROVEN"|"OPERATOR_INDEPENDENCE_REVIEWED"{
  if(value!=="OPERATOR_INDEPENDENCE_UNPROVEN"&&value!=="OPERATOR_INDEPENDENCE_REVIEWED")return invalid();
  return value;
}

function addressArray(value:unknown):string[]{
  const result=denseArray(value).map(address),normalized=result.map(item=>item.toLowerCase());
  if(!strictlySorted(normalized))invalid();return result;
}

function strictlySorted(value:string[]):boolean{return value.every((item,index)=>index===0||value[index-1]!<item)}
function compareBlockers(left:PathwayAuditBlocker,right:PathwayAuditBlocker):number{return`${left.category}:${left.code}:${left.remediation}`.localeCompare(`${right.category}:${right.code}:${right.remediation}`)}
function nullable<T,A extends unknown[]>(parser:(value:unknown,...args:A)=>T,value:unknown,...args:A):T|null{return value===null?null:parser(value,...args)}
function sha256(value:string):string{return createHash("sha256").update(value,"utf8").digest("hex")}

function isoTimestamp(value:unknown):string{
  if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))return invalid();
  const parsed=new Date(value);if(Number.isNaN(parsed.getTime())||parsed.toISOString()!==value)return invalid();return value;
}
function digest(value:unknown):string{if(typeof value!=="string"||!digestPattern.test(value)||value==="0".repeat(64))return invalid();return value}
function hash(value:unknown):string{if(typeof value!=="string"||!hashPattern.test(value)||value===`0x${"0".repeat(64)}`)return invalid();return value}
function address(value:unknown):string{
  if(typeof value!=="string"||!addressPattern.test(value)||/^0x0{40}$/.test(value))return invalid();
  try{if(value!==value.toLowerCase()&&getAddress(value)!==value)return invalid()}catch{return invalid()}
  return value;
}
function decimal(value:unknown):string{if(typeof value!=="string"||!decimalPattern.test(value))return invalid();return value}
function identifier(value:unknown):string{if(typeof value!=="string"||!identifierPattern.test(value))return invalid();return value}
function uint(value:unknown,allowZero:boolean):number{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||(!allowZero&&value===0))return invalid();return value}
function boolean(value:unknown):boolean{if(typeof value!=="boolean")return invalid();return value}

function record(value:unknown):PlainRecord{
  if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)return invalid();return value as PlainRecord;
}
function denseArray(value:unknown):unknown[]{
  if(!Array.isArray(value))return invalid();
  const keys=Reflect.ownKeys(value);if(keys.some(key=>key!=="length"&&(typeof key!=="string"||!/^(?:0|[1-9][0-9]*)$/.test(key))))return invalid();
  for(let index=0;index<value.length;index++)if(!Object.hasOwn(value,index))invalid();return value;
}
function exactKeys(value:PlainRecord,expected:string[]):void{
  const keys=Reflect.ownKeys(value);if(keys.length!==expected.length||keys.some(key=>typeof key!=="string"||!expected.includes(key)))invalid();
}
function field(value:PlainRecord,key:string):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return invalid();return descriptor.value;
}
function rejectSecretKeys(value:unknown,active:Set<object>):void{
  if(!value||typeof value!=="object")return;if(active.has(value))return invalid();active.add(value);
  try{
    for(const key of Reflect.ownKeys(value)){
      if(Array.isArray(value)&&key==="length")continue;
      if(typeof key!=="string")invalid();if(secretKey.test(key))throw new PathwayAuditError("PATHWAY_AUDIT_SECRET_FIELD_REJECTED");
      const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return invalid();
      rejectSecretKeys(descriptor.value,active);
    }
  }finally{active.delete(value)}
}
function invalid():never{throw new PathwayAuditError("PATHWAY_AUDIT_OBSERVATION_FAILED")}
