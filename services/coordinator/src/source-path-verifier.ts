import {isIP} from "node:net";
import {AbiCoder,Interface,keccak256,toQuantity} from "ethers";
import type {Hex,PolicyRequest} from "../../../packages/core/src/types.js";
import type {SourcePathConfig} from "./runtime-config.js";

export type SourcePathRpc=(url:string,method:string,params:unknown[])=>Promise<unknown>;

export interface VerifiedSourcePath {
  observedBlockNumber:bigint;
  observedBlockHash:Hex;
  chainId:bigint;
  dstEid:number;
  endpoint:Hex;
  sendLibrary:Hex;
  sourceOApp:Hex;
  destinationOApp:Hex;
  executor:Hex;
  maxMessageSize:number;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  configurationDigest:Hex;
}

export interface SourcePathVerifier {
  verify(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>;
}

interface Head {chainId:bigint;blockHash:Hex}
interface Observation {
  codePresent:boolean;
  sendLibrary:Hex;
  isDefault:boolean;
  supported:boolean;
  confirmations:bigint;
  requiredDvnCount:number;
  optionalDvnCount:number;
  optionalDvnThreshold:number;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  maxMessageSize:number;
  executor:Hex;
  peer:Hex;
}

const endpointInterface=new Interface([
  "function getSendLibrary(address sender,uint32 dstEid) view returns(address lib)",
  "function isDefaultSendLibrary(address sender,uint32 dstEid) view returns(bool)"
]);
const sendInterface=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function executorConfigs(address oapp,uint32 remoteEid) view returns(uint32 maxMessageSize,address executor)"
]);
const oappInterface=new Interface(["function peers(uint32 eid) view returns(bytes32 peer)"]);
const coder=AbiCoder.defaultAbiCoder();

class RpcUnavailable extends Error {}

export class IndependentSourcePathVerifier implements SourcePathVerifier {
  private urls:string[];
  constructor(private config:SourcePathConfig,private rpc:SourcePathRpc=jsonRpc){
    if(config.rpcUrls.length<2)throw new Error("at least two source RPCs required");
    this.urls=config.rpcUrls.map(safeUrl);
    if(new Set(this.urls.map(value=>new URL(value).origin)).size!==this.urls.length)throw new Error("source RPC origins must be independent");
  }

  async verify(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>{
    try{return await this.observe(packet)}
    catch(error){if(error instanceof RpcUnavailable)throw new Error("source pathway RPC unavailable");throw error}
  }

  private async observe(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>{
    this.assertPacket(packet);
    const blockTag=toQuantity(packet.blockNumber);
    const heads=await Promise.all(this.urls.map(url=>this.head(url,blockTag)));
    if(heads.some(head=>stable(head)!==stable(heads[0])))throw new Error("source provider disagreement");
    if(heads[0]!.chainId!==BigInt(this.config.sourceChainId)||heads[0]!.blockHash!==packet.blockHash.toLowerCase())throw new Error("source pathway configuration drift");
    const observations=await Promise.all(this.urls.map(url=>this.observation(url,blockTag)));
    if(observations.some(value=>stable(value)!==stable(observations[0])))throw new Error("source provider disagreement");
    const value=observations[0]!;
    this.assertPinned(value);
    const requiredDvns=value.requiredDvns,optionalDvns=value.optionalDvns;
    const requiredHash=keccak256(coder.encode(["address[]"],[requiredDvns]));
    const optionalHash=keccak256(coder.encode(["address[]"],[optionalDvns]));
    const configurationDigest=keccak256(coder.encode(
      ["uint256","bytes32","uint256","uint32","uint32","address","address","address","bytes32","address","uint32","uint64","bytes32","bytes32","uint8"],
      [packet.blockNumber,packet.blockHash,heads[0]!.chainId,this.config.srcEid,this.config.dstEid,this.config.endpoint,this.config.sendLibrary,this.config.sourceOAppAddress,this.config.destinationOApp,value.executor,value.maxMessageSize,value.confirmations,requiredHash,optionalHash,value.optionalDvnThreshold]
    )) as Hex;
    return{
      observedBlockNumber:packet.blockNumber,
      observedBlockHash:packet.blockHash.toLowerCase() as Hex,
      chainId:heads[0]!.chainId,
      dstEid:this.config.dstEid,
      endpoint:normalizeAddress(this.config.endpoint),
      sendLibrary:value.sendLibrary,
      sourceOApp:normalizeAddress(this.config.sourceOAppAddress),
      destinationOApp:value.peer,
      executor:value.executor,
      maxMessageSize:value.maxMessageSize,
      confirmations:value.confirmations,
      requiredDvns,
      optionalDvns,
      optionalDvnThreshold:value.optionalDvnThreshold,
      configurationDigest
    };
  }

  private assertPacket(packet:PolicyRequest["packet"]):void{
    if(packet.srcEid!==this.config.srcEid||packet.dstEid!==this.config.dstEid||packet.sender.toLowerCase()!==this.config.sourceOApp.toLowerCase()||packet.receiver.toLowerCase()!==this.config.destinationOApp.toLowerCase())throw new Error("source packet pathway mismatch");
    hash(packet.blockHash);
  }

  private async head(url:string,blockTag:string):Promise<Head>{
    try{
      const chainId=quantity(await this.rpc(url,"eth_chainId",[]));
      const block=await this.rpc(url,"eth_getBlockByNumber",[blockTag,false]);
      if(!block||typeof block!=="object")throw new Error();
      return{chainId,blockHash:hash((block as {hash?:unknown}).hash)};
    }catch{throw new RpcUnavailable()}
  }

  private async observation(url:string,blockTag:string):Promise<Observation>{
    try{
      const targets=unique([
        this.config.endpoint,this.config.sendLibrary,this.config.sourceOAppAddress,this.config.executor,
        this.config.sentinelDvn,...this.config.requiredDvns,...this.config.optionalDvns
      ]);
      const codes=await Promise.all(targets.map(async target=>codePresent(await this.rpc(url,"eth_getCode",[target,blockTag]))));
      const sendRaw=await this.call(url,this.config.endpoint,endpointInterface.encodeFunctionData("getSendLibrary",[this.config.sourceOAppAddress,this.config.dstEid]),blockTag);
      const [sendLibrary]=endpointInterface.decodeFunctionResult("getSendLibrary",sendRaw);
      const defaultRaw=await this.call(url,this.config.endpoint,endpointInterface.encodeFunctionData("isDefaultSendLibrary",[this.config.sourceOAppAddress,this.config.dstEid]),blockTag);
      const [isDefault]=endpointInterface.decodeFunctionResult("isDefaultSendLibrary",defaultRaw);
      const supportRaw=await this.call(url,this.config.sendLibrary,sendInterface.encodeFunctionData("isSupportedEid",[this.config.dstEid]),blockTag);
      const [supported]=sendInterface.decodeFunctionResult("isSupportedEid",supportRaw);
      const ulnRaw=await this.call(url,this.config.sendLibrary,sendInterface.encodeFunctionData("getAppUlnConfig",[this.config.sourceOAppAddress,this.config.dstEid]),blockTag);
      const [uln]=sendInterface.decodeFunctionResult("getAppUlnConfig",ulnRaw);
      const executorRaw=await this.call(url,this.config.sendLibrary,sendInterface.encodeFunctionData("executorConfigs",[this.config.sourceOAppAddress,this.config.dstEid]),blockTag);
      const [maxMessageSize,executor]=sendInterface.decodeFunctionResult("executorConfigs",executorRaw);
      const peerRaw=await this.call(url,this.config.sourceOAppAddress,oappInterface.encodeFunctionData("peers",[this.config.dstEid]),blockTag);
      const [peer]=oappInterface.decodeFunctionResult("peers",peerRaw);
      return{
        codePresent:codes.every(Boolean),
        sendLibrary:normalizeAddress(String(sendLibrary)),
        isDefault:Boolean(isDefault),
        supported:Boolean(supported),
        confirmations:BigInt(uln.confirmations),
        requiredDvnCount:safeNumber(uln.requiredDVNCount),
        optionalDvnCount:safeNumber(uln.optionalDVNCount),
        optionalDvnThreshold:safeNumber(uln.optionalDVNThreshold),
        requiredDvns:(uln.requiredDVNs as string[]).map(normalizeAddress),
        optionalDvns:(uln.optionalDVNs as string[]).map(normalizeAddress),
        maxMessageSize:safeNumber(maxMessageSize),
        executor:normalizeAddress(String(executor)),
        peer:bytes32(peer)
      };
    }catch{throw new RpcUnavailable()}
  }

  private async call(url:string,to:Hex,data:string,blockTag:string):Promise<Hex>{
    return await this.rpc(url,"eth_call",[{to,data},blockTag]) as Hex;
  }

  private assertPinned(value:Observation):void{
    const required=this.config.requiredDvns.map(normalizeAddress),optional=this.config.optionalDvns.map(normalizeAddress);
    if(
      !value.codePresent||
      value.sendLibrary!==normalizeAddress(this.config.sendLibrary)||
      value.isDefault||
      !value.supported||
      value.confirmations!==this.config.confirmations||
      value.requiredDvnCount!==required.length||
      value.optionalDvnCount!==optional.length||
      stable(value.requiredDvns)!==stable(required)||
      stable(value.optionalDvns)!==stable(optional)||
      value.optionalDvnThreshold!==this.config.optionalDvnThreshold||
      value.maxMessageSize!==this.config.maxMessageSize||
      value.executor!==normalizeAddress(this.config.executor)||
      value.peer!==this.config.destinationOApp.toLowerCase()
    )throw new Error("source pathway configuration drift");
  }
}

async function jsonRpc(url:string,method:string,params:unknown[]):Promise<unknown>{
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),redirect:"error",signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error();
  const body=await response.json() as {result?:unknown;error?:unknown};
  if(body.error||!("result" in body))throw new Error();
  return body.result;
}
function quantity(value:unknown):bigint {if(typeof value!=="string"||!/^0x[0-9a-fA-F]+$/.test(value))throw new Error();return BigInt(value)}
function hash(value:unknown):Hex {if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function bytes32(value:unknown):Hex {if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function normalizeAddress(value:string):Hex {if(!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function codePresent(value:unknown):boolean {if(typeof value!=="string"||!/^0x[0-9a-fA-F]*$/.test(value))throw new Error();return !/^0x0*$/i.test(value)}
function safeNumber(value:unknown):number {const result=BigInt(value as bigint);if(result<0n||result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error();return Number(result)}
function stable(value:unknown):string {return JSON.stringify(value,(_,item)=>typeof item==="bigint"?item.toString():item)}
function unique(values:Hex[]):Hex[] {return[...new Map(values.map(value=>[value.toLowerCase(),value])).values()]}
function safeUrl(value:string):string {let url:URL;try{url=new URL(value)}catch{throw new Error("invalid source RPC URL")}if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(url.hostname.replace(/^\[|\]$/g,""))!==0)throw new Error("source RPC must be public HTTPS");return url.href}
