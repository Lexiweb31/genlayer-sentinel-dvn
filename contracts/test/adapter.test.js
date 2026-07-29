import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {ContractFactory, Interface, getBytes, id} from "ethers";
import {executionDigest as coordinatorDigest} from "../../dist/services/coordinator/src/signing.js";
import {startLocalEvm} from "./local-evm.js";

const artifact = name => JSON.parse(fs.readFileSync(`dist/contracts/${name}.json`, "utf8"));
async function fixture(t) {
  const {signers, close} = await startLocalEvm(6);
  t.after(close);
  const deployerAddress = await signers[0].getAddress();
  const targetA=artifact("MockVerificationTarget"); const target=await new ContractFactory(targetA.abi,targetA.evm.bytecode.object,signers[0]).deploy(); await target.waitForDeployment();
  const signerRecords=await Promise.all(signers.slice(2,5).map(async signer=>({signer,address:(await signer.getAddress()).toLowerCase()})));
  signerRecords.sort((a,b)=>a.address.localeCompare(b.address));
  const adapterA=artifact("SentinelDVNAdapter"); const adapter=await new ContractFactory(adapterA.abi,adapterA.evm.bytecode.object,signers[1]).deploy(deployerAddress,await target.getAddress(),40231,signerRecords.map(x=>x.address),2); await adapter.waitForDeployment();
  assert.notEqual(await adapter.getAddress(),await target.getAddress());
  assert.equal((await adapter.verificationTarget()).toLowerCase(),(await target.getAddress()).toLowerCase());
  return {
    adapter: adapter.connect(signers[5]),
    messageLibAdapter: adapter.connect(signers[0]),
    target,
    signerRecords,
  };
}
test("executes an approved verification once with sorted quorum signatures",async t=>{
  const {adapter,target,signerRecords}=await fixture(t);const packetHeader=`0x${"11".repeat(81)}`,packet=id("packet"),confirmations=64n;const callData=new Interface(["function verify(bytes,bytes32,uint64)"]).encodeFunctionData("verify",[packetHeader,packet,confirmations]);const block=await adapter.runner.provider.getBlock("latest");const expiry=BigInt(block.timestamp+600);const guid=id("guid"),evidence=id("evidence");const digest=await adapter.executionDigest(guid,packet,evidence,callData,expiry);assert.equal(coordinatorDigest({chainId:31337n,adapter:await adapter.getAddress(),verificationTarget:await target.getAddress(),guid,packetDigest:packet,evidenceDigest:evidence,callData,expiry}),digest);
  const signed=[];for(const record of signerRecords.slice(0,2))signed.push({address:record.address,sig:await record.signer.signMessage(getBytes(digest))});signed.sort((a,b)=>a.address.localeCompare(b.address));await(await adapter.submitVerification(guid,packet,evidence,callData,expiry,signed.map(x=>x.sig))).wait();assert.equal(await target.lastHeader(),packetHeader);assert.equal(await target.lastPayloadHash(),packet);assert.equal(await target.lastConfirmations(),confirmations);await assert.rejects(async()=>{const tx=await adapter.submitVerification(guid,packet,evidence,callData,expiry,signed.map(x=>x.sig));await tx.wait()});
});
test("rejects insufficient quorum and reverts target failures atomically",async t=>{
  const {adapter,signerRecords}=await fixture(t);const callData=new Interface(["function fail()"]).encodeFunctionData("fail");const block=await adapter.runner.provider.getBlock("latest");const expiry=BigInt(block.timestamp+600);const args=[id("g"),id("p"),id("e"),callData,expiry];const digest=await adapter.executionDigest(...args);await assert.rejects(adapter.submitVerification(...args,[await signerRecords[0].signer.signMessage(getBytes(digest))]));const sigs=[];for(const record of signerRecords.slice(0,2))sigs.push({a:record.address,s:await record.signer.signMessage(getBytes(digest))});sigs.sort((x,y)=>x.a.localeCompare(y.a));await assert.rejects(adapter.submitVerification(...args,sigs.map(x=>x.s)));assert.equal(await adapter.used(digest),false);
});
test("rejects native value on the zero-fee LayerZero job hook", async t => {
  const {messageLibAdapter} = await fixture(t);
  const job = {
    dstEid: 40231,
    packetHeader: `0x${"11".repeat(81)}`,
    payloadHash: id("payload"),
    confirmations: 64,
    sender: await messageLibAdapter.runner.getAddress(),
  };
  await assert.rejects(async () => {
    const transaction = await messageLibAdapter.assignJob(job, "0x", {value: 1});
    await transaction.wait();
  });
  assert.equal(
    await messageLibAdapter.runner.provider.getBalance(await messageLibAdapter.getAddress()),
    0n,
  );
});
