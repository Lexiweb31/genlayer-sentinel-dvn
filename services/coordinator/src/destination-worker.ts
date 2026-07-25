import type {Hex} from "../../../packages/core/src/types.js";
import type {DestinationConfirmationVerifier} from "./destination-verifier.js";
import type {DestinationPathVerifier} from "./destination-path-verifier.js";
import type {VerificationOutboxStore,OutboxRecord} from "./verification-outbox.js";

export interface DestinationAdapterSubmitter {used(digest:Hex):Promise<boolean>;submitVerification(envelope:OutboxRecord["envelope"],signatures:Hex[]):Promise<Hex>}
export interface ExecutionConfirmer {assertDeliveryReady(guid:string,signers:Hex[]):Promise<void>;confirmExecution(guid:string):Promise<void>}

export class DestinationWorker {
  constructor(
    private outbox:VerificationOutboxStore,
    private adapter:DestinationAdapterSubmitter,
    private verifier:DestinationConfirmationVerifier,
    private path:DestinationPathVerifier,
    private coordinator:ExecutionConfirmer,
    private report:(error:unknown)=>void,
    private clock=()=>Math.floor(Date.now()/1000)
  ){}

  async pollOnce():Promise<number>{
    let processed=0;
    for(const record of await this.outbox.list()){
      try{
        if(record.state==="READY"){processed++;await this.submit(record)}
        else if(record.state==="ATTEMPTING"){processed++;await this.outbox.transition(record.guid,"ATTEMPTING",{state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS",updatedAt:this.clock()})}
        else if(record.state==="SUBMITTED"){processed++;await this.confirm(record)}
        else if(record.state==="CONFIRMED")await this.coordinator.confirmExecution(record.guid);
      }catch(error){this.report(error)}
    }
    return processed;
  }

  private async submit(record:OutboxRecord):Promise<void>{
    const now=this.clock();
    if(record.envelope.expiry<=BigInt(now)){await this.outbox.transition(record.guid,"READY",{state:"FAILED",failureCode:"SIGNING_EXPIRED",updatedAt:now});return}
    try{await this.coordinator.assertDeliveryReady(record.guid,record.shares.map(share=>share.address))}catch{this.report(new Error("destination coordinator quorum unavailable"));return}
    try{await this.path.verify()}catch{this.report(new Error("destination pathway configuration unavailable"));return}
    let used:boolean;try{used=await this.adapter.used(record.digest)}catch{this.report(new Error("destination adapter state unavailable"));return}
    if(used){await this.outbox.transition(record.guid,"READY",{state:"RECOVERY_REQUIRED",failureCode:"USED_WITHOUT_RECEIPT",updatedAt:this.clock()});return}
    const submissionTime=this.clock();if(record.envelope.expiry<=BigInt(submissionTime)){await this.outbox.transition(record.guid,"READY",{state:"FAILED",failureCode:"SIGNING_EXPIRED",updatedAt:submissionTime});return}
    await this.outbox.transition(record.guid,"READY",{state:"ATTEMPTING",updatedAt:submissionTime});
    try{
      const transactionHash=await this.adapter.submitVerification(record.envelope,record.shares.map(share=>share.signature));
      await this.outbox.transition(record.guid,"ATTEMPTING",{state:"SUBMITTED",transactionHash,updatedAt:this.clock()});
    }catch{await this.outbox.transition(record.guid,"ATTEMPTING",{state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS",updatedAt:this.clock()})}
  }

  private async confirm(record:OutboxRecord):Promise<void>{
    const result=await this.verifier.confirm(record);
    if(result.status==="PENDING")return;
    if(result.status==="FAILED"){await this.outbox.transition(record.guid,"SUBMITTED",{state:"FAILED",failureCode:result.code,transactionHash:record.transactionHash,updatedAt:this.clock()});return}
    await this.outbox.transition(record.guid,"SUBMITTED",{state:"CONFIRMED",transactionHash:record.transactionHash,confirmations:result.confirmations,updatedAt:this.clock()});
    await this.coordinator.confirmExecution(record.guid);
  }
}
