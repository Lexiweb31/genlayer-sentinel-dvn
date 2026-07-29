const LIFECYCLES=new Set(["STARTING","RUNNING","STOPPING","OWNERSHIP_LOST"]);
const LEASES=new Set(["NOT_CLAIMED","CLAIMED","LOST","NOT_APPLICABLE_LOCAL_FIXTURE"]);
const RECOVERY_POSTURES=new Set(["BLOCKED_BY_ACTIVE_RUNTIME","REQUIRES_OFFLINE_VERIFICATION"]);
const PHASES=new Set(["IDLE","HEARTBEAT_BEFORE","INGESTION","POLICY_FINALITY","DELIVERY_PLANNING","DESTINATION_DELIVERY","HEARTBEAT_AFTER"]);
const OUTCOMES=new Set(["NEVER","SUCCEEDED","DEGRADED"]);
const FAILURE_CODES=new Set(["LEASE_HEARTBEAT_FAILED","INGESTION_FAILED","POLICY_FINALITY_FAILED","DELIVERY_PLANNING_FAILED","DESTINATION_DELIVERY_FAILED"]);

export function validateRuntimeStatus(value){
  try{
    const root=record(value);
    exactKeys(root,["version","observedAt","lifecycle","lease","recoveryPosture","tick"],["lastLeaseHeartbeatAt"]);
    if(root.version!==1)invalid();
    const observedAt=timestamp(root.observedAt);
    const lifecycle=oneOf(root.lifecycle,LIFECYCLES);
    const lease=oneOf(root.lease,LEASES);
    const recoveryPosture=oneOf(root.recoveryPosture,RECOVERY_POSTURES);
    const rawTick=record(root.tick);
    exactKeys(rawTick,["active","phase","lastOutcome"],["lastStartedAt","lastCompletedAt","failureCode"]);
    if(typeof rawTick.active!=="boolean")invalid();
    const phase=oneOf(rawTick.phase,PHASES);
    const lastOutcome=oneOf(rawTick.lastOutcome,OUTCOMES);
    const lastStartedAt=optionalTimestamp(rawTick.lastStartedAt);
    const lastCompletedAt=optionalTimestamp(rawTick.lastCompletedAt);
    const failureCode=optionalOneOf(rawTick.failureCode,FAILURE_CODES);
    const lastLeaseHeartbeatAt=optionalTimestamp(root.lastLeaseHeartbeatAt);

    if(rawTick.active===(phase==="IDLE"))invalid();
    if(rawTick.active&&lastStartedAt===undefined)invalid();
    if(lastCompletedAt!==undefined&&lastStartedAt===undefined)invalid();
    if(lastOutcome==="NEVER"&&(lastCompletedAt!==undefined||failureCode!==undefined||(!rawTick.active&&lastStartedAt!==undefined)))invalid();
    if(lastOutcome==="SUCCEEDED"&&(lastCompletedAt===undefined||failureCode!==undefined))invalid();
    if(lastOutcome==="DEGRADED"&&(lastCompletedAt===undefined||failureCode===undefined))invalid();
    if(!rawTick.active&&lastStartedAt!==undefined&&lastCompletedAt!==undefined&&lastCompletedAt<lastStartedAt)invalid();
    for(const time of[lastStartedAt,lastCompletedAt,lastLeaseHeartbeatAt])if(time!==undefined&&time>observedAt)invalid();

    const blocked=lifecycle==="RUNNING"&&lease==="CLAIMED";
    if((recoveryPosture==="BLOCKED_BY_ACTIVE_RUNTIME")!==blocked)invalid();
    if(lifecycle==="OWNERSHIP_LOST"){
      if(lease!=="LOST"||recoveryPosture!=="REQUIRES_OFFLINE_VERIFICATION")invalid();
    }else if(lease==="LOST")invalid();
    if(lease==="CLAIMED"&&lifecycle!=="RUNNING"&&lifecycle!=="STOPPING")invalid();
    if(lease==="NOT_CLAIMED"&&lifecycle!=="STARTING"&&lifecycle!=="STOPPING")invalid();
    if(lease==="NOT_APPLICABLE_LOCAL_FIXTURE"&&lifecycle==="OWNERSHIP_LOST")invalid();
    if(lastLeaseHeartbeatAt!==undefined&&(lease==="NOT_CLAIMED"||lease==="NOT_APPLICABLE_LOCAL_FIXTURE"))invalid();

    return{
      version:1,
      observedAt,
      lifecycle,
      lease,
      recoveryPosture,
      tick:{
        active:rawTick.active,
        phase,
        ...(lastStartedAt===undefined?{}:{lastStartedAt}),
        ...(lastCompletedAt===undefined?{}:{lastCompletedAt}),
        lastOutcome,
        ...(failureCode===undefined?{}:{failureCode})
      },
      ...(lastLeaseHeartbeatAt===undefined?{}:{lastLeaseHeartbeatAt})
    };
  }catch(error){
    if(error instanceof Error&&error.message==="invalid runtime status")throw error;
    throw new Error("invalid runtime status");
  }
}

export function renderRuntimeStatus(elements,value,formatTime){
  const status=validateRuntimeStatus(value);
  const incident=status.tick.lastOutcome==="DEGRADED"||status.lifecycle==="STOPPING"||status.lifecycle==="OWNERSHIP_LOST";
  elements.badge.textContent=status.tick.lastOutcome==="DEGRADED"?"DEGRADED":words(status.lifecycle);
  elements.badge.className=`status ${incident?"bad":"live"}`;
  elements.lifecycle.textContent=words(status.lifecycle);
  elements.lease.textContent=status.lease==="NOT_APPLICABLE_LOCAL_FIXTURE"?"NOT APPLICABLE · LOCAL FIXTURE":words(status.lease);
  elements.phase.textContent=words(status.tick.phase);
  elements.heartbeat.textContent=status.lastLeaseHeartbeatAt===undefined?"Not observed":formatTime(status.lastLeaseHeartbeatAt);
  elements.lastTick.textContent=status.tick.lastCompletedAt===undefined?"Not observed":`${status.tick.lastOutcome} · ${formatTime(status.tick.lastCompletedAt)}`;
  elements.recoveryPosture.textContent=words(status.recoveryPosture);
}

export function renderRuntimeUnavailable(elements){
  elements.badge.textContent="UNAVAILABLE";
  elements.badge.className="status bad";
  for(const element of[
    elements.lifecycle,
    elements.lease,
    elements.phase,
    elements.heartbeat,
    elements.lastTick,
    elements.recoveryPosture
  ])element.textContent="Not observed";
}

function record(value){
  if(!value||typeof value!=="object"||Array.isArray(value))invalid();
  return value;
}

function exactKeys(value,required,optional){
  const keys=Object.keys(value),allowed=new Set([...required,...optional]);
  if(required.some(key=>!Object.hasOwn(value,key))||keys.some(key=>!allowed.has(key)))invalid();
}

function timestamp(value){
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)invalid();
  return value;
}

function optionalTimestamp(value){
  return value===undefined?undefined:timestamp(value);
}

function oneOf(value,values){
  if(typeof value!=="string"||!values.has(value))invalid();
  return value;
}

function optionalOneOf(value,values){
  return value===undefined?undefined:oneOf(value,values);
}

function words(value){
  return value.replaceAll("_"," ");
}

function invalid(){
  throw new Error("invalid runtime status");
}
