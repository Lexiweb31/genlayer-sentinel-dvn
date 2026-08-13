import test from "node:test";
import assert from "node:assert/strict";
import {id,Interface} from "ethers";

const transactionHash=`0x${"6".repeat(64)}`;
const guid=`0x${"7".repeat(64)}`;
const storageKey="genlayer-sentinel.local-action.v1";
const localRuntimeStatus={
  version:1,
  observedAt:100,
  lifecycle:"RUNNING",
  lease:"NOT_APPLICABLE_LOCAL_FIXTURE",
  recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION",
  tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
};

class FakeElement {
  constructor(){
    this.dataset={};
    this.disabled=false;
    this.hidden=false;
    this.value="";
    this.textContent="";
    this.className="";
    this.title="";
    this.listeners=new Map();
    this.children=[];
  }
  addEventListener(type,listener){this.listeners.set(type,listener)}
  append(...values){this.children.push(...values)}
  replaceChildren(...values){this.children=[...values]}
  setAttribute(name,value){this[name]=String(value)}
}

class FakeWindow {
  constructor(storage,ethereum){
    this.sessionStorage=storage;
    this.ethereum=ethereum;
    this.listeners=new Map();
    this.timeouts=[];
  }
  addEventListener(type,listener){
    const values=this.listeners.get(type)??[];
    values.push(listener);
    this.listeners.set(type,values);
  }
  dispatchEvent(event){
    for(const listener of this.listeners.get(event.type)??[])listener(event);
    return true;
  }
  setTimeout(callback,delay){
    this.timeouts.push({callback,delay});
    return this.timeouts.length;
  }
  clearTimeout(){}
}

class FakeCustomEvent {
  constructor(type,options={}){this.type=type;this.detail=options.detail}
}

function memoryStorage(locator){
  const values=new Map(locator?[[storageKey,JSON.stringify(locator)]]:[]);
  return{
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key),
    value:key=>values.get(key)
  };
}

async function waitUntil(predicate){
  for(let attempt=0;attempt<20;attempt++){
    if(predicate())return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.fail("condition was not reached");
}

function fakeDocument(){
  const elements=new Map();
  const get=key=>{
    if(!elements.has(key))elements.set(key,new FakeElement());
    return elements.get(key);
  };
  return{
    elements,
    querySelector:get,
    getElementById:get,
    createElement:()=>new FakeElement()
  };
}

function installConsoleNavigationGlobals(){
  const hadLocation=Object.hasOwn(globalThis,"location"),previousLocation=globalThis.location;
  const hadHistory=Object.hasOwn(globalThis,"history"),previousHistory=globalThis.history;
  globalThis.location={pathname:"/console/",search:"",hash:""};
  globalThis.history={replaceState(_state,_unused,url){
    if(url===undefined)return;
    const next=new URL(String(url),"https://sentinel.test/console/");
    if(next.origin!=="https://sentinel.test")throw new Error("cross-origin history update");
    globalThis.location.pathname=next.pathname;
    globalThis.location.search=next.search;
    globalThis.location.hash=next.hash;
  }};
  return()=>{
    if(hadLocation)globalThis.location=previousLocation;else delete globalThis.location;
    if(hadHistory)globalThis.history=previousHistory;else delete globalThis.history;
  };
}

test("console integration fixtures model history route updates",t=>{
  t.after(installConsoleNavigationGlobals());
  globalThis.history.replaceState(null,"","/console/?q=0xtransaction&guid=0xpacket#evidence");
  assert.deepEqual(globalThis.location,{
    pathname:"/console/",
    search:"?q=0xtransaction&guid=0xpacket",
    hash:"#evidence"
  });
});

test("unavailable restoration performs only the capability GET and never touches the wallet",async t=>{
  const locator={
    version:1,
    chainId:"31337",
    sourceOApp:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceEndpoint:"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    destinationEid:40231,
    transactionHash,
    guid
  };
  const storage=memoryStorage(locator);
  let walletRequests=0;
  const windowValue=new FakeWindow(storage,{request:async()=>{walletRequests++;throw new Error("wallet must remain idle")}});
  const documentValue=fakeDocument();
  const fetches=[];
  const intervals=[];
  globalThis.window=windowValue;
  globalThis.document=documentValue;
  globalThis.CustomEvent=FakeCustomEvent;
  t.after(installConsoleNavigationGlobals());
  globalThis.fetch=async path=>{
    fetches.push(String(path));
    if(path==="/api/demo/config")return{ok:false,status:404,json:async()=>({})};
    throw new Error("coordinator must remain idle");
  };
  globalThis.setInterval=(callback,delay)=>{
    intervals.push({callback,delay});
    return intervals.length;
  };

  const suffix=`unavailable-${Date.now()}`;
  await import(`../src/app.js?${suffix}`);
  await import(`../../../dist/apps/dashboard/demo.js?${suffix}`);
  await new Promise(resolve=>setImmediate(resolve));

  assert.deepEqual(fetches,["/api/demo/config"]);
  assert.equal(intervals.length,0);
  assert.equal(windowValue.timeouts.length,0);
  assert.equal(walletRequests,1);
  assert.equal(documentValue.elements.get("demo-status").textContent,"RESTORED UNAVAILABLE");
  assert.equal(documentValue.elements.get("demo-transaction").textContent,transactionHash);
  assert.equal(documentValue.elements.get("demo-guid").textContent,guid);
  assert.equal(storage.value(storageKey),JSON.stringify(locator));
});

test("matching restoration unlocks read-only operations and schedules the exact GUID without touching the wallet",async t=>{
  const publicConfig={
    mode:"LOCAL_WALLET_DEMO",
    chainId:"31337",
    chainName:"Sentinel Local",
    rpcUrl:"http://127.0.0.1:8545/",
    sourceOApp:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceEndpoint:"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    destinationEid:40231,
    authorizedTarget:"0x3333333333333333333333333333333333333333",
    actionSelector:id("record(bytes32)").slice(0,10),
    actionSignature:"record(bytes32)",
    approvedRecordLabel:"approved",
    approvedArgument:id("approved"),
    approvedAuthorizationId:`0x${"5".repeat(64)}`,
    options:"0x",
    payInLzToken:false,
    semanticSource:"LOCAL_POLICY_FIXTURE"
  };
  const locator={
    version:1,
    chainId:"31337",
    sourceOApp:publicConfig.sourceOApp,
    sourceEndpoint:publicConfig.sourceEndpoint,
    destinationEid:publicConfig.destinationEid,
    transactionHash,
    guid
  };
  const storage=memoryStorage(locator);
  let walletRequests=0;
  const windowValue=new FakeWindow(storage,{request:async()=>{walletRequests++;throw new Error("wallet must remain idle")}});
  const documentValue=fakeDocument();
  const fetches=[];
  const intervals=[];
  globalThis.window=windowValue;
  globalThis.document=documentValue;
  globalThis.CustomEvent=FakeCustomEvent;
  t.after(installConsoleNavigationGlobals());
  globalThis.fetch=async path=>{
    fetches.push(String(path));
    if(path==="/api/demo/config")return{ok:true,status:200,json:async()=>publicConfig};
    if(path==="/health")return{ok:true,status:200,json:async()=>({presentationMode:"LOCAL_TEST"})};
    if(path==="/api/runtime-status")return{ok:true,status:200,json:async()=>localRuntimeStatus};
    if(["/api/jobs","/api/dead-letters","/api/deliveries","/api/recovery-actions"].includes(path))
      return{ok:true,status:200,json:async()=>[]};
    throw new Error(`unexpected fetch ${path}`);
  };
  globalThis.setInterval=(callback,delay)=>{
    intervals.push({callback,delay});
    return intervals.length;
  };

  const suffix=`matching-${Date.now()}`;
  await import(`../src/app.js?${suffix}`);
  await import(`../../../dist/apps/dashboard/demo.js?${suffix}`);
  await new Promise(resolve=>setImmediate(resolve));

  assert.deepEqual(fetches,[
    "/api/demo/config",
    "/health",
    "/api/runtime-status",
    "/api/jobs",
    "/api/dead-letters",
    "/api/deliveries",
    "/api/recovery-actions"
  ]);
  assert.equal(intervals.length,6);
  const fetchCount=fetches.length;
  windowValue.dispatchEvent(new FakeCustomEvent("sentinel:demo-bootstrap",{detail:{state:"OPERATIONS_ALLOWED"}}));
  assert.equal(fetches.length,fetchCount);
  assert.equal(intervals.length,6);
  assert.equal(windowValue.timeouts.length,1);
  assert.equal(windowValue.timeouts[0].delay,0);
  assert.equal(walletRequests,1);
  assert.equal(documentValue.elements.get("demo-status").textContent,"COORDINATOR PENDING");
  assert.match(documentValue.elements.get("demo-message").textContent,/no wallet request or source resend/);
  assert.equal(storage.value(storageKey),JSON.stringify(locator));
  assert.equal(documentValue.elements.get("#runtime-status-badge").textContent,"RUNNING");
  assert.equal(documentValue.elements.get("#runtime-lease").textContent,"NOT APPLICABLE · LOCAL FIXTURE");
});

test("runtime status failure renders unavailable without disrupting other operations panels",async t=>{
  const storage=memoryStorage();
  const windowValue=new FakeWindow(storage,undefined);
  const documentValue=fakeDocument();
  const fetches=[];
  const intervals=[];
  globalThis.window=windowValue;
  globalThis.document=documentValue;
  globalThis.CustomEvent=FakeCustomEvent;
  t.after(installConsoleNavigationGlobals());
  globalThis.fetch=async path=>{
    fetches.push(String(path));
    if(path==="/api/demo/config")return{ok:false,status:404,json:async()=>({})};
    if(path==="/health")return{ok:true,status:200,json:async()=>({presentationMode:"LOCAL_TEST"})};
    if(path==="/api/runtime-status")return{ok:false,status:503,json:async()=>({error:"runtime status unavailable"})};
    if(["/api/jobs","/api/dead-letters","/api/deliveries","/api/recovery-actions"].includes(path))
      return{ok:true,status:200,json:async()=>[]};
    throw new Error(`unexpected fetch ${path}`);
  };
  globalThis.setInterval=(callback,delay)=>{
    intervals.push({callback,delay});
    return intervals.length;
  };

  const suffix=`runtime-unavailable-${Date.now()}`;
  await import(`../src/app.js?${suffix}`);
  await import(`../../../dist/apps/dashboard/demo.js?${suffix}`);
  await new Promise(resolve=>setImmediate(resolve));

  assert.deepEqual(fetches,[
    "/api/demo/config",
    "/health",
    "/api/runtime-status",
    "/api/jobs",
    "/api/dead-letters",
    "/api/deliveries",
    "/api/recovery-actions"
  ]);
  assert.equal(intervals.length,6);
  assert.equal(documentValue.elements.get("#runtime-status-badge").textContent,"UNAVAILABLE");
  assert.equal(documentValue.elements.get("#connection-status").textContent,"NO PACKETS DETECTED");
  assert.equal(documentValue.elements.get("#quarantine-status").textContent,"CLEAR");
  assert.equal(documentValue.elements.get("#delivery-status").textContent,"EMPTY");
  assert.equal(documentValue.elements.get("#recovery-action-status").textContent,"EMPTY");
});

test("a fresh wallet action persists nothing until the mined receipt yields its bound GUID",async t=>{
  const owner="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sourceOApp="0x1111111111111111111111111111111111111111";
  const target="0x3333333333333333333333333333333333333333";
  const publicConfig={
    mode:"LOCAL_WALLET_DEMO",
    chainId:"31337",
    chainName:"Sentinel Local",
    rpcUrl:"http://127.0.0.1:8545/",
    sourceOApp,
    sourceEndpoint:"0x2222222222222222222222222222222222222222",
    destinationEid:40231,
    authorizedTarget:target,
    actionSelector:id("record(bytes32)").slice(0,10),
    actionSignature:"record(bytes32)",
    approvedRecordLabel:"approved",
    approvedArgument:id("approved"),
    approvedAuthorizationId:`0x${"5".repeat(64)}`,
    options:"0x",
    payInLzToken:false,
    semanticSource:"LOCAL_POLICY_FIXTURE"
  };
  const oapp=new Interface([
    "function owner() view returns(address)",
    "function quoteAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,bool) view returns((uint256 nativeFee,uint256 lzTokenFee) fee)",
    "event ActionSent(bytes32 indexed authorizationId,bytes32 indexed guid,uint32 indexed dstEid,address target,uint256 value)"
  ]);
  const event=oapp.encodeEventLog(
    oapp.getEvent("ActionSent"),
    [publicConfig.approvedAuthorizationId,guid,40231,target,0n]
  );
  let releaseReceipt;
  const receiptPending=new Promise(resolve=>{releaseReceipt=resolve});
  const provider={
    calls:[],
    listeners:new Map(),
    async request({method,params=[]}){
      this.calls.push({method,params});
      if(method==="eth_requestAccounts")return[owner];
      if(method==="eth_chainId")return"0x7a69";
      if(method==="eth_call"){
        const data=params[0].data;
        if(data===oapp.encodeFunctionData("owner"))
          return oapp.encodeFunctionResult("owner",[owner]);
        return oapp.encodeFunctionResult("quoteAction",[[1000000000000n,0n]]);
      }
      if(method==="eth_sendTransaction")return transactionHash;
      if(method==="eth_getTransactionReceipt")return receiptPending;
      throw new Error(`unexpected wallet method ${method}`);
    },
    on(eventName,listener){this.listeners.set(eventName,listener)},
    removeListener(eventName,listener){
      if(this.listeners.get(eventName)===listener)this.listeners.delete(eventName);
    }
  };
  const storage=memoryStorage();
  const windowValue=new FakeWindow(storage,provider);
  const documentValue=fakeDocument();
  const intervals=[];
  globalThis.window=windowValue;
  globalThis.document=documentValue;
  globalThis.CustomEvent=FakeCustomEvent;
  t.after(installConsoleNavigationGlobals());
  globalThis.fetch=async path=>{
    if(path==="/api/demo/config")return{ok:true,status:200,json:async()=>publicConfig};
    if(path==="/health")return{ok:true,status:200,json:async()=>({presentationMode:"LOCAL_TEST"})};
    if(path==="/api/runtime-status")return{ok:true,status:200,json:async()=>localRuntimeStatus};
    if(["/api/jobs","/api/dead-letters","/api/deliveries","/api/recovery-actions"].includes(path))
      return{ok:true,status:200,json:async()=>[]};
    throw new Error(`unexpected fetch ${path}`);
  };
  globalThis.setInterval=(callback,delay)=>{
    intervals.push({callback,delay});
    return intervals.length;
  };

  const suffix=`fresh-${Date.now()}`;
  await import(`../src/app.js?${suffix}`);
  await import(`../../../dist/apps/dashboard/demo.js?${suffix}`);
  await waitUntil(()=>documentValue.elements.get("demo-status")?.textContent==="WALLET REQUIRED");
  assert.equal(storage.value(storageKey),undefined);

  documentValue.elements.get("demo-connect").listeners.get("click")();
  await waitUntil(()=>documentValue.elements.get("demo-status").textContent==="READY");
  assert.equal(storage.value(storageKey),undefined);

  documentValue.elements.get("demo-quote").listeners.get("click")();
  await waitUntil(()=>documentValue.elements.get("demo-status").textContent==="QUOTED");
  assert.equal(storage.value(storageKey),undefined);

  documentValue.elements.get("demo-send").listeners.get("click")();
  await waitUntil(()=>provider.calls.some(call=>call.method==="eth_getTransactionReceipt"));
  assert.equal(documentValue.elements.get("demo-status").textContent,"SUBMITTED");
  assert.equal(storage.value(storageKey),undefined);

  releaseReceipt({
    transactionHash,
    status:"0x1",
    blockNumber:"0xc",
    logs:[{address:sourceOApp,topics:event.topics,data:event.data}]
  });
  await waitUntil(()=>documentValue.elements.get("demo-status").textContent==="COORDINATOR PENDING");
  assert.deepEqual(JSON.parse(storage.value(storageKey)),{
    version:1,
    chainId:"31337",
    sourceOApp,
    sourceEndpoint:publicConfig.sourceEndpoint,
    destinationEid:40231,
    transactionHash,
    guid
  });
  assert.equal(provider.calls.filter(call=>call.method==="eth_sendTransaction").length,1);
});
