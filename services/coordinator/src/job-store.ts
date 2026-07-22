import {DatabaseSync} from "node:sqlite";
import type {PolicyRequest,Snapshot} from "../../../packages/core/src/types.js";

export interface StoredJob {guid:string;requestId?:string;request?:PolicyRequest;snapshot:Snapshot;updatedAt:number;}
export interface JobStore {save(record:StoredJob):Promise<void>;load():Promise<StoredJob[]>;close():void;}

export class SqliteJobStore implements JobStore {
  private db:DatabaseSync;
  constructor(path:string){this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(guid TEXT PRIMARY KEY,request_id TEXT,request_json TEXT,snapshot TEXT NOT NULL,updated_at INTEGER NOT NULL);");const row=this.db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get() as {value:string}|undefined;if(row&&!['1','2'].includes(row.value))throw new Error(`unsupported job-store schema ${row.value}`);const columns=this.db.prepare("PRAGMA table_info(jobs)").all()as Array<{name:string}>;if(!columns.some(column=>column.name==="request_json"))this.db.exec("ALTER TABLE jobs ADD COLUMN request_json TEXT");if(!row)this.db.prepare("INSERT INTO metadata(key,value) VALUES('schema_version','2')").run();else if(row.value==="1")this.db.prepare("UPDATE metadata SET value='2' WHERE key='schema_version'").run()}
  async save(record:StoredJob):Promise<void>{this.db.exec("BEGIN IMMEDIATE");try{this.db.prepare("INSERT INTO jobs(guid,request_id,request_json,snapshot,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(guid) DO UPDATE SET request_id=excluded.request_id,request_json=excluded.request_json,snapshot=excluded.snapshot,updated_at=excluded.updated_at").run(record.guid,record.requestId??null,record.request?encode(record.request):null,encode(record.snapshot),record.updatedAt);this.db.exec("COMMIT")}catch(error){this.db.exec("ROLLBACK");throw error}}
  async load():Promise<StoredJob[]>{const rows=this.db.prepare("SELECT guid,request_id,request_json,snapshot,updated_at FROM jobs ORDER BY updated_at,guid").all() as Array<{guid:string;request_id:string|null;request_json:string|null;snapshot:string;updated_at:number}>;return rows.map(r=>({guid:r.guid,requestId:r.request_id??undefined,request:r.request_json?decode<PolicyRequest>(r.request_json):undefined,snapshot:decode<Snapshot>(r.snapshot),updatedAt:r.updated_at}))}
  close():void{this.db.close()}
}
function encode(value:unknown):string{return JSON.stringify(value,(_,v)=>typeof v==="bigint"?{$sentinelBigInt:v.toString()}:v)}
function decode<T>(value:string):T{return JSON.parse(value,(_,v)=>v&&typeof v==="object"&&Object.keys(v).length===1&&typeof v.$sentinelBigInt==="string"?BigInt(v.$sentinelBigInt):v) as T}
