import{createHash}from"node:crypto";
import{keccak256}from"ethers";
import type{Hex}from"../../../packages/core/src/types.js";
import{canonicalJson}from"./canonical-json.js";
import{
  agreePinnedBlock,assertPinnedBlockStable,eip1898,
  type PinnedBlockObservation
}from"./pathway-audit-block.js";
import{
  parseAuditContractArtifact,verifyDeploymentEvidence,
  type AuditConstructorArguments,type VerifiedDeploymentEvidence
}from"./pathway-audit-deployment.js";
import{
  type PathwayAuditBlocker,type PathwayAuditManifest,type PathwayAuditStatus,PathwayAuditError
}from"./pathway-audit-model.js";
import type{PathwayAuditPolicyBinding}from"./pathway-audit-policy.js";
import type{ReadOnlyRpcClient,ReadOnlyRpcMethod}from"./read-only-json-rpc.js";
import{
  readSourcePathObservation,
  type PinnedStateReader,type SourcePathObservation
}from"./source-path-verifier.js";
import{
  readDestinationPathObservation,
  type DestinationPathObservation
}from"./destination-path-verifier.js";

export interface PathwayAuditObserverInput{
  manifest:PathwayAuditManifest;
  policyBinding:PathwayAuditPolicyBinding;
  clients:{
    source:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient];
    destination:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient];
  };
  oappArtifactText:string;
  adapterArtifactText:string;
  buildManifestText:string;
}

export interface PublicUlnObservation{
  confirmations:string;
  requiredDvns:string[];
  optionalDvns:string[];
  optionalDvnThreshold:number;
}

export interface PublicAdapterObservation{
  address:string;
  messageLib:string;
  verificationTarget:string;
  supportedDstEid:number;
  quorum:string;
  signersAuthorized:boolean[];
}

export interface PublicSourcePathObservation{
  endpoint:string;
  sourceOApp:string;
  dstEid:number;
  sendLibrary:string;
  isDefaultSendLibrary:boolean;
  supportedEid:boolean;
  uln:PublicUlnObservation;
  dvnCodeKeccak256:{address:string;codeKeccak256:string}[];
  executor:{maxMessageSize:number;address:string};
  destinationPeer:string;
  adapter:PublicAdapterObservation;
}

export interface PublicDestinationPathObservation{
  endpoint:string;
  oapp:string;
  srcEid:number;
  receiveLibrary:string;
  isDefaultReceiveLibrary:boolean;
  supportedEid:boolean;
  rawAppUln:PublicUlnObservation;
  resolvedUln:PublicUlnObservation;
  sourcePeer:string;
  adapter:PublicAdapterObservation;
}

export interface RuntimeCodeObservation{
  name:string;
  address:string;
  byteLength:number|null;
  runtimeCodeKeccak256:string|null;
  identity:"CODE_IDENTITY_REVIEWED"|"CODE_PRESENT_IDENTITY_UNPROVEN"|"CODE_MISSING"|"PROVIDER_DISAGREEMENT";
}

export interface PublicDeploymentEvidence{
  constructorArguments:AuditConstructorArguments;
  [key:string]:unknown;
}

export interface PathwayDeploymentObservations{
  sourceOApp:PublicDeploymentEvidence|null;
  destinationOApp:PublicDeploymentEvidence|null;
  sourceAdapter:PublicDeploymentEvidence|null;
  destinationAdapter:PublicDeploymentEvidence|null;
}

export interface ProviderAgreementObservation{
  state:"TWO_TRANSPORTS_AGREE"|"PROVIDER_DISAGREEMENT";
  providers:[{label:string;originSha256:string;operatorFamily:string},{label:string;originSha256:string;operatorFamily:string}];
  resultSha256:string|null;
}

export interface PathwayAuditObservation{
  status:PathwayAuditStatus;
  truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED";
  repositoryBindingSha256:string;
  rpcIndependence:PathwayAuditPolicyBinding["rpcIndependence"];
  providerAgreement:{source:ProviderAgreementObservation;destination:ProviderAgreementObservation};
  blocks:{source:PinnedBlockObservation|null;destination:PinnedBlockObservation|null};
  officialCode:{source:RuntimeCodeObservation[];destination:RuntimeCodeObservation[]};
  deployments:PathwayDeploymentObservations|null;
  source:PublicSourcePathObservation|null;
  destination:PublicDestinationPathObservation|null;
  configurationSha256:string|null;
  blockers:PathwayAuditBlocker[];
}

export interface PathwayInvariantInput{
  manifest:PathwayAuditManifest;
  policyBinding:PathwayAuditPolicyBinding;
  source:PublicSourcePathObservation|null;
  destination:PublicDestinationPathObservation|null;
  deployments:PathwayDeploymentObservations|null;
  additionalBlockers?:readonly PathwayAuditBlocker[];
}

interface RecordedRpcCall{
  method:ReadOnlyRpcMethod;
  params:unknown[];
  result?:unknown;
  errorCode?:string;
}

interface TrackedPair{
  clients:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient];
  records:readonly[RecordedRpcCall[],RecordedRpcCall[]];
  identities:ProviderAgreementObservation["providers"];
  descriptorValid:boolean;
  distinct:boolean;
}

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
  AUDIT_DEAD_DVN_PRESENT:["PATHWAY_CONFIGURATION","REMOVE_DEAD_DVN"],
  AUDIT_ULN_MISMATCH:["PATHWAY_CONFIGURATION","CONFIGURE_MATCHING_ULN"],
  AUDIT_SENTINEL_NOT_OPTIONAL:["PATHWAY_CONFIGURATION","CONFIGURE_SENTINEL_OPTIONAL"],
  AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER:["PATHWAY_CONFIGURATION","SELECT_INDEPENDENT_DVNS"],
  AUDIT_ADAPTER_BINDING_MISMATCH:["PATHWAY_CONFIGURATION","CORRECT_ADAPTER_BINDINGS"],
  AUDIT_SIGNER_MEMBERSHIP_MISMATCH:["PATHWAY_CONFIGURATION","CORRECT_SIGNER_MEMBERSHIP"]
};

export async function observePathway(input:PathwayAuditObserverInput):Promise<PathwayAuditObservation>{
  const blockers=[...input.policyBinding.blockers];
  const sourcePair=trackPair(input.clients.source,input.manifest.source.rpcs);
  const destinationPair=trackPair(input.clients.destination,input.manifest.destination.rpcs);
  const agreement={source:true,destination:true};
  for(const[chain,pair]of[["source",sourcePair],["destination",destinationPair]]as const){
    if(!pair.descriptorValid){addBlocker(blockers,"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement[chain]=false}
    if(!pair.distinct){addBlocker(blockers,"AUDIT_PROVIDER_OPERATOR_DUPLICATED");agreement[chain]=false}
  }

  let sourceBlock:PinnedBlockObservation|null=null,destinationBlock:PinnedBlockObservation|null=null;
  const blockResults=await Promise.allSettled([
    agreePinnedBlock({clients:sourcePair.clients,expectedChainId:input.manifest.source.chainId,observationLag:input.manifest.source.observationLag}),
    agreePinnedBlock({clients:destinationPair.clients,expectedChainId:input.manifest.destination.chainId,observationLag:input.manifest.destination.observationLag})
  ]);
  if(blockResults[0].status==="fulfilled")sourceBlock=blockResults[0].value;
  else{classifyBlockFailure(sourcePair,input.manifest.source.chainId,blockers);agreement.source=false}
  if(blockResults[1].status==="fulfilled")destinationBlock=blockResults[1].value;
  else{classifyBlockFailure(destinationPair,input.manifest.destination.chainId,blockers);agreement.destination=false}

  const officialCode:{source:RuntimeCodeObservation[];destination:RuntimeCodeObservation[]}={source:[],destination:[]};
  if(sourceBlock){
    const expected=input.policyBinding.officialRuntimeCodeKeccak256;
    officialCode.source=await Promise.all([
      observeCode("sourceEndpointV2",input.manifest.source.contracts.endpointV2,expected.sourceEndpointV2,sourcePair,sourceBlock,blockers,agreement,"source"),
      observeCode("sourceSendUln302",input.manifest.source.contracts.sendUln302,expected.sourceSendUln302,sourcePair,sourceBlock,blockers,agreement,"source"),
      observeCode("sourceExecutor",input.manifest.source.contracts.executor,expected.sourceExecutor,sourcePair,sourceBlock,blockers,agreement,"source")
    ]);
  }
  if(destinationBlock){
    const expected=input.policyBinding.officialRuntimeCodeKeccak256;
    officialCode.destination=await Promise.all([
      observeCode("destinationEndpointV2",input.manifest.destination.contracts.endpointV2,expected.destinationEndpointV2,destinationPair,destinationBlock,blockers,agreement,"destination"),
      observeCode("destinationReceiveUln302",input.manifest.destination.contracts.receiveUln302,expected.destinationReceiveUln302,destinationPair,destinationBlock,blockers,agreement,"destination")
    ]);
  }

  let deployments:PathwayDeploymentObservations|null=null;
  let sourcePath:PublicSourcePathObservation|null=null,destinationPath:PublicDestinationPathObservation|null=null;
  if(input.manifest.deployment===null){
    addBlocker(blockers,"AUDIT_PATHWAY_DEPLOYMENTS_MISSING");
  }else if(sourceBlock&&destinationBlock){
    deployments={sourceOApp:null,destinationOApp:null,sourceAdapter:null,destinationAdapter:null};
    let oappArtifact,adapterArtifact;
    try{
      oappArtifact=parseAuditContractArtifact(input.oappArtifactText,"TreasuryPolicyOApp");
      adapterArtifact=parseAuditContractArtifact(input.adapterArtifactText,"SentinelDVNAdapter");
    }catch{addBlocker(blockers,"AUDIT_DEPLOYMENT_ARTIFACT_MISMATCH")}
    if(oappArtifact&&adapterArtifact){
      const manifestDeployment=input.manifest.deployment;
      const network=input.policyBinding.network;
      const verifications=await Promise.allSettled([
        verifyDeploymentEvidence({artifact:oappArtifact,buildManifestText:input.buildManifestText,deployment:manifestDeployment.sourceOApp,clients:sourcePair.clients,observationBlock:sourceBlock,expectedChainId:11155111,expected:{endpoint:input.manifest.source.contracts.endpointV2}}),
        verifyDeploymentEvidence({artifact:oappArtifact,buildManifestText:input.buildManifestText,deployment:manifestDeployment.destinationOApp,clients:destinationPair.clients,observationBlock:destinationBlock,expectedChainId:421614,expected:{endpoint:input.manifest.destination.contracts.endpointV2}}),
        verifyDeploymentEvidence({artifact:adapterArtifact,buildManifestText:input.buildManifestText,deployment:manifestDeployment.sourceAdapter,clients:sourcePair.clients,observationBlock:sourceBlock,expectedChainId:11155111,expected:{messageLib:network.source.contracts.sendUln302,verificationTarget:network.source.contracts.receiveUln302,supportedDstEid:input.manifest.destination.eid,signers:manifestDeployment.authorizedSigners,quorum:3}}),
        verifyDeploymentEvidence({artifact:adapterArtifact,buildManifestText:input.buildManifestText,deployment:manifestDeployment.destinationAdapter,clients:destinationPair.clients,observationBlock:destinationBlock,expectedChainId:421614,expected:{messageLib:network.destination.contracts.sendUln302,verificationTarget:network.destination.contracts.receiveUln302,supportedDstEid:input.manifest.destination.eid,signers:manifestDeployment.authorizedSigners,quorum:3}})
      ]);
      const keys= ["sourceOApp","destinationOApp","sourceAdapter","destinationAdapter"]as const;
      verifications.forEach((result,index)=>{
        const key=keys[index]!;
        if(result.status==="fulfilled")deployments![key]=deploymentPublic(result.value);
        else{
          const pair=key.startsWith("source")?sourcePair:destinationPair;
          const chain=key.startsWith("source")?"source":"destination";
          if(hasTransportFailure(pair)){addBlocker(blockers,"AUDIT_RPC_UNAVAILABLE");agreement[chain]=false}
          else if(deploymentResultsDisagree(pair)){addBlocker(blockers,"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement[chain]=false}
          else if(deploymentEvidenceMissing(pair))addBlocker(blockers,"AUDIT_DEPLOYMENT_EVIDENCE_MISSING");
          else addBlocker(blockers,"AUDIT_DEPLOYMENT_ARTIFACT_MISMATCH");
        }
      });
    }

    const [sourceReads,destinationReads]=await Promise.all([
      Promise.allSettled(sourcePair.clients.map(client=>readSourcePathObservation({
        endpoint:lower(input.manifest.source.contracts.endpointV2)as Hex,
        sourceOApp:lower(input.manifest.deployment!.sourceOApp.address)as Hex,
        dstEid:input.manifest.destination.eid,
        adapter:lower(input.manifest.deployment!.sourceAdapter.address)as Hex,
        authorizedSigners:input.manifest.deployment!.authorizedSigners.map(value=>lower(value)as Hex)
      },pinnedReader(client,sourceBlock!)))),
      Promise.allSettled(destinationPair.clients.map(client=>readDestinationPathObservation({
        endpoint:lower(input.manifest.destination.contracts.endpointV2)as Hex,
        oapp:lower(input.manifest.deployment!.destinationOApp.address)as Hex,
        srcEid:input.manifest.source.eid,
        adapter:lower(input.manifest.deployment!.destinationAdapter.address)as Hex,
        authorizedSigners:input.manifest.deployment!.authorizedSigners.map(value=>lower(value)as Hex)
      },pinnedReader(client,destinationBlock!))))
    ]);
    sourcePath=normalizeAgreedSource(sourceReads,blockers,sourcePair,agreement);
    destinationPath=normalizeAgreedDestination(destinationReads,blockers,destinationPair,agreement);
  }

  const stability=await Promise.allSettled([
    sourceBlock?assertPinnedBlockStable(sourcePair.clients,sourceBlock):Promise.resolve(),
    destinationBlock?assertPinnedBlockStable(destinationPair.clients,destinationBlock):Promise.resolve()
  ]);
  if(sourceBlock&&stability[0].status==="rejected"){addBlocker(blockers,"AUDIT_BLOCK_UNSTABLE");agreement.source=false}
  if(destinationBlock&&stability[1].status==="rejected"){addBlocker(blockers,"AUDIT_BLOCK_UNSTABLE");agreement.destination=false}

  const evaluated=evaluatePathwayInvariants({
    manifest:input.manifest,policyBinding:input.policyBinding,source:sourcePath,destination:destinationPath,deployments,
    additionalBlockers:blockers.slice(input.policyBinding.blockers.length)
  });
  const configurationSha256=sourcePath&&destinationPath?sha256(canonicalJson({destination:destinationPath,source:sourcePath})):null;
  const sourceDigest=sourceBlock?sha256(canonicalJson({
    block:sourceBlock,deployments:deployments?{adapter:deployments.sourceAdapter,oapp:deployments.sourceOApp}:null,
    officialCode:officialCode.source,path:sourcePath
  })):null;
  const destinationDigest=destinationBlock?sha256(canonicalJson({
    block:destinationBlock,deployments:deployments?{adapter:deployments.destinationAdapter,oapp:deployments.destinationOApp}:null,
    officialCode:officialCode.destination,path:destinationPath
  })):null;
  return{
    status:evaluated.status,truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",
    repositoryBindingSha256:input.policyBinding.repositoryBindingSha256,
    rpcIndependence:{...input.policyBinding.rpcIndependence},
    providerAgreement:{
      source:{state:agreement.source?"TWO_TRANSPORTS_AGREE":"PROVIDER_DISAGREEMENT",providers:sourcePair.identities,resultSha256:sourceDigest},
      destination:{state:agreement.destination?"TWO_TRANSPORTS_AGREE":"PROVIDER_DISAGREEMENT",providers:destinationPair.identities,resultSha256:destinationDigest}
    },
    blocks:{source:sourceBlock,destination:destinationBlock},officialCode,deployments,
    source:sourcePath,destination:destinationPath,configurationSha256,blockers:evaluated.blockers
  };
}

export function evaluatePathwayInvariants(input:PathwayInvariantInput):{status:PathwayAuditStatus;blockers:PathwayAuditBlocker[]}{
  const blockers=[...input.policyBinding.blockers,...(input.additionalBlockers??[])];
  const deployment=input.manifest.deployment;
  if(deployment===null){addBlocker(blockers,"AUDIT_PATHWAY_DEPLOYMENTS_MISSING");return{status:status(blockers),blockers:sortBlockers(blockers)}}
  const source=input.source,destination=input.destination;
  if(!source||!destination)return{status:status(blockers),blockers:sortBlockers(blockers)};

  if(source.isDefaultSendLibrary||destination.isDefaultReceiveLibrary)addBlocker(blockers,"AUDIT_DEFAULT_LIBRARY");
  if(inherited(source.uln)||inherited(destination.rawAppUln))addBlocker(blockers,"AUDIT_INHERITED_ULN_CONFIG");
  if(!source.supportedEid||!destination.supportedEid)addBlocker(blockers,"AUDIT_UNSUPPORTED_EID");
  if(source.destinationPeer!==addressPeer(deployment.destinationOApp.address)||destination.sourcePeer!==addressPeer(deployment.sourceOApp.address))addBlocker(blockers,"AUDIT_PEER_MISMATCH");
  if(!sameAddress(source.executor.address,input.manifest.source.contracts.executor))addBlocker(blockers,"AUDIT_EXECUTOR_MISMATCH");
  if(source.uln.confirmations!==String(input.manifest.confirmationPolicy.source)||
    destination.rawAppUln.confirmations!==String(input.manifest.confirmationPolicy.destination)||
    !sameUln(destination.rawAppUln,destination.resolvedUln))addBlocker(blockers,"AUDIT_ULN_MISMATCH");

  const configurations=[source.uln,destination.rawAppUln,destination.resolvedUln];
  if(configurations.some(value=>!orderedDvnConfiguration(value)))addBlocker(blockers,"AUDIT_DVN_ORDER_INVALID");
  if(configurations.some(value=>!validThreshold(value)))addBlocker(blockers,"AUDIT_DVN_THRESHOLD_INVALID");
  if(hasDead(source.uln,input.manifest.source.contracts.deadDvn)||
    hasDead(destination.rawAppUln,input.manifest.destination.contracts.deadDvn)||
    hasDead(destination.resolvedUln,input.manifest.destination.contracts.deadDvn))addBlocker(blockers,"AUDIT_DEAD_DVN_PRESENT");
  if(!matchingCrossPath(source.uln,destination.rawAppUln,deployment.sourceAdapter.address,deployment.destinationAdapter.address))addBlocker(blockers,"AUDIT_ULN_MISMATCH");

  const sentinelPostures=[
    sentinelPosture(source.uln,deployment.sourceAdapter.address),
    sentinelPosture(destination.rawAppUln,deployment.destinationAdapter.address),
    sentinelPosture(destination.resolvedUln,deployment.destinationAdapter.address)
  ];
  if(sentinelPostures.some(value=>!value.optional))addBlocker(blockers,"AUDIT_SENTINEL_NOT_OPTIONAL");
  if(sentinelPostures.some(value=>value.soleEffective))addBlocker(blockers,"AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER");

  const network=input.policyBinding.network;
  if(!adapterMatches(source.adapter,deployment.sourceAdapter.address,network.source.contracts.sendUln302,network.source.contracts.receiveUln302,input.manifest.destination.eid)||
    !adapterMatches(destination.adapter,deployment.destinationAdapter.address,network.destination.contracts.sendUln302,network.destination.contracts.receiveUln302,input.manifest.destination.eid))addBlocker(blockers,"AUDIT_ADAPTER_BINDING_MISMATCH");
  if(!signerMappingsMatch(source.adapter,deployment.authorizedSigners)||!signerMappingsMatch(destination.adapter,deployment.authorizedSigners)||
    !deploymentSignersMatch(input.deployments?.sourceAdapter,deployment.authorizedSigners)||
    !deploymentSignersMatch(input.deployments?.destinationAdapter,deployment.authorizedSigners))addBlocker(blockers,"AUDIT_SIGNER_MEMBERSHIP_MISMATCH");
  return{status:status(blockers),blockers:sortBlockers(blockers)};
}

function trackPair(clients:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient],expected:PathwayAuditManifest["source"]["rpcs"]):TrackedPair{
  const records:[RecordedRpcCall[],RecordedRpcCall[]]=[[],[]];
  const identities=clients.map(client=>safeDescriptor(client))as ProviderAgreementObservation["providers"];
  const wrapped=clients.map((client,index)=>({
    descriptor:()=>({...identities[index]!}),
    async call(method:ReadOnlyRpcMethod,params:unknown[]):Promise<unknown>{
      const record:RecordedRpcCall={method,params:safeClone(params)};records[index]!.push(record);
      try{const result=await client.call(method,params);record.result=safeClone(result);return result}
      catch(error){record.errorCode=error instanceof PathwayAuditError?error.code:"PATHWAY_AUDIT_OBSERVATION_FAILED";throw error}
    }
  }))as[ReadOnlyRpcClient,ReadOnlyRpcClient];
  const descriptorValid=identities.every((identity,index)=>{
    const endpoint=expected[index];return!!endpoint&&identity.label===endpoint.label&&identity.originSha256===endpoint.originSha256&&identity.operatorFamily===endpoint.operatorFamily;
  });
  const distinct=clients[0]!==clients[1]&&identities[0].originSha256!==identities[1].originSha256&&identities[0].operatorFamily!==identities[1].operatorFamily;
  return{clients:wrapped,records,identities,descriptorValid,distinct};
}

function safeDescriptor(client:ReadOnlyRpcClient):ProviderAgreementObservation["providers"][number]{
  try{const value=client.descriptor();return{label:String(value.label),originSha256:String(value.originSha256),operatorFamily:String(value.operatorFamily)}}
  catch{return{label:"",originSha256:"",operatorFamily:""}}
}

function classifyBlockFailure(pair:TrackedPair,expectedChainId:number,blockers:PathwayAuditBlocker[]):void{
  if(hasTransportFailure(pair))addBlocker(blockers,"AUDIT_RPC_UNAVAILABLE");
  else if(chainResponses(pair).some(value=>value!==BigInt(expectedChainId)))addBlocker(blockers,"AUDIT_CHAIN_MISMATCH");
  else addBlocker(blockers,"AUDIT_BLOCK_DISAGREEMENT");
}

async function observeCode(
  name:string,address:string,expectedHash:string|null,pair:TrackedPair,block:PinnedBlockObservation,
  blockers:PathwayAuditBlocker[],agreement:{source:boolean;destination:boolean},chain:"source"|"destination"
):Promise<RuntimeCodeObservation>{
  const results=await Promise.allSettled(pair.clients.map(client=>client.call("eth_getCode",[address,eip1898(block)])));
  if(results.some(result=>result.status==="rejected")){
    addBlocker(blockers,hasTransportFailure(pair)?"AUDIT_RPC_UNAVAILABLE":"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement[chain]=false;
    return{name,address,byteLength:null,runtimeCodeKeccak256:null,identity:"PROVIDER_DISAGREEMENT"};
  }
  const values=results.map(result=>codeValue((result as PromiseFulfilledResult<unknown>).value));
  if(values[0]===null||values[1]===null){addBlocker(blockers,"AUDIT_CODE_MISSING");return{name,address,byteLength:null,runtimeCodeKeccak256:null,identity:"CODE_MISSING"}}
  if(values[0]!==values[1]){addBlocker(blockers,"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement[chain]=false;return{name,address,byteLength:null,runtimeCodeKeccak256:null,identity:"PROVIDER_DISAGREEMENT"}}
  const digest=keccak256(values[0]!);
  if(expectedHash===null||digest!==expectedHash){addBlocker(blockers,"AUDIT_CODE_IDENTITY_UNPROVEN");return{name,address,byteLength:(values[0]!.length-2)/2,runtimeCodeKeccak256:digest,identity:"CODE_PRESENT_IDENTITY_UNPROVEN"}}
  return{name,address,byteLength:(values[0]!.length-2)/2,runtimeCodeKeccak256:digest,identity:"CODE_IDENTITY_REVIEWED"};
}

function normalizeAgreedSource(
  results:PromiseSettledResult<SourcePathObservation>[],blockers:PathwayAuditBlocker[],pair:TrackedPair,agreement:{source:boolean}
):PublicSourcePathObservation|null{
  if(results.some(result=>result.status==="rejected")){addBlocker(blockers,hasTransportFailure(pair)?"AUDIT_RPC_UNAVAILABLE":"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement.source=false;return null}
  const values=results.map(result=>publicSource((result as PromiseFulfilledResult<SourcePathObservation>).value));
  if(canonicalJson(values[0])!==canonicalJson(values[1])){addBlocker(blockers,"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement.source=false;return null}
  return values[0]!;
}

function normalizeAgreedDestination(
  results:PromiseSettledResult<DestinationPathObservation>[],blockers:PathwayAuditBlocker[],pair:TrackedPair,agreement:{destination:boolean}
):PublicDestinationPathObservation|null{
  if(results.some(result=>result.status==="rejected")){addBlocker(blockers,hasTransportFailure(pair)?"AUDIT_RPC_UNAVAILABLE":"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement.destination=false;return null}
  const values=results.map(result=>publicDestination((result as PromiseFulfilledResult<DestinationPathObservation>).value));
  if(canonicalJson(values[0])!==canonicalJson(values[1])){addBlocker(blockers,"AUDIT_PROVIDER_RESULT_DISAGREEMENT");agreement.destination=false;return null}
  return values[0]!;
}

function pinnedReader(client:ReadOnlyRpcClient,block:PinnedBlockObservation):PinnedStateReader{
  const reference=eip1898(block);
  return{
    getCode:async address=>await client.call("eth_getCode",[address,reference])as Hex,
    call:async(to,data)=>await client.call("eth_call",[{to,data},reference])as Hex
  };
}

function publicSource(value:SourcePathObservation):PublicSourcePathObservation{return{
  endpoint:value.endpoint,sourceOApp:value.sourceOApp,dstEid:value.dstEid,sendLibrary:value.sendLibrary,
  isDefaultSendLibrary:value.isDefaultSendLibrary,supportedEid:value.supportedEid,uln:publicUln(value.uln),
  dvnCodeKeccak256:value.dvnCodeKeccak256.map(entry=>({...entry})),executor:{...value.executor},
  destinationPeer:value.destinationPeer,adapter:publicAdapter(value.adapter)
}}
function publicDestination(value:DestinationPathObservation):PublicDestinationPathObservation{return{
  endpoint:value.endpoint,oapp:value.oapp,srcEid:value.srcEid,receiveLibrary:value.receiveLibrary,
  isDefaultReceiveLibrary:value.isDefaultReceiveLibrary,supportedEid:value.supportedEid,
  rawAppUln:publicUln(value.rawAppUln),resolvedUln:publicUln(value.resolvedUln),sourcePeer:value.sourcePeer,
  adapter:publicAdapter(value.adapter)
}}
function publicUln(value:{confirmations:bigint;requiredDvns:string[];optionalDvns:string[];optionalDvnThreshold:number}):PublicUlnObservation{return{
  confirmations:String(value.confirmations),requiredDvns:[...value.requiredDvns],optionalDvns:[...value.optionalDvns],optionalDvnThreshold:value.optionalDvnThreshold
}}
function publicAdapter(value:{address:string;messageLib:string;verificationTarget:string;supportedDstEid:number;quorum:bigint;signersAuthorized:boolean[]}):PublicAdapterObservation{return{
  address:value.address,messageLib:value.messageLib,verificationTarget:value.verificationTarget,supportedDstEid:value.supportedDstEid,
  quorum:String(value.quorum),signersAuthorized:[...value.signersAuthorized]
}}
function deploymentPublic(value:VerifiedDeploymentEvidence):PublicDeploymentEvidence{return safeClone(value)as unknown as PublicDeploymentEvidence}

function adapterMatches(value:PublicAdapterObservation,address:string,messageLib:string,target:string,eid:number):boolean{return sameAddress(value.address,address)&&sameAddress(value.messageLib,messageLib)&&sameAddress(value.verificationTarget,target)&&value.supportedDstEid===eid&&value.quorum==="3"}
function signerMappingsMatch(value:PublicAdapterObservation,signers:readonly string[]):boolean{return value.quorum==="3"&&value.signersAuthorized.length===signers.length&&value.signersAuthorized.every(Boolean)}
function deploymentSignersMatch(value:PublicDeploymentEvidence|null|undefined,signers:readonly string[]):boolean{
  const argumentsValue=value?.constructorArguments;
  if(!argumentsValue||!("signers"in argumentsValue)||argumentsValue.quorum!=="3"||argumentsValue.signers.length!==5)return false;
  return argumentsValue.signers.every((signer,index)=>sameAddress(signer,signers[index]!));
}
function inherited(value:PublicUlnObservation):boolean{return value.confirmations==="0"&&value.requiredDvns.length===0&&value.optionalDvns.length===0&&value.optionalDvnThreshold===0}
function sameUln(left:PublicUlnObservation,right:PublicUlnObservation):boolean{return canonicalJson(left)===canonicalJson(right)}
function orderedDvnConfiguration(value:PublicUlnObservation):boolean{
  const combined=[...value.requiredDvns,...value.optionalDvns].map(lower);
  return strictOrder(value.requiredDvns)&&strictOrder(value.optionalDvns)&&new Set(combined).size===combined.length;
}
function strictOrder(values:string[]):boolean{return values.every((value,index)=>index===0||lower(value)>lower(values[index-1]!))}
function validThreshold(value:PublicUlnObservation):boolean{return value.optionalDvns.length===0?value.optionalDvnThreshold===0:value.optionalDvnThreshold>=1&&value.optionalDvnThreshold<=value.optionalDvns.length}
function hasDead(value:PublicUlnObservation,dead:string):boolean{return[...value.requiredDvns,...value.optionalDvns].some(address=>sameAddress(address,dead))}
function matchingCrossPath(source:PublicUlnObservation,destination:PublicUlnObservation,sourceSentinel:string,destinationSentinel:string):boolean{return sameAddresses(source.requiredDvns,destination.requiredDvns)&&
  sameAddresses(normalizedOptional(source.optionalDvns,sourceSentinel),normalizedOptional(destination.optionalDvns,destinationSentinel))&&
  source.optionalDvnThreshold===destination.optionalDvnThreshold
}
function normalizedOptional(values:string[],sentinel:string):string[]{return values.map(value=>sameAddress(value,sentinel)?"SENTINEL_OPTIONAL":lower(value)).sort()}
function sentinelPosture(value:PublicUlnObservation,sentinel:string):{optional:boolean;soleEffective:boolean}{
  const required=value.requiredDvns.some(address=>sameAddress(address,sentinel));
  const optional=value.optionalDvns.filter(address=>sameAddress(address,sentinel)).length===1;
  return{optional:optional&&!required,soleEffective:optional&&value.requiredDvns.length===0&&value.optionalDvnThreshold<=1};
}

function hasTransportFailure(pair:TrackedPair):boolean{return pair.records.some(records=>records.some(record=>record.errorCode==="PATHWAY_AUDIT_TRANSPORT_FAILED"))}
function chainResponses(pair:TrackedPair):bigint[]{
  const values:bigint[]=[];for(const records of pair.records)for(const record of records)if(record.method==="eth_chainId"&&typeof record.result==="string")try{values.push(BigInt(record.result))}catch{return[]}
  return values;
}
function deploymentResultsDisagree(pair:TrackedPair):boolean{
  for(const method of["eth_getTransactionByHash","eth_getTransactionReceipt"]as const){
    const first=resultsByParameter(pair.records[0],method),second=resultsByParameter(pair.records[1],method);
    for(const[key,value]of first)if(second.has(key)&&stableUnknown(value)!==stableUnknown(second.get(key)))return true;
  }
  return false;
}
function deploymentEvidenceMissing(pair:TrackedPair):boolean{return pair.records.some(records=>records.some(record=>(record.method==="eth_getTransactionByHash"||record.method==="eth_getTransactionReceipt")&&(record.result===null||record.result===undefined||record.errorCode!==undefined)))}
function resultsByParameter(records:RecordedRpcCall[],method:ReadOnlyRpcMethod):Map<string,unknown>{
  const result=new Map<string,unknown>();for(const record of records)if(record.method===method)result.set(stableUnknown(record.params),record.result);return result;
}

function codeValue(value:unknown):string|null{if(typeof value!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)||/^0x0*$/i.test(value))return null;return value.toLowerCase()}
function addressPeer(value:string):string{return`0x${"0".repeat(24)}${value.slice(2).toLowerCase()}`}
function sameAddress(left:string,right:string):boolean{return lower(left)===lower(right)}
function sameAddresses(left:string[],right:string[]):boolean{return left.length===right.length&&left.every((value,index)=>lower(value)===lower(right[index]!))}
function lower(value:string):string{return value.toLowerCase()}
function sha256(value:string):string{return createHash("sha256").update(value).digest("hex")}
function safeClone<T>(value:T):T{try{return structuredClone(value)}catch{return value}}
function stableUnknown(value:unknown):string{return JSON.stringify(stableValue(value))}
function stableValue(value:unknown):unknown{
  if(typeof value==="bigint")return String(value);
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>[key,stableValue(item)]));
  return value;
}
function addBlocker(value:PathwayAuditBlocker[],code:PathwayAuditBlocker["code"]):void{
  const[category,remediation]=blockerDefinitions[code],candidate={code,category,remediation};
  if(!value.some(blocker=>blocker.code===code&&blocker.category===category&&blocker.remediation===remediation))value.push(candidate);
}
function sortBlockers(value:PathwayAuditBlocker[]):PathwayAuditBlocker[]{return value.sort((left,right)=>`${left.category}:${left.code}:${left.remediation}`.localeCompare(`${right.category}:${right.code}:${right.remediation}`))}
function status(blockers:PathwayAuditBlocker[]):PathwayAuditStatus{
  const precedence:readonly[PathwayAuditBlocker["category"],PathwayAuditStatus][]= [
    ["INPUT_BINDING","BLOCKED_INPUT_BINDING"],["RPC_INDEPENDENCE","BLOCKED_RPC_INDEPENDENCE"],
    ["RPC_CONSENSUS","BLOCKED_RPC_CONSENSUS"],["CODE_IDENTITY","BLOCKED_CODE_IDENTITY"],
    ["PATHWAY_CONFIGURATION","BLOCKED_PATHWAY_CONFIGURATION"]
  ];
  return precedence.find(([category])=>blockers.some(blocker=>blocker.category===category))?.[1]??"OBSERVED_PATHWAY_CONSISTENT";
}
