import{getAddress}from"ethers";
import{parseCanonicalJsonDocument}from"./canonical-json.js";

export interface GenLayerFinalitySourceManifest{
  schemaVersion:1;
  sourceLabel:string;
  sourceOriginSha256:string;
  chainId:4221;
  policyContract:string;
  policyRecordMode:"latest-final";
  callDataCodec:"UNAPPROVED";
  reviewDate:string;
  acknowledgement:"REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION";
}
export class GenLayerFinalitySourceManifestError extends Error{
  constructor(){super("GENLAYER_FINALITY_SOURCE_MANIFEST_INVALID")}
}

const keys=["schemaVersion","sourceLabel","sourceOriginSha256","chainId","policyContract","policyRecordMode","callDataCodec","reviewDate","acknowledgement"];
const secret=/private|secret|mnemonic|seed|keystore|rpc|websocket|provider|wallet|token|credential/i;
const digest=/^[a-f0-9]{64}$/;

export function parseGenLayerFinalitySourceManifestText(text:string,today=currentDate()):GenLayerFinalitySourceManifest{
  try{return parseGenLayerFinalitySourceManifest(parseCanonicalJsonDocument(text),today)}
  catch(error){if(error instanceof GenLayerFinalitySourceManifestError)throw error;throw invalid()}
}
export function parseGenLayerFinalitySourceManifest(value:unknown,today=currentDate()):GenLayerFinalitySourceManifest{
  const root=record(value);rejectUnsafeKeys(root);
  if(!sameKeys(root,keys)||root.schemaVersion!==1||!label(root.sourceLabel)||!sha(root.sourceOriginSha256)||
    root.chainId!==4221||!address(root.policyContract)||root.policyRecordMode!=="latest-final"||
    root.callDataCodec!=="UNAPPROVED"||!reviewDate(root.reviewDate,today)||
    root.acknowledgement!=="REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION")throw invalid();
  return{
    schemaVersion:1,sourceLabel:root.sourceLabel,sourceOriginSha256:root.sourceOriginSha256,
    chainId:4221,policyContract:root.policyContract,policyRecordMode:"latest-final",
    callDataCodec:"UNAPPROVED",reviewDate:root.reviewDate,
    acknowledgement:"REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION"
  };
}
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
  return value as Record<string,unknown>;
}
function rejectUnsafeKeys(value:Record<string,unknown>):void{
  for(const key of Object.keys(value))if(secret.test(key))throw invalid();
}
function sameKeys(value:Record<string,unknown>,expected:string[]):boolean{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  return actual.length===wanted.length&&actual.every((key,index)=>key===wanted[index]);
}
function label(value:unknown):value is string{return typeof value==="string"&&/^[a-z0-9][a-z0-9-]{2,63}$/.test(value)}
function sha(value:unknown):value is string{return typeof value==="string"&&digest.test(value)&&!/^0{64}$/.test(value)}
function address(value:unknown):value is string{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))return false;
  try{return getAddress(value)===value}catch{return false}
}
function reviewDate(value:unknown,today:string):value is string{
  if(!date(value)||!date(today))return false;
  const delta=(Date.parse(`${today}T00:00:00Z`)-Date.parse(`${value}T00:00:00Z`))/86_400_000;
  return delta>=0&&delta<=7;
}
function date(value:unknown):value is string{
  if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const [year,month,day]=value.split("-").map(Number),parsed=new Date(Date.UTC(year!,month!-1,day!));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month!-1&&parsed.getUTCDate()===day;
}
function currentDate():string{return new Date().toISOString().slice(0,10)}
function invalid():GenLayerFinalitySourceManifestError{return new GenLayerFinalitySourceManifestError()}
