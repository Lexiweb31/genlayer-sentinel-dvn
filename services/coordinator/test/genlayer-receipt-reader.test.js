import test from "node:test";
import assert from "node:assert/strict";
import {JsonRpcGenLayerReceiptReader} from "../../../dist/services/coordinator/src/genlayer-receipt-reader.js";

const h=value=>`0x${value.repeat(64)}`;
const a=value=>`0x${value.repeat(40)}`;
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});

test("returns a recipient-bound finalized receipt from the two documented RPC calls",async()=>{
  const txId=h("1"),policyContract=a("2"),calls=[];
  const reader=new JsonRpcGenLayerReceiptReader("https://genlayer.example/rpc",async(url,init)=>{
    calls.push({url:String(url),body:JSON.parse(init.body)});
    const request=calls.at(-1).body;
    if(request.method==="gen_getTransactionStatus")
      return response({jsonrpc:"2.0",id:request.id,result:{status:"FINALIZED",statusCode:7}});
    return response({jsonrpc:"2.0",id:request.id,result:{
      id:txId,recipient:policyContract,status:7,txCallData:"0x1234",result:0
    }});
  },1000,()=>41);
  assert.deepEqual(await reader.getFinalizedReceipt(txId,policyContract),{
    transactionId:txId,recipient:policyContract,statusCode:7,rawCallData:"0x1234",executionResult:0
  });
  assert.deepEqual(calls.map(call=>call.body.method),["gen_getTransactionStatus","gen_getTransactionReceipt"]);
  assert.deepEqual(calls.map(call=>call.body.params),[[{txId}],[{txId}]]);
  assert.equal(calls[0].url,"https://genlayer.example/rpc");
});

test("refuses a non-final status without fetching a receipt",async()=>{
  const txId=h("3"),policyContract=a("4"),calls=[];
  const reader=new JsonRpcGenLayerReceiptReader("https://genlayer.example",async(_url,init)=>{
    calls.push(JSON.parse(init.body));
    return response({jsonrpc:"2.0",id:calls.at(-1).id,result:{status:"ACCEPTED",statusCode:5}});
  },1000,()=>1);
  await assert.rejects(reader.getFinalizedReceipt(txId,policyContract),/GenLayer receipt is not finalized/);
  assert.equal(calls.length,1);
});

test("rejects malformed or unbound receipt responses without leaking provider data",async()=>{
  const txId=h("5"),policyContract=a("6");
  const malformed=[
    {id:h("7"),recipient:policyContract,status:7,txCallData:"0x1234",result:0},
    {id:txId,recipient:a("7"),status:7,txCallData:"0x1234",result:0},
    {id:txId,recipient:policyContract,status:5,txCallData:"0x1234",result:0},
    {id:txId,recipient:policyContract,status:7,txCallData:"secret",result:0},
    {id:txId,recipient:policyContract,status:7,txCallData:"0x1234",result:"0"},
  ];
  for(const result of malformed){
    let call=0;
    const reader=new JsonRpcGenLayerReceiptReader("https://genlayer.example",async(_url,init)=>{
      call++;
      const request=JSON.parse(init.body);
      return response(call===1?
        {jsonrpc:"2.0",id:request.id,result:{status:"FINALIZED",statusCode:7}}:
        {jsonrpc:"2.0",id:request.id,result}
      );
    },1000,()=>1);
    await assert.rejects(reader.getFinalizedReceipt(txId,policyContract),error=>
      error.message==="invalid GenLayer receipt response"&&!error.message.includes("secret")
    );
  }
});

test("sanitizes receipt transport, HTTP, RPC, and invalid endpoint failures",async()=>{
  const txId=h("8"),policyContract=a("9");
  const failures=[
    {
      fetcher:async()=>{throw new Error("secret transport")},
      message:"GenLayer status transport failed",
    },
    {
      fetcher:async(_url,init)=>{
        const request=JSON.parse(init.body);
        if(request.method==="gen_getTransactionStatus")return response({jsonrpc:"2.0",id:request.id,result:{status:"FINALIZED",statusCode:7}});
        return new Response("secret HTTP body",{status:500});
      },
      message:"GenLayer receipt HTTP failure",
    },
    {
      fetcher:async(_url,init)=>{
        const request=JSON.parse(init.body);
        if(request.method==="gen_getTransactionStatus")return response({jsonrpc:"2.0",id:request.id,result:{status:"FINALIZED",statusCode:7}});
        return response({jsonrpc:"2.0",id:request.id,error:{code:-1,message:"secret RPC body"}});
      },
      message:"GenLayer receipt RPC failure",
    },
  ];
  for(const failure of failures){
    const reader=new JsonRpcGenLayerReceiptReader("https://genlayer.example",failure.fetcher,1000,()=>1);
    await assert.rejects(reader.getFinalizedReceipt(txId,policyContract),error=>error.message===failure.message&&!error.message.includes("secret"));
  }
  assert.throws(()=>new JsonRpcGenLayerReceiptReader("http://genlayer.example"),/credential-free HTTPS/);
  assert.throws(()=>new JsonRpcGenLayerReceiptReader("https://genlayer.example",fetch,0),/timeout must be positive/);
});
