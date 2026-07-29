import{
  RuntimeObservation,
  type LiveRuntimeStatus,
  type RuntimeFailureCode,
  type RuntimePhase
}from"./runtime-observation.js";

export interface RuntimeDependencies {restore():Promise<void>;ingest():Promise<void>;pollFinality():Promise<void>;planDeliveries():Promise<void>;deliver():Promise<void>;listen():Promise<void>;claimLease():Promise<void>;heartbeatLease():Promise<void>;releaseLease():Promise<void>;closeServer():Promise<void>;closeStores():void;report(error:unknown):void;intervalMs:number;schedule?(task:()=>Promise<void>,intervalMs:number):()=>void;}
export interface RuntimeStatus {started:boolean;stopping:boolean;tickActive:boolean;}
export class SentinelRuntime {
  private started=false;private stopping=false;private tick?:Promise<void>;private cancel?:()=>void;private closed=false;private leaseClaimed=false;
  constructor(private dependencies:RuntimeDependencies,private observation=new RuntimeObservation("LEASED")){if(!Number.isSafeInteger(dependencies.intervalMs)||dependencies.intervalMs<=0)throw new Error("runtime interval must be positive")}
  get status():RuntimeStatus{return{started:this.started,stopping:this.stopping,tickActive:!!this.tick}}
  runtimeStatus():LiveRuntimeStatus{return this.observation.runtimeStatus()}
  async start():Promise<void>{if(this.started)return;try{this.observation.markStarting();await this.dependencies.restore();await this.dependencies.listen();await this.dependencies.claimLease();this.leaseClaimed=true;this.observation.markRunning();this.started=true;const schedule=this.dependencies.schedule??defaultSchedule;this.cancel=schedule(()=>this.runTick(),this.dependencies.intervalMs)}catch(error){await this.close();throw error}}
  async stop():Promise<void>{if(this.stopping)return this.tick;if(!this.started&&this.closed)return;this.stopping=true;this.observation.markStopping();this.cancel?.();try{await this.tick;await this.close()}finally{this.started=false;this.stopping=false}}
  private runTick():Promise<void>{if(this.tick||!this.started||this.stopping||this.observation.runtimeStatus().lifecycle==="OWNERSHIP_LOST")return this.tick??Promise.resolve();const work=this.executeObservedTick();this.tick=work.finally(()=>{this.tick=undefined});return this.tick}
  private async executeObservedTick():Promise<void>{
    let failureCode:RuntimeFailureCode|undefined,leaseLost=false,phase:RuntimePhase="HEARTBEAT_BEFORE";
    this.observation.beginTick("HEARTBEAT_BEFORE");
    try{
      try{await this.dependencies.heartbeatLease();this.observation.recordHeartbeat()}
      catch(error){failureCode="LEASE_HEARTBEAT_FAILED";leaseLost=true;this.dependencies.report(error);return}
      try{
        phase="INGESTION";this.observation.enterPhase(phase);await this.dependencies.ingest();
        phase="POLICY_FINALITY";this.observation.enterPhase(phase);await this.dependencies.pollFinality();
        phase="DELIVERY_PLANNING";this.observation.enterPhase(phase);await this.dependencies.planDeliveries();
        phase="DESTINATION_DELIVERY";this.observation.enterPhase(phase);await this.dependencies.deliver();
      }catch(error){failureCode=failureForPhase(phase);this.dependencies.report(error)}
    }finally{
      this.observation.enterPhase("HEARTBEAT_AFTER");
      try{
        await this.dependencies.heartbeatLease();
        if(!leaseLost)this.observation.recordHeartbeat();
      }catch(error){
        failureCode??="LEASE_HEARTBEAT_FAILED";
        leaseLost=true;
        this.dependencies.report(error);
      }
      this.observation.finishTick(failureCode,leaseLost);
    }
  }
  private async close():Promise<void>{if(this.closed)return;this.closed=true;try{await this.dependencies.closeServer()}finally{try{if(this.leaseClaimed){await this.dependencies.releaseLease();this.leaseClaimed=false}}finally{this.dependencies.closeStores()}}}
}
function failureForPhase(phase:RuntimePhase):RuntimeFailureCode{
  if(phase==="INGESTION")return"INGESTION_FAILED";
  if(phase==="POLICY_FINALITY")return"POLICY_FINALITY_FAILED";
  if(phase==="DELIVERY_PLANNING")return"DELIVERY_PLANNING_FAILED";
  if(phase==="DESTINATION_DELIVERY")return"DESTINATION_DELIVERY_FAILED";
  return"LEASE_HEARTBEAT_FAILED";
}
function defaultSchedule(task:()=>Promise<void>,intervalMs:number):()=>void{const timer=setInterval(()=>{void task()},intervalMs);return()=>clearInterval(timer)}
