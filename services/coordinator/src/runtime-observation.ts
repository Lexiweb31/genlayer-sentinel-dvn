export type RuntimeObservationMode="LEASED"|"LOCAL_FIXTURE";
export type RuntimeLifecycle="STARTING"|"RUNNING"|"STOPPING"|"OWNERSHIP_LOST";
export type RuntimeLeaseRelationship="NOT_CLAIMED"|"CLAIMED"|"LOST"|"NOT_APPLICABLE_LOCAL_FIXTURE";
export type RuntimeRecoveryPosture="BLOCKED_BY_ACTIVE_RUNTIME"|"REQUIRES_OFFLINE_VERIFICATION";
export type RuntimePhase=
  "IDLE"|
  "HEARTBEAT_BEFORE"|
  "INGESTION"|
  "POLICY_FINALITY"|
  "DELIVERY_PLANNING"|
  "DESTINATION_DELIVERY"|
  "HEARTBEAT_AFTER";
export type RuntimeOutcome="NEVER"|"SUCCEEDED"|"DEGRADED";
export type RuntimeFailureCode=
  "LEASE_HEARTBEAT_FAILED"|
  "INGESTION_FAILED"|
  "POLICY_FINALITY_FAILED"|
  "DELIVERY_PLANNING_FAILED"|
  "DESTINATION_DELIVERY_FAILED";

export interface LiveRuntimeTick {
  active:boolean;
  phase:RuntimePhase;
  lastStartedAt?:number;
  lastCompletedAt?:number;
  lastOutcome:RuntimeOutcome;
  failureCode?:RuntimeFailureCode;
}

export interface LiveRuntimeStatus {
  version:1;
  observedAt:number;
  lifecycle:RuntimeLifecycle;
  lease:RuntimeLeaseRelationship;
  recoveryPosture:RuntimeRecoveryPosture;
  tick:LiveRuntimeTick;
  lastLeaseHeartbeatAt?:number;
}

export interface RuntimeStatusReader {
  runtimeStatus():LiveRuntimeStatus;
}

const LIFECYCLES=new Set<RuntimeLifecycle>(["STARTING","RUNNING","STOPPING","OWNERSHIP_LOST"]);
const LEASES=new Set<RuntimeLeaseRelationship>(["NOT_CLAIMED","CLAIMED","LOST","NOT_APPLICABLE_LOCAL_FIXTURE"]);
const RECOVERY_POSTURES=new Set<RuntimeRecoveryPosture>(["BLOCKED_BY_ACTIVE_RUNTIME","REQUIRES_OFFLINE_VERIFICATION"]);
const PHASES=new Set<RuntimePhase>(["IDLE","HEARTBEAT_BEFORE","INGESTION","POLICY_FINALITY","DELIVERY_PLANNING","DESTINATION_DELIVERY","HEARTBEAT_AFTER"]);
const OUTCOMES=new Set<RuntimeOutcome>(["NEVER","SUCCEEDED","DEGRADED"]);
const FAILURE_CODES=new Set<RuntimeFailureCode>(["LEASE_HEARTBEAT_FAILED","INGESTION_FAILED","POLICY_FINALITY_FAILED","DELIVERY_PLANNING_FAILED","DESTINATION_DELIVERY_FAILED"]);
const ROOT_REQUIRED=["version","observedAt","lifecycle","lease","recoveryPosture","tick"];
const ROOT_OPTIONAL=["lastLeaseHeartbeatAt"];
const TICK_REQUIRED=["active","phase","lastOutcome"];
const TICK_OPTIONAL=["lastStartedAt","lastCompletedAt","failureCode"];

export class RuntimeObservation implements RuntimeStatusReader {
  private lifecycle:RuntimeLifecycle="STARTING";
  private lease:RuntimeLeaseRelationship;
  private recoveryPosture:RuntimeRecoveryPosture="REQUIRES_OFFLINE_VERIFICATION";
  private tick:LiveRuntimeTick={active:false,phase:"IDLE",lastOutcome:"NEVER"};
  private lastLeaseHeartbeatAt?:number;
  private lastClock:number;

  constructor(
    private readonly mode:RuntimeObservationMode,
    private readonly now:()=>number=()=>Math.floor(Date.now()/1000)
  ){
    if(mode!=="LEASED"&&mode!=="LOCAL_FIXTURE")throw new Error("runtime observation mode is invalid");
    this.lease=mode==="LEASED"?"NOT_CLAIMED":"NOT_APPLICABLE_LOCAL_FIXTURE";
    this.lastClock=this.readClock(false);
  }

  runtimeStatus():LiveRuntimeStatus {
    const observedAt=this.readClock();
    return publicRuntimeStatus({
      version:1,
      observedAt,
      lifecycle:this.lifecycle,
      lease:this.lease,
      recoveryPosture:this.recoveryPosture,
      tick:{...this.tick},
      ...(this.lastLeaseHeartbeatAt===undefined?{}:{lastLeaseHeartbeatAt:this.lastLeaseHeartbeatAt})
    });
  }

  hasLostOwnership():boolean {
    return this.lifecycle==="OWNERSHIP_LOST";
  }

  markStarting():void {
    this.lifecycle="STARTING";
    this.lease=this.mode==="LEASED"?"NOT_CLAIMED":"NOT_APPLICABLE_LOCAL_FIXTURE";
    this.recoveryPosture="REQUIRES_OFFLINE_VERIFICATION";
    this.lastLeaseHeartbeatAt=undefined;
  }

  markRunning():void {
    if(this.lifecycle!=="STARTING")throw new Error("runtime observation transition is invalid");
    this.lifecycle="RUNNING";
    if(this.mode==="LEASED"){
      this.lease="CLAIMED";
      this.recoveryPosture="BLOCKED_BY_ACTIVE_RUNTIME";
    }else{
      this.lease="NOT_APPLICABLE_LOCAL_FIXTURE";
      this.recoveryPosture="REQUIRES_OFFLINE_VERIFICATION";
    }
  }

  markStopping():void {
    if(this.lifecycle==="OWNERSHIP_LOST"){
      this.recoveryPosture="REQUIRES_OFFLINE_VERIFICATION";
      return;
    }
    this.lifecycle="STOPPING";
    this.recoveryPosture="REQUIRES_OFFLINE_VERIFICATION";
  }

  markOwnershipLost():void {
    if(this.mode!=="LEASED")throw new Error("runtime observation transition is invalid");
    this.lifecycle="OWNERSHIP_LOST";
    this.lease="LOST";
    this.recoveryPosture="REQUIRES_OFFLINE_VERIFICATION";
  }

  beginTick(initialPhase:Exclude<RuntimePhase,"IDLE">):void {
    this.nonIdlePhase(initialPhase);
    if(this.tick.active||(this.lifecycle!=="RUNNING"&&this.lifecycle!=="OWNERSHIP_LOST"))throw new Error("runtime observation transition is invalid");
    this.tick={...this.tick,active:true,phase:initialPhase,lastStartedAt:this.readClock()};
  }

  enterPhase(phase:Exclude<RuntimePhase,"IDLE">):void {
    this.nonIdlePhase(phase);
    if(!this.tick.active)throw new Error("runtime observation transition is invalid");
    this.tick={...this.tick,phase};
  }

  recordHeartbeat():void {
    if(this.mode!=="LEASED"||!this.tick.active||(this.tick.phase!=="HEARTBEAT_BEFORE"&&this.tick.phase!=="HEARTBEAT_AFTER"))throw new Error("runtime observation transition is invalid");
    this.lastLeaseHeartbeatAt=this.readClock();
  }

  finishTick(failureCode?:RuntimeFailureCode,leaseLost=false):void {
    if(!this.tick.active||typeof leaseLost!=="boolean")throw new Error("runtime observation transition is invalid");
    if(failureCode!==undefined&&!FAILURE_CODES.has(failureCode))throw new Error("runtime observation failure code is invalid");
    if(leaseLost&&this.mode!=="LEASED")throw new Error("runtime observation transition is invalid");
    const completedAt=this.readClock();
    const effectiveFailure=leaseLost&&failureCode===undefined?"LEASE_HEARTBEAT_FAILED":failureCode;
    this.tick={
      active:false,
      phase:"IDLE",
      lastStartedAt:this.tick.lastStartedAt,
      lastCompletedAt:completedAt,
      lastOutcome:effectiveFailure===undefined?"SUCCEEDED":"DEGRADED",
      ...(effectiveFailure===undefined?{}:{failureCode:effectiveFailure})
    };
    if(leaseLost)this.markOwnershipLost();
  }

  private nonIdlePhase(value:RuntimePhase):asserts value is Exclude<RuntimePhase,"IDLE"> {
    if(value==="IDLE"||!PHASES.has(value))throw new Error("runtime observation phase is invalid");
  }

  private readClock(enforceRegression=true):number {
    let value:unknown;
    try{value=this.now()}catch{throw new Error("runtime observation timestamp is invalid")}
    if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new Error("runtime observation timestamp is invalid");
    if(enforceRegression&&value<this.lastClock)throw new Error("runtime observation timestamp regressed");
    this.lastClock=value;
    return value;
  }
}

export function publicRuntimeStatus(value:unknown):LiveRuntimeStatus {
  try{
    const root=record(value);
    exactKeys(root,ROOT_REQUIRED,ROOT_OPTIONAL);
    if(root.version!==1)invalid();
    const observedAt=timestamp(root.observedAt);
    const lifecycle=oneOf(root.lifecycle,LIFECYCLES);
    const lease=oneOf(root.lease,LEASES);
    const recoveryPosture=oneOf(root.recoveryPosture,RECOVERY_POSTURES);
    const rawTick=record(root.tick);
    exactKeys(rawTick,TICK_REQUIRED,TICK_OPTIONAL);
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

    const tick:LiveRuntimeTick={
      active:rawTick.active,
      phase,
      ...(lastStartedAt===undefined?{}:{lastStartedAt}),
      ...(lastCompletedAt===undefined?{}:{lastCompletedAt}),
      lastOutcome,
      ...(failureCode===undefined?{}:{failureCode})
    };
    return{
      version:1,
      observedAt,
      lifecycle,
      lease,
      recoveryPosture,
      tick,
      ...(lastLeaseHeartbeatAt===undefined?{}:{lastLeaseHeartbeatAt})
    };
  }catch(error){
    if(error instanceof Error&&error.message==="runtime status is invalid")throw error;
    throw new Error("runtime status is invalid");
  }
}

function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))invalid();
  return value as Record<string,unknown>;
}

function exactKeys(value:Record<string,unknown>,required:string[],optional:string[]):void {
  const keys=Object.keys(value),allowed=new Set([...required,...optional]);
  if(required.some(key=>!Object.hasOwn(value,key))||keys.some(key=>!allowed.has(key)))invalid();
}

function timestamp(value:unknown):number {
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)invalid();
  return value;
}

function optionalTimestamp(value:unknown):number|undefined {
  return value===undefined?undefined:timestamp(value);
}

function oneOf<T extends string>(value:unknown,values:Set<T>):T {
  if(typeof value!=="string"||!values.has(value as T))invalid();
  return value as T;
}

function optionalOneOf<T extends string>(value:unknown,values:Set<T>):T|undefined {
  return value===undefined?undefined:oneOf(value,values);
}

function invalid():never {
  throw new Error("runtime status is invalid");
}
