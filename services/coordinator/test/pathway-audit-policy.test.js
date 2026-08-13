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
    dvnOperatorAudit:"config/dvn-operator-audit.json",
    officialRuntimeCodeAudit:"config/official-runtime-code-audit.json",
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
    dvnOperatorAuditText:canonicalJson(emptyDvnAudit()),
    officialRuntimeCodeAuditText:canonicalJson(emptyRuntimeCodeAudit()),
    evaluationDate:"2026-08-02"
  };
}

function emptyDvnAudit(){
  return{
    schemaVersion:1,auditDate:"2026-08-03",status:"NO_DVN_OPERATORS_REVIEWED",dvns:[],sources:[],
    warning:"No LayerZero DVN operator identity or independence evidence has been reviewed."
  };
}

function emptyRuntimeCodeAudit(){
  return{
    schemaVersion:1,status:"NO_RUNTIME_CODE_IDENTITIES_REVIEWED",entries:[],sources:[],
    warning:"Bytecode presence is not official runtime-code identity evidence."
  };
}

function reviewedRuntimeCodeAudit(input){
  const deploymentAddressUrl="https://example.com/layerzero-v2-deployments";
  const sourceReleaseUrl="https://example.com/layerzero-v2-source-release";
  const deploymentAddressSourceSha256=sha256("reviewed deployment-address source");
  const sourceReleaseSourceSha256=sha256("reviewed source-release source");
  return{
    schemaVersion:1,status:"RUNTIME_CODE_IDENTITIES_REVIEWED",
    entries:[{
      name:"sourceEndpointV2",chainId:input.manifest.source.chainId,eid:input.manifest.source.eid,
      address:input.manifest.source.contracts.endpointV2,runtimeCodeKeccak256:"0x"+"1".repeat(64),
      layerZeroV2SourceRevision:"v2.0.0",
      deploymentAddressSourceSha256,sourceReleaseSourceSha256,
      block:{number:1,hash:"0x"+"2".repeat(64)}
    }],
    sources:[
      {name:"sourceEndpointV2",kind:"OFFICIAL_DEPLOYMENT_ADDRESS",url:deploymentAddressUrl,rawSha256:deploymentAddressSourceSha256},
      {name:"sourceEndpointV2",kind:"OFFICIAL_SOURCE_RELEASE",url:sourceReleaseUrl,rawSha256:sourceReleaseSourceSha256}
    ],
    warning:"Reviewed entries bind public evidence only; they do not establish deployment or pathway suitability."
  };
}

function reviewedDvnAudit(){
  const source="docs/research/reviewed-dvn-operators.md";
  return{
    schemaVersion:1,auditDate:"2026-08-03",status:"DVN_OPERATORS_REVIEWED",
    dvns:[
      {chain:"ethereum-sepolia",chainId:11155111,address:address(201),operatorFamily:"independent-dvn-a",operatorEvidenceSha256:digest("7"),sources:[source]},
      {chain:"arbitrum-sepolia",chainId:421614,address:address(201),operatorFamily:"independent-dvn-a",operatorEvidenceSha256:digest("7"),sources:[source]}
    ],
    sources:[source],warning:"Reviewed entries prove only repository-bound public operator identity evidence, not liveness."
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

test("shared public identifiers round-trip through manifest and reviewed provider policy",async()=>{
  const input=await reviewedInputs(),audit=JSON.parse(input.providerAuditText);
  input.manifest.source.rpcs[0].label="source:primary";
  input.manifest.source.rpcs[0].operatorFamily="operator:primary";
  audit.providers[0].label="source:primary";audit.providers[0].operatorFamily="operator:primary";
  input.providerAuditText=JSON.stringify(audit,null,2)+"\n";
  const binding=bindPathwayAuditPolicy(input);
  assert.equal(binding.providerState.source[0].label,"source:primary");
  assert.equal(binding.providerState.source[0].state,"OPERATOR_EVIDENCE_REVIEWED");
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

test("binds exact manifest operator families to reviewed provider records instead of trusting a forged assertion",async()=>{
  const input=await reviewedInputs();
  input.manifest.source.rpcs[0].operatorFamily="forged-family";
  const binding=bindPathwayAuditPolicy(input);
  assert.equal(binding.providerState.source[0].state,"OPERATOR_EVIDENCE_MISSING");
  assert.equal(binding.rpcIndependence.source,"OPERATOR_INDEPENDENCE_UNPROVEN");
  assert.equal(binding.blockers.some(value=>value.code==="AUDIT_PROVIDER_EVIDENCE_MISSING"),true);
});

test("parses only canonical closed DVN reviews and exposes exact validated chain entries",async()=>{
  const input=await reviewedInputs(),audit=reviewedDvnAudit();
  audit.dvns[0].operatorFamily="independent:dvn";
  input.dvnOperatorAuditText=canonicalJson(audit);
  const binding=bindPathwayAuditPolicy(input);
  assert.equal(binding.dvnOperatorAuditSha256,sha256(input.dvnOperatorAuditText));
  assert.deepEqual(binding.reviewedDvns.source,audit.dvns.slice(0,1));
  assert.deepEqual(binding.reviewedDvns.destination,audit.dvns.slice(1));
  audit.dvns[0].operatorFamily="changed-after-binding";
  assert.equal(binding.reviewedDvns.source[0].operatorFamily,"independent:dvn");
});

test("provider and DVN registries reject identifiers outside the shared grammar",async()=>{
  const providerInput=await reviewedInputs(),providerAudit=JSON.parse(providerInput.providerAuditText);
  providerAudit.providers[0].label="provider\nname";
  providerInput.providerAuditText=JSON.stringify(providerAudit,null,2)+"\n";
  assert.throws(()=>bindPathwayAuditPolicy(providerInput),/PATHWAY_AUDIT_POLICY_INVALID/);

  const dvnInput=await reviewedInputs(),dvnAudit=reviewedDvnAudit();
  dvnAudit.dvns[0].operatorFamily="operator/unsafe";
  dvnInput.dvnOperatorAuditText=canonicalJson(dvnAudit);
  assert.throws(()=>bindPathwayAuditPolicy(dvnInput),/PATHWAY_AUDIT_POLICY_INVALID/);
});

test("the committed DVN registry is canonical, honest, and empty until identities are reviewed",async()=>{
  const text=await readFile(new URL("config/dvn-operator-audit.json",root),"utf8");
  assert.equal(text,canonicalJson(emptyDvnAudit()));
  const input=await reviewedInputs();input.dvnOperatorAuditText=text;
  const binding=bindPathwayAuditPolicy(input);
  assert.deepEqual(binding.reviewedDvns,{source:[],destination:[]});
});

test("the committed RPC registry binds each documented public operator independently",async()=>{
  const text=await readFile(new URL("config/rpc-provider-audit.json",root),"utf8");
  const audit=JSON.parse(text);
  assert.equal(audit.status,"PROVIDER_OPERATORS_REVIEWED");
  assert.equal(audit.auditDate,"2026-08-13");
  assert.deepEqual(audit.sources,["docs/research/2026-08-13-rpc-provider-operator-audit.md"]);
  assert.deepEqual(audit.providers.map(value=>[value.label,value.operatorFamily]),[
    ["arbitrum-publicnode","publicnode"],
    ["arbitrum-tenderly","tenderly"],
    ["sepolia-publicnode","publicnode"],
    ["sepolia-tenderly","tenderly"]
  ]);
  assert(audit.providers.every(value=>value.sources.length===1&&value.sources[0]===audit.sources[0]&&/^[a-f0-9]{64}$/.test(value.operatorEvidenceSha256)));
});

test("rejects noncanonical, open, duplicate, malformed, unknown-chain, and unsafe DVN review records",async()=>{
  const cases=[
    ["noncanonical",audit=>JSON.stringify(audit,null,2)+"\n"],
    ["unknown field",audit=>{audit.extra=true;return canonicalJson(audit)}],
    ["duplicate identity",audit=>{audit.dvns.push(structuredClone(audit.dvns[0]));return canonicalJson(audit)}],
    ["non-digest evidence",audit=>{audit.dvns[0].operatorEvidenceSha256="not-a-digest";return canonicalJson(audit)}],
    ["unknown chain",audit=>{audit.dvns[0].chain="ethereum-mainnet";audit.dvns[0].chainId=1;return canonicalJson(audit)}],
    ["unsafe field",audit=>{audit.dvns[0].privateKey="forbidden";return canonicalJson(audit)}]
  ];
  for(const[name,encode]of cases){
    const input=await reviewedInputs();input.dvnOperatorAuditText=encode(reviewedDvnAudit());
    assert.throws(()=>bindPathwayAuditPolicy(input),/PATHWAY_AUDIT_POLICY_INVALID/,name);
  }
});

test("binds raw DVN registry bytes into the repository digest",async()=>{
  const input=await reviewedInputs(),first=bindPathwayAuditPolicy(input);
  const changed=emptyDvnAudit();changed.warning="No DVN identities reviewed; replacement registry bytes.";
  input.dvnOperatorAuditText=canonicalJson(changed);
  const second=bindPathwayAuditPolicy(input);
  assert.notEqual(second.dvnOperatorAuditSha256,first.dvnOperatorAuditSha256);
  assert.notEqual(second.repositoryBindingSha256,first.repositoryBindingSha256);
});

test("binds reviewed runtime-code evidence only to matching policy pins",async()=>{
  const input=await inputs(),previous=bindPathwayAuditPolicy(input),policyValue=JSON.parse(input.policyText);
  policyValue.officialRuntimeCodeKeccak256.sourceEndpointV2="0x"+"1".repeat(64);
  input.policyText=JSON.stringify(policyValue,null,2)+"\n";
  input.officialRuntimeCodeAuditText=canonicalJson(reviewedRuntimeCodeAudit(input));
  const binding=bindPathwayAuditPolicy(input);
  assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.state,"REVIEWED");
  assert.equal(binding.officialRuntimeCodeReview.sourceSendUln302.state,"UNREVIEWED");
  assert.equal(binding.officialRuntimeCodeReview.sourceExecutor.state,"UNREVIEWED");
  assert.equal(binding.officialRuntimeCodeReview.destinationEndpointV2.state,"UNREVIEWED");
  assert.equal(binding.officialRuntimeCodeReview.destinationReceiveUln302.state,"UNREVIEWED");
  assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.layerZeroV2SourceRevision,"v2.0.0");
  assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.deploymentAddressSource.url,"https://example.com/layerzero-v2-deployments");
  assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.deploymentAddressSource.rawSha256,sha256("reviewed deployment-address source"));
  assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.sourceReleaseSource.url,"https://example.com/layerzero-v2-source-release");
  assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.sourceReleaseSource.rawSha256,sha256("reviewed source-release source"));
  assert.notEqual(binding.repositoryBindingSha256,previous.repositoryBindingSha256);
});

test("the committed runtime-code registry is canonical and unreviewed until identities are reviewed",async()=>{
  const text=await readFile(new URL("config/official-runtime-code-audit.json",root),"utf8");
  assert.equal(text,canonicalJson(emptyRuntimeCodeAudit()));
  const input=await inputs();input.officialRuntimeCodeAuditText=text;
  const binding=bindPathwayAuditPolicy(input);
  assert.deepEqual(binding.officialRuntimeCodeReview,{
    destinationEndpointV2:{state:"UNREVIEWED"},destinationReceiveUln302:{state:"UNREVIEWED"},
    sourceEndpointV2:{state:"UNREVIEWED"},sourceExecutor:{state:"UNREVIEWED"},sourceSendUln302:{state:"UNREVIEWED"}
  });
});

test("the runtime-code review workflow preserves all-five and not-deployed boundaries",async()=>{
  const [review,pathway,unknowns,readme]=await Promise.all([
    readFile(new URL("docs/research/2026-08-13-official-runtime-code-review.md",root),"utf8"),
    readFile(new URL("docs/PATHWAY_AUDITOR.md",root),"utf8"),
    readFile(new URL("docs/UNKNOWNS.md",root),"utf8"),
    readFile(new URL("README.md",root),"utf8")
  ]);
  for(const text of[review,pathway,unknowns,readme]){
    assert.match(text,/all five/i);
    assert.match(text,/not deployed/i);
  }
});

test("rejects malformed or mismatched runtime-code registry evidence",async()=>{
  const cases=[
    ["unknown contract name",audit=>{audit.entries[0].name="unknown";return canonicalJson(audit)}],
    ["duplicate name",audit=>{audit.entries.push(structuredClone(audit.entries[0]));return canonicalJson(audit)}],
    ["wrong chain ID",audit=>{audit.entries[0].chainId=1;return canonicalJson(audit)}],
    ["wrong EID",audit=>{audit.entries[0].eid=1;return canonicalJson(audit)}],
    ["wrong address",audit=>{audit.entries[0].address=address(1);return canonicalJson(audit)}],
    ["non-HTTPS deployment-address URL",audit=>{audit.sources[0].url="http://example.com/evidence";return canonicalJson(audit)}],
    ["malformed deployment-address digest",audit=>{audit.sources[0].rawSha256="bad";return canonicalJson(audit)}],
    ["malformed runtime hash",audit=>{audit.entries[0].runtimeCodeKeccak256="0xBAD";return canonicalJson(audit)}],
    ["deployment-address source digest mismatch",audit=>{audit.entries[0].deploymentAddressSourceSha256=digest("f");return canonicalJson(audit)}],
    ["source-release source digest mismatch",audit=>{audit.entries[0].sourceReleaseSourceSha256=digest("f");return canonicalJson(audit)}],
    ["missing LayerZero V2 source revision",audit=>{delete audit.entries[0].layerZeroV2SourceRevision;return canonicalJson(audit)}],
    ["duplicated primary source URL",audit=>{audit.sources[1].url=audit.sources[0].url;return canonicalJson(audit)}],
    ["noncanonical JSON",audit=>JSON.stringify(audit,null,2)+"\n"],
    ["reviewed registry entry for a null policy pin",audit=>canonicalJson(audit)],
    ["non-null policy pin without matching reviewed registry entry",audit=>canonicalJson(emptyRuntimeCodeAudit())]
  ];
  for(const[name,encode]of cases){
    const input=await inputs(),audit=reviewedRuntimeCodeAudit(input),policyValue=JSON.parse(input.policyText);
    if(name!=="reviewed registry entry for a null policy pin")policyValue.officialRuntimeCodeKeccak256.sourceEndpointV2="0x"+"1".repeat(64);
    input.policyText=JSON.stringify(policyValue,null,2)+"\n";
    input.officialRuntimeCodeAuditText=encode(audit);
    assert.throws(()=>bindPathwayAuditPolicy(input),/PATHWAY_AUDIT_POLICY_INVALID/,name);
  }
});
