import {ExecutionResult,TransactionStatus} from "genlayer-js/types";
import type {Hex,PolicyRequest,PolicyResult} from "../../../packages/core/src/types.js";
import type {GenLayerFinality} from "./coordinator.js";

type Tx={statusName?:TransactionStatus;txExecutionResultName?:ExecutionResult};
export interface GenLayerClientFacade {
  writeContract(args:{address:Hex;functionName:string;args:unknown[];value:bigint}):Promise<Hex>;
  getTransaction(args:{hash:Hex}):Promise<Tx>;
  readContract(args:{address:Hex;functionName:string;args:unknown[]}):Promise<unknown>;
}

/// @notice Non-blocking coordinator adapter. It never treats ACCEPTED or a failed finalized execution as approval.
export class GenLayerSdkFinality implements GenLayerFinality {
  private requests=new Map<string,PolicyRequest>();
  constructor(private client:GenLayerClientFacade,private contractAddress:Hex,private clock=()=>Math.floor(Date.now()/1000)){}
  async submit(request:PolicyRequest):Promise<string>{
    const p=request.packet,e=request.evidence;
    const hash=await this.client.writeContract({address:this.contractAddress,functionName:"evaluate",args:[p.guid,p.payloadHash,e.uri,e.digest,request.decodedAction,request.policy],value:0n});
    this.register(hash,request); return hash;
  }
  register(requestId:string,request:PolicyRequest):void{const key=requestId.toLowerCase(),existing=this.requests.get(key);if(existing&&binding(existing)!==binding(request))throw new Error("GenLayer request binding conflict");this.requests.set(key,request)}
  async finalized(requestId:string):Promise<PolicyResult|undefined>{
    const request=this.requests.get(requestId.toLowerCase()); if(!request) throw new Error("unknown GenLayer request");
    const tx=await this.client.getTransaction({hash:requestId as Hex});
    if(tx.statusName!==TransactionStatus.FINALIZED) return undefined;
    if(tx.txExecutionResultName!==ExecutionResult.FINISHED_WITH_RETURN) throw new Error("finalized GenLayer execution did not succeed");
    const raw=await this.client.readContract({address:this.contractAddress,functionName:"get_record",args:[request.packet.guid]});
    if(typeof raw!=="string") throw new Error("invalid GenLayer policy record");
    const [decision,packetDigest,evidenceDigest,policyVersion]=raw.split("|",5);
    if((decision!=="ALLOW"&&decision!=="DENY")||packetDigest?.toLowerCase()!==request.packet.payloadHash.toLowerCase()||evidenceDigest?.toLowerCase()!==request.evidence.digest.toLowerCase()||!policyVersion) throw new Error("GenLayer record binding mismatch");
    return {guid:request.packet.guid,packetDigest:request.packet.payloadHash,evidenceDigest:request.evidence.digest,decision,reasonCode:`GENLAYER_FINALIZED_${decision}`,finalizedAt:this.clock(),policyVersion};
  }
}
function binding(request:PolicyRequest):string{return JSON.stringify(request,(_,value)=>typeof value==="bigint"?value.toString():value)}
