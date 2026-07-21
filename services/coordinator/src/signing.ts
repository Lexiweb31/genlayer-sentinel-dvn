import {AbiCoder,getBytes,keccak256,verifyMessage} from "ethers";
import type {Hex,PolicyResult} from "../../../packages/core/src/types.js";

export interface SigningEnvelope {chainId:bigint;adapter:Hex;verificationTarget:Hex;guid:Hex;packetDigest:Hex;evidenceDigest:Hex;callData:Hex;expiry:bigint;}
export interface SignatureShare {address:Hex;signature:Hex;digest:Hex;}
export interface FinalityAttestor {assertFinalized(result:PolicyResult):Promise<void>;}
export interface DigestSigner {address:Hex;signMessageDigest(digest:Hex):Promise<Hex>;}

export function executionDigest(e:SigningEnvelope):Hex {
  const encoded=AbiCoder.defaultAbiCoder().encode(["uint256","address","address","bytes32","bytes32","bytes32","bytes32","uint64"],[e.chainId,e.adapter,e.verificationTarget,e.guid,e.packetDigest,e.evidenceDigest,keccak256(e.callData),e.expiry]);
  return keccak256(encoded) as Hex;
}

/// Key material stays behind DigestSigner (KMS/HSM/remote process). This service never accepts or exports a private key.
export class IsolatedSignerService {
  constructor(private key:DigestSigner,private finality:FinalityAttestor,private allowed:{chainId:bigint;adapter:Hex;verificationTarget:Hex;maxTtlSeconds:bigint},private clock=()=>BigInt(Math.floor(Date.now()/1000))){}
  get address():Hex{return this.key.address;}
  async sign(e:SigningEnvelope,result:PolicyResult):Promise<SignatureShare>{
    const now=this.clock();
    if(result.decision!=="ALLOW") throw new Error("signer refuses non-ALLOW decision");
    if(e.guid.toLowerCase()!==result.guid.toLowerCase()||e.packetDigest.toLowerCase()!==result.packetDigest.toLowerCase()||e.evidenceDigest.toLowerCase()!==result.evidenceDigest.toLowerCase()) throw new Error("signing envelope decision binding mismatch");
    if(e.chainId!==this.allowed.chainId||e.adapter.toLowerCase()!==this.allowed.adapter.toLowerCase()||e.verificationTarget.toLowerCase()!==this.allowed.verificationTarget.toLowerCase()) throw new Error("signing domain not authorized");
    if(e.expiry<=now||e.expiry-now>this.allowed.maxTtlSeconds) throw new Error("signature expiry outside policy");
    await this.finality.assertFinalized(result);
    const digest=executionDigest(e); const signature=await this.key.signMessageDigest(digest);
    if(verifyMessage(getBytes(digest),signature).toLowerCase()!==this.key.address.toLowerCase()) throw new Error("signer returned invalid signature");
    return {address:this.key.address,signature,digest};
  }
}

export async function collectQuorum(e:SigningEnvelope,result:PolicyResult,services:IsolatedSignerService[],authorized:Hex[],quorum:number):Promise<SignatureShare[]>{
  if(quorum<1||quorum>authorized.length) throw new Error("invalid quorum");
  const allowed=new Set(authorized.map(x=>x.toLowerCase())); const settled=await Promise.allSettled(services.map(x=>x.sign(e,result))); const unique=new Map<string,SignatureShare>(); const digest=executionDigest(e);
  for(const item of settled){if(item.status!=="fulfilled")continue;const share=item.value;const a=share.address.toLowerCase();if(!allowed.has(a)||share.digest.toLowerCase()!==digest.toLowerCase()||unique.has(a))continue;unique.set(a,share);}
  if(unique.size<quorum) throw new Error("signer quorum not reached");
  return [...unique.values()].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0,quorum);
}

export interface AdapterClient {used(digest:Hex):Promise<boolean>;submitVerification(e:SigningEnvelope,signatures:Hex[]):Promise<Hex>;}
export async function submitVerificationOnce(client:AdapterClient,e:SigningEnvelope,shares:SignatureShare[]):Promise<{status:"SUBMITTED"|"ALREADY_VERIFIED";txHash?:Hex}>{
  const digest=executionDigest(e);if(await client.used(digest))return{status:"ALREADY_VERIFIED"};
  for(const s of shares)if(s.digest.toLowerCase()!==digest.toLowerCase())throw new Error("share digest mismatch");
  const txHash=await client.submitVerification(e,shares.map(x=>x.signature));if(!await client.used(digest))throw new Error("destination did not record verification");return{status:"SUBMITTED",txHash};
}
