import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  LocalExecutionDeliveryReader,
  SqliteLocalExecutionAttempts
} from "../../../dist/services/coordinator/src/local-demo-execution-store.js";

const guid=`0x${"7".repeat(64)}`;

test("persists an ambiguous local execution incident across database reopen",async t=>{
  const directory=await mkdtemp(join(tmpdir(),"sentinel-execution-store-test-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,"sentinel.db");
  const first=new SqliteLocalExecutionAttempts(path);
  assert.equal(await first.reserve(guid),true);
  await first.recordIncident(guid,"LOCAL_EXECUTION_RECOVERY_REQUIRED");
  first.close();

  const reopened=new SqliteLocalExecutionAttempts(path);
  assert.equal(await reopened.reserve(guid),false);
  assert.equal(await reopened.incident(guid),"LOCAL_EXECUTION_RECOVERY_REQUIRED");
  const reader=new LocalExecutionDeliveryReader(
    {list:async()=>[{guid,state:"CONFIRMED",failureCode:undefined}]},
    reopened
  );
  assert.deepEqual(await reader.list(),[{
    guid,state:"CONFIRMED",failureCode:undefined,
    executionFailureCode:"LOCAL_EXECUTION_RECOVERY_REQUIRED"
  }]);
  await reopened.resolveIncident(guid);
  assert.equal(await reopened.incident(guid),undefined);
  reopened.close();

  const resolved=new SqliteLocalExecutionAttempts(path);
  t.after(()=>resolved.close());
  assert.equal(await resolved.incident(guid),undefined);
  await resolved.resolveIncident(guid);
});
