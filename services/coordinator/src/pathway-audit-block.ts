import{PathwayAuditError}from"./pathway-audit-model.js";
import type{ReadOnlyRpcClient}from"./read-only-json-rpc.js";

export interface PinnedBlockObservation{
  chainId:string;
  blockNumber:string;
  blockHash:string;
  parentHash:string;
  stateRoot:string;
  transactionsRoot:string;
  timestamp:string;
}

export interface AgreePinnedBlockInput{
  clients:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient];
  expectedChainId:number;
  observationLag:number;
}

interface CanonicalHeader{
  blockNumber:bigint;
  blockHash:string;
  parentHash:string;
  stateRoot:string;
  transactionsRoot:string;
  timestamp:bigint;
}

const quantityPattern=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
const decimalPattern=/^(?:0|[1-9][0-9]*)$/;

export async function agreePinnedBlock(input:AgreePinnedBlockInput):Promise<PinnedBlockObservation>{
  try{
    const clients=clientsFrom(input.clients);
    const expectedChainId=positiveSafeInteger(input.expectedChainId);
    const observationLag=lag(input.observationLag);
    const providerState=await Promise.all(clients.map(async client=>({
      chainId:rpcQuantity(await client.call("eth_chainId",[])),
      head:rpcQuantity(await client.call("eth_blockNumber",[]))
    })));
    if(providerState.some(value=>value.chainId!==BigInt(expectedChainId)))failure();
    const minimumHead=providerState[0]!.head<providerState[1]!.head?providerState[0]!.head:providerState[1]!.head;
    if(minimumHead<BigInt(observationLag))failure();
    const selectedNumber=minimumHead-BigInt(observationLag);
    const rawHeaders=await Promise.all(clients.map(client=>client.call("eth_getBlockByNumber",[toQuantity(selectedNumber),false])));
    const headers=rawHeaders.map(value=>header(value,selectedNumber));
    if(!sameHeader(headers[0]!,headers[1]!))failure();
    return publicObservation(expectedChainId,headers[0]!);
  }catch(error){
    if(error instanceof PathwayAuditError&&error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED")throw error;
    failure();
  }
}

export async function assertPinnedBlockStable(
  clients:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient],observation:PinnedBlockObservation
):Promise<void>{
  try{
    const checkedClients=clientsFrom(clients),expected=observationHeader(observation);
    const rawHeaders=await Promise.all(checkedClients.map(client=>
      client.call("eth_getBlockByNumber",[toQuantity(expected.blockNumber),false])));
    const headers=rawHeaders.map(value=>header(value,expected.blockNumber));
    if(!sameHeader(headers[0]!,headers[1]!)||!sameHeader(expected,headers[0]!))failure();
  }catch(error){
    if(error instanceof PathwayAuditError&&error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED")throw error;
    failure();
  }
}

export function eip1898(observation:PinnedBlockObservation):{blockHash:string;requireCanonical:true}{
  try{return{blockHash:observationHeader(observation).blockHash,requireCanonical:true}}
  catch(error){
    if(error instanceof PathwayAuditError&&error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED")throw error;
    return failure();
  }
}

function clientsFrom(value:unknown):readonly[ReadOnlyRpcClient,ReadOnlyRpcClient]{
  if(!Array.isArray(value)||value.length!==2||!value.every(client=>
    !!client&&typeof client==="object"&&typeof client.call==="function"&&typeof client.descriptor==="function"))return failure();
  return value as [ReadOnlyRpcClient,ReadOnlyRpcClient];
}

function positiveSafeInteger(value:unknown):number{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)return failure();
  return value;
}

function lag(value:unknown):number{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>256)return failure();
  return value;
}

function header(value:unknown,expectedBlockNumber:bigint):CanonicalHeader{
  const record=plainRecord(value);
  const blockNumber=rpcQuantity(field(record,"number"));
  if(blockNumber!==expectedBlockNumber)failure();
  return{
    blockNumber,
    blockHash:nonzeroHash(field(record,"hash")),
    parentHash:nonzeroHash(field(record,"parentHash")),
    stateRoot:nonzeroHash(field(record,"stateRoot")),
    transactionsRoot:nonzeroHash(field(record,"transactionsRoot")),
    timestamp:rpcQuantity(field(record,"timestamp"))
  };
}

function publicObservation(chainId:number,header:CanonicalHeader):PinnedBlockObservation{
  return{
    chainId:String(chainId),
    blockNumber:header.blockNumber.toString(),
    blockHash:header.blockHash,
    parentHash:header.parentHash,
    stateRoot:header.stateRoot,
    transactionsRoot:header.transactionsRoot,
    timestamp:header.timestamp.toString()
  };
}

function observationHeader(value:unknown):CanonicalHeader{
  const record=plainRecord(value),keys=Reflect.ownKeys(record);
  const expected=["chainId","blockNumber","blockHash","parentHash","stateRoot","transactionsRoot","timestamp"];
  if(keys.length!==expected.length||keys.some(key=>typeof key!=="string"||!expected.includes(key)))failure();
  decimal(field(record,"chainId"),false);
  return{
    blockNumber:decimal(field(record,"blockNumber"),true),
    blockHash:nonzeroHash(field(record,"blockHash")),
    parentHash:nonzeroHash(field(record,"parentHash")),
    stateRoot:nonzeroHash(field(record,"stateRoot")),
    transactionsRoot:nonzeroHash(field(record,"transactionsRoot")),
    timestamp:decimal(field(record,"timestamp"),true)
  };
}

function plainRecord(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return failure();
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return failure();
  return value as Record<string,unknown>;
}

function field(record:Record<string,unknown>,name:string):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(record,name);
  if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return failure();
  return descriptor.value;
}

function rpcQuantity(value:unknown):bigint{
  if(typeof value!=="string"||!quantityPattern.test(value))return failure();
  return BigInt(value);
}

function decimal(value:unknown,allowZero:boolean):bigint{
  if(typeof value!=="string"||!decimalPattern.test(value))return failure();
  const parsed=BigInt(value);
  if(!allowZero&&parsed===0n)failure();
  return parsed;
}

function nonzeroHash(value:unknown):string{
  if(typeof value!=="string"||!hashPattern.test(value)||/^0x0{64}$/i.test(value))return failure();
  return value.toLowerCase();
}

function toQuantity(value:bigint):string{return`0x${value.toString(16)}`}

function sameHeader(left:CanonicalHeader,right:CanonicalHeader):boolean{
  return left.blockNumber===right.blockNumber&&
    left.blockHash===right.blockHash&&
    left.parentHash===right.parentHash&&
    left.stateRoot===right.stateRoot&&
    left.transactionsRoot===right.transactionsRoot&&
    left.timestamp===right.timestamp;
}

function failure():never{throw new PathwayAuditError("PATHWAY_AUDIT_OBSERVATION_FAILED")}
