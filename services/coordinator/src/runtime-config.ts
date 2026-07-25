import {isIP} from "node:net";
import type {Hex} from "../../../packages/core/src/types.js";

export interface DestinationPathConfig {
  rpcUrls:string[];
  chainId:number;
  srcEid:number;
  endpoint:Hex;
  receiveLibrary:Hex;
  oapp:Hex;
  adapter:Hex;
  useDefaultReceiveLibrary:false;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  authorizedSigners:Hex[];
  quorum:3;
  signatureTtlSeconds:number;
}

export interface SourcePathConfig {
  name:string;
  sourceChainId:number;
  destinationChainId:number;
  srcEid:number;
  dstEid:number;
  endpoint:Hex;
  sendLibrary:Hex;
  sourceOApp:Hex;
  sourceOAppAddress:Hex;
  destinationOApp:Hex;
  sentinelDvn:Hex;
  executor:Hex;
  maxMessageSize:number;
  deadDvn:Hex;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  startBlock:bigint;
  confirmations:bigint;
  rpcUrls:string[];
}

export interface RuntimeConfig {
  mode:"TESTNET_PROTOTYPE";
  pathway:SourcePathConfig;
  destination:DestinationPathConfig;
  evidence:{uri:string;allowedHost:string;policy:string;ttlSeconds:number;maximumBytes:number};
  genlayer:{endpoint:string;policyContract:Hex};
  storage:{sqlitePath:string};
  runtime:{pollIntervalMs:number;maxIngestionAttempts:number};
  status:{host:string;port:number};
}

type RecordValue=Record<string,unknown>;

export function parseRuntimeConfig(value:unknown):RuntimeConfig {
  const root=record(value,"config");
  if(root.mode!=="TESTNET_PROTOTYPE")throw new Error("mode must be TESTNET_PROTOTYPE");
  const pathway=record(root.pathway,"pathway");
  const destination=record(root.destination,"destination");
  const evidence=record(root.evidence,"evidence");
  const genlayer=record(root.genlayer,"genlayer");
  const storage=record(root.storage,"storage");
  const runtime=record(root.runtime,"runtime");
  const status=record(root.status,"status");

  exactKeys(pathway,["name","sourceChainId","destinationChainId","srcEid","dstEid","endpoint","sendLibrary","sourceOApp","sourceOAppAddress","destinationOApp","sentinelDvn","executor","maxMessageSize","deadDvn","requiredDvns","optionalDvns","optionalDvnThreshold","startBlock","confirmations","rpcUrls"],"pathway");
  exactKeys(destination,["rpcUrls","chainId","srcEid","endpoint","receiveLibrary","oapp","adapter","useDefaultReceiveLibrary","confirmations","requiredDvns","optionalDvns","optionalDvnThreshold","authorizedSigners","quorum","signatureTtlSeconds"],"destination");

  const rpcUrls=secureRpcUrls(pathway.rpcUrls,"pathway.rpcUrls");
  const destinationRpcUrls=secureRpcUrls(destination.rpcUrls,"destination.rpcUrls");
  const sourceChainId=uint(pathway.sourceChainId,"pathway.sourceChainId");
  const destinationChainId=uint(pathway.destinationChainId,"pathway.destinationChainId");
  const srcEid=uint(pathway.srcEid,"pathway.srcEid");
  const sourceOApp=bytes32(pathway.sourceOApp,"pathway.sourceOApp");
  const sourceOAppAddress=address(pathway.sourceOAppAddress,"pathway.sourceOAppAddress");
  const paddedSourceOApp=`0x${"0".repeat(24)}${sourceOAppAddress.slice(2)}`.toLowerCase();
  if(paddedSourceOApp!==sourceOApp.toLowerCase())throw new Error("source OApp binding mismatch");
  const destinationOApp=bytes32(pathway.destinationOApp,"pathway.destinationOApp");
  const destinationOappAddress=address(destination.oapp,"destination.oapp");
  const paddedOapp=`0x${"0".repeat(24)}${destinationOappAddress.slice(2)}`.toLowerCase();
  if(paddedOapp!==destinationOApp.toLowerCase())throw new Error("destination OApp binding mismatch");
  const sentinelDvn=address(pathway.sentinelDvn,"pathway.sentinelDvn");
  const deadDvn=address(pathway.deadDvn,"pathway.deadDvn");
  const sourceRequiredDvns=sortedAddresses(pathway.requiredDvns,"pathway.requiredDvns");
  const sourceOptionalDvns=sortedAddresses(pathway.optionalDvns,"pathway.optionalDvns");
  if(sourceRequiredDvns.some(value=>same(value,sentinelDvn)))throw new Error("Sentinel must not be a required source DVN");
  if(!sourceOptionalDvns.some(value=>same(value,sentinelDvn)))throw new Error("Sentinel must be an optional source DVN");
  if([...sourceRequiredDvns,...sourceOptionalDvns].some(value=>same(value,deadDvn)))throw new Error("source DVNs must not include the Dead DVN");
  const sourceOptionalDvnThreshold=uint(pathway.optionalDvnThreshold,"pathway.optionalDvnThreshold");
  if(sourceOptionalDvnThreshold>sourceOptionalDvns.length)throw new Error("source optional DVN threshold is invalid");

  const destinationChain=uint(destination.chainId,"destination.chainId");
  const destinationSrcEid=uint(destination.srcEid,"destination.srcEid");
  if(destinationChain!==destinationChainId||destinationSrcEid!==srcEid)throw new Error("destination pathway identity mismatch");
  if(destination.useDefaultReceiveLibrary!==false)throw new Error("destination receive library must be explicit");
  const destinationAdapter=address(destination.adapter,"destination.adapter");
  const requiredDvns=sortedAddresses(destination.requiredDvns,"destination.requiredDvns");
  const optionalDvns=sortedAddresses(destination.optionalDvns,"destination.optionalDvns");
  if(requiredDvns.some(value=>same(value,destinationAdapter)))throw new Error("Sentinel adapter must not be a required DVN");
  if(!optionalDvns.some(value=>same(value,destinationAdapter)))throw new Error("Sentinel adapter must be an optional DVN");
  const optionalDvnThreshold=uint(destination.optionalDvnThreshold,"destination.optionalDvnThreshold");
  if(optionalDvnThreshold>optionalDvns.length)throw new Error("destination optional DVN threshold is invalid");
  const authorizedSigners=sortedAddresses(destination.authorizedSigners,"destination.authorizedSigners");
  if(authorizedSigners.length!==5)throw new Error("destination must configure exactly five signers");
  const quorum=uint(destination.quorum,"destination.quorum");
  if(quorum!==3)throw new Error("destination signer quorum must be three");
  const signatureTtlSeconds=uint(destination.signatureTtlSeconds,"destination.signatureTtlSeconds");
  if(signatureTtlSeconds<30||signatureTtlSeconds>900)throw new Error("destination signature TTL must be between 30 and 900 seconds");

  const evidenceUrl=secureUrl(text(evidence.uri,"evidence.uri"),"evidence.uri");
  const allowedHost=hostname(text(evidence.allowedHost,"evidence.allowedHost"));
  if(evidenceUrl.hostname!==allowedHost)throw new Error("evidence URI must match allowed host");
  const host=text(status.host,"status.host");
  if(host!=="127.0.0.1"&&host!=="::1")throw new Error("status API must bind to loopback in prototype mode");

  return {
    mode:"TESTNET_PROTOTYPE",
    pathway:{name:text(pathway.name,"pathway.name"),sourceChainId,destinationChainId,srcEid,dstEid:uint(pathway.dstEid,"pathway.dstEid"),endpoint:address(pathway.endpoint,"pathway.endpoint"),sendLibrary:address(pathway.sendLibrary,"pathway.sendLibrary"),sourceOApp,sourceOAppAddress,destinationOApp,sentinelDvn,executor:address(pathway.executor,"pathway.executor"),maxMessageSize:uint(pathway.maxMessageSize,"pathway.maxMessageSize"),deadDvn,requiredDvns:sourceRequiredDvns,optionalDvns:sourceOptionalDvns,optionalDvnThreshold:sourceOptionalDvnThreshold,startBlock:big(pathway.startBlock,"pathway.startBlock",true),confirmations:big(pathway.confirmations,"pathway.confirmations"),rpcUrls},
    destination:{rpcUrls:destinationRpcUrls,chainId:destinationChain,srcEid:destinationSrcEid,endpoint:address(destination.endpoint,"destination.endpoint"),receiveLibrary:address(destination.receiveLibrary,"destination.receiveLibrary"),oapp:destinationOappAddress,adapter:destinationAdapter,useDefaultReceiveLibrary:false,confirmations:big(destination.confirmations,"destination.confirmations"),requiredDvns,optionalDvns,optionalDvnThreshold,authorizedSigners,quorum:3,signatureTtlSeconds},
    evidence:{uri:evidenceUrl.href,allowedHost,policy:text(evidence.policy,"evidence.policy"),ttlSeconds:uint(evidence.ttlSeconds,"evidence.ttlSeconds"),maximumBytes:uint(evidence.maximumBytes,"evidence.maximumBytes")},
    genlayer:{endpoint:secureUrl(text(genlayer.endpoint,"genlayer.endpoint"),"genlayer.endpoint").href,policyContract:address(genlayer.policyContract,"genlayer.policyContract")},
    storage:{sqlitePath:absolutePath(storage.sqlitePath)},
    runtime:{pollIntervalMs:uint(runtime.pollIntervalMs,"runtime.pollIntervalMs"),maxIngestionAttempts:uint(runtime.maxIngestionAttempts,"runtime.maxIngestionAttempts")},
    status:{host,port:port(status.port)}
  };
}

export function publicConfigSummary(config:RuntimeConfig):RecordValue {
  return {
    mode:config.mode,
    pathway:{...config.pathway,rpcUrls:config.pathway.rpcUrls.map(url=>new URL(url).origin),startBlock:config.pathway.startBlock.toString(),confirmations:config.pathway.confirmations.toString()},
    destination:{...config.destination,rpcUrls:config.destination.rpcUrls.map(url=>new URL(url).origin),confirmations:config.destination.confirmations.toString()},
    evidence:{uri:config.evidence.uri,allowedHost:config.evidence.allowedHost,ttlSeconds:config.evidence.ttlSeconds,maximumBytes:config.evidence.maximumBytes},
    genlayer:{endpoint:new URL(config.genlayer.endpoint).origin,policyContract:config.genlayer.policyContract},
    storage:{sqlitePath:"[configured]"},
    runtime:config.runtime,
    status:config.status
  };
}

function record(value:unknown,name:string):RecordValue {if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${name} must be an object`);return value as RecordValue}
function text(value:unknown,name:string):string {if(typeof value!=="string"||!value.trim())throw new Error(`${name} is required`);return value}
function strings(value:unknown,name:string):string[] {if(!Array.isArray(value)||value.some(item=>typeof item!=="string"))throw new Error(`${name} must be a string array`);return value}
function uint(value:unknown,name:string):number {if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error(`${name} must be a positive integer`);return Number(value)}
function big(value:unknown,name:string,zero=false):bigint {if(typeof value!=="string"||!/^[0-9]+$/.test(value)||(zero?false:BigInt(value)===0n))throw new Error(`${name} must be a ${zero?"non-negative":"positive"} decimal string`);return BigInt(value)}
function address(value:unknown,name:string):Hex {const result=text(value,name);if(!/^0x[0-9a-fA-F]{40}$/.test(result)||/^0x0{40}$/i.test(result))throw new Error(`${name} must be a nonzero address`);return result as Hex}
function bytes32(value:unknown,name:string):Hex {const result=text(value,name);if(!/^0x[0-9a-fA-F]{64}$/.test(result)||/^0x0{64}$/i.test(result))throw new Error(`${name} must be nonzero bytes32`);return result as Hex}
function secureUrl(value:string,name:string):URL {let url:URL;try{url=new URL(value)}catch{throw new Error(`${name} must be a URL`)}if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||isIP(url.hostname.replace(/^\[|\]$/g,""))!==0)throw new Error(`${name} must be a public HTTPS origin`);return url}
function secureRpcUrls(value:unknown,name:string):string[] {const values=strings(value,name);if(values.length<2)throw new Error(`${name} requires at least two URLs`);const urls=values.map((item,index)=>secureUrl(item,`${name}[${index}]`));if(new Set(urls.map(url=>url.origin)).size!==urls.length)throw new Error(`${name} origins must be independent`);return urls.map(url=>url.href)}
function sortedAddresses(value:unknown,name:string):Hex[] {if(!Array.isArray(value)||value.length===0)throw new Error(`${name} must be a nonempty address array`);const result=value.map((item,index)=>address(item,`${name}[${index}]`));for(let index=1;index<result.length;index++)if(result[index]!.toLowerCase()<=result[index-1]!.toLowerCase())throw new Error(`${name} must be unique and sorted`);return result}
function exactKeys(value:RecordValue,expected:string[],name:string):void {const actual=Object.keys(value).sort(),wanted=[...expected].sort();if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))throw new Error(`${name} has missing or unknown keys`)}
function same(left:string,right:string):boolean {return left.toLowerCase()===right.toLowerCase()}
function hostname(value:string):string {if(value!==value.toLowerCase()||value.includes(":")||value.includes("/")||value==="localhost"||value.endsWith(".localhost")||isIP(value)!==0)throw new Error("evidence.allowedHost is invalid");return value}
function absolutePath(value:unknown):string {const result=text(value,"storage.sqlitePath");if(!result.startsWith("/")||result.includes("\0"))throw new Error("storage.sqlitePath must be absolute");return result}
function port(value:unknown):number {const result=uint(value,"status.port");if(result>65535)throw new Error("status.port is invalid");return result}
