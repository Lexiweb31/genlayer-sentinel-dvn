import type {Hex,PolicyResult} from "../../../packages/core/src/types.js";
import type {Coordinator} from "./coordinator.js";
import type {DestinationPathVerifier} from "./destination-path-verifier.js";
import type {Uln302IntentFactory} from "./uln302-intent.js";
import type {OutboxRecord,VerificationOutboxStore} from "./verification-outbox.js";

export class DeliveryPlanner {
  constructor(
    private coordinator:Coordinator,
    private outbox:VerificationOutboxStore,
    private path:DestinationPathVerifier,
    private intents:Uln302IntentFactory,
    private authorized:Hex[],
    private report:(error:unknown)=>void,
    private clock=()=>Math.floor(Date.now()/1000)
  ){}

  async reconcile():Promise<void>{
    const records=new Map((await this.outbox.list()).map(record=>[record.guid.toLowerCase(),record]));
    for(const[guid,job]of this.sortedJobs()){
      const record=records.get(guid.toLowerCase());
      if(record){this.assertBinding(guid,job.snapshot.result,record);records.delete(guid.toLowerCase())}
      const stage=job.snapshot.stage;
      if(stage==="REJECTED"&&record)throw new Error("rejected job has a delivery record");
      if(stage==="QUORUM_REACHED"&&(!record||record.state==="SIGNING"||record.shares.length!==this.authorizedQuorum()))throw new Error("quorum job has no durable shares");
      if(stage==="POLICY_FINALIZED"&&record&&!(["SIGNING","READY","FAILED"] as string[]).includes(record.state))throw new Error("policy job has impossible delivery state");
      if((["DETECTED","CONFIRMED","POLICY_PENDING"] as string[]).includes(stage)&&record)throw new Error("pre-finality job has a delivery record");
      if((["VERIFIED","EXECUTED"] as string[]).includes(stage)&&record?.state!=="CONFIRMED")throw new Error("executed job lacks confirmed delivery");
    }
    if(records.size)throw new Error("delivery record has no coordinator job");
  }

  async pollOnce():Promise<number>{
    let processed=0;
    for(const[guid,job]of this.sortedJobs()){
      if(job.snapshot.stage!=="POLICY_FINALIZED")continue;
      processed++;
      try{await this.process(guid,job.snapshot.result)}catch(error){this.report(error)}
    }
    return processed;
  }

  private async process(guid:string,result:PolicyResult|undefined):Promise<void>{
    const request=this.coordinator.requests.get(guid);if(!request||!result)throw new Error("finalized job is missing its durable policy binding");
    const now=this.clock();let record=await this.outbox.get(guid as Hex);
    if(!record){const path=await this.path.verify(),envelope=this.intents.create(request,result,path,now);record=await this.outbox.plan(guid as Hex,envelope,now)}
    this.assertBinding(guid,result,record);
    if(record.state==="SIGNING"){
      if(record.envelope.expiry<=BigInt(now)){await this.outbox.transition(guid as Hex,"SIGNING",{state:"FAILED",failureCode:"SIGNING_EXPIRED",updatedAt:now});return}
      const shares=await this.coordinator.collectAuthorization(guid,record.envelope,this.authorized);record=await this.outbox.recordQuorum(guid as Hex,shares,now);
    }
    if(record.state==="READY")await this.coordinator.recordQuorum(guid,record.shares.map(share=>share.address));
    else if(record.state!=="FAILED")throw new Error("policy job has impossible delivery state");
  }

  private assertBinding(guid:string,result:PolicyResult|undefined,record:OutboxRecord):void{
    if(!result||!same(record.guid,guid)||!same(record.envelope.guid,guid)||!same(record.envelope.packetDigest,result.packetDigest)||!same(record.envelope.evidenceDigest,result.evidenceDigest))throw new Error("delivery record policy binding mismatch");
  }
  private sortedJobs(){return[...this.coordinator.jobs.entries()].sort(([left],[right])=>left.toLowerCase().localeCompare(right.toLowerCase()))}
  private authorizedQuorum():number{return 3}
}

function same(left:string,right:string):boolean{return left.toLowerCase()===right.toLowerCase()}
