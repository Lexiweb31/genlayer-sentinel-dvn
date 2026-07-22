import type {RuntimeConfig} from "./runtime-config.js";
import {SqliteJobStore} from "./job-store.js";
import {SqliteListenerStore} from "./listener-store.js";
import {IndependentRpcPacketVerifier} from "./rpc-verifier.js";
import {GenLayerRpcFinality,type GenLayerContractClient} from "./genlayer-finality.js";
import {JsonRpcGenLayerStatusReader} from "./genlayer-status-reader.js";
import {Coordinator} from "./coordinator.js";
import {JsonRpcLogSource,PacketFeeListener} from "./listener.js";
import {HttpsEvidenceSource,PolicyRequestFactory} from "./request-factory.js";
import {coordinatorPacketHandler,IngestionRunner} from "./ingestion.js";
import {createDashboardServer} from "./status-api.js";
import {SentinelRuntime} from "./runtime.js";
import {SqliteRecoveryStore} from "./recovery-store.js";
import {RecoveryService,recoveryFailurePolicy} from "./recovery-service.js";
import {IndependentDestinationPathVerifier,type DestinationPathRpc} from "./destination-path-verifier.js";
import {IndependentDestinationVerifier} from "./destination-verifier.js";
import {DestinationWorker,type DestinationAdapterSubmitter} from "./destination-worker.js";
import {DeliveryPlanner} from "./delivery-planner.js";
import {Uln302IntentFactory} from "./uln302-intent.js";
import {SqliteVerificationOutbox} from "./verification-outbox.js";
import type {SignerService} from "./signing.js";

export interface RuntimeCapabilities {
  genlayer:GenLayerContractClient;
  signers:SignerService[];
  destinationSubmitter:DestinationAdapterSubmitter;
  destinationRpc:DestinationPathRpc;
  presentationMode:"LOCAL_TEST"|"EXTERNAL_INJECTED";
}
export interface ComposedRuntime {runtime:SentinelRuntime;coordinator:Coordinator;recovery:RecoveryService;outbox:SqliteVerificationOutbox;planner:DeliveryPlanner;destinationWorker:DestinationWorker}
type DashboardServer=ReturnType<typeof createDashboardServer>;
export interface SocketLifecycle {listen(server:DashboardServer,port:number,host:string):Promise<void>;close(server:DashboardServer):Promise<void>}
const sockets:SocketLifecycle={listen:(server,port,host)=>new Promise((resolve,reject)=>{const fail=(error:Error)=>reject(error);server.once("error",fail);server.listen(port,host,()=>{server.off("error",fail);resolve()})}),close:server=>new Promise((resolve,reject)=>{if(!server.listening){resolve();return}server.close(error=>error?reject(error):resolve())})};

export function composeRuntime(config:RuntimeConfig,capabilities:RuntimeCapabilities,dashboardRoot:string,report:(error:unknown)=>void=console.error,socket:SocketLifecycle=sockets):ComposedRuntime {
  assertSignerIdentities(config,capabilities);
  const pathVerifier=new IndependentDestinationPathVerifier(config.destination,capabilities.destinationRpc);
  const receiptVerifier=new IndependentDestinationVerifier(config.destination.rpcUrls,config.destination.adapter,config.destination.confirmations,capabilities.destinationRpc);
  const jobStore=new SqliteJobStore(config.storage.sqlitePath),listenerStore=new SqliteListenerStore(config.storage.sqlitePath),recoveryStore=new SqliteRecoveryStore(config.storage.sqlitePath),outbox=new SqliteVerificationOutbox(config.storage.sqlitePath,config.destination.authorizedSigners,config.destination.quorum);
  const statusReader=new JsonRpcGenLayerStatusReader(config.genlayer.endpoint),finality=new GenLayerRpcFinality(capabilities.genlayer,statusReader,config.genlayer.policyContract),verifier=new IndependentRpcPacketVerifier(config.pathway.rpcUrls,config.pathway.endpoint,config.pathway.confirmations),coordinator=new Coordinator(verifier,finality,capabilities.signers,config.destination.quorum,config.pathway.confirmations,jobStore);
  const listener=new PacketFeeListener(new JsonRpcLogSource(config.pathway.rpcUrls[0]!),config.pathway.endpoint,config.pathway.sendLibrary,config.pathway.confirmations,config.pathway.startBlock,64n,listenerStore,config.pathway.name);
  const factory=new PolicyRequestFactory({srcEid:config.pathway.srcEid,dstEid:config.pathway.dstEid,sender:config.pathway.sourceOApp,receiver:config.pathway.destinationOApp,sendLibrary:config.pathway.sendLibrary,sentinelDvn:config.pathway.sentinelDvn,evidenceUri:config.evidence.uri,policy:config.evidence.policy,evidenceTtlSeconds:config.evidence.ttlSeconds,maximumEvidenceBytes:config.evidence.maximumBytes},new HttpsEvidenceSource([config.evidence.allowedHost]));
  const recovery=new RecoveryService(config.pathway.name,recoveryStore,listener),ingestion=new IngestionRunner(listener,coordinatorPacketHandler(factory,coordinator),recoveryFailurePolicy(config.pathway.name,recoveryStore,config.runtime.maxIngestionAttempts));
  const planner=new DeliveryPlanner(coordinator,outbox,pathVerifier,new Uln302IntentFactory(config.destination.signatureTtlSeconds),config.destination.authorizedSigners,report);
  const destinationWorker=new DestinationWorker(outbox,capabilities.destinationSubmitter,receiptVerifier,pathVerifier,coordinator,report);
  const server=createDashboardServer(coordinator,dashboardRoot,recovery,outbox,{presentationMode:capabilities.presentationMode});
  const runtime=new SentinelRuntime({
    restore:async()=>{await coordinator.restore();await planner.reconcile()},
    ingest:async()=>{await ingestion.pollOnce()},
    pollFinality:async()=>{await coordinator.pollPending()},
    planDeliveries:async()=>{await planner.pollOnce()},
    deliver:async()=>{await destinationWorker.pollOnce()},
    listen:()=>socket.listen(server,config.status.port,config.status.host),
    closeServer:()=>socket.close(server),
    closeStores:()=>{outbox.close();recoveryStore.close();listenerStore.close();jobStore.close()},
    report,
    intervalMs:config.runtime.pollIntervalMs
  });
  return{runtime,coordinator,recovery,outbox,planner,destinationWorker};
}

function assertSignerIdentities(config:RuntimeConfig,capabilities:RuntimeCapabilities):void {
  if(capabilities.presentationMode!=="LOCAL_TEST"&&capabilities.presentationMode!=="EXTERNAL_INJECTED")throw new Error("invalid runtime presentation mode");
  const actual=capabilities.signers.map(signer=>signer.address.toLowerCase()),expected=config.destination.authorizedSigners.map(address=>address.toLowerCase());
  if(actual.length!==5||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error("runtime signer identities do not match the manifest");
}
