import{randomBytes}from"node:crypto";
import{readFile}from"node:fs/promises";
import{isAbsolute}from"node:path";
import{hexlify}from"ethers";
import type{Hex}from"../../../packages/core/src/types.js";
import{IndependentDestinationPathVerifier}from"./destination-path-verifier.js";
import{IndependentDestinationVerifier}from"./destination-verifier.js";
import{PacketFeeListener,JsonRpcLogSource}from"./listener.js";
import{SqliteListenerStore}from"./listener-store.js";
import{safeJsonRpc}from"./json-rpc.js";
import{OperatorRecoveryService,RecoveryError}from"./operator-recovery.js";
import{SqliteRecoveryStore}from"./recovery-store.js";
import{IndependentRpcPacketVerifier}from"./rpc-verifier.js";
import{parseRuntimeConfig,type RuntimeConfig}from"./runtime-config.js";
import{SqliteRuntimeLease}from"./runtime-lease.js";
import{SourceBoundPacketVerifier}from"./source-bound-packet-verifier.js";
import{IndependentSourcePathVerifier}from"./source-path-verifier.js";
import{SqliteVerificationOutbox}from"./verification-outbox.js";

type RecoveryServicePort=Pick<OperatorRecoveryService,"prepareIngestion"|"prepareDestination"|"apply">;
export interface RecoveryCommandSession {service:RecoveryServicePort;close():void}
export interface RecoveryCommandDependencies {
  readText(path:string):Promise<string>;
  parseConfig(value:unknown):RuntimeConfig;
  open(config:RuntimeConfig):RecoveryCommandSession;
}
interface RecoveryIo {stdout(value:string):void;stderr(value:string):void}
type ParsedCommand=
  {kind:"PREPARE_INGESTION";manifest:string;transaction:Hex}|
  {kind:"PREPARE_DESTINATION";manifest:string;guid:Hex;transaction:Hex}|
  {kind:"APPLY";manifest:string;bundle:string};

const defaults:RecoveryCommandDependencies={readText:path=>readFile(path,"utf8"),parseConfig:parseRuntimeConfig,open:openRecoverySession};

export async function runRecoveryCommand(args:string[],io:RecoveryIo,dependencies:RecoveryCommandDependencies=defaults):Promise<number>{
  let command:ParsedCommand;
  try{command=parseCommand(args)}catch{io.stderr(json({error:"RECOVERY_CLI_USAGE"}));return 2}
  let config:RuntimeConfig;
  try{config=dependencies.parseConfig(JSON.parse(await dependencies.readText(command.manifest)))}catch{io.stderr(json({error:"RECOVERY_CLI_INPUT"}));return 1}
  let session:RecoveryCommandSession;
  try{session=dependencies.open(config)}catch{io.stderr(json({error:"RECOVERY_CLI_FAILED"}));return 1}
  let output:unknown,errorCode:string|undefined;
  try{
    if(command.kind==="PREPARE_INGESTION")output=await session.service.prepareIngestion(command.transaction);
    else if(command.kind==="PREPARE_DESTINATION")output=await session.service.prepareDestination(command.guid,command.transaction);
    else{
      let bundle:unknown;
      try{bundle=JSON.parse(await dependencies.readText(command.bundle))}catch{throw new CliInputError()}
      output=await session.service.apply(bundle);
    }
  }catch(error){errorCode=error instanceof CliInputError?"RECOVERY_CLI_INPUT":error instanceof RecoveryError?error.code:"RECOVERY_CLI_FAILED"}
  try{session.close()}catch{errorCode="RECOVERY_CLI_FAILED"}
  if(errorCode){io.stderr(json({error:errorCode}));return 1}
  io.stdout(json(output));return 0;
}

class CliInputError extends Error{}
function parseCommand(args:string[]):ParsedCommand{
  if(args[0]==="prepare"&&args[1]==="ingestion"&&args.length===6&&args[2]==="--manifest"&&args[4]==="--transaction"){
    return{kind:"PREPARE_INGESTION",manifest:absolute(args[3]),transaction:hash(args[5])};
  }
  if(args[0]==="prepare"&&args[1]==="destination"&&args.length===8&&args[2]==="--manifest"&&args[4]==="--guid"&&args[6]==="--transaction"){
    return{kind:"PREPARE_DESTINATION",manifest:absolute(args[3]),guid:hash(args[5]),transaction:hash(args[7])};
  }
  if(args[0]==="apply"&&args.length===5&&args[1]==="--manifest"&&args[3]==="--bundle"){
    return{kind:"APPLY",manifest:absolute(args[2]),bundle:absolute(args[4])};
  }
  throw new Error();
}
function absolute(value:string|undefined):string{if(!value||!isAbsolute(value)||value.includes("\0"))throw new Error();return value}
function hash(value:string|undefined):Hex{if(!value||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();return value.toLowerCase() as Hex}
function json(value:unknown):string{return`${JSON.stringify(value,(_,item)=>typeof item==="bigint"?item.toString():item)}\n`}

function openRecoverySession(config:RuntimeConfig):RecoveryCommandSession{
  const owned:Array<{close():void}>=[],acquire=<T extends{close():void}>(resource:T):T=>{owned.push(resource);return resource};
  try{
    const listenerStore=acquire(new SqliteListenerStore(config.storage.sqlitePath));
    const recoveryStore=acquire(new SqliteRecoveryStore(config.storage.sqlitePath));
    const outbox=acquire(new SqliteVerificationOutbox(config.storage.sqlitePath,config.destination.authorizedSigners,config.destination.quorum));
    const lease=acquire(new SqliteRuntimeLease(config.storage.sqlitePath,Math.max(60,Math.ceil(config.runtime.pollIntervalMs/1000)*3)));
    const listener=new PacketFeeListener(new JsonRpcLogSource(config.pathway.rpcUrls[0]!),config.pathway.endpoint,config.pathway.sendLibrary,config.pathway.confirmations,config.pathway.startBlock,64n,listenerStore,config.pathway.name);
    const sourceVerifier=new SourceBoundPacketVerifier(
      new IndependentRpcPacketVerifier(config.pathway.rpcUrls,config.pathway.endpoint,config.pathway.confirmations,safeJsonRpc),
      new IndependentSourcePathVerifier(config.pathway,safeJsonRpc)
    );
    const destinationPath=new IndependentDestinationPathVerifier(config.destination,safeJsonRpc);
    const destinationVerifier=new IndependentDestinationVerifier(config.destination.rpcUrls,config.destination.adapter,config.destination.confirmations,safeJsonRpc);
    const service=new OperatorRecoveryService({
      config,recoveryStore,inbox:listener,outbox,sourceVerifier,destinationPath,destinationVerifier,lease,
      now:()=>Math.floor(Date.now()/1000),nonce:()=>hexlify(randomBytes(32)) as Hex
    });
    return{service,close:()=>closeOwned(owned)};
  }catch(error){try{closeOwned(owned)}catch{}throw error}
}
function closeOwned(owned:Array<{close():void}>):void{let first:unknown;while(owned.length){try{owned.pop()!.close()}catch(error){first??=error}}if(first)throw first}
