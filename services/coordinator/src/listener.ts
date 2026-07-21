import {Interface} from "ethers";
import type {Hex} from "../../../packages/core/src/types.js";
import type {ListenerStore} from "./listener-store.js";

export interface ChainLog {address:Hex;topics:Hex[];data:Hex;transactionHash:Hex;blockHash:Hex;blockNumber:bigint;logIndex:number;}
export interface BlockRef {number:bigint;hash:Hex;}
export interface LogSource {blockNumber():Promise<bigint>;block(number:bigint):Promise<BlockRef>;logs(from:bigint,to:bigint,addresses:Hex[],topics:Hex[]):Promise<ChainLog[]>;}
export interface DetectedPacket {transactionHash:Hex;blockHash:Hex;blockNumber:bigint;encodedPayload:Hex;options:Hex;sendLibrary:Hex;requiredDvns:Hex[];optionalDvns:Hex[];fees:bigint[];}
const endpointAbi=new Interface(["event PacketSent(bytes encodedPayload, bytes options, address sendLibrary)"]);
const feeAbi=new Interface(["event DVNFeePaid(address[] requiredDVNs,address[] optionalDVNs,uint256[] fees)"]);
const packetTopic=endpointAbi.getEvent("PacketSent")!.topicHash as Hex,feeTopic=feeAbi.getEvent("DVNFeePaid")!.topicHash as Hex;

export class PacketFeeListener {
  private cursor?:BlockRef;private seen=new Map<string,bigint>();private pending:DetectedPacket[]=[];private restored=false;
  constructor(private source:LogSource,private endpoint:Hex,private sendLibrary:Hex,private confirmations:bigint,private startBlock:bigint,private reorgLookback=64n,private store?:ListenerStore,private pathwayKey=`${endpoint.toLowerCase()}:${sendLibrary.toLowerCase()}`){}
  async poll():Promise<DetectedPacket[]>{
    await this.restore();
    if(this.pending.length)return this.sortedPending();
    const latest=await this.source.blockNumber();if(latest<this.confirmations)return[];const safe=latest-this.confirmations;
    let from=this.cursor?this.cursor.number+1n:this.startBlock;
    if(this.cursor){const canonical=await this.source.block(this.cursor.number);if(canonical.hash.toLowerCase()!==this.cursor.hash.toLowerCase()){from=this.cursor.number>this.reorgLookback?this.cursor.number-this.reorgLookback:0n;for(const [tx,b]of this.seen)if(b>=from)this.seen.delete(tx);this.pending=this.pending.filter(packet=>packet.blockNumber<from)}}
    if(from>safe)return[];const logs=await this.source.logs(from,safe,[this.endpoint,this.sendLibrary],[packetTopic,feeTopic]);const byTx=new Map<string,ChainLog[]>();for(const log of logs){const key=log.transactionHash.toLowerCase();const group=byTx.get(key)??[];group.push(log);byTx.set(key,group)}
    const out:DetectedPacket[]=[];for(const group of byTx.values()){const p=group.find(x=>x.address.toLowerCase()===this.endpoint.toLowerCase()&&x.topics[0]?.toLowerCase()===packetTopic.toLowerCase());const f=group.find(x=>x.address.toLowerCase()===this.sendLibrary.toLowerCase()&&x.topics[0]?.toLowerCase()===feeTopic.toLowerCase());if(!p||!f||this.seen.has(p.transactionHash.toLowerCase()))continue;const sent=endpointAbi.parseLog({topics:p.topics,data:p.data}),paid=feeAbi.parseLog({topics:f.topics,data:f.data});if(!sent||!paid)continue;out.push({transactionHash:p.transactionHash,blockHash:p.blockHash,blockNumber:p.blockNumber,encodedPayload:sent.args.encodedPayload,options:sent.args.options,sendLibrary:sent.args.sendLibrary,requiredDvns:[...paid.args.requiredDVNs],optionalDvns:[...paid.args.optionalDVNs],fees:[...paid.args.fees]});this.seen.set(p.transactionHash.toLowerCase(),p.blockNumber)}
    this.cursor=await this.source.block(safe);this.pending=out;await this.persist();return this.sortedPending();
  }
  async acknowledge(transactionHash:Hex):Promise<void>{await this.restore();const normalized=transactionHash.toLowerCase();if(!this.pending.some(packet=>packet.transactionHash.toLowerCase()===normalized))throw new Error("unknown pending transaction");this.pending=this.pending.filter(packet=>packet.transactionHash.toLowerCase()!==normalized);await this.persist()}
  private sortedPending():DetectedPacket[]{return[...this.pending].sort((a,b)=>a.blockNumber<b.blockNumber?-1:a.blockNumber>b.blockNumber?1:a.transactionHash.localeCompare(b.transactionHash))}
  private async restore():Promise<void>{if(this.restored)return;const checkpoint=await this.store?.load(this.pathwayKey);if(checkpoint){this.cursor=checkpoint.cursor;this.seen=new Map(checkpoint.seen.map(value=>[value.transactionHash.toLowerCase(),value.blockNumber]));this.pending=checkpoint.pending}this.restored=true}
  private async persist():Promise<void>{await this.store?.save(this.pathwayKey,{cursor:this.cursor,seen:[...this.seen].map(([transactionHash,blockNumber])=>({transactionHash,blockNumber})),pending:this.pending})}
}

export class JsonRpcLogSource implements LogSource {
  constructor(private url:string){}
  async blockNumber():Promise<bigint>{return BigInt(await this.rpc("eth_blockNumber",[]) as Hex)}
  async block(number:bigint):Promise<BlockRef>{const value=await this.rpc("eth_getBlockByNumber",[hex(number),false]) as {number:Hex;hash:Hex}|null;if(!value)throw new Error("RPC block not found");return{number:BigInt(value.number),hash:value.hash}}
  async logs(from:bigint,to:bigint,addresses:Hex[],topics:Hex[]):Promise<ChainLog[]>{const values=await this.rpc("eth_getLogs",[{fromBlock:hex(from),toBlock:hex(to),address:addresses,topics:[topics]}]) as Array<{address:Hex;topics:Hex[];data:Hex;transactionHash:Hex;blockHash:Hex;blockNumber:Hex;logIndex:Hex}>;return values.map(x=>({...x,blockNumber:BigInt(x.blockNumber),logIndex:Number(BigInt(x.logIndex))}))}
  private async rpc(method:string,params:unknown[]):Promise<unknown>{const response=await fetch(this.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);const body=await response.json() as {result?:unknown;error?:{message:string}};if(body.error)throw new Error(`RPC error: ${body.error.message}`);return body.result}
}
function hex(value:bigint):Hex{return `0x${value.toString(16)}`}
