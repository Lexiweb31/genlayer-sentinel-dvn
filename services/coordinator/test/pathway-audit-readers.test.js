import test from "node:test";
import assert from "node:assert/strict";
import {Interface,keccak256} from "ethers";
import {readSourcePathObservation} from "../../../dist/services/coordinator/src/source-path-verifier.js";
import {readDestinationPathObservation} from "../../../dist/services/coordinator/src/destination-path-verifier.js";
import {PathwayAuditError} from "../../../dist/services/coordinator/src/pathway-audit-model.js";

const address=value=>`0x${value.toString(16).padStart(40,"0")}`;
const peer=value=>`0x${"0".repeat(24)}${value.toString(16).padStart(40,"0")}`;
const endpoint=new Interface([
  "function getSendLibrary(address sender,uint32 dstEid) view returns(address lib)",
  "function isDefaultSendLibrary(address sender,uint32 dstEid) view returns(bool)",
  "function getReceiveLibrary(address receiver,uint32 srcEid) view returns(address lib,bool isDefault)"
]);
const uln=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function executorConfigs(address oapp,uint32 remoteEid) view returns(uint32 maxMessageSize,address executor)"
]);
const oapp=new Interface(["function peers(uint32 eid) view returns(bytes32 peer)"]);
const adapter=new Interface([
  "function messageLib() view returns(address)",
  "function verificationTarget() view returns(address)",
  "function supportedDstEid() view returns(uint32)",
  "function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)"
]);

const signers=[11,12,13,14,15].map(address);
const sourceInput={endpoint:address(1),sourceOApp:address(2),dstEid:40231,adapter:address(3),authorizedSigners:signers};
const destinationInput={endpoint:address(4),oapp:address(5),srcEid:40161,adapter:address(6),authorizedSigners:signers};
const sourceUln=[15n,1,2,1,[address(7)],[address(8),address(9)]];
const destinationUln=[64n,1,2,1,[address(7)],[address(8),address(9)]];

function reader(options={}){
  const codes=new Map(Object.entries(options.codes??{}).map(([key,value])=>[key.toLowerCase(),value]));
  return{
    getCode:async target=>{options.codeCalls?.push(target);return codes.get(target.toLowerCase())??"0x6000";},
    call:async(to,data)=>{
      options.calls?.push({to,data});
      if(options.malformed&&data.startsWith(options.malformed.selector))return "0x1234";
      if(data.startsWith(endpoint.getFunction("getSendLibrary").selector)){const value=endpoint.encodeFunctionResult("getSendLibrary",[options.sendLibrary??address(10)]);return options.trailing?`${value}00`:value;}
      if(data.startsWith(endpoint.getFunction("isDefaultSendLibrary").selector))return options.nonCanonicalBool?`0x${"0".repeat(63)}2`:endpoint.encodeFunctionResult("isDefaultSendLibrary",[options.sourceDefault??false]);
      if(data.startsWith(endpoint.getFunction("getReceiveLibrary").selector))return endpoint.encodeFunctionResult("getReceiveLibrary",[options.receiveLibrary??address(10),options.destinationDefault??false]);
      if(data.startsWith(uln.getFunction("isSupportedEid").selector))return uln.encodeFunctionResult("isSupportedEid",[options.supported??true]);
      if(data.startsWith(uln.getFunction("getAppUlnConfig").selector))return uln.encodeFunctionResult("getAppUlnConfig",[options.appUln??destinationUln]);
      if(data.startsWith(uln.getFunction("getUlnConfig").selector))return uln.encodeFunctionResult("getUlnConfig",[options.rawUln??destinationUln]);
      if(data.startsWith(uln.getFunction("executorConfigs").selector))return uln.encodeFunctionResult("executorConfigs",[options.maxMessageSize??10000,options.executor??address(16)]);
      if(data.startsWith(oapp.getFunction("peers").selector))return oapp.encodeFunctionResult("peers",[options.pathPeer??peer(17)]);
      if(data.startsWith(adapter.getFunction("messageLib").selector))return adapter.encodeFunctionResult("messageLib",[options.messageLib??address(10)]);
      if(data.startsWith(adapter.getFunction("verificationTarget").selector))return adapter.encodeFunctionResult("verificationTarget",[options.verificationTarget??address(18)]);
      if(data.startsWith(adapter.getFunction("supportedDstEid").selector))return adapter.encodeFunctionResult("supportedDstEid",[options.supportedDstEid??40231]);
      if(data.startsWith(adapter.getFunction("quorum").selector))return adapter.encodeFunctionResult("quorum",[options.quorum??3]);
      if(data.startsWith(adapter.getFunction("signer").selector))return adapter.encodeFunctionResult("signer",[options.signer??true]);
      throw new Error("unexpected calldata");
    }
  };
}

test("source reader returns pinned endpoint, ULN, peer, executor, and adapter observations without policy comparison",async()=>{
  const observed=await readSourcePathObservation(sourceInput,reader({appUln:sourceUln}));
  assert.deepEqual(observed,{endpoint:sourceInput.endpoint,sourceOApp:sourceInput.sourceOApp,dstEid:40231,sendLibrary:address(10),isDefaultSendLibrary:false,supportedEid:true,uln:{confirmations:15n,requiredDvns:[address(7)],optionalDvns:[address(8),address(9)],optionalDvnThreshold:1},dvnCodeKeccak256:[address(7),address(8),address(9)].map(value=>({address:value,codeKeccak256:keccak256("0x6000")})),executor:{maxMessageSize:10000,address:address(16)},destinationPeer:peer(17),adapter:{address:sourceInput.adapter,messageLib:address(10),verificationTarget:address(18),supportedDstEid:40231,quorum:3n,signersAuthorized:[true,true,true,true,true]}});
});

test("source reader calls each exact contract method with its exact arguments, including five distinct signers",async()=>{
  const calls=[];
  await readSourcePathObservation(sourceInput,reader({appUln:sourceUln,calls}));
  const wanted=[
    [sourceInput.endpoint,endpoint.encodeFunctionData("getSendLibrary",[sourceInput.sourceOApp,40231])],
    [sourceInput.endpoint,endpoint.encodeFunctionData("isDefaultSendLibrary",[sourceInput.sourceOApp,40231])],
    [address(10),uln.encodeFunctionData("isSupportedEid",[40231])],
    [address(10),uln.encodeFunctionData("getAppUlnConfig",[sourceInput.sourceOApp,40231])],
    [address(10),uln.encodeFunctionData("executorConfigs",[sourceInput.sourceOApp,40231])],
    [sourceInput.sourceOApp,oapp.encodeFunctionData("peers",[40231])],
    [sourceInput.adapter,adapter.encodeFunctionData("messageLib")],
    [sourceInput.adapter,adapter.encodeFunctionData("verificationTarget")],
    [sourceInput.adapter,adapter.encodeFunctionData("supportedDstEid")],
    [sourceInput.adapter,adapter.encodeFunctionData("quorum")],
    ...signers.map(signer=>[sourceInput.adapter,adapter.encodeFunctionData("signer",[signer])])
  ];
  assert.deepEqual(calls,wanted.map(([to,data])=>({to,data})));
  assert.equal(calls.length,15);
  assert.equal(new Set(calls.slice(-5).map(call=>call.data)).size,5);
});

test("destination reader returns raw and resolved ULN, source peer, and adapter observations without policy comparison",async()=>{
  const raw=[1n,1,0,0,[address(7)],[]],resolved=destinationUln;
  const observed=await readDestinationPathObservation(destinationInput,reader({rawUln:raw,appUln:resolved,pathPeer:peer(19)}));
  assert.deepEqual(observed,{endpoint:destinationInput.endpoint,oapp:destinationInput.oapp,srcEid:40161,receiveLibrary:address(10),isDefaultReceiveLibrary:false,supportedEid:true,rawAppUln:{confirmations:64n,requiredDvns:[address(7)],optionalDvns:[address(8),address(9)],optionalDvnThreshold:1},resolvedUln:{confirmations:1n,requiredDvns:[address(7)],optionalDvns:[],optionalDvnThreshold:0},sourcePeer:peer(19),adapter:{address:destinationInput.adapter,messageLib:address(10),verificationTarget:address(18),supportedDstEid:40231,quorum:3n,signersAuthorized:[true,true,true,true,true]}});
});

test("destination reader calls the endpoint, receive library, OApp, and each signer with exact arguments",async()=>{
  const calls=[];
  await readDestinationPathObservation(destinationInput,reader({calls}));
  const wanted=[
    [destinationInput.endpoint,endpoint.encodeFunctionData("getReceiveLibrary",[destinationInput.oapp,40161])],
    [address(10),uln.encodeFunctionData("isSupportedEid",[40161])],
    [address(10),uln.encodeFunctionData("getUlnConfig",[destinationInput.oapp,40161])],
    [address(10),uln.encodeFunctionData("getAppUlnConfig",[destinationInput.oapp,40161])],
    [destinationInput.oapp,oapp.encodeFunctionData("peers",[40161])],
    [destinationInput.adapter,adapter.encodeFunctionData("messageLib")],
    [destinationInput.adapter,adapter.encodeFunctionData("verificationTarget")],
    [destinationInput.adapter,adapter.encodeFunctionData("supportedDstEid")],
    [destinationInput.adapter,adapter.encodeFunctionData("quorum")],
    ...signers.map(signer=>[destinationInput.adapter,adapter.encodeFunctionData("signer",[signer])])
  ];
  assert.deepEqual(calls,wanted.map(([to,data])=>({to,data})));
  assert.equal(calls.length,14);
  assert.equal(new Set(calls.slice(-5).map(call=>call.data)).size,5);
});

test("destination reader distinguishes raw app ULN storage from resolved ULN configuration",async()=>{
  const rawApp=[0n,0,0,0,[],[]],resolved=[64n,1,2,1,[address(7)],[address(8),address(9)]];
  const observed=await readDestinationPathObservation(destinationInput,reader({rawUln:resolved,appUln:rawApp}));
  assert.deepEqual(observed.rawAppUln,{confirmations:0n,requiredDvns:[],optionalDvns:[],optionalDvnThreshold:0});
  assert.deepEqual(observed.resolvedUln,{confirmations:64n,requiredDvns:[address(7)],optionalDvns:[address(8),address(9)],optionalDvnThreshold:1});
});

test("readers reject noncanonical ABI result words, trailing result words, and out-of-range EIDs deterministically",async()=>{
  const deterministic=error=>{
    assert.equal(error instanceof PathwayAuditError,true);
    assert.equal(error.code,"PATHWAY_AUDIT_OBSERVATION_FAILED");
    assert.equal(error.message,"PATHWAY_AUDIT_OBSERVATION_FAILED");
    return true;
  };
  await assert.rejects(readSourcePathObservation(sourceInput,reader({trailing:true})),deterministic);
  await assert.rejects(readSourcePathObservation(sourceInput,reader({nonCanonicalBool:true})),deterministic);
  await assert.rejects(readDestinationPathObservation({...destinationInput,srcEid:2**32},reader()),deterministic);
});

test("source reader requires bytecode for every observed required and optional DVN",async()=>{
  await assert.rejects(readSourcePathObservation(sourceInput,reader({appUln:sourceUln,codes:{[address(7)]:"0x"}})),error=>{
    assert.equal(error.code,"PATHWAY_AUDIT_OBSERVATION_FAILED");
    return true;
  });
  await assert.rejects(readSourcePathObservation(sourceInput,reader({appUln:sourceUln,codes:{[address(9)]:"0x"}})),error=>{
    assert.equal(error.code,"PATHWAY_AUDIT_OBSERVATION_FAILED");
    return true;
  });
});

test("readers fail closed on malformed ABI, zero addresses, empty code, ULN count disagreement, duplicate or unsorted DVNs, and invalid thresholds",async()=>{
  const invalid=[
    ["malformed ABI",reader({malformed:{selector:endpoint.getFunction("getSendLibrary").selector}})],
    ["zero address",reader({sendLibrary:address(0)})],
    ["empty code",reader({codes:{[sourceInput.endpoint]:"0x"}})],
    ["count disagreement",reader({appUln:[15n,2,2,1,[address(7)],[address(8),address(9)]]})],
    ["duplicated DVN",reader({appUln:[15n,1,2,1,[address(7)],[address(8),address(8)]]})],
    ["unsorted DVN",reader({appUln:[15n,1,2,1,[address(7)],[address(9),address(8)]]})],
    ["invalid threshold",reader({appUln:[15n,1,2,3,[address(7)],[address(8),address(9)]]})]
  ];
  const deterministic=error=>{
    assert.equal(error instanceof PathwayAuditError,true);
    assert.equal(error.code,"PATHWAY_AUDIT_OBSERVATION_FAILED");
    assert.equal(error.message,"PATHWAY_AUDIT_OBSERVATION_FAILED");
    return true;
  };
  for(const [,pinnedReader] of invalid)await assert.rejects(readSourcePathObservation(sourceInput,pinnedReader),deterministic);
  await assert.rejects(readDestinationPathObservation(destinationInput,reader({rawUln:[64n,1,2,3,[address(7)],[address(8),address(9)]]})),deterministic);
  await assert.rejects(readDestinationPathObservation(destinationInput,reader({codes:{[destinationInput.adapter]:"0x"}})),deterministic);
});
