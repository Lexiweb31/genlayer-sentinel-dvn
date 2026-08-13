import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import{canonicalJson}from"../../../dist/services/coordinator/src/canonical-json.js";
import{
  buildPathwayAuditBundle,encodePathwayAuditBundle,parsePathwayAuditBundleText
}from"../../../dist/services/coordinator/src/pathway-audit-bundle.js";

const digest=value=>value.repeat(64);
const hash=value=>`0x${value.repeat(64)}`;
const address=value=>`0x${value.toString(16).padStart(40,"0")}`;
const provider=(label,digit)=>({label,originSha256:digest(digit),operatorFamily:`operator-${label}`});
const providers=(chain,a,b)=>[provider(`${chain}-a`,a),provider(`${chain}-b`,b)];
const block=(chainId,number,digit)=>({
  chainId:String(chainId),blockNumber:String(number),blockHash:hash(digit),parentHash:hash("c"),
  stateRoot:hash("d"),transactionsRoot:hash("e"),timestamp:"1710000000"
});
const code=(name,value,digit)=>({
  name,address:value,byteLength:2,runtimeCodeKeccak256:hash(digit),identity:"CODE_IDENTITY_REVIEWED"
});
const uln=(confirmations,required,optional)=>({confirmations,requiredDvns:[required],optionalDvns:[optional],optionalDvnThreshold:1});
const adapter=(value,lib,target)=>({
  address:value,messageLib:lib,verificationTarget:target,supportedDstEid:40231,quorum:"3",
  signersAuthorized:[true,true,true,true,true]
});

const source={endpoint:address(1),send:address(2),receive:address(3),executor:address(4),oapp:address(5),adapter:address(6),dvn:address(7)};
const destination={endpoint:address(11),send:address(12),receive:address(13),oapp:address(14),adapter:address(15),dvn:source.dvn};
const signers=[21,22,23,24,25].map(address);

function deployment(contractName,chainId,value,providerIdentities,digit,constructorArguments){
  return{
    contractName,chainId:String(chainId),address:value,deployer:address(chainId===11155111?31:32),
    providerIdentities:structuredClone(providerIdentities),deploymentTxHash:hash(digit),deploymentBlockNumber:"90",
    deploymentBlockHash:hash(chainId===11155111?"8":"9"),creationBytecodeSha256:digest("1"),
    deployedBytecodeSha256:digest("2"),immutableReferencesSha256:digest("3"),transactionInputSha256:digest("4"),
    runtimeCodeKeccak256:hash("5"),constructorArguments
  };
}

function observation(){
  const sourceProviders=providers("source","1","2"),destinationProviders=providers("destination","3","4");
  const sourcePath={
    endpoint:source.endpoint,sourceOApp:source.oapp,dstEid:40231,sendLibrary:source.send,
    isDefaultSendLibrary:false,supportedEid:true,uln:uln("15",source.dvn,source.adapter),
    dvnCodeKeccak256:[{address:source.dvn,codeKeccak256:hash("6")},{address:source.adapter,codeKeccak256:hash("5")}],
    executor:{maxMessageSize:10000,address:source.executor},
    destinationPeer:`0x${"0".repeat(24)}${destination.oapp.slice(2)}`,
    adapter:adapter(source.adapter,source.send,source.receive)
  };
  const destinationUln=uln("64",destination.dvn,destination.adapter);
  const destinationPath={
    endpoint:destination.endpoint,oapp:destination.oapp,srcEid:40161,receiveLibrary:destination.receive,
    isDefaultReceiveLibrary:false,supportedEid:true,rawAppUln:destinationUln,resolvedUln:structuredClone(destinationUln),
    sourcePeer:`0x${"0".repeat(24)}${source.oapp.slice(2)}`,
    adapter:adapter(destination.adapter,destination.send,destination.receive)
  };
  return bindInnerDigests({
    status:"OBSERVED_PATHWAY_CONSISTENT",truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",
    repositoryBindingSha256:digest("a"),
    rpcIndependence:{source:"OPERATOR_INDEPENDENCE_REVIEWED",destination:"OPERATOR_INDEPENDENCE_REVIEWED"},
    providerAgreement:{
      source:{state:"TWO_TRANSPORTS_AGREE",providers:sourceProviders,resultSha256:digest("b")},
      destination:{state:"TWO_TRANSPORTS_AGREE",providers:destinationProviders,resultSha256:digest("c")}
    },
    blocks:{source:block(11155111,100,"a"),destination:block(421614,200,"b")},
    officialCode:{
      source:[code("sourceEndpointV2",source.endpoint,"1"),code("sourceSendUln302",source.send,"2"),code("sourceExecutor",source.executor,"3")],
      destination:[code("destinationEndpointV2",destination.endpoint,"4"),code("destinationReceiveUln302",destination.receive,"5")]
    },
    deployments:{
      sourceOApp:deployment("TreasuryPolicyOApp",11155111,source.oapp,sourceProviders,"1",{endpoint:source.endpoint,delegate:address(41)}),
      destinationOApp:deployment("TreasuryPolicyOApp",421614,destination.oapp,destinationProviders,"2",{endpoint:destination.endpoint,delegate:address(42)}),
      sourceAdapter:deployment("SentinelDVNAdapter",11155111,source.adapter,sourceProviders,"3",{
        messageLib:source.send,verificationTarget:source.receive,supportedDstEid:40231,signers:[...signers],quorum:"3"
      }),
      destinationAdapter:deployment("SentinelDVNAdapter",421614,destination.adapter,destinationProviders,"4",{
        messageLib:destination.send,verificationTarget:destination.receive,supportedDstEid:40231,signers:[...signers],quorum:"3"
      })
    },
    source:sourcePath,destination:destinationPath,configurationSha256:digest("d"),blockers:[]
  });
}

function bindInnerDigests(value){
  value.configurationSha256=value.source&&value.destination?
    createHash("sha256").update(canonicalJson({destination:value.destination,source:value.source})).digest("hex"):null;
  value.providerAgreement.source.resultSha256=value.blocks.source?createHash("sha256").update(canonicalJson({
    block:value.blocks.source,
    deployments:value.deployments?{adapter:value.deployments.sourceAdapter,oapp:value.deployments.sourceOApp}:null,
    officialCode:value.officialCode.source,path:value.source
  })).digest("hex"):null;
  value.providerAgreement.destination.resultSha256=value.blocks.destination?createHash("sha256").update(canonicalJson({
    block:value.blocks.destination,
    deployments:value.deployments?{adapter:value.deployments.destinationAdapter,oapp:value.deployments.destinationOApp}:null,
    officialCode:value.officialCode.destination,path:value.destination
  })).digest("hex"):null;
  return value;
}

const blockers={
  INPUT_BINDING:{code:"AUDIT_NETWORK_METADATA_MISMATCH",category:"INPUT_BINDING",remediation:"RECHECK_NETWORK_AUDIT"},
  RPC_INDEPENDENCE:{code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"},
  RPC_CONSENSUS:{code:"AUDIT_RPC_UNAVAILABLE",category:"RPC_CONSENSUS",remediation:"REPLACE_RPC_TRANSPORT"},
  CODE_IDENTITY:{code:"AUDIT_CODE_MISSING",category:"CODE_IDENTITY",remediation:"PIN_REVIEWED_CODE_IDENTITY"},
  PATHWAY_CONFIGURATION:{code:"AUDIT_PATHWAY_DEPLOYMENTS_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"}
};

test("status uses the exact fail-closed blocker precedence",()=>{
  const precedence=[
    ["INPUT_BINDING","BLOCKED_INPUT_BINDING"],["RPC_INDEPENDENCE","BLOCKED_RPC_INDEPENDENCE"],
    ["RPC_CONSENSUS","BLOCKED_RPC_CONSENSUS"],["CODE_IDENTITY","BLOCKED_CODE_IDENTITY"],
    ["PATHWAY_CONFIGURATION","BLOCKED_PATHWAY_CONFIGURATION"]
  ];
  for(let index=0;index<precedence.length;index++){
    const input=observation();
    input.blockers=precedence.slice(index).map(([category])=>blockers[category]).reverse();
    const bundle=buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"});
    assert.equal(bundle.status,precedence[index][1]);
  }
});

test("bundle is canonical public evidence with sorted blockers and a reproducible body digest",()=>{
  const input=observation();
  input.blockers=[blockers.PATHWAY_CONFIGURATION,blockers.INPUT_BINDING,blockers.CODE_IDENTITY];
  const bundle=buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"});
  assert.equal(bundle.schemaVersion,1);
  assert.equal(bundle.toolVersion,"sentinel-pathway-auditor/v1");
  assert.equal(bundle.truthLabel,"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED");
  assert.equal(bundle.repositoryBindingSha256,digest("a"));
  assert.equal(bundle.blocks.source.blockNumber,"100");
  assert.equal(bundle.source.uln.confirmations,"15");
  assert.equal(bundle.deployments.sourceAdapter.transactionInputSha256,digest("4"));
  assert.deepEqual(bundle.blockers.map(value=>value.category),["CODE_IDENTITY","INPUT_BINDING","PATHWAY_CONFIGURATION"]);

  const{evidenceSha256,...body}=bundle;
  assert.equal(evidenceSha256,createHash("sha256").update(canonicalJson(body)).digest("hex"));
  const text=encodePathwayAuditBundle(bundle);
  assert.equal(text,canonicalJson(bundle));
  const forbidden=["https://","rpcUrl","transactionInput\"","responseBody","/Users/","process.env","privateKey","mnemonic","productionReadiness","signerIsolation","genlayer","finality","liveness","\"deployed\":true","\"onboarded\":true"];
  for(const value of forbidden)assert.equal(text.toLowerCase().includes(value.toLowerCase()),false,value);
  const parsed=parsePathwayAuditBundleText(text);
  assert.deepEqual(parsed,bundle);
  const{evidenceSha256:parsedDigest,...parsedBody}=parsed;
  assert.equal(parsedDigest,createHash("sha256").update(canonicalJson(parsedBody)).digest("hex"));
  parsed.blockers[0].code="AUDIT_CODE_IDENTITY_UNPROVEN";
  assert.notDeepEqual(parsed,bundle);
});

test("builder canonicalizes repeated endpoint blockers into one blocker",()=>{
  const input=observation();
  input.blockers=[
    blockers.RPC_INDEPENDENCE,blockers.RPC_INDEPENDENCE,
    blockers.RPC_INDEPENDENCE,blockers.RPC_INDEPENDENCE,
    blockers.PATHWAY_CONFIGURATION
  ];
  const bundle=buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"});
  assert.deepEqual(bundle.blockers,[blockers.PATHWAY_CONFIGURATION,blockers.RPC_INDEPENDENCE]);
  assert.deepEqual(parsePathwayAuditBundleText(encodePathwayAuditBundle(bundle)),bundle);
});

test("strict parser rejects noncanonical, unknown, secret, unsafe, and internally inconsistent artifacts",()=>{
  const bundle=buildPathwayAuditBundle({observation:observation(),runTimestamp:"2026-08-02T12:34:56.789Z"});
  const redigest=value=>{
    const{evidenceSha256:ignored,...body}=value;
    value.evidenceSha256=createHash("sha256").update(canonicalJson(body)).digest("hex");
  };
  const mutations=[
    value=>{value.unknown=true},
    value=>{value.providerAgreement.source.providers[0].rpcUrl="https://rpc.example/"},
    value=>{value.source.adapter.privateKey="not-public"},
    value=>{value.blocks.source.absolutePath="/Users/operator/evidence.json"},
    value=>{value.status="BLOCKED_RPC_CONSENSUS"},
    value=>{value.truthLabel="LIVE_PATHWAY_VALIDATED"},
    value=>{value.runTimestamp="2026-08-02T12:34:56Z"},
    value=>{value.officialCode.source[0].runtimeCodeKeccak256=hash("0")},
    value=>{value.deployments.sourceAdapter.constructorArguments.signers.pop()},
    value=>{value.source.uln.requiredDvns.push(value.source.uln.requiredDvns[0])}
  ];
  for(const mutate of mutations){
    const value=structuredClone(bundle);mutate(value);redigest(value);
    assert.throws(()=>parsePathwayAuditBundleText(canonicalJson(value)));
  }
  const unsorted=structuredClone(bundle);
  unsorted.blockers=[blockers.PATHWAY_CONFIGURATION,blockers.INPUT_BINDING];
  unsorted.status="BLOCKED_INPUT_BINDING";redigest(unsorted);
  assert.throws(()=>parsePathwayAuditBundleText(canonicalJson(unsorted)));
  const forgedDigest=structuredClone(bundle);forgedDigest.evidenceSha256=digest("0");
  assert.throws(()=>parsePathwayAuditBundleText(canonicalJson(forgedDigest)));
  assert.throws(()=>parsePathwayAuditBundleText(JSON.stringify(bundle)));
  const duplicate=encodePathwayAuditBundle(bundle).replace('{','{"schemaVersion":1,');
  assert.throws(()=>parsePathwayAuditBundleText(duplicate));
});

test("encoder rejects forged objects instead of blessing them as canonical evidence",()=>{
  const bundle=buildPathwayAuditBundle({observation:observation(),runTimestamp:"2026-08-02T12:34:56.789Z"});
  assert.throws(()=>encodePathwayAuditBundle({...bundle,status:"BLOCKED_INPUT_BINDING"}));
  assert.throws(()=>buildPathwayAuditBundle({observation:{...observation(),wallet:"secret"},runTimestamp:"2026-08-02T12:34:56.789Z"}));
});

test("a consistency status requires complete public evidence, not merely an empty blocker array",()=>{
  const input=observation();
  input.blocks.source=null;input.officialCode.source=[];input.providerAgreement.source.resultSha256=null;
  assert.throws(()=>buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"}));
});

test("inner observation digests are recomputed from normalized public evidence",()=>{
  for(const field of["configuration","source","destination"]){
    const input=observation();
    if(field==="configuration")input.configurationSha256=digest("f");
    else input.providerAgreement[field].resultSha256=digest("f");
    assert.throws(()=>buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"}),field);
  }
  const input=observation(),before=buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"});
  input.source.executor.maxMessageSize++;
  assert.throws(()=>buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"}));
  bindInnerDigests(input);
  const after=buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"});
  assert.notEqual(after.configurationSha256,before.configurationSha256);
  assert.notEqual(after.providerAgreement.source.resultSha256,before.providerAgreement.source.resultSha256);
  assert.notEqual(after.evidenceSha256,before.evidenceSha256);
});

test("a consistency claim independently rejects contradictory public evidence",async t=>{
  const cases=[
    ["duplicate provider label",input=>{
      input.providerAgreement.source.providers[1].label=input.providerAgreement.source.providers[0].label;
      input.deployments.sourceOApp.providerIdentities=structuredClone(input.providerAgreement.source.providers);
      input.deployments.sourceAdapter.providerIdentities=structuredClone(input.providerAgreement.source.providers);
    }],
    ["duplicate provider origin",input=>{
      input.providerAgreement.source.providers[1].originSha256=input.providerAgreement.source.providers[0].originSha256;
      input.deployments.sourceOApp.providerIdentities=structuredClone(input.providerAgreement.source.providers);
      input.deployments.sourceAdapter.providerIdentities=structuredClone(input.providerAgreement.source.providers);
    }],
    ["duplicate provider operator family",input=>{
      input.providerAgreement.source.providers[1].operatorFamily=input.providerAgreement.source.providers[0].operatorFamily;
      input.deployments.sourceOApp.providerIdentities=structuredClone(input.providerAgreement.source.providers);
      input.deployments.sourceAdapter.providerIdentities=structuredClone(input.providerAgreement.source.providers);
    }],
    ["provider identity reused across chains",input=>{
      input.providerAgreement.destination.providers[0]=structuredClone(input.providerAgreement.source.providers[0]);
      input.deployments.destinationOApp.providerIdentities=structuredClone(input.providerAgreement.destination.providers);
      input.deployments.destinationAdapter.providerIdentities=structuredClone(input.providerAgreement.destination.providers);
    }],
    ["deployment provider mismatch",input=>{input.deployments.sourceOApp.providerIdentities[0].label="different-provider"}],
    ["unsupported EID",input=>{input.source.supportedEid=false}],
    ["default library",input=>{input.destination.isDefaultReceiveLibrary=true}],
    ["non-3 path quorum",input=>{input.source.adapter.quorum="2"}],
    ["unauthorized signer",input=>{input.destination.adapter.signersAuthorized[2]=false}],
    ["OApp identity mismatch",input=>{input.source.sourceOApp=address(99)}],
    ["adapter identity mismatch",input=>{input.destination.adapter.address=address(99)}],
    ["constructor adapter binding mismatch",input=>{input.deployments.sourceAdapter.constructorArguments.messageLib=address(99)}],
    ["OApp endpoint binding mismatch",input=>{input.deployments.destinationOApp.constructorArguments.endpoint=address(99)}],
    ["peer mismatch",input=>{input.source.destinationPeer=hash("9")}],
    ["raw and resolved ULN mismatch",input=>{input.destination.resolvedUln.confirmations="63"}],
    ["cross-path ULN mismatch",input=>{input.destination.rawAppUln.requiredDvns=[address(98)];input.destination.resolvedUln.requiredDvns=[address(98)]}],
    ["confirmation policy mismatch",input=>{input.source.uln.confirmations="16"}],
    ["official endpoint mismatch",input=>{input.officialCode.destination[0].address=address(99)}],
    ["constructor signer tuple mismatch",input=>{input.deployments.destinationAdapter.constructorArguments.signers[4]=address(99)}],
    ["cross-chain contract artifact provenance mismatch",input=>{input.deployments.destinationOApp.deployedBytecodeSha256=digest("f")}],
    ["adapter EID mismatch",input=>{input.destination.adapter.supportedDstEid=40161}],
    ["source adapter library mismatch",input=>{input.source.adapter.messageLib=address(99);input.deployments.sourceAdapter.constructorArguments.messageLib=address(99)}],
    ["destination adapter target mismatch",input=>{input.destination.adapter.verificationTarget=address(99);input.deployments.destinationAdapter.constructorArguments.verificationTarget=address(99)}],
    ["Sentinel absent from optional DVNs",input=>{input.source.uln.optionalDvns=[address(97)];input.source.dvnCodeKeccak256[1].address=address(97)}],
    ["Sentinel code disagrees with deployment runtime",input=>{input.source.dvnCodeKeccak256[1].codeKeccak256=hash("9")}],
    ["deployment after pinned observation",input=>{input.deployments.destinationAdapter.deploymentBlockNumber="201"}]
  ];
  for(const[name,mutate]of cases)await t.test(name,()=>{
    const input=observation();mutate(input);bindInnerDigests(input);
    assert.throws(()=>buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"}));
  });
});

test("shared public identifier grammar accepts colon labels through the canonical bundle",()=>{
  const input=observation();
  input.providerAgreement.source.providers[0].label="source:primary";
  input.deployments.sourceOApp.providerIdentities=structuredClone(input.providerAgreement.source.providers);
  input.deployments.sourceAdapter.providerIdentities=structuredClone(input.providerAgreement.source.providers);
  bindInnerDigests(input);
  const bundle=buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"});
  assert.equal(parsePathwayAuditBundleText(encodePathwayAuditBundle(bundle)).providerAgreement.source.providers[0].label,"source:primary");
});

test("consistency accepts the upstream reviewed-optional posture when Sentinel is not the sole effective verifier",()=>{
  const input=observation();
  input.source.uln={confirmations:"15",requiredDvns:[],optionalDvns:[source.adapter,source.dvn],optionalDvnThreshold:2};
  input.source.dvnCodeKeccak256=[{address:source.adapter,codeKeccak256:hash("5")},{address:source.dvn,codeKeccak256:hash("6")}];
  input.destination.rawAppUln={confirmations:"64",requiredDvns:[],optionalDvns:[destination.dvn,destination.adapter],optionalDvnThreshold:2};
  input.destination.resolvedUln=structuredClone(input.destination.rawAppUln);
  bindInnerDigests(input);
  assert.equal(buildPathwayAuditBundle({observation:input,runTimestamp:"2026-08-02T12:34:56.789Z"}).status,"OBSERVED_PATHWAY_CONSISTENT");
});
