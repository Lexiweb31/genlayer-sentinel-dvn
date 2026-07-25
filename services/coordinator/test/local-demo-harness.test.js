import test from "node:test";
import assert from "node:assert/strict";
import {Wallet,parseEther} from "ethers";
import {startLocalDemo,startLocalEvm} from "../../../dist/services/coordinator/src/local-demo-harness.js";
import {parseLocalDemoArgs} from "../../../dist/services/coordinator/src/local-demo-cli.js";

test("rejects unsafe or incomplete options before starting local infrastructure",async()=>{
  const owner=Wallet.createRandom().address;
  for(const options of[
    {},
    {owner:"0x0",appHost:"127.0.0.1",appPort:0,pollIntervalMs:25},
    {owner,appHost:"0.0.0.0",appPort:0,pollIntervalMs:25},
    {owner,appHost:"localhost",appPort:0,pollIntervalMs:25},
    {owner,appHost:"127.0.0.1",appPort:-1,pollIntervalMs:25},
    {owner,appHost:"127.0.0.1",appPort:65536,pollIntervalMs:25},
    {owner,appHost:"127.0.0.1",appPort:0,pollIntervalMs:0}
  ])await assert.rejects(startLocalDemo(options));
});

test("starts an isolated loopback app with wallet ownership, public capability and idempotent cleanup",async t=>{
  const owner=Wallet.createRandom().address;
  const session=await startLocalDemo({owner,appHost:"127.0.0.1",appPort:0,pollIntervalMs:25});
  let stopped=false;t.after(async()=>{if(!stopped)await session.stop()});
  assert.equal(session.capability.mode,"LOCAL_WALLET_DEMO");
  assert.equal(session.capability.chainId,31337n);
  assert.equal(session.capability.semanticSource,"LOCAL_POLICY_FIXTURE");
  assert.equal((await session.sourceOApp.owner()).toLowerCase(),owner.toLowerCase());
  assert.equal(new URL(session.appUrl).hostname,"127.0.0.1");
  assert.equal(new URL(session.rpcUrl).hostname,"127.0.0.1");
  assert.ok(new URL(session.appUrl).port);
  assert.ok(new URL(session.rpcUrl).port);
  assert.equal(await session.provider.getBalance(owner),parseEther("100"));
  assert.deepEqual(session.metrics,{signerCalls:0,destinationSubmissions:0});
  assert.equal(Object.keys(session).some(key=>/private|secret|mnemonic|signer/i.test(key)),false);

  const health=await fetch(`${session.appUrl}/health`).then(response=>response.json());
  assert.deepEqual(health,{status:"ok",mode:"testnet-prototype",presentationMode:"LOCAL_TEST"});
  const capability=await fetch(`${session.appUrl}/api/demo/config`).then(response=>response.json());
  assert.equal(capability.sourceOApp,(await session.sourceOApp.getAddress()).toLowerCase());
  assert.equal(capability.rpcUrl,session.rpcUrl);
  assert.equal(JSON.stringify(capability).match(/private|secret|mnemonic|signer/ig),null);
  await session.tickOnce();
  await session.stop();await session.stop();stopped=true;
  await assert.rejects(session.tickOnce(),/stopping or stopped/);
  await assert.rejects(fetch(`${session.appUrl}/health`));
});

test("rejects an owner controlled by the harness unlocked account set",async()=>{
  const probe=await startLocalEvm(20);
  const owner=await probe.signers[19].getAddress();
  await probe.close();
  const outcome=await startLocalDemo({owner,appHost:"127.0.0.1",appPort:0,pollIntervalMs:25}).then(
    async session=>{await session.stop();return undefined},
    error=>error
  );
  assert.match(String(outcome?.message),/owner must not be a local unlocked account/);
});

test("parses only the narrow CLI surface and rejects ambiguous arguments",()=>{
  const owner=Wallet.createRandom().address;
  assert.deepEqual(parseLocalDemoArgs(["--owner",owner]),{owner,appHost:"127.0.0.1",appPort:4173,pollIntervalMs:500});
  assert.deepEqual(parseLocalDemoArgs(["--owner",owner,"--port","4180"]),{owner,appHost:"127.0.0.1",appPort:4180,pollIntervalMs:500});
  for(const args of[
    [],
    ["--owner",owner,"--port","0"],
    ["--owner",owner,"--port","65536"],
    ["--owner",owner,"--unknown","x"],
    ["--owner",owner,"--owner",owner],
    ["--owner",owner,"extra"]
  ])assert.throws(()=>parseLocalDemoArgs(args));
});
