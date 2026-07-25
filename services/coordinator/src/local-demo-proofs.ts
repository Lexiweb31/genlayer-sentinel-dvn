import {AbiCoder,Interface,keccak256,toQuantity,zeroPadValue} from "ethers";
import {assertCanonicalPacket} from "../../../packages/core/src/packet-v1.js";
import type {Hex,PolicyRequest,Verification} from "../../../packages/core/src/types.js";
import type {Coordinator,PacketVerifier} from "./coordinator.js";
import type {VerifiedDestinationPath,DestinationPathVerifier} from "./destination-path-verifier.js";
import type {DestinationConfirmation,DestinationConfirmationVerifier} from "./destination-verifier.js";
import type {ExecutionConfirmer} from "./destination-worker.js";
import type {OutboxRecord} from "./verification-outbox.js";

export type LocalDemoRpc=(method:string,params:unknown[])=>Promise<unknown>;

const packetInterface=new Interface(["event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)"]);
const packetTopic=packetInterface.getEvent("PacketSent")!.topicHash.toLowerCase();
const adapterInterface=new Interface([
  "event Verified(bytes32 indexed guid,bytes32 indexed packetDigest,bytes32 evidenceDigest,bytes32 executionDigest)",
  "function verificationTarget() view returns(address)",
  "function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)",
  "function used(bytes32) view returns(bool)"
]);
const verifiedTopic=adapterInterface.getEvent("Verified")!.topicHash.toLowerCase();
const oappInterface=new Interface([
  "function peers(uint32) view returns(bytes32)",
  "function executedGuid(bytes32) view returns(bool)",
  "event ActionExecuted(bytes32 indexed authorizationId,bytes32 indexed guid,address target,uint256 value)"
]);
const endpointInterface=new Interface(["function deliver(address receiver,(uint32 srcEid,bytes32 sender,uint64 nonce) origin,bytes32 guid,bytes message)"]);
const actionInterface=new Interface(["function record(bytes32)","function recorded() view returns(bytes32)"]);
const actionCoder=AbiCoder.defaultAbiCoder();

interface RpcLog {address:Hex;topics:Hex[];data:Hex}
interface RpcReceipt {transactionHash:Hex;status:Hex;blockNumber:Hex;blockHash:Hex;logs:RpcLog[]}

export class LocalEdrPacketVerifier implements PacketVerifier {
  private endpoint:Hex;
  constructor(private rpc:LocalDemoRpc,endpoint:Hex,private minimumConfirmations:bigint){
    this.endpoint=address(endpoint,"invalid local packet endpoint");
    if(minimumConfirmations<=0n)throw new Error("local packet confirmations must be positive");
  }

  async verify(packet:PolicyRequest["packet"]):Promise<Verification[]>{
    const receipt=parseReceipt(await this.rpc("eth_getTransactionReceipt",[hash(packet.txHash,"invalid packet transaction hash")]));
    if(!receipt)throw new Error("local packet receipt unavailable");
    if(receipt.status!=="0x1")throw new Error("local packet receipt failed");
    if(!same(receipt.transactionHash,packet.txHash))throw new Error("local packet transaction binding mismatch");
    if(BigInt(receipt.blockNumber)!==packet.blockNumber||!same(receipt.blockHash,packet.blockHash))throw new Error("local packet block binding mismatch");
    const matching=receipt.logs.filter(log=>same(log.address,this.endpoint)&&log.topics[0]?.toLowerCase()===packetTopic);
    if(matching.length!==1)throw new Error("local PacketSent evidence missing or ambiguous");
    let encodedPayload:Hex,sendLibrary:string;
    try{
      const event=packetInterface.parseLog({topics:matching[0]!.topics,data:matching[0]!.data});
      if(!event)throw new Error();
      encodedPayload=bytes(event.args.encodedPayload,"invalid local PacketSent payload");
      sendLibrary=String(event.args.sendLibrary);
    }catch{throw new Error("invalid local PacketSent evidence")}
    if(!same(sendLibrary,this.endpoint))throw new Error("local PacketSent library mismatch");
    if(!same(keccak256(encodedPayload),packet.encodedPayloadHash))throw new Error("local PacketSent encoded payload mismatch");
    try{assertCanonicalPacket(encodedPayload,packet)}catch{throw new Error("local canonical packet mismatch")}
    const blockTag=receipt.blockNumber;
    const block=parseBlock(await this.rpc("eth_getBlockByNumber",[blockTag,false]));
    if(!block||BigInt(block.number)!==packet.blockNumber||!same(block.hash,packet.blockHash))throw new Error("local packet block binding mismatch");
    const latest=quantity(await this.rpc("eth_blockNumber",[]),"invalid local latest block");
    const confirmations=latest>=packet.blockNumber?latest-packet.blockNumber+1n:0n;
    if(confirmations<this.minimumConfirmations)throw new Error("insufficient local packet confirmations");
    const proof={blockHash:packet.blockHash,payloadHash:packet.payloadHash,confirmations};
    return[
      {provider:"LOCAL_EDR_FIXTURE_PACKET",...proof},
      {provider:"LOCAL_EDR_FIXTURE_RECEIPT",...proof}
    ];
  }
}

export interface LocalEdrPathConfig {
  chainId:31337n;
  srcEid:number;
  endpoint:Hex;
  receiveLibrary:Hex;
  oapp:Hex;
  adapter:Hex;
  sourcePeer:Hex;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  authorizedSigners:Hex[];
  quorum:3;
}

export class LocalEdrPathVerifier implements DestinationPathVerifier {
  private config:LocalEdrPathConfig;
  constructor(private rpc:LocalDemoRpc,config:LocalEdrPathConfig){this.config=normalizePathConfig(config)}

  async verify():Promise<VerifiedDestinationPath>{
    const config=this.config;
    const chainId=quantity(await this.rpc("eth_chainId",[]),"invalid local chain ID");
    if(chainId!==config.chainId)throw new Error("local EDR pathway configuration drift");
    const observedBlockNumber=quantity(await this.rpc("eth_blockNumber",[]),"invalid local block number");
    const blockTag=toQuantity(observedBlockNumber);
    const block=parseBlock(await this.rpc("eth_getBlockByNumber",[blockTag,false]));
    if(!block||BigInt(block.number)!==observedBlockNumber)throw new Error("local EDR pathway block unavailable");
    const observedBlockHash=block.hash;
    for(const target of[config.endpoint,config.oapp,config.adapter,config.receiveLibrary]){
      const code=await this.rpc("eth_getCode",[target,blockTag]);
      if(typeof code!=="string"||!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)||/^0x0+$/i.test(code))
        throw new Error("local EDR pathway configuration drift");
    }
    const verificationTarget=address(
      decodeCall(adapterInterface,"verificationTarget",await call(this.rpc,config.adapter,adapterInterface.encodeFunctionData("verificationTarget"),blockTag))[0],
      "invalid local adapter verification target"
    );
    const quorum=bigintValue(decodeCall(adapterInterface,"quorum",await call(this.rpc,config.adapter,adapterInterface.encodeFunctionData("quorum"),blockTag))[0],"invalid local adapter quorum");
    const peer=hash(
      decodeCall(oappInterface,"peers",await call(this.rpc,config.oapp,oappInterface.encodeFunctionData("peers",[config.srcEid]),blockTag))[0],
      "invalid local OApp peer"
    );
    const signerStates=await Promise.all(config.authorizedSigners.map(async signer=>
      Boolean(decodeCall(adapterInterface,"signer",await call(this.rpc,config.adapter,adapterInterface.encodeFunctionData("signer",[signer]),blockTag))[0])
    ));
    if(
      verificationTarget!==config.receiveLibrary||quorum!==3n||peer!==config.sourcePeer||
      signerStates.some(value=>!value)
    )throw new Error("local EDR pathway configuration drift");
    const coder=AbiCoder.defaultAbiCoder();
    const configurationDigest=keccak256(coder.encode(
      ["uint256","bytes32","uint256","uint32","address","address","address","address","bytes32","uint64","address[]","address[]","uint8","address[]","uint256"],
      [observedBlockNumber,observedBlockHash,chainId,config.srcEid,config.endpoint,config.receiveLibrary,config.oapp,config.adapter,config.sourcePeer,config.confirmations,config.requiredDvns,config.optionalDvns,config.optionalDvnThreshold,config.authorizedSigners,quorum]
    )) as Hex;
    return{
      observedBlockNumber,observedBlockHash,chainId,srcEid:config.srcEid,
      endpoint:config.endpoint,receiveLibrary:config.receiveLibrary,oapp:config.oapp,adapter:config.adapter,
      confirmations:config.confirmations,requiredDvns:[...config.requiredDvns],optionalDvns:[...config.optionalDvns],
      optionalDvnThreshold:config.optionalDvnThreshold,authorizedSigners:[...config.authorizedSigners],
      quorum:3,configurationDigest
    };
  }
}

export class LocalEdrDestinationVerifier implements DestinationConfirmationVerifier {
  private adapter:Hex;
  constructor(private rpc:LocalDemoRpc,adapter:Hex,private minimumConfirmations:bigint){
    this.adapter=address(adapter,"invalid local destination adapter");
    if(minimumConfirmations<=0n)throw new Error("local destination confirmations must be positive");
  }

  async confirm(record:OutboxRecord):Promise<DestinationConfirmation>{
    if(!record.transactionHash)return{status:"PENDING"};
    try{
      const receipt=parseReceipt(await this.rpc("eth_getTransactionReceipt",[record.transactionHash]));
      if(!receipt)return{status:"PENDING"};
      if(!same(receipt.transactionHash,record.transactionHash))return{status:"FAILED",code:"EVENT_MISMATCH"};
      if(receipt.status!=="0x1")return{status:"FAILED",code:"RECEIPT_FAILED"};
      const matching=receipt.logs.filter(log=>same(log.address,this.adapter)&&log.topics[0]?.toLowerCase()===verifiedTopic);
      if(matching.length!==1)return{status:"FAILED",code:"EVENT_MISMATCH"};
      let eventMatches=false;
      try{
        const event=adapterInterface.parseLog({topics:matching[0]!.topics,data:matching[0]!.data});
        eventMatches=!!event&&same(event.args.guid,record.guid)&&same(event.args.packetDigest,record.envelope.packetDigest)&&
          same(event.args.evidenceDigest,record.envelope.evidenceDigest)&&same(event.args.executionDigest,record.digest);
      }catch{}
      if(!eventMatches)return{status:"FAILED",code:"EVENT_MISMATCH"};
      const [used]=decodeCall(adapterInterface,"used",await call(this.rpc,this.adapter,adapterInterface.encodeFunctionData("used",[record.digest]),"latest"));
      if(!Boolean(used))return{status:"FAILED",code:"ADAPTER_UNUSED"};
      const block=parseBlock(await this.rpc("eth_getBlockByNumber",[receipt.blockNumber,false]));
      if(!block||!same(block.hash,receipt.blockHash))return{status:"FAILED",code:"EVENT_MISMATCH"};
      const latest=quantity(await this.rpc("eth_blockNumber",[]),"invalid local destination head"),mined=BigInt(receipt.blockNumber);
      const confirmations=latest>=mined?latest-mined+1n:0n;
      if(confirmations<this.minimumConfirmations)return{status:"PENDING"};
      return{status:"CONFIRMED",confirmations};
    }catch{return{status:"FAILED",code:"RPC_UNAVAILABLE"}}
  }
}

export interface LocalOAppExecutionConfig {
  from:Hex;
  endpoint:Hex;
  oapp:Hex;
  actionTarget:Hex;
}

export class LocalOAppExecutionConfirmer implements ExecutionConfirmer {
  private config:LocalOAppExecutionConfig;
  private attempted=new Set<string>();
  constructor(private coordinator:Coordinator,private rpc:LocalDemoRpc,config:LocalOAppExecutionConfig){
    exactKeys(config as unknown as Record<string,unknown>,["from","endpoint","oapp","actionTarget"],"unknown execution configuration field");
    this.config={
      from:address(config.from,"invalid local execution sender"),
      endpoint:address(config.endpoint,"invalid local execution endpoint"),
      oapp:address(config.oapp,"invalid local destination OApp"),
      actionTarget:address(config.actionTarget,"invalid local action target")
    };
  }

  async assertDeliveryReady(guid:string,signers:Hex[]):Promise<void>{
    await this.coordinator.assertDeliveryReady(guid,signers);
  }

  async confirmExecution(guid:string):Promise<void>{
    const normalizedGuid=hash(guid,"invalid local execution GUID"),request=this.coordinator.requests.get(normalizedGuid);
    if(!request)throw new Error("local OApp delivery binding mismatch");
    const action=this.boundAction(normalizedGuid,request);
    const peer=hash(
      decodeCall(oappInterface,"peers",await call(this.rpc,this.config.oapp,oappInterface.encodeFunctionData("peers",[request.packet.srcEid]),"latest"))[0],
      "invalid local OApp peer"
    );
    if(peer!==request.packet.sender.toLowerCase())throw new Error("local OApp delivery binding mismatch");
    let executed=await this.executed(normalizedGuid);
    if(!executed){
      if(this.attempted.has(normalizedGuid))throw new Error("local OApp delivery recovery required");
      this.attempted.add(normalizedGuid);
      const data=endpointInterface.encodeFunctionData("deliver",[
        this.config.oapp,
        {srcEid:request.packet.srcEid,sender:request.packet.sender,nonce:request.packet.nonce},
        normalizedGuid,
        request.packet.message
      ]);
      let transactionHash:Hex;
      try{transactionHash=hash(await this.rpc("eth_sendTransaction",[{from:this.config.from,to:this.config.endpoint,data}]),"invalid local delivery transaction hash")}
      catch{throw new Error("local OApp delivery recovery required")}
      let receipt:RpcReceipt|null;
      try{receipt=parseReceipt(await this.rpc("eth_getTransactionReceipt",[transactionHash]))}
      catch{throw new Error("local OApp delivery recovery required")}
      if(!receipt)throw new Error("local OApp delivery recovery required");
      if(receipt.status!=="0x1")throw new Error("local OApp delivery failed");
      if(!same(receipt.transactionHash,transactionHash))throw new Error("local OApp delivery binding mismatch");
      const actionEvents=receipt.logs.filter(log=>same(log.address,this.config.oapp)&&log.topics[0]?.toLowerCase()===oappInterface.getEvent("ActionExecuted")!.topicHash.toLowerCase());
      if(actionEvents.length!==1)throw new Error("local OApp delivery binding mismatch");
      try{
        const event=oappInterface.parseLog({topics:actionEvents[0]!.topics,data:actionEvents[0]!.data});
        if(!event||!same(event.args.authorizationId,action.authorizationId)||!same(event.args.guid,normalizedGuid)||
          !same(event.args.target,this.config.actionTarget)||BigInt(event.args.value)!==0n)throw new Error();
      }catch{throw new Error("local OApp delivery binding mismatch")}
      executed=await this.executed(normalizedGuid);
      if(!executed)throw new Error("local OApp delivery binding mismatch");
    }
    const expectedArgument=actionInterface.decodeFunctionData("record",action.data)[0];
    const [recorded]=decodeCall(actionInterface,"recorded",await call(this.rpc,this.config.actionTarget,actionInterface.encodeFunctionData("recorded"),"latest"));
    if(!same(recorded,expectedArgument))throw new Error("local OApp delivery binding mismatch");
    await this.coordinator.confirmExecution(normalizedGuid);
  }

  private boundAction(guid:Hex,request:PolicyRequest):{authorizationId:Hex;target:Hex;value:bigint;data:Hex}{
    try{
      if(request.packet.guid.toLowerCase()!==guid||request.packet.receiver.toLowerCase()!==zeroPadValue(this.config.oapp,32).toLowerCase())
        throw new Error();
      const [raw]=actionCoder.decode(["tuple(bytes32 authorizationId,address target,uint256 value,bytes data)"],request.packet.message);
      const action={authorizationId:hash(raw.authorizationId,""),target:address(raw.target,""),value:BigInt(raw.value),data:bytes(raw.data,"")};
      if(action.target!==this.config.actionTarget||action.value!==0n||action.data.length!==74||action.data.slice(0,10).toLowerCase()!==actionInterface.getFunction("record")!.selector.toLowerCase())
        throw new Error();
      const decoded=JSON.parse(request.decodedAction) as Record<string,unknown>;
      exactKeys(decoded,["authorizationId","target","value","selector","calldata"],"");
      if(
        lower(decoded.authorizationId)!==action.authorizationId||
        lower(decoded.target)!==action.target||
        decoded.value!=="0"||
        lower(decoded.selector)!==action.data.slice(0,10).toLowerCase()||
        lower(decoded.calldata)!==action.data.toLowerCase()
      )throw new Error();
      return action;
    }catch{throw new Error("local OApp delivery binding mismatch")}
  }

  private async executed(guid:Hex):Promise<boolean>{
    const [value]=decodeCall(oappInterface,"executedGuid",await call(this.rpc,this.config.oapp,oappInterface.encodeFunctionData("executedGuid",[guid]),"latest"));
    return Boolean(value);
  }
}

function normalizePathConfig(input:LocalEdrPathConfig):LocalEdrPathConfig{
  exactKeys(input as unknown as Record<string,unknown>,["chainId","srcEid","endpoint","receiveLibrary","oapp","adapter","sourcePeer","confirmations","requiredDvns","optionalDvns","optionalDvnThreshold","authorizedSigners","quorum"],"unknown configuration field");
  if(input.chainId!==31337n||!Number.isSafeInteger(input.srcEid)||input.srcEid<=0||input.confirmations<=0n||input.quorum!==3)
    throw new Error("invalid local EDR pathway configuration");
  const endpoint=address(input.endpoint,"invalid local endpoint"),receiveLibrary=address(input.receiveLibrary,"invalid local receive library");
  const oapp=address(input.oapp,"invalid local OApp"),adapter=address(input.adapter,"invalid local adapter"),sourcePeer=hash(input.sourcePeer,"invalid local source peer");
  const requiredDvns=sortedAddresses(input.requiredDvns,"required DVNs"),optionalDvns=sortedAddresses(input.optionalDvns,"optional DVNs");
  const authorizedSigners=sortedAddresses(input.authorizedSigners,"authorized signers");
  if(authorizedSigners.length!==5||optionalDvns.length===0||!optionalDvns.includes(adapter)||requiredDvns.includes(adapter)||
    !Number.isSafeInteger(input.optionalDvnThreshold)||input.optionalDvnThreshold!==1)
    throw new Error("invalid local EDR pathway configuration");
  return{chainId:31337n,srcEid:input.srcEid,endpoint,receiveLibrary,oapp,adapter,sourcePeer,confirmations:input.confirmations,requiredDvns,optionalDvns,optionalDvnThreshold:1,authorizedSigners,quorum:3};
}
function sortedAddresses(values:unknown,name:string):Hex[]{
  if(!Array.isArray(values))throw new Error(`invalid local ${name}`);
  const normalized=values.map(value=>address(value,`invalid local ${name}`));
  if(normalized.some((value,index)=>index>0&&value<=normalized[index-1]!))throw new Error(`local ${name} must be unique and sorted`);
  return normalized;
}
async function call(rpc:LocalDemoRpc,to:Hex,data:string,blockTag:string):Promise<Hex>{
  return bytes(await rpc("eth_call",[{to,data},blockTag]),"invalid local eth_call result");
}
function decodeCall(abi:Interface,functionName:string,value:Hex):readonly unknown[]{
  try{return abi.decodeFunctionResult(functionName,value)}catch{throw new Error("invalid local contract response")}
}
function parseReceipt(value:unknown):RpcReceipt|null{
  if(value===null)return null;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid local receipt");
  const record=value as Record<string,unknown>;
  if(!Array.isArray(record.logs)||record.status!=="0x1"&&record.status!=="0x0")throw new Error("invalid local receipt");
  return{
    transactionHash:hash(record.transactionHash,"invalid local receipt transaction hash"),
    status:record.status,
    blockNumber:quantityHex(record.blockNumber,"invalid local receipt block"),
    blockHash:hash(record.blockHash,"invalid local receipt block hash"),
    logs:record.logs.map(item=>{
      if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("invalid local receipt log");
      const log=item as Record<string,unknown>;
      if(!Array.isArray(log.topics))throw new Error("invalid local receipt log");
      return{address:address(log.address,"invalid local receipt log address"),topics:log.topics.map(value=>hash(value,"invalid local receipt topic")),data:bytes(log.data,"invalid local receipt data")};
    })
  };
}
function parseBlock(value:unknown):{number:Hex;hash:Hex}|null{
  if(value===null)return null;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid local block");
  const record=value as Record<string,unknown>;
  return{number:quantityHex(record.number,"invalid local block number"),hash:hash(record.hash,"invalid local block hash")};
}
function quantity(value:unknown,message:string):bigint{return BigInt(quantityHex(value,message))}
function bigintValue(value:unknown,message:string):bigint{
  if(typeof value!=="bigint"&&typeof value!=="number"&&typeof value!=="string")throw new Error(message);
  try{return BigInt(value)}catch{throw new Error(message)}
}
function quantityHex(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]+$/.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function hash(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function address(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function bytes(value:unknown,message:string):Hex{
  if(typeof value!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value))throw new Error(message);
  return value.toLowerCase() as Hex;
}
function same(left:unknown,right:unknown):boolean{return typeof left==="string"&&typeof right==="string"&&left.toLowerCase()===right.toLowerCase()}
function lower(value:unknown):string|undefined{return typeof value==="string"?value.toLowerCase():undefined}
function exactKeys(value:Record<string,unknown>,expected:string[],message:string):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((item,index)=>item!==wanted[index]))throw new Error(message);
}
