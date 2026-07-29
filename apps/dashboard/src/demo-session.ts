import type {Hex} from "../../../packages/core/src/types.js";
import type {PublicDemoConfig} from "./wallet-action.js";

export const DEMO_SESSION_KEY="genlayer-sentinel.local-action.v1";

export interface StorageLike {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}

export interface DemoSessionLocator {
  version:1;
  chainId:"31337";
  sourceOApp:Hex;
  sourceEndpoint:Hex;
  destinationEid:number;
  transactionHash:Hex;
  guid:Hex;
}

export function readDemoSession(storage:StorageLike|undefined):DemoSessionLocator|undefined {
  if(!storage)return undefined;
  try{
    const value=storage.getItem(DEMO_SESSION_KEY);
    if(value===null)return undefined;
    if(value.length>1024)throw new Error();
    return parseLocator(JSON.parse(value));
  }catch{
    clearDemoSession(storage);
    return undefined;
  }
}

export function writeDemoSession(
  storage:StorageLike|undefined,
  config:PublicDemoConfig,
  submission:{transactionHash:string;guid:string}
):boolean {
  if(!storage)return false;
  try{
    if(config.chainId!==31337n)throw new Error();
    const locator=parseLocator({
      version:1,
      chainId:"31337",
      sourceOApp:config.sourceOApp,
      sourceEndpoint:config.sourceEndpoint,
      destinationEid:config.destinationEid,
      transactionHash:submission.transactionHash,
      guid:submission.guid
    });
    storage.setItem(DEMO_SESSION_KEY,JSON.stringify(locator));
    return true;
  }catch{return false}
}

export function clearDemoSession(storage:StorageLike|undefined):void {
  if(!storage)return;
  try{storage.removeItem(DEMO_SESSION_KEY)}catch{}
}

export function matchesDemoCapability(locator:DemoSessionLocator,config:PublicDemoConfig):boolean {
  return config.chainId===31337n&&
    typeof config.sourceOApp==="string"&&locator.sourceOApp===config.sourceOApp.toLowerCase()&&
    typeof config.sourceEndpoint==="string"&&locator.sourceEndpoint===config.sourceEndpoint.toLowerCase()&&
    locator.destinationEid===config.destinationEid;
}

const locatorKeys=[
  "version","chainId","sourceOApp","sourceEndpoint",
  "destinationEid","transactionHash","guid"
].sort();

function parseLocator(value:unknown):DemoSessionLocator {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();
  const record=value as Record<string,unknown>;
  const keys=Object.keys(record).sort();
  if(keys.length!==locatorKeys.length||keys.some((key,index)=>key!==locatorKeys[index]))throw new Error();
  if(record.version!==1||record.chainId!=="31337")throw new Error();
  return{
    version:1,
    chainId:"31337",
    sourceOApp:address(record.sourceOApp),
    sourceEndpoint:address(record.sourceEndpoint),
    destinationEid:positiveSafeInteger(record.destinationEid),
    transactionHash:hash(record.transactionHash),
    guid:hash(record.guid)
  };
}

function address(value:unknown):Hex {
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw new Error();
  return value.toLowerCase() as Hex;
}

function hash(value:unknown):Hex {
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/i.test(value))throw new Error();
  return value.toLowerCase() as Hex;
}

function positiveSafeInteger(value:unknown):number {
  if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error();
  return Number(value);
}
