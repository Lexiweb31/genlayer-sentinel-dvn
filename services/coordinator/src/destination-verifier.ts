import{isIP}from"node:net";
import{AbiCoder,Interface}from"ethers";
import type{Hex}from"../../../packages/core/src/types.js";
import type{OutboxRecord}from"./verification-outbox.js";
export type DestinationConfirmation={status:"PENDING"}|{status:"CONFIRMED";confirmations:bigint}|{status:"FAILED";code:"RECEIPT_FAILED"|"PROVIDER_DISAGREEMENT"|"EVENT_MISMATCH"|"ADAPTER_UNUSED"|"RPC_UNAVAILABLE"};
export interface DestinationConfirmationVerifier{confirm(record:OutboxRecord):Promise<DestinationConfirmation>;}
export type DestinationRpc=(url:string,method:string,params:unknown[])=>Promise<unknown>;
interface Receipt{status:Hex;blockNumber:Hex;blockHash:Hex;logs:Array<{address:Hex;topics:Hex[];data:Hex}>;}
const adapterInterface=new Interface(["event Verified(bytes32 indexed guid,bytes32 indexed packetDigest,bytes32 evidenceDigest,bytes32 executionDigest)","function used(bytes32) view returns(bool)"]);
const topic=adapterInterface.getEvent("Verified")!.topicHash.toLowerCase();
export class IndependentDestinationVerifier implements DestinationConfirmationVerifier{
 private urls:string[];
 constructor(urls:string[],private adapter:Hex,private minimumConfirmations:bigint,private rpc:DestinationRpc){
  if(urls.length<2)throw new Error("at least two destination RPCs required");
  this.urls=urls.map(safeUrl);
  if(new Set(this.urls.map(value=>new URL(value).origin)).size!==this.urls.length)throw new Error("destination RPC origins must be independent");
  if(!/^0x[0-9a-fA-F]{40}$/.test(adapter)||/^0x0{40}$/i.test(adapter))throw new Error("invalid destination adapter");
  if(minimumConfirmations<=0n)throw new Error("destination confirmations must be positive");
 }
 async confirm(record:OutboxRecord):Promise<DestinationConfirmation>{
  if(!record.transactionHash)return{status:"PENDING"};
  try{
   const observations=await Promise.all(this.urls.map(async url=>{
    const receipt=await this.rpc(url,"eth_getTransactionReceipt",[record.transactionHash])as Receipt|null;
    if(!receipt)return{pending:true}as const;
    if(receipt.status!=="0x1")return{failed:true}as const;
    const latest=BigInt(await this.rpc(url,"eth_blockNumber",[])as Hex),block=BigInt(receipt.blockNumber),confirmations=latest>=block?latest-block+1n:0n;
    const event=receipt.logs.find(log=>log.address.toLowerCase()===this.adapter.toLowerCase()&&log.topics[0]?.toLowerCase()===topic);
    if(!event)return{receipt,confirmations,event:false,used:false};
    const parsed=adapterInterface.parseLog({topics:event.topics,data:event.data});
    const matches=!!parsed&&parsed.args.guid.toLowerCase()===record.guid.toLowerCase()&&parsed.args.packetDigest.toLowerCase()===record.envelope.packetDigest.toLowerCase()&&parsed.args.evidenceDigest.toLowerCase()===record.envelope.evidenceDigest.toLowerCase()&&parsed.args.executionDigest.toLowerCase()===record.digest.toLowerCase();
    const call=adapterInterface.encodeFunctionData("used",[record.digest]),raw=await this.rpc(url,"eth_call",[{to:this.adapter,data:call},"latest"]),[used]=AbiCoder.defaultAbiCoder().decode(["bool"],raw as Hex);
    return{receipt,confirmations,event:matches,used:Boolean(used)};
   }));
   if(observations.every(value=>"pending"in value))return{status:"PENDING"};
   if(observations.some(value=>"pending"in value)||observations.some(value=>"failed"in value)!==observations.every(value=>"failed"in value))return{status:"FAILED",code:"PROVIDER_DISAGREEMENT"};
   if(observations.every(value=>"failed"in value))return{status:"FAILED",code:"RECEIPT_FAILED"};
   const values=observations as Array<{receipt:Receipt;confirmations:bigint;event:boolean;used:boolean}>,first=values[0]!;
   if(values.some(value=>value.receipt.blockHash.toLowerCase()!==first.receipt.blockHash.toLowerCase()||value.receipt.blockNumber!==first.receipt.blockNumber))return{status:"FAILED",code:"PROVIDER_DISAGREEMENT"};
   if(values.some(value=>!value.event))return{status:"FAILED",code:"EVENT_MISMATCH"};
   if(values.some(value=>!value.used))return{status:"FAILED",code:"ADAPTER_UNUSED"};
   const confirmations=values.reduce((lowest,value)=>value.confirmations<lowest?value.confirmations:lowest,values[0]!.confirmations);
   if(confirmations<this.minimumConfirmations)return{status:"PENDING"};
   return{status:"CONFIRMED",confirmations};
  }catch{return{status:"FAILED",code:"RPC_UNAVAILABLE"};}
 }
}
function safeUrl(value:string):string{let url:URL;try{url=new URL(value)}catch{throw new Error("invalid destination RPC URL")}if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(url.hostname.replace(/^\[|\]$/g,""))!==0)throw new Error("destination RPC must be public HTTPS");return url.href;}
