import{AbiCoder,keccak256,toUtf8Bytes}from"ethers";
import{decodePacketV1}from"../../../packages/core/src/packet-v1.js";
import type{Hex,Packet,Verification}from"../../../packages/core/src/types.js";
import type{PacketVerifier}from"./coordinator.js";
import type{DestinationConfirmationVerifier}from"./destination-verifier.js";
import type{DestinationPathVerifier}from"./destination-path-verifier.js";
import type{PacketInbox}from"./ingestion.js";
import type{DetectedPacket}from"./listener.js";
import type{RecoveryAuditInput,RecoveryReceipt,RecoveryReceiptReader}from"./recovery-audit.js";
import{recoveryDeploymentDigest}from"./recovery-domain.js";
import{makeRecoveryProposal,validateRecoveryBundle,type RecoveryProposalV1,type ValidatedRecoveryBundle}from"./recovery-proposal.js";
import type{RecoveryStore,RecoverableDeadLetter}from"./recovery-store.js";
import type{RuntimeConfig}from"./runtime-config.js";
import type{RuntimeLease}from"./runtime-lease.js";
import{executionDigest,type SignatureShare,type SigningEnvelope}from"./signing.js";
import type{OutboxRecord,VerificationOutboxStore}from"./verification-outbox.js";

export type RecoveryErrorCode=
  "RECOVERY_INVALID_BUNDLE"|"RECOVERY_NOT_FOUND"|"RECOVERY_SOURCE_PROOF_FAILED"|
  "RECOVERY_DESTINATION_PATH_FAILED"|"RECOVERY_DESTINATION_PENDING"|"RECOVERY_DESTINATION_FAILED"|
  "RECOVERY_STATE_CHANGED"|"RECOVERY_RUNTIME_ACTIVE"|"RECOVERY_APPLY_FAILED";
export class RecoveryError extends Error{
  constructor(readonly code:RecoveryErrorCode){super(code);this.name="RecoveryError"}
}

export interface OperatorRecoveryDependencies {
  config:RuntimeConfig;
  recoveryStore:RecoveryStore&RecoveryReceiptReader;
  inbox:PacketInbox;
  outbox:VerificationOutboxStore&RecoveryReceiptReader;
  sourceVerifier:PacketVerifier;
  destinationPath:DestinationPathVerifier;
  destinationVerifier:DestinationConfirmationVerifier;
  lease:RuntimeLease;
  now:()=>number;
  nonce:()=>Hex;
}

interface SourceObservation {record:RecoverableDeadLetter;preconditionDigest:Hex}
interface DestinationObservation {record:OutboxRecord;confirmations:bigint;preconditionDigest:Hex}
const coder=AbiCoder.defaultAbiCoder(),ZERO=`0x${"0".repeat(64)}` as Hex;

export class OperatorRecoveryService {
  constructor(private dependencies:OperatorRecoveryDependencies){}

  async prepareIngestion(transactionHash:Hex):Promise<RecoveryProposalV1>{
    let subject:Hex;
    try{subject=normalizeHash(transactionHash)}catch{throw new RecoveryError("RECOVERY_NOT_FOUND")}
    let record:RecoverableDeadLetter|undefined;
    try{record=await this.dependencies.recoveryStore.findDead(this.dependencies.config.pathway.name,subject)}
    catch{throw new RecoveryError("RECOVERY_NOT_FOUND")}
    if(!record||record.errorCode!=="INGESTION_FAILED")throw new RecoveryError("RECOVERY_NOT_FOUND");
    let observation:SourceObservation;
    try{observation=await this.observeSource(record)}catch{throw new RecoveryError("RECOVERY_SOURCE_PROOF_FAILED")}
    try{return makeRecoveryProposal(this.dependencies.config,{
      kind:"INGESTION_REQUEUE",subject,expectedState:"DEAD",expectedFailureCode:record.errorCode,
      preconditionDigest:observation.preconditionDigest,candidateTransactionHash:ZERO,
      nonce:normalizeHash(this.dependencies.nonce()),preparedAt:this.dependencies.now()
    })}catch{throw new RecoveryError("RECOVERY_SOURCE_PROOF_FAILED")}
  }

  async prepareDestination(guid:Hex,candidateTransactionHash:Hex):Promise<RecoveryProposalV1>{
    let subject:Hex,candidate:Hex;
    try{subject=normalizeHash(guid);candidate=normalizeHash(candidateTransactionHash)}
    catch{throw new RecoveryError("RECOVERY_NOT_FOUND")}
    let record:OutboxRecord|undefined;
    try{record=await this.dependencies.outbox.get(subject)}catch{throw new RecoveryError("RECOVERY_NOT_FOUND")}
    if(!record)throw new RecoveryError("RECOVERY_NOT_FOUND");
    let observation:DestinationObservation;
    try{observation=await this.observeDestination(record,candidate)}
    catch(error){
      if(error instanceof RecoveryError)throw error;
      throw new RecoveryError("RECOVERY_STATE_CHANGED");
    }
    try{return makeRecoveryProposal(this.dependencies.config,{
      kind:"DESTINATION_CONFIRM",subject,expectedState:"RECOVERY_REQUIRED",
      expectedFailureCode:record.failureCode!,preconditionDigest:observation.preconditionDigest,
      candidateTransactionHash:candidate,nonce:normalizeHash(this.dependencies.nonce()),preparedAt:this.dependencies.now()
    })}catch{throw new RecoveryError("RECOVERY_STATE_CHANGED")}
  }

  async apply(bundle:unknown):Promise<RecoveryReceipt>{
    let validated:ValidatedRecoveryBundle;
    try{validated=validateRecoveryBundle(this.dependencies.config,bundle,this.dependencies.now())}
    catch{throw new RecoveryError("RECOVERY_INVALID_BUNDLE")}
    const reader=validated.proposal.kind==="INGESTION_REQUEUE"?this.dependencies.recoveryStore:this.dependencies.outbox;
    let existing:RecoveryReceipt|undefined;
    try{existing=await reader.getRecoveryReceipt(validated.actionId)}catch{throw new RecoveryError("RECOVERY_APPLY_FAILED")}
    if(existing)return existing;
    try{await this.dependencies.lease.acquireRecovery(validated.actionId,this.dependencies.now())}
    catch{throw new RecoveryError("RECOVERY_RUNTIME_ACTIVE")}
    try{
      return validated.proposal.kind==="INGESTION_REQUEUE"
        ?await this.applyIngestion(validated)
        :await this.applyDestination(validated);
    }catch(error){
      if(error instanceof RecoveryError)throw error;
      throw new RecoveryError("RECOVERY_APPLY_FAILED");
    }finally{
      try{await this.dependencies.lease.releaseRecovery(validated.actionId)}
      catch{throw new RecoveryError("RECOVERY_APPLY_FAILED")}
    }
  }

  private async applyIngestion(validated:ValidatedRecoveryBundle):Promise<RecoveryReceipt>{
    const proposal=validated.proposal;
    let record:RecoverableDeadLetter|undefined;
    try{record=await this.dependencies.recoveryStore.findDead(this.dependencies.config.pathway.name,proposal.subject)}
    catch{throw new RecoveryError("RECOVERY_STATE_CHANGED")}
    if(!record||record.errorCode!==proposal.expectedFailureCode)throw new RecoveryError("RECOVERY_STATE_CHANGED");
    let observation:SourceObservation;
    try{observation=await this.observeSource(record)}catch{throw new RecoveryError("RECOVERY_SOURCE_PROOF_FAILED")}
    if(observation.preconditionDigest!==proposal.preconditionDigest)throw new RecoveryError("RECOVERY_STATE_CHANGED");
    const audit=this.audit(validated,"INGESTION_REQUEUED");
    await this.dependencies.inbox.requeue(observation.record.packet);
    try{return await this.dependencies.recoveryStore.resolveWithAudit(this.dependencies.config.pathway.name,proposal.subject,audit,this.dependencies.now())}
    catch{throw new RecoveryError("RECOVERY_APPLY_FAILED")}
  }

  private async applyDestination(validated:ValidatedRecoveryBundle):Promise<RecoveryReceipt>{
    const proposal=validated.proposal;
    let record:OutboxRecord|undefined;
    try{record=await this.dependencies.outbox.get(proposal.subject)}catch{throw new RecoveryError("RECOVERY_STATE_CHANGED")}
    if(!record||record.state!==proposal.expectedState||record.failureCode!==proposal.expectedFailureCode)throw new RecoveryError("RECOVERY_STATE_CHANGED");
    const observation=await this.observeDestination(record,proposal.candidateTransactionHash);
    if(observation.preconditionDigest!==proposal.preconditionDigest)throw new RecoveryError("RECOVERY_STATE_CHANGED");
    const audit=this.audit(validated,"DESTINATION_CONFIRMED");
    try{return(await this.dependencies.outbox.recoverConfirmed(
      proposal.subject,observation.record.digest,proposal.expectedFailureCode,
      proposal.candidateTransactionHash,observation.confirmations,audit,this.dependencies.now()
    )).receipt}catch{throw new RecoveryError("RECOVERY_APPLY_FAILED")}
  }

  private async observeSource(record:RecoverableDeadLetter):Promise<SourceObservation>{
    const packet=packetFromDetected(this.dependencies.config,record.packet);
    const verifications=await this.dependencies.sourceVerifier.verify(packet);
    const configurationDigest=sharedSourceConfiguration(packet,verifications,this.dependencies.config.pathway.confirmations);
    return{record,preconditionDigest:sourcePrecondition(this.dependencies.config,record,packet,configurationDigest)};
  }

  private async observeDestination(record:OutboxRecord,candidate:Hex):Promise<DestinationObservation>{
    if(record.state!=="RECOVERY_REQUIRED"||!record.failureCode||!["SUBMISSION_AMBIGUOUS","USED_WITHOUT_RECEIPT"].includes(record.failureCode))throw new RecoveryError("RECOVERY_STATE_CHANGED");
    if(record.transactionHash&&record.transactionHash.toLowerCase()!==candidate)throw new RecoveryError("RECOVERY_STATE_CHANGED");
    try{await this.dependencies.destinationPath.verify()}catch{throw new RecoveryError("RECOVERY_DESTINATION_PATH_FAILED")}
    const temporary:OutboxRecord={...record,state:"SUBMITTED",transactionHash:candidate};
    delete temporary.failureCode;delete temporary.confirmations;
    let result:Awaited<ReturnType<DestinationConfirmationVerifier["confirm"]>>;
    try{result=await this.dependencies.destinationVerifier.confirm(temporary)}catch{throw new RecoveryError("RECOVERY_DESTINATION_FAILED")}
    if(result.status==="PENDING")throw new RecoveryError("RECOVERY_DESTINATION_PENDING");
    if(result.status==="FAILED")throw new RecoveryError("RECOVERY_DESTINATION_FAILED");
    return{record,confirmations:result.confirmations,preconditionDigest:destinationPrecondition(this.dependencies.config,record)};
  }

  private audit(validated:ValidatedRecoveryBundle,resultCode:RecoveryAuditInput["resultCode"]):RecoveryAuditInput{
    const proposal=validated.proposal;
    return{
      actionId:validated.actionId,kind:proposal.kind,deploymentDigest:proposal.deploymentDigest,
      subject:proposal.subject,preconditionDigest:proposal.preconditionDigest,
      candidateTransactionHash:proposal.candidateTransactionHash,
      operators:validated.approvals.map(value=>value.address),
      preparedAt:Number(proposal.preparedAt),executeAfter:Number(proposal.executeAfter),
      expiresAt:Number(proposal.expiresAt),resultCode
    };
  }
}

function packetFromDetected(config:RuntimeConfig,detected:DetectedPacket):Packet{
  const decoded=decodePacketV1(detected.encodedPayload);
  if(
    decoded.srcEid!==config.pathway.srcEid||decoded.dstEid!==config.pathway.dstEid||
    decoded.sender.toLowerCase()!==config.pathway.sourceOApp.toLowerCase()||
    decoded.receiver.toLowerCase()!==config.pathway.destinationOApp.toLowerCase()||
    detected.sendLibrary.toLowerCase()!==config.pathway.sendLibrary.toLowerCase()||
    stableAddresses(detected.requiredDvns)!==stableAddresses(config.pathway.requiredDvns)||
    stableAddresses(detected.optionalDvns)!==stableAddresses(config.pathway.optionalDvns)||
    detected.fees.length!==detected.requiredDvns.length+detected.optionalDvns.length
  )throw new Error("retained source packet does not match pathway");
  const sentinel=detected.optionalDvns.findIndex(value=>value.toLowerCase()===config.pathway.sentinelDvn.toLowerCase());
  if(sentinel<0||detected.requiredDvns.some(value=>value.toLowerCase()===config.pathway.sentinelDvn.toLowerCase())||(detected.fees[detected.requiredDvns.length+sentinel]??0n)<=0n)throw new Error("retained source packet has no Sentinel fee");
  return{
    guid:decoded.guid.toLowerCase() as Hex,srcEid:decoded.srcEid,dstEid:decoded.dstEid,nonce:decoded.nonce,
    sender:decoded.sender.toLowerCase() as Hex,receiver:decoded.receiver.toLowerCase() as Hex,
    message:decoded.message,payloadHash:decoded.payloadHash.toLowerCase() as Hex,
    encodedPayloadHash:keccak256(detected.encodedPayload).toLowerCase() as Hex,
    txHash:normalizeHash(detected.transactionHash),blockHash:normalizeHash(detected.blockHash),blockNumber:detected.blockNumber
  };
}

function sharedSourceConfiguration(packet:Packet,values:Verification[],minimum:bigint):Hex{
  if(values.length<2)throw new Error("source verification requires two providers");
  let configuration:Hex|undefined;const providers=new Set<string>();
  for(const value of values){
    const digest=normalizeHash(value.configurationDigest);
    if(configuration&&configuration!==digest)throw new Error("source configuration disagreement");
    if(value.blockHash.toLowerCase()!==packet.blockHash||value.payloadHash.toLowerCase()!==packet.payloadHash||value.confirmations<minimum||!value.provider||providers.has(value.provider))throw new Error("source receipt disagreement");
    configuration=digest;providers.add(value.provider);
  }
  return configuration!;
}

function sourcePrecondition(config:RuntimeConfig,record:RecoverableDeadLetter,packet:Packet,configurationDigest:Hex):Hex{
  const detected=record.packet,packetDigest=keccak256(coder.encode(
    ["bytes32","uint32","uint32","uint64","bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","uint256"],
    [packet.guid,packet.srcEid,packet.dstEid,packet.nonce,packet.sender,packet.receiver,keccak256(packet.message),packet.payloadHash,packet.encodedPayloadHash,packet.blockHash,packet.blockNumber]
  ));
  return keccak256(coder.encode(
    ["bytes32","bytes32","bytes32","uint256","bytes32","bytes32","address","bytes32","bytes32","bytes32","uint256","uint256","bytes32","uint64","uint64","bytes32","bytes32"],
    [
      recoveryDeploymentDigest(config),normalizeHash(record.transactionHash),normalizeHash(detected.blockHash),detected.blockNumber,
      keccak256(detected.encodedPayload),keccak256(detected.options),detected.sendLibrary,
      keccak256(coder.encode(["address[]"],[detected.requiredDvns])),
      keccak256(coder.encode(["address[]"],[detected.optionalDvns])),
      keccak256(coder.encode(["uint256[]"],[detected.fees])),
      record.attempts,record.blockNumber,textHash(record.errorCode),record.firstFailedAt,record.lastFailedAt,
      packetDigest,configurationDigest
    ]
  )).toLowerCase() as Hex;
}

function destinationPrecondition(config:RuntimeConfig,record:OutboxRecord):Hex{
  if(record.digest.toLowerCase()!==executionDigest(record.envelope).toLowerCase())throw new Error("outbox execution digest mismatch");
  const envelopeHash=hashEnvelope(record.envelope),shareHash=hashShares(record.shares);
  return keccak256(coder.encode(
    ["bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","uint64","uint64"],
    [recoveryDeploymentDigest(config),normalizeHash(record.guid),normalizeHash(record.digest),envelopeHash,shareHash,textHash(record.state),textHash(record.failureCode??""),record.transactionHash?normalizeHash(record.transactionHash):ZERO,record.createdAt,record.updatedAt]
  )).toLowerCase() as Hex;
}
function hashEnvelope(envelope:SigningEnvelope):Hex{
  return keccak256(coder.encode(
    ["uint256","address","address","bytes32","bytes32","bytes32","bytes32","uint64"],
    [envelope.chainId,envelope.adapter,envelope.verificationTarget,envelope.guid,envelope.packetDigest,envelope.evidenceDigest,keccak256(envelope.callData),envelope.expiry]
  )).toLowerCase() as Hex;
}
function hashShares(shares:SignatureShare[]):Hex{
  let prior="";const values=shares.map(share=>{const address=share.address.toLowerCase();if(address<=prior)throw new Error("outbox shares are not sorted");prior=address;return[address,normalizeHash(share.digest),keccak256(share.signature)]});
  return keccak256(coder.encode(["tuple(address,bytes32,bytes32)[]"],[values])).toLowerCase() as Hex;
}
function normalizeHash(value:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error("invalid recovery hash");
  return value.toLowerCase() as Hex;
}
function textHash(value:string):Hex{return keccak256(toUtf8Bytes(value)).toLowerCase() as Hex}
function stableAddresses(values:Hex[]):string{return JSON.stringify(values.map(value=>value.toLowerCase()))}
