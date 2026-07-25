import {Interface,id,toQuantity} from "ethers";
import type {Hex} from "../../../packages/core/src/types.js";

export type WalletActionErrorCode=
  |"WALLET_UNAVAILABLE"|"ACCOUNT_UNAVAILABLE"|"WRONG_CHAIN"
  |"WRONG_OWNER"|"CONFIG_INVALID"|"QUOTE_REVERTED"
  |"INSUFFICIENT_LOCAL_FUNDS"|"USER_REJECTED"|"SOURCE_REVERTED"
  |"SOURCE_RECEIPT_UNAVAILABLE"|"ACTION_EVENT_MISSING"
  |"ACTION_EVENT_AMBIGUOUS";

const messages:Record<WalletActionErrorCode,string>={
  WALLET_UNAVAILABLE:"An injected wallet is unavailable.",
  ACCOUNT_UNAVAILABLE:"The wallet did not provide an account.",
  WRONG_CHAIN:"The wallet is connected to the wrong local chain.",
  WRONG_OWNER:"The selected account is not the configured source OApp owner.",
  CONFIG_INVALID:"The local demo configuration is invalid.",
  QUOTE_REVERTED:"The source OApp fee quote failed.",
  INSUFFICIENT_LOCAL_FUNDS:"The wallet could not submit the local source transaction.",
  USER_REJECTED:"The wallet request was rejected.",
  SOURCE_REVERTED:"The source transaction reverted.",
  SOURCE_RECEIPT_UNAVAILABLE:"The source transaction receipt is unavailable.",
  ACTION_EVENT_MISSING:"The source receipt does not contain the configured ActionSent event.",
  ACTION_EVENT_AMBIGUOUS:"The source receipt contains ambiguous ActionSent events."
};

export class WalletActionError extends Error {
  constructor(readonly code:WalletActionErrorCode){super(messages[code]);this.name="WalletActionError"}
}

export interface Eip1193Provider {
  request(args:{method:string;params?:unknown[]}):Promise<unknown>;
  on?(event:"accountsChanged"|"chainChanged",listener:(value:unknown)=>void):void;
  removeListener?(event:"accountsChanged"|"chainChanged",listener:(value:unknown)=>void):void;
}

export interface PublicDemoConfig {
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
  options:"0x";
  payInLzToken:false;
  semanticSource:"LOCAL_POLICY_FIXTURE";
}

export interface WalletSession {account:Hex;chainId:31337n}
export interface PreparedDemoAction {authorizationId:Hex;target:Hex;value:0n;data:Hex}
export interface PreparedQuote {
  account:Hex;
  chainId:31337n;
  recordLabel:string;
  argument:Hex;
  action:PreparedDemoAction;
  nativeFee:bigint;
  lzTokenFee:0n;
}
export interface SourceSubmission {transactionHash:Hex;guid:Hex;blockNumber:bigint}

const oapp=new Interface([
  "function owner() view returns(address)",
  "function quoteAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,bool) view returns((uint256 nativeFee,uint256 lzTokenFee) fee)",
  "function sendAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,(uint256 nativeFee,uint256 lzTokenFee) fee) payable",
  "event ActionSent(bytes32 indexed authorizationId,bytes32 indexed guid,uint32 indexed dstEid,address target,uint256 value)"
]);
const actionTarget=new Interface(["function record(bytes32)"]);
const sentTopic=oapp.getEvent("ActionSent")!.topicHash.toLowerCase();

export function parsePublicDemoConfig(input:unknown):PublicDemoConfig {
  try{
    const value=object(input);
    exactKeys(value,["mode","chainId","chainName","rpcUrl","sourceOApp","sourceEndpoint","destinationEid","authorizedTarget","actionSelector","actionSignature","approvedRecordLabel","approvedArgument","approvedAuthorizationId","options","payInLzToken","semanticSource"]);
    if(value.mode!=="LOCAL_WALLET_DEMO"||value.chainId!=="31337"||value.actionSignature!=="record(bytes32)"||value.options!=="0x"||value.payInLzToken!==false||value.semanticSource!=="LOCAL_POLICY_FIXTURE")throw new Error();
    const approvedRecordLabel=printable(value.approvedRecordLabel),approvedArgument=hash(value.approvedArgument);
    const actionSelector=id("record(bytes32)").slice(0,10).toLowerCase() as Hex;
    if(value.actionSelector!==actionSelector||id(approvedRecordLabel).toLowerCase()!==approvedArgument)throw new Error();
    return{
      mode:"LOCAL_WALLET_DEMO",
      chainId:31337n,
      chainName:printable(value.chainName),
      rpcUrl:loopback(value.rpcUrl),
      sourceOApp:address(value.sourceOApp),
      sourceEndpoint:address(value.sourceEndpoint),
      destinationEid:uint(value.destinationEid),
      authorizedTarget:address(value.authorizedTarget),
      actionSelector,
      actionSignature:"record(bytes32)",
      approvedRecordLabel,
      approvedArgument,
      approvedAuthorizationId:hash(value.approvedAuthorizationId),
      options:"0x",
      payInLzToken:false,
      semanticSource:"LOCAL_POLICY_FIXTURE"
    };
  }catch(error){if(error instanceof WalletActionError)throw error;throw new WalletActionError("CONFIG_INVALID")}
}

export class WalletActionClient {
  private pollIntervalMs:number;
  private maxReceiptPolls:number;
  constructor(private provider:Eip1193Provider,options:{pollIntervalMs?:number;maxReceiptPolls?:number}={}){
    if(!provider||typeof provider.request!=="function")throw new WalletActionError("WALLET_UNAVAILABLE");
    this.pollIntervalMs=options.pollIntervalMs??1000;this.maxReceiptPolls=options.maxReceiptPolls??120;
    if(!Number.isSafeInteger(this.pollIntervalMs)||this.pollIntervalMs<0||!Number.isSafeInteger(this.maxReceiptPolls)||this.maxReceiptPolls<=0)throw new WalletActionError("CONFIG_INVALID");
  }

  async connect(config:PublicDemoConfig):Promise<WalletSession>{
    let raw:unknown;try{raw=await this.provider.request({method:"eth_requestAccounts"})}catch{throw new WalletActionError("ACCOUNT_UNAVAILABLE")}
    if(!Array.isArray(raw)||raw.length!==1)throw new WalletActionError("ACCOUNT_UNAVAILABLE");
    const account=safeAddress(raw[0],"ACCOUNT_UNAVAILABLE");
    await this.assertChain(config);
    await this.assertOwner(config,account);
    return{account,chainId:31337n};
  }

  async quote(config:PublicDemoConfig,session:WalletSession,recordLabel:string):Promise<PreparedQuote>{
    await this.assertSession(config,session);
    let label:string;try{label=printable(recordLabel)}catch{throw new WalletActionError("CONFIG_INVALID")}
    const argument=id(label).toLowerCase() as Hex;
    const action:PreparedDemoAction={authorizationId:config.approvedAuthorizationId,target:config.authorizedTarget,value:0n,data:actionTarget.encodeFunctionData("record",[argument]) as Hex};
    const data=oapp.encodeFunctionData("quoteAction",[config.destinationEid,action,config.options,false]);
    let raw:unknown;try{raw=await this.provider.request({method:"eth_call",params:[{to:config.sourceOApp,data},"latest"]})}catch{throw new WalletActionError("QUOTE_REVERTED")}
    try{
      const [fee]=oapp.decodeFunctionResult("quoteAction",String(raw));
      const nativeFee=BigInt(fee.nativeFee),lzTokenFee=BigInt(fee.lzTokenFee);
      if(nativeFee<=0n||lzTokenFee!==0n)throw new Error();
      return{account:session.account,chainId:31337n,recordLabel:label,argument,action,nativeFee,lzTokenFee:0n};
    }catch{throw new WalletActionError("QUOTE_REVERTED")}
  }

  async submit(config:PublicDemoConfig,session:WalletSession,quote:PreparedQuote):Promise<SourceSubmission>{
    await this.assertSession(config,session);this.assertQuote(config,session,quote);
    const data=oapp.encodeFunctionData("sendAction",[config.destinationEid,quote.action,config.options,{nativeFee:quote.nativeFee,lzTokenFee:quote.lzTokenFee}]);
    let rawHash:unknown;
    try{rawHash=await this.provider.request({method:"eth_sendTransaction",params:[{from:session.account,to:config.sourceOApp,data,value:toQuantity(quote.nativeFee)}]})}
    catch(error){if(providerCode(error)===4001)throw new WalletActionError("USER_REJECTED");throw new WalletActionError("INSUFFICIENT_LOCAL_FUNDS")}
    const transactionHash=safeHash(rawHash,"SOURCE_RECEIPT_UNAVAILABLE");
    let receipt:Receipt|undefined;
    for(let attempt=0;attempt<this.maxReceiptPolls;attempt++){
      let value:unknown;try{value=await this.provider.request({method:"eth_getTransactionReceipt",params:[transactionHash]})}catch{throw new WalletActionError("SOURCE_RECEIPT_UNAVAILABLE")}
      if(value!==null){receipt=parseReceipt(value);break}
      if(attempt+1<this.maxReceiptPolls)await delay(this.pollIntervalMs);
    }
    if(!receipt||receipt.transactionHash!==transactionHash)throw new WalletActionError("SOURCE_RECEIPT_UNAVAILABLE");
    if(receipt.status!=="0x1")throw new WalletActionError("SOURCE_REVERTED");
    const matches:Hex[]=[];
    for(const log of receipt.logs){
      if(log.address!==config.sourceOApp||log.topics[0]?.toLowerCase()!==sentTopic)continue;
      try{
        const parsed=oapp.parseLog({topics:log.topics,data:log.data});
        if(parsed&&same(parsed.args.authorizationId,config.approvedAuthorizationId)&&BigInt(parsed.args.dstEid)===BigInt(config.destinationEid)&&same(parsed.args.target,config.authorizedTarget)&&BigInt(parsed.args.value)===0n)matches.push(safeHash(parsed.args.guid,"ACTION_EVENT_MISSING"));
      }catch{}
    }
    if(matches.length===0)throw new WalletActionError("ACTION_EVENT_MISSING");
    if(matches.length!==1)throw new WalletActionError("ACTION_EVENT_AMBIGUOUS");
    return{transactionHash,guid:matches[0]!,blockNumber:receipt.blockNumber};
  }

  private async assertSession(config:PublicDemoConfig,session:WalletSession):Promise<void>{
    if(session.chainId!==31337n)throw new WalletActionError("WRONG_CHAIN");
    await this.assertChain(config);await this.assertOwner(config,session.account);
  }
  private async assertChain(config:PublicDemoConfig):Promise<void>{
    let raw:unknown;try{raw=await this.provider.request({method:"eth_chainId"})}catch{throw new WalletActionError("WRONG_CHAIN")}
    if(typeof raw!=="string"||!/^0x[0-9a-fA-F]+$/.test(raw)||BigInt(raw)!==config.chainId)throw new WalletActionError("WRONG_CHAIN");
  }
  private async assertOwner(config:PublicDemoConfig,account:Hex):Promise<void>{
    let raw:unknown;try{raw=await this.provider.request({method:"eth_call",params:[{to:config.sourceOApp,data:oapp.encodeFunctionData("owner")},"latest"]})}catch{throw new WalletActionError("WRONG_OWNER")}
    try{const [owner]=oapp.decodeFunctionResult("owner",String(raw));if(!same(owner,account))throw new Error()}catch{throw new WalletActionError("WRONG_OWNER")}
  }
  private assertQuote(config:PublicDemoConfig,session:WalletSession,quote:PreparedQuote):void{
    let expectedData:Hex;try{expectedData=actionTarget.encodeFunctionData("record",[id(quote.recordLabel)]) as Hex}catch{throw new WalletActionError("CONFIG_INVALID")}
    if(!same(quote.account,session.account)||quote.chainId!==config.chainId||!same(quote.action.authorizationId,config.approvedAuthorizationId)||!same(quote.action.target,config.authorizedTarget)||quote.action.value!==0n||!same(quote.argument,id(quote.recordLabel))||!same(quote.action.data,expectedData)||quote.nativeFee<=0n||quote.lzTokenFee!==0n)throw new WalletActionError("CONFIG_INVALID");
  }
}

export function subscribeInvalidation(provider:Eip1193Provider,invalidate:()=>void):()=>void {
  if(typeof provider.on!=="function")return()=>{};
  const account=()=>invalidate(),chain=()=>invalidate();
  provider.on("accountsChanged",account);provider.on("chainChanged",chain);
  return()=>{provider.removeListener?.("accountsChanged",account);provider.removeListener?.("chainChanged",chain)};
}

interface Receipt {transactionHash:Hex;status:string;blockNumber:bigint;logs:Array<{address:Hex;topics:Hex[];data:Hex}>}
function parseReceipt(value:unknown):Receipt {
  try{
    const record=object(value),logs=record.logs;
    if(!Array.isArray(logs)||record.status!=="0x1"&&record.status!=="0x0"||typeof record.blockNumber!=="string"||!/^0x[0-9a-fA-F]+$/.test(record.blockNumber))throw new Error();
    return{transactionHash:hash(record.transactionHash),status:record.status,blockNumber:BigInt(record.blockNumber),logs:logs.map(item=>{const log=object(item);if(!Array.isArray(log.topics))throw new Error();return{address:address(log.address),topics:log.topics.map(hash),data:hex(log.data)}})};
  }catch{throw new WalletActionError("SOURCE_RECEIPT_UNAVAILABLE")}
}
function providerCode(value:unknown):number|undefined{return value&&typeof value==="object"&&"code"in value&&typeof(value as{code?:unknown}).code==="number"?(value as{code:number}).code:undefined}
function delay(ms:number):Promise<void>{return ms===0?Promise.resolve():new Promise(resolve=>setTimeout(resolve,ms))}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value as Record<string,unknown>}
function exactKeys(value:Record<string,unknown>,expected:string[]):void{const actual=Object.keys(value).sort(),wanted=[...expected].sort();if(actual.length!==wanted.length||actual.some((item,index)=>item!==wanted[index]))throw new Error()}
function printable(value:unknown):string{if(typeof value!=="string"||value.length===0||value.length>80||!/[^\s]/.test(value)||/[^\x20-\x7e]/.test(value))throw new Error();return value}
function address(value:unknown):Hex{if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function hash(value:unknown):Hex{if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function hex(value:unknown):Hex{if(typeof value!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value))throw new Error();return value.toLowerCase() as Hex}
function uint(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error();return Number(value)}
function loopback(value:unknown):string{if(typeof value!=="string")throw new Error();const url=new URL(value),port=Number(url.port);if(url.protocol!=="http:"||url.username||url.password||!url.port||!Number.isInteger(port)||port<1||port>65535||url.pathname!=="/"||url.search||url.hash||(url.hostname!=="127.0.0.1"&&url.hostname!=="[::1]"))throw new Error();return url.href}
function safeAddress(value:unknown,code:WalletActionErrorCode):Hex{try{return address(value)}catch{throw new WalletActionError(code)}}
function safeHash(value:unknown,code:WalletActionErrorCode):Hex{try{return hash(value)}catch{throw new WalletActionError(code)}}
function same(left:unknown,right:unknown):boolean{return typeof left==="string"&&typeof right==="string"&&left.toLowerCase()===right.toLowerCase()}
