import type {PublicDemoConfig} from "./wallet-action.js";
import {
  clearDemoSession,
  matchesDemoCapability,
  readDemoSession,
  type DemoSessionLocator,
  type StorageLike
} from "./demo-session.js";

export type DemoBootstrapResult=
  |{kind:"FRESH";config:PublicDemoConfig}
  |{kind:"RESUME";config:PublicDemoConfig;locator:DemoSessionLocator}
  |{kind:"RESTORED_UNAVAILABLE";locator:DemoSessionLocator}
  |{kind:"DISABLED"};

export async function resolveDemoBootstrap(
  storage:StorageLike|undefined,
  loadCapability:()=>Promise<PublicDemoConfig>
):Promise<DemoBootstrapResult>{
  const locator=readDemoSession(storage);
  let config:PublicDemoConfig;
  try{config=await loadCapability()}
  catch{return locator?{kind:"RESTORED_UNAVAILABLE",locator}:{kind:"DISABLED"}}
  if(locator){
    if(matchesDemoCapability(locator,config))return{kind:"RESUME",config,locator};
    clearDemoSession(storage);
  }
  return{kind:"FRESH",config};
}
