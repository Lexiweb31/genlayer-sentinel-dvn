import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import fc from"fast-check";
import{canonicalJson}from"../../../dist/services/coordinator/src/canonical-json.js";
import{
  buildPathwayAuditBundle,encodePathwayAuditBundle,parsePathwayAuditBundleText
}from"../../../dist/services/coordinator/src/pathway-audit-bundle.js";

const address=value=>`0x${value.toString(16).padStart(40,"0")}`;
const hex32=bytes=>`0x${Buffer.from(bytes).toString("hex")}`;
const digest32=bytes=>Buffer.from(bytes).toString("hex");
const hash=digit=>`0x${digit.repeat(64)}`;
const digest=digit=>digit.repeat(64);
const bytes32=fc.uint8Array({minLength:32,maxLength:32});
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

function normalizedObservation(values){
  const sourceProvider=[
    {label:"source-a",originSha256:"1".repeat(64),operatorFamily:"operator-source-a"},
    {label:"source-b",originSha256:"2".repeat(64),operatorFamily:"operator-source-b"}
  ];
  const destinationProvider=[
    {label:"destination-a",originSha256:"3".repeat(64),operatorFamily:"operator-destination-a"},
    {label:"destination-b",originSha256:"4".repeat(64),operatorFamily:"operator-destination-b"}
  ];
  const sourceUln={confirmations:"15",requiredDvns:[source.dvn],optionalDvns:[source.adapter],optionalDvnThreshold:1};
  const destinationUln={confirmations:"64",requiredDvns:[destination.dvn],optionalDvns:[destination.adapter],optionalDvnThreshold:1};
  return bindInnerDigests({
    status:"OBSERVED_PATHWAY_CONSISTENT",truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",
    repositoryBindingSha256:digest32(values.repository),
    rpcIndependence:{source:"OPERATOR_INDEPENDENCE_REVIEWED",destination:"OPERATOR_INDEPENDENCE_REVIEWED"},
    providerAgreement:{
      source:{state:"TWO_TRANSPORTS_AGREE",providers:sourceProvider,resultSha256:digest("a")},
      destination:{state:"TWO_TRANSPORTS_AGREE",providers:destinationProvider,resultSha256:digest("b")}
    },
    blocks:{
      source:{chainId:"11155111",blockNumber:"100",blockHash:hex32(values.sourceBlock),parentHash:`0x${"a".repeat(64)}`,stateRoot:`0x${"b".repeat(64)}`,transactionsRoot:`0x${"c".repeat(64)}`,timestamp:"1710000000"},
      destination:{chainId:"421614",blockNumber:"200",blockHash:hex32(values.destinationBlock),parentHash:`0x${"d".repeat(64)}`,stateRoot:`0x${"e".repeat(64)}`,transactionsRoot:`0x${"f".repeat(64)}`,timestamp:"1710000001"}
    },
    officialCode:{
      source:[
        {name:"sourceEndpointV2",address:source.endpoint,byteLength:2,runtimeCodeKeccak256:hex32(values.code),identity:"CODE_IDENTITY_REVIEWED"},
        {name:"sourceSendUln302",address:source.send,byteLength:2,runtimeCodeKeccak256:hash("1"),identity:"CODE_IDENTITY_REVIEWED"},
        {name:"sourceExecutor",address:source.executor,byteLength:2,runtimeCodeKeccak256:hash("2"),identity:"CODE_IDENTITY_REVIEWED"}
      ],
      destination:[
        {name:"destinationEndpointV2",address:destination.endpoint,byteLength:2,runtimeCodeKeccak256:hash("3"),identity:"CODE_IDENTITY_REVIEWED"},
        {name:"destinationReceiveUln302",address:destination.receive,byteLength:2,runtimeCodeKeccak256:hash("4"),identity:"CODE_IDENTITY_REVIEWED"}
      ]
    },
    deployments:{
      sourceOApp:deployment("TreasuryPolicyOApp",11155111,source.oapp,sourceProvider,"1",{endpoint:source.endpoint,delegate:address(41)}),
      destinationOApp:deployment("TreasuryPolicyOApp",421614,destination.oapp,destinationProvider,"2",{endpoint:destination.endpoint,delegate:address(42)}),
      sourceAdapter:deployment("SentinelDVNAdapter",11155111,source.adapter,sourceProvider,"3",{
        messageLib:source.send,verificationTarget:source.receive,supportedDstEid:40231,signers:[...signers],quorum:"3"
      }),
      destinationAdapter:deployment("SentinelDVNAdapter",421614,destination.adapter,destinationProvider,"4",{
        messageLib:destination.send,verificationTarget:destination.receive,supportedDstEid:40231,signers:[...signers],quorum:"3"
      })
    },
    source:{
      endpoint:source.endpoint,sourceOApp:source.oapp,dstEid:40231,sendLibrary:source.send,isDefaultSendLibrary:false,
      supportedEid:true,uln:sourceUln,
      dvnCodeKeccak256:[{address:source.dvn,codeKeccak256:hash("6")},{address:source.adapter,codeKeccak256:hash("5")}],
      executor:{maxMessageSize:values.configurationValue,address:source.executor},
      destinationPeer:`0x${"0".repeat(24)}${destination.oapp.slice(2)}`,
      adapter:{address:source.adapter,messageLib:source.send,verificationTarget:source.receive,supportedDstEid:40231,quorum:"3",signersAuthorized:[true,true,true,true,true]}
    },
    destination:{
      endpoint:destination.endpoint,oapp:destination.oapp,srcEid:40161,receiveLibrary:destination.receive,
      isDefaultReceiveLibrary:false,supportedEid:true,rawAppUln:destinationUln,resolvedUln:structuredClone(destinationUln),
      sourcePeer:`0x${"0".repeat(24)}${source.oapp.slice(2)}`,
      adapter:{address:destination.adapter,messageLib:destination.send,verificationTarget:destination.receive,supportedDstEid:40231,quorum:"3",signersAuthorized:[true,true,true,true,true]}
    },
    configurationSha256:digest("c"),
    blockers:[]
  });
}

function bindInnerDigests(value){
  value.configurationSha256=createHash("sha256").update(canonicalJson({destination:value.destination,source:value.source})).digest("hex");
  value.providerAgreement.source.resultSha256=createHash("sha256").update(canonicalJson({
    block:value.blocks.source,deployments:{adapter:value.deployments.sourceAdapter,oapp:value.deployments.sourceOApp},
    officialCode:value.officialCode.source,path:value.source
  })).digest("hex");
  value.providerAgreement.destination.resultSha256=createHash("sha256").update(canonicalJson({
    block:value.blocks.destination,deployments:{adapter:value.deployments.destinationAdapter,oapp:value.deployments.destinationOApp},
    officialCode:value.officialCode.destination,path:value.destination
  })).digest("hex");
  return value;
}

const observationArbitrary=fc.record({
  repository:bytes32,sourceBlock:bytes32,destinationBlock:bytes32,code:bytes32,
  configurationValue:fc.integer({min:1,max:1_000_000})
}).map(normalizedObservation);

function reversedObjects(value){
  if(Array.isArray(value))return value.map(reversedObjects);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reversedObjects(item)]));
  return value;
}

function changedHex(value){
  const last=value.at(-1);return`${value.slice(0,-1)}${last==="0"?"1":"0"}`;
}

const campaign=(name,seed,property)=>test(name,async()=>{
  await fc.assert(fc.property(observationArbitrary,property),{seed,numRuns:128,endOnFailure:true});
});

campaign("property: recursive object insertion order cannot change canonical bytes",0x51a7b001,observation=>{
  const first=buildPathwayAuditBundle({observation,runTimestamp:"2026-08-02T00:00:00.000Z"});
  const second=buildPathwayAuditBundle({observation:reversedObjects(observation),runTimestamp:"2026-08-02T00:00:00.000Z"});
  assert.equal(encodePathwayAuditBundle(first),encodePathwayAuditBundle(second));
});

campaign("property: block, code, and configuration mutations change evidence digest",0x51a7b002,observation=>{
  const original=buildPathwayAuditBundle({observation,runTimestamp:"2026-08-02T00:00:00.000Z"});
  const blockMutation=structuredClone(observation);blockMutation.blocks.source.blockHash=changedHex(blockMutation.blocks.source.blockHash);
  const codeMutation=structuredClone(observation);codeMutation.officialCode.source[0].runtimeCodeKeccak256=changedHex(codeMutation.officialCode.source[0].runtimeCodeKeccak256);
  const configurationMutation=structuredClone(observation);configurationMutation.source.executor.maxMessageSize++;
  for(const mutation of[blockMutation,codeMutation,configurationMutation]){
    bindInnerDigests(mutation);
    const changed=buildPathwayAuditBundle({observation:mutation,runTimestamp:"2026-08-02T00:00:00.000Z"});
    assert.notEqual(changed.evidenceSha256,original.evidenceSha256);
  }
});

campaign("property: adding any blocker cannot yield a consistent status",0x51a7b003,observation=>{
  const categories=[
    {code:"AUDIT_NETWORK_METADATA_MISMATCH",category:"INPUT_BINDING",remediation:"RECHECK_NETWORK_AUDIT"},
    {code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"},
    {code:"AUDIT_RPC_UNAVAILABLE",category:"RPC_CONSENSUS",remediation:"REPLACE_RPC_TRANSPORT"},
    {code:"AUDIT_CODE_MISSING",category:"CODE_IDENTITY",remediation:"PIN_REVIEWED_CODE_IDENTITY"},
    {code:"AUDIT_PATHWAY_DEPLOYMENTS_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"}
  ];
  for(const blocker of categories){
    const changed=structuredClone(observation);changed.blockers=[blocker];
    assert.notEqual(buildPathwayAuditBundle({observation:changed,runTimestamp:"2026-08-02T00:00:00.000Z"}).status,"OBSERVED_PATHWAY_CONSISTENT");
  }
});

campaign("property: blocker input order cannot change output",0x51a7b004,observation=>{
  const changed=structuredClone(observation);
  changed.blockers=[
    {code:"AUDIT_CODE_MISSING",category:"CODE_IDENTITY",remediation:"PIN_REVIEWED_CODE_IDENTITY"},
    {code:"AUDIT_RPC_UNAVAILABLE",category:"RPC_CONSENSUS",remediation:"REPLACE_RPC_TRANSPORT"},
    {code:"AUDIT_NETWORK_METADATA_MISMATCH",category:"INPUT_BINDING",remediation:"RECHECK_NETWORK_AUDIT"}
  ];
  const reversed=structuredClone(changed);reversed.blockers.reverse();
  const first=buildPathwayAuditBundle({observation:changed,runTimestamp:"2026-08-02T00:00:00.000Z"});
  const second=buildPathwayAuditBundle({observation:reversed,runTimestamp:"2026-08-02T00:00:00.000Z"});
  assert.equal(encodePathwayAuditBundle(first),encodePathwayAuditBundle(second));
});

campaign("property: canonical serialized bytes round-trip through the strict parser",0x51a7b005,observation=>{
  const bundle=buildPathwayAuditBundle({observation,runTimestamp:"2026-08-02T00:00:00.000Z"});
  const text=encodePathwayAuditBundle(bundle);
  assert.deepEqual(parsePathwayAuditBundleText(text),bundle);
  assert.equal(encodePathwayAuditBundle(parsePathwayAuditBundleText(text)),text);
});
