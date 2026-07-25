import type{DetectedPacket}from"./listener.js";import type{PacketFailurePolicy,PacketInbox}from"./ingestion.js";import type{DeadLetter,RecoveryStore}from"./recovery-store.js";
export interface DeadLetterReader{listDead():Promise<DeadLetter[]>;}
export class RecoveryService implements DeadLetterReader{
 constructor(private pathwayKey:string,private store:Pick<RecoveryStore,"listDead">,_inbox?:PacketInbox){}
 listDead():Promise<DeadLetter[]>{return this.store.listDead(this.pathwayKey)}
}
export function recoveryFailurePolicy(pathwayKey:string,store:Pick<RecoveryStore,"recordFailure">,maximumAttempts:number,now=()=>Math.floor(Date.now()/1000)):PacketFailurePolicy{return(packet:DetectedPacket)=>store.recordFailure(pathwayKey,packet,"INGESTION_FAILED",now(),maximumAttempts)}
