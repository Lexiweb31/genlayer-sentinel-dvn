import {concat,dataSlice,keccak256,solidityPacked,solidityPackedKeccak256} from "ethers";
import type {Hex,Packet} from "./types.js";

export interface DecodedPacketV1 {version:number;nonce:bigint;srcEid:number;sender:Hex;dstEid:number;receiver:Hex;guid:Hex;message:Hex;payloadHash:Hex;}
const HEADER_BYTES=81, GUID_END=113;
export function decodePacketV1(encoded:Hex):DecodedPacketV1 {
  if((encoded.length-2)/2<GUID_END) throw new Error("packet too short");
  const version=Number(BigInt(dataSlice(encoded,0,1))); if(version!==1) throw new Error("unsupported packet version");
  const nonce=BigInt(dataSlice(encoded,1,9)); const srcEid=Number(BigInt(dataSlice(encoded,9,13))); const sender=dataSlice(encoded,13,45) as Hex;
  const dstEid=Number(BigInt(dataSlice(encoded,45,49))); const receiver=dataSlice(encoded,49,HEADER_BYTES) as Hex; const guid=dataSlice(encoded,HEADER_BYTES,GUID_END) as Hex; const message=dataSlice(encoded,GUID_END) as Hex;
  const expectedGuid=solidityPackedKeccak256(["uint64","uint32","bytes32","uint32","bytes32"],[nonce,srcEid,sender,dstEid,receiver]);
  if(guid.toLowerCase()!==expectedGuid.toLowerCase()) throw new Error("GUID mismatch");
  return {version,nonce,srcEid,sender,dstEid,receiver,guid,message,payloadHash:keccak256(concat([guid,message])) as Hex};
}
export function assertCanonicalPacket(encoded:Hex,expected:Packet):DecodedPacketV1 {
  const p=decodePacketV1(encoded); const eq=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
  if(p.nonce!==expected.nonce||p.srcEid!==expected.srcEid||p.dstEid!==expected.dstEid||!eq(p.sender,expected.sender)||!eq(p.receiver,expected.receiver)||!eq(p.guid,expected.guid)||!eq(p.message,expected.message)||!eq(p.payloadHash,expected.payloadHash)) throw new Error("canonical packet fields mismatch");
  if(!eq(keccak256(encoded),expected.encodedPayloadHash)) throw new Error("encoded packet hash mismatch"); return p;
}
export function encodePacketV1(input:Omit<DecodedPacketV1,"version"|"payloadHash">):Hex {
  return solidityPacked(["uint8","uint64","uint32","bytes32","uint32","bytes32","bytes32","bytes"],[1,input.nonce,input.srcEid,input.sender,input.dstEid,input.receiver,input.guid,input.message]) as Hex;
}
