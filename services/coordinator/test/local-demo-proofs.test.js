import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AbiCoder,
  ContractFactory,
  Interface,
  getBytes,
  id,
  keccak256,
  sha256,
  toUtf8Bytes,
  zeroPadValue
} from "ethers";
import {startLocalEvm} from "../../../contracts/test/local-evm.js";
import {decodePacketV1} from "../../../dist/packages/core/src/packet-v1.js";
import {SentinelJob} from "../../../dist/packages/core/src/state-machine.js";
import {Coordinator} from "../../../dist/services/coordinator/src/coordinator.js";
import {
  LocalEdrDestinationVerifier,
  LocalEdrPacketVerifier,
  LocalEdrPathVerifier,
  LocalOAppExecutionConfirmer
} from "../../../dist/services/coordinator/src/local-demo-proofs.js";
import {executionDigest} from "../../../dist/services/coordinator/src/signing.js";

const artifact=name=>JSON.parse(fs.readFileSync(`dist/contracts/${name}.json`,"utf8"));
const hash=value=>`0x${value.repeat(64)}`;
const address=value=>`0x${value.repeat(40)}`;
const recordInterface=new Interface(["function record(bytes32)"]);
const verifyInterface=new Interface(["function verify(bytes,bytes32,uint64)"]);
const adapterInterface=new Interface(["event Verified(bytes32 indexed guid,bytes32 indexed packetDigest,bytes32 evidenceDigest,bytes32 executionDigest)"]);

async function deploy(name,signer,...args){
  const value=artifact(name);
  const contract=await new ContractFactory(value.abi,value.evm.bytecode.object,signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function fixture(t){
  const evm=await startLocalEvm(12);t.after(evm.close);
  const [deployer,sourceOwner,destinationOwner,targetOwner]=evm.signers;
  const epA=await deploy("MockEndpointV2",deployer,40161);
  const epB=await deploy("MockEndpointV2",deployer,40231);
  const source=await deploy("TreasuryPolicyOApp",sourceOwner,await epA.getAddress(),await sourceOwner.getAddress());
  const destination=await deploy("TreasuryPolicyOApp",destinationOwner,await epB.getAddress(),await destinationOwner.getAddress());
  const target=await deploy("ActionTarget",targetOwner);
  const verificationTarget=await deploy("MockVerificationTarget",deployer);
  const signerRecords=await Promise.all(evm.signers.slice(5,10).map(async signer=>({signer,address:(await signer.getAddress()).toLowerCase()})));
  signerRecords.sort((left,right)=>left.address.localeCompare(right.address));
  const adapter=await deploy("SentinelDVNAdapter",deployer,await epB.getAddress(),await verificationTarget.getAddress(),40231,signerRecords.map(value=>value.address),3);
  await(await epA.setOptionalDvn(await adapter.getAddress())).wait();
  await(await epB.setOptionalDvn(await adapter.getAddress())).wait();
  const sourcePeer=zeroPadValue(await source.getAddress(),32),destinationPeer=zeroPadValue(await destination.getAddress(),32);
  await(await source.connect(sourceOwner).setPeer(40231,destinationPeer)).wait();
  await(await destination.connect(destinationOwner).setPeer(40161,sourcePeer)).wait();
  await(await source.connect(sourceOwner).setAuthorizedTarget(await target.getAddress(),true)).wait();
  await(await destination.connect(destinationOwner).setAuthorizedTarget(await target.getAddress(),true)).wait();
  const approvedArgument=id("approved");
  const action={authorizationId:id("authorization"),target:await target.getAddress(),value:0n,data:recordInterface.encodeFunctionData("record",[approvedArgument])};
  const quote=await source.quoteAction(40231,action,"0x",false);
  const fee={nativeFee:quote.nativeFee,lzTokenFee:quote.lzTokenFee};
  const sourceTx=await source.connect(sourceOwner).sendAction(40231,action,"0x",fee,{value:fee.nativeFee});
  const sourceReceipt=await sourceTx.wait();
  const sent=sourceReceipt.logs.map(log=>{try{return epA.interface.parseLog(log)}catch{return null}}).find(log=>log?.name==="PacketSent");
  assert.ok(sent);
  const decoded=decodePacketV1(sent.args.encodedPayload);
  const packet={
    guid:decoded.guid,srcEid:decoded.srcEid,dstEid:decoded.dstEid,nonce:decoded.nonce,
    sender:decoded.sender,receiver:decoded.receiver,message:decoded.message,payloadHash:decoded.payloadHash,
    encodedPayloadHash:keccak256(sent.args.encodedPayload),txHash:sourceTx.hash,blockHash:sourceReceipt.blockHash,
    blockNumber:BigInt(sourceReceipt.blockNumber)
  };
  const rpc=(method,params)=>evm.provider.send(method,params);
  return{...evm,epA,epB,source,destination,target,verificationTarget,adapter,signerRecords,sourcePeer,approvedArgument,action,packet,rpc};
}

test("proves one real PacketSent through separately labeled local packet and receipt checks",async t=>{
  const f=await fixture(t);
  const verifier=new LocalEdrPacketVerifier(f.rpc,await f.epA.getAddress(),1n);
  const proofs=await verifier.verify(f.packet);
  assert.deepEqual(proofs.map(value=>value.provider),["LOCAL_EDR_FIXTURE_PACKET","LOCAL_EDR_FIXTURE_RECEIPT"]);
  assert.ok(proofs.every(value=>value.confirmations>=1n));
  assert.ok(proofs.every(value=>value.blockHash===f.packet.blockHash&&value.payloadHash===f.packet.payloadHash));

  const failedRpc=async(method,params)=>method==="eth_getTransactionReceipt"?{...(await f.rpc(method,params)),status:"0x0"}:f.rpc(method,params);
  await assert.rejects(new LocalEdrPacketVerifier(failedRpc,await f.epA.getAddress(),1n).verify(f.packet),/receipt failed/);
  await assert.rejects(new LocalEdrPacketVerifier(f.rpc,await f.target.getAddress(),1n).verify(f.packet),/PacketSent/);
  await assert.rejects(verifier.verify({...f.packet,blockHash:hash("e")}),/block binding/);
  await assert.rejects(verifier.verify({...f.packet,dstEid:1}),/canonical packet/);
  await assert.rejects(new LocalEdrPacketVerifier(f.rpc,await f.epA.getAddress(),2n).verify(f.packet),/confirmations/);
});

test("pins real local adapter, peer, bytecode, signer quorum and block state",async t=>{
  const f=await fixture(t),adapterAddress=await f.adapter.getAddress();
  const config={
    chainId:31337n,srcEid:40161,endpoint:await f.epB.getAddress(),
    receiveLibrary:await f.verificationTarget.getAddress(),oapp:await f.destination.getAddress(),
    adapter:adapterAddress,sourcePeer:f.sourcePeer,confirmations:1n,
    requiredDvns:[await f.signers[10].getAddress()],optionalDvns:[adapterAddress],
    optionalDvnThreshold:1,authorizedSigners:f.signerRecords.map(value=>value.address),quorum:3
  };
  const path=await new LocalEdrPathVerifier(f.rpc,config).verify();
  assert.equal(path.chainId,31337n);
  assert.equal(path.quorum,3);
  assert.deepEqual(path.authorizedSigners,config.authorizedSigners);
  assert.deepEqual(path.optionalDvns,[adapterAddress.toLowerCase()]);
  assert.match(path.configurationDigest,/^0x[0-9a-f]{64}$/);
  await assert.rejects(new LocalEdrPathVerifier(f.rpc,{...config,sourcePeer:hash("f")}).verify(),/configuration drift/);
  await assert.rejects(new LocalEdrPathVerifier(f.rpc,{...config,authorizedSigners:[...config.authorizedSigners.slice(0,4),address("f")]}).verify(),/configuration drift/);
  assert.throws(()=>new LocalEdrPathVerifier(f.rpc,{...config,verificationTarget:address("c")}),/unknown configuration field/);
});

test("confirms a real adapter receipt only after exact event, used state and local confirmations",async t=>{
  const f=await fixture(t);
  const latest=await f.provider.getBlock("latest"),expiry=BigInt(latest.timestamp+600);
  const callData=verifyInterface.encodeFunctionData("verify",["0x1234",f.packet.payloadHash,1n]);
  const envelope={chainId:31337n,adapter:await f.adapter.getAddress(),verificationTarget:await f.verificationTarget.getAddress(),guid:f.packet.guid,packetDigest:f.packet.payloadHash,evidenceDigest:hash("7"),callData,expiry};
  const digest=executionDigest(envelope),shares=[];
  for(const value of f.signerRecords.slice(0,3))shares.push({address:value.address,digest,signature:await value.signer.signMessage(getBytes(digest))});
  const transaction=await f.adapter.connect(f.signers[11]).submitVerification(envelope.guid,envelope.packetDigest,envelope.evidenceDigest,envelope.callData,envelope.expiry,shares.map(value=>value.signature));
  await transaction.wait();
  const record={guid:f.packet.guid,digest,envelope,shares,state:"SUBMITTED",transactionHash:transaction.hash,createdAt:latest.timestamp,updatedAt:latest.timestamp};
  const confirmed=await new LocalEdrDestinationVerifier(f.rpc,await f.adapter.getAddress(),1n).confirm(record);
  assert.deepEqual(confirmed,{status:"CONFIRMED",confirmations:1n});
  assert.deepEqual(await new LocalEdrDestinationVerifier(f.rpc,await f.adapter.getAddress(),2n).confirm(record),{status:"PENDING"});
  assert.deepEqual(await new LocalEdrDestinationVerifier(f.rpc,await f.adapter.getAddress(),1n).confirm({...record,digest:hash("d")}),{status:"FAILED",code:"EVENT_MISMATCH"});
  const unusedRpc=async(method,params)=>{
    if(method==="eth_call"&&params[0]?.to?.toLowerCase()===(await f.adapter.getAddress()).toLowerCase())return AbiCoder.defaultAbiCoder().encode(["bool"],[false]);
    return f.rpc(method,params);
  };
  assert.deepEqual(await new LocalEdrDestinationVerifier(unusedRpc,await f.adapter.getAddress(),1n).confirm(record),{status:"FAILED",code:"ADAPTER_UNUSED"});
});

test("delivers the exact authorized message once and confirms real destination OApp execution",async t=>{
  const f=await fixture(t),evidenceBody='{"status":"AUTHORIZED"}',evidenceDigest=sha256(toUtf8Bytes(evidenceBody));
  const request={packet:f.packet,evidence:{uri:"https://governance.fixture.invalid/authorization",digest:evidenceDigest,observedAt:1,validUntil:9999999999},decodedAction:JSON.stringify({authorizationId:f.action.authorizationId,target:f.action.target.toLowerCase(),value:"0",selector:f.action.data.slice(0,10),calldata:f.action.data}),policy:"exact authorization required"};
  const result={guid:f.packet.guid,packetDigest:f.packet.payloadHash,evidenceDigest,decision:"ALLOW",reasonCode:"LOCAL_FIXTURE_ALLOW",finalizedAt:1,policyVersion:"local-demo-v1"};
  const coordinator=new Coordinator({verify:async()=>[]},{submit:async()=>"",finalized:async()=>undefined},[],3);
  const signers=f.signerRecords.slice(0,3).map(value=>value.address);
  coordinator.requests.set(f.packet.guid,request);
  coordinator.jobs.set(f.packet.guid,SentinelJob.restore({packet:f.packet,stage:"QUORUM_REACHED",verifications:[],signers,result}));
  let sends=0;
  const rpc=async(method,params)=>{if(method==="eth_sendTransaction")sends++;return f.rpc(method,params)};
  const confirmer=new LocalOAppExecutionConfirmer(coordinator,rpc,{from:await f.signers[11].getAddress(),endpoint:await f.epB.getAddress(),oapp:await f.destination.getAddress(),actionTarget:await f.target.getAddress()});
  await confirmer.assertDeliveryReady(f.packet.guid,signers);
  await confirmer.confirmExecution(f.packet.guid);
  assert.equal(await f.destination.executedGuid(f.packet.guid),true);
  assert.equal(await f.target.recorded(),f.approvedArgument);
  assert.equal(coordinator.jobs.get(f.packet.guid).snapshot.stage,"EXECUTED");
  await confirmer.confirmExecution(f.packet.guid);
  assert.equal(sends,1);
  assert.equal(await f.target.calls(),1n);
});

test("refuses malformed coordinator delivery bindings before broadcasting",async t=>{
  const f=await fixture(t),baseGuid=f.packet.guid;
  const make=(key,packet,decodedAction)=>{
    const coordinator=new Coordinator({verify:async()=>[]},{submit:async()=>"",finalized:async()=>undefined},[],3);
    const evidenceDigest=hash("7"),request={packet,evidence:{uri:"https://governance.fixture.invalid/authorization",digest:evidenceDigest,observedAt:1,validUntil:9999999999},decodedAction,policy:"exact authorization required"};
    const result={guid:packet.guid,packetDigest:packet.payloadHash,evidenceDigest,decision:"ALLOW",reasonCode:"LOCAL_FIXTURE_ALLOW",finalizedAt:1,policyVersion:"local-demo-v1"};
    coordinator.requests.set(key,request);
    coordinator.jobs.set(key,SentinelJob.restore({packet:{...packet,guid:key},stage:"QUORUM_REACHED",verifications:[],signers:f.signerRecords.slice(0,3).map(value=>value.address),result:{...result,guid:key}}));
    return coordinator;
  };
  const decoded=JSON.stringify({authorizationId:f.action.authorizationId,target:f.action.target.toLowerCase(),value:"0",selector:f.action.data.slice(0,10),calldata:f.action.data});
  const cases=[
    [baseGuid,{...f.packet,sender:hash("b")},decoded],
    [baseGuid,{...f.packet,message:"0x1234"},decoded],
    [baseGuid,{...f.packet,guid:hash("c")},decoded],
    [baseGuid,f.packet,JSON.stringify({...JSON.parse(decoded),target:address("d")})]
  ];
  for(const [key,packet,action]of cases){
    let sends=0;const rpc=async(method,params)=>{if(method==="eth_sendTransaction")sends++;return f.rpc(method,params)};
    const confirmer=new LocalOAppExecutionConfirmer(make(key,packet,action),rpc,{from:await f.signers[11].getAddress(),endpoint:await f.epB.getAddress(),oapp:await f.destination.getAddress(),actionTarget:await f.target.getAddress()});
    await assert.rejects(confirmer.confirmExecution(key),/delivery binding/);
    assert.equal(sends,0);
  }
});

test("shares a durable executor reservation across confirmer restarts so an ambiguous delivery is never resent",async t=>{
  const f=await fixture(t),evidenceDigest=hash("7");
  const decodedAction=JSON.stringify({authorizationId:f.action.authorizationId,target:f.action.target.toLowerCase(),value:"0",selector:f.action.data.slice(0,10),calldata:f.action.data});
  const request={packet:f.packet,evidence:{uri:"https://governance.fixture.invalid/authorization",digest:evidenceDigest,observedAt:1,validUntil:9999999999},decodedAction,policy:"exact authorization required"};
  const result={guid:f.packet.guid,packetDigest:f.packet.payloadHash,evidenceDigest,decision:"ALLOW",reasonCode:"LOCAL_FIXTURE_ALLOW",finalizedAt:1,policyVersion:"local-demo-v1"};
  const coordinator=new Coordinator({verify:async()=>[]},{submit:async()=>"",finalized:async()=>undefined},[],3);
  coordinator.requests.set(f.packet.guid,request);
  coordinator.jobs.set(f.packet.guid,SentinelJob.restore({packet:f.packet,stage:"QUORUM_REACHED",verifications:[],signers:f.signerRecords.slice(0,3).map(value=>value.address),result}));
  let reserved=false,sends=0,incident;
  const attempts={
    async reserve(guid){assert.equal(guid,f.packet.guid);if(reserved)return false;reserved=true;return true},
    async recordIncident(guid,code){assert.equal(guid,f.packet.guid);incident=code}
  };
  const fakeTransaction=hash("e");
  const rpc=async(method,params)=>{
    if(method==="eth_sendTransaction"){sends++;return fakeTransaction}
    if(method==="eth_getTransactionReceipt"&&params[0]===fakeTransaction)return null;
    return f.rpc(method,params);
  };
  const config={from:await f.signers[11].getAddress(),endpoint:await f.epB.getAddress(),oapp:await f.destination.getAddress(),actionTarget:await f.target.getAddress()};
  await assert.rejects(new LocalOAppExecutionConfirmer(coordinator,rpc,config,attempts).confirmExecution(f.packet.guid),/recovery required/);
  await assert.rejects(new LocalOAppExecutionConfirmer(coordinator,rpc,config,attempts).confirmExecution(f.packet.guid),/recovery required/);
  assert.equal(sends,1);
  assert.equal(incident,"LOCAL_EXECUTION_RECOVERY_REQUIRED");
});
