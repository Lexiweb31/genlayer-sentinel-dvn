import {DatabaseSync} from "node:sqlite";
import {getBytes,verifyMessage} from "ethers";
import type {Hex} from "../../../packages/core/src/types.js";
import {executionDigest,type SignatureShare,type SigningEnvelope} from "./signing.js";

export type OutboxState="SIGNING"|"READY"|"ATTEMPTING"|"SUBMITTED"|"CONFIRMED"|"FAILED"|"RECOVERY_REQUIRED";
export interface OutboxRecord {guid:Hex;digest:Hex;envelope:SigningEnvelope;shares:SignatureShare[];state:OutboxState;transactionHash?:Hex;confirmations?:bigint;failureCode?:string;createdAt:number;updatedAt:number}
export interface OutboxUpdate {state:OutboxState;transactionHash?:Hex;confirmations?:bigint;failureCode?:string;updatedAt:number}
export interface VerificationOutboxStore {
  plan(guid:Hex,envelope:SigningEnvelope,now:number):Promise<OutboxRecord>;
  recordQuorum(guid:Hex,shares:SignatureShare[],now:number):Promise<OutboxRecord>;
  transition(guid:Hex,expected:OutboxState,update:OutboxUpdate):Promise<OutboxRecord>;
  get(guid:Hex):Promise<OutboxRecord|undefined>;
  list():Promise<OutboxRecord[]>;
  close():void;
}

const allowed:Record<OutboxState,OutboxState[]>={SIGNING:["FAILED"],READY:["ATTEMPTING","FAILED","RECOVERY_REQUIRED"],ATTEMPTING:["SUBMITTED","RECOVERY_REQUIRED"],SUBMITTED:["CONFIRMED","FAILED"],CONFIRMED:[],FAILED:[],RECOVERY_REQUIRED:[]};
const states=new Set<OutboxState>(["SIGNING","READY","ATTEMPTING","SUBMITTED","CONFIRMED","FAILED","RECOVERY_REQUIRED"]);

export class SqliteVerificationOutbox implements VerificationOutboxStore {
  private db:DatabaseSync;
  private allowedSigners:Set<string>;
  constructor(path:string,private authorized:Hex[],private quorum:number){
    if(quorum!==3||authorized.length!==5)throw new Error("outbox requires a 3-of-5 signer configuration");
    let prior="";this.allowedSigners=new Set();
    for(const value of authorized){const signer=normalizeAddress(value);if(signer<=prior)throw new Error("outbox authorized signers must be unique and sorted");prior=signer;this.allowedSigners.add(signer)}
    this.db=new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS verification_outbox(guid TEXT PRIMARY KEY,state TEXT NOT NULL,record_json TEXT NOT NULL,updated_at INTEGER NOT NULL);");
  }

  async plan(guid:Hex,envelope:SigningEnvelope,now:number):Promise<OutboxRecord>{
    validateTime(now);const normalized=planPayload(guid,envelope),record:OutboxRecord={...normalized,shares:[],state:"SIGNING",createdAt:now,updatedAt:now};
    this.validateRecord(record);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const row=this.row(guid);
      if(row){const existing=this.decodeRow(row);if(planIdentity(existing)!==planIdentity(record))throw new Error("outbox plan conflict");this.db.exec("COMMIT");return existing}
      this.db.prepare("INSERT INTO verification_outbox(guid,state,record_json,updated_at) VALUES(?,?,?,?)").run(guid,"SIGNING",encode(record),now);
      this.db.exec("COMMIT");return record;
    }catch(error){this.db.exec("ROLLBACK");throw error}
  }

  async recordQuorum(guid:Hex,shares:SignatureShare[],now:number):Promise<OutboxRecord>{
    validateHash(guid,"GUID");validateTime(now);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const row=this.row(guid);if(!row)throw new Error("unknown outbox GUID");
      const current=this.decodeRow(row),validated=this.validateShares(current.digest,shares);
      if(current.state!=="SIGNING"){
        if(encode(current.shares)!==encode(validated))throw new Error("outbox quorum conflict");
        this.db.exec("COMMIT");return current;
      }
      if(BigInt(now)>=current.envelope.expiry)throw new Error("outbox signing authorization expired");
      const next:OutboxRecord={...current,shares:validated,state:"READY",updatedAt:now};this.validateRecord(next);
      this.db.prepare("UPDATE verification_outbox SET state=?,record_json=?,updated_at=? WHERE guid=? AND state=?").run("READY",encode(next),now,guid,"SIGNING");
      this.db.exec("COMMIT");return next;
    }catch(error){this.db.exec("ROLLBACK");throw error}
  }

  async transition(guid:Hex,expected:OutboxState,update:OutboxUpdate):Promise<OutboxRecord>{
    validateHash(guid,"GUID");validateTime(update.updatedAt);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const row=this.row(guid);if(!row)throw new Error("unknown outbox GUID");
      const current=this.decodeRow(row);if(row.state!==expected||current.state!==expected)throw new Error("outbox state mismatch");
      if(update.updatedAt<current.updatedAt)throw new Error("outbox timestamp regression");
      if(!allowed[expected].includes(update.state))throw new Error("invalid outbox transition");
      if(expected==="SIGNING"&&(update.state!=="FAILED"||update.failureCode!=="SIGNING_EXPIRED"))throw new Error("invalid signing failure transition");
      const next:OutboxRecord={...current,...update};this.validateRecord(next);
      this.db.prepare("UPDATE verification_outbox SET state=?,record_json=?,updated_at=? WHERE guid=? AND state=?").run(next.state,encode(next),next.updatedAt,guid,expected);
      this.db.exec("COMMIT");return next;
    }catch(error){this.db.exec("ROLLBACK");throw error}
  }

  async get(guid:Hex):Promise<OutboxRecord|undefined>{validateHash(guid,"GUID");const row=this.row(guid);return row?this.decodeRow(row):undefined}
  async list():Promise<OutboxRecord[]>{return(this.db.prepare("SELECT state,record_json FROM verification_outbox ORDER BY updated_at,guid").all() as Row[]).map(row=>this.decodeRow(row))}
  close():void{this.db.close()}

  private row(guid:Hex):Row|undefined{return this.db.prepare("SELECT state,record_json FROM verification_outbox WHERE guid=?").get(guid) as Row|undefined}
  private decodeRow(row:Row):OutboxRecord {try{const record=decode(row.record_json);if(record.state!==row.state)throw new Error();this.validateRecord(record);return record}catch{throw new Error("outbox record invariant violation")}}
  private validateShares(digest:Hex,shares:SignatureShare[]):SignatureShare[]{
    if(shares.length!==this.quorum)throw new Error("outbox requires exact quorum shares");
    let prior="";const result:SignatureShare[]=[];
    for(const share of shares){
      const address=normalizeAddress(share.address);if(address<=prior||!this.allowedSigners.has(address))throw new Error("outbox shares must be authorized, unique and sorted");
      if(share.digest.toLowerCase()!==digest.toLowerCase())throw new Error("outbox share digest mismatch");
      if(!/^0x[0-9a-fA-F]{130}$/.test(share.signature))throw new Error("invalid outbox signature");
      let recovered:string;try{recovered=verifyMessage(getBytes(digest),share.signature).toLowerCase()}catch{throw new Error("invalid outbox signature")}
      if(recovered!==address)throw new Error("outbox signature identity mismatch");
      prior=address;result.push({...share,address:address as Hex});
    }
    return result;
  }
  private validateRecord(record:OutboxRecord):void{
    if(!states.has(record.state))throw new Error();validateHash(record.guid,"GUID");validateHash(record.digest,"digest");validateTime(record.createdAt);validateTime(record.updatedAt);
    if(record.updatedAt<record.createdAt||!same(record.envelope.guid,record.guid)||!same(executionDigest(record.envelope),record.digest))throw new Error();
    if(!Array.isArray(record.shares))throw new Error();
    if(record.state==="SIGNING"){if(record.shares.length!==0)throw new Error()}
    else if(record.state==="FAILED"){if(record.shares.length!==0&&record.shares.length!==this.quorum)throw new Error();if(record.shares.length)this.validateShares(record.digest,record.shares)}
    else this.validateShares(record.digest,record.shares);
    if(record.transactionHash)validateHash(record.transactionHash,"transaction hash");
    const hasTransaction=record.transactionHash!==undefined,hasConfirmations=record.confirmations!==undefined,hasFailure=record.failureCode!==undefined;
    if(record.state==="SIGNING"||record.state==="READY"||record.state==="ATTEMPTING"){if(hasTransaction||hasConfirmations||hasFailure)throw new Error()}
    else if(record.state==="SUBMITTED"){if(!hasTransaction||hasConfirmations||hasFailure)throw new Error()}
    else if(record.state==="CONFIRMED"){if(!hasTransaction||!hasConfirmations||record.confirmations!<=0n||hasFailure)throw new Error()}
    else if(record.state==="FAILED"||record.state==="RECOVERY_REQUIRED"){if(hasConfirmations||!hasFailure)throw new Error()}
    if(record.failureCode&&!/^[A-Z][A-Z0-9_]{1,63}$/.test(record.failureCode))throw new Error();
  }
}

interface Row {state:OutboxState;record_json:string}
function planPayload(guid:Hex,envelope:SigningEnvelope):Pick<OutboxRecord,"guid"|"digest"|"envelope"> {validateHash(guid,"GUID");if(!same(envelope.guid,guid))throw new Error("outbox GUID mismatch");return{guid,digest:executionDigest(envelope),envelope}}
function planIdentity(record:OutboxRecord):string{return encode({guid:record.guid,digest:record.digest,envelope:record.envelope})}
function validateHash(value:string,name:string):void {if(!/^0x[0-9a-fA-F]{64}$/.test(value))throw new Error(`invalid ${name}`)}
function normalizeAddress(value:string):string {if(!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error("invalid signer address");return value.toLowerCase()}
function validateTime(value:number):void {if(!Number.isSafeInteger(value)||value<0)throw new Error("invalid outbox timestamp")}
function same(left:string,right:string):boolean{return left.toLowerCase()===right.toLowerCase()}
function encode(value:unknown):string{return JSON.stringify(value,(_,item)=>typeof item==="bigint"?{$sentinelBigInt:item.toString()}:item)}
function decode(value:string):OutboxRecord{return JSON.parse(value,(_,item)=>item&&typeof item==="object"&&Object.keys(item).length===1&&typeof item.$sentinelBigInt==="string"?BigInt(item.$sentinelBigInt):item) as OutboxRecord}
