import{getAddress}from"ethers";
import{parseCanonicalJsonDocument}from"./canonical-json.js";
import{
  type AuditDeploymentManifest,
  type AuditRpcEndpoint,
  PathwayAuditError,
  type PathwayAuditManifest
}from"./pathway-audit-model.js";

export{PathwayAuditError}from"./pathway-audit-model.js";
export type{AuditDeploymentManifest,AuditRpcEndpoint,PathwayAuditManifest}from"./pathway-audit-model.js";

const topKeys=["schemaVersion","networkAuditSha256","source","destination","deployment","confirmationPolicy","acknowledgement"];
const secretKey=/(?:private|secret|mnemonic|seed|keystore|websocket|provider|wallet|signerkey|cloud|credential|token|password|apikey|rpc(?:url|key|token|password)|environment)/i;
const digestPattern=/^[a-f0-9]{64}$/;
const transactionHashPattern=/^0x[0-9a-fA-F]{64}$/;

export function parsePathwayAuditManifestText(text:string):PathwayAuditManifest{
  try{return parsePathwayAuditManifest(parseCanonicalJsonDocument(text))}
  catch(error){if(error instanceof PathwayAuditError)throw error;return invalid()}
}

export function parsePathwayAuditManifest(value:unknown):PathwayAuditManifest{
  try{
    rejectSecretKeys(value,new Set<object>());
    const root=record(value);exactKeys(root,topKeys);
    const source=record(root.source),destination=record(root.destination),confirmationPolicy=record(root.confirmationPolicy);
    exactKeys(source,["name","chainId","eid","observationLag","contracts","rpcs"]);
    exactKeys(destination,["name","chainId","eid","observationLag","contracts","rpcs"]);
    exactKeys(confirmationPolicy,["source","destination","label"]);
    const sourceContracts=record(source.contracts),destinationContracts=record(destination.contracts);
    exactKeys(sourceContracts,["endpointV2","sendUln302","executor","deadDvn"]);
    exactKeys(destinationContracts,["endpointV2","receiveUln302","deadDvn"]);
    if(root.schemaVersion!==1||
      source.name!=="ethereum-sepolia"||source.chainId!==11155111||source.eid!==40161||
      destination.name!=="arbitrum-sepolia"||destination.chainId!==421614||destination.eid!==40231||
      !observationLag(source.observationLag)||!observationLag(destination.observationLag)||
      confirmationPolicy.source!==15||confirmationPolicy.destination!==64||confirmationPolicy.label!=="UNAPPROVED_PROJECT_POLICY"||
      root.acknowledgement!=="READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED")return invalid();
    const parsedSourceRpcs=rpcs(source.rpcs),parsedDestinationRpcs=rpcs(destination.rpcs);
    const origins=[...parsedSourceRpcs,...parsedDestinationRpcs].map(value=>origin(value.url));
    if(new Set(origins).size!==origins.length)return invalid();
    return{
      schemaVersion:1,
      networkAuditSha256:digest(root.networkAuditSha256),
      source:{
        name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:source.observationLag,
        contracts:{endpointV2:address(sourceContracts.endpointV2),sendUln302:address(sourceContracts.sendUln302),executor:address(sourceContracts.executor),deadDvn:address(sourceContracts.deadDvn)},
        rpcs:parsedSourceRpcs
      },
      destination:{
        name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:destination.observationLag,
        contracts:{endpointV2:address(destinationContracts.endpointV2),receiveUln302:address(destinationContracts.receiveUln302),deadDvn:address(destinationContracts.deadDvn)},
        rpcs:parsedDestinationRpcs
      },
      deployment:deployment(root.deployment),
      confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
      acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
    };
  }catch(error){if(error instanceof PathwayAuditError)throw error;return invalid()}
}

function rejectSecretKeys(value:unknown,active:Set<object>):void{
  if(value===null||typeof value!=="object")return;
  if(active.has(value))invalid();
  active.add(value);
  try{
    for(const key of Reflect.ownKeys(value)){
      if(Array.isArray(value)&&key==="length")continue;
      if(typeof key!=="string")invalid();
      if(secretKey.test(key))throw new PathwayAuditError("PATHWAY_AUDIT_SECRET_FIELD_REJECTED");
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)invalid();
      rejectSecretKeys(descriptor.value,active);
    }
  }finally{active.delete(value)}
}

function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return invalid();
  return value as Record<string,unknown>;
}

function exactKeys(value:Record<string,unknown>,expected:string[]):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))invalid();
}

function observationLag(value:unknown):value is number{
  return typeof value==="number"&&Number.isInteger(value)&&value>=1&&value<=256;
}

function digest(value:unknown):string{
  if(typeof value!=="string"||!digestPattern.test(value)||/^0{64}$/.test(value))invalid();
  return value;
}

function address(value:unknown):string{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))invalid();
  try{if(getAddress(value)!==value)invalid()}catch{invalid()}
  return value;
}

function rpcs(value:unknown):[AuditRpcEndpoint,AuditRpcEndpoint]{
  if(!Array.isArray(value)||value.length!==2)return invalid();
  return[endpoint(value[0]),endpoint(value[1])];
}

function endpoint(value:unknown):AuditRpcEndpoint{
  const endpoint=record(value);exactKeys(endpoint,["label","url","operatorFamily","originSha256"]);
  if(!nonempty(endpoint.label)||!nonempty(endpoint.operatorFamily)||!url(endpoint.url))invalid();
  return{label:endpoint.label,url:endpoint.url,operatorFamily:endpoint.operatorFamily,originSha256:digest(endpoint.originSha256)};
}

function nonempty(value:unknown):value is string{return typeof value==="string"&&value.length>0}

function origin(value:string):string{return new URL(value).origin.toLowerCase()}

function url(value:unknown):value is string{
  if(typeof value!=="string"||/[\u0000-\u001f\u007f-\u009f]/.test(value))return false;
  try{
    const parsed=new URL(value),authority=/^https:\/\/([^/?#]*)/i.exec(value)?.[1];
    if(!authority||parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.search||parsed.hash||
      authority.includes("@")||authority.includes(":")||
      (parsed.pathname!=="/"&&parsed.pathname!=="/rpc"))return false;
    const hostname=parsed.hostname.toLowerCase();
    if(hostname==="localhost"||hostname.endsWith(".localhost")||ipv4(hostname))return false;
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname);
  }catch{return false}
}

function ipv4(value:string):boolean{
  const parts=value.split(".");
  return parts.length===4&&parts.every(part=>/^[0-9]+$/.test(part)&&Number(part)<=255);
}

function deployment(value:unknown):AuditDeploymentManifest{
  if(value===null)return null;
  const recordValue=record(value);
  exactKeys(recordValue,["sourceOApp","destinationOApp","sourceAdapter","destinationAdapter","authorizedSigners","quorum"]);
  if(recordValue.quorum!==3)return invalid();
  const sourceOApp=deployedOApp(recordValue.sourceOApp),destinationOApp=deployedOApp(recordValue.destinationOApp);
  const sourceAdapter=deployedAdapter(recordValue.sourceAdapter),destinationAdapter=deployedAdapter(recordValue.destinationAdapter);
  return{sourceOApp,destinationOApp,sourceAdapter,destinationAdapter,authorizedSigners:signers(recordValue.authorizedSigners),quorum:3};
}

function deployedOApp(value:unknown):{address:string;deploymentTxHash:string;delegate:string}{
  const deployment=record(value);exactKeys(deployment,["address","deploymentTxHash","delegate"]);
  return{address:address(deployment.address),deploymentTxHash:transactionHash(deployment.deploymentTxHash),delegate:address(deployment.delegate)};
}

function deployedAdapter(value:unknown):{address:string;deploymentTxHash:string}{
  const deployment=record(value);exactKeys(deployment,["address","deploymentTxHash"]);
  return{address:address(deployment.address),deploymentTxHash:transactionHash(deployment.deploymentTxHash)};
}

function transactionHash(value:unknown):string{
  if(typeof value!=="string"||!transactionHashPattern.test(value)||/^0x0{64}$/i.test(value))invalid();
  return value;
}

function signers(value:unknown):[string,string,string,string,string]{
  if(!Array.isArray(value)||value.length!==5)return invalid();
  const parsed=value.map(address);
  if(parsed.some((item,index)=>index>0&&item.toLowerCase()<=parsed[index-1]!.toLowerCase()))invalid();
  return[parsed[0]!,parsed[1]!,parsed[2]!,parsed[3]!,parsed[4]!];
}

function invalid():never{throw new PathwayAuditError("PATHWAY_AUDIT_MANIFEST_INVALID")}
