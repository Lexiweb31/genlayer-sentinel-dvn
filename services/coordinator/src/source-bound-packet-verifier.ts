import type {Hex,PolicyRequest,Verification} from "../../../packages/core/src/types.js";
import type {PacketVerifier} from "./coordinator.js";
import type {PacketReceiptVerifier} from "./rpc-verifier.js";
import type {SourcePathVerifier} from "./source-path-verifier.js";

export class SourceBoundPacketVerifier implements PacketVerifier {
  constructor(private receipts:PacketReceiptVerifier,private pathway:SourcePathVerifier){}
  async verify(packet:PolicyRequest["packet"]):Promise<Verification[]>{
    const [receipts,path]=await Promise.all([this.receipts.verify(packet),this.pathway.verify(packet)]);
    if(receipts.length<2)throw new Error("source verification requires two receipt verifications");
    if(!/^0x[0-9a-fA-F]{64}$/.test(path.configurationDigest)||/^0x0{64}$/i.test(path.configurationDigest))throw new Error("invalid source configuration digest");
    const configurationDigest=path.configurationDigest.toLowerCase() as Hex;
    return receipts.map(value=>({...value,configurationDigest}));
  }
}
