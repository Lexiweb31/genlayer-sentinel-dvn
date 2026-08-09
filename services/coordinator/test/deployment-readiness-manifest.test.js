import test from "node:test";
import assert from "node:assert/strict";
import {getAddress} from "ethers";
import {canonicalJson} from "../../../dist/services/coordinator/src/canonical-json.js";
import {
  ReadinessError,
  parseDeploymentReadinessManifest,
  parseDeploymentReadinessManifestText
} from "../../../dist/services/coordinator/src/deployment-readiness-manifest.js";

const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const sorted=values=>values.map(address).sort((left,right)=>left.toLowerCase().localeCompare(right.toLowerCase()));

function fixture(){
  return{
    schemaVersion:2,
    classification:"LAYERZERO_DVN_CANDIDATE",
    sourceCommit:"1".repeat(40),
    audit:{
      date:"2026-07-29",
      evidenceSha256:"a".repeat(64),
      networkConfigSha256:"b".repeat(64)
    },
    source:{name:"ethereum-sepolia",chainId:11155111,eid:40161},
    destination:{name:"arbitrum-sepolia",chainId:421614,eid:40231},
    owner:address(0xabc),
    delegate:address(0xabd),
    signers:sorted([0x101,0x102,0x103,0x104,0x105]),
    quorum:3,
    recoveryOperators:sorted([0x201,0x202,0x203,0x204,0x205]),
    confirmations:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    artifacts:{
      SentinelDVNAdapter:{abiSha256:"c".repeat(64),creationBytecodeSha256:"d".repeat(64)},
      TreasuryPolicyOApp:{abiSha256:"e".repeat(64),creationBytecodeSha256:"f".repeat(64)}
    },
    pathwayAudit:null,
    acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED"
  };
}

test("parses one canonical public manifest and returns detached values",()=>{
  const raw=fixture(),parsed=parseDeploymentReadinessManifest(raw);
  assert.deepEqual(parsed,raw);
  assert.deepEqual(parseDeploymentReadinessManifestText(canonicalJson(raw)),raw);
  raw.signers[0]=address(0x999);
  raw.audit.date="2026-07-28";
  assert.notEqual(parsed.signers[0],raw.signers[0]);
  assert.equal(parsed.audit.date,"2026-07-29");
});

test("rejects every malformed or unsafe public-manifest boundary",()=>{
  const invalid=[
    value=>{value.extra=true},
    value=>{delete value.delegate},
    value=>{delete value.pathwayAudit},
    value=>{value.schemaVersion=1},
    value=>{value.classification="PRODUCTION_DVN"},
    value=>{value.sourceCommit="0".repeat(40)},
    value=>{value.sourceCommit="A".repeat(40)},
    value=>{value.audit.date="2026-02-30"},
    value=>{value.owner="0x0000000000000000000000000000000000000000"},
    value=>{value.owner=value.owner.toLowerCase()},
    value=>{value.signers=value.signers.slice(0,4)},
    value=>{value.signers[1]=value.signers[0]},
    value=>{value.signers.reverse()},
    value=>{value.quorum=2},
    value=>{value.recoveryOperators[0]=value.signers[0]},
    value=>{value.confirmations.source=3},
    value=>{value.confirmations.label="OFFICIAL_RECOMMENDATION"},
    value=>{value.source.eid=40231},
    value=>{value.destination.chainId=11155111},
    value=>{value.artifacts.SentinelDVNAdapter.abiSha256="a".repeat(63)},
    value=>{value.requiredDvns=[]},
    value=>{value.deadDvn=address(0x301)}
  ];
  for(const mutate of invalid){
    const value=fixture();mutate(value);
    assert.throws(
      ()=>parseDeploymentReadinessManifest(value),
      error=>error instanceof ReadinessError&&error.code==="READINESS_MANIFEST_INVALID"
    );
  }
});

test("rejects secret-shaped fields without echoing their names or values",()=>{
  const secretCases=[
    ["privateKey","0xdeadbeef"],
    ["mnemonic","correct horse battery staple"],
    ["rpcUrl","https://rpc.example/credential"],
    ["wallet","/Users/example/.wallet"],
    ["cloudToken","classified-token"]
  ];
  for(const [key,secret]of secretCases){
    const value=fixture();value[key]=secret;
    let outcome;
    try{parseDeploymentReadinessManifest(value)}catch(error){outcome=error}
    assert(outcome instanceof ReadinessError);
    assert.equal(outcome.code,"READINESS_SECRET_FIELD_REJECTED");
    assert.equal(outcome.message,"READINESS_SECRET_FIELD_REJECTED");
    assert.doesNotMatch(outcome.message,new RegExp(key,"i"));
    assert.equal(outcome.message.includes(secret),false);
  }
});

test("requires canonical manifest bytes before schema validation",()=>{
  const text=canonicalJson(fixture());
  assert.throws(
    ()=>parseDeploymentReadinessManifestText(text.replace('"schemaVersion":2','"schemaVersion":2, "schemaVersion":2')),
    /READINESS_MANIFEST_INVALID/
  );
});

test("accepts only a closed optional pathway-audit digest reference",()=>{
  const value=fixture();
  value.pathwayAudit={evidenceSha256:"9".repeat(64)};
  assert.deepEqual(parseDeploymentReadinessManifest(value).pathwayAudit,value.pathwayAudit);
  value.pathwayAudit.rpcUrl="https://rpc.example";
  assert.throws(
    ()=>parseDeploymentReadinessManifest(value),
    error=>error instanceof ReadinessError&&error.code==="READINESS_SECRET_FIELD_REJECTED"
  );
  for(const pathwayAudit of[{}, {evidenceSha256:"9".repeat(63)}, {evidenceSha256:"9".repeat(64),extra:true}]){
    const invalid=fixture();invalid.pathwayAudit=pathwayAudit;
    assert.throws(()=>parseDeploymentReadinessManifest(invalid),/READINESS_MANIFEST_INVALID/);
  }
});
