import test from"node:test";
import assert from"node:assert/strict";
import{
  createReadOnlyRpcClient,
  PathwayAuditError
}from"../../../dist/services/coordinator/src/read-only-json-rpc.js";

const endpoint=(url="https://rpc-a.example/rpc")=>({
  label:"source-a",url,operatorFamily:"operator-a",originSha256:"b".repeat(64)
});
const documentationResolution=async()=>[{address:"203.0.113.10",family:4}];
const jsonResponse=(value,statusCode=200,contentType="application/json")=>({
  statusCode,headers:{"content-type":contentType},body:Buffer.from(typeof value==="string"?value:JSON.stringify(value))
});
const successfulExchange=()=>{
  const calls=[],requests=[];
  const exchange=async(target,request)=>{
    calls.push(structuredClone(target));requests.push(structuredClone({...request,signal:undefined}));
    const body=JSON.parse(request.body);
    return jsonResponse({jsonrpc:"2.0",id:body.id,result:{ok:true}});
  };
  exchange.calls=calls;exchange.requests=requests;
  return exchange;
};
const clientWith=(exchange,dependencies={})=>createReadOnlyRpcClient(endpoint(),{
  resolve:documentationResolution,
  exchange,
  allowDocumentationAddressesForTests:true,
  ...dependencies
});
const transportFailure=error=>error instanceof PathwayAuditError&&
  error.code==="PATHWAY_AUDIT_TRANSPORT_FAILED"&&
  error.message==="PATHWAY_AUDIT_TRANSPORT_FAILED";
const address="0x1111111111111111111111111111111111111111";
const transactionHash=`0x${"2".repeat(64)}`;
const blockReference={blockHash:`0x${"3".repeat(64)}`,requireCanonical:true};

test("allows only the seven read-only methods with their closed parameter grammar",async()=>{
  const exchange=successfulExchange(),client=clientWith(exchange);
  const allowed=[
    ["eth_chainId",[]],
    ["eth_blockNumber",[]],
    ["eth_getBlockByNumber",["0x1",false]],
    ["eth_getCode",[address,blockReference]],
    ["eth_call",[{to:address,data:"0x1234"},blockReference]],
    ["eth_getTransactionByHash",[transactionHash]],
    ["eth_getTransactionReceipt",[transactionHash]]
  ];
  for(const [method,params]of allowed)assert.deepEqual(await client.call(method,params),{ok:true});
  assert.deepEqual(exchange.requests.map(value=>JSON.parse(value.body).method),allowed.map(([method])=>method));

  const invalid=[
    ["eth_sendRawTransaction",["0x"]],
    ["personal_sign",[]],
    ["eth_chainId",[1]],
    ["eth_blockNumber",["latest"]],
    ["eth_getBlockByNumber",["latest",false]],
    ["eth_getBlockByNumber",["0x01",false]],
    ["eth_getBlockByNumber",["0x1",true]],
    ["eth_getCode",[address,"latest"]],
    ["eth_getCode",[address,{...blockReference,extra:true}]],
    ["eth_call",[{from:address,to:address,data:"0x"},blockReference]],
    ["eth_call",[{to:address,data:"0x1"},blockReference]],
    ["eth_getTransactionByHash",["0x2"]],
    ["eth_getTransactionReceipt",[]]
  ];
  const withGetter={to:address,data:"0x"};
  Object.defineProperty(withGetter,"from",{enumerable:true,get(){throw new Error("secret getter")}});
  invalid.push(["eth_call",[withGetter,blockReference]]);
  const before=exchange.calls.length;
  for(const [method,params]of invalid)await assert.rejects(client.call(method,params),transportFailure);
  assert.equal(exchange.calls.length,before);
});

test("uses monotonic request IDs and pins the checked address separately from TLS identity",async()=>{
  const exchange=successfulExchange(),client=clientWith(exchange);
  await client.call("eth_chainId",[]);
  await client.call("eth_blockNumber",[]);
  assert.deepEqual(exchange.requests.map(value=>JSON.parse(value.body).id),[1,2]);
  assert.deepEqual(exchange.calls[0],{
    address:"203.0.113.10",servername:"rpc-a.example",hostHeader:"rpc-a.example",path:"/rpc",method:"POST"
  });
  assert.deepEqual(client.descriptor(),{
    label:"source-a",originSha256:"b".repeat(64),operatorFamily:"operator-a"
  });
  const first=client.descriptor();first.label="changed";
  assert.equal(client.descriptor().label,"source-a");
});

test("requires HTTP 200, JSON content type, one correlated JSON-RPC 2.0 result, and refuses redirects",async()=>{
  const cases=[
    jsonResponse({jsonrpc:"2.0",id:1,result:"0x1"},204),
    jsonResponse({jsonrpc:"2.0",id:1,result:"0x1"},302),
    jsonResponse({jsonrpc:"2.0",id:1,result:"0x1"},200,"text/plain"),
    jsonResponse({jsonrpc:"2.0",id:2,result:"0x1"}),
    jsonResponse({jsonrpc:"2.0",id:"1",result:"0x1"}),
    jsonResponse({jsonrpc:"1.0",id:1,result:"0x1"}),
    jsonResponse({jsonrpc:"2.0",id:1,result:"0x1",extra:true}),
    jsonResponse({jsonrpc:"2.0",id:1,result:"0x1",error:null}),
    jsonResponse({jsonrpc:"2.0",id:1}),
    jsonResponse([]),
    jsonResponse('{"jsonrpc":"2.0","id":1,"result":1}{"jsonrpc":"2.0","id":1,"result":2}'),
    jsonResponse('{"jsonrpc":"2.0","id":1,"result":{"value":1,"value":2}}')
  ];
  for(const response of cases){
    let calls=0;
    const exchange=async()=>{calls++;return response};
    await assert.rejects(clientWith(exchange).call("eth_chainId",[]),transportFailure);
    assert.equal(calls,1);
  }
  const exchange=async(_target,request)=>jsonResponse({jsonrpc:"2.0",id:JSON.parse(request.body).id,result:"0x1"},200,"Application/JSON; charset=utf-8");
  assert.equal(await clientWith(exchange).call("eth_chainId",[]),"0x1");
});

test("enforces the 2 MiB byte limit and sanitizes provider and exchange errors",async()=>{
  const oversized={statusCode:200,headers:{"content-type":"application/json"},body:Buffer.alloc(2*1024*1024+1,0x20)};
  for(const exchange of[
    async()=>oversized,
    async(_target,request)=>jsonResponse({jsonrpc:"2.0",id:JSON.parse(request.body).id,error:{code:-32000,message:"secret provider detail"}}),
    async()=>{throw new Error("secret socket detail")}
  ]){
    const outcome=await clientWith(exchange).call("eth_chainId",[]).catch(error=>error);
    assert(transportFailure(outcome));
    assert.doesNotMatch(outcome.message,/secret|socket|provider/i);
  }
});

test("bounds connect, response, and whole-operation time",async()=>{
  const exchange=successfulExchange(),client=clientWith(exchange);
  await client.call("eth_chainId",[]);
  assert.equal(exchange.requests[0].connectTimeoutMs,5_000);
  assert.equal(exchange.requests[0].responseTimeoutMs,10_000);
  assert.equal(exchange.requests[0].maxResponseBytes,2*1024*1024);

  for(const message of["connect timeout secret","response timeout secret"]){
    const failing=async()=>{throw new Error(message)};
    await assert.rejects(clientWith(failing).call("eth_chainId",[]),transportFailure);
  }
  const never=async()=>new Promise(()=>{});
  await assert.rejects(clientWith(never,{operationTimeoutMs:15}).call("eth_chainId",[]),transportFailure);
});

test("does not start HTTPS when DNS finishes after the whole-operation timeout",async()=>{
  let calls=0;
  const client=createReadOnlyRpcClient(endpoint(),{
    resolve:async()=>{
      await new Promise(resolve=>setTimeout(resolve,25));
      return[{address:"8.8.8.8",family:4}];
    },
    exchange:async()=>{calls++;return jsonResponse({jsonrpc:"2.0",id:1,result:"0x1"})},
    operationTimeoutMs:5
  });
  await assert.rejects(client.call("eth_chainId",[]),transportFailure);
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(calls,0);
});

test("rejects unsafe URL controls before resolving or exchanging",async()=>{
  const invalid=[
    "http://rpc-a.example/rpc",
    "https://user:pass@rpc-a.example/rpc",
    "https://rpc-a.example:443/rpc",
    "https://rpc-a.example/rpc?key=secret",
    "https://rpc-a.example/rpc#fragment",
    "https://127.0.0.1/rpc",
    "https://[::1]/rpc",
    "https://rpc-a.example/other"
  ];
  for(const url of invalid){
    let resolutions=0,calls=0;
    const client=createReadOnlyRpcClient(endpoint(url),{
      resolve:async()=>{resolutions++;return[{address:"8.8.8.8",family:4}]},
      exchange:async()=>{calls++;throw new Error("must not run")}
    });
    await assert.rejects(client.call("eth_chainId",[]),transportFailure);
    assert.equal(resolutions,0);assert.equal(calls,0);
  }
});

test("rejects any nonpublic DNS answer, including metadata, documentation, and reserved ranges",async()=>{
  const nonpublic=[
    "0.0.0.0","10.0.0.1","100.64.0.1","127.0.0.1","169.254.169.254","172.16.0.1","192.168.0.1",
    "192.0.2.1","192.88.99.1","198.18.0.1","198.51.100.1","203.0.113.10","224.0.0.1","240.0.0.1",
    "::","::1","::127.0.0.1","::ffff:127.0.0.1","64:ff9b::127.0.0.1","100::1",
    "2001:db8::1","2002::1","3fff::1","5f00::1",
    "fc00::1","fe80::1","ff02::1"
  ];
  for(const addressValue of nonpublic){
    let calls=0;
    const client=createReadOnlyRpcClient(endpoint(),{
      resolve:async()=>[{address:"8.8.8.8",family:4},{address:addressValue,family:addressValue.includes(":")?6:4}],
      exchange:async()=>{calls++;throw new Error("must not run")}
    });
    await assert.rejects(client.call("eth_chainId",[]),transportFailure);
    assert.equal(calls,0,addressValue);
  }
});

test("resolves on every call and blocks DNS rebinding before HTTPS exchange",async()=>{
  let resolutions=0;
  const exchange=successfulExchange();
  const client=createReadOnlyRpcClient(endpoint(),{
    resolve:async()=>++resolutions===1?[{address:"8.8.8.8",family:4}]:[{address:"127.0.0.1",family:4}],
    exchange
  });
  await client.call("eth_chainId",[]);
  await assert.rejects(client.call("eth_chainId",[]),transportFailure);
  assert.equal(resolutions,2);assert.equal(exchange.calls.length,1);
});

test("returns a detached parsed result",async()=>{
  const providerResult={nested:{value:1}},encoded=JSON.stringify({jsonrpc:"2.0",id:1,result:providerResult});
  const client=clientWith(async()=>jsonResponse(encoded));
  const result=await client.call("eth_chainId",[]);
  assert.notStrictEqual(result,providerResult);assert.notStrictEqual(result.nested,providerResult.nested);
  result.nested.value=9;
  assert.equal(providerResult.nested.value,1);
});
