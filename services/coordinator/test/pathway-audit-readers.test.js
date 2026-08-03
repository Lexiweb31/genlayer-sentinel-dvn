import test from "node:test";
import assert from "node:assert/strict";
import {Interface} from "ethers";
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
    getCode:async target=>codes.get(target.toLowerCase())??"0x6000",
    call:async(to,data)=>{
      if(options.malformed&&data.startsWith(options.malformed.selector))return "0x1234";
      if(data.startsWith(endpoint.getFunction("getSendLibrary").selector))return endpoint.encodeFunctionResult("getSendLibrary",[options.sendLibrary??address(10)]);
      if(data.startsWith(endpoint.getFunction("isDefaultSendLibrary").selector))return endpoint.encodeFunctionResult("isDefaultSendLibrary",[options.sourceDefault??false]);
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
  assert.deepEqual(observed,{endpoint:sourceInput.endpoint,sourceOApp:sourceInput.sourceOApp,dstEid:40231,sendLibrary:address(10),isDefaultSendLibrary:false,supportedEid:true,uln:{confirmations:15n,requiredDvns:[address(7)],optionalDvns:[address(8),address(9)],optionalDvnThreshold:1},executor:{maxMessageSize:10000,address:address(16)},destinationPeer:peer(17),adapter:{address:sourceInput.adapter,messageLib:address(10),verificationTarget:address(18),supportedDstEid:40231,quorum:3n,signersAuthorized:[true,true,true,true,true]}});
});

test("destination reader returns raw and resolved ULN, source peer, and adapter observations without policy comparison",async()=>{
  const raw=[1n,1,0,0,[address(7)],[]],resolved=destinationUln;
  const observed=await readDestinationPathObservation(destinationInput,reader({rawUln:raw,appUln:resolved,pathPeer:peer(19)}));
  assert.deepEqual(observed,{endpoint:destinationInput.endpoint,oapp:destinationInput.oapp,srcEid:40161,receiveLibrary:address(10),isDefaultReceiveLibrary:false,supportedEid:true,rawUln:{confirmations:1n,requiredDvns:[address(7)],optionalDvns:[],optionalDvnThreshold:0},appUln:{confirmations:64n,requiredDvns:[address(7)],optionalDvns:[address(8),address(9)],optionalDvnThreshold:1},sourcePeer:peer(19),adapter:{address:destinationInput.adapter,messageLib:address(10),verificationTarget:address(18),supportedDstEid:40231,quorum:3n,signersAuthorized:[true,true,true,true,true]}});
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
