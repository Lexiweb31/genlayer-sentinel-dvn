import type { Packet, PolicyResult, Snapshot, Verification } from "./types.js";

export class SentinelJob {
  readonly snapshot: Snapshot;
  constructor(packet: Packet) { this.snapshot = { packet, stage: "DETECTED", verifications: [], signers: [] }; }
  addVerification(v: Verification, minimum: bigint): void {
    if (this.snapshot.stage !== "DETECTED") throw new Error("verification stage closed");
    if (v.payloadHash !== this.snapshot.packet.payloadHash || v.blockHash !== this.snapshot.packet.blockHash) throw new Error("RPC disagreement");
    if (v.confirmations < minimum) throw new Error("insufficient confirmations");
    if (this.snapshot.verifications.some(x => x.provider === v.provider)) throw new Error("duplicate provider");
    this.snapshot.verifications.push(v);
    if (this.snapshot.verifications.length >= 2) this.snapshot.stage = "CONFIRMED";
  }
  requestPolicy(): void {
    if (this.snapshot.stage !== "CONFIRMED") throw new Error("packet not independently confirmed");
    this.snapshot.stage = "POLICY_PENDING";
  }
  finalize(result: PolicyResult, now: number): void {
    if (this.snapshot.stage !== "POLICY_PENDING") throw new Error("policy not pending");
    if (result.guid !== this.snapshot.packet.guid || result.packetDigest !== this.snapshot.packet.payloadHash) throw new Error("decision binding mismatch");
    if (result.finalizedAt > now) throw new Error("future finality timestamp");
    this.snapshot.result = result;
    this.snapshot.stage = result.decision === "ALLOW" ? "POLICY_FINALIZED" : "REJECTED";
  }
  addSigner(address: string, quorum: number): void {
    if (this.snapshot.stage !== "POLICY_FINALIZED" && this.snapshot.stage !== "QUORUM_REACHED") throw new Error("signing forbidden");
    const normalized = address.toLowerCase();
    if (this.snapshot.signers.includes(normalized)) throw new Error("duplicate signer");
    this.snapshot.signers.push(normalized);
    if (this.snapshot.signers.length >= quorum) this.snapshot.stage = "QUORUM_REACHED";
  }
  markVerified():void {if(this.snapshot.stage!=="QUORUM_REACHED")throw new Error("quorum not reached");this.snapshot.stage="VERIFIED";}
  markExecuted():void {if(this.snapshot.stage!=="VERIFIED")throw new Error("message not verified");this.snapshot.stage="EXECUTED";}
}
