import{DatabaseSync}from"node:sqlite";
import type{Hex}from"../../../packages/core/src/types.js";

export interface RuntimeLease {
  claimRuntime(owner:string,now:number,allowStale:boolean):Promise<void>;
  heartbeatRuntime(owner:string,now:number):Promise<void>;
  releaseRuntime(owner:string,now:number):Promise<void>;
  assertReleased():Promise<void>;
  acquireRecovery(actionId:Hex,now:number):Promise<void>;
  releaseRecovery(actionId:Hex):Promise<void>;
  close():void;
}

interface RuntimeRow {state:"ACTIVE"|"RELEASED";owner:string|null;heartbeat_at:number}
interface RecoveryRow {state:"ACTIVE"|"RELEASED";action_id:string|null;acquired_at:number}

export class SqliteRuntimeLease implements RuntimeLease {
  private db:DatabaseSync;
  private closed=false;
  constructor(path:string,private readonly staleAfterSeconds:number){
    if(!Number.isSafeInteger(staleAfterSeconds)||staleAfterSeconds<=0)throw new Error("runtime lease stale interval must be positive");
    this.db=new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sentinel_runtime_lease(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        state TEXT NOT NULL CHECK(state IN ('ACTIVE','RELEASED')),
        owner TEXT,
        heartbeat_at INTEGER NOT NULL,
        CHECK((state='ACTIVE' AND owner IS NOT NULL) OR (state='RELEASED' AND owner IS NULL))
      );
      CREATE TABLE IF NOT EXISTS sentinel_recovery_lease(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        state TEXT NOT NULL CHECK(state IN ('ACTIVE','RELEASED')),
        action_id TEXT,
        acquired_at INTEGER NOT NULL,
        CHECK((state='ACTIVE' AND action_id IS NOT NULL) OR (state='RELEASED' AND action_id IS NULL))
      );
      INSERT OR IGNORE INTO sentinel_runtime_lease(singleton,state,owner,heartbeat_at) VALUES(1,'RELEASED',NULL,0);
      INSERT OR IGNORE INTO sentinel_recovery_lease(singleton,state,action_id,acquired_at) VALUES(1,'RELEASED',NULL,0);
    `);
  }
  async claimRuntime(owner:string,now:number,allowStale:boolean):Promise<void>{
    validateOwner(owner);validateTime(now);if(typeof allowStale!=="boolean")throw new Error("runtime stale policy is invalid");
    this.transaction(()=>{
      const recovery=this.recoveryRow();
      if(recovery.state==="ACTIVE")throw new Error("recovery active");
      const row=this.runtimeRow();
      if(now<row.heartbeat_at)throw new Error("runtime lease timestamp regression");
      if(row.state==="ACTIVE"&&row.owner!==owner){
        if(!allowStale||now-row.heartbeat_at<=this.staleAfterSeconds)throw new Error("runtime active");
      }
      this.db.prepare("UPDATE sentinel_runtime_lease SET state='ACTIVE',owner=?,heartbeat_at=? WHERE singleton=1").run(owner,now);
    });
  }
  async heartbeatRuntime(owner:string,now:number):Promise<void>{
    validateOwner(owner);validateTime(now);
    this.transaction(()=>{
      const row=this.runtimeRow();
      if(row.state!=="ACTIVE"||row.owner!==owner)throw new Error("runtime lease ownership mismatch");
      if(now<row.heartbeat_at)throw new Error("runtime lease timestamp regression");
      this.db.prepare("UPDATE sentinel_runtime_lease SET heartbeat_at=? WHERE singleton=1").run(now);
    });
  }
  async releaseRuntime(owner:string,now:number):Promise<void>{
    validateOwner(owner);validateTime(now);
    this.transaction(()=>{
      const row=this.runtimeRow();
      if(row.state!=="ACTIVE"||row.owner!==owner)throw new Error("runtime lease ownership mismatch");
      if(now<row.heartbeat_at)throw new Error("runtime lease timestamp regression");
      this.db.prepare("UPDATE sentinel_runtime_lease SET state='RELEASED',owner=NULL,heartbeat_at=? WHERE singleton=1").run(now);
    });
  }
  async assertReleased():Promise<void>{
    if(this.runtimeRow().state!=="RELEASED")throw new Error("runtime active");
  }
  async acquireRecovery(actionId:Hex,now:number):Promise<void>{
    validateHash(actionId);validateTime(now);
    this.transaction(()=>{
      const runtime=this.runtimeRow();
      if(runtime.state!=="RELEASED")throw new Error("runtime active");
      const recovery=this.recoveryRow();
      if(recovery.state==="ACTIVE")throw new Error("recovery busy");
      if(now<runtime.heartbeat_at||now<recovery.acquired_at)throw new Error("recovery lease timestamp regression");
      this.db.prepare("UPDATE sentinel_recovery_lease SET state='ACTIVE',action_id=?,acquired_at=? WHERE singleton=1").run(actionId.toLowerCase(),now);
    });
  }
  async releaseRecovery(actionId:Hex):Promise<void>{
    validateHash(actionId);
    this.transaction(()=>{
      const row=this.recoveryRow();
      if(row.state!=="ACTIVE"||row.action_id!==actionId.toLowerCase())throw new Error("recovery ownership mismatch");
      this.db.prepare("UPDATE sentinel_recovery_lease SET state='RELEASED',action_id=NULL WHERE singleton=1").run();
    });
  }
  close():void{if(!this.closed){this.closed=true;this.db.close()}}
  private runtimeRow():RuntimeRow{
    const row=this.db.prepare("SELECT state,owner,heartbeat_at FROM sentinel_runtime_lease WHERE singleton=1").get() as RuntimeRow|undefined;
    if(!row)throw new Error("runtime lease invariant violation");
    return row;
  }
  private recoveryRow():RecoveryRow{
    const row=this.db.prepare("SELECT state,action_id,acquired_at FROM sentinel_recovery_lease WHERE singleton=1").get() as RecoveryRow|undefined;
    if(!row)throw new Error("recovery lease invariant violation");
    return row;
  }
  private transaction(work:()=>void):void{
    this.db.exec("BEGIN IMMEDIATE");
    try{work();this.db.exec("COMMIT")}catch(error){try{this.db.exec("ROLLBACK")}catch{}throw error}
  }
}

function validateOwner(value:string):void{
  if(typeof value!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw new Error("runtime lease owner is invalid");
}
function validateTime(value:number):void{
  if(!Number.isSafeInteger(value)||value<0)throw new Error("runtime lease timestamp is invalid");
}
function validateHash(value:string):void{
  if(typeof value!=="string"||!/^0x[0-9a-f]{64}$/.test(value)||/^0x0{64}$/.test(value))throw new Error("recovery action ID is invalid");
}
