import test from "node:test";
import assert from "node:assert/strict";
import {parseRuntimeConfig,publicConfigSummary} from "../../../dist/services/coordinator/src/runtime-config.js";

const a=n=>`0x${n.repeat(40)}`;
const h=n=>`0x${n.repeat(64)}`;
const b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const valid={
  mode:"TESTNET_PROTOTYPE",
  pathway:{name:"sepolia-arbitrum-sepolia",sourceChainId:11155111,destinationChainId:421614,srcEid:40161,dstEid:40231,endpoint:a("1"),sendLibrary:a("2"),sourceOApp:h("3"),destinationOApp:b("4"),sentinelDvn:a("5"),startBlock:"123",confirmations:"15",rpcUrls:["https://rpc-a.example/v1/key","https://rpc-b.example/v1/key"]},
  destination:{rpcUrls:["https://dst-a.example/v1/key","https://dst-b.example/v1/key"],chainId:421614,srcEid:40161,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),useDefaultReceiveLibrary:false,confirmations:"64",requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")],quorum:3,signatureTtlSeconds:300},
  evidence:{uri:"https://governance.example/authorization",allowedHost:"governance.example",policy:"exact authorization",ttlSeconds:300,maximumBytes:262144},
  genlayer:{endpoint:"https://genlayer.example/api",policyContract:a("6")},
  storage:{sqlitePath:"/var/lib/sentinel/state.db"},
  runtime:{pollIntervalMs:5000,maxIngestionAttempts:3},
  status:{host:"127.0.0.1",port:8787}
};

test("parses a pinned destination security manifest and redacts public RPC paths",()=>{
  const config=parseRuntimeConfig(valid),summary=publicConfigSummary(config);
  assert.equal(config.pathway.startBlock,123n);
  assert.equal(config.destination.confirmations,64n);
  assert.equal(config.destination.quorum,3);
  assert.equal(config.runtime.pollIntervalMs,5000);
  assert.equal(config.runtime.maxIngestionAttempts,3);
  assert.deepEqual(summary.pathway.rpcUrls,["https://rpc-a.example","https://rpc-b.example"]);
  assert.deepEqual(summary.destination.rpcUrls,["https://dst-a.example","https://dst-b.example"]);
  assert.equal(summary.destination.signatureTtlSeconds,300);
  assert.equal(summary.storage.sqlitePath,"[configured]");
});

test("rejects missing, unsafe, ambiguous and secret-bearing base runtime values",()=>{
  const changes=[
    input=>input.mode="PRODUCTION",
    input=>input.pathway.rpcUrls=["https://same.example/a","https://same.example/b"],
    input=>input.pathway.rpcUrls=["https://user:secret@rpc-a.example","https://rpc-b.example"],
    input=>input.evidence.allowedHost="evil.example",
    input=>input.storage.sqlitePath="relative.db",
    input=>input.runtime.pollIntervalMs=0,
    input=>input.runtime.maxIngestionAttempts=0,
    input=>input.status.host="0.0.0.0",
    input=>input.pathway.confirmations="0",
    input=>input.pathway.endpoint=a("0")
  ];
  for(const change of changes){const input=structuredClone(valid);change(input);assert.throws(()=>parseRuntimeConfig(input));}
});

test("rejects unsafe destination pathway, DVN, signer, quorum and expiry settings",()=>{
  const changes=[
    input=>input.destination.extra="unsafe",
    input=>input.destination.rpcUrls=["https://same.example/a","https://same.example/b"],
    input=>input.destination.useDefaultReceiveLibrary=true,
    input=>input.destination.oapp=a("c"),
    input=>input.destination.adapter=a("0"),
    input=>input.destination.requiredDvns=[a("9")],
    input=>input.destination.optionalDvns=[a("b")],
    input=>input.destination.requiredDvns=[],
    input=>input.destination.requiredDvns=[a("a"),a("a")],
    input=>input.destination.optionalDvns=[a("b"),a("9")],
    input=>input.destination.optionalDvnThreshold=0,
    input=>input.destination.optionalDvnThreshold=3,
    input=>input.destination.authorizedSigners=input.destination.authorizedSigners.slice(0,4),
    input=>input.destination.authorizedSigners=[...input.destination.authorizedSigners,a("6")],
    input=>input.destination.authorizedSigners=[a("1"),a("2"),a("2"),a("4"),a("5")],
    input=>input.destination.authorizedSigners=[a("2"),a("1"),a("3"),a("4"),a("5")],
    input=>input.destination.quorum=2,
    input=>input.destination.quorum=4,
    input=>input.destination.confirmations="0",
    input=>input.destination.signatureTtlSeconds=29,
    input=>input.destination.signatureTtlSeconds=901
  ];
  for(const change of changes){const input=structuredClone(valid);change(input);assert.throws(()=>parseRuntimeConfig(input));}
});
