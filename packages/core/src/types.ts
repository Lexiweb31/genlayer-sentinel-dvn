export type Hex = `0x${string}`;
export type Decision = "ALLOW" | "DENY" | "UNDETERMINED";
export type Stage = "DETECTED" | "CONFIRMED" | "POLICY_PENDING" | "POLICY_FINALIZED" | "QUORUM_REACHED" | "VERIFIED" | "EXECUTED" | "REJECTED";

export interface Packet {
  guid: Hex; srcEid: number; dstEid: number; nonce: bigint; sender: Hex; receiver: Hex;
  message: Hex; payloadHash: Hex; encodedPayloadHash: Hex; txHash: Hex; blockHash: Hex; blockNumber: bigint;
}
export interface Evidence { uri: string; digest: Hex; observedAt: number; validUntil: number; }
export interface PolicyRequest { packet: Packet; evidence: Evidence; decodedAction: string; policy: string; }
export interface PolicyResult { guid: Hex; packetDigest: Hex; evidenceDigest: Hex; decision: Decision; reasonCode: string; finalizedAt: number; policyVersion: string; }
export interface Verification { provider: string; blockHash: Hex; payloadHash: Hex; configurationDigest: Hex; confirmations: bigint; }
export interface Snapshot { packet: Packet; stage: Stage; verifications: Verification[]; result?: PolicyResult; signers: string[]; }
