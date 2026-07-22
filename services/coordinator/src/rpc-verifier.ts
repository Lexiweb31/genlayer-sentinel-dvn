import {Interface} from "ethers";
import type {Hex, Packet, Verification} from "../../../packages/core/src/types.js";
import {assertCanonicalPacket} from "../../../packages/core/src/packet-v1.js";
import type {PacketVerifier} from "./coordinator.js";
import {isIP}from"node:net";

type RpcReceipt={status:Hex;blockHash:Hex;blockNumber:Hex;logs:Array<{address:string;topics:Hex[];data:Hex}>};
export type RpcFetch=(url:string,method:string,params:unknown[])=>Promise<unknown>;
const packetSent=new Interface(["event PacketSent(bytes encodedPayload, bytes options, address sendLibrary)"]);
const topic=packetSent.getEvent("PacketSent")!.topicHash.toLowerCase();

export class IndependentRpcPacketVerifier implements PacketVerifier {
  constructor(private urls:string[],private endpoint:string,private requiredConfirmations:bigint,private rpc:RpcFetch=jsonRpc) {
    if(urls.length<2) throw new Error("at least two independent RPC URLs required");
    const origins=urls.map(validateRpcUrl);if(new Set(origins).size!==origins.length) throw new Error("RPC origins must be distinct");
    if(!/^0x[0-9a-fA-F]{40}$/.test(endpoint)||/^0x0{40}$/i.test(endpoint))throw new Error("invalid EndpointV2 address");if(requiredConfirmations<=0n)throw new Error("confirmations must be positive");
  }
  async verify(packet:Packet):Promise<Verification[]> {
    return Promise.all(this.urls.map(async url=>{
      const receipt=await this.rpc(url,"eth_getTransactionReceipt",[packet.txHash]) as RpcReceipt|null;
      if(!receipt||receipt.status!=="0x1") throw new Error("missing or failed source transaction");
      if(receipt.blockHash.toLowerCase()!==packet.blockHash.toLowerCase()||BigInt(receipt.blockNumber)!==packet.blockNumber) throw new Error("receipt block mismatch");
      const latest=BigInt(await this.rpc(url,"eth_blockNumber",[]) as Hex); const confirmations=latest-packet.blockNumber+1n;
      if(confirmations<this.requiredConfirmations) throw new Error("insufficient confirmations");
      const log=receipt.logs.find(x=>x.address.toLowerCase()===this.endpoint.toLowerCase()&&x.topics[0]?.toLowerCase()===topic);
      if(!log) throw new Error("PacketSent not emitted by configured EndpointV2");
      const parsed=packetSent.parseLog({topics:log.topics,data:log.data}); if(!parsed) throw new Error("invalid PacketSent log");
      assertCanonicalPacket(parsed.args.encodedPayload as Hex,packet);
      return {provider:redact(url),blockHash:receipt.blockHash,payloadHash:packet.payloadHash,confirmations};
    }));
  }
}
async function jsonRpc(url:string,method:string,params:unknown[]):Promise<unknown>{
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),redirect:"error",signal:AbortSignal.timeout(10_000)});
  if(!response.ok) throw new Error(`RPC HTTP ${response.status}`); const body=await response.json() as {result?:unknown;error?:{message:string}};
  if(body.error) throw new Error(`RPC error: ${body.error.message}`); return body.result;
}
function redact(url:string):string { try {const u=new URL(url);return `${u.protocol}//${u.host}`;} catch{return "configured-rpc";} }
function validateRpcUrl(value:string):string{let url:URL;try{url=new URL(value)}catch{throw new Error("RPC URL is invalid")}const ipHost=url.hostname.replace(/^\[|\]$/g,"");if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(ipHost)!==0)throw new Error("RPC URL must be a public HTTPS origin");return url.origin}
