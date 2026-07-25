import test from "node:test";
import assert from "node:assert/strict";
import {Wallet} from "ethers";
import {startLocalDemo} from "../../../dist/services/coordinator/src/local-demo-harness.js";
import {
  WalletActionClient,
  parsePublicDemoConfig
} from "../../../dist/apps/dashboard/src/wallet-action.js";

function eip1193(provider,wallet){
  const connected=wallet.connect(provider),calls=[];
  return{
    calls,
    async request({method,params=[]}){
      calls.push({method,params});
      if(method==="eth_requestAccounts")return[wallet.address];
      if(method==="eth_sendTransaction"){
        const transaction=params[0];
        assert.equal(transaction.from.toLowerCase(),wallet.address.toLowerCase());
        const sent=await connected.sendTransaction({
          to:transaction.to,
          data:transaction.data,
          value:BigInt(transaction.value)
        });
        return sent.hash;
      }
      return provider.send(method,params);
    }
  };
}

async function json(url){
  const response=await fetch(url,{headers:{accept:"application/json"}});
  assert.equal(response.ok,true,`${url} returned ${response.status}`);
  return response.json();
}

async function reach(session,guid,expected,limit=8){
  for(let attempt=0;attempt<limit;attempt++){
    await session.tickOnce();
    const job=await json(`${session.appUrl}/api/jobs/${guid}`);
    if(job.stage===expected)return job;
  }
  const job=await json(`${session.appUrl}/api/jobs/${guid}`);
  assert.equal(job.stage,expected);
  return job;
}

test("carries one wallet-signed source action through exact GUID, fixture finality, 3-of-5, adapter verification and OApp execution",async t=>{
  const wallet=Wallet.createRandom();
  const session=await startLocalDemo({owner:wallet.address,appHost:"127.0.0.1",appPort:0,pollIntervalMs:60_000});
  t.after(()=>session.stop());
  const provider=eip1193(session.provider,wallet);
  const config=parsePublicDemoConfig(await json(`${session.appUrl}/api/demo/config`));
  const client=new WalletActionClient(provider,{pollIntervalMs:0,maxReceiptPolls:5});
  const connected=await client.connect(config);
  const quote=await client.quote(config,connected,config.approvedRecordLabel);
  const submitted=[];
  const source=await client.submit(config,connected,quote,hash=>submitted.push(hash));
  assert.deepEqual(submitted,[source.transactionHash]);
  assert.equal(provider.calls.filter(call=>call.method==="eth_sendTransaction").length,1);

  const job=await reach(session,source.guid,"EXECUTED");
  assert.equal(job.packet.guid,source.guid);
  assert.equal(job.packet.txHash,source.transactionHash);
  assert.equal(job.result.reasonCode,"LOCAL_FIXTURE_ALLOW");
  assert.deepEqual(job.verifications.map(value=>value.provider),["LOCAL_EDR_FIXTURE_PACKET","LOCAL_EDR_FIXTURE_RECEIPT"]);
  assert.equal(job.signers.length,3);
  assert.equal(session.metrics.signerCalls,5);
  assert.equal(session.metrics.destinationSubmissions,1);
  assert.equal(await session.destinationOApp.getFunction("executedGuid")(source.guid),true);
  assert.equal(await session.actionTarget.getFunction("recorded")(),config.approvedArgument);
  const deliveries=await json(`${session.appUrl}/api/deliveries`);
  const delivery=deliveries.find(value=>value.guid===source.guid);
  assert.equal(delivery.state,"CONFIRMED");
  assert.ok(BigInt(delivery.confirmations)>=1n);
});

test("finalizes altered calldata as denial without any signer, outbox, adapter or destination execution",async t=>{
  const wallet=Wallet.createRandom();
  const session=await startLocalDemo({owner:wallet.address,appHost:"127.0.0.1",appPort:0,pollIntervalMs:60_000});
  t.after(()=>session.stop());
  const provider=eip1193(session.provider,wallet);
  const config=parsePublicDemoConfig(await json(`${session.appUrl}/api/demo/config`));
  const client=new WalletActionClient(provider,{pollIntervalMs:0,maxReceiptPolls:5});
  const connected=await client.connect(config);
  const quote=await client.quote(config,connected,"not-authorized");
  assert.equal(quote.action.authorizationId,config.approvedAuthorizationId);
  assert.equal(quote.action.target,config.authorizedTarget);
  assert.notEqual(quote.argument,config.approvedArgument);
  const source=await client.submit(config,connected,quote);
  const signerCallsBefore=session.metrics.signerCalls;

  const job=await reach(session,source.guid,"REJECTED",4);
  assert.equal(job.packet.guid,source.guid);
  assert.equal(job.result.decision,"DENY");
  assert.equal(job.result.reasonCode,"LOCAL_FIXTURE_DENY");
  assert.equal(session.metrics.signerCalls,signerCallsBefore);
  assert.equal(session.metrics.destinationSubmissions,0);
  assert.equal(await session.outbox.get(source.guid),undefined);
  assert.equal(await session.destinationOApp.getFunction("executedGuid")(source.guid),false);
  assert.equal(await session.actionTarget.getFunction("calls")(),0n);
  assert.equal(provider.calls.filter(call=>call.method==="eth_sendTransaction").length,1);
  assert.deepEqual(await json(`${session.appUrl}/api/deliveries`),[]);
});

test("restarts coordinator storage after source mining without resending the wallet transaction",async t=>{
  const wallet=Wallet.createRandom();
  const session=await startLocalDemo({owner:wallet.address,appHost:"127.0.0.1",appPort:0,pollIntervalMs:60_000});
  t.after(()=>session.stop());
  const provider=eip1193(session.provider,wallet);
  const config=parsePublicDemoConfig(await json(`${session.appUrl}/api/demo/config`));
  const client=new WalletActionClient(provider,{pollIntervalMs:0,maxReceiptPolls:5});
  const connected=await client.connect(config),quote=await client.quote(config,connected,config.approvedRecordLabel);
  const source=await client.submit(config,connected,quote);
  assert.equal(provider.calls.filter(call=>call.method==="eth_sendTransaction").length,1);

  await session.restartCoordinator();
  const job=await reach(session,source.guid,"EXECUTED");
  assert.equal(job.packet.txHash,source.transactionHash);
  assert.equal(provider.calls.filter(call=>call.method==="eth_sendTransaction").length,1);
  assert.equal(session.metrics.destinationSubmissions,1);
});
