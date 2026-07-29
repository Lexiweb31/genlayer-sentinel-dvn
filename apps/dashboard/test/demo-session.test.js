import test from "node:test";
import assert from "node:assert/strict";
import * as session from "../../../dist/apps/dashboard/src/demo-session.js";

const {readDemoSession,writeDemoSession}=session;

const config={
  mode:"LOCAL_WALLET_DEMO",
  chainId:31337n,
  chainName:"Sentinel Local",
  rpcUrl:"http://127.0.0.1:8545/",
  sourceOApp:"0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
  sourceEndpoint:"0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
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
const transactionHash=`0x${"Cc".repeat(32)}`;
const guid=`0x${"Dd".repeat(32)}`;

function memoryStorage(initial=[]){
  const values=new Map(initial);
  return{
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key),
    has:key=>values.has(key),
    value:key=>values.get(key)
  };
}

test("round trips one capability-bound public locator in canonical form",()=>{
  const storage=memoryStorage();

  assert.equal(writeDemoSession(storage,config,{transactionHash,guid}),true);
  assert.deepEqual(readDemoSession(storage),{
    version:1,
    chainId:"31337",
    sourceOApp:config.sourceOApp.toLowerCase(),
    sourceEndpoint:config.sourceEndpoint.toLowerCase(),
    destinationEid:40231,
    transactionHash:transactionHash.toLowerCase(),
    guid:guid.toLowerCase()
  });
});

test("removes malformed, oversized, injected, zero, and unsafe locators",()=>{
  const valid={
    version:1,
    chainId:"31337",
    sourceOApp:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceEndpoint:"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    destinationEid:40231,
    transactionHash:`0x${"c".repeat(64)}`,
    guid:`0x${"d".repeat(64)}`
  };
  const invalid=[
    "{",
    "x".repeat(1025),
    JSON.stringify({...valid,unexpected:"field"}),
    JSON.stringify({...valid,version:2}),
    JSON.stringify({...valid,chainId:"1"}),
    JSON.stringify({...valid,sourceOApp:`0x${"0".repeat(40)}`}),
    JSON.stringify({...valid,sourceEndpoint:`0x${"0".repeat(40)}`}),
    JSON.stringify({...valid,destinationEid:0}),
    JSON.stringify({...valid,destinationEid:Number.MAX_SAFE_INTEGER+1}),
    JSON.stringify({...valid,transactionHash:`0x${"0".repeat(64)}`}),
    JSON.stringify({...valid,guid:"0x1234"})
  ];

  for(const value of invalid){
    const storage=memoryStorage([[session.DEMO_SESSION_KEY,value]]);
    assert.equal(readDemoSession(storage),undefined);
    assert.equal(storage.has(session.DEMO_SESSION_KEY),false);
  }
});

test("fails safely when browser storage is absent or throws",()=>{
  const throwing={
    getItem(){throw new Error("blocked")},
    setItem(){throw new Error("blocked")},
    removeItem(){throw new Error("blocked")}
  };

  assert.equal(readDemoSession(undefined),undefined);
  assert.equal(readDemoSession(throwing),undefined);
  assert.equal(writeDemoSession(undefined,config,{transactionHash,guid}),false);
  assert.equal(writeDemoSession(throwing,config,{transactionHash,guid}),false);
  assert.equal(typeof session.clearDemoSession,"function");
  assert.doesNotThrow(()=>session.clearDemoSession(throwing));
});

test("matches only the exact public harness binding",()=>{
  const storage=memoryStorage();
  assert.equal(writeDemoSession(storage,config,{transactionHash,guid}),true);
  const locator=readDemoSession(storage);
  assert.ok(locator);
  assert.equal(typeof session.matchesDemoCapability,"function");
  assert.equal(session.matchesDemoCapability(locator,config),true);

  for(const changed of [
    {...config,chainId:1n},
    {...config,sourceOApp:"0xcccccccccccccccccccccccccccccccccccccccc"},
    {...config,sourceEndpoint:"0xdddddddddddddddddddddddddddddddddddddddd"},
    {...config,destinationEid:40161}
  ])assert.equal(session.matchesDemoCapability(locator,changed),false);
});

test("refuses to persist an invalid public locator",()=>{
  const storage=memoryStorage();

  assert.equal(
    writeDemoSession(storage,{...config,destinationEid:0},{transactionHash,guid}),
    false
  );
  assert.equal(storage.has(session.DEMO_SESSION_KEY),false);
});
