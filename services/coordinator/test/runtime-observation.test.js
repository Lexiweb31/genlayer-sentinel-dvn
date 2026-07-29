import test from "node:test";
import assert from "node:assert/strict";
import {
  RuntimeObservation,
  publicRuntimeStatus
} from "../../../dist/services/coordinator/src/runtime-observation.js";

function sequentialClock(first=100){
  let current=first;
  return{
    now:()=>current,
    set:value=>{current=value}
  };
}

test("starts leased and local observations without inventing ownership",()=>{
  const leased=new RuntimeObservation("LEASED",()=>100);
  assert.deepEqual(leased.runtimeStatus(),{
    version:1,
    observedAt:100,
    lifecycle:"STARTING",
    lease:"NOT_CLAIMED",
    recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION",
    tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
  });

  const fixture=new RuntimeObservation("LOCAL_FIXTURE",()=>100);
  assert.deepEqual(fixture.runtimeStatus(),{
    version:1,
    observedAt:100,
    lifecycle:"STARTING",
    lease:"NOT_APPLICABLE_LOCAL_FIXTURE",
    recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION",
    tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
  });
});

test("derives recovery posture only from an established leased relationship",()=>{
  const leased=new RuntimeObservation("LEASED",()=>100);
  leased.markRunning();
  assert.deepEqual(
    [leased.runtimeStatus().lifecycle,leased.runtimeStatus().lease,leased.runtimeStatus().recoveryPosture],
    ["RUNNING","CLAIMED","BLOCKED_BY_ACTIVE_RUNTIME"]
  );
  leased.markStopping();
  assert.deepEqual(
    [leased.runtimeStatus().lifecycle,leased.runtimeStatus().lease,leased.runtimeStatus().recoveryPosture],
    ["STOPPING","CLAIMED","REQUIRES_OFFLINE_VERIFICATION"]
  );
  leased.markOwnershipLost();
  assert.deepEqual(
    [leased.runtimeStatus().lifecycle,leased.runtimeStatus().lease,leased.runtimeStatus().recoveryPosture],
    ["OWNERSHIP_LOST","LOST","REQUIRES_OFFLINE_VERIFICATION"]
  );
  leased.markStarting();
  assert.deepEqual(
    [leased.runtimeStatus().lifecycle,leased.runtimeStatus().lease,leased.runtimeStatus().recoveryPosture],
    ["STARTING","NOT_CLAIMED","REQUIRES_OFFLINE_VERIFICATION"]
  );

  const fixture=new RuntimeObservation("LOCAL_FIXTURE",()=>100);
  fixture.markRunning();
  assert.deepEqual(
    [fixture.runtimeStatus().lifecycle,fixture.runtimeStatus().lease,fixture.runtimeStatus().recoveryPosture],
    ["RUNNING","NOT_APPLICABLE_LOCAL_FIXTURE","REQUIRES_OFFLINE_VERIFICATION"]
  );
  assert.throws(()=>fixture.markOwnershipLost(),/runtime observation transition is invalid/);
});

test("records one successful tick and returns defensive snapshots",()=>{
  const clock=sequentialClock(100);
  const value=new RuntimeObservation("LEASED",clock.now);
  value.markRunning();
  clock.set(101);
  value.beginTick("HEARTBEAT_BEFORE");
  value.recordHeartbeat();
  value.enterPhase("INGESTION");
  value.enterPhase("POLICY_FINALITY");
  value.enterPhase("DELIVERY_PLANNING");
  value.enterPhase("DESTINATION_DELIVERY");
  value.enterPhase("HEARTBEAT_AFTER");
  clock.set(102);
  value.recordHeartbeat();
  clock.set(103);
  value.finishTick();

  const status=value.runtimeStatus();
  assert.deepEqual(status,{
    version:1,
    observedAt:103,
    lifecycle:"RUNNING",
    lease:"CLAIMED",
    recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
    tick:{
      active:false,
      phase:"IDLE",
      lastStartedAt:101,
      lastCompletedAt:103,
      lastOutcome:"SUCCEEDED"
    },
    lastLeaseHeartbeatAt:102
  });
  status.tick.phase="INGESTION";
  assert.equal(value.runtimeStatus().tick.phase,"IDLE");
});

test("retains a closed failure code until a later successful tick",()=>{
  const clock=sequentialClock(100);
  const value=new RuntimeObservation("LEASED",clock.now);
  value.markRunning();
  value.beginTick("HEARTBEAT_BEFORE");
  value.enterPhase("DELIVERY_PLANNING");
  clock.set(101);
  value.finishTick("DELIVERY_PLANNING_FAILED");
  assert.deepEqual(value.runtimeStatus().tick,{
    active:false,
    phase:"IDLE",
    lastStartedAt:100,
    lastCompletedAt:101,
    lastOutcome:"DEGRADED",
    failureCode:"DELIVERY_PLANNING_FAILED"
  });

  clock.set(102);
  value.beginTick("HEARTBEAT_BEFORE");
  clock.set(103);
  value.finishTick();
  assert.deepEqual(value.runtimeStatus().tick,{
    active:false,
    phase:"IDLE",
    lastStartedAt:102,
    lastCompletedAt:103,
    lastOutcome:"SUCCEEDED"
  });
});

test("marks lease loss without overwriting an earlier work failure",()=>{
  const value=new RuntimeObservation("LEASED",()=>100);
  value.markRunning();
  value.beginTick("HEARTBEAT_BEFORE");
  value.enterPhase("INGESTION");
  value.enterPhase("HEARTBEAT_AFTER");
  value.finishTick("INGESTION_FAILED",true);
  const status=value.runtimeStatus();
  assert.equal(status.lifecycle,"OWNERSHIP_LOST");
  assert.equal(status.lease,"LOST");
  assert.equal(status.recoveryPosture,"REQUIRES_OFFLINE_VERIFICATION");
  assert.equal(status.tick.failureCode,"INGESTION_FAILED");
});

test("rejects overlapping ticks, idle phase entry, fixture heartbeats and bad clocks",()=>{
  const value=new RuntimeObservation("LEASED",()=>100);
  assert.throws(()=>value.enterPhase("INGESTION"),/runtime observation transition is invalid/);
  value.markRunning();
  value.beginTick("INGESTION");
  assert.throws(()=>value.beginTick("POLICY_FINALITY"),/runtime observation transition is invalid/);
  assert.throws(()=>value.enterPhase("IDLE"),/runtime observation phase is invalid/);

  const fixture=new RuntimeObservation("LOCAL_FIXTURE",()=>100);
  assert.throws(()=>fixture.recordHeartbeat(),/runtime observation transition is invalid/);
  assert.throws(()=>new RuntimeObservation("LEASED",()=>-1),/runtime observation timestamp is invalid/);
  assert.throws(()=>new RuntimeObservation("LEASED",()=>1.5),/runtime observation timestamp is invalid/);
  assert.throws(()=>new RuntimeObservation("LEASED",()=>Number.MAX_SAFE_INTEGER+1),/runtime observation timestamp is invalid/);

  const clock=sequentialClock(100);
  const regressing=new RuntimeObservation("LEASED",clock.now);
  regressing.runtimeStatus();
  clock.set(99);
  assert.throws(()=>regressing.runtimeStatus(),/runtime observation timestamp regressed/);
});

test("validates the exact public shape and returns a detached value",()=>{
  const input={
    version:1,
    observedAt:110,
    lifecycle:"RUNNING",
    lease:"CLAIMED",
    recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
    tick:{
      active:false,
      phase:"IDLE",
      lastStartedAt:100,
      lastCompletedAt:105,
      lastOutcome:"SUCCEEDED"
    },
    lastLeaseHeartbeatAt:106
  };
  const value=publicRuntimeStatus(input);
  assert.deepEqual(value,input);
  assert.notEqual(value,input);
  assert.notEqual(value.tick,input.tick);
});

test("fails closed on leaked, malformed and contradictory public observations",()=>{
  const valid={
    version:1,
    observedAt:110,
    lifecycle:"RUNNING",
    lease:"CLAIMED",
    recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
    tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
  };
  const invalid=[
    {...valid,owner:"sentinel-runtime:secret"},
    {...valid,error:"raw database error"},
    {...valid,databasePath:"/private/state.db"},
    {...valid,version:2},
    {...valid,observedAt:-1},
    {...valid,lifecycle:"STOPPED"},
    {...valid,lease:"LOST"},
    {...valid,recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION"},
    {...valid,tick:{active:false,phase:"INGESTION",lastOutcome:"NEVER"}},
    {...valid,tick:{active:true,phase:"IDLE",lastOutcome:"NEVER"}},
    {...valid,tick:{active:false,phase:"IDLE",lastStartedAt:100,lastOutcome:"NEVER"}},
    {...valid,tick:{active:false,phase:"IDLE",lastCompletedAt:100,lastOutcome:"SUCCEEDED"}},
    {...valid,tick:{active:false,phase:"IDLE",lastOutcome:"DEGRADED"}},
    {...valid,tick:{active:false,phase:"IDLE",lastOutcome:"SUCCEEDED",failureCode:"INGESTION_FAILED"}},
    {
      ...valid,
      lifecycle:"OWNERSHIP_LOST",
      lease:"NOT_APPLICABLE_LOCAL_FIXTURE",
      recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION"
    },
    {
      ...valid,
      tick:{active:false,phase:"IDLE",lastOutcome:"NEVER",stack:"secret"}
    }
  ];
  for(const value of invalid)assert.throws(()=>publicRuntimeStatus(value),/runtime status is invalid/);
});
