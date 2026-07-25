import test from "node:test";
import assert from "node:assert/strict";
import {parseRuntimeConfig} from "../../../dist/services/coordinator/src/runtime-config.js";
import {recoveryDeploymentDigest} from "../../../dist/services/coordinator/src/recovery-domain.js";

const a=n=>`0x${n.repeat(40)}`,b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const manifest={
  mode:"TESTNET_PROTOTYPE",
  pathway:{name:"sepolia-arbitrum-sepolia",sourceChainId:11155111,destinationChainId:421614,srcEid:40161,dstEid:40231,endpoint:a("1"),sendLibrary:a("2"),sourceOApp:b("3"),sourceOAppAddress:a("3"),destinationOApp:b("4"),sentinelDvn:a("5"),executor:a("6"),maxMessageSize:10000,deadDvn:a("d"),requiredDvns:[a("a")],optionalDvns:[a("5"),a("b")],optionalDvnThreshold:1,startBlock:"123",confirmations:"15",rpcUrls:["https://rpc-a.example/v1/key","https://rpc-b.example/v1/key"]},
  destination:{rpcUrls:["https://dst-a.example/v1/key","https://dst-b.example/v1/key"],chainId:421614,srcEid:40161,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),useDefaultReceiveLibrary:false,confirmations:"64",requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")],quorum:3,signatureTtlSeconds:300},
  evidence:{uri:"https://governance.example/authorization",allowedHost:"governance.example",policy:"exact authorization",ttlSeconds:300,maximumBytes:262144},
  genlayer:{endpoint:"https://genlayer.example/api",policyContract:a("6")},
  recovery:{operators:[a("6"),a("7"),a("8"),a("9"),a("a")],quorum:3,minimumDelaySeconds:900,maximumLifetimeSeconds:3600},
  storage:{sqlitePath:"/var/lib/sentinel/state.db"},
  runtime:{pollIntervalMs:5000,maxIngestionAttempts:3},
  status:{host:"127.0.0.1",port:8787}
};

test("binds recovery to every deployment identity while ignoring operations settings",()=>{
  const config=parseRuntimeConfig(manifest),baseline=recoveryDeploymentDigest(config);
  assert.equal(baseline,"0x4ef274bd93298f58eef05c61dbddde76cb6c4b8e07b2d493353bd8a3d1f9156c");
  const changes=[
    value=>value.pathway.sourceChainId++,
    value=>value.destination.chainId++,
    value=>value.pathway.srcEid++,
    value=>value.pathway.dstEid++,
    value=>value.pathway.endpoint=a("c"),
    value=>value.pathway.sendLibrary=a("c"),
    value=>value.pathway.sourceOAppAddress=a("c"),
    value=>value.destination.oapp=a("c"),
    value=>value.pathway.sentinelDvn=a("c"),
    value=>value.destination.adapter=a("c"),
    value=>value.destination.receiveLibrary=a("c"),
    value=>value.genlayer.policyContract=a("c")
  ];
  for(const change of changes){const candidate=structuredClone(config);change(candidate);assert.notEqual(recoveryDeploymentDigest(candidate),baseline);}
  const operations=structuredClone(config);
  operations.pathway.rpcUrls=["https://other-a.example","https://other-b.example"];
  operations.storage.sqlitePath="/other/state.db";
  operations.runtime.pollIntervalMs=9000;
  operations.status.port=9999;
  assert.equal(recoveryDeploymentDigest(operations),baseline);
});
