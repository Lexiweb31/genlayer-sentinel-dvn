import {DatabaseSync} from "node:sqlite";
import type {BlockRef} from "./listener.js";

export interface ListenerCheckpoint {cursor?:BlockRef;seen:Array<{transactionHash:string;blockNumber:bigint}>;}
export interface ListenerStore {load(key:string):Promise<ListenerCheckpoint|undefined>;save(key:string,checkpoint:ListenerCheckpoint):Promise<void>;close():void;}

export class SqliteListenerStore implements ListenerStore {
  private db:DatabaseSync;
  constructor(path:string){this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS listener_checkpoints(pathway_key TEXT PRIMARY KEY,cursor_number TEXT,cursor_hash TEXT,seen_json TEXT NOT NULL,updated_at INTEGER NOT NULL);")}
  async load(key:string):Promise<ListenerCheckpoint|undefined>{const row=this.db.prepare("SELECT cursor_number,cursor_hash,seen_json FROM listener_checkpoints WHERE pathway_key=?").get(key) as {cursor_number:string|null;cursor_hash:string|null;seen_json:string}|undefined;if(!row)return undefined;const values=JSON.parse(row.seen_json) as Array<{transactionHash:string;blockNumber:string}>;if(!Array.isArray(values)||values.some(value=>!/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash)||!/^[0-9]+$/.test(value.blockNumber)))throw new Error("invalid listener checkpoint");const cursor=row.cursor_number!==null&&row.cursor_hash!==null?{number:BigInt(row.cursor_number),hash:row.cursor_hash as `0x${string}`}:undefined;if((row.cursor_number===null)!==(row.cursor_hash===null)||cursor&&!/^0x[0-9a-fA-F]{64}$/.test(cursor.hash))throw new Error("invalid listener cursor");return{cursor,seen:values.map(value=>({transactionHash:value.transactionHash.toLowerCase(),blockNumber:BigInt(value.blockNumber)}))}}
  async save(key:string,checkpoint:ListenerCheckpoint):Promise<void>{const seen=JSON.stringify(checkpoint.seen.map(value=>({transactionHash:value.transactionHash,blockNumber:value.blockNumber.toString()})));this.db.exec("BEGIN IMMEDIATE");try{this.db.prepare("INSERT INTO listener_checkpoints(pathway_key,cursor_number,cursor_hash,seen_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(pathway_key) DO UPDATE SET cursor_number=excluded.cursor_number,cursor_hash=excluded.cursor_hash,seen_json=excluded.seen_json,updated_at=excluded.updated_at").run(key,checkpoint.cursor?.number.toString()??null,checkpoint.cursor?.hash??null,seen,Math.floor(Date.now()/1000));this.db.exec("COMMIT")}catch(error){this.db.exec("ROLLBACK");throw error}}
  close():void{this.db.close()}
}
