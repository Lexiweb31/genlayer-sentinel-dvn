import type {Hex} from "../../../packages/core/src/types.js";
import {id} from "ethers";

export interface DemoCapability {
  mode:"LOCAL_WALLET_DEMO";
  chainId:31337n;
  chainName:string;
  rpcUrl:string;
  sourceOApp:Hex;
  sourceEndpoint:Hex;
  destinationEid:number;
  authorizedTarget:Hex;
  actionSelector:Hex;
  actionSignature:"record(bytes32)";
  approvedRecordLabel:string;
  approvedArgument:Hex;
  approvedAuthorizationId:Hex;
  options:Hex;
  payInLzToken:false;
  semanticSource:"LOCAL_POLICY_FIXTURE";
}

export function parseDemoCapability(_value:unknown):DemoCapability {
  const value=record(_value);
  exactKeys(value,[
    "mode","chainId","chainName","rpcUrl","sourceOApp","sourceEndpoint",
    "destinationEid","authorizedTarget","actionSelector","actionSignature",
    "approvedRecordLabel","approvedArgument","approvedAuthorizationId",
    "options","payInLzToken","semanticSource"
  ]);
  if(value.mode!=="LOCAL_WALLET_DEMO")throw new Error("invalid demo mode");
  if(value.chainId!=="31337")throw new Error("invalid demo chain");
  const chainName=printable(value.chainName,"chain name");
  const approvedRecordLabel=printable(value.approvedRecordLabel,"approved record label");
  const actionSignature="record(bytes32)" as const;
  if(value.actionSignature!==actionSignature)throw new Error("invalid demo action signature");
  const actionSelector=id(actionSignature).slice(0,10).toLowerCase() as Hex;
  if(value.actionSelector!==actionSelector)throw new Error("invalid demo action selector");
  const approvedArgument=hash(value.approvedArgument,"approved argument");
  if(id(approvedRecordLabel).toLowerCase()!==approvedArgument)throw new Error("approved record binding mismatch");
  if(value.options!=="0x")throw new Error("invalid demo options");
  if(value.payInLzToken!==false)throw new Error("demo must pay in native token");
  if(value.semanticSource!=="LOCAL_POLICY_FIXTURE")throw new Error("invalid semantic source");
  return{
    mode:"LOCAL_WALLET_DEMO",
    chainId:31337n,
    chainName,
    rpcUrl:loopbackUrl(value.rpcUrl),
    sourceOApp:address(value.sourceOApp,"source OApp"),
    sourceEndpoint:address(value.sourceEndpoint,"source Endpoint"),
    destinationEid:uint(value.destinationEid,"destination EID"),
    authorizedTarget:address(value.authorizedTarget,"authorized target"),
    actionSelector,
    actionSignature,
    approvedRecordLabel,
    approvedArgument,
    approvedAuthorizationId:hash(value.approvedAuthorizationId,"authorization ID"),
    options:"0x",
    payInLzToken:false,
    semanticSource:"LOCAL_POLICY_FIXTURE"
  };
}

export function publicDemoCapability(value:DemoCapability):Record<string,unknown> {
  return{...value,chainId:value.chainId.toString()};
}

type UnknownRecord=Record<string,unknown>;
function record(value:unknown):UnknownRecord {if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("demo capability must be an object");return value as UnknownRecord}
function exactKeys(value:UnknownRecord,expected:string[]):void {const actual=Object.keys(value).sort(),wanted=[...expected].sort();if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))throw new Error("demo capability has missing or unknown keys")}
function printable(value:unknown,name:string):string {if(typeof value!=="string"||value.length===0||value.length>80||!/[^\s]/.test(value)||/[^\x20-\x7e]/.test(value))throw new Error(`${name} is invalid`);return value}
function address(value:unknown,name:string):Hex {if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error(`${name} is invalid`);return value.toLowerCase() as Hex}
function hash(value:unknown,name:string):Hex {if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error(`${name} is invalid`);return value.toLowerCase() as Hex}
function uint(value:unknown,name:string):number {if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error(`${name} is invalid`);return Number(value)}
function loopbackUrl(value:unknown):string {if(typeof value!=="string")throw new Error("demo RPC URL is invalid");let url:URL;try{url=new URL(value)}catch{throw new Error("demo RPC URL is invalid")}if(url.protocol!=="http:"||url.username||url.password||!url.port||url.pathname!=="/"||url.search||url.hash||(url.hostname!=="127.0.0.1"&&url.hostname!=="[::1]"))throw new Error("demo RPC must be a loopback HTTP origin");const port=Number(url.port);if(!Number.isInteger(port)||port<1||port>65535)throw new Error("demo RPC port is invalid");return url.href}
