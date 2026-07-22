import test from "node:test";
import assert from "node:assert/strict";
import {Interface} from "ethers";
import {IndependentDestinationPathVerifier} from "../../../dist/services/coordinator/src/destination-path-verifier.js";

const a=n=>`0x${n.repeat(40)}`;
const h=n=>`0x${n.repeat(64)}`;
const endpointInterface=new Interface(["function getReceiveLibrary(address receiver,uint32 srcEid) view returns(address lib,bool isDefault)"]);
const receiveInterface=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))"
]);
const adapterInterface=new Interface(["function verificationTarget() view returns(address)","function quorum() view returns(uint256)","function signer(address) view returns(bool)"]);
const config={rpcUrls:["https://dst-a.example/v1/key","https://dst-b.example/v1/key"],chainId:421614,srcEid:40161,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),useDefaultReceiveLibrary:false,confirmations:64n,requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")],quorum:3,signatureTtlSeconds:300};

function rpc(options={}){
  return async(url,method,params)=>{
    const second=url.includes("dst-b");
    if(options.throwRpc)throw new Error("secret provider path /v1/key");
    if(method==="eth_chainId")return `0x${BigInt(options.chainId??config.chainId).toString(16)}`;
    if(method==="eth_blockNumber")return second?"0x7f":"0x80";
    if(method==="eth_getBlockByNumber")return{number:params[0],hash:second&&options.disagreeBlock?h("e"):h("d")};
    if(method==="eth_getCode")return options.emptyCode&&params[0].toLowerCase()===config.adapter.toLowerCase()?"0x":"0x6000";
    if(method!=="eth_call")throw new Error(`unexpected method ${method}`);
    assert.equal(params[1],"0x7f");
    const data=params[0].data;
    if(data.startsWith(endpointInterface.getFunction("getReceiveLibrary").selector))return endpointInterface.encodeFunctionResult("getReceiveLibrary",[options.receiveLibrary??config.receiveLibrary,options.isDefault??false]);
    if(data.startsWith(receiveInterface.getFunction("isSupportedEid").selector))return receiveInterface.encodeFunctionResult("isSupportedEid",[options.supported??true]);
    if(data.startsWith(receiveInterface.getFunction("getUlnConfig").selector)){
      const required=options.requiredDvns??config.requiredDvns,optional=options.optionalDvns??config.optionalDvns,threshold=options.threshold??config.optionalDvnThreshold,confirmations=options.confirmations??config.confirmations;
      return receiveInterface.encodeFunctionResult("getUlnConfig",[[confirmations,required.length,optional.length,threshold,required,optional]]);
    }
    if(data.startsWith(adapterInterface.getFunction("verificationTarget").selector))return adapterInterface.encodeFunctionResult("verificationTarget",[options.adapterTarget??config.receiveLibrary]);
    if(data.startsWith(adapterInterface.getFunction("quorum").selector))return adapterInterface.encodeFunctionResult("quorum",[options.quorum??3]);
    if(data.startsWith(adapterInterface.getFunction("signer").selector))return adapterInterface.encodeFunctionResult("signer",[options.signersAuthorized??true]);
    throw new Error(`unexpected calldata ${data}`);
  };
}

test("requires two providers to agree on one pinned destination configuration at a shared block",async()=>{
  const verified=await new IndependentDestinationPathVerifier(config,rpc()).verify();
  assert.equal(verified.observedBlockNumber,127n);
  assert.equal(verified.observedBlockHash,h("d"));
  assert.equal(verified.chainId,421614n);
  assert.equal(verified.receiveLibrary.toLowerCase(),config.receiveLibrary.toLowerCase());
  assert.equal(verified.confirmations,64n);
  assert.match(verified.configurationDigest,/^0x[0-9a-f]{64}$/);
  assert.equal(verified.optionalDvns.includes(config.adapter.toLowerCase()),true);
});

test("rejects provider disagreement and sanitizes transport failures",async()=>{
  await assert.rejects(new IndependentDestinationPathVerifier(config,rpc({disagreeBlock:true})).verify(),/provider disagreement/);
  await assert.rejects(new IndependentDestinationPathVerifier(config,rpc({throwRpc:true})).verify(),error=>{
    assert.equal(error.message,"destination pathway RPC unavailable");
    assert.doesNotMatch(error.message,/secret|\/v1\/key/);
    return true;
  });
});

test("fails closed on every pinned pathway and adapter drift",async()=>{
  const changes=[
    {chainId:1},
    {emptyCode:true},
    {isDefault:true},
    {supported:false},
    {receiveLibrary:a("c")},
    {confirmations:63n},
    {requiredDvns:[a("c")]},
    {optionalDvns:[a("9"),a("c")]},
    {threshold:2},
    {adapterTarget:a("c")},
    {quorum:2},
    {signersAuthorized:false}
  ];
  for(const change of changes)await assert.rejects(new IndependentDestinationPathVerifier(config,rpc(change)).verify());
});

test("rejects unsafe or duplicate RPC configuration before observation",()=>{
  for(const rpcUrls of [["https://same.example/a","https://same.example/b"],["http://a.example","https://b.example"],["https://user:secret@a.example","https://b.example"],["https://127.0.0.1","https://b.example"]])assert.throws(()=>new IndependentDestinationPathVerifier({...config,rpcUrls},rpc()));
});
