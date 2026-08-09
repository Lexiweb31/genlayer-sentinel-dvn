import{getAddress}from"ethers";
import{parseCanonicalJsonDocument}from"./canonical-json.js";

export type ReadinessClassification="LOCAL_ADAPTER_PROTOTYPE"|"LAYERZERO_DVN_CANDIDATE";
export interface ArtifactExpectation{abiSha256:string;creationBytecodeSha256:string}
export interface PathwayAuditExpectation{evidenceSha256:string}
export interface DeploymentReadinessManifest{
  schemaVersion:2;
  classification:ReadinessClassification;
  sourceCommit:string;
  audit:{date:string;evidenceSha256:string;networkConfigSha256:string};
  source:{name:"ethereum-sepolia";chainId:11155111;eid:40161};
  destination:{name:"arbitrum-sepolia";chainId:421614;eid:40231};
  owner:string;
  delegate:string;
  signers:[string,string,string,string,string];
  quorum:3;
  recoveryOperators:[string,string,string,string,string];
  confirmations:{source:15;destination:64;label:"UNAPPROVED_PROJECT_POLICY"};
  artifacts:{
    SentinelDVNAdapter:ArtifactExpectation;
    TreasuryPolicyOApp:ArtifactExpectation;
  };
  pathwayAudit:PathwayAuditExpectation|null;
  acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED";
}

export type ReadinessErrorCode="READINESS_MANIFEST_INVALID"|"READINESS_SECRET_FIELD_REJECTED";
export class ReadinessError extends Error{
  constructor(public readonly code:ReadinessErrorCode){super(code)}
}

const topKeys=[
  "schemaVersion","classification","sourceCommit","audit","source","destination","owner","delegate",
  "signers","quorum","recoveryOperators","confirmations","artifacts","pathwayAudit","acknowledgement"
];
const secretKey=/private|secret|mnemonic|seed|keystore|rpc|websocket|provider|wallet|signerkey|cloud|credential|token/i;
const commitPattern=/^[a-f0-9]{40}$/;
const digestPattern=/^[a-f0-9]{64}$/;

export function parseDeploymentReadinessManifestText(text:string):DeploymentReadinessManifest{
  try{return parseDeploymentReadinessManifest(parseCanonicalJsonDocument(text))}
  catch(error){if(error instanceof ReadinessError)throw error;throw new ReadinessError("READINESS_MANIFEST_INVALID")}
}

export function parseDeploymentReadinessManifest(value:unknown):DeploymentReadinessManifest{
  rejectSecretKeys(value,new Set<object>());
  const root=record(value);exactKeys(root,topKeys);
  const audit=record(root.audit),source=record(root.source),destination=record(root.destination);
  const confirmations=record(root.confirmations),artifacts=record(root.artifacts);
  const adapter=record(artifacts.SentinelDVNAdapter),oapp=record(artifacts.TreasuryPolicyOApp);
  exactKeys(audit,["date","evidenceSha256","networkConfigSha256"]);
  exactKeys(source,["name","chainId","eid"]);
  exactKeys(destination,["name","chainId","eid"]);
  exactKeys(confirmations,["source","destination","label"]);
  exactKeys(artifacts,["SentinelDVNAdapter","TreasuryPolicyOApp"]);
  exactKeys(adapter,["abiSha256","creationBytecodeSha256"]);
  exactKeys(oapp,["abiSha256","creationBytecodeSha256"]);
  const pathwayAudit=root.pathwayAudit===null?null:record(root.pathwayAudit);
  if(pathwayAudit)exactKeys(pathwayAudit,["evidenceSha256"]);
  if(root.schemaVersion!==2||
    (root.classification!=="LOCAL_ADAPTER_PROTOTYPE"&&root.classification!=="LAYERZERO_DVN_CANDIDATE")||
    !commit(root.sourceCommit)||!date(audit.date)||
    source.name!=="ethereum-sepolia"||source.chainId!==11155111||source.eid!==40161||
    destination.name!=="arbitrum-sepolia"||destination.chainId!==421614||destination.eid!==40231||
    root.quorum!==3||
    confirmations.source!==15||confirmations.destination!==64||confirmations.label!=="UNAPPROVED_PROJECT_POLICY"||
    root.acknowledgement!=="UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED")invalid();
  const signers=addresses(root.signers),recoveryOperators=addresses(root.recoveryOperators);
  if(signers.some(item=>recoveryOperators.includes(item)))invalid();
  return{
    schemaVersion:2,
    classification:root.classification,
    sourceCommit:root.sourceCommit,
    audit:{
      date:audit.date,
      evidenceSha256:digest(audit.evidenceSha256),
      networkConfigSha256:digest(audit.networkConfigSha256)
    },
    source:{name:"ethereum-sepolia",chainId:11155111,eid:40161},
    destination:{name:"arbitrum-sepolia",chainId:421614,eid:40231},
    owner:address(root.owner),
    delegate:address(root.delegate),
    signers,
    quorum:3,
    recoveryOperators,
    confirmations:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    artifacts:{
      SentinelDVNAdapter:{
        abiSha256:digest(adapter.abiSha256),
        creationBytecodeSha256:digest(adapter.creationBytecodeSha256)
      },
      TreasuryPolicyOApp:{
        abiSha256:digest(oapp.abiSha256),
        creationBytecodeSha256:digest(oapp.creationBytecodeSha256)
      }
    },
    pathwayAudit:pathwayAudit?{evidenceSha256:digest(pathwayAudit.evidenceSha256)}:null,
    acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED"
  };
}

function rejectSecretKeys(value:unknown,active:Set<object>):void{
  if(value===null||typeof value!=="object")return;
  if(active.has(value))invalid();
  active.add(value);
  try{
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=="string")invalid();
      if(Array.isArray(value)&&key==="length")continue;
      if(secretKey.test(key))throw new ReadinessError("READINESS_SECRET_FIELD_REJECTED");
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)invalid();
      rejectSecretKeys(descriptor.value,active);
    }
  }finally{active.delete(value)}
}
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))invalid();
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)invalid();
  return value as Record<string,unknown>;
}
function exactKeys(value:Record<string,unknown>,expected:string[]):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))invalid();
}
function date(value:unknown):value is string{
  if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const [year,month,day]=value.split("-").map(Number),parsed=new Date(Date.UTC(year!,month!-1,day!));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month!-1&&parsed.getUTCDate()===day;
}
function commit(value:unknown):value is string{
  return typeof value==="string"&&commitPattern.test(value)&&!/^0{40}$/.test(value);
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
function addresses(value:unknown):[string,string,string,string,string]{
  if(!Array.isArray(value)||value.length!==5)invalid();
  const parsed=value.map(address);
  if(parsed.some((item,index)=>index>0&&item.toLowerCase()<=parsed[index-1]!.toLowerCase()))invalid();
  return[parsed[0]!,parsed[1]!,parsed[2]!,parsed[3]!,parsed[4]!];
}
function invalid():never{throw new ReadinessError("READINESS_MANIFEST_INVALID")}
