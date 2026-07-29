import test from "node:test";
import assert from "node:assert/strict";
import {SentinelRuntime} from "../../../dist/services/coordinator/src/runtime.js";
import {RuntimeObservation} from "../../../dist/services/coordinator/src/runtime-observation.js";

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}};
function setup(overrides={}){const calls=[],scheduled=[];let cancelled=0,now=100;const observation=new RuntimeObservation("LEASED",()=>now);const dependencies={restore:async()=>calls.push("restore"),ingest:async()=>calls.push("ingest"),pollFinality:async()=>calls.push("finality"),planDeliveries:async()=>calls.push("plan-deliveries"),deliver:async()=>calls.push("deliver"),listen:async()=>calls.push("listen"),claimLease:async()=>calls.push("claim-lease"),heartbeatLease:async()=>calls.push("heartbeat-lease"),releaseLease:async()=>calls.push("release-lease"),closeServer:async()=>calls.push("close-server"),closeStores:()=>calls.push("close-stores"),report:error=>calls.push(`error:${error.message}`),intervalMs:1000,schedule:task=>{scheduled.push(task);return()=>{cancelled++}},...overrides};return{runtime:new SentinelRuntime(dependencies,observation),observation,calls,scheduled,cancelled:()=>cancelled,setNow:value=>{now=value}}}

test("reports running only after the runtime lease is claimed",async()=>{
  const claim=deferred(),value=setup({claimLease:async()=>{value.calls.push("claim-lease");await claim.promise}});
  assert.deepEqual(
    [value.runtime.runtimeStatus().lifecycle,value.runtime.runtimeStatus().lease],
    ["STARTING","NOT_CLAIMED"]
  );
  const starting=value.runtime.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(value.calls,["restore","listen","claim-lease"]);
  assert.deepEqual(
    [value.runtime.runtimeStatus().lifecycle,value.runtime.runtimeStatus().lease],
    ["STARTING","NOT_CLAIMED"]
  );
  claim.resolve();
  await starting;
  assert.deepEqual(
    [value.runtime.runtimeStatus().lifecycle,value.runtime.runtimeStatus().lease],
    ["RUNNING","CLAIMED"]
  );
});

test("reports stopping while an active tick drains before shutdown",async()=>{
  const gate=deferred(),value=setup({ingest:async()=>gate.promise});
  await value.runtime.start();
  const tick=value.scheduled[0]();
  const stopping=value.runtime.stop();
  assert.equal(value.runtime.runtimeStatus().lifecycle,"STOPPING");
  assert.equal(value.runtime.runtimeStatus().recoveryPosture,"REQUIRES_OFFLINE_VERIFICATION");
  gate.resolve();
  await tick;
  await stopping;
});

test("publishes the exact successful phase while preserving the non-overlap guard",async()=>{
  let value,heartbeatCount=0;
  value=setup({
    heartbeatLease:async()=>{
      value.calls.push("heartbeat-lease");
      assert.equal(value.runtime.runtimeStatus().tick.phase,heartbeatCount++===0?"HEARTBEAT_BEFORE":"HEARTBEAT_AFTER");
    },
    ingest:async()=>{value.calls.push("ingest");assert.equal(value.runtime.runtimeStatus().tick.phase,"INGESTION")},
    pollFinality:async()=>{value.calls.push("finality");assert.equal(value.runtime.runtimeStatus().tick.phase,"POLICY_FINALITY")},
    planDeliveries:async()=>{value.calls.push("plan-deliveries");assert.equal(value.runtime.runtimeStatus().tick.phase,"DELIVERY_PLANNING")},
    deliver:async()=>{value.calls.push("deliver");assert.equal(value.runtime.runtimeStatus().tick.phase,"DESTINATION_DELIVERY")}
  });
  await value.runtime.start();
  await value.scheduled[0]();
  assert.deepEqual(value.runtime.runtimeStatus().tick,{
    active:false,
    phase:"IDLE",
    lastStartedAt:100,
    lastCompletedAt:100,
    lastOutcome:"SUCCEEDED"
  });
  assert.equal(value.runtime.runtimeStatus().lastLeaseHeartbeatAt,100);
});

for(const [dependency,call,failureCode,skipped] of[
  ["ingest","ingest","INGESTION_FAILED",["finality","plan-deliveries","deliver"]],
  ["pollFinality","finality","POLICY_FINALITY_FAILED",["plan-deliveries","deliver"]],
  ["planDeliveries","plan-deliveries","DELIVERY_PLANNING_FAILED",["deliver"]],
  ["deliver","deliver","DESTINATION_DELIVERY_FAILED",[]]
]){
  test(`maps a ${call} failure to ${failureCode} and retries from a claimed runtime`,async()=>{
    let fail=true,value;
    value=setup({
      [dependency]:async()=>{
        value.calls.push(call);
        if(fail)throw new Error("private dependency detail");
      }
    });
    await value.runtime.start();
    await value.scheduled[0]();
    const failed=value.runtime.runtimeStatus();
    assert.equal(failed.lifecycle,"RUNNING");
    assert.equal(failed.lease,"CLAIMED");
    assert.equal(failed.tick.lastOutcome,"DEGRADED");
    assert.equal(failed.tick.failureCode,failureCode);
    for(const later of skipped)assert.equal(value.calls.includes(later),false);
    fail=false;
    value.setNow(101);
    await value.scheduled[0]();
    const recovered=value.runtime.runtimeStatus();
    assert.equal(recovered.tick.lastOutcome,"SUCCEEDED");
    assert.equal(recovered.tick.failureCode,undefined);
  });
}

test("fails closed on a pre-work heartbeat without running business phases",async()=>{
  let heartbeatCount=0,value;
  value=setup({
    heartbeatLease:async()=>{
      value.calls.push("heartbeat-lease");
      heartbeatCount++;
      throw new Error("private lease detail");
    }
  });
  await value.runtime.start();
  await value.scheduled[0]();
  assert.equal(heartbeatCount,2);
  assert.equal(value.calls.includes("ingest"),false);
  assert.equal(value.runtime.runtimeStatus().lifecycle,"OWNERSHIP_LOST");
  assert.equal(value.runtime.runtimeStatus().lease,"LOST");
  assert.equal(value.runtime.runtimeStatus().tick.failureCode,"LEASE_HEARTBEAT_FAILED");
});

test("never resumes business work after ownership loss without a runtime restart",async()=>{
  let fail=true,value;
  value=setup({
    heartbeatLease:async()=>{
      value.calls.push("heartbeat-lease");
      if(fail)throw new Error("private lease detail");
    }
  });
  await value.runtime.start();
  await value.scheduled[0]();
  assert.equal(value.runtime.runtimeStatus().lifecycle,"OWNERSHIP_LOST");
  fail=false;
  const callsBeforeRetry=value.calls.length;
  await value.scheduled[0]();
  assert.equal(value.calls.length,callsBeforeRetry);
  assert.equal(value.calls.includes("ingest"),false);
  assert.equal(value.runtime.runtimeStatus().lifecycle,"OWNERSHIP_LOST");
});

test("contains a regressing observation clock without leaking a scheduled failure",async()=>{
  const value=setup();
  await value.runtime.start();
  assert.equal(value.runtime.runtimeStatus().observedAt,100);
  value.setNow(99);
  await value.scheduled[0]();
  assert.equal(value.calls.includes("ingest"),false);
  assert.equal(value.calls.includes("error:runtime observation timestamp regressed"),true);
  assert.deepEqual(value.runtime.status,{started:true,stopping:false,tickActive:false});
  value.setNow(101);
  await value.scheduled[0]();
  assert.equal(value.calls.includes("ingest"),true);
});

test("marks a final heartbeat failure as ownership loss",async()=>{
  let heartbeatCount=0,value;
  value=setup({
    heartbeatLease:async()=>{
      value.calls.push("heartbeat-lease");
      heartbeatCount++;
      if(heartbeatCount===2)throw new Error("private lease detail");
    }
  });
  await value.runtime.start();
  await value.scheduled[0]();
  const status=value.runtime.runtimeStatus();
  assert.equal(status.lifecycle,"OWNERSHIP_LOST");
  assert.equal(status.lease,"LOST");
  assert.equal(status.recoveryPosture,"REQUIRES_OFFLINE_VERIFICATION");
  assert.equal(status.tick.failureCode,"LEASE_HEARTBEAT_FAILED");
});

test("retains the business failure when the final heartbeat also fails",async()=>{
  let heartbeatCount=0,value;
  value=setup({
    ingest:async()=>{value.calls.push("ingest");throw new Error("private ingestion detail")},
    heartbeatLease:async()=>{
      value.calls.push("heartbeat-lease");
      heartbeatCount++;
      if(heartbeatCount===2)throw new Error("private lease detail");
    }
  });
  await value.runtime.start();
  await value.scheduled[0]();
  const status=value.runtime.runtimeStatus();
  assert.equal(status.lifecycle,"OWNERSHIP_LOST");
  assert.equal(status.tick.failureCode,"INGESTION_FAILED");
});

test("restores and listens before claiming the lease and heartbeats around each tick",async()=>{const value=setup();await value.runtime.start();assert.deepEqual(value.calls,["restore","listen","claim-lease"]);assert.equal(value.scheduled.length,1);await value.scheduled[0]();assert.deepEqual(value.calls,["restore","listen","claim-lease","heartbeat-lease","ingest","finality","plan-deliveries","deliver","heartbeat-lease"]);assert.deepEqual(value.runtime.status,{started:true,stopping:false,tickActive:false})});
test("prevents overlapping ticks and reports errors without stopping",async()=>{const gate=deferred(),errors=[],value=setup({ingest:async()=>gate.promise,report:error=>errors.push(error.message)});await value.runtime.start();const first=value.scheduled[0](),second=value.scheduled[0]();assert.equal(value.runtime.status.tickActive,true);gate.resolve();await Promise.all([first,second]);assert.equal(value.calls.filter(call=>call==="finality").length,1);const failing=setup({ingest:async()=>{throw new Error("RPC down")},report:error=>errors.push(error.message)});await failing.runtime.start();await failing.scheduled[0]();assert.deepEqual(errors,["RPC down"]);assert.equal(failing.runtime.status.started,true)});
test("retries a failed planning phase on the next tick without running delivery early",async()=>{let fail=true;const value=setup({planDeliveries:async()=>{value.calls.push("plan-deliveries");if(fail)throw new Error("signers unavailable")}});await value.runtime.start();await value.scheduled[0]();assert.deepEqual(value.calls,["restore","listen","claim-lease","heartbeat-lease","ingest","finality","plan-deliveries","error:signers unavailable","heartbeat-lease"]);fail=false;await value.scheduled[0]();assert.deepEqual(value.calls.slice(-5),["ingest","finality","plan-deliveries","deliver","heartbeat-lease"])});
test("idempotent stop cancels scheduling, drains work, closes HTTP, releases the lease, then stores",async()=>{const gate=deferred(),value=setup({ingest:async()=>gate.promise});await value.runtime.start();const tick=value.scheduled[0]();const stopping=value.runtime.stop();assert.deepEqual(value.calls,["restore","listen","claim-lease","heartbeat-lease"]);gate.resolve();await tick;await stopping;await value.runtime.stop();assert.deepEqual(value.calls,["restore","listen","claim-lease","heartbeat-lease","finality","plan-deliveries","deliver","heartbeat-lease","close-server","release-lease","close-stores"]);assert.equal(value.cancelled(),1);assert.deepEqual(value.runtime.status,{started:false,stopping:false,tickActive:false})});
test("startup failure after binding closes resources without releasing an unclaimed lease",async()=>{const value=setup({claimLease:async()=>{value.calls.push("claim-lease");throw new Error("runtime active")}});await assert.rejects(value.runtime.start(),/runtime active/);assert.deepEqual(value.calls,["restore","listen","claim-lease","close-server","close-stores"]);assert.deepEqual(value.runtime.status,{started:false,stopping:false,tickActive:false})});
