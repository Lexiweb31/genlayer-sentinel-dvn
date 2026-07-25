import {pathToFileURL} from "node:url";
import type {Hex} from "../../../packages/core/src/types.js";
import {startLocalDemo,type LocalDemoOptions} from "./local-demo-harness.js";

export function parseLocalDemoArgs(args:string[]):LocalDemoOptions{
  let owner:string|undefined,port=4173,ownerSeen=false,portSeen=false;
  for(let index=0;index<args.length;index+=2){
    const flag=args[index],value=args[index+1];
    if(!flag||value===undefined)throw new Error("local demo arguments must be flag/value pairs");
    if(flag==="--owner"){
      if(ownerSeen)throw new Error("--owner may be specified once");
      ownerSeen=true;owner=value;
    }else if(flag==="--port"){
      if(portSeen)throw new Error("--port may be specified once");
      portSeen=true;
      if(!/^[0-9]+$/.test(value))throw new Error("--port must be an integer");
      port=Number(value);
      if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error("--port must be between 1 and 65535");
    }else throw new Error(`unsupported local demo argument ${flag}`);
  }
  if(!owner||!/^0x[0-9a-fA-F]{40}$/.test(owner)||/^0x0{40}$/i.test(owner))throw new Error("--owner requires one nonzero EVM address");
  return{owner:owner as Hex,appHost:"127.0.0.1",appPort:port,pollIntervalMs:500};
}

async function main():Promise<void>{
  const session=await startLocalDemo(parseLocalDemoArgs(process.argv.slice(2)));
  const owner=await session.sourceOApp.getFunction("owner")();
  console.log([
    "GenLayer Sentinel · LOCAL TEST",
    "Deployment: NOT DEPLOYED",
    "Semantic engine: LOCAL_POLICY_FIXTURE",
    `App: ${session.appUrl}`,
    `RPC: ${session.rpcUrl}`,
    "Chain ID: 31337",
    `Owner: ${owner}`,
    `Source OApp: ${session.capability.sourceOApp}`,
    `Action target: ${session.capability.authorizedTarget}`,
    `Approved argument: ${session.capability.approvedArgument}`,
    "Stop with Ctrl+C."
  ].join("\n"));
  let stopping:Promise<void>|undefined;
  const shutdown=():void=>{
    if(!stopping)stopping=session.stop().finally(()=>{process.exitCode=0});
  };
  process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
}

const entry=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(entry)void main().catch(error=>{console.error(error instanceof Error?error.message:"local demo failed");process.exitCode=1});
