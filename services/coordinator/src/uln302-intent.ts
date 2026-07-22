import {Interface,dataSlice} from "ethers";
import {assertCanonicalPacket,encodePacketV1} from "../../../packages/core/src/packet-v1.js";
import type {Hex,PolicyRequest,PolicyResult} from "../../../packages/core/src/types.js";
import type {VerifiedDestinationPath} from "./destination-path-verifier.js";
import type {SigningEnvelope} from "./signing.js";

const receiveInterface=new Interface(["function verify(bytes packetHeader,bytes32 payloadHash,uint64 confirmations)"]);

export class Uln302IntentFactory {
  constructor(private ttlSeconds:number){if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<30||ttlSeconds>900)throw new Error("invalid signature TTL")}

  create(request:PolicyRequest,result:PolicyResult,path:VerifiedDestinationPath,now:number):SigningEnvelope {
    if(result.decision!=="ALLOW")throw new Error("policy decision does not authorize signing");
    if(!same(result.guid,request.packet.guid)||!same(result.packetDigest,request.packet.payloadHash)||!same(result.evidenceDigest,request.evidence.digest))throw new Error("policy result binding mismatch");
    if(!Number.isSafeInteger(now)||now<0||result.finalizedAt>now)throw new Error("invalid signing time");
    const expiry=now+this.ttlSeconds;
    if(!Number.isSafeInteger(expiry)||request.evidence.validUntil<expiry)throw new Error("evidence expires before signature");
    const encoded=encodePacketV1({nonce:request.packet.nonce,srcEid:request.packet.srcEid,sender:request.packet.sender,dstEid:request.packet.dstEid,receiver:request.packet.receiver,guid:request.packet.guid,message:request.packet.message});
    assertCanonicalPacket(encoded,request.packet);
    const expectedReceiver=`0x${"0".repeat(24)}${path.oapp.slice(2)}`.toLowerCase();
    if(request.packet.receiver.toLowerCase()!==expectedReceiver||request.packet.srcEid!==path.srcEid)throw new Error("destination pathway binding mismatch");
    const packetHeader=dataSlice(encoded,0,81) as Hex;
    const callData=receiveInterface.encodeFunctionData("verify",[packetHeader,request.packet.payloadHash,path.confirmations]) as Hex;
    return{chainId:path.chainId,adapter:path.adapter,verificationTarget:path.receiveLibrary,guid:request.packet.guid,packetDigest:request.packet.payloadHash,evidenceDigest:request.evidence.digest,callData,expiry:BigInt(expiry)};
  }
}

function same(left:string,right:string):boolean{return left.toLowerCase()===right.toLowerCase()}
