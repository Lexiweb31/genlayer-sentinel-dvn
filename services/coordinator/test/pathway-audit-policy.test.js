import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {getAddress} from "ethers";
import {canonicalJson} from "../../../dist/services/coordinator/src/canonical-json.js";
import {parsePathwayAuditManifest} from "../../../dist/services/coordinator/src/pathway-audit-manifest.js";
import {
  bindPathwayAuditPolicy,
  parsePathwayAuditorPolicy
} from "../../../dist/services/coordinator/src/pathway-audit-policy.js";

const root=new URL("../../../",import.meta.url);
const sha256=value=>createHash("sha256").update(value).digest("hex");
const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const digest=character=>character.repeat(64);

function manifest(){
  return{
    schemaVersion:1,
    networkAuditSha256:digest("a"),
    source:{
      name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:3,
      contracts:{
        endpointV2:"0x6EDCE65403992e310A62460808c4b910D972f10f",
        sendUln302:"0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE",
        executor:"0x718B92b5CB0a5552039B593faF724D182A881eDA",
        deadDvn:"0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8"
      },
      rpcs:[
        {label:"source-a",url:"https://source-a.example/",operatorFamily:"operator-a",originSha256:digest("b")},
        {label:"source-b",url:"https://source-b.example/",operatorFamily:"operator-b",originSha256:digest("c")}
      ]
    },
    destination:{
      name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:20,
      contracts:{
        endpointV2:"0x6EDCE65403992e310A62460808c4b910D972f10f",
        receiveUln302:"0x75Db67CDab2824970131D5aa9CECfC9F69c69636",
        deadDvn:"0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611"
      },
      rpcs:[
        {label:"destination-a",url:"https://destination-a.example/rpc",operatorFamily:"operator-c",originSha256:digest("d")},
        {label:"destination-b",url:"https://destination-b.example/",operatorFamily:"operator-d",originSha256:digest("e")}
      ]
    },
    deployment:null,
    confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
  };
}

function policy(){
  return{
    schemaVersion:1,
    toolVersion:"sentinel-pathway-auditor/v1",
    maximumProviderAuditAgeDays:30,
    networkConfig:"config/networks.json",
    networkAuditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
    providerAudit:"config/rpc-provider-audit.json",
    pathway:{source:"ethereum-sepolia",destination:"arbitrum-sepolia"},
    officialRuntimeCodeKeccak256:{
      sourceEndpointV2:null,sourceSendUln302:null,sourceExecutor:null,
      destinationEndpointV2:null,destinationReceiveUln302:null
    }
  };
}

async function inputs(){
  const [networksText,networkAuditEvidenceText]=await Promise.all([
    readFile(new URL("config/networks.json",root),"utf8"),
    readFile(new URL("docs/research/2026-08-02-layerzero-interface-conformance-audit.md",root),"utf8")
  ]);
  const value=manifest();
  value.networkAuditSha256=sha256(canonicalJson({
    destination:"arbitrum-sepolia",
    networkAuditEvidenceSha256:sha256(networkAuditEvidenceText),
    networkConfigSha256:sha256(networksText),
    source:"ethereum-sepolia"
  }));
  return{
    manifest:parsePathwayAuditManifest(value),
    policyText:JSON.stringify(policy(),null,2)+"\n",
    networksText,
    networkAuditEvidenceText,
    providerAuditText:JSON.stringify({
      schemaVersion:1,auditDate:"2026-08-02",status:"NO_PROVIDER_OPERATORS_REVIEWED",providers:[],sources:[],
      warning:"URL diversity is transport diversity, not operator independence."
    },null,2)+"\n",
    evaluationDate:"2026-08-02"
  };
}

function reviewedProvider(endpoint){
  return{
    label:endpoint.label,operatorFamily:endpoint.operatorFamily,originSha256:endpoint.originSha256,
    operatorEvidenceSha256:sha256(`review:${endpoint.label}`),sources:[`review:${endpoint.label}`]
  };
}

async function reviewedInputs(){
  const input=await inputs();
  input.providerAuditText=JSON.stringify({
    schemaVersion:1,auditDate:"2026-08-02",status:"PROVIDER_OPERATORS_REVIEWED",
    providers:[...input.manifest.source.rpcs,...input.manifest.destination.rpcs].map(reviewedProvider),
    sources:["operator-review-2026-08-02"],
    warning:"URL diversity is transport diversity, not operator independence."
  },null,2)+"\n";
  return input;
}

test("binds the manifest to exact committed network metadata and reports every unreviewed transport",async()=>{
  const input=await inputs();
  const binding=bindPathwayAuditPolicy(input);
  assert.equal(binding.networkAuditSha256,input.manifest.networkAuditSha256);
  assert.equal(binding.network.source.contracts.endpointV2,"0x6EDCE65403992e310A62460808c4b910D972f10f");
  assert.equal(binding.officialRuntimeCodeKeccak256.sourceEndpointV2,null);
  assert.deepEqual(binding.rpcIndependence,{source:"OPERATOR_INDEPENDENCE_UNPROVEN",destination:"OPERATOR_INDEPENDENCE_UNPROVEN"});
  assert.deepEqual(binding.providerState.source.map(value=>value.state),["OPERATOR_EVIDENCE_MISSING","OPERATOR_EVIDENCE_MISSING"]);
  assert.deepEqual(binding.providerState.destination.map(value=>value.state),["OPERATOR_EVIDENCE_MISSING","OPERATOR_EVIDENCE_MISSING"]);
  assert.deepEqual(binding.blockers.filter(value=>value.code==="AUDIT_PROVIDER_EVIDENCE_MISSING"),[
    {code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"},
    {code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"},
    {code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"},
    {code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"}
  ]);
  assert.equal(JSON.stringify(binding.blockers).includes("https://"),false);
});

test("recognizes independent reviewed operator families only when each audited origin matches",async()=>{
  const input=await reviewedInputs();
  const binding=bindPathwayAuditPolicy(input);
  assert.deepEqual(binding.rpcIndependence,{
    source:"OPERATOR_INDEPENDENCE_REVIEWED",
    destination:"OPERATOR_INDEPENDENCE_REVIEWED"
  });
  assert.equal(binding.blockers.some(value=>value.category==="RPC_INDEPENDENCE"),false);
  assert.deepEqual(binding.providerState.source.map(value=>value.state),["OPERATOR_EVIDENCE_REVIEWED","OPERATOR_EVIDENCE_REVIEWED"]);
});

test("emits stable, sanitized blockers for stale or mismatched repository evidence",async()=>{
  const cases=[
    ["invalid evaluation date",input=>{input.evaluationDate="2026-13-40"},"PATHWAY_AUDIT_POLICY_INVALID"],
    ["stale provider review",input=>{const audit=JSON.parse(input.providerAuditText);audit.auditDate="2026-06-01";input.providerAuditText=JSON.stringify(audit,null,2)+"\n"},"AUDIT_PROVIDER_EVIDENCE_STALE"],
    ["network digest",input=>{input.manifest={...input.manifest,networkAuditSha256:digest("f")}},"AUDIT_NETWORK_METADATA_MISMATCH"],
    ["network address",input=>{const networks=JSON.parse(input.networksText);networks.pathway["ethereum-sepolia"].endpointV2=address(99);input.networksText=JSON.stringify(networks,null,2)+"\n"},"AUDIT_NETWORK_METADATA_MISMATCH"],
    ["dead DVN address",input=>{const networks=JSON.parse(input.networksText);networks.pathway["arbitrum-sepolia"].deadDvn=address(99);input.networksText=JSON.stringify(networks,null,2)+"\n"},"AUDIT_NETWORK_METADATA_MISMATCH"],
    ["chain direction",input=>{const policyValue=JSON.parse(input.policyText);policyValue.pathway.source="arbitrum-sepolia";input.policyText=JSON.stringify(policyValue,null,2)+"\n"},"AUDIT_NETWORK_METADATA_MISMATCH"]
  ];
  for(const [name,mutate,want]of cases){
    const input=await reviewedInputs();
    mutate(input);
    if(want==="PATHWAY_AUDIT_POLICY_INVALID"){
      assert.throws(()=>bindPathwayAuditPolicy(input),/PATHWAY_AUDIT_POLICY_INVALID/,name);
    }else{
      const binding=bindPathwayAuditPolicy(input);
      assert.equal(binding.blockers.some(value=>value.code===want),true,name);
      assert.equal(JSON.stringify(binding.blockers).includes("https://"),false,name);
    }
  }
});

test("rejects closed malformed policy text",()=>{
  assert.throws(()=>parsePathwayAuditorPolicy('{"schemaVersion":1}\n'),/PATHWAY_AUDIT_POLICY_INVALID/);
});

test("blocks each altered provider-evidence field without exposing raw URLs",async()=>{
  const cases=[
    ["origin digest",audit=>{audit.providers[2].originSha256=digest("f")},"AUDIT_PROVIDER_EVIDENCE_MISSING"],
    ["operator evidence digest",audit=>{audit.providers[2].operatorEvidenceSha256=digest("0")},"AUDIT_PROVIDER_EVIDENCE_MISSING"],
    ["operator family",audit=>{audit.providers[1].operatorFamily=audit.providers[0].operatorFamily},"AUDIT_PROVIDER_OPERATOR_DUPLICATED"]
  ];
  for(const [name,mutate,want]of cases){
    const input=await reviewedInputs(),audit=JSON.parse(input.providerAuditText);
    mutate(audit);
    input.providerAuditText=JSON.stringify(audit,null,2)+"\n";
    const binding=bindPathwayAuditPolicy(input);
    assert.equal(binding.blockers.some(value=>value.code===want),true,name);
    assert.equal(JSON.stringify(binding).includes("https://"),false,name);
  }
});
