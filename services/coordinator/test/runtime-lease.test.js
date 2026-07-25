import test from"node:test";
import assert from"node:assert/strict";
import{mkdtempSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{SqliteRuntimeLease}from"../../../dist/services/coordinator/src/runtime-lease.js";

const h=value=>`0x${value.repeat(64)}`;

test("durably excludes live runtimes and recovery actions",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"sentinel-runtime-lease-")),path=join(directory,"state.db");
  const first=new SqliteRuntimeLease(path,30),second=new SqliteRuntimeLease(path,30);
  await first.claimRuntime("owner-a",100,false);
  await assert.rejects(second.assertReleased(),/runtime active/);
  await assert.rejects(second.claimRuntime("owner-b",101,false),/runtime active/);
  await first.heartbeatRuntime("owner-a",110);
  await assert.rejects(second.claimRuntime("owner-b",200,false),/runtime active/);
  await second.claimRuntime("owner-b",200,true);
  await assert.rejects(first.heartbeatRuntime("owner-a",201),/lease ownership/);
  await second.releaseRuntime("owner-b",202);
  await second.acquireRecovery(h("1"),203);
  await assert.rejects(first.acquireRecovery(h("2"),203),/recovery busy/);
  await assert.rejects(first.claimRuntime("owner-c",204,false),/recovery active/);
  await second.releaseRecovery(h("1"));
  await second.assertReleased();
  first.close();second.close();rmSync(directory,{recursive:true,force:true});
});

test("rejects malformed identities, clocks and unauthorized transitions",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"sentinel-runtime-lease-")),store=new SqliteRuntimeLease(join(directory,"state.db"),30);
  for(const args of[["",1,false],["bad owner",1,false],["owner",-1,false],["owner",1.5,false]])await assert.rejects(store.claimRuntime(...args));
  await store.claimRuntime("owner-a",100,false);
  await assert.rejects(store.heartbeatRuntime("owner-a",99),/timestamp/);
  await assert.rejects(store.heartbeatRuntime("owner-b",101),/lease ownership/);
  await assert.rejects(store.releaseRuntime("owner-b",101),/lease ownership/);
  await assert.rejects(store.releaseRuntime("owner-a",99),/timestamp/);
  await store.releaseRuntime("owner-a",101);
  for(const args of[["0x12",102],[h("0"),102],[h("1"),-1]])await assert.rejects(store.acquireRecovery(...args));
  await store.acquireRecovery(h("1"),102);
  await assert.rejects(store.releaseRecovery(h("2")),/recovery ownership/);
  await store.releaseRecovery(h("1"));
  store.close();rmSync(directory,{recursive:true,force:true});
});
