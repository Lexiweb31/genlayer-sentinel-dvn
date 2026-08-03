import {isIP} from "node:net";
import {AbiCoder,Interface,keccak256,toQuantity} from "ethers";
import type {Hex} from "../../../packages/core/src/types.js";
import{PathwayAuditError}from"./pathway-audit-model.js";
import{readAdapterObservation,type AdapterObservation,type PinnedStateReader,type UlnObservation}from"./source-path-verifier.js";
import type {DestinationPathConfig} from "./runtime-config.js";

export type DestinationPathRpc=(url:string,method:string,params:unknown[])=>Promise<unknown>;
export interface DestinationPathObservationInput{endpoint:Hex;oapp:Hex;srcEid:number;adapter:Hex;authorizedSigners:readonly Hex[]}
export interface DestinationPathObservation{
  endpoint:Hex;oapp:Hex;srcEid:number;receiveLibrary:Hex;isDefaultReceiveLibrary:boolean;supportedEid:boolean;
  rawUln:UlnObservation;appUln:UlnObservation;sourcePeer:Hex;adapter:AdapterObservation;
}
export interface VerifiedDestinationPath {
  observedBlockNumber:bigint;observedBlockHash:Hex;chainId:bigint;srcEid:number;endpoint:Hex;receiveLibrary:Hex;oapp:Hex;adapter:Hex;confirmations:bigint;requiredDvns:Hex[];optionalDvns:Hex[];optionalDvnThreshold:number;authorizedSigners:Hex[];quorum:3;configurationDigest:Hex;
}
export interface DestinationPathVerifier {verify():Promise<VerifiedDestinationPath>}

interface Head {url:string;chainId:bigint;blockNumber:bigint}
const endpointInterface=new Interface(["function getReceiveLibrary(address receiver,uint32 srcEid) view returns(address lib,bool isDefault)"]);
const receiveInterface=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))"
]);
const oappInterface=new Interface(["function peers(uint32 eid) view returns(bytes32 peer)"]);
const coder=AbiCoder.defaultAbiCoder();
class RpcUnavailable extends Error {}

/** Reads destination LayerZero/OApp state at the reader's exact EIP-1898 block without applying policy. */
export async function readDestinationPathObservation(input:DestinationPathObservationInput,reader:PinnedStateReader):Promise<DestinationPathObservation>{
  const checked=destinationInput(input);await code(reader,checked.endpoint);await code(reader,checked.oapp);await code(reader,checked.adapter);
  const receive=result(endpointInterface,"getReceiveLibrary",await call(reader,checked.endpoint,endpointInterface.encodeFunctionData("getReceiveLibrary",[checked.oapp,checked.srcEid])));
  const receiveLibrary=address(receive[0]),isDefaultReceiveLibrary=boolean(receive[1]);await code(reader,receiveLibrary);
  const supportedEid=boolean(result(receiveInterface,"isSupportedEid",await call(reader,receiveLibrary,receiveInterface.encodeFunctionData("isSupportedEid",[checked.srcEid])))[0]);
  const rawUln=ulnObservation(result(receiveInterface,"getUlnConfig",await call(reader,receiveLibrary,receiveInterface.encodeFunctionData("getUlnConfig",[checked.oapp,checked.srcEid])))[0]);
  const appUln=ulnObservation(result(receiveInterface,"getAppUlnConfig",await call(reader,receiveLibrary,receiveInterface.encodeFunctionData("getAppUlnConfig",[checked.oapp,checked.srcEid])))[0]);
  const sourcePeer=bytes32(result(oappInterface,"peers",await call(reader,checked.oapp,oappInterface.encodeFunctionData("peers",[checked.srcEid])))[0]);
  return{endpoint:checked.endpoint,oapp:checked.oapp,srcEid:checked.srcEid,receiveLibrary,isDefaultReceiveLibrary,supportedEid,rawUln,appUln,sourcePeer,adapter:await readAdapterObservation(checked.adapter,checked.authorizedSigners,reader)};
}

export class IndependentDestinationPathVerifier implements DestinationPathVerifier {
  private urls:string[];
  constructor(private config:DestinationPathConfig,private rpc:DestinationPathRpc){if(config.rpcUrls.length<2)throw new Error("at least two destination RPCs required");this.urls=config.rpcUrls.map(safeUrl);if(new Set(this.urls.map(value=>new URL(value).origin)).size!==this.urls.length)throw new Error("destination RPC origins must be independent")}
  async verify():Promise<VerifiedDestinationPath>{try{return await this.observe()}catch(error){if(error instanceof RpcUnavailable)throw new Error("destination pathway RPC unavailable");throw error}}
  private async observe():Promise<VerifiedDestinationPath>{
    const heads=await Promise.all(this.urls.map(url=>this.head(url)));if(heads.some(head=>head.chainId!==heads[0]!.chainId))throw new Error("destination provider disagreement");
    const observedBlockNumber=heads.reduce((lowest,head)=>head.blockNumber<lowest?head.blockNumber:lowest,heads[0]!.blockNumber),blockTag=toQuantity(observedBlockNumber);
    const hashes=await Promise.all(heads.map(head=>this.blockHash(head.url,blockTag)));if(hashes.some(hash=>hash!==hashes[0]))throw new Error("destination provider disagreement");const observedBlockHash=hashes[0]!;
    const observations=await Promise.all(heads.map(head=>this.observation(head.url,blockTag)));if(observations.some(value=>stable(value)!==stable(observations[0])))throw new Error("destination provider disagreement");const value=observations[0]!;
    this.assertPinned(heads[0]!.chainId,value);const requiredHash=keccak256(coder.encode(["address[]"],[value.rawUln.requiredDvns])),optionalHash=keccak256(coder.encode(["address[]"],[value.rawUln.optionalDvns])),authorizedSigners=this.config.authorizedSigners.map(normalizeAddress),signerHash=keccak256(coder.encode(["address[]"],[authorizedSigners]));
    const configurationDigest=keccak256(coder.encode(["uint256","bytes32","uint256","uint32","address","address","address","address","uint64","bytes32","bytes32","uint8","bytes32","uint256"],[observedBlockNumber,observedBlockHash,heads[0]!.chainId,this.config.srcEid,this.config.endpoint,this.config.receiveLibrary,this.config.oapp,this.config.adapter,value.rawUln.confirmations,requiredHash,optionalHash,value.rawUln.optionalDvnThreshold,signerHash,value.adapter.quorum])) as Hex;
    return{observedBlockNumber,observedBlockHash,chainId:heads[0]!.chainId,srcEid:this.config.srcEid,endpoint:normalizeAddress(this.config.endpoint),receiveLibrary:value.receiveLibrary,oapp:normalizeAddress(this.config.oapp),adapter:normalizeAddress(this.config.adapter),confirmations:value.rawUln.confirmations,requiredDvns:value.rawUln.requiredDvns,optionalDvns:value.rawUln.optionalDvns,optionalDvnThreshold:value.rawUln.optionalDvnThreshold,authorizedSigners,quorum:3,configurationDigest};
  }
  private async head(url:string):Promise<Head>{try{return{url,chainId:quantity(await this.rpc(url,"eth_chainId",[])),blockNumber:quantity(await this.rpc(url,"eth_blockNumber",[]))}}catch{throw new RpcUnavailable()}}
  private async blockHash(url:string,blockTag:string):Promise<Hex>{try{const block=await this.rpc(url,"eth_getBlockByNumber",[blockTag,false]);if(!block||typeof block!=="object")throw new Error();return hash((block as {hash?:unknown}).hash)}catch{throw new RpcUnavailable()}}
  private async observation(url:string,blockTag:string):Promise<DestinationPathObservation>{
    const reader:PinnedStateReader={getCode:async target=>{try{return await this.rpc(url,"eth_getCode",[target,blockTag]) as Hex}catch{throw new RpcUnavailable()}},call:async(to,data)=>{try{return await this.rpc(url,"eth_call",[{to,data},blockTag]) as Hex}catch{throw new RpcUnavailable()}}};
    try{return await readDestinationPathObservation({endpoint:normalizeAddress(this.config.endpoint),oapp:normalizeAddress(this.config.oapp),srcEid:this.config.srcEid,adapter:normalizeAddress(this.config.adapter),authorizedSigners:this.config.authorizedSigners.map(normalizeAddress)},reader)}catch(error){if(error instanceof RpcUnavailable)throw error;throw new Error("destination pathway configuration drift")}
  }
  private assertPinned(chainId:bigint,value:DestinationPathObservation):void{const required=this.config.requiredDvns.map(normalizeAddress),optional=this.config.optionalDvns.map(normalizeAddress);if(chainId!==BigInt(this.config.chainId)||value.isDefaultReceiveLibrary||!value.supportedEid||value.receiveLibrary!==normalizeAddress(this.config.receiveLibrary)||value.rawUln.confirmations!==this.config.confirmations||stable(value.rawUln.requiredDvns)!==stable(required)||stable(value.rawUln.optionalDvns)!==stable(optional)||value.rawUln.optionalDvnThreshold!==this.config.optionalDvnThreshold||value.appUln.confirmations!==this.config.confirmations||stable(value.appUln.requiredDvns)!==stable(required)||stable(value.appUln.optionalDvns)!==stable(optional)||value.appUln.optionalDvnThreshold!==this.config.optionalDvnThreshold||value.adapter.verificationTarget!==normalizeAddress(this.config.receiveLibrary)||value.adapter.quorum!==BigInt(this.config.quorum)||value.adapter.signersAuthorized.some(authorized=>!authorized))throw new Error("destination pathway configuration drift")}
}

function destinationInput(value:DestinationPathObservationInput):DestinationPathObservationInput{if(!value||typeof value!=="object")invalid();const endpoint=address(value.endpoint),oapp=address(value.oapp),adapter=address(value.adapter),srcEid=number(value.srcEid),authorizedSigners=signers(value.authorizedSigners);return{endpoint,oapp,adapter,srcEid,authorizedSigners}}
function signers(value:readonly Hex[]):Hex[]{if(!Array.isArray(value)||value.length!==5)invalid();const result=value.map(address);sortedUnique(result);return result}
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
function safeUrl(value:string):string {let url:URL;try{url=new URL(value)}catch{throw new Error("invalid destination RPC URL")}if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(url.hostname.replace(/^\[|\]$/g,""))!==0)throw new Error("destination RPC must be public HTTPS");return url.href}
