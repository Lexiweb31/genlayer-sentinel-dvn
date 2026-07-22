import type {Hex} from "../../../packages/core/src/types.js";

export const GENLAYER_STATUS_NAMES=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","FINALIZED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"] as const;
export type GenLayerStatusName=typeof GENLAYER_STATUS_NAMES[number];
export interface GenLayerConsensusStatus{status:GenLayerStatusName;statusCode:number}
export interface GenLayerStatusReader{getTransactionStatus(txId:Hex):Promise<GenLayerConsensusStatus>}
export type FetchLike=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;

export class JsonRpcGenLayerStatusReader implements GenLayerStatusReader{
  private readonly endpoint:string;
  constructor(endpoint:string,private fetcher:FetchLike=fetch,private timeoutMs=10_000,private nextId=sequence()){
    let url:URL;
    try{url=new URL(endpoint)}catch{throw new Error("GenLayer status endpoint must be credential-free HTTPS")}
    if(url.protocol!=="https:"||url.username||url.password)throw new Error("GenLayer status endpoint must be credential-free HTTPS");
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw new Error("GenLayer status timeout must be positive");
    this.endpoint=url.href;
  }
  async getTransactionStatus(txId:Hex):Promise<GenLayerConsensusStatus>{
    if(!/^0x[0-9a-fA-F]{64}$/.test(txId))throw new Error("invalid GenLayer transaction ID");
    const id=this.nextId();
    let response:Response;
    try{response=await this.fetcher(this.endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),body:JSON.stringify({jsonrpc:"2.0",method:"gen_getTransactionStatus",params:[{txId}],id})})}catch{throw new Error("GenLayer status transport failed")}
    if(!response.ok)throw new Error("GenLayer status HTTP failure");
    let raw:unknown;
    try{raw=await response.json()}catch{throw new Error("invalid GenLayer status response")}
    return parseStatus(raw,id);
  }
}

function sequence():()=>number{let id=0;return()=>++id}
function parseStatus(raw:unknown,id:number):GenLayerConsensusStatus{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("invalid GenLayer status response");
  const value=raw as Record<string,unknown>;
  if(value.jsonrpc!=="2.0"||value.id!==id)throw new Error("invalid GenLayer status response");
  if(value.error!==undefined)throw new Error("GenLayer status RPC failure");
  if(!value.result||typeof value.result!=="object"||Array.isArray(value.result))throw new Error("invalid GenLayer status response");
  const result=value.result as Record<string,unknown>;
  if(typeof result.status!=="string"||typeof result.statusCode!=="number"||!Number.isSafeInteger(result.statusCode))throw new Error("invalid GenLayer status response");
  const expected=GENLAYER_STATUS_NAMES[result.statusCode];
  if(expected===undefined||expected!==result.status)throw new Error("GenLayer status contradiction");
  return{status:expected,statusCode:result.statusCode};
}
