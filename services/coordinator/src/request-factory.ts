import {AbiCoder,getBytes,keccak256,sha256,toUtf8Bytes} from "ethers";
import {decodePacketV1} from "../../../packages/core/src/packet-v1.js";
import type {Hex,PolicyRequest} from "../../../packages/core/src/types.js";
import type {DetectedPacket} from "./listener.js";
import {isIP} from "node:net";

export interface AuthoritativeEvidenceSource {read(uri:string):Promise<string>;}
export interface RequestFactoryConfig {srcEid:number;dstEid:number;sender:Hex;receiver:Hex;sendLibrary:Hex;sentinelDvn:Hex;evidenceUri:string;policy:string;evidenceTtlSeconds:number;maximumEvidenceBytes?:number;}

export class PolicyRequestFactory {
  constructor(private config:RequestFactoryConfig,private evidence:AuthoritativeEvidenceSource,private clock=()=>Math.floor(Date.now()/1000)){}
  async create(detected:DetectedPacket):Promise<PolicyRequest>{const c=this.config;if(detected.sendLibrary.toLowerCase()!==c.sendLibrary.toLowerCase())throw new Error("unexpected packet send library");if(detected.requiredDvns.some(address=>same(address,c.sentinelDvn)))throw new Error("Sentinel must not be a required DVN in the prototype");const optionalIndex=detected.optionalDvns.findIndex(address=>same(address,c.sentinelDvn));if(optionalIndex<0)throw new Error("Sentinel optional DVN fee missing");const feeIndex=detected.requiredDvns.length+optionalIndex;if((detected.fees[feeIndex]??0n)<=0n)throw new Error("Sentinel optional DVN fee is zero");
    const decoded=decodePacketV1(detected.encodedPayload);if(decoded.srcEid!==c.srcEid||decoded.dstEid!==c.dstEid||!same(decoded.sender,c.sender)||!same(decoded.receiver,c.receiver))throw new Error("packet pathway mismatch");const [action]=AbiCoder.defaultAbiCoder().decode(["tuple(bytes32 authorizationId,address target,uint256 value,bytes data)"],decoded.message) as unknown as [{authorizationId:Hex;target:string;value:bigint;data:Hex}];if(!action.authorizationId||/^0x0{64}$/i.test(action.authorizationId)||!/^0x[0-9a-fA-F]{40}$/.test(action.target))throw new Error("invalid treasury action");
    if(!c.evidenceUri.startsWith("https://")||!c.policy.trim()||!Number.isSafeInteger(c.evidenceTtlSeconds)||c.evidenceTtlSeconds<=0)throw new Error("invalid policy configuration");const body=await this.evidence.read(c.evidenceUri),bytes=toUtf8Bytes(body),limit=c.maximumEvidenceBytes??262144;if(bytes.length===0||bytes.length>limit)throw new Error("authoritative evidence is empty or oversized");const observedAt=this.clock();
    return{packet:{guid:decoded.guid,srcEid:decoded.srcEid,dstEid:decoded.dstEid,nonce:decoded.nonce,sender:decoded.sender,receiver:decoded.receiver,message:decoded.message,payloadHash:decoded.payloadHash,encodedPayloadHash:keccak256(detected.encodedPayload) as Hex,txHash:detected.transactionHash,blockHash:detected.blockHash,blockNumber:detected.blockNumber},evidence:{uri:c.evidenceUri,digest:sha256(bytes) as Hex,observedAt,validUntil:observedAt+c.evidenceTtlSeconds},decodedAction:JSON.stringify({authorizationId:action.authorizationId.toLowerCase(),target:action.target.toLowerCase(),value:action.value.toString(),selector:getBytes(action.data).length>=4?action.data.slice(0,10):"0x",calldata:action.data}),policy:c.policy}}
}
function same(a:string,b:string):boolean{return a.toLowerCase()===b.toLowerCase()}

export class HttpsEvidenceSource implements AuthoritativeEvidenceSource {
  private hosts:Set<string>;
  constructor(allowedHosts:string[]){if(!allowedHosts.length)throw new Error("evidence host allowlist is required");this.hosts=new Set(allowedHosts.map(host=>normalizeHost(host)))}
  async read(uri:string):Promise<string>{validateEvidenceUrl(uri,this.hosts);const response=await fetch(uri,{headers:{accept:"application/json, text/plain;q=0.9"},redirect:"error",signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`evidence HTTP ${response.status}`);const contentType=response.headers.get("content-type")?.toLowerCase()??"";if(!contentType.startsWith("application/json")&&!contentType.startsWith("text/plain"))throw new Error("unsupported evidence content type");return response.text()}
}
export function validateEvidenceUrl(uri:string,allowedHosts:ReadonlySet<string>):URL{let url:URL;try{url=new URL(uri)}catch{throw new Error("invalid evidence URL")}const host=url.hostname.toLowerCase();if(url.protocol!=="https:"||url.username||url.password||url.port||host==="localhost"||host.endsWith(".localhost")||isIP(host)!==0||!allowedHosts.has(host))throw new Error("evidence URL is not an allowed HTTPS origin");return url}
function normalizeHost(host:string):string{let url:URL;try{url=new URL(`https://${host}`)}catch{throw new Error("invalid evidence host allowlist entry")}if(url.hostname!==host.toLowerCase()||url.port||url.username||url.password||url.pathname!=="/"||isIP(url.hostname)!==0||url.hostname==="localhost"||url.hostname.endsWith(".localhost"))throw new Error("invalid evidence host allowlist entry");return url.hostname}
