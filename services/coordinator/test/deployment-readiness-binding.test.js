import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {getAddress} from "ethers";
import {canonicalJson} from "../../../dist/services/coordinator/src/canonical-json.js";
import {parseDeploymentReadinessManifest} from "../../../dist/services/coordinator/src/deployment-readiness-manifest.js";
import {
  inspectDeploymentReadinessBindings,
  parseDeploymentReadinessConfig
} from "../../../dist/services/coordinator/src/deployment-readiness-binding.js";
import {
  buildPathwayAuditBundle,
  encodePathwayAuditBundle
} from "../../../dist/services/coordinator/src/pathway-audit-bundle.js";

const sha256=value=>createHash("sha256").update(value).digest("hex");
const json=value=>`${JSON.stringify(value,null,2)}\n`;
const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const sorted=values=>values.map(address).sort((left,right)=>left.toLowerCase().localeCompare(right.toLowerCase()));
const sourceText={SentinelDVNAdapter:"contract A{}",TreasuryPolicyOApp:"contract B{}"};

const auditDigest=value=>value.repeat(64);
const auditHash=value=>`0x${value.repeat(64)}`;
const auditAddress=value=>`0x${value.toString(16).padStart(40,"0")}`;
const auditProvider=(label,digit)=>({label,originSha256:auditDigest(digit),operatorFamily:`operator-${label}`});
const auditProviders=(chain,a,b)=>[auditProvider(`${chain}-a`,a),auditProvider(`${chain}-b`,b)];
const auditBlock=(chainId,number,digit)=>({
  chainId:String(chainId),blockNumber:String(number),blockHash:auditHash(digit),parentHash:auditHash("c"),
  stateRoot:auditHash("d"),transactionsRoot:auditHash("e"),timestamp:"1710000000"
});
const auditCode=(name,value,digit)=>({
  name,address:value,byteLength:2,runtimeCodeKeccak256:auditHash(digit),identity:"CODE_IDENTITY_REVIEWED"
});
const auditUln=(confirmations,required,optional)=>({
  confirmations,requiredDvns:[required],optionalDvns:[optional],optionalDvnThreshold:1
});
const auditAdapter=(value,lib,target)=>({
  address:value,messageLib:lib,verificationTarget:target,supportedDstEid:40231,quorum:"3",
  signersAuthorized:[true,true,true,true,true]
});
const auditSource={
  endpoint:auditAddress(1),send:auditAddress(2),receive:auditAddress(3),executor:auditAddress(4),
  oapp:auditAddress(5),adapter:auditAddress(6),dvn:auditAddress(7)
};
const auditDestination={
  endpoint:auditAddress(11),send:auditAddress(12),receive:auditAddress(13),oapp:auditAddress(14),
  adapter:auditAddress(15),dvn:auditSource.dvn
};
const auditSigners=[21,22,23,24,25].map(auditAddress);

function auditDeployment(contractName,chainId,value,providerIdentities,digit,constructorArguments){
  return{
    contractName,chainId:String(chainId),address:value,deployer:auditAddress(chainId===11155111?31:32),
    providerIdentities:structuredClone(providerIdentities),deploymentTxHash:auditHash(digit),deploymentBlockNumber:"90",
    deploymentBlockHash:auditHash(chainId===11155111?"8":"9"),creationBytecodeSha256:auditDigest("1"),
    deployedBytecodeSha256:auditDigest("2"),immutableReferencesSha256:auditDigest("3"),
    transactionInputSha256:auditDigest("4"),runtimeCodeKeccak256:auditHash("5"),constructorArguments
  };
}

function bindAuditInnerDigests(value){
  value.configurationSha256=sha256(canonicalJson({destination:value.destination,source:value.source}));
  value.providerAgreement.source.resultSha256=sha256(canonicalJson({
    block:value.blocks.source,
    deployments:{adapter:value.deployments.sourceAdapter,oapp:value.deployments.sourceOApp},
    officialCode:value.officialCode.source,path:value.source
  }));
  value.providerAgreement.destination.resultSha256=sha256(canonicalJson({
    block:value.blocks.destination,
    deployments:{adapter:value.deployments.destinationAdapter,oapp:value.deployments.destinationOApp},
    officialCode:value.officialCode.destination,path:value.destination
  }));
  return value;
}

function consistentPathwayAuditText(){
  const sourceProviders=auditProviders("source","1","2"),destinationProviders=auditProviders("destination","3","4");
  const sourcePath={
    endpoint:auditSource.endpoint,sourceOApp:auditSource.oapp,dstEid:40231,sendLibrary:auditSource.send,
    isDefaultSendLibrary:false,supportedEid:true,uln:auditUln("15",auditSource.dvn,auditSource.adapter),
    dvnCodeKeccak256:[
      {address:auditSource.dvn,codeKeccak256:auditHash("6")},
      {address:auditSource.adapter,codeKeccak256:auditHash("5")}
    ],
    executor:{maxMessageSize:10000,address:auditSource.executor},
    destinationPeer:`0x${"0".repeat(24)}${auditDestination.oapp.slice(2)}`,
    adapter:auditAdapter(auditSource.adapter,auditSource.send,auditSource.receive)
  };
  const destinationUln=auditUln("64",auditDestination.dvn,auditDestination.adapter);
  const destinationPath={
    endpoint:auditDestination.endpoint,oapp:auditDestination.oapp,srcEid:40161,
    receiveLibrary:auditDestination.receive,isDefaultReceiveLibrary:false,supportedEid:true,
    rawAppUln:destinationUln,resolvedUln:structuredClone(destinationUln),
    sourcePeer:`0x${"0".repeat(24)}${auditSource.oapp.slice(2)}`,
    adapter:auditAdapter(auditDestination.adapter,auditDestination.send,auditDestination.receive)
  };
  const observation=bindAuditInnerDigests({
    status:"OBSERVED_PATHWAY_CONSISTENT",truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",
    repositoryBindingSha256:auditDigest("a"),
    rpcIndependence:{source:"OPERATOR_INDEPENDENCE_REVIEWED",destination:"OPERATOR_INDEPENDENCE_REVIEWED"},
    providerAgreement:{
      source:{state:"TWO_TRANSPORTS_AGREE",providers:sourceProviders,resultSha256:null},
      destination:{state:"TWO_TRANSPORTS_AGREE",providers:destinationProviders,resultSha256:null}
    },
    blocks:{source:auditBlock(11155111,100,"a"),destination:auditBlock(421614,200,"b")},
    officialCode:{
      source:[
        auditCode("sourceEndpointV2",auditSource.endpoint,"1"),
        auditCode("sourceSendUln302",auditSource.send,"2"),
        auditCode("sourceExecutor",auditSource.executor,"3")
      ],
      destination:[
        auditCode("destinationEndpointV2",auditDestination.endpoint,"4"),
        auditCode("destinationReceiveUln302",auditDestination.receive,"5")
      ]
    },
    deployments:{
      sourceOApp:auditDeployment("TreasuryPolicyOApp",11155111,auditSource.oapp,sourceProviders,"1",{
        endpoint:auditSource.endpoint,delegate:auditAddress(41)
      }),
      destinationOApp:auditDeployment("TreasuryPolicyOApp",421614,auditDestination.oapp,destinationProviders,"2",{
        endpoint:auditDestination.endpoint,delegate:auditAddress(42)
      }),
      sourceAdapter:auditDeployment("SentinelDVNAdapter",11155111,auditSource.adapter,sourceProviders,"3",{
        messageLib:auditSource.send,verificationTarget:auditSource.receive,supportedDstEid:40231,
        signers:[...auditSigners],quorum:"3"
      }),
      destinationAdapter:auditDeployment("SentinelDVNAdapter",421614,auditDestination.adapter,destinationProviders,"4",{
        messageLib:auditDestination.send,verificationTarget:auditDestination.receive,supportedDstEid:40231,
        signers:[...auditSigners],quorum:"3"
      })
    },
    source:sourcePath,destination:destinationPath,configurationSha256:null,blockers:[]
  });
  return encodePathwayAuditBundle(buildPathwayAuditBundle({
    observation,runTimestamp:"2026-08-02T12:34:56.789Z"
  }));
}

function readinessConfig(){
  return{
    schemaVersion:2,
    toolVersion:"sentinel-readiness/v2",
    maximumAuditAgeDays:7,
    networkConfig:"config/networks.json",
    auditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
    buildManifest:"dist/contracts/build-manifest.json",
    productionArtifacts:{
      SentinelDVNAdapter:"dist/contracts/SentinelDVNAdapter.json",
      TreasuryPolicyOApp:"dist/contracts/TreasuryPolicyOApp.json"
    },
    productionSources:{
      SentinelDVNAdapter:"contracts/src/SentinelDVNAdapter.sol",
      TreasuryPolicyOApp:"contracts/src/TreasuryPolicyOApp.sol"
    },
    pathway:{source:"ethereum-sepolia",destination:"arbitrum-sepolia"},
    gates:{
      adapterConformance:"ILAYERZERO_DVN_INTERFACE_ADAPTER",
      payableAssignJobResolved:true,
      destinationVerificationTopologyResolved:false,
      layerZeroOnboardingConfirmed:false,
      independentDvnsSelected:false,
      livePathwayValidated:false,
      confirmationPolicyApproved:false,
      liveGenLayerFinalityReader:false,
      isolatedSignerOperators:false,
      independentRecoveryOperators:false,
      deploymentSecurityApproval:false
    }
  };
}

function networkConfig(){
  return{
    auditDate:"2026-08-02",
    status:"AUDITED_CONTRACT_METADATA_NOT_PATHWAY_VALIDATED",
    auditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
    pathway:{
      "ethereum-sepolia":{
        chainId:11155111,eid:40161,
        endpointV2:"0x6EDCE65403992e310A62460808c4b910D972f10f",
        sendUln302:"0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE",
        receiveUln302:"0xdAf00F5eE2158dD58E0d3857851c432E34A3A851",
        executor:"0x718B92b5CB0a5552039B593faF724D182A881eDA",
        deadDvn:"0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8",
        confirmations:{prototypeTestValue:3,unapprovedSecurityReviewCandidate:15},
        source:"https://docs.layerzero.network/v2/deployments/chains/sepolia"
      },
      "arbitrum-sepolia":{
        chainId:421614,eid:40231,
        endpointV2:"0x6EDCE65403992e310A62460808c4b910D972f10f",
        sendUln302:"0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E",
        receiveUln302:"0x75Db67CDab2824970131D5aa9CECfC9F69c69636",
        executor:"0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897",
        deadDvn:"0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611",
        confirmations:{prototypeTestValue:20,unapprovedSecurityReviewCandidate:64},
        source:"https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia"
      }
    },
    pathwayValidation:{
      ethereumSepoliaToArbitrumSepolia:"NOT_CHAIN_VALIDATED",
      arbitrumSepoliaToEthereumSepolia:"OUT_OF_M2_SCOPE",
      dvnSelection:"UNSELECTED",
      oappConfiguration:"NOT_DEPLOYED"
    },
    warning:"Audited metadata is not deployment authorization."
  };
}

function buildManifest(){
  return{
    schemaVersion:2,
    compiler:{
      version:"0.8.30+commit.73712a01.Emscripten.clang",
      evmVersion:"shanghai",
      optimizer:{enabled:true,runs:200}
    },
    contracts:[
      {
        name:"SentinelDVNAdapter",
        source:"contracts/src/SentinelDVNAdapter.sol",
        sourceSha256:"1474a0e5b5bae02c56b3ef48b068d394704b18aabe8fed91bbbca6ae3f1a5d83",
        abiSha256:"fd975e9dda11cf60a9e3a10f7f3d6b7ffd113696ff5e55d88c6e873254c77c8a",
        creationBytecodeSha256:"f3df0a62b10f205b0f29768aa3d69e777154caaa179f64aabb0a4899c666b017",
        deployedBytecodeSha256:"1a33f434c3fc58e156600f1814ef65f7c14ef8f9d2647208ff106b232120c871",
        immutableReferencesSha256:"7d38f4f9868bae72125d965c5719f16f4695c9d62a11dec142df339840a70f85"
      },
      {
        name:"TreasuryPolicyOApp",
        source:"contracts/src/TreasuryPolicyOApp.sol",
        sourceSha256:"b0968d422e1765ca98e8e8b6f4b8caa90b3e19a9f16b94a437c95474da8a4c72",
        abiSha256:"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        creationBytecodeSha256:"9e67b12fd8c58953460459cad7a6d4dd7d6d57594affce8206d1397c9c4db543",
        deployedBytecodeSha256:"07060149296c18b5684056facdb3e0172823fde3a737f2446b86d8b85cc6f1ba",
        immutableReferencesSha256:"ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356"
      }
    ]
  };
}

function productionArtifacts(){
  return{
    SentinelDVNAdapter:json({
      abi:[{type:"constructor",inputs:[]}],
      evm:{
        bytecode:{object:"6000"},
        deployedBytecode:{
          object:"6002",
          immutableReferences:{"12":[{start:1,length:32}],"3":[{start:33,length:20}]}
        }
      }
    }),
    TreasuryPolicyOApp:json({
      abi:[],
      evm:{
        bytecode:{object:"6001"},
        deployedBytecode:{object:"6003",immutableReferences:{}}
      }
    })
  };
}

function fixture(){
  const networkConfigText=json(networkConfig());
  const auditEvidenceText="# Deployment readiness audit\n\nAUDITED_METADATA_NOT_DEPLOYMENT_AUTHORIZATION\n";
  const buildManifestText=json(buildManifest());
  const manifest=parseDeploymentReadinessManifest({
    schemaVersion:2,
    classification:"LAYERZERO_DVN_CANDIDATE",
    sourceCommit:"1".repeat(40),
    audit:{
      date:"2026-08-02",
      evidenceSha256:sha256(auditEvidenceText),
      networkConfigSha256:sha256(networkConfigText)
    },
    source:{name:"ethereum-sepolia",chainId:11155111,eid:40161},
    destination:{name:"arbitrum-sepolia",chainId:421614,eid:40231},
    owner:address(0xabc),delegate:address(0xabd),
    signers:sorted([0x101,0x102,0x103,0x104,0x105]),quorum:3,
    recoveryOperators:sorted([0x201,0x202,0x203,0x204,0x205]),
    confirmations:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    artifacts:{
      SentinelDVNAdapter:{
        abiSha256:buildManifest().contracts[0].abiSha256,
        creationBytecodeSha256:buildManifest().contracts[0].creationBytecodeSha256
      },
      TreasuryPolicyOApp:{
        abiSha256:buildManifest().contracts[1].abiSha256,
        creationBytecodeSha256:buildManifest().contracts[1].creationBytecodeSha256
      }
    },
    pathwayAudit:null,
    acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED"
  });
  return{
    manifest,evaluationDate:"2026-08-02",
    git:{commit:"1".repeat(40),dirty:false},
    networkConfigText,auditEvidenceText,pathwayAuditText:null,
    readinessConfigText:json(readinessConfig()),
    buildManifestText,
    compiledBuildManifestText:buildManifestText,
    productionArtifacts:productionArtifacts(),
    productionSources:{...sourceText}
  };
}

test("binds clean source, compiler artifacts and audited network metadata",()=>{
  const input=fixture(),binding=inspectDeploymentReadinessBindings(input);
  assert.deepEqual(binding.blockers,[]);
  assert.equal(binding.toolVersion,"sentinel-readiness/v2");
  assert.equal(binding.pathwayAudit,null);
  assert.equal(binding.sourceCommit,"1".repeat(40));
  assert.match(binding.repositoryInputSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(binding.compiler,{
    version:"0.8.30+commit.73712a01.Emscripten.clang",
    evmVersion:"shanghai",
    optimizer:{enabled:true,runs:200}
  });
  assert.equal(binding.artifacts.SentinelDVNAdapter.sourceSha256,buildManifest().contracts[0].sourceSha256);
  assert.equal(binding.artifacts.TreasuryPolicyOApp.abiSha256,buildManifest().contracts[1].abiSha256);
  assert.equal(binding.gates.adapterConformance,"ILAYERZERO_DVN_INTERFACE_ADAPTER");
  assert.equal(binding.gates.payableAssignJobResolved,true);
  assert.equal(binding.gates.destinationVerificationTopologyResolved,false);
  assert.equal(
    binding.artifacts.SentinelDVNAdapter.deployedBytecodeSha256,
    "1a33f434c3fc58e156600f1814ef65f7c14ef8f9d2647208ff106b232120c871"
  );
  assert.equal(
    binding.artifacts.SentinelDVNAdapter.immutableReferencesSha256,
    "7d38f4f9868bae72125d965c5719f16f4695c9d62a11dec142df339840a70f85"
  );
  assert.equal(binding.audit.date,"2026-08-02");
  assert.equal(binding.network.source.chainId,11155111);
  assert.equal(binding.network.source.eid,40161);
  assert.equal(binding.network.destination.chainId,421614);
  assert.equal(binding.network.destination.eid,40231);
  assert.deepEqual(binding.network.source.deadDvn,{
    address:"0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8",selectable:false
  });
  assert.deepEqual(binding.network.destination.deadDvn,{
    address:"0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611",selectable:false
  });
  assert.equal(JSON.stringify(binding).includes("/Users/"),false);
  input.productionSources.SentinelDVNAdapter="changed";
  assert.equal(binding.artifacts.SentinelDVNAdapter.sourceSha256,buildManifest().contracts[0].sourceSha256);
});

test("binds only a detached consistent pathway summary and preserves every readiness gate",()=>{
  const input=fixture(),pathwayAuditText=consistentPathwayAuditText();
  input.manifest.pathwayAudit={evidenceSha256:sha256(pathwayAuditText)};
  input.pathwayAuditText=pathwayAuditText;
  const binding=inspectDeploymentReadinessBindings(input);
  assert.deepEqual(binding.pathwayAudit,{
    status:"OBSERVED_PATHWAY_CONSISTENT",
    truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",
    evidenceSha256:sha256(pathwayAuditText),
    runTimestamp:"2026-08-02T12:34:56.789Z",
    pinnedBlockHashes:{source:auditHash("a"),destination:auditHash("b")}
  });
  assert.equal(binding.gates.livePathwayValidated,false);
  assert.equal(binding.gates.independentDvnsSelected,false);
  assert.equal(binding.gates.confirmationPolicyApproved,false);
  const encoded=JSON.stringify(binding.pathwayAudit);
  for(const forbidden of["https://","providers","deployments","sourceOApp","rpcUrl","privateKey"])
    assert.equal(encoded.includes(forbidden),false,forbidden);
});

test("requires exact manifest-to-artifact attachment and strict consistent evidence",()=>{
  const base=consistentPathwayAuditText();
  const cases=[
    input=>{input.pathwayAuditText=base},
    input=>{input.manifest.pathwayAudit={evidenceSha256:sha256(base)}},
    input=>{
      input.manifest.pathwayAudit={evidenceSha256:"f".repeat(64)};
      input.pathwayAuditText=base;
    },
    input=>{
      const value=JSON.parse(base);value.truthLabel="LIVE_PATHWAY_VALIDATED";
      const{evidenceSha256:ignored,...body}=value;value.evidenceSha256=sha256(canonicalJson(body));
      input.pathwayAuditText=canonicalJson(value);
      input.manifest.pathwayAudit={evidenceSha256:sha256(input.pathwayAuditText)};
    },
    input=>{
      const value=JSON.parse(base);
      value.blockers=[{code:"AUDIT_RPC_UNAVAILABLE",category:"RPC_CONSENSUS",remediation:"REPLACE_RPC_TRANSPORT"}];
      const{evidenceSha256:ignored,...body}=value;value.evidenceSha256=sha256(canonicalJson(body));
      input.pathwayAuditText=canonicalJson(value);
      input.manifest.pathwayAudit={evidenceSha256:sha256(input.pathwayAuditText)};
    },
    input=>{
      const value=JSON.parse(base);value.providerAgreement.source.providers[0].rpcUrl="https://rpc.example";
      input.pathwayAuditText=canonicalJson(value);
      input.manifest.pathwayAudit={evidenceSha256:sha256(input.pathwayAuditText)};
    },
    input=>{
      const value=JSON.parse(base);value.source.adapter.privateKey="must-not-appear";
      input.pathwayAuditText=canonicalJson(value);
      input.manifest.pathwayAudit={evidenceSha256:sha256(input.pathwayAuditText)};
    },
    input=>{
      input.pathwayAuditText=JSON.stringify(JSON.parse(base));
      input.manifest.pathwayAudit={evidenceSha256:sha256(input.pathwayAuditText)};
    }
  ];
  for(const mutate of cases){
    const input=fixture();mutate(input);
    assert.throws(()=>inspectDeploymentReadinessBindings(input),/READINESS_MANIFEST_INVALID/);
  }
});

test("reports every ordinary repository and audit drift as a sanitized blocker",()=>{
  const cases=[
    ["READINESS_SOURCE_DIRTY",input=>{input.git.dirty=true}],
    ["READINESS_ARTIFACT_DRIFT",input=>{input.git.commit="f".repeat(40)}],
    ["READINESS_ARTIFACT_DRIFT",input=>{const value=JSON.parse(input.buildManifestText);value.schemaVersion=1;input.buildManifestText=json(value)}],
    ["READINESS_ARTIFACT_DRIFT",input=>{input.buildManifestText=input.buildManifestText.replace("0.8.30","0.8.29")}],
    ["READINESS_ARTIFACT_DRIFT",input=>{const value=JSON.parse(input.buildManifestText);value.contracts[0].name="TreasuryPolicyOApp";input.buildManifestText=json(value)}],
    ["READINESS_ARTIFACT_DRIFT",input=>{const value=JSON.parse(input.buildManifestText);value.contracts[0].source="contracts/src/Other.sol";input.buildManifestText=json(value)}],
    ["READINESS_ARTIFACT_DRIFT",input=>{
      const value=JSON.parse(input.buildManifestText),forged="a".repeat(64);
      value.contracts[0].abiSha256=forged;input.buildManifestText=json(value);
      input.manifest.artifacts.SentinelDVNAdapter.abiSha256=forged;
    }],
    ["READINESS_ARTIFACT_DRIFT",input=>{
      input.productionArtifacts.SentinelDVNAdapter=
        input.productionArtifacts.SentinelDVNAdapter.replace("6000","6002");
    }],
    ["READINESS_ARTIFACT_DRIFT",input=>{
      const value=JSON.parse(input.productionArtifacts.SentinelDVNAdapter);
      value.evm.deployedBytecode.object="6003";
      input.productionArtifacts.SentinelDVNAdapter=json(value);
    }],
    ["READINESS_ARTIFACT_DRIFT",input=>{
      const value=JSON.parse(input.productionArtifacts.SentinelDVNAdapter);
      value.evm.deployedBytecode.immutableReferences["12"][0].length=33;
      input.productionArtifacts.SentinelDVNAdapter=json(value);
    }],
    ["READINESS_ARTIFACT_DRIFT",input=>{input.productionSources.SentinelDVNAdapter+="\n"}],
    ["READINESS_METADATA_MISMATCH",input=>{input.networkConfigText=input.networkConfigText.replace("40161","40162")}],
    ["READINESS_METADATA_MISMATCH",input=>{input.auditEvidenceText+="altered"}],
    ["READINESS_METADATA_STALE",input=>{input.evaluationDate="2026-08-10"}]
  ];
  for(const [code,mutate]of cases){
    const input=fixture();mutate(input);
    const binding=inspectDeploymentReadinessBindings(input);
    assert(binding.blockers.some(blocker=>blocker.code===code),code);
    const output=JSON.stringify(binding.blockers);
    assert.equal(output.includes("contract A"),false);
    assert.equal(output.includes("/Users/"),false);
    assert.equal(output.includes(input.auditEvidenceText),false);
  }
});

test("selects stable blocker ordering and a deterministic repository digest",()=>{
  const input=fixture();input.git.dirty=true;input.git.commit="f".repeat(40);
  input.auditEvidenceText+="altered";
  const first=inspectDeploymentReadinessBindings(input),second=inspectDeploymentReadinessBindings(structuredClone(input));
  assert.deepEqual(first,second);
  assert.deepEqual(first.blockers.map(value=>value.code),[
    "READINESS_ARTIFACT_DRIFT",
    "READINESS_METADATA_MISMATCH",
    "READINESS_SOURCE_DIRTY"
  ]);
});

test("rejects malformed readiness configuration and forbidden path fields",()=>{
  const valid=json(readinessConfig());
  assert.equal(parseDeploymentReadinessConfig(valid).maximumAuditAgeDays,7);
  const invalid=[
    value=>{value.schemaVersion=1},
    value=>{value.toolVersion="sentinel-readiness/v1"},
    value=>{value.extra=true},
    value=>{delete value.gates},
    value=>{value.maximumAuditAgeDays=0},
    value=>{value.networkConfig="../config/networks.json"},
    value=>{value.auditEvidence="docs/research/2026-07-29-deployment-readiness-audit.md"},
    value=>{value.buildManifest="/tmp/build-manifest.json"},
    value=>{value.productionArtifacts.SentinelDVNAdapter="../SentinelDVNAdapter.json"},
    value=>{value.gates.adapterConformance="OFFICIAL_DVN"},
    value=>{value.gates.independentDvnsSelected="false"}
  ];
  for(const mutate of invalid){
    const value=readinessConfig();mutate(value);
    assert.throws(()=>parseDeploymentReadinessConfig(json(value)),/READINESS_MANIFEST_INVALID/);
  }
});

test("rejects duplicate keys throughout local readiness evidence",()=>{
  const cases=[
    input=>{input.readinessConfigText=input.readinessConfigText.replace(
      '"schemaVersion": 2,','"schemaVersion": 2,\n  "schemaVersion": 2,'
    )},
    input=>{input.networkConfigText=input.networkConfigText.replace(
      '"chainId": 11155111,','"chainId": 11155111, "chainId": 11155111,'
    )},
    input=>{input.buildManifestText=input.buildManifestText.replace(
      '"runs": 200','"runs": 200, "runs": 200'
    )},
    input=>{input.productionArtifacts.SentinelDVNAdapter=
      input.productionArtifacts.SentinelDVNAdapter.replace('"abi": [','"abi": [], "abi": [')}
  ];
  for(const mutate of cases){
    const input=fixture();mutate(input);
    assert.throws(()=>inspectDeploymentReadinessBindings(input),/READINESS_MANIFEST_INVALID/);
  }
});

test("rejects build manifests that omit schema-v2 provenance fields",()=>{
  for(const field of["deployedBytecodeSha256","immutableReferencesSha256"]){
    const input=fixture(),value=JSON.parse(input.buildManifestText);
    delete value.contracts[0][field];input.buildManifestText=json(value);
    assert.throws(()=>inspectDeploymentReadinessBindings(input),/READINESS_MANIFEST_INVALID/);
  }
});

test("rejects synchronized public, ignored-manifest, and ignored-artifact forgery",()=>{
  const input=fixture(),artifact=JSON.parse(input.productionArtifacts.SentinelDVNAdapter);
  artifact.abi=[{type:"error",name:"Forged",inputs:[]}];
  input.productionArtifacts.SentinelDVNAdapter=json(artifact);
  const forged=sha256(JSON.stringify(artifact.abi)),manifest=JSON.parse(input.buildManifestText);
  manifest.contracts[0].abiSha256=forged;
  input.buildManifestText=json(manifest);
  input.manifest.artifacts.SentinelDVNAdapter.abiSha256=forged;
  const binding=inspectDeploymentReadinessBindings(input);
  assert(binding.blockers.some(blocker=>blocker.code==="READINESS_ARTIFACT_DRIFT"));
});
