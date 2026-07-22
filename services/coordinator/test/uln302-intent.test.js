import test from "node:test";
import assert from "node:assert/strict";
import {Interface,concat,dataSlice,getBytes,keccak256,solidityPackedKeccak256} from "ethers";
import {encodePacketV1} from "../../../dist/packages/core/src/packet-v1.js";
import {Uln302IntentFactory} from "../../../dist/services/coordinator/src/uln302-intent.js";

const a=n=>`0x${n.repeat(40)}`;
const h=n=>`0x${n.repeat(64)}`;
const b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const nonce=1n,srcEid=40161,dstEid=40231,sender=h("2"),receiver=b("4"),message="0x1234";
const guid=solidityPackedKeccak256(["uint64","uint32","bytes32","uint32","bytes32"],[nonce,srcEid,sender,dstEid,receiver]);
const encoded=encodePacketV1({nonce,srcEid,sender,dstEid,receiver,guid,message});
const payloadHash=keccak256(concat([guid,message]));
const packet={guid,srcEid,dstEid,nonce,sender,receiver,message,payloadHash,encodedPayloadHash:keccak256(encoded),txHash:h("5"),blockHash:h("6"),blockNumber:10n};
const request={packet,evidence:{uri:"https://governance.example/auth",digest:h("7"),observedAt:50,validUntil:500},decodedAction:"authorized action",policy:"exact authorization"};
const result={guid,packetDigest:payloadHash,evidenceDigest:h("7"),decision:"ALLOW",reasonCode:"GENLAYER_FINALIZED_ALLOW",finalizedAt:90,policyVersion:"v1"};
const path={observedBlockNumber:127n,observedBlockHash:h("d"),chainId:421614n,srcEid,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),confirmations:64n,requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")],quorum:3,configurationDigest:h("c")};
const receiveInterface=new Interface(["function verify(bytes packetHeader,bytes32 payloadHash,uint64 confirmations)"]);

test("builds the exact canonical ULN302 verification envelope",()=>{
  const envelope=new Uln302IntentFactory(300).create(request,result,path,100);
  assert.equal(envelope.expiry,400n);
  assert.equal(envelope.guid,guid);
  assert.equal(envelope.packetDigest,payloadHash);
  assert.equal(envelope.evidenceDigest,request.evidence.digest);
  assert.equal(envelope.verificationTarget,path.receiveLibrary);
  assert.equal(envelope.adapter,path.adapter);
  const decoded=receiveInterface.decodeFunctionData("verify",envelope.callData);
  assert.equal(getBytes(decoded[0]).length,81);
  assert.equal(decoded[0],dataSlice(encoded,0,81));
  assert.equal(decoded[1],payloadHash);
  assert.equal(decoded[2],64n);
});

test("rejects policy, evidence, packet and destination binding changes",()=>{
  const factory=new Uln302IntentFactory(300);
  const cases=[
    [request,{...result,decision:"DENY"},path,100],
    [request,{...result,guid:h("1")},path,100],
    [request,{...result,packetDigest:h("1")},path,100],
    [request,{...result,evidenceDigest:h("1")},path,100],
    [{...request,evidence:{...request.evidence,validUntil:399}},result,path,100],
    [request,{...result,finalizedAt:101},path,100],
    [{...request,packet:{...packet,encodedPayloadHash:h("1")}},result,path,100],
    [{...request,packet:{...packet,message:"0xab"}},result,path,100],
    [{...request,packet:{...packet,payloadHash:h("1")}},result,path,100],
    [request,result,{...path,oapp:a("c")},100],
    [request,result,{...path,srcEid:1},100],
    [request,result,path,-1]
  ];
  for(const args of cases)assert.throws(()=>factory.create(...args));
  assert.throws(()=>new Uln302IntentFactory(29));
  assert.throws(()=>new Uln302IntentFactory(901));
});
