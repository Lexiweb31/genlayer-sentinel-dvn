import{canonicalJson}from"./canonical-json.js";
import{
  type ReadinessBinding,
  type ReadinessBlocker,
  type ReadinessBlockerCategory
}from"./deployment-readiness-binding.js";
import{
  ReadinessError,
  type DeploymentReadinessManifest,
  type ReadinessClassification
}from"./deployment-readiness-manifest.js";

export type DeploymentReadinessStatus=
  "READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL"|
  "BLOCKED_DVN_CONFORMANCE"|"BLOCKED_NETWORK_AUDIT"|
  "BLOCKED_ARTIFACT_BINDING"|"BLOCKED_CONFIGURATION";
export interface DeploymentReadinessBundle{
  schemaVersion:1;
  toolVersion:"sentinel-readiness/v1";
  evaluationDate:string;
  status:DeploymentReadinessStatus;
  classification:ReadinessClassification;
  truthLabel:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED";
  userApprovalRequired:true;
  source:{commit:string;repositoryInputSha256:string};
  compiler:ReadinessBinding["compiler"];
  artifacts:ReadinessBinding["artifacts"];
  audit:ReadinessBinding["audit"];
  network:ReadinessBinding["network"];
  roles:{
    owner:string;delegate:string;
    signers:[string,string,string,string,string];quorum:3;
    recoveryOperators:[string,string,string,string,string];
  };
  confirmations:DeploymentReadinessManifest["confirmations"];
  policyBoundary:{
    deterministic:"PACKET_PATH_CONFIRMATIONS_REPLAY";
    semantic:"FINALIZED_GENLAYER_GOVERNANCE_POLICY";
    signing:"ONLY_AFTER_BOTH_FINALIZE";
    layerZeroRole:"ADDITIONAL_OR_OPTIONAL_WITH_INDEPENDENT_DVNS";
  };
  blockers:ReadinessBlocker[];
  transactions:[];
}
export interface BuildDeploymentReadinessBundleInput{
  manifest:DeploymentReadinessManifest;
  binding:ReadinessBinding;
  evaluationDate:string;
}

const remediationCodes=new Set([
  "COMMIT_OR_REMOVE_SOURCE_CHANGES","REBUILD_FROM_COMMITTED_SOURCE",
  "RECHECK_OFFICIAL_NETWORK_METADATA","REFRESH_PRIMARY_SOURCE_AUDIT",
  "LOCAL_CLASSIFICATION_NONDEPLOYABLE","DESIGN_CONFORMANT_DVN_CONTRACT",
  "RESOLVE_PAYABLE_ASSIGN_JOB","RESOLVE_DESTINATION_VERIFICATION_TOPOLOGY",
  "CONFIRM_LAYERZERO_ONBOARDING","SELECT_INDEPENDENT_DVNS","VALIDATE_LIVE_PATHWAY",
  "APPROVE_CONFIRMATION_POLICY","DEPLOY_LIVE_GENLAYER_FINALITY_READER",
  "DEPLOY_ISOLATED_SIGNER_OPERATORS","ESTABLISH_INDEPENDENT_RECOVERY_OPERATORS",
  "OBTAIN_DEPLOYMENT_SECURITY_APPROVAL"
]);

export function buildDeploymentReadinessBundle(input:BuildDeploymentReadinessBundleInput):DeploymentReadinessBundle{
  validDate(input.evaluationDate);
  const blockers=input.binding.blockers.map(validateBlocker);
  if(input.manifest.classification==="LOCAL_ADAPTER_PROTOTYPE")
    add(blockers,"READINESS_DVN_CONFORMANCE_BLOCKED","CONFORMANCE","LOCAL_CLASSIFICATION_NONDEPLOYABLE");
  if(input.binding.gates.adapterConformance!=="LAYERZERO_DVN_CANDIDATE")
    add(blockers,"READINESS_DVN_CONFORMANCE_BLOCKED","CONFORMANCE","DESIGN_CONFORMANT_DVN_CONTRACT");
  if(!input.binding.gates.payableAssignJobResolved)
    add(blockers,"READINESS_DVN_CONFORMANCE_BLOCKED","CONFORMANCE","RESOLVE_PAYABLE_ASSIGN_JOB");
  if(!input.binding.gates.destinationVerificationTopologyResolved)
    add(blockers,"READINESS_DVN_CONFORMANCE_BLOCKED","CONFORMANCE","RESOLVE_DESTINATION_VERIFICATION_TOPOLOGY");
  if(!input.binding.gates.layerZeroOnboardingConfirmed)
    add(blockers,"READINESS_DVN_CONFORMANCE_BLOCKED","CONFORMANCE","CONFIRM_LAYERZERO_ONBOARDING");
  if(!input.binding.gates.independentDvnsSelected)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","SELECT_INDEPENDENT_DVNS");
  if(!input.binding.gates.livePathwayValidated)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","VALIDATE_LIVE_PATHWAY");
  if(!input.binding.gates.confirmationPolicyApproved)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","APPROVE_CONFIRMATION_POLICY");
  if(!input.binding.gates.liveGenLayerFinalityReader)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","DEPLOY_LIVE_GENLAYER_FINALITY_READER");
  if(!input.binding.gates.isolatedSignerOperators)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","DEPLOY_ISOLATED_SIGNER_OPERATORS");
  if(!input.binding.gates.independentRecoveryOperators)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","ESTABLISH_INDEPENDENT_RECOVERY_OPERATORS");
  if(!input.binding.gates.deploymentSecurityApproval)
    add(blockers,"READINESS_CONFIGURATION_BLOCKED","CONFIGURATION","OBTAIN_DEPLOYMENT_SECURITY_APPROVAL");
  blockers.sort((left,right)=>
    left.remediation.localeCompare(right.remediation)||
    left.code.localeCompare(right.code)||
    left.category.localeCompare(right.category)
  );
  return{
    schemaVersion:1,
    toolVersion:"sentinel-readiness/v1",
    evaluationDate:input.evaluationDate,
    status:status(blockers),
    classification:input.manifest.classification,
    truthLabel:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED",
    userApprovalRequired:true,
    source:{
      commit:input.binding.sourceCommit,
      repositoryInputSha256:input.binding.repositoryInputSha256
    },
    compiler:{
      version:input.binding.compiler.version,
      evmVersion:input.binding.compiler.evmVersion,
      optimizer:{...input.binding.compiler.optimizer}
    },
    artifacts:{
      SentinelDVNAdapter:{...input.binding.artifacts.SentinelDVNAdapter},
      TreasuryPolicyOApp:{...input.binding.artifacts.TreasuryPolicyOApp}
    },
    audit:{
      date:input.binding.audit.date,
      evidenceSha256:input.binding.audit.evidenceSha256,
      networkConfigSha256:input.binding.audit.networkConfigSha256,
      sources:[...input.binding.audit.sources]
    },
    network:{
      source:cloneNetwork(input.binding.network.source),
      destination:cloneNetwork(input.binding.network.destination),
      pathwayValidation:{...input.binding.network.pathwayValidation}
    },
    roles:{
      owner:input.manifest.owner,delegate:input.manifest.delegate,
      signers:[...input.manifest.signers],quorum:3,
      recoveryOperators:[...input.manifest.recoveryOperators]
    },
    confirmations:{...input.manifest.confirmations},
    policyBoundary:{
      deterministic:"PACKET_PATH_CONFIRMATIONS_REPLAY",
      semantic:"FINALIZED_GENLAYER_GOVERNANCE_POLICY",
      signing:"ONLY_AFTER_BOTH_FINALIZE",
      layerZeroRole:"ADDITIONAL_OR_OPTIONAL_WITH_INDEPENDENT_DVNS"
    },
    blockers,
    transactions:[]
  };
}

export function encodeDeploymentReadinessBundle(bundle:DeploymentReadinessBundle):string{
  return canonicalJson(bundle);
}

function cloneNetwork(value:ReadinessBinding["network"]["source"]):ReadinessBinding["network"]["source"]{
  return{
    name:value.name,chainId:value.chainId,eid:value.eid,
    endpointV2:value.endpointV2,sendUln302:value.sendUln302,receiveUln302:value.receiveUln302,
    executor:value.executor,deadDvn:{address:value.deadDvn.address,selectable:false},
    confirmations:{...value.confirmations},source:value.source
  };
}
function add(blockers:ReadinessBlocker[],code:ReadinessBlocker["code"],category:ReadinessBlockerCategory,remediation:string):void{
  if(!blockers.some(value=>value.code===code&&value.category===category&&value.remediation===remediation))
    blockers.push(validateBlocker({code,category,remediation}));
}
function validateBlocker(value:ReadinessBlocker):ReadinessBlocker{
  if(!remediationCodes.has(value.remediation))invalid();
  return{code:value.code,category:value.category,remediation:value.remediation};
}
function status(blockers:ReadinessBlocker[]):DeploymentReadinessStatus{
  if(blockers.some(value=>value.category==="ARTIFACT"))return"BLOCKED_ARTIFACT_BINDING";
  if(blockers.some(value=>value.category==="NETWORK"))return"BLOCKED_NETWORK_AUDIT";
  if(blockers.some(value=>value.category==="CONFORMANCE"))return"BLOCKED_DVN_CONFORMANCE";
  if(blockers.some(value=>value.category==="CONFIGURATION"))return"BLOCKED_CONFIGURATION";
  return"READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL";
}
function validDate(value:string):void{
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))invalid();
  const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year!,month!-1,day!));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month!-1||date.getUTCDate()!==day)invalid();
}
function invalid():never{throw new ReadinessError("READINESS_MANIFEST_INVALID")}
