import {createHash} from "node:crypto";
import type {Hex,PolicyRequest} from "../../../packages/core/src/types.js";

export const GENLAYER_RECORD_SCHEMA="sentinel-policy-record/v1";
const COMPAT_VERSION="v1";
const HEX32=/^0x[0-9a-f]{64}$/;
const POLICY_VERSION=/^[A-Za-z0-9._-]{1,64}$/;
const MAX_RECORD_BYTES=1400;
const MAX_REASON_BYTES=1024;

export interface GenLayerPolicyRecord{
  decision:"ALLOW"|"DENY";
  policyVersion:string;
  requestBinding:Hex;
  reason:string;
}

export function genLayerRequestBinding(request:PolicyRequest,policyVersion:string):Hex{
  const fields=[
    GENLAYER_RECORD_SCHEMA,
    request.packet.guid.toLowerCase(),
    request.packet.payloadHash.toLowerCase(),
    request.evidence.uri,
    request.evidence.digest.toLowerCase(),
    request.decodedAction,
    request.policy,
    policyVersion,
  ];
  const hash=createHash("sha256").update("SENTINEL_POLICY_REQUEST_V1","utf8");
  for(const field of fields){
    const bytes=Buffer.from(field,"utf8");
    hash.update(String(bytes.length),"ascii");
    hash.update(":","ascii");
    hash.update(bytes);
  }
  return `0x${hash.digest("hex")}` as Hex;
}

export function decodeGenLayerRecord(raw:unknown,request:PolicyRequest):GenLayerPolicyRecord{
  if(typeof raw!=="string")throw new Error("invalid GenLayer policy record");
  if(Buffer.byteLength(raw,"utf8")>MAX_RECORD_BYTES)throw mismatch();
  const parts=raw.split("|");
  if(parts.length<7)throw mismatch();
  const [schema,decision,packetDigest,evidenceDigest,policyVersion,requestBinding,...reasonParts]=parts;
  const policyVersionValue=policyVersion??"";
  const expectedBinding=POLICY_VERSION.test(policyVersionValue)
    ?genLayerRequestBinding(request,policyVersionValue)
    :undefined;
  if(
    schema!==COMPAT_VERSION||
    (decision!=="ALLOW"&&decision!=="DENY")||
    !HEX32.test(packetDigest??"")||
    packetDigest!==request.packet.payloadHash.toLowerCase()||
    !HEX32.test(evidenceDigest??"")||
    evidenceDigest!==request.evidence.digest.toLowerCase()||
    !expectedBinding||
    requestBinding!==expectedBinding
  )throw mismatch();
  const reason=reasonParts.join("|");
  const reasonBytes=Buffer.byteLength(reason,"utf8");
  if(reasonBytes===0||reasonBytes>MAX_REASON_BYTES)throw mismatch();
  return{
    decision,
    policyVersion:policyVersionValue,
    requestBinding:requestBinding as Hex,
    reason,
  };
}

function mismatch():Error{
  return new Error("GenLayer record binding mismatch");
}
