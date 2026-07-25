import {
  keccak256,
  toUtf8Bytes,
  TypedDataEncoder,
  verifyTypedData,
  type TypedDataDomain,
  type TypedDataField
} from "ethers";
import type {Hex} from "../../../packages/core/src/types.js";
import {recoveryDeploymentDigest} from "./recovery-domain.js";
import type {RuntimeConfig} from "./runtime-config.js";

export type RecoveryKind="INGESTION_REQUEUE"|"DESTINATION_CONFIRM";
export interface RecoveryProposalV1 {
  version:1;
  kind:RecoveryKind;
  deploymentDigest:Hex;
  subject:Hex;
  expectedState:"DEAD"|"RECOVERY_REQUIRED";
  expectedFailureCode:string;
  preconditionDigest:Hex;
  candidateTransactionHash:Hex;
  nonce:Hex;
  preparedAt:string;
  executeAfter:string;
  expiresAt:string;
}
export interface RecoveryApproval {address:Hex;signature:Hex}
export interface RecoveryProposalInput {
  kind:RecoveryKind;
  subject:Hex;
  expectedState:"DEAD"|"RECOVERY_REQUIRED";
  expectedFailureCode:string;
  preconditionDigest:Hex;
  candidateTransactionHash:Hex;
  nonce:Hex;
  preparedAt:number;
}
export interface ValidatedRecoveryBundle {
  proposal:RecoveryProposalV1;
  approvals:RecoveryApproval[];
  actionId:Hex;
}

const ZERO_BYTES32=`0x${"0".repeat(64)}` as Hex;
const PROPOSAL_FIELDS:TypedDataField[]=[
  {name:"kind",type:"bytes32"},
  {name:"deploymentDigest",type:"bytes32"},
  {name:"subject",type:"bytes32"},
  {name:"expectedState",type:"bytes32"},
  {name:"expectedFailureCode",type:"bytes32"},
  {name:"preconditionDigest",type:"bytes32"},
  {name:"candidateTransactionHash",type:"bytes32"},
  {name:"nonce",type:"bytes32"},
  {name:"preparedAt",type:"uint64"},
  {name:"executeAfter",type:"uint64"},
  {name:"expiresAt",type:"uint64"}
];
const PROPOSAL_KEYS=[
  "version","kind","deploymentDigest","subject","expectedState","expectedFailureCode",
  "preconditionDigest","candidateTransactionHash","nonce","preparedAt","executeAfter","expiresAt"
];

export function makeRecoveryProposal(config:RuntimeConfig,input:RecoveryProposalInput):RecoveryProposalV1{
  const preparedAt=safeTimestamp(input.preparedAt,"preparedAt");
  const proposal:RecoveryProposalV1={
    version:1,
    kind:input.kind,
    deploymentDigest:recoveryDeploymentDigest(config),
    subject:input.subject,
    expectedState:input.expectedState,
    expectedFailureCode:input.expectedFailureCode,
    preconditionDigest:input.preconditionDigest,
    candidateTransactionHash:input.candidateTransactionHash,
    nonce:input.nonce,
    preparedAt:String(preparedAt),
    executeAfter:String(preparedAt+config.recovery.minimumDelaySeconds),
    expiresAt:String(preparedAt+config.recovery.maximumLifetimeSeconds)
  };
  return parseProposal(config,proposal);
}

export function recoveryTypedData(
  config:RuntimeConfig,
  proposal:RecoveryProposalV1
):{domain:TypedDataDomain;types:Record<string,TypedDataField[]>;value:Record<string,unknown>}{
  return {
    domain:{
      name:"GenLayer Sentinel Recovery",
      version:"1",
      chainId:config.destination.chainId,
      verifyingContract:config.destination.adapter,
      salt:recoveryDeploymentDigest(config)
    },
    types:{RecoveryProposal:PROPOSAL_FIELDS},
    value:{
      kind:textDigest(proposal.kind),
      deploymentDigest:proposal.deploymentDigest,
      subject:proposal.subject,
      expectedState:textDigest(proposal.expectedState),
      expectedFailureCode:textDigest(proposal.expectedFailureCode),
      preconditionDigest:proposal.preconditionDigest,
      candidateTransactionHash:proposal.candidateTransactionHash,
      nonce:proposal.nonce,
      preparedAt:proposal.preparedAt,
      executeAfter:proposal.executeAfter,
      expiresAt:proposal.expiresAt
    }
  };
}

export function recoveryProposalDigest(config:RuntimeConfig,proposal:RecoveryProposalV1):Hex{
  const typed=recoveryTypedData(config,proposal);
  return TypedDataEncoder.hash(typed.domain,typed.types,typed.value).toLowerCase() as Hex;
}

export function validateRecoveryBundle(config:RuntimeConfig,value:unknown,now:number):ValidatedRecoveryBundle{
  const root=record(value,"recovery bundle");
  exactKeys(root,["proposal","approvals"],"recovery bundle");
  const proposal=parseProposal(config,root.proposal);
  const current=safeTimestamp(now,"recovery time");
  const executeAfter=Number(proposal.executeAfter),expiresAt=Number(proposal.expiresAt);
  if(current<executeAfter)throw new Error("recovery proposal is not ready");
  if(current>=expiresAt)throw new Error("recovery proposal is expired");
  if(!Array.isArray(root.approvals)||root.approvals.length!==config.recovery.quorum)throw new Error("recovery approval quorum is invalid");
  const typed=recoveryTypedData(config,proposal);
  const authorized=new Set(config.recovery.operators.map(operator=>operator.toLowerCase()));
  const approvals=root.approvals.map((value,index)=>parseApproval(value,index));
  for(let index=0;index<approvals.length;index++){
    const approval=approvals[index]!;
    if(index>0&&approval.address<=approvals[index-1]!.address)throw new Error("recovery approvals must be unique and sorted");
    if(!authorized.has(approval.address))throw new Error("recovery approval operator is unauthorized");
    let recovered:string;
    try{recovered=verifyTypedData(typed.domain,typed.types,typed.value,approval.signature).toLowerCase()}
    catch{throw new Error("recovery approval signature is invalid")}
    if(recovered!==approval.address)throw new Error("recovery approval signature is invalid");
  }
  return {proposal,approvals,actionId:recoveryProposalDigest(config,proposal)};
}

function parseProposal(config:RuntimeConfig,value:unknown):RecoveryProposalV1{
  const proposal=record(value,"recovery proposal");
  exactKeys(proposal,PROPOSAL_KEYS,"recovery proposal");
  if(proposal.version!==1)throw new Error("recovery proposal version is invalid");
  const kind=recoveryKind(proposal.kind);
  const expectedState=state(proposal.expectedState);
  const failureCode=failure(proposal.expectedFailureCode);
  if(kind==="INGESTION_REQUEUE"){
    if(expectedState!=="DEAD"||failureCode!=="INGESTION_FAILED")throw new Error("ingestion recovery state is invalid");
  }else if(expectedState!=="RECOVERY_REQUIRED"||!["SUBMISSION_AMBIGUOUS","USED_WITHOUT_RECEIPT"].includes(failureCode)){
    throw new Error("destination recovery state is invalid");
  }
  const deploymentDigest=bytes32(proposal.deploymentDigest,"deploymentDigest");
  if(deploymentDigest!==recoveryDeploymentDigest(config))throw new Error("recovery deployment digest is invalid");
  const subject=nonzeroBytes32(proposal.subject,"subject");
  const preconditionDigest=nonzeroBytes32(proposal.preconditionDigest,"preconditionDigest");
  const candidateTransactionHash=bytes32(proposal.candidateTransactionHash,"candidateTransactionHash");
  if(kind==="INGESTION_REQUEUE"&&candidateTransactionHash!==ZERO_BYTES32)throw new Error("ingestion recovery candidate must be zero");
  if(kind==="DESTINATION_CONFIRM"&&candidateTransactionHash===ZERO_BYTES32)throw new Error("destination recovery candidate is required");
  const nonce=nonzeroBytes32(proposal.nonce,"nonce");
  const preparedAt=decimal(proposal.preparedAt,"preparedAt");
  const executeAfter=decimal(proposal.executeAfter,"executeAfter");
  const expiresAt=decimal(proposal.expiresAt,"expiresAt");
  const delay=executeAfter-preparedAt,lifetime=expiresAt-preparedAt,applicationWindow=expiresAt-executeAfter;
  if(delay<config.recovery.minimumDelaySeconds)throw new Error("recovery delay is too short");
  if(lifetime>config.recovery.maximumLifetimeSeconds)throw new Error("recovery lifetime is too long");
  if(applicationWindow<300)throw new Error("recovery application window is too short");
  return {
    version:1,kind,deploymentDigest,subject,expectedState,expectedFailureCode:failureCode,
    preconditionDigest,candidateTransactionHash,nonce,
    preparedAt:String(preparedAt),executeAfter:String(executeAfter),expiresAt:String(expiresAt)
  };
}

function parseApproval(value:unknown,index:number):RecoveryApproval{
  const approval=record(value,`recovery approval ${index}`);
  exactKeys(approval,["address","signature"],`recovery approval ${index}`);
  const operator=address(approval.address,`recovery approval ${index} address`);
  if(operator!==operator.toLowerCase())throw new Error("recovery approval address must be lowercase");
  if(typeof approval.signature!=="string"||!/^0x[0-9a-f]{130}$/.test(approval.signature))throw new Error("recovery approval signature is invalid");
  return {address:operator.toLowerCase() as Hex,signature:approval.signature as Hex};
}

function record(value:unknown,name:string):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${name} must be an object`);
  return value as Record<string,unknown>;
}
function exactKeys(value:Record<string,unknown>,expected:string[],name:string):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))throw new Error(`${name} has missing or unknown keys`);
}
function recoveryKind(value:unknown):RecoveryKind{
  if(value!=="INGESTION_REQUEUE"&&value!=="DESTINATION_CONFIRM")throw new Error("recovery kind is invalid");
  return value;
}
function state(value:unknown):RecoveryProposalV1["expectedState"]{
  if(value!=="DEAD"&&value!=="RECOVERY_REQUIRED")throw new Error("recovery expected state is invalid");
  return value;
}
function failure(value:unknown):string{
  if(typeof value!=="string"||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value))throw new Error("recovery failure code is invalid");
  return value;
}
function bytes32(value:unknown,name:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-f]{64}$/.test(value))throw new Error(`${name} must be lowercase bytes32`);
  return value as Hex;
}
function nonzeroBytes32(value:unknown,name:string):Hex{
  const result=bytes32(value,name);
  if(result===ZERO_BYTES32)throw new Error(`${name} must be nonzero bytes32`);
  return result;
}
function address(value:unknown,name:string):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error(`${name} must be a nonzero address`);
  return value as Hex;
}
function decimal(value:unknown,name:string):number{
  if(typeof value!=="string"||!/^(0|[1-9][0-9]*)$/.test(value))throw new Error(`${name} must be a canonical decimal string`);
  const result=Number(value);
  if(!Number.isSafeInteger(result))throw new Error(`${name} exceeds safe timestamp range`);
  return result;
}
function safeTimestamp(value:number,name:string):number{
  if(!Number.isSafeInteger(value)||value<0)throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}
function textDigest(value:string):Hex{return keccak256(toUtf8Bytes(value)).toLowerCase() as Hex}
