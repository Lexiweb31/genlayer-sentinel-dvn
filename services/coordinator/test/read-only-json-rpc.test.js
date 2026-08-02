import test from"node:test";
import assert from"node:assert/strict";
import{EventEmitter}from"node:events";
import{
  createNativeHttpsExchange,
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
    "2001:db8::1","2002::1","3ffe::1","3fff::1","5f00::1",
    "400::1","100:0:0:1::1","fc00::1","fe00::1","fe80::1","ff02::1"
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

test("accepts compressed and expanded globally routable IPv6 answers",async()=>{
  for(const addressValue of["2606:4700:4700::1111","2606:4700:4700:0000:0000:0000:0000:1111"]){
    const exchange=successfulExchange();
    const client=createReadOnlyRpcClient(endpoint(),{
      resolve:async()=>[{address:addressValue,family:6}],exchange
    });
    assert.deepEqual(await client.call("eth_chainId",[]),{ok:true});
    assert.equal(exchange.calls[0].address,addressValue);
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

const nativeTarget={
  address:"8.8.8.8",servername:"rpc-a.example",hostHeader:"rpc-a.example",path:"/rpc",method:"POST"
};
const nativeInput=(overrides={})=>({
  headers:{Host:"rpc-a.example","Content-Type":"application/json",Connection:"close"},
  body:'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
  signal:new AbortController().signal,
  connectTimeoutMs:25,responseTimeoutMs:25,maxResponseBytes:2*1024*1024,
  ...overrides
});
const requestFactory=scenario=>{
  const calls=[];
  const factory=(options,onResponse)=>{
    const request=new EventEmitter();
    Object.assign(request,{destroyed:false,body:undefined,maxHeadersCount:undefined});
    request.destroy=()=>{request.destroyed=true};
    request.end=body=>{request.body=body;queueMicrotask(()=>scenario({options,onResponse,request,body}))};
    calls.push({options,request});
    return request;
  };
  factory.calls=calls;
  return factory;
};
const incoming=(body,statusCode=200,includeLength=true)=>{
  const response=new EventEmitter(),bytes=Buffer.from(body);
  Object.assign(response,{
    statusCode,complete:true,destroyed:false,
    rawHeaders:["Content-Type","application/json",...(includeLength?["Content-Length",String(bytes.length)]:[])]
  });
  response.destroy=()=>{response.destroyed=true};
  return{response,bytes};
};
const connect=(request,onResponse,response,chunks)=>{
  const socket=new EventEmitter();
  request.emit("socket",socket);socket.emit("secureConnect");onResponse(response);
  for(const chunk of chunks)response.emit("data",chunk);
  response.emit("end");
};

test("the native adapter dials only the checked address while preserving TLS name verification and Host",async()=>{
  const factory=requestFactory(({request,onResponse,body})=>{
    const id=JSON.parse(body).id,{response,bytes}=incoming(JSON.stringify({jsonrpc:"2.0",id,result:"0x1"}));
    connect(request,onResponse,response,[bytes]);
  });
  const client=createReadOnlyRpcClient(endpoint(),{
    resolve:async()=>[{address:"8.8.8.8",family:4}],
    exchange:createNativeHttpsExchange(factory)
  });
  assert.equal(await client.call("eth_chainId",[]),"0x1");
  assert.equal(factory.calls.length,1);
  assert.deepEqual(factory.calls[0].options,{
    host:"8.8.8.8",port:443,servername:"rpc-a.example",path:"/rpc",method:"POST",
    agent:false,rejectUnauthorized:true,minVersion:"TLSv1.2",maxVersion:"TLSv1.3",
    headers:{
      Host:"rpc-a.example",Accept:"application/json","Content-Type":"application/json",
      "Content-Encoding":"identity","Content-Length":"59",Connection:"close"
    }
  });
});

test("the native adapter returns a redirect once and never follows it",async()=>{
  const factory=requestFactory(({request,onResponse})=>{
    const{response,bytes}=incoming('{"redirect":"https://secret.example"}',302);
    connect(request,onResponse,response,[bytes]);
  });
  const client=createReadOnlyRpcClient(endpoint(),{
    resolve:async()=>[{address:"8.8.8.8",family:4}],
    exchange:createNativeHttpsExchange(factory)
  });
  await assert.rejects(client.call("eth_chainId",[]),transportFailure);
  assert.equal(factory.calls.length,1);
});

test("the native adapter destroys the stream and request when a chunk crosses the body limit",async()=>{
  let streamedResponse;
  const factory=requestFactory(({request,onResponse})=>{
    const{response}=incoming("",200,false);streamedResponse=response;
    connect(request,onResponse,response,[Buffer.alloc(5),Buffer.alloc(5)]);
  });
  const exchange=createNativeHttpsExchange(factory);
  await assert.rejects(exchange(nativeTarget,nativeInput({maxResponseBytes:8})));
  assert.equal(factory.calls[0].request.destroyed,true);
  assert.equal(streamedResponse.destroyed,true);
});

test("the native adapter destroys requests on connect and response timeout",async()=>{
  const cases=[
    requestFactory(()=>{}),
    requestFactory(({request})=>{const socket=new EventEmitter();request.emit("socket",socket);socket.emit("secureConnect")})
  ];
  for(const [index,factory]of cases.entries()){
    const hold=setTimeout(()=>{},100);
    try{
      const exchange=createNativeHttpsExchange(factory);
      await assert.rejects(exchange(nativeTarget,nativeInput({
        connectTimeoutMs:index===0?5:50,responseTimeoutMs:index===0?50:5
      })));
      assert.equal(factory.calls[0].request.destroyed,true);
    }finally{clearTimeout(hold)}
  }
});
