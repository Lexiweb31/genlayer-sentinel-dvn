import test from "node:test";
import assert from "node:assert/strict";
import {JsonRpcGenLayerStatusReader} from "../../../dist/services/coordinator/src/genlayer-status-reader.js";

const h=n=>`0x${n.repeat(64)}`;
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});

test("sends the documented status request and accepts FINALIZED/7",async()=>{
  const calls=[];
  const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example/rpc",async(url,init)=>{
    calls.push({url:String(url),init});
    return response({jsonrpc:"2.0",id:41,result:{status:"FINALIZED",statusCode:7}});
  },1000,()=>41);
  assert.deepEqual(await reader.getTransactionStatus(h("1")),{status:"FINALIZED",statusCode:7});
  assert.equal(calls[0].url,"https://genlayer.example/rpc");
  assert.equal(calls[0].init.method,"POST");
  assert.equal(calls[0].init.redirect,"error");
  assert.equal(calls[0].init.headers["content-type"],"application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body),{jsonrpc:"2.0",method:"gen_getTransactionStatus",params:[{txId:h("1")}],id:41});
});

test("accepts every documented internally consistent status pair",async()=>{
  const names=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","FINALIZED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"];
  for(const [statusCode,status] of names.entries()){
    const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>response({jsonrpc:"2.0",id:1,result:{status,statusCode}}),1000,()=>1);
    assert.deepEqual(await reader.getTransactionStatus(h("2")),{status,statusCode});
  }
});

test("rejects malformed, erroneous and contradictory RPC responses",async()=>{
  const bodies=[
    {jsonrpc:"2.0",id:2,result:{status:"FINALIZED",statusCode:7}},
    {jsonrpc:"2.0",id:1,error:{code:-32000,message:"secret upstream detail"}},
    {jsonrpc:"2.0",id:1,result:{status:"FINALIZED",statusCode:99}},
    {jsonrpc:"2.0",id:1,result:{status:"ACCEPTED",statusCode:7}}
  ];
  for(const body of bodies){
    const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>response(body),1000,()=>1);
    await assert.rejects(reader.getTransactionStatus(h("3")),error=>{
      assert.equal(error.message.includes("genlayer.example"),false);
      assert.equal(error.message.includes("secret upstream detail"),false);
      return true;
    });
  }
  const malformed=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>new Response("{",{status:200}),1000,()=>1);
  await assert.rejects(malformed.getTransactionStatus(h("3")),/invalid GenLayer status response/);
});

test("rejects HTTP and transport failures with sanitized errors",async()=>{
  const http=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>new Response("upstream secret",{status:500}),1000,()=>1);
  await assert.rejects(http.getTransactionStatus(h("4")),error=>error.message==="GenLayer status HTTP failure");
  const transport=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>{throw new Error("token=secret")},1000,()=>1);
  await assert.rejects(transport.getTransactionStatus(h("4")),error=>error.message==="GenLayer status transport failed");
});

test("validates endpoint, timeout and transaction ID before fetching",async()=>{
  assert.throws(()=>new JsonRpcGenLayerStatusReader("http://genlayer.example"),/credential-free HTTPS/);
  assert.throws(()=>new JsonRpcGenLayerStatusReader("https://genlayer.example",fetch,0),/timeout must be positive/);
  const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>{throw new Error("must not fetch")});
  await assert.rejects(reader.getTransactionStatus("0x01"),/invalid GenLayer transaction ID/);
});
