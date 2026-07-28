import type{Hex}from"../../../packages/core/src/types.js";
import{decodeGenLayerRecordForInput,type GenLayerPolicyInput}from"./genlayer-record.js";
import type{GenLayerStatusReader}from"./genlayer-status-reader.js";
import type{FinalityAttestor,SigningAuthorization,SigningEnvelope}from"./signing.js";

export interface GenLayerTransactionWitness{
  recipient:Hex;
  functionName:string;
  args:unknown[];
  executionResultName:string;
}

export interface GenLayerSignerWitnessReader{
  getTransactionWitness(transactionId:Hex):Promise<GenLayerTransactionWitness>;
  readPolicyRecord(contract:Hex,guid:Hex):Promise<unknown>;
}

export class GenLayerSignerFinalityAttestor implements FinalityAttestor{
  private policyContract:Hex;

  constructor(
    private status:GenLayerStatusReader,
    private witness:GenLayerSignerWitnessReader,
    policyContract:Hex,
  ){
    this.policyContract=address(policyContract,"policy contract");
  }

  async assertFinalized(
    envelope:SigningEnvelope,
    authorization:SigningAuthorization,
  ):Promise<void>{
    const input=policyInput(envelope,authorization);
    const transactionId=hash(authorization.witness.transactionId,"transaction ID");
    let status;
    try{status=await this.status.getTransactionStatus(transactionId)}
    catch{throw new Error("GenLayer signer status unavailable")}
    if(status.status!=="FINALIZED"||status.statusCode!==7)throw mismatch();

    let transaction:GenLayerTransactionWitness;
    try{transaction=await this.witness.getTransactionWitness(transactionId)}
    catch{throw new Error("GenLayer signer transaction unavailable")}
    if(!matchesTransaction(transaction,this.policyContract,input))throw mismatch();

    let raw:unknown;
    try{raw=await this.witness.readPolicyRecord(this.policyContract,input.guid)}
    catch{throw new Error("GenLayer signer record unavailable")}
    let record;
    try{record=decodeGenLayerRecordForInput(raw,input)}
    catch{throw mismatch()}
    const result=authorization.result;
    if(
      record.decision!==result.decision||
      record.policyVersion!==result.policyVersion||
      result.reasonCode!==`GENLAYER_FINALIZED_${result.decision}`
    )throw mismatch();
  }
}

function policyInput(
  envelope:SigningEnvelope,
  authorization:SigningAuthorization,
):GenLayerPolicyInput{
  const result=authorization.result;
  if(
    envelope.guid.toLowerCase()!==result.guid.toLowerCase()||
    envelope.packetDigest.toLowerCase()!==result.packetDigest.toLowerCase()||
    envelope.evidenceDigest.toLowerCase()!==result.evidenceDigest.toLowerCase()
  )throw mismatch();
  return{
    guid:hash(envelope.guid,"GUID"),
    packetDigest:hash(envelope.packetDigest,"packet digest"),
    evidenceUri:authorization.witness.evidenceUri,
    evidenceDigest:hash(envelope.evidenceDigest,"evidence digest"),
    decodedAction:authorization.witness.decodedAction,
    policy:authorization.witness.policy,
  };
}

function matchesTransaction(
  transaction:GenLayerTransactionWitness,
  policyContract:Hex,
  input:GenLayerPolicyInput,
):boolean{
  if(
    transaction.executionResultName!=="FINISHED_WITH_RETURN"||
    transaction.functionName!=="evaluate"||
    typeof transaction.recipient!=="string"||
    transaction.recipient.toLowerCase()!==policyContract||
    !Array.isArray(transaction.args)||
    transaction.args.length!==6
  )return false;
  const expected=[
    input.guid,
    input.packetDigest,
    input.evidenceUri,
    input.evidenceDigest,
    input.decodedAction,
    input.policy,
  ];
  return transaction.args.every((value,index)=>value===expected[index]);
}

function address(value:string,name:string):Hex{
  if(!/^0x[0-9a-f]{40}$/.test(value)||/^0x0{40}$/.test(value))throw new Error(`invalid ${name}`);
  return value as Hex;
}

function hash(value:string,name:string):Hex{
  if(!/^0x[0-9a-f]{64}$/.test(value))throw new Error(`invalid ${name}`);
  return value as Hex;
}

function mismatch():Error{return new Error("GenLayer signer finality mismatch")}
