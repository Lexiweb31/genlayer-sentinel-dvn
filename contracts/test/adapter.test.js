import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {BrowserProvider, ContractFactory, Interface, Wallet, getBytes, id} from "ethers";
import {executionDigest as coordinatorDigest} from "../../dist/services/coordinator/src/signing.js";

const artifact = name => JSON.parse(fs.readFileSync(`dist/contracts/${name}.json`, "utf8"));
async function fixture() {
  const chain = ganache.provider({logging:{quiet:true},wallet:{totalAccounts:6},chain:{chainId:31337,hardfork:"shanghai"}});
  const provider = new BrowserProvider(chain); const initial=chain.getInitialAccounts();
  const wallets=Object.values(initial).map(v=>new Wallet(v.secretKey,provider)); const deployer=wallets[0];
  const targetA=artifact("MockVerificationTarget"); const target=await new ContractFactory(targetA.abi,targetA.evm.bytecode.object,deployer).deploy(); await target.waitForDeployment();
  const signerWallets=wallets.slice(2,5).sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const adapterA=artifact("SentinelDVNAdapter"); const adapter=await new ContractFactory(adapterA.abi,adapterA.evm.bytecode.object,wallets[1]).deploy(deployer.address,await target.getAddress(),40231,signerWallets.map(x=>x.address),2); await adapter.waitForDeployment();
  assert.notEqual(await adapter.getAddress(),await target.getAddress());
  assert.equal((await adapter.verificationTarget()).toLowerCase(),(await target.getAddress()).toLowerCase());
  return {adapter:adapter.connect(await provider.getSigner(5)),target,signerWallets};
}
test("executes an approved verification once with sorted quorum signatures",async()=>{
  const {adapter,target,signerWallets}=await fixture(); const callData=new Interface(["function verify(bytes32)"]).encodeFunctionData("verify",[id("verified")]); const block=await adapter.runner.provider.getBlock("latest"); const expiry=BigInt(block.timestamp+600); const guid=id("guid"),packet=id("packet"),evidence=id("evidence"); const digest=await adapter.executionDigest(guid,packet,evidence,callData,expiry);assert.equal(coordinatorDigest({chainId:31337n,adapter:await adapter.getAddress(),verificationTarget:await target.getAddress(),guid,packetDigest:packet,evidenceDigest:evidence,callData,expiry}),digest);
  const signed=[];for(const wallet of signerWallets.slice(0,2))signed.push({address:wallet.address.toLowerCase(),sig:await wallet.signMessage(getBytes(digest))});signed.sort((a,b)=>a.address.localeCompare(b.address));await(await adapter.submitVerification(guid,packet,evidence,callData,expiry,signed.map(x=>x.sig))).wait();assert.equal(await target.last(),id("verified"));await assert.rejects(async()=>{const tx=await adapter.submitVerification(guid,packet,evidence,callData,expiry,signed.map(x=>x.sig));await tx.wait()});
});
test("rejects insufficient quorum and reverts target failures atomically",async()=>{
  const {adapter,signerWallets}=await fixture();const callData=new Interface(["function fail()"]).encodeFunctionData("fail");const block=await adapter.runner.provider.getBlock("latest");const expiry=BigInt(block.timestamp+600);const args=[id("g"),id("p"),id("e"),callData,expiry];const digest=await adapter.executionDigest(...args);await assert.rejects(adapter.submitVerification(...args,[await signerWallets[0].signMessage(getBytes(digest))]));const sigs=[];for(const w of signerWallets.slice(0,2))sigs.push({a:w.address.toLowerCase(),s:await w.signMessage(getBytes(digest))});sigs.sort((x,y)=>x.a.localeCompare(y.a));await assert.rejects(adapter.submitVerification(...args,sigs.map(x=>x.s)));assert.equal(await adapter.used(digest),false);
});
