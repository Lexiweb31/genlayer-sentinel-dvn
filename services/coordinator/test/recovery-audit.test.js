import test from"node:test";
import assert from"node:assert/strict";
import{mkdtempSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{DatabaseSync}from"node:sqlite";
import{appendRecoveryReceipt,getRecoveryReceipt,initializeRecoveryAudit,listRecoveryReceipts}from"../../../dist/services/coordinator/src/recovery-audit.js";

const h=value=>`0x${value.repeat(64)}`,a=value=>`0x${value.repeat(40)}`;
const operators=[a("1"),a("2"),a("3")];
const input=(action,subject,resultCode="INGESTION_REQUEUED")=>({
  actionId:h(action),kind:resultCode==="INGESTION_REQUEUED"?"INGESTION_REQUEUE":"DESTINATION_CONFIRM",
  deploymentDigest:h("d"),subject:h(subject),preconditionDigest:h("e"),
  candidateTransactionHash:resultCode==="INGESTION_REQUEUED"?h("0"):h("c"),
  operators,preparedAt:100,executeAfter:1000,expiresAt:3700,resultCode
});

test("persists and verifies the complete recovery receipt hash chain",()=>{
  const directory=mkdtempSync(join(tmpdir(),"sentinel-recovery-audit-")),path=join(directory,"state.db");
  let database=new DatabaseSync(path);initializeRecoveryAudit(database);
  const first=appendRecoveryReceipt(database,input("1","a"),1100),second=appendRecoveryReceipt(database,input("2","b","DESTINATION_CONFIRMED"),1200);
  assert.equal(first.previousReceiptHash,h("0"));
  assert.equal(second.previousReceiptHash,first.receiptHash);
  assert.deepEqual(getRecoveryReceipt(database,h("1")),first);
  database.close();
  database=new DatabaseSync(path);initializeRecoveryAudit(database);
  assert.deepEqual(listRecoveryReceipts(database),[first,second]);
  database.prepare("UPDATE recovery_audit SET subject=? WHERE action_id=?").run(h("f"),h("1"));
  assert.throws(()=>listRecoveryReceipts(database),/recovery audit invariant violation/);
  assert.throws(()=>getRecoveryReceipt(database,h("2")),/recovery audit invariant violation/);
  database.close();rmSync(directory,{recursive:true,force:true});
});

test("returns an identical action idempotently and rejects conflicting or invalid audit input",()=>{
  const directory=mkdtempSync(join(tmpdir(),"sentinel-recovery-audit-")),database=new DatabaseSync(join(directory,"state.db"));initializeRecoveryAudit(database);
  const first=appendRecoveryReceipt(database,input("1","a"),1100);
  assert.deepEqual(appendRecoveryReceipt(database,input("1","a"),1200),first);
  assert.throws(()=>appendRecoveryReceipt(database,{...input("1","b"),subject:h("f")},1200),/recovery audit/);
  for(const invalid of[
    {...input("2","b"),operators:[a("1"),a("2")]},
    {...input("2","b"),appliedAt:1},
    {...input("2","b"),resultCode:"DESTINATION_CONFIRMED"},
    {...input("2","b"),executeAfter:99}
  ])assert.throws(()=>appendRecoveryReceipt(database,invalid,invalid.appliedAt??1200));
  assert.equal(listRecoveryReceipts(database).length,1);
  database.close();rmSync(directory,{recursive:true,force:true});
});
