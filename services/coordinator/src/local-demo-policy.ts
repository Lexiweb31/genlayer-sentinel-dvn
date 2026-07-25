import {keccak256,sha256,toUtf8Bytes} from "ethers";
import type {Hex,PolicyRequest,PolicyResult} from "../../../packages/core/src/types.js";
import type {GenLayerFinality} from "./coordinator.js";
import type {AuthoritativeEvidenceSource} from "./request-factory.js";

export const LOCAL_DEMO_EVIDENCE_URI="https://governance.fixture.invalid/authorization";

export interface LocalDemoAuthority {
  authorizationId:Hex;
  target:Hex;
  selector:Hex;
  approvedCalldata:Hex;
  policyVersion:"local-demo-v1";
  evidenceBody:string;
}

interface CanonicalAction {
  authorizationId:Hex;
  target:Hex;
  value:string;
  selector:Hex;
  calldata:Hex;
}

interface LocalRequest {
  binding:string;
  request:PolicyRequest;
  action:CanonicalAction;
  pending:boolean;
  result?:PolicyResult;
}

export class LocalDemoFinality implements GenLayerFinality {
  private authority:LocalDemoAuthority;
  private evidenceDigest:Hex;
  private requests=new Map<string,LocalRequest>();

  constructor(authority:LocalDemoAuthority,private clock=()=>Math.floor(Date.now()/1000)){
    this.authority=validateAuthority(authority);
    this.evidenceDigest=sha256(toUtf8Bytes(this.authority.evidenceBody)).toLowerCase() as Hex;
  }

  async submit(request:PolicyRequest):Promise<string>{
    const prepared=this.prepare(request);
    this.store(prepared.requestId,request,prepared.action);
    return prepared.requestId;
  }

  register(requestId:string,request:PolicyRequest):void{
    const prepared=this.prepare(request);
    if(prepared.requestId!==requestId.toLowerCase())throw new Error("local fixture request binding mismatch");
    this.store(prepared.requestId,request,prepared.action);
  }

  async finalized(requestId:string):Promise<PolicyResult|undefined>{
    const value=this.requests.get(requestId.toLowerCase());
    if(!value)throw new Error("unknown local fixture request");
    if(value.result)return value.result;
    if(value.pending){value.pending=false;return undefined}
    validateEvidence(value.request,this.evidenceDigest,this.clock());
    const allow=actionBinding(value.action)===actionBinding({
      authorizationId:this.authority.authorizationId,
      target:this.authority.target,
      value:"0",
      selector:this.authority.selector,
      calldata:this.authority.approvedCalldata
    });
    value.result={
      guid:value.request.packet.guid,
      packetDigest:value.request.packet.payloadHash,
      evidenceDigest:value.request.evidence.digest,
      decision:allow?"ALLOW":"DENY",
      reasonCode:allow?"LOCAL_FIXTURE_ALLOW":"LOCAL_FIXTURE_DENY",
      finalizedAt:this.clock(),
      policyVersion:this.authority.policyVersion
    };
    return value.result;
  }

  private prepare(request:PolicyRequest):{requestId:string;action:CanonicalAction}{
    validateRequestEnvelope(request);
    validateEvidence(request,this.evidenceDigest,this.clock());
    const action=parseAction(request.decodedAction);
    const requestId=keccak256(toUtf8Bytes(JSON.stringify({
      guid:request.packet.guid.toLowerCase(),
      packetDigest:request.packet.payloadHash.toLowerCase(),
      evidenceDigest:request.evidence.digest.toLowerCase(),
      action
    }))).toLowerCase();
    return{requestId,action};
  }

  private store(requestId:string,request:PolicyRequest,action:CanonicalAction):void{
    const binding=requestBinding(request),existing=this.requests.get(requestId);
    if(existing){
      if(existing.binding!==binding)throw new Error("local fixture request binding conflict");
      return;
    }
    this.requests.set(requestId,{binding,request,action,pending:true});
  }
}

export class LocalDemoEvidenceSource implements AuthoritativeEvidenceSource {
  private body:string;
  constructor(body:string){this.body=canonicalJson(body)}
  async read(uri:string):Promise<string>{
    if(uri!==LOCAL_DEMO_EVIDENCE_URI)throw new Error("unsupported local evidence URI");
    return this.body;
  }
}

function validateAuthority(value:LocalDemoAuthority):LocalDemoAuthority{
  const authorizationId=hash(value?.authorizationId,"invalid local authority authorization ID");
  const target=address(value?.target,"invalid local authority target");
  const selector=selectorValue(value?.selector,"invalid local authority selector");
  const approvedCalldata=calldataValue(value?.approvedCalldata,selector,"invalid local authority calldata");
  if(value?.policyVersion!=="local-demo-v1")throw new Error("invalid local authority policy version");
  const evidenceBody=canonicalJson(value?.evidenceBody);
  const evidence=JSON.parse(evidenceBody) as unknown;
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))throw new Error("invalid local authority evidence");
  const record=evidence as Record<string,unknown>;
  exactKeys(record,["authorizationId","target","value","selector","calldata","status","policyVersion"],"invalid local authority evidence");
  if(
    lower(record.authorizationId)!==authorizationId||
    lower(record.target)!==target||
    record.value!=="0"||
    lower(record.selector)!==selector||
    lower(record.calldata)!==approvedCalldata||
    record.status!=="AUTHORIZED"||
    record.policyVersion!=="local-demo-v1"
  )throw new Error("local authority evidence binding mismatch");
  return{authorizationId,target,selector,approvedCalldata,policyVersion:"local-demo-v1",evidenceBody};
}

function validateRequestEnvelope(request:PolicyRequest):void{
  if(!request||typeof request!=="object")throw new Error("invalid local fixture request");
  hash(request.packet?.guid,"invalid local fixture GUID");
  hash(request.packet?.payloadHash,"invalid local fixture packet digest");
  if(typeof request.policy!=="string"||!request.policy.trim()||request.policy.length>512)throw new Error("invalid local fixture policy");
}

function validateEvidence(request:PolicyRequest,expectedDigest:Hex,now:number):void{
  const evidence=request.evidence;
  if(evidence?.uri!==LOCAL_DEMO_EVIDENCE_URI)throw new Error("invalid local fixture evidence URI");
  if(hash(evidence.digest,"invalid local fixture evidence digest")!==expectedDigest)throw new Error("local fixture evidence digest mismatch");
  if(!Number.isSafeInteger(evidence.observedAt)||!Number.isSafeInteger(evidence.validUntil)||evidence.observedAt<0||evidence.observedAt>now||evidence.validUntil<=now)
    throw new Error("local fixture evidence is future-dated or expired");
}

function parseAction(input:string):CanonicalAction{
  try{
    const value=JSON.parse(input) as unknown;
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();
    const record=value as Record<string,unknown>;
    exactKeys(record,["authorizationId","target","value","selector","calldata"],"invalid decoded action");
    const authorizationId=hash(record.authorizationId,"invalid decoded action");
    const target=address(record.target,"invalid decoded action");
    if(typeof record.value!=="string"||! /^(0|[1-9][0-9]*)$/.test(record.value))throw new Error();
    const selector=selectorValue(record.selector,"invalid decoded action");
    const calldata=calldataValue(record.calldata,selector,"invalid decoded action");
    return{authorizationId,target,value:record.value,selector,calldata};
  }catch(error){
    if(error instanceof Error&&error.message==="invalid decoded action")throw error;
    throw new Error("invalid decoded action");
  }
}

function canonicalJson(value:unknown):string{
  if(typeof value!=="string"||!value.length)throw new Error("evidence body must be canonical JSON");
  try{if(JSON.stringify(JSON.parse(value))!==value)throw new Error()}catch{throw new Error("evidence body must be canonical JSON")}
  return value;
}
function actionBinding(value:CanonicalAction):string{return JSON.stringify(value)}
function requestBinding(value:PolicyRequest):string{return JSON.stringify(value,(_,item)=>typeof item==="bigint"?item.toString():item)}
function hash(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function address(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function selectorValue(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{8}$/.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function calldataValue(value:unknown,selector:Hex,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{72}$/.test(value)||value.slice(0,10).toLowerCase()!==selector)throw new Error(message);
  return value.toLowerCase() as Hex;
}
function exactKeys(value:Record<string,unknown>,expected:string[],message:string):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((item,index)=>item!==wanted[index]))throw new Error(message);
}
function lower(value:unknown):string|undefined{return typeof value==="string"?value.toLowerCase():undefined}
