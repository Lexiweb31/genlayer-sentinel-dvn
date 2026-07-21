import { SentinelJob } from "../../../packages/core/src/state-machine.js";
import type { Packet, PolicyResult, Verification } from "../../../packages/core/src/types.js";

export interface PacketVerifier { verify(packet: Packet): Promise<Verification[]>; }
export interface GenLayerFinality { submit(packet: Packet): Promise<string>; finalized(requestId: string): Promise<PolicyResult | undefined>; }
export interface SignerNode { address: string; sign(result: PolicyResult): Promise<string>; }

export class Coordinator {
  readonly jobs = new Map<string, SentinelJob>();
  readonly requestIds = new Map<string, string>();
  constructor(private verifier: PacketVerifier, private genlayer: GenLayerFinality, private signers: SignerNode[], private quorum = 3, private minimumConfirmations = 15n) {}
  async detect(packet: Packet): Promise<string> {
    const existing=this.requestIds.get(packet.guid); if(existing) return existing;
    const job = new SentinelJob(packet); this.jobs.set(packet.guid, job);
    for (const result of await this.verifier.verify(packet)) job.addVerification(result, this.minimumConfirmations);
    job.requestPolicy(); const requestId=await this.genlayer.submit(packet); this.requestIds.set(packet.guid,requestId); return requestId;
  }
  async poll(guid: string, requestId: string, now = Math.floor(Date.now()/1000)): Promise<void> {
    const job = this.jobs.get(guid); if (!job) throw new Error("unknown GUID");
    if (["REJECTED","QUORUM_REACHED","VERIFIED","EXECUTED"].includes(job.snapshot.stage)) return;
    const result = await this.genlayer.finalized(requestId); if (!result) return;
    job.finalize(result, now); if (job.snapshot.stage === "REJECTED") return;
    for (const signer of this.signers) { await signer.sign(result); job.addSigner(signer.address, this.quorum); if(job.snapshot.stage==="QUORUM_REACHED") break; }
  }
}
