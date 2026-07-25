import {isIP} from "node:net";
import {AbiCoder,Interface,keccak256,toQuantity} from "ethers";
import type {Hex} from "../../../packages/core/src/types.js";
import type {DestinationPathConfig} from "./runtime-config.js";

export type DestinationPathRpc=(url:string,method:string,params:unknown[])=>Promise<unknown>;

export interface VerifiedDestinationPath {
  observedBlockNumber:bigint;
  observedBlockHash:Hex;
  chainId:bigint;
  srcEid:number;
  endpoint:Hex;
  receiveLibrary:Hex;
  oapp:Hex;
  adapter:Hex;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  authorizedSigners:Hex[];
  quorum:3;
  configurationDigest:Hex;
}

export interface DestinationPathVerifier {verify():Promise<VerifiedDestinationPath>}

interface Head {url:string;chainId:bigint;blockNumber:bigint}
interface Observation {receiveLibrary:Hex;isDefault:boolean;supported:boolean;confirmations:bigint;requiredDvns:Hex[];optionalDvns:Hex[];optionalDvnThreshold:number;appConfirmations:bigint;appRequiredDvnCount:number;appOptionalDvnCount:number;appRequiredDvns:Hex[];appOptionalDvns:Hex[];appOptionalDvnThreshold:number;verificationTarget:Hex;quorum:bigint;signersAuthorized:boolean[]}

const endpointInterface=new Interface(["function getReceiveLibrary(address receiver,uint32 srcEid) view returns(address lib,bool isDefault)"]);
const receiveInterface=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))"
]);
const adapterInterface=new Interface(["function verificationTarget() view returns(address)","function quorum() view returns(uint256)","function signer(address) view returns(bool)"]);
const coder=AbiCoder.defaultAbiCoder();

class RpcUnavailable extends Error {}

export class IndependentDestinationPathVerifier implements DestinationPathVerifier {
  private urls:string[];
  constructor(private config:DestinationPathConfig,private rpc:DestinationPathRpc){
    if(config.rpcUrls.length<2)throw new Error("at least two destination RPCs required");
    this.urls=config.rpcUrls.map(safeUrl);
    if(new Set(this.urls.map(value=>new URL(value).origin)).size!==this.urls.length)throw new Error("destination RPC origins must be independent");
  }

  async verify():Promise<VerifiedDestinationPath>{
    try{return await this.observe()}catch(error){if(error instanceof RpcUnavailable)throw new Error("destination pathway RPC unavailable");throw error}
  }

  private async observe():Promise<VerifiedDestinationPath>{
    const heads=await Promise.all(this.urls.map(url=>this.head(url)));
    if(heads.some(head=>head.chainId!==heads[0]!.chainId))throw new Error("destination provider disagreement");
    const observedBlockNumber=heads.reduce((lowest,head)=>head.blockNumber<lowest?head.blockNumber:lowest,heads[0]!.blockNumber);
    const blockTag=toQuantity(observedBlockNumber);
    const hashes=await Promise.all(heads.map(head=>this.blockHash(head.url,blockTag)));
    if(hashes.some(hash=>hash!==hashes[0]))throw new Error("destination provider disagreement");
    const observedBlockHash=hashes[0]!;
    const observations=await Promise.all(heads.map(head=>this.observation(head.url,blockTag)));
    const canonical=stable(observations[0]);
    if(observations.some(value=>stable(value)!==canonical))throw new Error("destination provider disagreement");
    const value=observations[0]!;
    this.assertPinned(heads[0]!.chainId,value);
    const requiredDvns=value.requiredDvns,optionalDvns=value.optionalDvns,authorizedSigners=this.config.authorizedSigners.map(normalizeAddress);
    const requiredHash=keccak256(coder.encode(["address[]"],[requiredDvns]));
    const optionalHash=keccak256(coder.encode(["address[]"],[optionalDvns]));
    const signerHash=keccak256(coder.encode(["address[]"],[authorizedSigners]));
    const configurationDigest=keccak256(coder.encode(
      ["uint256","bytes32","uint256","uint32","address","address","address","address","uint64","bytes32","bytes32","uint8","bytes32","uint256"],
      [observedBlockNumber,observedBlockHash,heads[0]!.chainId,this.config.srcEid,this.config.endpoint,this.config.receiveLibrary,this.config.oapp,this.config.adapter,value.confirmations,requiredHash,optionalHash,value.optionalDvnThreshold,signerHash,value.quorum]
    )) as Hex;
    return{observedBlockNumber,observedBlockHash,chainId:heads[0]!.chainId,srcEid:this.config.srcEid,endpoint:normalizeAddress(this.config.endpoint),receiveLibrary:value.receiveLibrary,oapp:normalizeAddress(this.config.oapp),adapter:normalizeAddress(this.config.adapter),confirmations:value.confirmations,requiredDvns,optionalDvns,optionalDvnThreshold:value.optionalDvnThreshold,authorizedSigners,quorum:3,configurationDigest};
  }

  private async head(url:string):Promise<Head>{
    try{return{url,chainId:quantity(await this.rpc(url,"eth_chainId",[])),blockNumber:quantity(await this.rpc(url,"eth_blockNumber",[]))}}catch{throw new RpcUnavailable()}
  }

  private async blockHash(url:string,blockTag:string):Promise<Hex>{
    try{
      const block=await this.rpc(url,"eth_getBlockByNumber",[blockTag,false]);
      if(!block||typeof block!=="object")throw new Error();
      return hash((block as {hash?:unknown}).hash);
    }catch{throw new RpcUnavailable()}
  }

  private async observation(url:string,blockTag:string):Promise<Observation>{
    try{
      for(const target of[this.config.endpoint,this.config.receiveLibrary,this.config.adapter]){
        const code=await this.rpc(url,"eth_getCode",[target,blockTag]);
        if(typeof code!=="string"||!/^0x[0-9a-fA-F]+$/.test(code)||/^0x0*$/i.test(code))throw new Error();
      }
      const receiveRaw=await this.call(url,this.config.endpoint,endpointInterface.encodeFunctionData("getReceiveLibrary",[this.config.oapp,this.config.srcEid]),blockTag);
      const [receiveLibrary,isDefault]=endpointInterface.decodeFunctionResult("getReceiveLibrary",receiveRaw);
      const supportRaw=await this.call(url,this.config.receiveLibrary,receiveInterface.encodeFunctionData("isSupportedEid",[this.config.srcEid]),blockTag);
      const [supported]=receiveInterface.decodeFunctionResult("isSupportedEid",supportRaw);
      const configRaw=await this.call(url,this.config.receiveLibrary,receiveInterface.encodeFunctionData("getUlnConfig",[this.config.oapp,this.config.srcEid]),blockTag);
      const [uln]=receiveInterface.decodeFunctionResult("getUlnConfig",configRaw);
      const requiredDvns=(uln.requiredDVNs as string[]).map(normalizeAddress),optionalDvns=(uln.optionalDVNs as string[]).map(normalizeAddress);
      if(Number(uln.requiredDVNCount)!==requiredDvns.length||Number(uln.optionalDVNCount)!==optionalDvns.length)throw new Error();
      const appConfigRaw=await this.call(url,this.config.receiveLibrary,receiveInterface.encodeFunctionData("getAppUlnConfig",[this.config.oapp,this.config.srcEid]),blockTag);
      const [appUln]=receiveInterface.decodeFunctionResult("getAppUlnConfig",appConfigRaw);
      const appRequiredDvns=(appUln.requiredDVNs as string[]).map(normalizeAddress),appOptionalDvns=(appUln.optionalDVNs as string[]).map(normalizeAddress);
      const targetRaw=await this.call(url,this.config.adapter,adapterInterface.encodeFunctionData("verificationTarget"),blockTag);
      const [verificationTarget]=adapterInterface.decodeFunctionResult("verificationTarget",targetRaw);
      const quorumRaw=await this.call(url,this.config.adapter,adapterInterface.encodeFunctionData("quorum"),blockTag);
      const [quorum]=adapterInterface.decodeFunctionResult("quorum",quorumRaw);
      const signersAuthorized=await Promise.all(this.config.authorizedSigners.map(async signer=>{
        const raw=await this.call(url,this.config.adapter,adapterInterface.encodeFunctionData("signer",[signer]),blockTag);
        return Boolean(adapterInterface.decodeFunctionResult("signer",raw)[0]);
      }));
      return{receiveLibrary:normalizeAddress(String(receiveLibrary)),isDefault:Boolean(isDefault),supported:Boolean(supported),confirmations:BigInt(uln.confirmations),requiredDvns,optionalDvns,optionalDvnThreshold:Number(uln.optionalDVNThreshold),appConfirmations:BigInt(appUln.confirmations),appRequiredDvnCount:Number(appUln.requiredDVNCount),appOptionalDvnCount:Number(appUln.optionalDVNCount),appRequiredDvns,appOptionalDvns,appOptionalDvnThreshold:Number(appUln.optionalDVNThreshold),verificationTarget:normalizeAddress(String(verificationTarget)),quorum:BigInt(quorum),signersAuthorized};
    }catch{throw new RpcUnavailable()}
  }

  private async call(url:string,to:Hex,data:string,blockTag:string):Promise<Hex>{return await this.rpc(url,"eth_call",[{to,data},blockTag]) as Hex}

  private assertPinned(chainId:bigint,value:Observation):void{
    const expectedRequired=this.config.requiredDvns.map(normalizeAddress),expectedOptional=this.config.optionalDvns.map(normalizeAddress);
    if(chainId!==BigInt(this.config.chainId)||value.isDefault||!value.supported||value.receiveLibrary!==normalizeAddress(this.config.receiveLibrary)||value.confirmations!==this.config.confirmations||stable(value.requiredDvns)!==stable(expectedRequired)||stable(value.optionalDvns)!==stable(expectedOptional)||value.optionalDvnThreshold!==this.config.optionalDvnThreshold||value.appConfirmations!==this.config.confirmations||value.appRequiredDvnCount!==expectedRequired.length||value.appOptionalDvnCount!==expectedOptional.length||stable(value.appRequiredDvns)!==stable(expectedRequired)||stable(value.appOptionalDvns)!==stable(expectedOptional)||value.appOptionalDvnThreshold!==this.config.optionalDvnThreshold||value.verificationTarget!==normalizeAddress(this.config.receiveLibrary)||value.quorum!==BigInt(this.config.quorum)||value.signersAuthorized.some(authorized=>!authorized))throw new Error("destination pathway configuration drift");
  }
}

function quantity(value:unknown):bigint {if(typeof value!=="string"||!/^0x[0-9a-fA-F]+$/.test(value))throw new Error();return BigInt(value)}
function hash(value:unknown):Hex {if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function normalizeAddress(value:string):Hex {if(!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function stable(value:unknown):string {return JSON.stringify(value,(_,item)=>typeof item==="bigint"?item.toString():item)}
function safeUrl(value:string):string {let url:URL;try{url=new URL(value)}catch{throw new Error("invalid destination RPC URL")}if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(url.hostname.replace(/^\[|\]$/g,""))!==0)throw new Error("destination RPC must be public HTTPS");return url.href}
