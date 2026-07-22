import type {DetectedPacket} from "./listener.js";
import type {Coordinator} from "./coordinator.js";
import type {PolicyRequestFactory} from "./request-factory.js";

export interface PacketInbox {poll():Promise<DetectedPacket[]>;acknowledge(transactionHash:DetectedPacket["transactionHash"]):Promise<void>;}
export type DurablePacketHandler=(packet:DetectedPacket)=>Promise<void>;

export class IngestionRunner {
  constructor(private inbox:PacketInbox,private handle:DurablePacketHandler){}
  async pollOnce():Promise<number>{const packets=await this.inbox.poll();let completed=0;for(const packet of packets){await this.handle(packet);await this.inbox.acknowledge(packet.transactionHash);completed++}return completed}
}
export function coordinatorPacketHandler(factory:PolicyRequestFactory,coordinator:Coordinator):DurablePacketHandler{return async packet=>{const request=await factory.create(packet);await coordinator.detect(request)}}
