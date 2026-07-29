import test from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {Coordinator} from "../../../dist/services/coordinator/src/coordinator.js";
import {dashboardResponse,statusResponse} from "../../../dist/services/coordinator/src/status-api.js";
import {parseDemoCapability} from "../../../dist/services/coordinator/src/demo-capability.js";

const h=n=>`0x${n.repeat(64)}`,presentation={presentationMode:"LOCAL_TEST"};
const coordinator=()=>new Coordinator({verify:async()=>[]},{submit:async()=>"",finalized:async()=>undefined},[]);
const demo=parseDemoCapability({mode:"LOCAL_WALLET_DEMO",chainId:"31337",chainName:"Sentinel Local",rpcUrl:"http://127.0.0.1:8545/",sourceOApp:"0x1111111111111111111111111111111111111111",sourceEndpoint:"0x2222222222222222222222222222222222222222",destinationEid:40231,authorizedTarget:"0x3333333333333333333333333333333333333333",actionSelector:"0xb5c645bd",actionSignature:"record(bytes32)",approvedRecordLabel:"approved",approvedArgument:"0x2b29265fc125740ae6bbc5035ae7af720b6932f4a3e44ba5ac02955c21ca9a05",approvedAuthorizationId:h("5"),options:"0x",payInLzToken:false,semanticSource:"LOCAL_POLICY_FIXTURE"});
const liveRuntime={runtimeStatus:()=>({
  version:1,
  observedAt:100,
  lifecycle:"RUNNING",
  lease:"CLAIMED",
  recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
  tick:{
    active:false,
    phase:"IDLE",
    lastStartedAt:90,
    lastCompletedAt:95,
    lastOutcome:"SUCCEEDED"
  },
  lastLeaseHeartbeatAt:95
})};

test("exposes only the validated live runtime observation through GET",async()=>{
  const response=await statusResponse(
    coordinator(),"GET","/api/runtime-status",
    undefined,undefined,presentation,undefined,undefined,liveRuntime
  );
  assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(response.body),{
    version:1,
    observedAt:100,
    lifecycle:"RUNNING",
    lease:"CLAIMED",
    recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
    tick:{
      active:false,
      phase:"IDLE",
      lastStartedAt:90,
      lastCompletedAt:95,
      lastOutcome:"SUCCEEDED"
    },
    lastLeaseHeartbeatAt:95
  });
});

test("sanitizes absent, throwing, leaked and contradictory runtime readers",async()=>{
  const values=[
    undefined,
    {runtimeStatus:()=>{throw new Error("secret sqlite path /private/state.db")}},
    {runtimeStatus:()=>({...liveRuntime.runtimeStatus(),owner:"sentinel-runtime:secret"})},
    {runtimeStatus:()=>({...liveRuntime.runtimeStatus(),lease:"LOST"})}
  ];
  for(const reader of values){
    const response=await statusResponse(
      coordinator(),"GET","/api/runtime-status",
      undefined,undefined,presentation,undefined,undefined,reader
    );
    assert.equal(response.status,503);
    assert.deepEqual(JSON.parse(response.body),{error:"runtime status unavailable"});
    assert.equal(response.body.includes("secret"),false);
    assert.equal(response.body.includes("/private"),false);
  }
});

test("rejects runtime status mutation methods without invoking the reader",async()=>{
  let calls=0;
  const reader={runtimeStatus:()=>{calls++;return liveRuntime.runtimeStatus()}};
  const response=await statusResponse(
    coordinator(),"POST","/api/runtime-status",
    undefined,undefined,presentation,undefined,undefined,reader
  );
  assert.equal(response.status,405);
  assert.equal(calls,0);
});

test("serves honest read-only job and runtime presentation state with bigint-safe JSON",async()=>{const c=coordinator();c.jobs.set(h("1"),{snapshot:{packet:{guid:h("1"),nonce:1n},stage:"DETECTED",verifications:[],signers:[]}});const health=await statusResponse(c,"GET","/health",undefined,undefined,presentation);assert.deepEqual(JSON.parse(health.body),{status:"ok",mode:"testnet-prototype",presentationMode:"LOCAL_TEST"});const jobs=await statusResponse(c,"GET","/api/jobs",undefined,undefined,presentation);assert.equal(jobs.status,200);assert.equal(JSON.parse(jobs.body)[0].packet.nonce,"1");assert.equal((await statusResponse(c,"GET",`/api/jobs/${h("2")}`,undefined,undefined,presentation)).status,404);assert.equal((await statusResponse(c,"POST","/api/jobs",undefined,undefined,presentation)).status,405)});
test("exposes sanitized dead-letter metadata through a read-only endpoint",async()=>{const c=coordinator(),reader={listDead:async()=>[{transactionHash:h("a"),blockNumber:90n,attempts:3,errorCode:"INGESTION_FAILED",firstFailedAt:100,lastFailedAt:120,packet:{encodedPayload:"0xsecret"}}]};const response=await statusResponse(c,"GET","/api/dead-letters",reader,undefined,presentation),body=JSON.parse(response.body);assert.equal(response.status,200);assert.equal(body[0].attempts,3);assert.equal(body[0].blockNumber,"90");assert.equal(body[0].packet,undefined);assert.equal((await statusResponse(c,"POST","/api/dead-letters",reader,undefined,presentation)).status,405)});
test("exposes sanitized read-only destination delivery metadata",async()=>{const c=coordinator(),deliveries={list:async()=>[{guid:h("1"),digest:h("2"),state:"RECOVERY_REQUIRED",transactionHash:h("3"),confirmations:15n,failureCode:"SUBMISSION_AMBIGUOUS",executionFailureCode:"LOCAL_EXECUTION_RECOVERY_REQUIRED",createdAt:100,updatedAt:120,shares:[{signature:"0xsecret"}],envelope:{callData:"0xsecret"}}]};const response=await statusResponse(c,"GET","/api/deliveries",undefined,deliveries,presentation),body=JSON.parse(response.body);assert.equal(response.status,200);assert.equal(body[0].state,"RECOVERY_REQUIRED");assert.equal(body[0].confirmations,"15");assert.equal(body[0].executionFailureCode,"LOCAL_EXECUTION_RECOVERY_REQUIRED");assert.equal(body[0].shares,undefined);assert.equal(body[0].envelope,undefined);assert.equal((await statusResponse(c,"POST","/api/deliveries",undefined,deliveries,presentation)).status,405)});
test("exposes only allowlisted hash-chained recovery evidence through GET",async()=>{const c=coordinator(),reader={listRecoveryReceipts:async()=>[{actionId:h("1"),kind:"DESTINATION_CONFIRM",deploymentDigest:h("2"),subject:h("3"),preconditionDigest:h("4"),candidateTransactionHash:h("5"),operators:["0x1111111111111111111111111111111111111111","0x2222222222222222222222222222222222222222","0x3333333333333333333333333333333333333333"],approvalCount:3,preparedAt:100,executeAfter:1000,expiresAt:3700,appliedAt:1100,resultCode:"DESTINATION_CONFIRMED",previousReceiptHash:h("0"),receiptHash:h("6"),signature:"0xsecret",databasePath:"/private/state.db",rawPacket:"0xsecret"}]};const response=await statusResponse(c,"GET","/api/recovery-actions",undefined,undefined,presentation,undefined,reader),body=JSON.parse(response.body);assert.equal(response.status,200);assert.deepEqual(Object.keys(body[0]),["actionId","kind","subject","candidateTransactionHash","operators","approvalCount","preparedAt","executeAfter","expiresAt","appliedAt","resultCode","previousReceiptHash","receiptHash"]);assert.equal(body[0].approvalCount,3);assert.equal(body[0].signature,undefined);assert.equal(body[0].databasePath,undefined);assert.equal(body[0].rawPacket,undefined);assert.equal((await statusResponse(c,"POST","/api/recovery-actions",undefined,undefined,presentation,undefined,reader)).status,405)});
test("exposes a sanitized demo capability only when intentionally injected",async()=>{const c=coordinator();assert.equal((await statusResponse(c,"GET","/api/demo/config",undefined,undefined,presentation)).status,404);const response=await statusResponse(c,"GET","/api/demo/config",undefined,undefined,presentation,demo),body=JSON.parse(response.body);assert.equal(response.status,200);assert.equal(body.chainId,"31337");assert.equal(body.semanticSource,"LOCAL_POLICY_FIXTURE");assert.equal(JSON.stringify(body).includes("private"),false);assert.equal((await statusResponse(c,"POST","/api/demo/config",undefined,undefined,presentation,demo)).status,405)});
test("serves only allowlisted dashboard assets beside the read-only API",async()=>{const c=coordinator(),root=resolve("apps/dashboard");const page=await dashboardResponse(c,"GET","/",root,undefined,undefined,presentation);assert.equal(page.status,200);assert.equal(page.contentType,"text/html; charset=utf-8");assert.match(Buffer.from(page.body).toString(),/GenLayer Sentinel/);assert.equal((await dashboardResponse(c,"GET","/src/app.js",root,undefined,undefined,presentation)).contentType,"text/javascript; charset=utf-8");assert.equal((await dashboardResponse(c,"GET","/src/timeline.js",root,undefined,undefined,presentation)).contentType,"text/javascript; charset=utf-8");assert.equal((await dashboardResponse(c,"GET","/assets/demo.js",root,undefined,undefined,presentation)).contentType,"text/javascript; charset=utf-8");assert.equal((await dashboardResponse(c,"GET","/assets/anything-else.js",root,undefined,undefined,presentation)).status,404);assert.equal((await dashboardResponse(c,"GET","/dist/apps/dashboard/demo.js",root,undefined,undefined,presentation)).status,404);assert.equal((await dashboardResponse(c,"GET","/api/jobs",root,undefined,undefined,presentation)).status,200);assert.equal((await dashboardResponse(c,"GET","/../package.json",root,undefined,undefined,presentation)).status,404);assert.equal((await dashboardResponse(c,"POST","/",root,undefined,undefined,presentation)).status,405)});
