import{lookup as dnsLookup}from"node:dns/promises";
import{request as httpsRequest}from"node:https";
import type{ClientRequest,IncomingMessage}from"node:http";
import type{RequestOptions}from"node:https";
import{isIP}from"node:net";
import type{TLSSocket}from"node:tls";
import{TextDecoder}from"node:util";
import{parseJsonDocument}from"./canonical-json.js";
import{type AuditRpcEndpoint,PathwayAuditError}from"./pathway-audit-model.js";

export{PathwayAuditError}from"./pathway-audit-model.js";

export type ReadOnlyRpcMethod=
  "eth_chainId"|"eth_blockNumber"|"eth_getBlockByNumber"|
  "eth_getCode"|"eth_call"|"eth_getTransactionByHash"|
  "eth_getTransactionReceipt";

export interface ReadOnlyRpcClient{
  call(method:ReadOnlyRpcMethod,params:unknown[]):Promise<unknown>;
  descriptor():{label:string;originSha256:string;operatorFamily:string};
}

export interface ReadOnlyRpcResolution{address:string;family:4|6}
export interface ReadOnlyRpcExchangeTarget{
  address:string;
  servername:string;
  hostHeader:string;
  path:string;
  method:"POST";
}
export interface ReadOnlyRpcExchangeRequest{
  headers:Record<string,string>;
  body:string;
  signal:AbortSignal;
  connectTimeoutMs:number;
  responseTimeoutMs:number;
  maxResponseBytes:number;
}
export interface ReadOnlyRpcExchangeResponse{
  statusCode:number;
  headers:Record<string,string|string[]|undefined>;
  body:Uint8Array;
}
export type ReadOnlyRpcExchange=(target:ReadOnlyRpcExchangeTarget,request:ReadOnlyRpcExchangeRequest)=>Promise<ReadOnlyRpcExchangeResponse>;
export type ReadOnlyRpcRequestFactory=(options:RequestOptions,onResponse:(response:IncomingMessage)=>void)=>ClientRequest;
export interface ReadOnlyRpcDependencies{
  resolve?:(hostname:string)=>Promise<readonly ReadOnlyRpcResolution[]>;
  exchange?:(target:ReadOnlyRpcExchangeTarget,request:ReadOnlyRpcExchangeRequest)=>Promise<ReadOnlyRpcExchangeResponse>;
  operationTimeoutMs?:number;
  /** Test-only escape hatch. It is ignored unless both network ports are injected. */
  allowDocumentationAddressesForTests?:boolean;
}

const CONNECT_TIMEOUT_MS=5_000;
const RESPONSE_TIMEOUT_MS=10_000;
const OPERATION_TIMEOUT_MS=15_000;
const MAX_RESPONSE_BYTES=2*1024*1024;
const MAX_REQUEST_BYTES=256*1024;
const MAX_HEADERS_COUNT=32;
const methods=new Set<string>([
  "eth_chainId","eth_blockNumber","eth_getBlockByNumber","eth_getCode",
  "eth_call","eth_getTransactionByHash","eth_getTransactionReceipt"
]);
const addressPattern=/^0x[0-9a-fA-F]{40}$/;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
const dataPattern=/^0x(?:[0-9a-fA-F]{2})*$/;
const quantityPattern=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

export function createReadOnlyRpcClient(endpoint:AuditRpcEndpoint,dependencies:ReadOnlyRpcDependencies={}):ReadOnlyRpcClient{
  const endpointSnapshot=snapshotEndpoint(endpoint);
  const resolver=typeof dependencies.resolve==="function"?dependencies.resolve:defaultResolve;
  const exchange=typeof dependencies.exchange==="function"?dependencies.exchange:nativeHttpsExchange;
  const operationTimeoutMs=dependencies.operationTimeoutMs??OPERATION_TIMEOUT_MS;
  const allowDocumentation=dependencies.allowDocumentationAddressesForTests===true&&
    typeof dependencies.resolve==="function"&&typeof dependencies.exchange==="function";
  let nextId=1;
  return{
    async call(method,params){
      const controller=new AbortController();
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        if(!endpointSnapshot||!Number.isSafeInteger(operationTimeoutMs)||operationTimeoutMs<1||operationTimeoutMs>OPERATION_TIMEOUT_MS)failure();
        const url=parseEndpointUrl(endpointSnapshot.url);
        const normalizedParams=normalizeParams(method,params);
        if(nextId>Number.MAX_SAFE_INTEGER)failure();
        const id=nextId++;
        const body=JSON.stringify({jsonrpc:"2.0",id,method,params:normalizedParams});
        if(Buffer.byteLength(body,"utf8")>MAX_REQUEST_BYTES)failure();
        const operationTimeout=new Promise<never>((_resolve,reject)=>{
          timer=setTimeout(()=>{controller.abort();reject(new Error("timeout"))},operationTimeoutMs);
          timer.unref();
        });
        const operation=(async()=>{
          const resolutions=await resolver(url.hostname);
          if(controller.signal.aborted)failure();
          const address=checkedResolution(resolutions,allowDocumentation);
          const response=await exchange({
            address,servername:url.hostname,hostHeader:url.hostname,path:url.pathname,method:"POST"
          },{
            headers:{
              Host:url.hostname,
              Accept:"application/json",
              "Content-Type":"application/json",
              "Content-Encoding":"identity",
              "Content-Length":String(Buffer.byteLength(body,"utf8")),
              Connection:"close"
            },
            body,signal:controller.signal,connectTimeoutMs:CONNECT_TIMEOUT_MS,
            responseTimeoutMs:RESPONSE_TIMEOUT_MS,maxResponseBytes:MAX_RESPONSE_BYTES
          });
          return parseResponse(response,id);
        })();
        return await Promise.race([operation,operationTimeout]);
      }catch{
        controller.abort();
        throw new PathwayAuditError("PATHWAY_AUDIT_TRANSPORT_FAILED");
      }finally{if(timer)clearTimeout(timer)}
    },
    descriptor(){
      return endpointSnapshot?{
        label:endpointSnapshot.label,
        originSha256:endpointSnapshot.originSha256,
        operatorFamily:endpointSnapshot.operatorFamily
      }:{label:"",originSha256:"",operatorFamily:""};
    }
  };
}

function snapshotEndpoint(value:AuditRpcEndpoint):AuditRpcEndpoint|null{
  try{
    if(!plainExact(value,["label","url","operatorFamily","originSha256"]))return null;
    const label=dataProperty(value,"label"),url=dataProperty(value,"url");
    const operatorFamily=dataProperty(value,"operatorFamily"),originSha256=dataProperty(value,"originSha256");
    if(typeof label!=="string"||!label||typeof url!=="string"||typeof operatorFamily!=="string"||!operatorFamily||
      typeof originSha256!=="string"||!/^[a-f0-9]{64}$/.test(originSha256))return null;
    return{label,url,operatorFamily,originSha256};
  }catch{return null}
}

function parseEndpointUrl(value:string):URL{
  if(/[\\\u0000-\u001f\u007f-\u009f]/.test(value)||value.includes("?")||value.includes("#"))return failure();
  const authority=/^https:\/\/([^/?#]+)(?:\/.*)?$/.exec(value)?.[1];
  if(!authority||authority.includes("@")||authority.includes(":"))return failure();
  let url:URL;
  try{url=new URL(value)}catch{return failure()}
  const hostname=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||url.username||url.password||url.port||isIP(hostname)!==0||
    hostname==="localhost"||hostname.endsWith(".localhost")||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)||
    (url.pathname!=="/"&&url.pathname!=="/rpc"))return failure();
  return url;
}

function normalizeParams(method:unknown,params:unknown):unknown[]{
  if(typeof method!=="string"||!methods.has(method)||!denseArray(params))return failure();
  switch(method){
    case"eth_chainId":case"eth_blockNumber":
      if(params.length!==0)failure();return[];
    case"eth_getBlockByNumber":
      if(params.length!==2||!quantity(params[0])||params[1]!==false)failure();
      return[params[0],false];
    case"eth_getCode":
      if(params.length!==2||!address(params[0]))failure();
      return[params[0],blockReference(params[1])];
    case"eth_call":
      if(params.length!==2)failure();
      return[callObject(params[0]),blockReference(params[1])];
    case"eth_getTransactionByHash":case"eth_getTransactionReceipt":
      if(params.length!==1||!hash(params[0]))failure();
      return[params[0]];
    default:return failure();
  }
}

function callObject(value:unknown):{to:string;data:string}{
  if(!plainExact(value,["to","data"]))return failure();
  const to=dataProperty(value,"to"),data=dataProperty(value,"data");
  if(!address(to)||typeof data!=="string"||!dataPattern.test(data))return failure();
  return{to,data};
}

function blockReference(value:unknown):{blockHash:string;requireCanonical:true}{
  if(!plainExact(value,["blockHash","requireCanonical"]))return failure();
  const blockHash=dataProperty(value,"blockHash"),requireCanonical=dataProperty(value,"requireCanonical");
  if(!hash(blockHash)||requireCanonical!==true)return failure();
  return{blockHash,requireCanonical:true};
}

function denseArray(value:unknown):value is unknown[]{
  if(!Array.isArray(value))return false;
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>key!=="length"&&(typeof key!=="string"||!/^(0|[1-9][0-9]*)$/.test(key))))return false;
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return false;
  }
  return true;
}

function plainExact(value:unknown,expected:string[]):value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return false;
  const keys=Reflect.ownKeys(value);
  return keys.length===expected.length&&keys.every(key=>typeof key==="string"&&expected.includes(key));
}

function dataProperty(value:Record<string,unknown>,key:string):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return failure();
  return descriptor.value;
}

function address(value:unknown):value is string{return typeof value==="string"&&addressPattern.test(value)}
function hash(value:unknown):value is string{return typeof value==="string"&&hashPattern.test(value)&&!/^0x0{64}$/i.test(value)}
function quantity(value:unknown):value is string{return typeof value==="string"&&quantityPattern.test(value)}

async function defaultResolve(hostname:string):Promise<readonly ReadOnlyRpcResolution[]>{
  const values=await dnsLookup(hostname,{all:true,verbatim:true});
  return values.map(value=>({address:value.address,family:value.family as 4|6}));
}

function checkedResolution(values:readonly ReadOnlyRpcResolution[],allowDocumentation:boolean):string{
  if(!Array.isArray(values)||values.length===0)return failure();
  const checked:string[]=[];
  for(const value of values){
    if(!plainExact(value,["address","family"]))return failure();
    const addressValue=dataProperty(value,"address"),family=dataProperty(value,"family");
    if(typeof addressValue!=="string"||(family!==4&&family!==6)||isIP(addressValue)!==family||
      !publicAddress(addressValue,allowDocumentation))return failure();
    checked.push(addressValue);
  }
  return checked[0]!;
}

function publicAddress(addressValue:string,allowDocumentation:boolean):boolean{
  const family=isIP(addressValue);
  if(family===4){
    if(allowDocumentation&&isDocumentationV4(addressValue))return true;
    return !ipv4Ranges.some(([network,prefix])=>inCidr(ipv4Number(addressValue),ipv4Number(network),prefix,32));
  }
  if(family===6){
    const value=ipv6Number(addressValue);
    if(!inCidr(value,ipv6Number("2000::"),3,128))return false;
    return !ipv6NonGlobalRanges.some(([network,prefix])=>inCidr(value,ipv6Number(network),prefix,128));
  }
  return false;
}

const ipv4Ranges:[string,number][]=[
  ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.88.99.0",24],
  ["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],
  ["224.0.0.0",4],["240.0.0.0",4]
];
const ipv6NonGlobalRanges:[string,number][]=[
  ["2001::",23],["2001:db8::",32],["2002::",16],["3ffe::",16],["3fff::",20]
];

function isDocumentationV4(value:string):boolean{
  return[["192.0.2.0",24],["198.51.100.0",24],["203.0.113.0",24]].some(([network,prefix])=>
    inCidr(ipv4Number(value),ipv4Number(network as string),prefix as number,32));
}
function ipv4Number(value:string):bigint{
  return value.split(".").reduce((result,part)=>(result<<8n)|BigInt(Number(part)),0n);
}
function ipv6Number(input:string):bigint{
  let value=input.toLowerCase();
  if(value.includes(".")){
    const lastColon=value.lastIndexOf(":"),v4=ipv4Number(value.slice(lastColon+1));
    value=`${value.slice(0,lastColon)}:${(v4>>16n).toString(16)}:${(v4&0xffffn).toString(16)}`;
  }
  const halves=value.split("::");
  if(halves.length>2)return failure();
  const left=halves[0]?halves[0].split(":"):[],right=halves[1]?halves[1].split(":"):[];
  const missing=8-left.length-right.length;
  if((halves.length===1&&missing!==0)||(halves.length===2&&missing<1))return failure();
  const parts=[...left,...Array(missing).fill("0"),...right];
  if(parts.length!==8||parts.some(part=>!/^[0-9a-f]{1,4}$/.test(part)))return failure();
  return parts.reduce((result,part)=>(result<<16n)|BigInt(`0x${part}`),0n);
}
function inCidr(value:bigint,network:bigint,prefix:number,bits:number):boolean{
  const shift=BigInt(bits-prefix);return(value>>shift)===(network>>shift);
}

function parseResponse(response:ReadOnlyRpcExchangeResponse,id:number):unknown{
  if(!response||response.statusCode!==200||!response.headers||!(response.body instanceof Uint8Array)||
    response.body.byteLength===0||response.body.byteLength>MAX_RESPONSE_BYTES)failure();
  const contentType=header(response.headers,"content-type");
  if(!contentType||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType))failure();
  let text:string;
  try{text=new TextDecoder("utf-8",{fatal:true}).decode(response.body)}catch{return failure()}
  const value=parseJsonDocument(text);
  if(!plainExact(value,["jsonrpc","id","result"]))return failure();
  if(dataProperty(value,"jsonrpc")!=="2.0"||dataProperty(value,"id")!==id)return failure();
  return dataProperty(value,"result");
}

function header(headers:Record<string,string|string[]|undefined>,name:string):string|undefined{
  const matches=Object.entries(headers).filter(([key])=>key.toLowerCase()===name);
  if(matches.length!==1||typeof matches[0]![1]!=="string")return undefined;
  return matches[0]![1] as string;
}

export function createNativeHttpsExchange(requestFactory:ReadOnlyRpcRequestFactory=defaultRequestFactory):ReadOnlyRpcExchange{
  return(target,input)=>nativeHttpsExchange(target,input,requestFactory);
}

const defaultRequestFactory:ReadOnlyRpcRequestFactory=(options,onResponse)=>httpsRequest(options,onResponse);

function nativeHttpsExchange(
  target:ReadOnlyRpcExchangeTarget,
  input:ReadOnlyRpcExchangeRequest,
  requestFactory:ReadOnlyRpcRequestFactory=defaultRequestFactory
):Promise<ReadOnlyRpcExchangeResponse>{
  if(input.signal.aborted)return Promise.reject(new Error("aborted"));
  return new Promise((resolve,reject)=>{
    let settled=false,responseReceived=false;
    let connectTimer:ReturnType<typeof setTimeout>|undefined,responseTimer:ReturnType<typeof setTimeout>|undefined;
    let responseStream:import("node:http").IncomingMessage|undefined;
    const finish=(error?:Error,result?:ReadOnlyRpcExchangeResponse)=>{
      if(settled)return;settled=true;
      if(connectTimer)clearTimeout(connectTimer);if(responseTimer)clearTimeout(responseTimer);
      input.signal.removeEventListener("abort",abort);
      if(error){responseStream?.destroy();request.destroy();reject(error)}else resolve(result!);
    };
    const abort=()=>finish(new Error("aborted"));
    const request=requestFactory({
      host:target.address,port:443,servername:target.servername,path:target.path,method:target.method,
      agent:false,rejectUnauthorized:true,minVersion:"TLSv1.2",maxVersion:"TLSv1.3",
      headers:input.headers
    },response=>{
      responseReceived=true;responseStream=response;
      if(responseTimer)clearTimeout(responseTimer);
      if(response.rawHeaders.length/2>MAX_HEADERS_COUNT){finish(new Error("headers"));return}
      const contentLength=singleRawHeader(response.rawHeaders,"content-length");
      const encoding=singleRawHeader(response.rawHeaders,"content-encoding");
      if(contentLength.kind==="multiple"||encoding.kind==="multiple"||
        (encoding.kind==="value"&&encoding.value.toLowerCase()!=="identity")){finish(new Error("headers"));return}
      if(contentLength.kind==="value"&&(!/^[0-9]+$/.test(contentLength.value)||BigInt(contentLength.value)>BigInt(input.maxResponseBytes))){
        finish(new Error("length"));return;
      }
      const chunks:Buffer[]=[];let received=0,ended=false;
      const fail=()=>finish(new Error("response"));
      response.on("data",(chunk:Buffer|string)=>{
        if(settled)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        received+=bytes.length;if(received>input.maxResponseBytes){fail();return}chunks.push(bytes);
      });
      response.once("aborted",fail);response.once("error",fail);
      response.once("end",()=>{
        ended=true;
        if(response.complete!==true||contentLength.kind==="value"&&received!==Number(contentLength.value)){fail();return}
        const headers:Record<string,string|string[]|undefined>={};
        for(let index=0;index<response.rawHeaders.length;index+=2){
          const name=response.rawHeaders[index]!.toLowerCase(),value=response.rawHeaders[index+1]!;
          const prior=headers[name];headers[name]=prior===undefined?value:Array.isArray(prior)?[...prior,value]:[prior,value];
        }
        finish(undefined,{statusCode:response.statusCode??0,headers,body:Buffer.concat(chunks,received)});
      });
      response.once("close",()=>{if(!ended&&!settled)fail()});
    });
    request.maxHeadersCount=MAX_HEADERS_COUNT+1;
    input.signal.addEventListener("abort",abort,{once:true});
    connectTimer=setTimeout(()=>finish(new Error("connect")),input.connectTimeoutMs);connectTimer.unref();
    request.once("socket",socket=>{
      (socket as TLSSocket).once("secureConnect",()=>{
        if(settled)return;if(connectTimer)clearTimeout(connectTimer);
        responseTimer=setTimeout(()=>{if(!responseReceived)finish(new Error("response"))},input.responseTimeoutMs);
        responseTimer.unref();
      });
    });
    request.once("error",()=>finish(new Error("request")));
    try{request.end(input.body)}catch{finish(new Error("request"))}
  });
}

function singleRawHeader(rawHeaders:string[],name:string):{kind:"missing"}|{kind:"multiple"}|{kind:"value";value:string}{
  const values:string[]=[];
  for(let index=0;index<rawHeaders.length;index+=2)if(rawHeaders[index]!.toLowerCase()===name)values.push(rawHeaders[index+1]!);
  if(values.length===0)return{kind:"missing"};if(values.length!==1)return{kind:"multiple"};
  return{kind:"value",value:values[0]!};
}

function failure():never{throw new Error("transport")}
