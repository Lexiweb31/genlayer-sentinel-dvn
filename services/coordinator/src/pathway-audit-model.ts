export type PathwayAuditStatus=
  "BLOCKED_INPUT_BINDING"|"BLOCKED_RPC_INDEPENDENCE"|
  "BLOCKED_RPC_CONSENSUS"|"BLOCKED_CODE_IDENTITY"|
  "BLOCKED_PATHWAY_CONFIGURATION"|"OBSERVED_PATHWAY_CONSISTENT";

export type PathwayAuditBlockerCategory=
  "INPUT_BINDING"|"RPC_INDEPENDENCE"|"RPC_CONSENSUS"|
  "CODE_IDENTITY"|"PATHWAY_CONFIGURATION";

export type PathwayAuditBlockerCode=
  "AUDIT_NETWORK_METADATA_MISMATCH"|"AUDIT_NETWORK_AUDIT_STALE"|
  "AUDIT_PROVIDER_EVIDENCE_MISSING"|"AUDIT_PROVIDER_EVIDENCE_STALE"|
  "AUDIT_PROVIDER_OPERATOR_DUPLICATED"|"AUDIT_RPC_UNAVAILABLE"|
  "AUDIT_CHAIN_MISMATCH"|"AUDIT_BLOCK_DISAGREEMENT"|
  "AUDIT_BLOCK_UNSTABLE"|"AUDIT_PROVIDER_RESULT_DISAGREEMENT"|
  "AUDIT_CODE_MISSING"|"AUDIT_CODE_IDENTITY_UNPROVEN"|
  "AUDIT_DEPLOYMENT_EVIDENCE_MISSING"|"AUDIT_DEPLOYMENT_ARTIFACT_MISMATCH"|
  "AUDIT_PATHWAY_DEPLOYMENTS_MISSING"|"AUDIT_DEFAULT_LIBRARY"|
  "AUDIT_INHERITED_ULN_CONFIG"|"AUDIT_UNSUPPORTED_EID"|
  "AUDIT_PEER_MISMATCH"|"AUDIT_EXECUTOR_MISMATCH"|
  "AUDIT_DVN_ORDER_INVALID"|"AUDIT_DVN_THRESHOLD_INVALID"|
  "AUDIT_DVN_REVIEW_MISSING"|
  "AUDIT_DEAD_DVN_PRESENT"|"AUDIT_ULN_MISMATCH"|
  "AUDIT_SENTINEL_NOT_OPTIONAL"|"AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER"|
  "AUDIT_ADAPTER_BINDING_MISMATCH"|"AUDIT_SIGNER_MEMBERSHIP_MISMATCH";

export type PathwayAuditRemediation=
  "RECHECK_NETWORK_AUDIT"|"REVIEW_RPC_OPERATORS"|
  "REPLACE_RPC_TRANSPORT"|"RETRY_AT_STABLE_BLOCK"|
  "PIN_REVIEWED_CODE_IDENTITY"|"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"|
  "CONFIGURE_EXPLICIT_LIBRARIES"|"CONFIGURE_MATCHING_ULN"|
  "REMOVE_DEAD_DVN"|"SELECT_INDEPENDENT_DVNS"|
  "CONFIGURE_SENTINEL_OPTIONAL"|"CORRECT_PEERS"|
  "CORRECT_EXECUTOR"|"CORRECT_ADAPTER_BINDINGS"|
  "CORRECT_SIGNER_MEMBERSHIP";

export interface PathwayAuditBlocker{
  code:PathwayAuditBlockerCode;
  category:PathwayAuditBlockerCategory;
  remediation:PathwayAuditRemediation;
}

export type PathwayAuditErrorCode=
  "PATHWAY_AUDIT_MANIFEST_INVALID"|
  "PATHWAY_AUDIT_SECRET_FIELD_REJECTED"|
  "PATHWAY_AUDIT_TRANSPORT_FAILED"|
  "PATHWAY_AUDIT_OBSERVATION_FAILED";

export class PathwayAuditError extends Error{
  constructor(public readonly code:PathwayAuditErrorCode){super(code)}
}

export interface AuditRpcEndpoint{
  label:string;
  url:string;
  operatorFamily:string;
  originSha256:string;
}

export type AuditDeploymentManifest=null|{
  sourceOApp:{address:string;deploymentTxHash:string;delegate:string};
  destinationOApp:{address:string;deploymentTxHash:string;delegate:string};
  sourceAdapter:{address:string;deploymentTxHash:string};
  destinationAdapter:{address:string;deploymentTxHash:string};
  authorizedSigners:[string,string,string,string,string];
  quorum:3;
};

export interface PathwayAuditManifest{
  schemaVersion:1;
  networkAuditSha256:string;
  source:{
    name:"ethereum-sepolia";
    chainId:11155111;
    eid:40161;
    observationLag:number;
    contracts:{endpointV2:string;sendUln302:string;executor:string;deadDvn:string};
    rpcs:[AuditRpcEndpoint,AuditRpcEndpoint];
  };
  destination:{
    name:"arbitrum-sepolia";
    chainId:421614;
    eid:40231;
    observationLag:number;
    contracts:{endpointV2:string;receiveUln302:string;deadDvn:string};
    rpcs:[AuditRpcEndpoint,AuditRpcEndpoint];
  };
  deployment:AuditDeploymentManifest;
  confirmationPolicy:{source:15;destination:64;label:"UNAPPROVED_PROJECT_POLICY"};
  acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED";
}
