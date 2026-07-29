import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_SESSION_KEY,
  readDemoSession,
  writeDemoSession
} from "../../../dist/apps/dashboard/src/demo-session.js";

let bootstrapModule={};
try{bootstrapModule=await import("../../../dist/apps/dashboard/src/demo-bootstrap.js")}catch{}

const config={
  mode:"LOCAL_WALLET_DEMO",
  chainId:31337n,
  chainName:"Sentinel Local",
  rpcUrl:"http://127.0.0.1:8545/",
  sourceOApp:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sourceEndpoint:"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  destinationEid:40231,
  authorizedTarget:"0x3333333333333333333333333333333333333333",
  actionSelector:"0xb5c645bd",
  actionSignature:"record(bytes32)",
  approvedRecordLabel:"approved",
  approvedArgument:`0x${"4".repeat(64)}`,
  approvedAuthorizationId:`0x${"5".repeat(64)}`,
  options:"0x",
  payInLzToken:false,
  semanticSource:"LOCAL_POLICY_FIXTURE"
};
const transactionHash=`0x${"6".repeat(64)}`;
const guid=`0x${"7".repeat(64)}`;

function memoryStorage(){
  const values=new Map();
  return{
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key),
    has:key=>values.has(key)
  };
}

test("returns fresh or matched-resume state from the same read-only capability loader",async()=>{
  assert.equal(typeof bootstrapModule.resolveDemoBootstrap,"function");
  const storage=memoryStorage();
  let capabilityReads=0;
  const load=async()=>{capabilityReads++;return config};

  assert.deepEqual(
    await bootstrapModule.resolveDemoBootstrap(storage,load),
    {kind:"FRESH",config}
  );
  assert.equal(writeDemoSession(storage,config,{transactionHash,guid}),true);
  const locator=readDemoSession(storage);
  assert.ok(locator);
  assert.deepEqual(
    await bootstrapModule.resolveDemoBootstrap(storage,load),
    {kind:"RESUME",config,locator}
  );
  assert.equal(capabilityReads,2);
  assert.equal(storage.has(DEMO_SESSION_KEY),true);
});

test("retains a valid locator when capability verification is unavailable",async()=>{
  const storage=memoryStorage();
  assert.equal(writeDemoSession(storage,config,{transactionHash,guid}),true);
  const locator=readDemoSession(storage);
  assert.ok(locator);
  let result="capability rejection escaped";
  try{
    result=await bootstrapModule.resolveDemoBootstrap(
      storage,
      async()=>{throw new Error("offline")}
    );
  }catch{}

  assert.deepEqual(result,{kind:"RESTORED_UNAVAILABLE",locator});
  assert.deepEqual(readDemoSession(storage),locator);
});

test("returns disabled when capability verification fails without a locator",async()=>{
  const storage=memoryStorage();
  let result="capability rejection escaped";
  try{
    result=await bootstrapModule.resolveDemoBootstrap(
      storage,
      async()=>{throw new Error("offline")}
    );
  }catch{}

  assert.deepEqual(result,{kind:"DISABLED"});
});

test("clears an old locator only after a validated harness mismatch",async()=>{
  const storage=memoryStorage();
  assert.equal(writeDemoSession(storage,config,{transactionHash,guid}),true);
  const changed={
    ...config,
    sourceOApp:"0xcccccccccccccccccccccccccccccccccccccccc"
  };

  assert.deepEqual(
    await bootstrapModule.resolveDemoBootstrap(storage,async()=>changed),
    {kind:"FRESH",config:changed}
  );
  assert.equal(storage.has(DEMO_SESSION_KEY),false);
});

test("degrades to a fresh capability when browser storage is inaccessible",async()=>{
  const throwing={
    getItem(){throw new Error("blocked")},
    setItem(){throw new Error("blocked")},
    removeItem(){throw new Error("blocked")}
  };

  assert.deepEqual(
    await bootstrapModule.resolveDemoBootstrap(throwing,async()=>config),
    {kind:"FRESH",config}
  );
});
