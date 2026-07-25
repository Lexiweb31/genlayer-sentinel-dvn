import {DatabaseSync} from "node:sqlite";
import type {Hex} from "../../../packages/core/src/types.js";
import type {LocalExecutionAttemptStore} from "./local-demo-proofs.js";
import type {DeliveryStatusRecord} from "./status-api.js";
import type {VerificationOutboxStore} from "./verification-outbox.js";

export class SqliteLocalExecutionAttempts implements LocalExecutionAttemptStore {
  private database:DatabaseSync;
  constructor(path:string){
    this.database=new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS local_execution_attempts(guid TEXT PRIMARY KEY,created_at INTEGER NOT NULL,failure_code TEXT);");
  }
  async reserve(guid:Hex):Promise<boolean>{
    const normalized=hash(guid);
    this.database.exec("BEGIN IMMEDIATE");
    try{
      const result=this.database.prepare("INSERT OR IGNORE INTO local_execution_attempts(guid,created_at,failure_code) VALUES(?,?,NULL)").run(normalized,Math.floor(Date.now()/1000));
      this.database.exec("COMMIT");
      return Number(result.changes)===1;
    }catch(error){this.database.exec("ROLLBACK");throw error}
  }
  async recordIncident(guid:Hex,code:string):Promise<void>{
    const normalized=hash(guid),failureCode=incidentCode(code);
    this.database.exec("BEGIN IMMEDIATE");
    try{
      const row=this.database.prepare("SELECT failure_code FROM local_execution_attempts WHERE guid=?").get(normalized) as{failure_code:string|null}|undefined;
      if(!row)throw new Error("unknown local execution reservation");
      if(row.failure_code&&row.failure_code!==failureCode)throw new Error("local execution incident conflict");
      if(!row.failure_code)this.database.prepare("UPDATE local_execution_attempts SET failure_code=? WHERE guid=?").run(failureCode,normalized);
      this.database.exec("COMMIT");
    }catch(error){this.database.exec("ROLLBACK");throw error}
  }
  async incident(guid:Hex):Promise<string|undefined>{
    const row=this.database.prepare("SELECT failure_code FROM local_execution_attempts WHERE guid=?").get(hash(guid)) as{failure_code:string|null}|undefined;
    return row?.failure_code??undefined;
  }
  async resolveIncident(guid:Hex):Promise<void>{
    const normalized=hash(guid);
    this.database.exec("BEGIN IMMEDIATE");
    try{
      const row=this.database.prepare("SELECT guid FROM local_execution_attempts WHERE guid=?").get(normalized);
      if(!row)throw new Error("unknown local execution reservation");
      this.database.prepare("UPDATE local_execution_attempts SET failure_code=NULL WHERE guid=?").run(normalized);
      this.database.exec("COMMIT");
    }catch(error){this.database.exec("ROLLBACK");throw error}
  }
  close():void{this.database.close()}
}

export class LocalExecutionDeliveryReader {
  constructor(
    private outbox:Pick<VerificationOutboxStore,"list">,
    private attempts:Pick<SqliteLocalExecutionAttempts,"incident">
  ){}
  async list():Promise<DeliveryStatusRecord[]>{
    return Promise.all((await this.outbox.list()).map(async record=>{
      const executionFailureCode=await this.attempts.incident(record.guid);
      return executionFailureCode?{...record,executionFailureCode}:{...record};
    }));
  }
}

function hash(value:string):Hex{
  if(!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error("invalid local execution reservation GUID");
  return value.toLowerCase() as Hex;
}
function incidentCode(value:string):string{
  if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(value))throw new Error("invalid local execution incident code");
  return value;
}
