import test from"node:test";
import assert from"node:assert/strict";
import{safeJsonRpc}from"../../../dist/services/coordinator/src/json-rpc.js";

test("requires a correlated JSON-RPC 2.0 result and refuses redirects",async()=>{
  const prior=globalThis.fetch,calls=[];
  try{
    globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:"0x1"}),{status:200,headers:{"content-type":"application/json"}})};
    assert.equal(await safeJsonRpc("https://rpc.example/v1/key","eth_chainId",[]),"0x1");
    assert.equal(calls[0].options.redirect,"error");assert.equal(calls[0].options.method,"POST");
    const request=JSON.parse(calls[0].options.body);assert.deepEqual(request,{jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]});
  }finally{globalThis.fetch=prior}
});

test("sanitizes HTTP, parse, provider and correlation failures",async()=>{
  const prior=globalThis.fetch;
  try{
    for(const response of[
      new Response("secret provider",{status:500}),
      new Response("{",{status:200}),
      new Response(JSON.stringify({jsonrpc:"2.0",id:2,result:"0x1"}),{status:200}),
      new Response(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:-1,message:"secret"}}),{status:200})
    ]){
      globalThis.fetch=async()=>response;
      await assert.rejects(safeJsonRpc("https://rpc.example/v1/key","eth_chainId",[]),error=>error.message==="JSON-RPC request failed"&&!/secret|v1\/key/.test(error.message));
    }
  }finally{globalThis.fetch=prior}
});
