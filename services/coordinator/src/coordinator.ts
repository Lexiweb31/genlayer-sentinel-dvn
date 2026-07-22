import { SentinelJob } from "../../../packages/core/src/state-machine.js";
import type { PolicyRequest, PolicyResult, Verification } from "../../../packages/core/src/types.js";
import type {Hex} from "../../../packages/core/src/types.js";
import {collectQuorum,type IsolatedSignerService,type SignatureShare,type SigningEnvelope} from "./signing.js";
import type {JobStore} from "./job-store.js";

export interface PacketVerifier { verify(packet: PolicyRequest["packet"]): Promise<Verification[]>; }
export interface GenLayerFinality { submit(request: PolicyRequest): Promise<string>; finalized(requestId: string): Promise<PolicyResult | undefined>; register?(requestId:string,request:PolicyRequest):void; }

export class Coordinator {
  readonly jobs = new Map<string, SentinelJob>();
  readonly requestIds = new Map<string, string>();
  readonly requests = new Map<string,PolicyRequest>();
  constructor(private verifier: PacketVerifier, private genlayer: GenLayerFinality, private signers: IsolatedSignerService[], private quorum = 3, private minimumConfirmations = 15n,private store?:JobStore) {}
  async restore():Promise<void>{if(!this.store)return;for(const record of await this.store.load()){if(record.guid.toLowerCase()!==record.snapshot.packet.guid.toLowerCase())throw new Error("persisted GUID mismatch");const job=SentinelJob.restore(record.snapshot);this.jobs.set(record.guid,job);if(record.request)this.requests.set(record.guid,record.request);if(record.requestId){this.requestIds.set(record.guid,record.requestId);if(record.request)this.genlayer.register?.(record.requestId,record.request)}}}
  async detect(request: PolicyRequest, now=Math.floor(Date.now()/1000)): Promise<string> {
    const {packet,evidence}=request;
    if(!evidence.uri.startsWith("https://")) throw new Error("authoritative evidence must use HTTPS");
    if(evidence.observedAt>now||evidence.validUntil<=now) throw new Error("evidence is future-dated or expired");
    if(!/^0x[0-9a-fA-F]{64}$/.test(evidence.digest)) throw new Error("invalid evidence digest");
    if(!request.decodedAction.trim()||!request.policy.trim()) throw new Error("decoded action and policy are required");
    const existing=this.requestIds.get(packet.guid); if(existing) return existing;if(this.jobs.has(packet.guid))throw new Error("policy submission recovery required; refusing duplicate submission");
    const job = new SentinelJob(packet); this.jobs.set(packet.guid, job);this.requests.set(packet.guid,request);
    for (const result of await this.verifier.verify(packet)) job.addVerification(result, this.minimumConfirmations);
    job.requestPolicy();await this.persist(packet.guid,undefined,now);const requestId=await this.genlayer.submit(request);this.requestIds.set(packet.guid,requestId);await this.persist(packet.guid,requestId,now);return requestId;
  }
  async poll(guid: string, requestId: string, now = Math.floor(Date.now()/1000)): Promise<void> {
    const job = this.jobs.get(guid); if (!job) throw new Error("unknown GUID");
    if (["REJECTED","QUORUM_REACHED","VERIFIED","EXECUTED"].includes(job.snapshot.stage)) return;
    const result = await this.genlayer.finalized(requestId); if (!result) return;
    job.finalize(result, now);await this.persist(guid,requestId,now);
  }
  async pollPending(now=Math.floor(Date.now()/1000)):Promise<number>{const pending=[...this.jobs.entries()].filter(([,job])=>job.snapshot.stage==="POLICY_PENDING");for(const[guid]of pending){const requestId=this.requestIds.get(guid);if(!requestId)throw new Error("pending job has no GenLayer request ID");await this.poll(guid,requestId,now)}return pending.length}
  async authorize(guid:string,envelope:SigningEnvelope,authorized:Hex[]):Promise<SignatureShare[]>{
    const job=this.jobs.get(guid);if(!job||job.snapshot.stage!=="POLICY_FINALIZED"||!job.snapshot.result)throw new Error("job is not ready for signing");
    const shares=await collectQuorum(envelope,job.snapshot.result,this.signers,authorized,this.quorum);
    for(const share of shares)job.addSigner(share.address,this.quorum);await this.persist(guid,this.requestIds.get(guid));return shares;
  }
  async markVerified(guid:string):Promise<void>{const job=this.jobs.get(guid);if(!job)throw new Error("unknown GUID");job.markVerified();await this.persist(guid,this.requestIds.get(guid))}
  async markExecuted(guid:string):Promise<void>{const job=this.jobs.get(guid);if(!job)throw new Error("unknown GUID");job.markExecuted();await this.persist(guid,this.requestIds.get(guid))}
  async confirmExecution(guid:string):Promise<void>{const job=this.jobs.get(guid);if(!job)throw new Error("unknown GUID");if(job.snapshot.stage==="EXECUTED")return;if(job.snapshot.stage==="QUORUM_REACHED")job.markVerified();if(job.snapshot.stage!=="VERIFIED")throw new Error("job is not ready for destination confirmation");job.markExecuted();await this.persist(guid,this.requestIds.get(guid))}
  private async persist(guid:string,requestId?:string,updatedAt=Math.floor(Date.now()/1000)):Promise<void>{if(!this.store)return;const job=this.jobs.get(guid);if(!job)throw new Error("unknown GUID");await this.store.save({guid,requestId,request:this.requests.get(guid),snapshot:job.snapshot,updatedAt})}
}
