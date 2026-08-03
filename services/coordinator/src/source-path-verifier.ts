import {isIP} from "node:net";
import {AbiCoder,Interface,keccak256,toQuantity} from "ethers";
import type {Hex,PolicyRequest} from "../../../packages/core/src/types.js";
import{safeJsonRpc}from"./json-rpc.js";
import{PathwayAuditError}from"./pathway-audit-model.js";
import type {SourcePathConfig} from "./runtime-config.js";

export type SourcePathRpc=(url:string,method:string,params:unknown[])=>Promise<unknown>;

/** A read-only contract reader permanently bound to one EIP-1898 block reference. */
export interface PinnedStateReader{
  getCode(address:Hex):Promise<Hex>;
  call(to:Hex,data:Hex):Promise<Hex>;
}

export interface UlnObservation{confirmations:bigint;requiredDvns:Hex[];optionalDvns:Hex[];optionalDvnThreshold:number}
export interface AdapterObservation{
  address:Hex;
  messageLib:Hex;
  verificationTarget:Hex;
  supportedDstEid:number;
  quorum:bigint;
  signersAuthorized:boolean[];
}
export interface SourcePathObservationInput{
  endpoint:Hex;
  sourceOApp:Hex;
  dstEid:number;
  adapter:Hex;
  /** Runtime verification predates adapter signer checks; the auditor must supply all five. */
  authorizedSigners?:readonly Hex[];
}
export interface SourcePathObservation{
  endpoint:Hex;
  sourceOApp:Hex;
  dstEid:number;
  sendLibrary:Hex;
  isDefaultSendLibrary:boolean;
  supportedEid:boolean;
  uln:UlnObservation;
  executor:{maxMessageSize:number;address:Hex};
  destinationPeer:Hex;
  adapter:AdapterObservation;
}

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

export interface SourcePathVerifier {verify(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>}

interface Head {chainId:bigint;blockHash:Hex}

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
const adapterInterface=new Interface([
  "function messageLib() view returns(address)",
  "function verificationTarget() view returns(address)",
  "function supportedDstEid() view returns(uint32)",
  "function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)"
]);
const coder=AbiCoder.defaultAbiCoder();

class RpcUnavailable extends Error {}

/**
 * Reads a complete source-side LayerZero/OApp observation at the reader's single pinned block.
 * It deliberately validates ABI and structural invariants only; expected pathway policy is evaluated later.
 */
export async function readSourcePathObservation(input:SourcePathObservationInput,reader:PinnedStateReader):Promise<SourcePathObservation>{
  const checked=sourceInput(input),endpoint=checked.endpoint,sourceOApp=checked.sourceOApp;
  await code(reader,endpoint);await code(reader,sourceOApp);await code(reader,checked.adapter);
  const sendLibrary=address(result(endpointInterface,"getSendLibrary",await call(reader,endpoint,endpointInterface.encodeFunctionData("getSendLibrary",[sourceOApp,checked.dstEid])))[0]);
  await code(reader,sendLibrary);
  const isDefaultSendLibrary=boolean(result(endpointInterface,"isDefaultSendLibrary",await call(reader,endpoint,endpointInterface.encodeFunctionData("isDefaultSendLibrary",[sourceOApp,checked.dstEid])))[0]);
  const supportedEid=boolean(result(sendInterface,"isSupportedEid",await call(reader,sendLibrary,sendInterface.encodeFunctionData("isSupportedEid",[checked.dstEid])))[0]);
  const uln=ulnObservation(result(sendInterface,"getAppUlnConfig",await call(reader,sendLibrary,sendInterface.encodeFunctionData("getAppUlnConfig",[sourceOApp,checked.dstEid])))[0]);
  const executorResult=result(sendInterface,"executorConfigs",await call(reader,sendLibrary,sendInterface.encodeFunctionData("executorConfigs",[sourceOApp,checked.dstEid])));
  const executor={maxMessageSize:number(executorResult[0]),address:address(executorResult[1])};await code(reader,executor.address);
  const destinationPeer=bytes32(result(oappInterface,"peers",await call(reader,sourceOApp,oappInterface.encodeFunctionData("peers",[checked.dstEid])))[0]);
  return{endpoint,sourceOApp,dstEid:checked.dstEid,sendLibrary,isDefaultSendLibrary,supportedEid,uln,executor,destinationPeer,adapter:await readAdapterObservation(checked.adapter,checked.authorizedSigners,reader)};
}

/** Reads immutable/public adapter bindings and, when supplied, every authorized signer mapping. */
export async function readAdapterObservation(adapter:Hex,authorizedSigners:readonly Hex[]|undefined,reader:PinnedStateReader):Promise<AdapterObservation>{
  const checkedAdapter=address(adapter),signers=signerInput(authorizedSigners);await code(reader,checkedAdapter);
  const messageLib=address(result(adapterInterface,"messageLib",await call(reader,checkedAdapter,adapterInterface.encodeFunctionData("messageLib")))[0]);
  const verificationTarget=address(result(adapterInterface,"verificationTarget",await call(reader,checkedAdapter,adapterInterface.encodeFunctionData("verificationTarget")))[0]);
  const supportedDstEid=number(result(adapterInterface,"supportedDstEid",await call(reader,checkedAdapter,adapterInterface.encodeFunctionData("supportedDstEid")))[0]);
  const quorum=uint(result(adapterInterface,"quorum",await call(reader,checkedAdapter,adapterInterface.encodeFunctionData("quorum")))[0]);
  const signersAuthorized=await Promise.all((signers??[]).map(async signer=>boolean(result(adapterInterface,"signer",await call(reader,checkedAdapter,adapterInterface.encodeFunctionData("signer",[signer])))[0])));
  return{address:checkedAdapter,messageLib,verificationTarget,supportedDstEid,quorum,signersAuthorized};
}

export class IndependentSourcePathVerifier implements SourcePathVerifier {
  private urls:string[];
  constructor(private config:SourcePathConfig,private rpc:SourcePathRpc=safeJsonRpc){
    if(config.rpcUrls.length<2)throw new Error("at least two source RPCs required");
    this.urls=config.rpcUrls.map(safeUrl);
    if(new Set(this.urls.map(value=>new URL(value).origin)).size!==this.urls.length)throw new Error("source RPC origins must be independent");
  }

  async verify(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>{
    try{return await this.observe(packet)}catch(error){if(error instanceof RpcUnavailable)throw new Error("source pathway RPC unavailable");throw error}
  }

  private async observe(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>{
    this.assertPacket(packet);const blockTag=toQuantity(packet.blockNumber);
    const heads=await Promise.all(this.urls.map(url=>this.head(url,blockTag)));
    if(heads.some(head=>stable(head)!==stable(heads[0])))throw new Error("source provider disagreement");
    if(heads[0]!.chainId!==BigInt(this.config.sourceChainId)||heads[0]!.blockHash!==packet.blockHash.toLowerCase())throw new Error("source pathway configuration drift");
    const observations=await Promise.all(this.urls.map(url=>this.observation(url,blockTag)));
    if(observations.some(value=>stable(value)!==stable(observations[0])))throw new Error("source provider disagreement");
    const value=observations[0]!;this.assertPinned(value);
    const requiredHash=keccak256(coder.encode(["address[]"],[value.uln.requiredDvns])),optionalHash=keccak256(coder.encode(["address[]"],[value.uln.optionalDvns]));
    const configurationDigest=keccak256(coder.encode(["uint256","bytes32","uint256","uint32","uint32","address","address","address","bytes32","address","uint32","uint64","bytes32","bytes32","uint8"],[packet.blockNumber,packet.blockHash,heads[0]!.chainId,this.config.srcEid,this.config.dstEid,this.config.endpoint,this.config.sendLibrary,this.config.sourceOAppAddress,this.config.destinationOApp,value.executor.address,value.executor.maxMessageSize,value.uln.confirmations,requiredHash,optionalHash,value.uln.optionalDvnThreshold])) as Hex;
    return{observedBlockNumber:packet.blockNumber,observedBlockHash:packet.blockHash.toLowerCase() as Hex,chainId:heads[0]!.chainId,dstEid:this.config.dstEid,endpoint:normalizeAddress(this.config.endpoint),sendLibrary:value.sendLibrary,sourceOApp:normalizeAddress(this.config.sourceOAppAddress),destinationOApp:value.destinationPeer,executor:value.executor.address,maxMessageSize:value.executor.maxMessageSize,confirmations:value.uln.confirmations,requiredDvns:value.uln.requiredDvns,optionalDvns:value.uln.optionalDvns,optionalDvnThreshold:value.uln.optionalDvnThreshold,configurationDigest};
  }

  private assertPacket(packet:PolicyRequest["packet"]):void{if(packet.srcEid!==this.config.srcEid||packet.dstEid!==this.config.dstEid||packet.sender.toLowerCase()!==this.config.sourceOApp.toLowerCase()||packet.receiver.toLowerCase()!==this.config.destinationOApp.toLowerCase())throw new Error("source packet pathway mismatch");hash(packet.blockHash)}
  private async head(url:string,blockTag:string):Promise<Head>{try{const chainId=quantity(await this.rpc(url,"eth_chainId",[]));const block=await this.rpc(url,"eth_getBlockByNumber",[blockTag,false]);if(!block||typeof block!=="object")throw new Error();return{chainId,blockHash:hash((block as {hash?:unknown}).hash)}}catch{throw new RpcUnavailable()}}
  private async observation(url:string,blockTag:string):Promise<SourcePathObservation>{
    const reader:PinnedStateReader={getCode:async target=>{try{return await this.rpc(url,"eth_getCode",[target,blockTag]) as Hex}catch{throw new RpcUnavailable()}},call:async(to,data)=>{try{return await this.rpc(url,"eth_call",[{to,data},blockTag]) as Hex}catch{throw new RpcUnavailable()}}};
    try{return await readSourcePathObservation({endpoint:normalizeAddress(this.config.endpoint),sourceOApp:normalizeAddress(this.config.sourceOAppAddress),dstEid:this.config.dstEid,adapter:normalizeAddress(this.config.sentinelDvn)},reader)}catch(error){if(error instanceof RpcUnavailable)throw error;throw new Error("source pathway configuration drift")}
  }
  private assertPinned(value:SourcePathObservation):void{const required=this.config.requiredDvns.map(normalizeAddress),optional=this.config.optionalDvns.map(normalizeAddress);if(value.sendLibrary!==normalizeAddress(this.config.sendLibrary)||value.isDefaultSendLibrary||!value.supportedEid||value.uln.confirmations!==this.config.confirmations||stable(value.uln.requiredDvns)!==stable(required)||stable(value.uln.optionalDvns)!==stable(optional)||value.uln.optionalDvnThreshold!==this.config.optionalDvnThreshold||value.executor.maxMessageSize!==this.config.maxMessageSize||value.executor.address!==normalizeAddress(this.config.executor)||value.destinationPeer!==this.config.destinationOApp.toLowerCase())throw new Error("source pathway configuration drift")}
}

function sourceInput(value:SourcePathObservationInput):SourcePathObservationInput{if(!value||typeof value!=="object")invalid();const endpoint=address(value.endpoint),sourceOApp=address(value.sourceOApp),adapter=address(value.adapter),dstEid=number(value.dstEid);return{endpoint,sourceOApp,adapter,dstEid,authorizedSigners:signerInput(value.authorizedSigners)}}
function signerInput(value:readonly Hex[]|undefined):Hex[]|undefined{if(value===undefined)return undefined;if(!Array.isArray(value)||value.length!==5)invalid();const result=value.map(address);sortedUnique(result);return result}
function ulnObservation(value:unknown):UlnObservation{if(!value||typeof value!=="object")invalid();const uln=value as {confirmations?:unknown;requiredDVNCount?:unknown;optionalDVNCount?:unknown;optionalDVNThreshold?:unknown;requiredDVNs?:unknown;optionalDVNs?:unknown};const confirmations=uint(uln.confirmations),requiredDvns=addresses(uln.requiredDVNs),optionalDvns=addresses(uln.optionalDVNs),optionalDvnThreshold=number(uln.optionalDVNThreshold);if(number(uln.requiredDVNCount)!==requiredDvns.length||number(uln.optionalDVNCount)!==optionalDvns.length||optionalDvnThreshold>optionalDvns.length)invalid();sortedUnique(requiredDvns);sortedUnique(optionalDvns);if(new Set([...requiredDvns,...optionalDvns]).size!==requiredDvns.length+optionalDvns.length)invalid();return{confirmations,requiredDvns,optionalDvns,optionalDvnThreshold}}
function addresses(value:unknown):Hex[]{if(!Array.isArray(value))invalid();return value.map(address)}
function result(contract:Interface,name:string,data:Hex):readonly unknown[]{try{if(typeof data!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(data))invalid();return contract.decodeFunctionResult(name,data)}catch(error){if(error instanceof PathwayAuditError)throw error;invalid()}}
async function call(reader:PinnedStateReader,to:Hex,data:string):Promise<Hex>{return await reader.call(to,data as Hex)}
async function code(reader:PinnedStateReader,target:Hex):Promise<void>{const value=await reader.getCode(target);if(typeof value!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)||/^0x0*$/i.test(value))invalid()}
function boolean(value:unknown):boolean{if(typeof value!=="boolean")invalid();return value}
function uint(value:unknown):bigint{try{const result=BigInt(value as bigint);if(result<0n)invalid();return result}catch{invalid()}}
function number(value:unknown):number{const result=uint(value);if(result>BigInt(Number.MAX_SAFE_INTEGER))invalid();return Number(result)}
function address(value:unknown):Hex{if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))invalid();return value.toLowerCase() as Hex}
function bytes32(value:unknown):Hex{if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))invalid();return value.toLowerCase() as Hex}
function sortedUnique(values:Hex[]):void{for(let index=1;index<values.length;index++)if(values[index]!.toLowerCase()<=values[index-1]!.toLowerCase())invalid()}
function invalid():never{throw new PathwayAuditError("PATHWAY_AUDIT_OBSERVATION_FAILED")}
function quantity(value:unknown):bigint {if(typeof value!=="string"||!/^0x[0-9a-fA-F]+$/.test(value))throw new Error();return BigInt(value)}
function hash(value:unknown):Hex {if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function normalizeAddress(value:string):Hex{return address(value)}
function stable(value:unknown):string {return JSON.stringify(value,(_,item)=>typeof item==="bigint"?item.toString():item)}
function safeUrl(value:string):string {let url:URL;try{url=new URL(value)}catch{throw new Error("invalid source RPC URL")}if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(url.hostname.replace(/^\[|\]$/g,""))!==0)throw new Error("source RPC must be public HTTPS");return url.href}
