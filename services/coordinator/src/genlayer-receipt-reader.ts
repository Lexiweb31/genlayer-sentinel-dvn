import type{Hex}from"../../../packages/core/src/types.js";
import{JsonRpcGenLayerStatusReader,type FetchLike}from"./genlayer-status-reader.js";

export interface GenLayerFinalizedReceipt{
  transactionId:Hex;
  recipient:Hex;
  statusCode:7;
  rawCallData:Hex;
  executionResult:number;
}

export class JsonRpcGenLayerReceiptReader{
  private readonly endpoint:string;
  private readonly status:JsonRpcGenLayerStatusReader;
  constructor(endpoint:string,private fetcher:FetchLike=fetch,private timeoutMs=10_000,private nextId=sequence()){
    let url:URL;
    try{url=new URL(endpoint)}catch{throw new Error("GenLayer receipt endpoint must be credential-free HTTPS")}
    if(url.protocol!=="https:"||url.username||url.password)throw new Error("GenLayer receipt endpoint must be credential-free HTTPS");
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw new Error("GenLayer receipt timeout must be positive");
    this.endpoint=url.href;
    this.status=new JsonRpcGenLayerStatusReader(this.endpoint,fetcher,timeoutMs,nextId);
  }
  async getFinalizedReceipt(transactionId:Hex,expectedRecipient:Hex):Promise<GenLayerFinalizedReceipt>{
    if(!address(expectedRecipient))throw new Error("invalid GenLayer receipt response");
    const status=await this.status.getTransactionStatus(transactionId);
    if(status.status!=="FINALIZED"||status.statusCode!==7)throw new Error("GenLayer receipt is not finalized");
    const id=this.nextId();
    let response:Response;
    try{response=await this.fetcher(this.endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),body:JSON.stringify({jsonrpc:"2.0",method:"gen_getTransactionReceipt",params:[{txId:transactionId}],id})})}
    catch{throw new Error("GenLayer receipt transport failed")}
    if(!response.ok)throw new Error("GenLayer receipt HTTP failure");
    let raw:unknown;
    try{raw=await response.json()}catch{throw new Error("invalid GenLayer receipt response")}
    return parseReceipt(raw,id,transactionId,expectedRecipient);
  }
}

function sequence():()=>number{let id=0;return()=>++id}
function parseReceipt(raw:unknown,id:number,transactionId:Hex,expectedRecipient:Hex):GenLayerFinalizedReceipt{
  if(!object(raw))throw invalid();
  if(raw.jsonrpc!=="2.0"||raw.id!==id)throw invalid();
  if(raw.error!==undefined)throw new Error("GenLayer receipt RPC failure");
  if(!object(raw.result))throw invalid();
  const result=raw.result;
  if(!hash(result.id)||!address(result.recipient)||result.status!==7||!hex(result.txCallData)||!integer(result.result))throw invalid();
  if(!same(result.id,transactionId)||!same(result.recipient,expectedRecipient))throw invalid();
  return{transactionId:result.id as Hex,recipient:result.recipient as Hex,statusCode:7,rawCallData:result.txCallData as Hex,executionResult:result.result as number};
}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value)}
function hash(value:unknown):value is string{return typeof value==="string"&&/^0x[0-9a-fA-F]{64}$/.test(value)}
function address(value:unknown):value is string{return typeof value==="string"&&/^0x[0-9a-fA-F]{40}$/.test(value)}
function hex(value:unknown):value is string{return typeof value==="string"&&/^0x(?:[0-9a-fA-F]{2})*$/.test(value)}
function integer(value:unknown):value is number{return typeof value==="number"&&Number.isSafeInteger(value)}
function same(left:string,right:string):boolean{return left.toLowerCase()===right.toLowerCase()}
function invalid():Error{return new Error("invalid GenLayer receipt response")}
