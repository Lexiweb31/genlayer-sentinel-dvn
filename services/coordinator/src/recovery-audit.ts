import{DatabaseSync}from"node:sqlite";
import{AbiCoder,keccak256,toUtf8Bytes}from"ethers";
import type{Hex}from"../../../packages/core/src/types.js";
import type{RecoveryKind}from"./recovery-proposal.js";

export interface RecoveryAuditInput {
  actionId:Hex;
  kind:RecoveryKind;
  deploymentDigest:Hex;
  subject:Hex;
  preconditionDigest:Hex;
  candidateTransactionHash:Hex;
  operators:Hex[];
  preparedAt:number;
  executeAfter:number;
  expiresAt:number;
  resultCode:"INGESTION_REQUEUED"|"DESTINATION_CONFIRMED";
}
export interface RecoveryReceipt extends RecoveryAuditInput {
  approvalCount:3;
  appliedAt:number;
  previousReceiptHash:Hex;
  receiptHash:Hex;
}
export interface RecoveryReceiptReader {
  listRecoveryReceipts():Promise<RecoveryReceipt[]>;
  getRecoveryReceipt(actionId:Hex):Promise<RecoveryReceipt|undefined>;
}

interface AuditRow {
  sequence:number;action_id:string;kind:string;deployment_digest:string;subject:string;
  precondition_digest:string;candidate_transaction_hash:string;operators_json:string;
  approval_count:number;prepared_at:number;execute_after:number;expires_at:number;
  applied_at:number;result_code:string;previous_receipt_hash:string;receipt_hash:string;
}

const ZERO=`0x${"0".repeat(64)}` as Hex;

export function initializeRecoveryAudit(database:DatabaseSync):void{
  database.exec(`
    CREATE TABLE IF NOT EXISTS recovery_audit(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      deployment_digest TEXT NOT NULL,
      subject TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      candidate_transaction_hash TEXT NOT NULL,
      operators_json TEXT NOT NULL,
      approval_count INTEGER NOT NULL,
      prepared_at INTEGER NOT NULL,
      execute_after INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      result_code TEXT NOT NULL,
      previous_receipt_hash TEXT NOT NULL,
      receipt_hash TEXT NOT NULL
    );
  `);
}

export function appendRecoveryReceipt(database:DatabaseSync,input:RecoveryAuditInput,appliedAt:number):RecoveryReceipt{
  const normalized=normalizeInput(input);
  validateTime(appliedAt,"recovery applied timestamp");
  if(appliedAt<normalized.executeAfter||appliedAt>=normalized.expiresAt)throw new Error("recovery applied timestamp is outside the authorization window");
  const receipts=listRecoveryReceipts(database),existing=receipts.find(receipt=>receipt.actionId===normalized.actionId);
  if(existing){
    if(inputIdentity(existing)!==inputIdentity(normalized))throw new Error("recovery audit action conflict");
    return existing;
  }
  const previousReceiptHash=receipts.at(-1)?.receiptHash??ZERO;
  const receiptHash=hashReceipt(normalized,appliedAt,previousReceiptHash);
  const receipt:RecoveryReceipt={...normalized,approvalCount:3,appliedAt,previousReceiptHash,receiptHash};
  database.prepare(`
    INSERT INTO recovery_audit(
      action_id,kind,deployment_digest,subject,precondition_digest,candidate_transaction_hash,
      operators_json,approval_count,prepared_at,execute_after,expires_at,applied_at,result_code,
      previous_receipt_hash,receipt_hash
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    receipt.actionId,receipt.kind,receipt.deploymentDigest,receipt.subject,receipt.preconditionDigest,
    receipt.candidateTransactionHash,JSON.stringify(receipt.operators),receipt.approvalCount,
    receipt.preparedAt,receipt.executeAfter,receipt.expiresAt,receipt.appliedAt,receipt.resultCode,
    receipt.previousReceiptHash,receipt.receiptHash
  );
  return receipt;
}

export function listRecoveryReceipts(database:DatabaseSync):RecoveryReceipt[]{
  const rows=database.prepare("SELECT * FROM recovery_audit ORDER BY sequence").all() as unknown as AuditRow[];
  const receipts:RecoveryReceipt[]=[];let previous=ZERO;
  try{
    for(let index=0;index<rows.length;index++){
      const row=rows[index]!;
      if(row.sequence!==index+1||row.approval_count!==3)throw new Error();
      const parsedOperators=JSON.parse(row.operators_json) as unknown;
      const input=normalizeInput({
        actionId:row.action_id as Hex,kind:row.kind as RecoveryKind,deploymentDigest:row.deployment_digest as Hex,
        subject:row.subject as Hex,preconditionDigest:row.precondition_digest as Hex,
        candidateTransactionHash:row.candidate_transaction_hash as Hex,
        operators:parsedOperators as Hex[],preparedAt:row.prepared_at,executeAfter:row.execute_after,
        expiresAt:row.expires_at,resultCode:row.result_code as RecoveryAuditInput["resultCode"]
      });
      validateTime(row.applied_at,"recovery applied timestamp");
      const previousReceiptHash=bytes32(row.previous_receipt_hash,"previous receipt hash",true);
      const receiptHash=bytes32(row.receipt_hash,"receipt hash");
      if(previousReceiptHash!==previous||row.applied_at<input.executeAfter||row.applied_at>=input.expiresAt||receiptHash!==hashReceipt(input,row.applied_at,previous))throw new Error();
      const receipt:RecoveryReceipt={...input,approvalCount:3,appliedAt:row.applied_at,previousReceiptHash,receiptHash};
      receipts.push(receipt);previous=receiptHash;
    }
    return receipts;
  }catch{throw new Error("recovery audit invariant violation")}
}

export function getRecoveryReceipt(database:DatabaseSync,actionId:Hex):RecoveryReceipt|undefined{
  const normalized=bytes32(actionId,"recovery action ID");
  return listRecoveryReceipts(database).find(receipt=>receipt.actionId===normalized);
}

function normalizeInput(input:RecoveryAuditInput):RecoveryAuditInput{
  if(!input||typeof input!=="object")throw new Error("recovery audit input is invalid");
  const actionId=bytes32(input.actionId,"recovery action ID"),deploymentDigest=bytes32(input.deploymentDigest,"recovery deployment digest");
  const subject=bytes32(input.subject,"recovery subject"),preconditionDigest=bytes32(input.preconditionDigest,"recovery precondition digest");
  const candidateTransactionHash=bytes32(input.candidateTransactionHash,"recovery candidate transaction hash",true);
  if(input.kind!=="INGESTION_REQUEUE"&&input.kind!=="DESTINATION_CONFIRM")throw new Error("recovery audit kind is invalid");
  if(input.resultCode!=="INGESTION_REQUEUED"&&input.resultCode!=="DESTINATION_CONFIRMED")throw new Error("recovery audit result is invalid");
  if(input.kind==="INGESTION_REQUEUE"&&(input.resultCode!=="INGESTION_REQUEUED"||candidateTransactionHash!==ZERO))throw new Error("recovery audit ingestion binding is invalid");
  if(input.kind==="DESTINATION_CONFIRM"&&(input.resultCode!=="DESTINATION_CONFIRMED"||candidateTransactionHash===ZERO))throw new Error("recovery audit destination binding is invalid");
  if(!Array.isArray(input.operators)||input.operators.length!==3)throw new Error("recovery audit requires three operators");
  let prior="";const operators=input.operators.map(value=>{
    const operator=address(value);
    if(operator!==operator.toLowerCase()||operator<=prior)throw new Error("recovery audit operators must be lowercase, unique and sorted");
    prior=operator;return operator as Hex;
  });
  validateTime(input.preparedAt,"recovery prepared timestamp");validateTime(input.executeAfter,"recovery execution timestamp");validateTime(input.expiresAt,"recovery expiry timestamp");
  if(input.executeAfter<=input.preparedAt||input.expiresAt<=input.executeAfter)throw new Error("recovery audit timestamps are invalid");
  return {actionId,kind:input.kind,deploymentDigest,subject,preconditionDigest,candidateTransactionHash,operators,preparedAt:input.preparedAt,executeAfter:input.executeAfter,expiresAt:input.expiresAt,resultCode:input.resultCode};
}

function hashReceipt(input:RecoveryAuditInput,appliedAt:number,previous:Hex):Hex{
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","address[]","uint64","uint64","uint64","uint64","bytes32","bytes32"],
    [input.actionId,textHash(input.kind),input.deploymentDigest,input.subject,input.preconditionDigest,input.candidateTransactionHash,input.operators,input.preparedAt,input.executeAfter,input.expiresAt,appliedAt,textHash(input.resultCode),previous]
  )).toLowerCase() as Hex;
}
function inputIdentity(input:RecoveryAuditInput):string{
  return JSON.stringify([input.actionId,input.kind,input.deploymentDigest,input.subject,input.preconditionDigest,input.candidateTransactionHash,input.operators,input.preparedAt,input.executeAfter,input.expiresAt,input.resultCode]);
}
function textHash(value:string):Hex{return keccak256(toUtf8Bytes(value)).toLowerCase() as Hex}
function bytes32(value:string,name:string,zero=false):Hex{
  if(typeof value!=="string"||!/^0x[0-9a-f]{64}$/.test(value)||(!zero&&value===ZERO))throw new Error(`${name} is invalid`);
  return value as Hex;
}
function address(value:string):string{
  if(typeof value!=="string"||!/^0x[0-9a-f]{40}$/.test(value)||/^0x0{40}$/.test(value))throw new Error("recovery audit operator is invalid");
  return value;
}
function validateTime(value:number,name:string):void{
  if(!Number.isSafeInteger(value)||value<0)throw new Error(`${name} is invalid`);
}
