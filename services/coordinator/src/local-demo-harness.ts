import http from "node:http";
import {readFileSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {network} from "hardhat";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  type InterfaceAbi,
  type JsonRpcSigner,
  getBytes,
  id,
  parseEther,
  toQuantity,
  zeroPadValue
} from "ethers";
import type {Hex,PolicyResult} from "../../../packages/core/src/types.js";
import {Coordinator} from "./coordinator.js";
import {parseDemoCapability,type DemoCapability} from "./demo-capability.js";
import {DeliveryPlanner} from "./delivery-planner.js";
import {DestinationWorker} from "./destination-worker.js";
import {IngestionRunner,coordinatorPacketHandler} from "./ingestion.js";
import {SqliteJobStore} from "./job-store.js";
import {SqliteListenerStore} from "./listener-store.js";
import {JsonRpcLogSource,PacketFeeListener} from "./listener.js";
import {
  LOCAL_DEMO_EVIDENCE_URI,
  LocalDemoEvidenceSource,
  LocalDemoFinality,
  type LocalDemoAuthority
} from "./local-demo-policy.js";
import {
  LocalEdrDestinationVerifier,
  LocalEdrPacketVerifier,
  LocalEdrPathVerifier,
  LocalOAppExecutionConfirmer,
  type LocalDemoRpc
} from "./local-demo-proofs.js";
import {PolicyRequestFactory} from "./request-factory.js";
import {RecoveryService,recoveryFailurePolicy} from "./recovery-service.js";
import {SqliteRecoveryStore} from "./recovery-store.js";
import {IsolatedSignerService,type SigningEnvelope} from "./signing.js";
import {createDashboardServer} from "./status-api.js";
import {Uln302IntentFactory} from "./uln302-intent.js";
import {SqliteVerificationOutbox} from "./verification-outbox.js";

export interface LocalEvm {
  rpcUrl:string;
  provider:JsonRpcProvider;
  signers:JsonRpcSigner[];
  close():Promise<void>;
}

export interface LocalDemoOptions {
  owner:Hex;
  appHost:"127.0.0.1";
  appPort:number;
  pollIntervalMs:number;
}

export interface LocalDemoSession {
  appUrl:string;
  rpcUrl:string;
  capability:DemoCapability;
  provider:JsonRpcProvider;
  coordinator:Coordinator;
  outbox:SqliteVerificationOutbox;
  sourceOApp:Contract;
  destinationOApp:Contract;
  actionTarget:Contract;
  metrics:{signerCalls:number;destinationSubmissions:number};
  tickOnce():Promise<void>;
  restartCoordinator():Promise<void>;
  stop():Promise<void>;
}

interface LocalDemoPipeline {
  coordinator:Coordinator;
  outbox:SqliteVerificationOutbox;
  ingestion:IngestionRunner;
  planner:DeliveryPlanner;
  destinationWorker:DestinationWorker;
  port:number;
  close():Promise<void>;
}

const sourceEid=40161,destinationEid=40231;

export async function startLocalEvm(signerCount=12):Promise<LocalEvm>{
  if(!Number.isSafeInteger(signerCount)||signerCount<=0)throw new Error("local EVM signer count must be positive");
  const server=await network.createServer({network:"sentinelTest"},"127.0.0.1",0);
  let provider:JsonRpcProvider|undefined,closing:Promise<void>|undefined;
  try{
    const listening=await server.listen();
    provider=new JsonRpcProvider(`http://${listening.address}:${listening.port}`,31337,{staticNetwork:true});
    if((await provider.getNetwork()).chainId!==31337n)throw new Error("local EVM chain ID mismatch");
    const signers=await Promise.all(Array.from({length:signerCount},(_,index)=>provider!.getSigner(index)));
    const close=():Promise<void>=>{
      if(!closing)closing=(async()=>{
        provider!.destroy();
        const closed=server.afterClosed();
        await server.close();
        await closed;
      })();
      return closing;
    };
    return{rpcUrl:`http://${listening.address}:${listening.port}/`,provider,signers,close};
  }catch(error){
    provider?.destroy();
    const closed=server.afterClosed();
    await server.close();
    await closed;
    throw error;
  }
}

export async function startLocalDemo(rawOptions:LocalDemoOptions):Promise<LocalDemoSession>{
  const options=validateOptions(rawOptions);
  const cleanups:Array<()=>Promise<void>|void>=[],register=(cleanup:()=>Promise<void>|void)=>cleanups.push(cleanup);
  let stopped:Promise<void>|undefined,timer:NodeJS.Timeout|undefined,activeTick:Promise<void>|undefined,restarting:Promise<void>|undefined,shuttingDown=false,maintenance=false;
  try{
    const evm=await startLocalEvm(12);register(()=>evm.close());
    const rpc:LocalDemoRpc=(method,params)=>evm.provider.send(method,params);
    await rpc("hardhat_setBalance",[options.owner,toQuantity(parseEther("100"))]);
    const [deployer,sourceConfigurator,destinationOwner,targetOwner]=evm.signers;
    const sourceEndpoint=await deploy("MockEndpointV2",deployer!,sourceEid);
    const destinationEndpoint=await deploy("MockEndpointV2",deployer!,destinationEid);
    const sourceOApp=await deploy("TreasuryPolicyOApp",sourceConfigurator!,await sourceEndpoint.getAddress(),await sourceConfigurator!.getAddress());
    const destinationOApp=await deploy("TreasuryPolicyOApp",destinationOwner!,await destinationEndpoint.getAddress(),await destinationOwner!.getAddress());
    const actionTarget=await deploy("ActionTarget",targetOwner!);
    const verificationTarget=await deploy("MockVerificationTarget",deployer!);
    const signerRecords=await Promise.all(evm.signers.slice(5,10).map(async signer=>({signer,address:(await signer.getAddress()).toLowerCase() as Hex})));
    signerRecords.sort((left,right)=>left.address.localeCompare(right.address));
    const authorizedSigners=signerRecords.map(value=>value.address);
    const adapter=await deploy(
      "SentinelDVNAdapter",deployer!,await destinationEndpoint.getAddress(),await verificationTarget.getAddress(),
      destinationEid,authorizedSigners,3
    );
    const adapterAddress=(await adapter.getAddress()).toLowerCase() as Hex;
    await(await sourceEndpoint.connect(deployer!).getFunction("setOptionalDvn")(adapterAddress)).wait();
    await(await destinationEndpoint.connect(deployer!).getFunction("setOptionalDvn")(adapterAddress)).wait();
    const sourceAddress=(await sourceOApp.getAddress()).toLowerCase() as Hex,destinationAddress=(await destinationOApp.getAddress()).toLowerCase() as Hex;
    const targetAddress=(await actionTarget.getAddress()).toLowerCase() as Hex;
    const sourcePeer=zeroPadValue(sourceAddress,32).toLowerCase() as Hex,destinationPeer=zeroPadValue(destinationAddress,32).toLowerCase() as Hex;
    await(await sourceOApp.connect(sourceConfigurator!).getFunction("setPeer")(destinationEid,destinationPeer)).wait();
    await(await destinationOApp.connect(destinationOwner!).getFunction("setPeer")(sourceEid,sourcePeer)).wait();
    await(await sourceOApp.connect(sourceConfigurator!).getFunction("setAuthorizedTarget")(targetAddress,true)).wait();
    await(await destinationOApp.connect(destinationOwner!).getFunction("setAuthorizedTarget")(targetAddress,true)).wait();
    await(await sourceOApp.connect(sourceConfigurator!).getFunction("transferOwnership")(options.owner)).wait();

    const approvedRecordLabel="approved",approvedArgument=id(approvedRecordLabel).toLowerCase() as Hex;
    const approvedAuthorizationId=id("sentinel-local-demo-authorization").toLowerCase() as Hex;
    const actionSelector=id("record(bytes32)").slice(0,10).toLowerCase() as Hex;
    const approvedCalldata=`${actionSelector}${approvedArgument.slice(2)}` as Hex;
    const evidenceBody=JSON.stringify({
      authorizationId:approvedAuthorizationId,target:targetAddress,value:"0",selector:actionSelector,
      calldata:approvedCalldata,status:"AUTHORIZED",policyVersion:"local-demo-v1"
    });
    const authority:LocalDemoAuthority={
      authorizationId:approvedAuthorizationId,target:targetAddress,selector:actionSelector,
      approvedCalldata,policyVersion:"local-demo-v1",evidenceBody
    };
    const metrics={signerCalls:0,destinationSubmissions:0};
    const verificationTargetAddress=(await verificationTarget.getAddress()).toLowerCase() as Hex;
    const sourceEndpointAddress=(await sourceEndpoint.getAddress()).toLowerCase() as Hex;
    const destinationEndpointAddress=(await destinationEndpoint.getAddress()).toLowerCase() as Hex;
    const requiredFixtureDvn=(await evm.signers[10]!.getAddress()).toLowerCase() as Hex;
    const deliverySender=(await evm.signers[11]!.getAddress()).toLowerCase() as Hex;
    const directory=await mkdtemp(join(tmpdir(),"sentinel-local-demo-"));register(()=>rm(directory,{recursive:true,force:true}));
    const databasePath=join(directory,"sentinel.db");
    const capability=parseDemoCapability({
      mode:"LOCAL_WALLET_DEMO",chainId:"31337",chainName:"Sentinel Local",rpcUrl:evm.rpcUrl,
      sourceOApp:sourceAddress,sourceEndpoint:sourceEndpointAddress,
      destinationEid,authorizedTarget:targetAddress,actionSelector,actionSignature:"record(bytes32)",
      approvedRecordLabel,approvedArgument,approvedAuthorizationId,options:"0x",payInLzToken:false,
      semanticSource:"LOCAL_POLICY_FIXTURE"
    });

    const createPipeline=async(appPort:number):Promise<LocalDemoPipeline>=>{
      const owned:Array<()=>Promise<void>|void>=[],acquire=(cleanup:()=>Promise<void>|void)=>owned.push(cleanup);
      let pipelineClosed:Promise<void>|undefined;
      try{
        const jobStore=new SqliteJobStore(databasePath);acquire(()=>jobStore.close());
        const listenerStore=new SqliteListenerStore(databasePath);acquire(()=>listenerStore.close());
        const recoveryStore=new SqliteRecoveryStore(databasePath);acquire(()=>recoveryStore.close());
        const outbox=new SqliteVerificationOutbox(databasePath,authorizedSigners,3);acquire(()=>outbox.close());
        const finality=new LocalDemoFinality(authority);
        let coordinator:Coordinator;
        const signerServices=signerRecords.map(record=>new IsolatedSignerService(
          {address:record.address,signMessageDigest:async digest=>{metrics.signerCalls++;return await record.signer.signMessage(getBytes(digest)) as Hex}},
          {assertFinalized:async result=>{
            const requestId=coordinator?.requestIds.get(result.guid);
            if(!requestId)throw new Error("local signer finality binding unavailable");
            const finalized=await finality.finalized(requestId);
            if(!finalized||policyBinding(finalized)!==policyBinding(result))throw new Error("local signer finality binding mismatch");
          }},
          {chainId:31337n,adapter:adapterAddress,verificationTarget:verificationTargetAddress,maxTtlSeconds:120n}
        ));
        coordinator=new Coordinator(new LocalEdrPacketVerifier(rpc,sourceEndpointAddress,1n),finality,signerServices,3,1n,jobStore);
        const listener=new PacketFeeListener(
          new JsonRpcLogSource(evm.rpcUrl),sourceEndpointAddress,sourceEndpointAddress,
          1n,0n,64n,listenerStore,"local-wallet-demo"
        );
        const factory=new PolicyRequestFactory({
          srcEid:sourceEid,dstEid:destinationEid,sender:sourcePeer,receiver:destinationPeer,
          sendLibrary:sourceEndpointAddress,sentinelDvn:adapterAddress,
          evidenceUri:LOCAL_DEMO_EVIDENCE_URI,policy:"exact local governance authorization required",
          evidenceTtlSeconds:900,maximumEvidenceBytes:16_384
        },new LocalDemoEvidenceSource(evidenceBody));
        const recovery=new RecoveryService("local-wallet-demo",recoveryStore,listener);
        const ingestion=new IngestionRunner(listener,coordinatorPacketHandler(factory,coordinator),recoveryFailurePolicy("local-wallet-demo",recoveryStore,3));
        const pathVerifier=new LocalEdrPathVerifier(rpc,{
          chainId:31337n,srcEid:sourceEid,endpoint:destinationEndpointAddress,
          receiveLibrary:verificationTargetAddress,oapp:destinationAddress,adapter:adapterAddress,sourcePeer,
          confirmations:1n,requiredDvns:[requiredFixtureDvn],optionalDvns:[adapterAddress],
          optionalDvnThreshold:1,authorizedSigners,quorum:3
        });
        const planner=new DeliveryPlanner(coordinator,outbox,pathVerifier,new Uln302IntentFactory(120),authorizedSigners,()=>{});
        const submitter={
          async used(digest:Hex):Promise<boolean>{return Boolean(await adapter.getFunction("used")(digest))},
          async submitVerification(envelope:SigningEnvelope,signatures:Hex[]):Promise<Hex>{
            metrics.destinationSubmissions++;
            const transaction=await adapter.connect(evm.signers[11]!).getFunction("submitVerification")(
              envelope.guid,envelope.packetDigest,envelope.evidenceDigest,envelope.callData,envelope.expiry,signatures
            );
            return transaction.hash as Hex;
          }
        };
        const execution=new LocalOAppExecutionConfirmer(coordinator,rpc,{
          from:deliverySender,endpoint:destinationEndpointAddress,oapp:destinationAddress,actionTarget:targetAddress
        });
        const destinationWorker=new DestinationWorker(
          outbox,submitter,new LocalEdrDestinationVerifier(rpc,adapterAddress,1n),pathVerifier,execution,()=>{}
        );
        await coordinator.restore();await planner.reconcile();
        const server=createDashboardServer(coordinator,resolve("apps/dashboard"),recovery,outbox,{presentationMode:"LOCAL_TEST"},capability);
        acquire(()=>closeServer(server));
        await listen(server,appPort,options.appHost);
        const addressInfo=server.address();
        if(!addressInfo||typeof addressInfo==="string")throw new Error("local dashboard address unavailable");
        return{
          coordinator,outbox,ingestion,planner,destinationWorker,port:addressInfo.port,
          close:()=>{
            if(!pipelineClosed)pipelineClosed=cleanupAll(owned);
            return pipelineClosed;
          }
        };
      }catch(error){await cleanupAll(owned);throw error}
    };

    let pipeline=await createPipeline(options.appPort);register(()=>pipeline.close());
    const appUrl=`http://${options.appHost}:${pipeline.port}`;

    const runTick=async()=>{
      const current=pipeline;
      await rpc("evm_mine",[]);
      await current.ingestion.pollOnce();
      await current.coordinator.pollPending();
      await current.planner.pollOnce();
      await current.destinationWorker.pollOnce();
    };
    const tickOnce=():Promise<void>=>{
      if(shuttingDown)return Promise.reject(new Error("local demo is stopping or stopped"));
      if(maintenance)return Promise.reject(new Error("local demo coordinator is restarting"));
      if(!activeTick)activeTick=runTick().finally(()=>{activeTick=undefined});
      return activeTick;
    };
    const restartCoordinator=():Promise<void>=>{
      if(shuttingDown)return Promise.reject(new Error("local demo is stopping or stopped"));
      if(!restarting)restarting=(async()=>{
        maintenance=true;
        try{
          await activeTick;
          const prior=pipeline,port=prior.port;
          await prior.close();
          pipeline=await createPipeline(port);
        }finally{maintenance=false;restarting=undefined}
      })();
      return restarting;
    };
    timer=setInterval(()=>{void tickOnce().catch(()=>{})},options.pollIntervalMs);
    const stop=():Promise<void>=>{
      if(!stopped)stopped=(async()=>{
        shuttingDown=true;
        if(timer){clearInterval(timer);timer=undefined}
        await restarting;
        await activeTick;
        await cleanupAll(cleanups);
      })();
      return stopped;
    };
    return{
      appUrl,rpcUrl:evm.rpcUrl,capability,provider:evm.provider,
      get coordinator(){return pipeline.coordinator},
      get outbox(){return pipeline.outbox},
      sourceOApp,destinationOApp,actionTarget,metrics,tickOnce,restartCoordinator,stop
    };
  }catch(error){if(timer)clearInterval(timer);await cleanupAll(cleanups);throw error}
}

function validateOptions(value:LocalDemoOptions):LocalDemoOptions{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("local demo options are required");
  exactKeys(value as unknown as Record<string,unknown>,["owner","appHost","appPort","pollIntervalMs"]);
  if(typeof value.owner!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value.owner)||/^0x0{40}$/i.test(value.owner))throw new Error("invalid local demo owner");
  if(value.appHost!=="127.0.0.1")throw new Error("local demo app must bind to 127.0.0.1");
  if(!Number.isSafeInteger(value.appPort)||value.appPort<0||value.appPort>65535)throw new Error("invalid local demo app port");
  if(!Number.isSafeInteger(value.pollIntervalMs)||value.pollIntervalMs<=0)throw new Error("invalid local demo poll interval");
  return{owner:value.owner.toLowerCase() as Hex,appHost:"127.0.0.1",appPort:value.appPort,pollIntervalMs:value.pollIntervalMs};
}
function exactKeys(value:Record<string,unknown>,expected:string[]):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((item,index)=>item!==wanted[index]))throw new Error("local demo options have missing or unknown fields");
}
async function deploy(name:string,signer:JsonRpcSigner,...args:unknown[]):Promise<Contract>{
  const artifact=JSON.parse(readFileSync(`dist/contracts/${name}.json`,"utf8")) as{abi:InterfaceAbi;evm:{bytecode:{object:string}}};
  const contract=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy(...args);
  await contract.waitForDeployment();return contract as unknown as Contract;
}
function listen(server:http.Server,port:number,host:string):Promise<void>{
  return new Promise((resolveListen,reject)=>{
    const fail=(error:Error)=>reject(error);server.once("error",fail);
    server.listen(port,host,()=>{server.off("error",fail);resolveListen()});
  });
}
function closeServer(server:http.Server):Promise<void>{
  return new Promise((resolveClose,reject)=>{
    if(!server.listening){resolveClose();return}
    server.closeIdleConnections();
    server.close(error=>error?reject(error):resolveClose());
  });
}
async function cleanupAll(cleanups:Array<()=>Promise<void>|void>):Promise<void>{
  let first:unknown;
  while(cleanups.length){try{await cleanups.pop()!()}catch(error){first??=error}}
  if(first)throw first;
}
function policyBinding(value:PolicyResult):string{
  return JSON.stringify({...value,guid:value.guid.toLowerCase(),packetDigest:value.packetDigest.toLowerCase(),evidenceDigest:value.evidenceDigest.toLowerCase()});
}
