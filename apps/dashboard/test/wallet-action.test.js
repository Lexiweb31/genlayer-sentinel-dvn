import test from "node:test";
import assert from "node:assert/strict";
import {Interface, id} from "ethers";
import {
  WalletActionClient,
  WalletActionError,
  parsePublicDemoConfig,
  subscribeInvalidation
} from "../../../dist/apps/dashboard/src/wallet-action.js";

const owner="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sourceOApp="0x1111111111111111111111111111111111111111";
const target="0x3333333333333333333333333333333333333333";
const transactionHash=`0x${"6".repeat(64)}`;
const guid=`0x${"7".repeat(64)}`;
const blockHash=`0x${"8".repeat(64)}`;
const config={
  mode:"LOCAL_WALLET_DEMO",
  chainId:"31337",
  chainName:"Sentinel Local",
  rpcUrl:"http://127.0.0.1:8545/",
  sourceOApp,
  sourceEndpoint:"0x2222222222222222222222222222222222222222",
  destinationEid:40231,
  authorizedTarget:target,
  actionSelector:"0xb5c645bd",
  actionSignature:"record(bytes32)",
  approvedRecordLabel:"approved",
  approvedArgument:"0x2b29265fc125740ae6bbc5035ae7af720b6932f4a3e44ba5ac02955c21ca9a05",
  approvedAuthorizationId:`0x${"5".repeat(64)}`,
  options:"0x",
  payInLzToken:false,
  semanticSource:"LOCAL_POLICY_FIXTURE"
};
const oapp=new Interface([
  "function owner() view returns(address)",
  "function quoteAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,bool) view returns((uint256 nativeFee,uint256 lzTokenFee) fee)",
  "function sendAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,(uint256 nativeFee,uint256 lzTokenFee) fee) payable",
  "event ActionSent(bytes32 indexed authorizationId,bytes32 indexed guid,uint32 indexed dstEid,address target,uint256 value)"
]);
const record=new Interface(["function record(bytes32)"]);

class RecordingProvider {
  calls=[];
  listeners=new Map();
  chainId="0x7a69";
  account=owner;
  oappOwner=owner;
  onQuote;
  onSend;
  receipt;

  constructor(){
    const event=oapp.encodeEventLog(oapp.getEvent("ActionSent"),[config.approvedAuthorizationId,guid,40231,target,0n]);
    this.receipt={
      transactionHash,
      transactionIndex:"0x0",
      blockHash,
      blockNumber:"0xc",
      from:owner,
      to:sourceOApp,
      cumulativeGasUsed:"0x5208",
      gasUsed:"0x5208",
      logsBloom:`0x${"0".repeat(512)}`,
      status:"0x1",
      logs:[{
        address:sourceOApp,
        topics:event.topics,
        data:event.data,
        blockNumber:"0xc",
        transactionHash,
        transactionIndex:"0x0",
        blockHash,
        logIndex:"0x0",
        removed:false
      }]
    };
  }

  async request({method,params=[]}){
    this.calls.push({method,params});
    if(method==="eth_requestAccounts")return[this.account];
    if(method==="eth_chainId")return this.chainId;
    if(method==="eth_call"){
      const data=params[0].data;
      if(data===oapp.encodeFunctionData("owner"))return oapp.encodeFunctionResult("owner",[this.oappOwner]);
      if(data.startsWith(oapp.getFunction("quoteAction").selector)){
        if(this.onQuote)return this.onQuote();
        return oapp.encodeFunctionResult("quoteAction",[[1000000000000n,0n]]);
      }
      throw new Error("unexpected eth_call");
    }
    if(method==="eth_sendTransaction"){
      if(this.onSend)return this.onSend();
      return transactionHash;
    }
    if(method==="eth_getTransactionReceipt")return this.receipt;
    throw new Error(`unexpected method ${method}`);
  }

  on(event,listener){this.listeners.set(event,listener)}
  removeListener(event,listener){if(this.listeners.get(event)===listener)this.listeners.delete(event)}
}

test("validates public config, wallet chain and on-chain OApp owner before quoting",async()=>{
  const provider=new RecordingProvider(),client=new WalletActionClient(provider,{pollIntervalMs:0,maxReceiptPolls:3});
  const parsed=parsePublicDemoConfig(config),session=await client.connect(parsed),quote=await client.quote(parsed,session,"approved");
  assert.equal(session.account,owner);
  assert.equal(session.chainId,31337n);
  assert.equal(quote.action.authorizationId,config.approvedAuthorizationId);
  assert.equal(quote.action.target,target);
  assert.equal(quote.action.value,0n);
  assert.equal(quote.nativeFee,1000000000000n);
  assert.equal(quote.lzTokenFee,0n);
  assert.equal(quote.argument,config.approvedArgument);
  assert.equal(record.decodeFunctionData("record",quote.action.data)[0],config.approvedArgument);
  const quoteCall=provider.calls.find(call=>call.method==="eth_call"&&call.params[0].data.startsWith(oapp.getFunction("quoteAction").selector));
  const decoded=oapp.decodeFunctionData("quoteAction",quoteCall.params[0].data);
  assert.equal(decoded[0],40231n);
  assert.equal(decoded[1].authorizationId,config.approvedAuthorizationId);
  assert.equal(decoded[1].target,target);
  assert.equal(decoded[1].value,0n);
  assert.equal(decoded[2],"0x");
  assert.equal(decoded[3],false);
  assert.ok(provider.calls.findIndex(call=>call.method==="eth_call")<provider.calls.findIndex(call=>call===quoteCall));
});

test("submits once and extracts one bound ActionSent GUID from the successful receipt",async()=>{
  const provider=new RecordingProvider(),client=new WalletActionClient(provider,{pollIntervalMs:0,maxReceiptPolls:3}),parsed=parsePublicDemoConfig(config),session=await client.connect(parsed),quote=await client.quote(parsed,session,"approved");
  const submitted=[];
  const submission=await client.submit(parsed,session,quote,hash=>{
    submitted.push({hash,receiptPolls:provider.calls.filter(call=>call.method==="eth_getTransactionReceipt").length});
  });
  assert.deepEqual(submission,{transactionHash,guid,blockNumber:12n});
  assert.deepEqual(submitted,[{hash:transactionHash,receiptPolls:0}]);
  const sends=provider.calls.filter(call=>call.method==="eth_sendTransaction");
  assert.equal(sends.length,1);
  assert.equal(provider.calls.some(call=>["personal_sign","eth_sign","eth_sendRawTransaction"].includes(call.method)),false);
  const transaction=sends[0].params[0];
  assert.equal(transaction.from,owner);
  assert.equal(transaction.to,sourceOApp);
  assert.equal(transaction.value,"0xe8d4a51000");
  const decoded=oapp.decodeFunctionData("sendAction",transaction.data);
  assert.equal(decoded[0],40231n);
  assert.equal(decoded[1].authorizationId,config.approvedAuthorizationId);
  assert.equal(decoded[1].data,quote.action.data);
  assert.equal(decoded[3].nativeFee,1000000000000n);
  assert.equal(decoded[3].lzTokenFee,0n);
});

test("fails closed with stable codes for untrusted config, wallet and receipt states",async()=>{
  assert.throws(()=>parsePublicDemoConfig({...config,privateKey:"secret"}),error=>error instanceof WalletActionError&&error.code==="CONFIG_INVALID");
  assert.throws(()=>parsePublicDemoConfig({...config,rpcUrl:"http://127.0.0.1:0/"}),error=>error instanceof WalletActionError&&error.code==="CONFIG_INVALID");
  const wrongChain=new RecordingProvider();wrongChain.chainId="0x1";
  await assert.rejects(new WalletActionClient(wrongChain).connect(parsePublicDemoConfig(config)),error=>error instanceof WalletActionError&&error.code==="WRONG_CHAIN");
  const wrongOwner=new RecordingProvider();wrongOwner.account="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await assert.rejects(new WalletActionClient(wrongOwner).connect(parsePublicDemoConfig(config)),error=>error instanceof WalletActionError&&error.code==="WRONG_OWNER");
  const quoteFailed=new RecordingProvider();quoteFailed.onQuote=()=>{throw new Error("secret quote detail")};
  const quoteFailedClient=new WalletActionClient(quoteFailed),quoteFailedSession=await quoteFailedClient.connect(parsePublicDemoConfig(config));
  await assert.rejects(quoteFailedClient.quote(parsePublicDemoConfig(config),quoteFailedSession,"approved"),error=>error instanceof WalletActionError&&error.code==="QUOTE_REVERTED"&&!error.message.includes("secret"));
  const rejected=new RecordingProvider();rejected.onSend=()=>{throw Object.assign(new Error("secret provider detail"),{code:4001})};
  const rejectedClient=new WalletActionClient(rejected),parsed=parsePublicDemoConfig(config),session=await rejectedClient.connect(parsed),quote=await rejectedClient.quote(parsed,session,"approved");
  await assert.rejects(rejectedClient.submit(parsed,session,quote),error=>error instanceof WalletActionError&&error.code==="USER_REJECTED"&&!error.message.includes("secret"));
  const reverted=new RecordingProvider();reverted.receipt={...reverted.receipt,status:"0x0"};
  const revertedClient=new WalletActionClient(reverted),revertedSession=await revertedClient.connect(parsed),revertedQuote=await revertedClient.quote(parsed,revertedSession,"approved");
  await assert.rejects(revertedClient.submit(parsed,revertedSession,revertedQuote),error=>error instanceof WalletActionError&&error.code==="SOURCE_REVERTED");
  const missing=new RecordingProvider();missing.receipt={...missing.receipt,logs:[]};
  const missingClient=new WalletActionClient(missing),missingSession=await missingClient.connect(parsed),missingQuote=await missingClient.quote(parsed,missingSession,"approved");
  await assert.rejects(missingClient.submit(parsed,missingSession,missingQuote),error=>error instanceof WalletActionError&&error.code==="ACTION_EVENT_MISSING");
  const ambiguous=new RecordingProvider();ambiguous.receipt={...ambiguous.receipt,logs:[...ambiguous.receipt.logs,...ambiguous.receipt.logs]};
  const ambiguousClient=new WalletActionClient(ambiguous),ambiguousSession=await ambiguousClient.connect(parsed),ambiguousQuote=await ambiguousClient.quote(parsed,ambiguousSession,"approved");
  await assert.rejects(ambiguousClient.submit(parsed,ambiguousSession,ambiguousQuote),error=>error instanceof WalletActionError&&error.code==="ACTION_EVENT_AMBIGUOUS");
  const pending=new RecordingProvider();pending.receipt=null;
  const pendingClient=new WalletActionClient(pending,{pollIntervalMs:0,maxReceiptPolls:2}),pendingSession=await pendingClient.connect(parsed),pendingQuote=await pendingClient.quote(parsed,pendingSession,"approved");
  await assert.rejects(pendingClient.submit(parsed,pendingSession,pendingQuote),error=>error instanceof WalletActionError&&error.code==="SOURCE_RECEIPT_UNAVAILABLE");
});

test("invalidates quotes on account or chain changes and removes both listeners",()=>{
  const provider=new RecordingProvider(),events=[];
  const cleanup=subscribeInvalidation(provider,()=>events.push("invalidated"));
  provider.listeners.get("accountsChanged")([]);
  provider.listeners.get("chainChanged")("0x1");
  assert.deepEqual(events,["invalidated","invalidated"]);
  cleanup();
  assert.equal(provider.listeners.size,0);
});
