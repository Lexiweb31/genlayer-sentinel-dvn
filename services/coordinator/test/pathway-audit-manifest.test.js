import test from "node:test";
import assert from "node:assert/strict";
import {getAddress} from "ethers";
import {canonicalJson} from "../../../dist/services/coordinator/src/canonical-json.js";
import {
  PathwayAuditError,
  parsePathwayAuditManifest,
  parsePathwayAuditManifestText
} from "../../../dist/services/coordinator/src/pathway-audit-manifest.js";

const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const rpc=(label,url,operatorFamily,digest)=>({label,url,operatorFamily,originSha256:digest.repeat(64)});

function fixture(){
  return{
    schemaVersion:1,
    networkAuditSha256:"a".repeat(64),
    source:{
      name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:3,
      contracts:{endpointV2:address(1),sendUln302:address(2),executor:address(3),deadDvn:address(4)},
      rpcs:[rpc("source-a","https://rpc-a.example/","operator-a","b"),rpc("source-b","https://rpc-b.example/","operator-b","c")]
    },
    destination:{
      name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:20,
      contracts:{endpointV2:address(5),receiveUln302:address(6),deadDvn:address(7)},
      rpcs:[rpc("destination-a","https://rpc-c.example/rpc","operator-c","d"),rpc("destination-b","https://rpc-d.example/","operator-d","e")]
    },
    deployment:null,
    confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
  };
}

function deployment(){
  return{
    sourceOApp:{address:address(11),deploymentTxHash:`0x${"1".repeat(64)}`,delegate:address(12)},
    destinationOApp:{address:address(13),deploymentTxHash:`0x${"2".repeat(64)}`,delegate:address(14)},
    sourceAdapter:{address:address(15),deploymentTxHash:`0x${"3".repeat(64)}`},
    destinationAdapter:{address:address(16),deploymentTxHash:`0x${"4".repeat(64)}`},
    authorizedSigners:[address(21),address(22),address(23),address(24),address(25)],
    quorum:3
  };
}

function invalid(value){
  assert.throws(
    ()=>parsePathwayAuditManifest(value),
    error=>error instanceof PathwayAuditError&&error.code==="PATHWAY_AUDIT_MANIFEST_INVALID"&&error.message==="PATHWAY_AUDIT_MANIFEST_INVALID"
  );
}

test("parses a closed public audit manifest into a detached value",()=>{
  const raw=fixture();raw.source.rpcs[0].label="source:primary";raw.source.rpcs[0].operatorFamily="operator:primary";
  const parsed=parsePathwayAuditManifest(raw);
  assert.deepEqual(parsed,raw);
  assert.deepEqual(parsePathwayAuditManifestText(canonicalJson(raw)),raw);
  raw.source.rpcs[0].label="changed";
  raw.destination.contracts.deadDvn=address(99);
  assert.equal(parsed.source.rpcs[0].label,"source:primary");
  assert.equal(parsed.source.rpcs[0].operatorFamily,"operator:primary");
  assert.equal(parsed.destination.contracts.deadDvn,address(7));
});

test("rejects malformed audit manifest boundaries",()=>{
  const invalidCases=[
    value=>{value.extra=true},
    value=>{delete value.deployment},
    value=>{value.source.extra=true},
    value=>{delete value.source.contracts.executor},
    value=>{value.schemaVersion=2},
    value=>{value.source.chainId=421614},
    value=>{value.destination.eid=40161},
    value=>{value.source.contracts.deadDvn="0x0000000000000000000000000000000000000000"},
    value=>{value.source.contracts.endpointV2=address(0xabc).toLowerCase()},
    value=>{value.source.observationLag=0},
    value=>{value.destination.observationLag=257},
    value=>{value.source.rpcs[1].url="https://rpc-a.example/rpc"},
    value=>{value.source.rpcs[0].label=""},
    value=>{value.source.rpcs[0].label="a".repeat(129)},
    value=>{value.source.rpcs[0].label="source\nprimary"},
    value=>{value.source.rpcs[0].operatorFamily="operator/primary"},
    value=>{value.source.rpcs[0].url="http://rpc-a.example/"},
    value=>{value.source.rpcs[0].url="https://user@rpc-a.example/"},
    value=>{value.source.rpcs[0].url="https://rpc-a.example/?query=value"},
    value=>{value.source.rpcs[0].url="https://rpc-a.example/#fragment"},
    value=>{value.source.rpcs[0].url="https://rpc-a.example:8443/"},
    value=>{value.source.rpcs[0].url="https://rpc-a.example/not-rpc"},
    value=>{value.source.rpcs[0].url="https://rpc-a.example/\n"},
    value=>{value.source.rpcs[0].url="https://rpc-a.example/\t"},
    value=>{value.source.rpcs[0].url="https://127.0.0.1/"},
    value=>{value.source.rpcs[0].url="https://node.localhost/"},
    value=>{value.source.rpcs=[value.source.rpcs[0]]},
    value=>{value.source.rpcs=[...value.source.rpcs,...value.source.rpcs]},
    value=>{value.deployment={sourceOApp:deployment().sourceOApp}},
    value=>{value.deployment=deployment();value.deployment.sourceAdapter.deploymentTxHash="not-a-hash"},
    value=>{value.deployment=deployment();value.deployment.authorizedSigners.pop()},
    value=>{value.deployment=deployment();value.deployment.authorizedSigners.push(address(26))},
    value=>{value.deployment=deployment();value.deployment.authorizedSigners[1]=value.deployment.authorizedSigners[0]},
    value=>{value.deployment=deployment();value.deployment.authorizedSigners.reverse()},
    value=>{value.deployment=deployment();value.deployment.quorum=2},
    value=>{value.confirmationPolicy.label="FINALITY"},
    value=>{value.acknowledgement="DEPLOYED"}
  ];
  for(const mutate of invalidCases){const value=fixture();mutate(value);invalid(value)}
});

test("rejects secret-shaped keys without echoing rejected values",()=>{
  for(const [key,secret]of[["privateKey","0xdeadbeef"],["rpcUrl","https://credential.example/secret"],["wallet","wallet-secret"]]){
    const value=fixture();value[key]=secret;
    let outcome;
    try{parsePathwayAuditManifest(value)}catch(error){outcome=error}
    assert(outcome instanceof PathwayAuditError);
    assert.equal(outcome.code,"PATHWAY_AUDIT_SECRET_FIELD_REJECTED");
    assert.equal(outcome.message,"PATHWAY_AUDIT_SECRET_FIELD_REJECTED");
    assert.equal(outcome.message.includes(secret),false);
  }
});

test("rejects nested secret-shaped keys with the secret-specific error",()=>{
  const value=fixture(),secret="nested-secret-value";
  value.source.rpcs[0].privateKey=secret;
  let outcome;
  try{parsePathwayAuditManifest(value)}catch(error){outcome=error}
  assert(outcome instanceof PathwayAuditError);
  assert.equal(outcome.code,"PATHWAY_AUDIT_SECRET_FIELD_REJECTED");
  assert.equal(outcome.message,"PATHWAY_AUDIT_SECRET_FIELD_REJECTED");
  assert.equal(outcome.message.includes(secret),false);
});

test("requires canonical manifest text and hides all rejected input",()=>{
  const text=canonicalJson(fixture()),secret="never-echo-this";
  for(const candidate of[
    text.replace("\n"," \n"),
    text.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),
    `{"secret":"${secret}"}\n`
  ]){
    let outcome;
    try{parsePathwayAuditManifestText(candidate)}catch(error){outcome=error}
    assert(outcome instanceof PathwayAuditError);
    assert(["PATHWAY_AUDIT_MANIFEST_INVALID","PATHWAY_AUDIT_SECRET_FIELD_REJECTED"].includes(outcome.code));
    assert.equal(outcome.message.includes(secret),false);
  }
});
