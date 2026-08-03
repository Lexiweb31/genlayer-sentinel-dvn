import test from "node:test";
import assert from "node:assert/strict";
import {Interface} from "ethers";
import {IndependentSourcePathVerifier} from "../../../dist/services/coordinator/src/source-path-verifier.js";

const a=n=>`0x${n.repeat(40)}`;
const h=n=>`0x${n.repeat(64)}`;
const b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const endpointInterface=new Interface([
  "function getSendLibrary(address sender,uint32 dstEid) view returns(address lib)",
  "function isDefaultSendLibrary(address sender,uint32 dstEid) view returns(bool)"
]);
const sendInterface=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function executorConfigs(address oapp,uint32 remoteEid) view returns(uint32 maxMessageSize,address executor)"
]);
const oappInterface=new Interface(["function peers(uint32 eid) view returns(bytes32 peer)"]);
const adapterInterface=new Interface([
  "function messageLib() view returns(address)",
  "function verificationTarget() view returns(address)",
  "function supportedDstEid() view returns(uint32)",
  "function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)"
]);

const config={
  name:"sepolia-arbitrum-sepolia",
  sourceChainId:11155111,
  destinationChainId:421614,
  srcEid:40161,
  dstEid:40231,
  endpoint:a("1"),
  sendLibrary:a("2"),
  sourceOApp:b("3"),
  sourceOAppAddress:a("3"),
  destinationOApp:b("4"),
  sentinelDvn:a("5"),
  executor:a("6"),
  maxMessageSize:10000,
  deadDvn:a("d"),
  requiredDvns:[a("a")],
  optionalDvns:[a("5"),a("b")],
  optionalDvnThreshold:1,
  startBlock:1n,
  confirmations:15n,
  rpcUrls:["https://source-a.example/v1/key","https://source-b.example/v1/key"]
};
const packet={
  guid:h("1"),srcEid:40161,dstEid:40231,nonce:1n,sender:b("3"),receiver:b("4"),
  message:"0x",payloadHash:h("2"),encodedPayloadHash:h("3"),txHash:h("4"),
  blockHash:h("e"),blockNumber:127n
};

function rpc(options={}){
  const calls=[];
  const value=async(url,method,params)=>{
    const second=url.includes("source-b");
    calls.push({url,method,params});
    if(options.throwRpc)throw new Error("secret provider path /v1/key");
    if(method==="eth_chainId")return `0x${BigInt(options.chainId??config.sourceChainId).toString(16)}`;
    if(method==="eth_getBlockByNumber")return{number:params[0],hash:second&&options.disagreeBlock?h("f"):(options.blockHash??packet.blockHash)};
    if(method==="eth_getCode"){
      if(options.emptyCode&&params[0].toLowerCase()===(options.emptyCodeTarget??config.executor).toLowerCase())return "0x";
      if(second&&options.dvnCodeB&&params[0].toLowerCase()===config.requiredDvns[0].toLowerCase())return options.dvnCodeB;
      return "0x6000";
    }
    if(method!=="eth_call")throw new Error(`unexpected method ${method}`);
    assert.deepEqual(params[1],{blockHash:packet.blockHash,requireCanonical:true});
    const {to,data}=params[0];
    if(to.toLowerCase()===config.endpoint.toLowerCase()){
      if(data.startsWith(endpointInterface.getFunction("getSendLibrary").selector))return endpointInterface.encodeFunctionResult("getSendLibrary",[options.sendLibrary??config.sendLibrary]);
      if(data.startsWith(endpointInterface.getFunction("isDefaultSendLibrary").selector))return endpointInterface.encodeFunctionResult("isDefaultSendLibrary",[options.isDefault??false]);
    }
    if(to.toLowerCase()===(options.sendLibrary??config.sendLibrary).toLowerCase()){
      if(data.startsWith(sendInterface.getFunction("isSupportedEid").selector))return sendInterface.encodeFunctionResult("isSupportedEid",[options.supported??true]);
      if(data.startsWith(sendInterface.getFunction("getAppUlnConfig").selector)){
        const required=options.requiredDvns??config.requiredDvns;
        const optional=options.optionalDvns??config.optionalDvns;
        return sendInterface.encodeFunctionResult("getAppUlnConfig",[[
          options.confirmations??config.confirmations,
          options.requiredCount??required.length,
          options.optionalCount??optional.length,
          options.threshold??config.optionalDvnThreshold,
          required,
          optional
        ]]);
      }
      if(data.startsWith(sendInterface.getFunction("executorConfigs").selector))return sendInterface.encodeFunctionResult("executorConfigs",[options.maxMessageSize??config.maxMessageSize,options.executor??config.executor]);
    }
    if(to.toLowerCase()===config.sourceOAppAddress.toLowerCase()&&data.startsWith(oappInterface.getFunction("peers").selector))return oappInterface.encodeFunctionResult("peers",[options.peer??config.destinationOApp]);
    if(to.toLowerCase()===config.sentinelDvn.toLowerCase()){
      if(data.startsWith(adapterInterface.getFunction("messageLib").selector))return adapterInterface.encodeFunctionResult("messageLib",[config.sendLibrary]);
      if(data.startsWith(adapterInterface.getFunction("verificationTarget").selector))return adapterInterface.encodeFunctionResult("verificationTarget",[config.sourceOAppAddress]);
      if(data.startsWith(adapterInterface.getFunction("supportedDstEid").selector))return adapterInterface.encodeFunctionResult("supportedDstEid",[config.dstEid]);
      if(data.startsWith(adapterInterface.getFunction("quorum").selector))return adapterInterface.encodeFunctionResult("quorum",[3]);
      if(data.startsWith(adapterInterface.getFunction("signer").selector))return adapterInterface.encodeFunctionResult("signer",[true]);
    }
    throw new Error(`unexpected calldata ${data}`);
  };
  return{value,calls};
}

test("proves the complete explicit source pathway at the packet block",async()=>{
  const fixture=rpc();
  const verified=await new IndependentSourcePathVerifier(config,fixture.value).verify(packet);
  assert.equal(verified.observedBlockNumber,127n);
  assert.equal(verified.observedBlockHash,packet.blockHash);
  assert.equal(verified.chainId,11155111n);
  assert.equal(verified.dstEid,40231);
  assert.equal(verified.sendLibrary,config.sendLibrary);
  assert.equal(verified.sourceOApp,config.sourceOAppAddress);
  assert.equal(verified.destinationOApp,config.destinationOApp);
  assert.equal(verified.executor,config.executor);
  assert.equal(verified.maxMessageSize,10000);
  assert.deepEqual(verified.requiredDvns,config.requiredDvns);
  assert.deepEqual(verified.optionalDvns,config.optionalDvns);
  assert.match(verified.configurationDigest,/^0x[0-9a-f]{64}$/);
  for(const call of fixture.calls.filter(call=>["eth_getCode","eth_call"].includes(call.method)))assert.deepEqual(call.params.at(-1),{blockHash:packet.blockHash,requireCanonical:true});
});

test("rejects provider disagreement and sanitizes transport failures",async()=>{
  await assert.rejects(new IndependentSourcePathVerifier(config,rpc({disagreeBlock:true}).value).verify(packet),/source provider disagreement/);
  await assert.rejects(new IndependentSourcePathVerifier(config,rpc({dvnCodeB:"0x6001"}).value).verify(packet),/source provider disagreement/);
  await assert.rejects(new IndependentSourcePathVerifier(config,rpc({throwRpc:true}).value).verify(packet),error=>{
    assert.equal(error.message,"source pathway RPC unavailable");
    assert.doesNotMatch(error.message,/secret|\/v1\/key/);
    return true;
  });
});

test("fails closed on every pinned source pathway field and explicit-config invariant",async()=>{
  const changes=[
    {chainId:1},
    {blockHash:h("f")},
    {emptyCode:true},
    {sendLibrary:a("c")},
    {isDefault:true},
    {supported:false},
    {confirmations:14n},
    {requiredDvns:[a("c")]},
    {optionalDvns:[a("5"),a("c")]},
    {threshold:2},
    {requiredCount:2},
    {optionalCount:1},
    {maxMessageSize:9999},
    {executor:a("c")},
    {peer:h("f")}
  ];
  for(const change of changes)await assert.rejects(new IndependentSourcePathVerifier(config,rpc(change).value).verify(packet),/source pathway configuration drift/);
  await assert.rejects(new IndependentSourcePathVerifier(config,rpc({confirmations:0n,requiredDvns:[],optionalDvns:[],requiredCount:0,optionalCount:0,threshold:0}).value).verify(packet),/source pathway configuration drift/);
});

test("rejects unsafe or duplicate source RPC origins before observation",()=>{
  for(const rpcUrls of[
    ["https://same.example/a","https://same.example/b"],
    ["http://a.example","https://b.example"],
    ["https://user:secret@a.example","https://b.example"],
    ["https://127.0.0.1","https://b.example"]
  ])assert.throws(()=>new IndependentSourcePathVerifier({...config,rpcUrls},rpc().value));
});
