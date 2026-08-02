import{createHash}from"node:crypto";
import{getAddress}from"ethers";
import{canonicalJson,parseJsonDocument}from"./canonical-json.js";
import{
  type PathwayAuditBlocker,
  type PathwayAuditManifest
}from"./pathway-audit-model.js";

export interface PathwayAuditorPolicy{
  schemaVersion:1;
  toolVersion:"sentinel-pathway-auditor/v1";
  maximumProviderAuditAgeDays:number;
  networkConfig:"config/networks.json";
  networkAuditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md";
  providerAudit:"config/rpc-provider-audit.json";
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

export interface PathwayAuditPolicyInput{
  manifest:PathwayAuditManifest;
  policyText:string;
  networksText:string;
  networkAuditEvidenceText:string;
  providerAuditText:string;
  evaluationDate:string;
}

type ProviderEvidenceState="OPERATOR_EVIDENCE_MISSING"|"OPERATOR_EVIDENCE_REVIEWED";
type OperatorIndependence="OPERATOR_INDEPENDENCE_UNPROVEN"|"OPERATOR_INDEPENDENCE_REVIEWED";

export interface PathwayAuditPolicyBinding{
  networkAuditSha256:string;
  providerAuditSha256:string;
  repositoryBindingSha256:string;
  network:{
    source:NetworkValues;
    destination:NetworkValues;
  };
  officialRuntimeCodeKeccak256:PathwayAuditorPolicy["officialRuntimeCodeKeccak256"];
  providerState:{
    source:{label:string;state:ProviderEvidenceState}[];
    destination:{label:string;state:ProviderEvidenceState}[];
  };
  rpcIndependence:{source:OperatorIndependence;destination:OperatorIndependence};
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

const digestPattern=/^[a-f0-9]{64}$/;
const expectedSource="ethereum-sepolia",expectedDestination="arbitrum-sepolia";

export function parsePathwayAuditorPolicy(text:string):PathwayAuditorPolicy{
  try{
    const root=record(parseJsonDocument(text));
    exactKeys(root,["schemaVersion","toolVersion","maximumProviderAuditAgeDays","networkConfig","networkAuditEvidence","providerAudit","pathway","officialRuntimeCodeKeccak256"]);
    const pathway=record(root.pathway),official=record(root.officialRuntimeCodeKeccak256);
    exactKeys(pathway,["source","destination"]);
    exactKeys(official,["sourceEndpointV2","sourceSendUln302","sourceExecutor","destinationEndpointV2","destinationReceiveUln302"]);
    if(root.schemaVersion!==1||root.toolVersion!=="sentinel-pathway-auditor/v1"||
      !positiveInteger(root.maximumProviderAuditAgeDays)||root.networkConfig!=="config/networks.json"||
      root.networkAuditEvidence!=="docs/research/2026-08-02-layerzero-interface-conformance-audit.md"||
      root.providerAudit!=="config/rpc-provider-audit.json"||!nonempty(pathway.source)||!nonempty(pathway.destination))invalid();
    return{
      schemaVersion:1,toolVersion:"sentinel-pathway-auditor/v1",maximumProviderAuditAgeDays:root.maximumProviderAuditAgeDays,
      networkConfig:"config/networks.json",networkAuditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
      providerAudit:"config/rpc-provider-audit.json",pathway:{source:pathway.source,destination:pathway.destination},
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
  const networkAuditSha256=sha256(canonicalJson({
    destination:expectedDestination,
    networkAuditEvidenceSha256:sha256(input.networkAuditEvidenceText),
    networkConfigSha256:sha256(input.networksText),
    source:expectedSource
  }));
  const providerAuditSha256=sha256(input.providerAuditText);
  const repositoryBindingSha256=sha256(canonicalJson({
    networkAuditSha256,pathwayAuditorPolicySha256:sha256(input.policyText),providerAuditSha256
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
    networkAuditSha256,providerAuditSha256,repositoryBindingSha256,
    network:{source:networks.source,destination:networks.destination},
    officialRuntimeCodeKeccak256:{...policy.officialRuntimeCodeKeccak256},
    providerState:{source:source.state,destination:destination.state},
    rpcIndependence:{source:source.independence,destination:destination.independence},
    blockers:sortBlockers(blockers)
  };
}

function providerBinding(endpoints:PathwayAuditManifest["source"]["rpcs"],audit:ProviderAudit,stale:boolean,blockers:PathwayAuditBlocker[]):{
  state:{label:string;state:ProviderEvidenceState}[];independence:OperatorIndependence;
}{
  const matched=endpoints.map(endpoint=>audit.providers.find(provider=>
    provider.label===endpoint.label&&provider.originSha256===endpoint.originSha256&&provider.operatorEvidenceSha256!=="0".repeat(64)
  ));
  const state=endpoints.map((endpoint,index)=>({
    label:endpoint.label,state:matched[index]&&!stale?"OPERATOR_EVIDENCE_REVIEWED":"OPERATOR_EVIDENCE_MISSING" as ProviderEvidenceState
  }));
  if(!stale)for(const value of state)if(value.state==="OPERATOR_EVIDENCE_MISSING")blockers.push(blocker("AUDIT_PROVIDER_EVIDENCE_MISSING","RPC_INDEPENDENCE","REVIEW_RPC_OPERATORS"));
  const matchedFamilies=matched.map(value=>value?.operatorFamily).filter((value):value is string=>Boolean(value));
  if(matchedFamilies.length===2&&new Set(matchedFamilies).size!==2){
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

function provider(value:unknown):ReviewedProvider{
  const root=record(value);exactKeys(root,["label","operatorFamily","originSha256","operatorEvidenceSha256","sources"]);
  if(!nonempty(root.label)||!nonempty(root.operatorFamily)||!Array.isArray(root.sources))invalid();
  const sources=root.sources.map(source);
  if(sources.length===0||new Set(sources).size!==sources.length)invalid();
  return{label:root.label,operatorFamily:root.operatorFamily,originSha256:digest(root.originSha256),operatorEvidenceSha256:digest(root.operatorEvidenceSha256),sources};
}

function source(value:unknown):string{if(!nonempty(value))invalid();return value}

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
function codeHash(value:unknown):string|null{if(value===null)return null;if(typeof value!=="string"||!/^0x[0-9a-f]{64}$/.test(value))invalid();return value}
function address(value:unknown):string{if(typeof value!=="string")invalid();try{if(getAddress(value)!==value)invalid();return value}catch{return invalid()}}
function date(value:unknown):string{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid();const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)invalid();return value}
function daysBetween(start:string,end:string):number{return(Math.round(Date.parse(`${end}T00:00:00.000Z`)-Date.parse(`${start}T00:00:00.000Z`))/86400000)}
function invalid():never{throw new PathwayAuditPolicyError()}

export class PathwayAuditPolicyError extends Error{
  constructor(){super("PATHWAY_AUDIT_POLICY_INVALID")}
}
