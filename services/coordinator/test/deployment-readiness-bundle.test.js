import test from "node:test";
import assert from "node:assert/strict";
import {getAddress} from "ethers";
import {parseDeploymentReadinessManifest} from "../../../dist/services/coordinator/src/deployment-readiness-manifest.js";
import {
  buildDeploymentReadinessBundle,
  encodeDeploymentReadinessBundle
} from "../../../dist/services/coordinator/src/deployment-readiness-bundle.js";

const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const sorted=values=>values.map(address).sort((left,right)=>left.toLowerCase().localeCompare(right.toLowerCase()));
const digest=value=>value.repeat(64);

function manifest(classification="LAYERZERO_DVN_CANDIDATE"){
  return parseDeploymentReadinessManifest({
    schemaVersion:1,classification,sourceCommit:"1".repeat(40),
    audit:{date:"2026-07-29",evidenceSha256:digest("a"),networkConfigSha256:digest("b")},
    source:{name:"ethereum-sepolia",chainId:11155111,eid:40161},
    destination:{name:"arbitrum-sepolia",chainId:421614,eid:40231},
    owner:address(0xabc),delegate:address(0xabd),
    signers:sorted([0x101,0x102,0x103,0x104,0x105]),quorum:3,
    recoveryOperators:sorted([0x201,0x202,0x203,0x204,0x205]),
    confirmations:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    artifacts:{
      SentinelDVNAdapter:{abiSha256:digest("c"),creationBytecodeSha256:digest("d")},
      TreasuryPolicyOApp:{abiSha256:digest("e"),creationBytecodeSha256:digest("f")}
    },
    acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED"
  });
}

const network=(name,chainId,eid,deadDvn)=>({
  name,chainId,eid,
  endpointV2:"0x6EDCE65403992e310A62460808c4b910D972f10f",
  sendUln302:name==="ethereum-sepolia"
    ?"0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE"
    :"0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E",
  receiveUln302:name==="ethereum-sepolia"
    ?"0xdAf00F5eE2158dD58E0d3857851c432E34A3A851"
    :"0x75Db67CDab2824970131D5aa9CECfC9F69c69636",
  executor:name==="ethereum-sepolia"
    ?"0x718B92b5CB0a5552039B593faF724D182A881eDA"
    :"0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897",
  deadDvn:{address:deadDvn,selectable:false},
  confirmations:name==="ethereum-sepolia"
    ?{prototypeTestValue:3,unapprovedSecurityReviewCandidate:15}
    :{prototypeTestValue:20,unapprovedSecurityReviewCandidate:64},
  source:name==="ethereum-sepolia"
    ?"https://docs.layerzero.network/v2/deployments/chains/sepolia"
    :"https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia"
});

function binding(){
  return{
    toolVersion:"sentinel-readiness/v1",
    sourceCommit:"1".repeat(40),
    repositoryInputSha256:digest("9"),
    compiler:{version:"0.8.30+commit.73712a01.Emscripten.clang",evmVersion:"shanghai",optimizer:{enabled:true,runs:200}},
    artifacts:{
      SentinelDVNAdapter:{source:"contracts/src/SentinelDVNAdapter.sol",sourceSha256:digest("1"),abiSha256:digest("c"),creationBytecodeSha256:digest("d")},
      TreasuryPolicyOApp:{source:"contracts/src/TreasuryPolicyOApp.sol",sourceSha256:digest("2"),abiSha256:digest("e"),creationBytecodeSha256:digest("f")}
    },
    audit:{
      date:"2026-07-29",evidenceSha256:digest("a"),networkConfigSha256:digest("b"),
      sources:[
        "https://docs.layerzero.network/v2/deployments/chains/sepolia",
        "https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia"
      ]
    },
    network:{
      source:network("ethereum-sepolia",11155111,40161,"0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8"),
      destination:network("arbitrum-sepolia",421614,40231,"0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611"),
      pathwayValidation:{
        ethereumSepoliaToArbitrumSepolia:"NOT_CHAIN_VALIDATED",
        arbitrumSepoliaToEthereumSepolia:"OUT_OF_M2_SCOPE",
        dvnSelection:"UNSELECTED",
        oappConfiguration:"NOT_DEPLOYED"
      }
    },
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
    },
    blockers:[]
  };
}

test("blocks the current adapter candidate and preserves every truth boundary",()=>{
  const result=buildDeploymentReadinessBundle({manifest:manifest(),binding:binding(),evaluationDate:"2026-07-29"});
  assert.equal(result.status,"BLOCKED_DVN_CONFORMANCE");
  assert.equal(result.truthLabel,"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED");
  assert.equal(result.userApprovalRequired,true);
  assert.deepEqual(result.transactions,[]);
  assert.equal(Object.hasOwn(result,"readinessGates"),false);
  assert.equal(result.network.source.deadDvn.selectable,false);
  assert.equal(result.network.destination.deadDvn.selectable,false);
  assert.deepEqual(result.policyBoundary,{
    deterministic:"PACKET_PATH_CONFIRMATIONS_REPLAY",
    semantic:"FINALIZED_GENLAYER_GOVERNANCE_POLICY",
    signing:"ONLY_AFTER_BOTH_FINALIZE",
    layerZeroRole:"ADDITIONAL_OR_OPTIONAL_WITH_INDEPENDENT_DVNS"
  });
  assert.deepEqual(result.blockers.map(value=>value.remediation),[
    "APPROVE_CONFIRMATION_POLICY",
    "CONFIRM_LAYERZERO_ONBOARDING",
    "DEPLOY_ISOLATED_SIGNER_OPERATORS",
    "DEPLOY_LIVE_GENLAYER_FINALITY_READER",
    "DESIGN_CONFORMANT_DVN_CONTRACT",
    "ESTABLISH_INDEPENDENT_RECOVERY_OPERATORS",
    "OBTAIN_DEPLOYMENT_SECURITY_APPROVAL",
    "RESOLVE_DESTINATION_VERIFICATION_TOPOLOGY",
    "SELECT_INDEPENDENT_DVNS",
    "VALIDATE_LIVE_PATHWAY"
  ]);
  assert(result.blockers.some(value=>value.remediation==="DESIGN_CONFORMANT_DVN_CONTRACT"));
  assert.equal(result.blockers.some(value=>value.remediation==="RESOLVE_PAYABLE_ASSIGN_JOB"),false);
  assert.deepEqual(result.transactions,[]);
});

test("never infers conformance from local classification or ABI selector names",()=>{
  const localManifest=manifest("LOCAL_ADAPTER_PROTOTYPE"),current=binding();
  current.artifacts.SentinelDVNAdapter.abiSelectors=["assignJob","getFee"];
  const result=buildDeploymentReadinessBundle({manifest:localManifest,binding:current,evaluationDate:"2026-07-29"});
  assert.equal(result.status,"BLOCKED_DVN_CONFORMANCE");
  assert.equal(result.classification,"LOCAL_ADAPTER_PROTOTYPE");
  assert(result.blockers.some(value=>value.remediation==="LOCAL_CLASSIFICATION_NONDEPLOYABLE"));
  assert.deepEqual(result.transactions,[]);
});

test("applies artifact, network, conformance and configuration status precedence",()=>{
  const statusFor=blockers=>{
    const value=binding();value.blockers=blockers;
    return buildDeploymentReadinessBundle({manifest:manifest(),binding:value,evaluationDate:"2026-07-29"}).status;
  };
  assert.equal(statusFor([{code:"READINESS_METADATA_MISMATCH",category:"NETWORK",remediation:"RECHECK_OFFICIAL_NETWORK_METADATA"}]),"BLOCKED_NETWORK_AUDIT");
  assert.equal(statusFor([
    {code:"READINESS_METADATA_MISMATCH",category:"NETWORK",remediation:"RECHECK_OFFICIAL_NETWORK_METADATA"},
    {code:"READINESS_ARTIFACT_DRIFT",category:"ARTIFACT",remediation:"REBUILD_FROM_COMMITTED_SOURCE"}
  ]),"BLOCKED_ARTIFACT_BINDING");
  const configured=binding();
  configured.gates={
    ...configured.gates,
    adapterConformance:"LAYERZERO_DVN_CANDIDATE",
    payableAssignJobResolved:true,
    destinationVerificationTopologyResolved:true,
    layerZeroOnboardingConfirmed:true
  };
  assert.equal(
    buildDeploymentReadinessBundle({manifest:manifest(),binding:configured,evaluationDate:"2026-07-29"}).status,
    "BLOCKED_CONFIGURATION"
  );
});

test("a synthetic future-ready result remains unsigned and separately approval-gated",()=>{
  const future=binding();
  future.gates=Object.fromEntries(Object.keys(future.gates).map(key=>[
    key,key==="adapterConformance"?"LAYERZERO_DVN_CANDIDATE":true
  ]));
  const result=buildDeploymentReadinessBundle({manifest:manifest(),binding:future,evaluationDate:"2026-07-29"});
  assert.equal(result.status,"READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL");
  assert.equal(result.truthLabel,"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED");
  assert.equal(result.userApprovalRequired,true);
  assert.deepEqual(result.transactions,[]);
  assert.deepEqual(result.blockers,[]);
});

test("encodes deterministic sanitized output bound to the evaluation date",()=>{
  const input={manifest:manifest(),binding:binding(),evaluationDate:"2026-07-29"};
  const first=encodeDeploymentReadinessBundle(buildDeploymentReadinessBundle(input));
  const second=encodeDeploymentReadinessBundle(buildDeploymentReadinessBundle(structuredClone(input)));
  assert.equal(first,second);
  const next=encodeDeploymentReadinessBundle(buildDeploymentReadinessBundle({...input,evaluationDate:"2026-07-30"}));
  assert.notEqual(first,next);
  for(const forbidden of[
    "privateKey","mnemonic","rpcUrl","gasPrice","nonce","rawTransaction","/Users/","Error:"
  ])assert.equal(first.includes(forbidden),false);
  assert.equal(first.endsWith("\n"),true);
});
