import{createHash}from"node:crypto";
import{getAddress}from"ethers";
import{canonicalJson,parseCanonicalJsonDocument,parseJsonDocument}from"./canonical-json.js";
import{
  type PathwayAuditBlocker,
  type PathwayAuditManifest
}from"./pathway-audit-model.js";
import{isPathwayAuditPublicIdentifier}from"./pathway-audit-public-identifier.js";

export interface PathwayAuditorPolicy{
  schemaVersion:1;
  toolVersion:"sentinel-pathway-auditor/v1";
  maximumProviderAuditAgeDays:number;
  networkConfig:"config/networks.json";
  networkAuditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md";
  providerAudit:"config/rpc-provider-audit.json";
  dvnOperatorAudit:"config/dvn-operator-audit.json";
  officialRuntimeCodeAudit:"config/official-runtime-code-audit.json";
  pathway:{source:string;destination:string};
  officialRuntimeCodeKeccak256:{
    sourceEndpointV2:string|null;sourceSendUln302:string|null;sourceExecutor:string|null;
    destinationEndpointV2:string|null;destinationReceiveUln302:string|null;
  };
}

export interface ReviewedProvider{
  label:string;
  operatorFamily:string;
  originSha256:string;
  operatorEvidenceSha256:string;
  sources:string[];
}

export interface ReviewedDvn{
  chain:"ethereum-sepolia"|"arbitrum-sepolia";
  chainId:11155111|421614;
  address:string;
  operatorFamily:string;
  operatorEvidenceSha256:string;
  sources:string[];
}

export interface ReviewedRuntimeCode{
  name:RuntimeCodeName;
  chainId:number;
  eid:number;
  address:string;
  runtimeCodeKeccak256:string;
  layerZeroV2SourceRevision:string;
  deploymentAddressSourceSha256:string;
  sourceReleaseSourceSha256:string;
  block:{number:number;hash:string};
}

export interface RuntimeCodePrimarySource{
  kind:"OFFICIAL_DEPLOYMENT_ADDRESS"|"OFFICIAL_SOURCE_RELEASE";
  url:string;
  rawSha256:string;
}

export interface PathwayAuditPolicyInput{
  manifest:PathwayAuditManifest;
  policyText:string;
  networksText:string;
  networkAuditEvidenceText:string;
  providerAuditText:string;
  dvnOperatorAuditText:string;
  officialRuntimeCodeAuditText:string;
  evaluationDate:string;
}

type ProviderEvidenceState="OPERATOR_EVIDENCE_MISSING"|"OPERATOR_EVIDENCE_REVIEWED";
type OperatorIndependence="OPERATOR_INDEPENDENCE_UNPROVEN"|"OPERATOR_INDEPENDENCE_REVIEWED";

export interface PathwayAuditPolicyBinding{
  networkAuditSha256:string;
  providerAuditSha256:string;
  dvnOperatorAuditSha256:string;
  officialRuntimeCodeAuditSha256:string;
  repositoryBindingSha256:string;
  network:{
    source:NetworkValues;
    destination:NetworkValues;
  };
  officialRuntimeCodeKeccak256:PathwayAuditorPolicy["officialRuntimeCodeKeccak256"];
  officialRuntimeCodeReview:Record<RuntimeCodeName,RuntimeCodeReview>;
  providerState:{
    source:{label:string;state:ProviderEvidenceState}[];
    destination:{label:string;state:ProviderEvidenceState}[];
  };
  rpcIndependence:{source:OperatorIndependence;destination:OperatorIndependence};
  reviewedDvns:{source:ReviewedDvn[];destination:ReviewedDvn[]};
  blockers:PathwayAuditBlocker[];
}

interface NetworkValues{
  chainId:number;
  eid:number;
  contracts:{endpointV2:string;sendUln302:string;receiveUln302:string;executor:string;deadDvn:string};
}

interface ProviderAudit{
  schemaVersion:1;
  auditDate:string;
  status:"NO_PROVIDER_OPERATORS_REVIEWED"|"PROVIDER_OPERATORS_REVIEWED";
  providers:ReviewedProvider[];
  sources:string[];
  warning:string;
}

interface DvnOperatorAudit{
  schemaVersion:1;
  auditDate:string;
  status:"NO_DVN_OPERATORS_REVIEWED"|"DVN_OPERATORS_REVIEWED";
  dvns:ReviewedDvn[];
  sources:string[];
  warning:string;
}

type RuntimeCodeName="sourceEndpointV2"|"sourceSendUln302"|"sourceExecutor"|"destinationEndpointV2"|"destinationReceiveUln302";
type RuntimeCodeReview={state:"UNREVIEWED"}|({state:"REVIEWED"}&ReviewedRuntimeCode&{
  deploymentAddressSource:RuntimeCodePrimarySource;
  sourceReleaseSource:RuntimeCodePrimarySource;
});

interface RuntimeCodeAudit{
  schemaVersion:1;
  status:"NO_RUNTIME_CODE_IDENTITIES_REVIEWED"|"RUNTIME_CODE_IDENTITIES_REVIEWED";
  entries:ReviewedRuntimeCode[];
  sources:RuntimeCodePrimarySource[];
  warning:string;
}

const digestPattern=/^[a-f0-9]{64}$/;
const expectedSource="ethereum-sepolia",expectedDestination="arbitrum-sepolia";
const runtimeCodeNames:[RuntimeCodeName,...RuntimeCodeName[]]=[
  "destinationEndpointV2","destinationReceiveUln302","sourceEndpointV2","sourceExecutor","sourceSendUln302"
];

export function parsePathwayAuditorPolicy(text:string):PathwayAuditorPolicy{
  try{
    const root=record(parseJsonDocument(text));
    exactKeys(root,["schemaVersion","toolVersion","maximumProviderAuditAgeDays","networkConfig","networkAuditEvidence","providerAudit","dvnOperatorAudit","officialRuntimeCodeAudit","pathway","officialRuntimeCodeKeccak256"]);
    const pathway=record(root.pathway),official=record(root.officialRuntimeCodeKeccak256);
    exactKeys(pathway,["source","destination"]);
    exactKeys(official,["sourceEndpointV2","sourceSendUln302","sourceExecutor","destinationEndpointV2","destinationReceiveUln302"]);
    if(root.schemaVersion!==1||root.toolVersion!=="sentinel-pathway-auditor/v1"||
      !positiveInteger(root.maximumProviderAuditAgeDays)||root.networkConfig!=="config/networks.json"||
      root.networkAuditEvidence!=="docs/research/2026-08-02-layerzero-interface-conformance-audit.md"||
      root.providerAudit!=="config/rpc-provider-audit.json"||root.dvnOperatorAudit!=="config/dvn-operator-audit.json"||root.officialRuntimeCodeAudit!=="config/official-runtime-code-audit.json"||
      !nonempty(pathway.source)||!nonempty(pathway.destination))invalid();
    return{
      schemaVersion:1,toolVersion:"sentinel-pathway-auditor/v1",maximumProviderAuditAgeDays:root.maximumProviderAuditAgeDays,
      networkConfig:"config/networks.json",networkAuditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
      providerAudit:"config/rpc-provider-audit.json",dvnOperatorAudit:"config/dvn-operator-audit.json",officialRuntimeCodeAudit:"config/official-runtime-code-audit.json",
      pathway:{source:pathway.source,destination:pathway.destination},
      officialRuntimeCodeKeccak256:{
        sourceEndpointV2:codeHash(official.sourceEndpointV2),sourceSendUln302:codeHash(official.sourceSendUln302),sourceExecutor:codeHash(official.sourceExecutor),
        destinationEndpointV2:codeHash(official.destinationEndpointV2),destinationReceiveUln302:codeHash(official.destinationReceiveUln302)
      }
    };
  }catch(error){if(error instanceof PathwayAuditPolicyError)throw error;return invalid()}
}

export function bindPathwayAuditPolicy(input:PathwayAuditPolicyInput):PathwayAuditPolicyBinding{
  const policy=parsePathwayAuditorPolicy(input.policyText),evaluationDate=date(input.evaluationDate);
  const networks=parseNetworks(input.networksText),providerAudit=parseProviderAudit(input.providerAuditText);
  const dvnOperatorAudit=parseDvnOperatorAudit(input.dvnOperatorAuditText);
  const runtimeCodeAudit=parseRuntimeCodeAudit(input.officialRuntimeCodeAuditText,policy,networks);
  const networkAuditSha256=sha256(canonicalJson({
    destination:expectedDestination,
    networkAuditEvidenceSha256:sha256(input.networkAuditEvidenceText),
    networkConfigSha256:sha256(input.networksText),
    source:expectedSource
  }));
  const providerAuditSha256=sha256(input.providerAuditText);
  const dvnOperatorAuditSha256=sha256(input.dvnOperatorAuditText);
  const officialRuntimeCodeAuditSha256=sha256(input.officialRuntimeCodeAuditText);
  const repositoryBindingSha256=sha256(canonicalJson({
    dvnOperatorAuditSha256,networkAuditSha256,officialRuntimeCodeAuditSha256,pathwayAuditorPolicySha256:sha256(input.policyText),providerAuditSha256
  }));
  const blockers:PathwayAuditBlocker[]=[];
  const metadataMatches=policy.pathway.source===expectedSource&&policy.pathway.destination===expectedDestination&&
    networks.auditEvidence===policy.networkAuditEvidence&&input.manifest.networkAuditSha256===networkAuditSha256&&
    manifestMatchesNetwork(input.manifest,networks);
  if(!metadataMatches)blockers.push(blocker("AUDIT_NETWORK_METADATA_MISMATCH","INPUT_BINDING","RECHECK_NETWORK_AUDIT"));
  if(daysBetween(networks.auditDate,evaluationDate)<0)blockers.push(blocker("AUDIT_NETWORK_AUDIT_STALE","INPUT_BINDING","RECHECK_NETWORK_AUDIT"));
  const auditAge=daysBetween(providerAudit.auditDate,evaluationDate);
  const providerStale=auditAge<0||auditAge>policy.maximumProviderAuditAgeDays;
  if(providerStale)blockers.push(blocker("AUDIT_PROVIDER_EVIDENCE_STALE","RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"));
  const source=providerBinding(input.manifest.source.rpcs,providerAudit,providerStale,blockers);
  const destination=providerBinding(input.manifest.destination.rpcs,providerAudit,providerStale,blockers);
  return{
    networkAuditSha256,providerAuditSha256,dvnOperatorAuditSha256,officialRuntimeCodeAuditSha256,repositoryBindingSha256,
    network:{source:networks.source,destination:networks.destination},
    officialRuntimeCodeKeccak256:{...policy.officialRuntimeCodeKeccak256},
    officialRuntimeCodeReview:runtimeCodeBinding(runtimeCodeAudit),
    providerState:{source:source.state,destination:destination.state},
    rpcIndependence:{source:source.independence,destination:destination.independence},
    reviewedDvns:{
      source:dvnOperatorAudit.dvns.filter(value=>value.chain===expectedSource).map(detachDvn),
      destination:dvnOperatorAudit.dvns.filter(value=>value.chain===expectedDestination).map(detachDvn)
    },
    blockers:sortBlockers(blockers)
  };
}

function providerBinding(endpoints:PathwayAuditManifest["source"]["rpcs"],audit:ProviderAudit,stale:boolean,blockers:PathwayAuditBlocker[]):{
  state:{label:string;state:ProviderEvidenceState}[];independence:OperatorIndependence;
}{
  const matched=endpoints.map(endpoint=>audit.providers.find(provider=>
    provider.label===endpoint.label&&provider.originSha256===endpoint.originSha256&&
    provider.operatorFamily===endpoint.operatorFamily&&provider.operatorEvidenceSha256!=="0".repeat(64)
  ));
  const state=endpoints.map((endpoint,index)=>({
    label:endpoint.label,state:matched[index]&&!stale?"OPERATOR_EVIDENCE_REVIEWED":"OPERATOR_EVIDENCE_MISSING" as ProviderEvidenceState
  }));
  if(!stale)for(const value of state)if(value.state==="OPERATOR_EVIDENCE_MISSING")blockers.push(blocker("AUDIT_PROVIDER_EVIDENCE_MISSING","RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"));
  const matchedFamilies=matched.map(value=>value?.operatorFamily).filter((value):value is string=>Boolean(value));
  const auditedFamilies=endpoints.map(endpoint=>audit.providers.find(provider=>
    provider.label===endpoint.label&&provider.originSha256===endpoint.originSha256&&provider.operatorEvidenceSha256!=="0".repeat(64)
  )?.operatorFamily).filter((value):value is string=>Boolean(value));
  if(auditedFamilies.length===2&&new Set(auditedFamilies).size!==2){
    blockers.push(blocker("AUDIT_PROVIDER_OPERATOR_DUPLICATED","RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"));
  }
  return{state,independence:!stale&&matchedFamilies.length===2&&new Set(matchedFamilies).size===2?"OPERATOR_INDEPENDENCE_REVIEWED":"OPERATOR_INDEPENDENCE_UNPROVEN"};
}

function parseNetworks(text:string):{auditDate:string;auditEvidence:string;source:NetworkValues;destination:NetworkValues}{
  const root=record(parseJsonDocument(text));
  exactKeys(root,["auditDate","status","auditEvidence","pathway","pathwayValidation","warning"]);
  if(root.status!=="AUDITED_CONTRACT_METADATA_NOT_PATHWAY_VALIDATED"||!nonempty(root.auditEvidence)||!nonempty(root.warning))invalid();
  const pathway=record(root.pathway),validation=record(root.pathwayValidation);
  exactKeys(pathway,[expectedSource,expectedDestination]);
  exactKeys(validation,["ethereumSepoliaToArbitrumSepolia","arbitrumSepoliaToEthereumSepolia","dvnSelection","oappConfiguration"]);
  return{auditDate:date(root.auditDate),auditEvidence:root.auditEvidence,source:network(pathway[expectedSource]),destination:network(pathway[expectedDestination])};
}

function network(value:unknown):NetworkValues{
  const root=record(value),confirmations=record(root.confirmations);
  exactKeys(root,["chainId","eid","endpointV2","sendUln302","receiveUln302","executor","deadDvn","confirmations","source"]);
  exactKeys(confirmations,["prototypeTestValue","unapprovedSecurityReviewCandidate"]);
  if(!positiveInteger(root.chainId)||!positiveInteger(root.eid)||!nonempty(root.source)||!positiveInteger(confirmations.prototypeTestValue)||!positiveInteger(confirmations.unapprovedSecurityReviewCandidate))invalid();
  return{chainId:root.chainId,eid:root.eid,contracts:{endpointV2:address(root.endpointV2),sendUln302:address(root.sendUln302),receiveUln302:address(root.receiveUln302),executor:address(root.executor),deadDvn:address(root.deadDvn)}};
}

function parseProviderAudit(text:string):ProviderAudit{
  const root=record(parseJsonDocument(text));
  exactKeys(root,["schemaVersion","auditDate","status","providers","sources","warning"]);
  if(root.schemaVersion!==1||!nonempty(root.warning)||!Array.isArray(root.providers)||!Array.isArray(root.sources)||
    (root.status!=="NO_PROVIDER_OPERATORS_REVIEWED"&&root.status!=="PROVIDER_OPERATORS_REVIEWED"))invalid();
  const providers=root.providers.map(provider),sources=root.sources.map(source);
  if(new Set(providers.map(value=>value.label)).size!==providers.length||new Set(sources).size!==sources.length||
    (root.status==="NO_PROVIDER_OPERATORS_REVIEWED"&&(providers.length!==0||sources.length!==0))||
    (root.status==="PROVIDER_OPERATORS_REVIEWED"&&(providers.length===0||sources.length===0)))invalid();
  return{schemaVersion:1,auditDate:date(root.auditDate),status:root.status,providers,sources,warning:root.warning};
}

function parseDvnOperatorAudit(text:string):DvnOperatorAudit{
  try{
    const root=record(parseCanonicalJsonDocument(text));
    exactKeys(root,["schemaVersion","auditDate","status","dvns","sources","warning"]);
    if(root.schemaVersion!==1||!nonempty(root.warning)||!Array.isArray(root.dvns)||!Array.isArray(root.sources)||
      (root.status!=="NO_DVN_OPERATORS_REVIEWED"&&root.status!=="DVN_OPERATORS_REVIEWED"))invalid();
    const dvns=root.dvns.map(dvn),sources=root.sources.map(source);
    if(new Set(sources).size!==sources.length||!strictStrings(sources)||
      new Set(dvns.map(value=>`${value.chain}:${lowerAddress(value.address)}`)).size!==dvns.length||
      dvns.some(value=>value.sources.some(item=>!sources.includes(item)))||
      (root.status==="NO_DVN_OPERATORS_REVIEWED"&&(dvns.length!==0||sources.length!==0))||
      (root.status==="DVN_OPERATORS_REVIEWED"&&(dvns.length===0||sources.length===0)))invalid();
    return{schemaVersion:1,auditDate:date(root.auditDate),status:root.status,dvns,sources,warning:root.warning};
  }catch(error){if(error instanceof PathwayAuditPolicyError)throw error;return invalid()}
}

function parseRuntimeCodeAudit(text:string,policy:PathwayAuditorPolicy,networks:{source:NetworkValues;destination:NetworkValues}):RuntimeCodeAudit{
  try{
    const root=record(parseCanonicalJsonDocument(text));
    exactKeys(root,["schemaVersion","status","entries","sources","warning"]);
    if(root.schemaVersion!==1||!Array.isArray(root.entries)||!Array.isArray(root.sources)||!nonempty(root.warning)||
      (root.status!=="NO_RUNTIME_CODE_IDENTITIES_REVIEWED"&&root.status!=="RUNTIME_CODE_IDENTITIES_REVIEWED"))invalid();
    const sources=root.sources.map(runtimeCodeSource),entries=root.entries.map(runtimeCodeEntry);
    if(!strictRuntimeCodeEntries(entries)||(root.status==="RUNTIME_CODE_IDENTITIES_REVIEWED"&&!strictRuntimeCodeSources(sources))||
      entries.some(entry=>!runtimeCodeSourcesForEntry(entry,sources))||
      (root.status==="NO_RUNTIME_CODE_IDENTITIES_REVIEWED"&&(entries.length!==0||sources.length!==0))||
      (root.status==="RUNTIME_CODE_IDENTITIES_REVIEWED"&&(entries.length===0||sources.length===0)))invalid();
    for(const name of runtimeCodeNames){
      const entry=entries.find(value=>value.name===name),pin=policy.officialRuntimeCodeKeccak256[name];
      if((entry===undefined)!==(pin===null)||entry&&entry.runtimeCodeKeccak256!==pin)invalid();
      if(entry){
        const expected=runtimeCodeLocation(name,networks);
        if(entry.chainId!==expected.chainId||entry.eid!==expected.eid||entry.address!==expected.address)invalid();
      }
    }
    return{schemaVersion:1,status:root.status,entries,sources,warning:root.warning};
  }catch(error){if(error instanceof PathwayAuditPolicyError)throw error;return invalid()}
}

function runtimeCodeSource(value:unknown):RuntimeCodePrimarySource{
  const root=record(value);exactKeys(root,["kind","url","rawSha256"]);
  if(root.kind!=="OFFICIAL_DEPLOYMENT_ADDRESS"&&root.kind!=="OFFICIAL_SOURCE_RELEASE")invalid();
  return{kind:root.kind,url:httpsUrl(root.url),rawSha256:nonzeroDigest(root.rawSha256)};
}

function runtimeCodeEntry(value:unknown):ReviewedRuntimeCode{
  const root=record(value);exactKeys(root,["name","chainId","eid","address","runtimeCodeKeccak256","layerZeroV2SourceRevision","deploymentAddressSourceSha256","sourceReleaseSourceSha256","block"]);
  if(!runtimeCodeNames.includes(root.name as RuntimeCodeName)||!positiveInteger(root.chainId)||!positiveInteger(root.eid)||!isPathwayAuditPublicIdentifier(root.layerZeroV2SourceRevision))invalid();
  const block=record(root.block);exactKeys(block,["number","hash"]);
  if(!positiveInteger(block.number))invalid();
  return{
    name:root.name as RuntimeCodeName,chainId:root.chainId,eid:root.eid,address:address(root.address),
    runtimeCodeKeccak256:codeHash(root.runtimeCodeKeccak256)??invalid(),layerZeroV2SourceRevision:root.layerZeroV2SourceRevision,
    deploymentAddressSourceSha256:nonzeroDigest(root.deploymentAddressSourceSha256),sourceReleaseSourceSha256:nonzeroDigest(root.sourceReleaseSourceSha256),
    block:{number:block.number,hash:codeHash(block.hash)??invalid()}
  };
}

function strictRuntimeCodeSources(values:RuntimeCodePrimarySource[]):boolean{
  return values.length===2&&values[0]?.kind==="OFFICIAL_DEPLOYMENT_ADDRESS"&&values[1]?.kind==="OFFICIAL_SOURCE_RELEASE"&&
    values[0].url!==values[1].url&&values[0].rawSha256!==values[1].rawSha256;
}

function strictRuntimeCodeEntries(values:ReviewedRuntimeCode[]):boolean{
  return values.every((value,index)=>index===0||value.name>values[index-1]!.name)&&
    new Set(values.map(value=>value.name)).size===values.length;
}

function runtimeCodeLocation(name:RuntimeCodeName,networks:{source:NetworkValues;destination:NetworkValues}):{chainId:number;eid:number;address:string}{
  const sourceName=name.startsWith("source"),network=sourceName?networks.source:networks.destination;
  const contract=name==="sourceEndpointV2"||name==="destinationEndpointV2"?"endpointV2":
    name==="sourceSendUln302"?"sendUln302":name==="sourceExecutor"?"executor":"receiveUln302";
  return{chainId:network.chainId,eid:network.eid,address:network.contracts[contract]};
}

function runtimeCodeBinding(audit:RuntimeCodeAudit):Record<RuntimeCodeName,RuntimeCodeReview>{
  const binding={}as Record<RuntimeCodeName,RuntimeCodeReview>;
  for(const name of runtimeCodeNames){
    const entry=audit.entries.find(value=>value.name===name);
    if(!entry){binding[name]={state:"UNREVIEWED"};continue}
    const deploymentAddressSource=audit.sources.find(source=>source.kind==="OFFICIAL_DEPLOYMENT_ADDRESS");
    const sourceReleaseSource=audit.sources.find(source=>source.kind==="OFFICIAL_SOURCE_RELEASE");
    if(!deploymentAddressSource||!sourceReleaseSource)invalid();
    binding[name]={...entry,block:{...entry.block},deploymentAddressSource:{...deploymentAddressSource},sourceReleaseSource:{...sourceReleaseSource},state:"REVIEWED"};
  }
  return binding;
}

function runtimeCodeSourcesForEntry(entry:ReviewedRuntimeCode,sources:RuntimeCodePrimarySource[]):boolean{
  const deploymentAddressSource=sources.find(source=>source.kind==="OFFICIAL_DEPLOYMENT_ADDRESS");
  const sourceReleaseSource=sources.find(source=>source.kind==="OFFICIAL_SOURCE_RELEASE");
  return Boolean(deploymentAddressSource&&sourceReleaseSource&&
    deploymentAddressSource.rawSha256===entry.deploymentAddressSourceSha256&&sourceReleaseSource.rawSha256===entry.sourceReleaseSourceSha256);
}

function dvn(value:unknown):ReviewedDvn{
  const root=record(value);
  exactKeys(root,["chain","chainId","address","operatorFamily","operatorEvidenceSha256","sources"]);
  const chain=root.chain,chainId=root.chainId;
  if((chain!==expectedSource&&chain!==expectedDestination)||
    (chain===expectedSource&&chainId!==11155111)||(chain===expectedDestination&&chainId!==421614)||
    !isPathwayAuditPublicIdentifier(root.operatorFamily)||!Array.isArray(root.sources))invalid();
  const sources=root.sources.map(source);
  if(sources.length===0||new Set(sources).size!==sources.length||!strictStrings(sources))invalid();
  return{
    chain,chainId:chainId as 11155111|421614,address:address(root.address),operatorFamily:root.operatorFamily,
    operatorEvidenceSha256:nonzeroDigest(root.operatorEvidenceSha256),sources
  };
}

function detachDvn(value:ReviewedDvn):ReviewedDvn{return{...value,sources:[...value.sources]}}

function provider(value:unknown):ReviewedProvider{
  const root=record(value);exactKeys(root,["label","operatorFamily","originSha256","operatorEvidenceSha256","sources"]);
  if(!isPathwayAuditPublicIdentifier(root.label)||!isPathwayAuditPublicIdentifier(root.operatorFamily)||!Array.isArray(root.sources))invalid();
  const sources=root.sources.map(source);
  if(sources.length===0||new Set(sources).size!==sources.length)invalid();
  return{label:root.label,operatorFamily:root.operatorFamily,originSha256:digest(root.originSha256),operatorEvidenceSha256:digest(root.operatorEvidenceSha256),sources};
}

function source(value:unknown):string{if(!nonempty(value))invalid();return value}
function strictStrings(values:string[]):boolean{return values.every((value,index)=>index===0||value>values[index-1]!)}
function lowerAddress(value:string):string{return value.toLowerCase()}

function manifestMatchesNetwork(manifest:PathwayAuditManifest,networks:{source:NetworkValues;destination:NetworkValues}):boolean{
  const source=manifest.source,destination=manifest.destination;
  return source.name===expectedSource&&destination.name===expectedDestination&&
    source.chainId===networks.source.chainId&&source.eid===networks.source.eid&&
    source.contracts.endpointV2===networks.source.contracts.endpointV2&&source.contracts.sendUln302===networks.source.contracts.sendUln302&&
    source.contracts.executor===networks.source.contracts.executor&&source.contracts.deadDvn===networks.source.contracts.deadDvn&&
    destination.chainId===networks.destination.chainId&&destination.eid===networks.destination.eid&&
    destination.contracts.endpointV2===networks.destination.contracts.endpointV2&&destination.contracts.receiveUln302===networks.destination.contracts.receiveUln302&&
    destination.contracts.deadDvn===networks.destination.contracts.deadDvn;
}

function blocker(code:PathwayAuditBlocker["code"],category:PathwayAuditBlocker["category"],remediation:PathwayAuditBlocker["remediation"]):PathwayAuditBlocker{return{code,category,remediation}}
function sortBlockers(value:PathwayAuditBlocker[]):PathwayAuditBlocker[]{return value.sort((left,right)=>`${left.category}:${left.code}:${left.remediation}`.localeCompare(`${right.category}:${right.code}:${right.remediation}`))}
function sha256(value:string):string{return createHash("sha256").update(value).digest("hex")}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))invalid();return value as Record<string,unknown>}
function exactKeys(value:Record<string,unknown>,expected:string[]):void{const actual=Object.keys(value).sort(),wanted=[...expected].sort();if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))invalid()}
function nonempty(value:unknown):value is string{return typeof value==="string"&&value.length>0}
function positiveInteger(value:unknown):value is number{return typeof value==="number"&&Number.isSafeInteger(value)&&value>0}
function digest(value:unknown):string{if(typeof value!=="string"||!digestPattern.test(value))invalid();return value}
function nonzeroDigest(value:unknown):string{const result=digest(value);if(result==="0".repeat(64))invalid();return result}
function codeHash(value:unknown):string|null{if(value===null)return null;if(typeof value!=="string"||!/^0x[0-9a-f]{64}$/.test(value))invalid();return value}
function address(value:unknown):string{if(typeof value!=="string")invalid();try{if(getAddress(value)!==value)invalid();return value}catch{return invalid()}}
function httpsUrl(value:unknown):string{
  if(typeof value!=="string")invalid();
  try{const parsed=new URL(value);if(parsed.protocol!=="https:"||!parsed.hostname||parsed.username||parsed.password||parsed.search||parsed.hash)invalid();return value}catch{return invalid()}
}
function date(value:unknown):string{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid();const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)invalid();return value}
function daysBetween(start:string,end:string):number{return(Math.round(Date.parse(`${end}T00:00:00.000Z`)-Date.parse(`${start}T00:00:00.000Z`))/86400000)}
function invalid():never{throw new PathwayAuditPolicyError()}

export class PathwayAuditPolicyError extends Error{
  constructor(){super("PATHWAY_AUDIT_POLICY_INVALID")}
}
