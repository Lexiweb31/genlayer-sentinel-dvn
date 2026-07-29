import test from "node:test";
import assert from "node:assert/strict";
import {
  renderRuntimeStatus,
  renderRuntimeUnavailable,
  validateRuntimeStatus
} from "../src/runtime-status.js";

function elements(){
  return Object.fromEntries(
    ["badge","lifecycle","lease","phase","heartbeat","lastTick","recoveryPosture"]
      .map(key=>[key,{textContent:"",className:""}])
  );
}

const running={
  version:1,
  observedAt:100,
  lifecycle:"RUNNING",
  lease:"CLAIMED",
  recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
  tick:{
    active:false,
    phase:"IDLE",
    lastStartedAt:90,
    lastCompletedAt:95,
    lastOutcome:"SUCCEEDED"
  },
  lastLeaseHeartbeatAt:95
};

test("renders a claimed running process without implying recovery permission",()=>{
  const target=elements();
  renderRuntimeStatus(target,running,value=>`T:${value}`);
  assert.deepEqual(
    Object.fromEntries(Object.entries(target).map(([key,value])=>[key,value.textContent])),
    {
      badge:"RUNNING",
      lifecycle:"RUNNING",
      lease:"CLAIMED",
      phase:"IDLE",
      heartbeat:"T:95",
      lastTick:"SUCCEEDED · T:95",
      recoveryPosture:"BLOCKED BY ACTIVE RUNTIME"
    }
  );
  assert.equal(target.badge.className,"status live");
  assert.equal(JSON.stringify(target).includes("safe to recover"),false);
});

test("renders local fixture leasing as explicitly not applicable",()=>{
  const target=elements();
  renderRuntimeStatus(target,{
    version:1,
    observedAt:100,
    lifecycle:"RUNNING",
    lease:"NOT_APPLICABLE_LOCAL_FIXTURE",
    recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION",
    tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
  },value=>`T:${value}`);
  assert.equal(target.badge.textContent,"RUNNING");
  assert.equal(target.lease.textContent,"NOT APPLICABLE · LOCAL FIXTURE");
  assert.equal(target.heartbeat.textContent,"Not observed");
  assert.equal(target.lastTick.textContent,"Not observed");
  assert.equal(target.recoveryPosture.textContent,"REQUIRES OFFLINE VERIFICATION");
});

test("uses incident treatment for degraded, stopping and ownership-lost observations",()=>{
  for(const value of[
    {
      ...running,
      tick:{...running.tick,lastOutcome:"DEGRADED",failureCode:"INGESTION_FAILED"}
    },
    {
      ...running,
      lifecycle:"STOPPING",
      recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION"
    },
    {
      ...running,
      lifecycle:"OWNERSHIP_LOST",
      lease:"LOST",
      recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION"
    }
  ]){
    const target=elements();
    renderRuntimeStatus(target,value,timestamp=>`T:${timestamp}`);
    assert.equal(target.badge.className,"status bad");
  }
});

test("renders unavailable status without preserving stale values",()=>{
  const target=elements();
  for(const element of Object.values(target))element.textContent="stale";
  renderRuntimeUnavailable(target);
  assert.equal(target.badge.textContent,"UNAVAILABLE");
  assert.equal(target.badge.className,"status bad");
  for(const key of["lifecycle","lease","phase","heartbeat","lastTick","recoveryPosture"])
    assert.equal(target[key].textContent,"Not observed");
});

test("validates and detaches the exact browser runtime model",()=>{
  const value=validateRuntimeStatus(running);
  assert.deepEqual(value,running);
  assert.notEqual(value,running);
  assert.notEqual(value.tick,running.tick);
});

test("rejects malformed, leaked and recovery-authorizing browser models",()=>{
  const invalid=[
    {...running,owner:"sentinel-runtime:secret"},
    {...running,error:"raw database error"},
    {...running,observedAt:-1},
    {...running,lifecycle:"STOPPED"},
    {...running,lease:"LOST"},
    {...running,recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION"},
    {...running,tick:{active:true,phase:"IDLE",lastOutcome:"NEVER"}},
    {...running,tick:{active:false,phase:"INGESTION",lastOutcome:"NEVER"}},
    {...running,tick:{active:false,phase:"IDLE",lastOutcome:"DEGRADED"}},
    {...running,tick:{...running.tick,failureCode:"PRIVATE_PROVIDER_ERROR"}},
    {
      ...running,
      lifecycle:"RUNNING",
      lease:"NOT_APPLICABLE_LOCAL_FIXTURE",
      recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME"
    }
  ];
  for(const value of invalid)assert.throws(()=>validateRuntimeStatus(value),/invalid runtime status/);
});
