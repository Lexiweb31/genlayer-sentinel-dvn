import{createHash}from"node:crypto";
import{getAddress}from"ethers";
import{canonicalJson,parseJsonDocument}from"./canonical-json.js";
import{
  ReadinessError,
  type DeploymentReadinessManifest
}from"./deployment-readiness-manifest.js";

export type ReadinessBlockerCategory="ARTIFACT"|"NETWORK"|"CONFORMANCE"|"CONFIGURATION";
export type ReadinessBlockerCode=
  "READINESS_ARTIFACT_DRIFT"|"READINESS_SOURCE_DIRTY"|
  "READINESS_METADATA_MISMATCH"|"READINESS_METADATA_STALE"|
  "READINESS_DVN_CONFORMANCE_BLOCKED"|"READINESS_CONFIGURATION_BLOCKED";
export interface ReadinessBlocker{
  code:ReadinessBlockerCode;
  category:ReadinessBlockerCategory;
  remediation:string;
}
export type AdapterConformance="LOCAL_ADAPTER_PROTOTYPE"|"LAYERZERO_DVN_CANDIDATE";
export interface ReadinessGates{
  adapterConformance:AdapterConformance;
  payableAssignJobResolved:boolean;
  destinationVerificationTopologyResolved:boolean;
  layerZeroOnboardingConfirmed:boolean;
  independentDvnsSelected:boolean;
  livePathwayValidated:boolean;
  confirmationPolicyApproved:boolean;
  liveGenLayerFinalityReader:boolean;
  isolatedSignerOperators:boolean;
  independentRecoveryOperators:boolean;
  deploymentSecurityApproval:boolean;
}
export interface DeploymentReadinessConfig{
  schemaVersion:1;
  toolVersion:"sentinel-readiness/v1";
  maximumAuditAgeDays:number;
  networkConfig:"config/networks.json";
  auditEvidence:"docs/research/2026-07-29-deployment-readiness-audit.md";
  buildManifest:"dist/contracts/build-manifest.json";
  productionArtifacts:{
    SentinelDVNAdapter:"dist/contracts/SentinelDVNAdapter.json";
    TreasuryPolicyOApp:"dist/contracts/TreasuryPolicyOApp.json";
  };
  productionSources:{
    SentinelDVNAdapter:"contracts/src/SentinelDVNAdapter.sol";
    TreasuryPolicyOApp:"contracts/src/TreasuryPolicyOApp.sol";
  };
  pathway:{source:"ethereum-sepolia";destination:"arbitrum-sepolia"};
  gates:ReadinessGates;
}
export interface BindingInput{
  manifest:DeploymentReadinessManifest;
  evaluationDate:string;
  git:{commit:string;dirty:boolean};
  networkConfigText:string;
  auditEvidenceText:string;
  readinessConfigText:string;
  buildManifestText:string;
  compiledBuildManifestText:string;
  productionArtifacts:{SentinelDVNAdapter:string;TreasuryPolicyOApp:string};
  productionSources:{SentinelDVNAdapter:string;TreasuryPolicyOApp:string};
}
interface BoundContract{
  source:string;
  sourceSha256:string;
  abiSha256:string;
  creationBytecodeSha256:string;
}
interface BoundNetwork{
  name:string;
  chainId:number;
  eid:number;
  endpointV2:string;
  sendUln302:string;
  receiveUln302:string;
  executor:string;
  deadDvn:{address:string;selectable:false};
  confirmations:{prototypeTestValue:number;unapprovedSecurityReviewCandidate:number};
  source:string;
}
export interface ReadinessBinding{
  toolVersion:"sentinel-readiness/v1";
  sourceCommit:string;
  repositoryInputSha256:string;
  compiler:{version:string;evmVersion:string;optimizer:{enabled:boolean;runs:number}};
  artifacts:{SentinelDVNAdapter:BoundContract;TreasuryPolicyOApp:BoundContract};
  audit:{date:string;evidenceSha256:string;networkConfigSha256:string;sources:[string,string]};
  network:{
    source:BoundNetwork;
    destination:BoundNetwork;
    pathwayValidation:{
      ethereumSepoliaToArbitrumSepolia:string;
      arbitrumSepoliaToEthereumSepolia:string;
      dvnSelection:string;
      oappConfiguration:string;
    };
  };
  gates:ReadinessGates;
  blockers:ReadinessBlocker[];
}

interface ParsedNetworkConfig{
  auditDate:string;
  status:string;
  auditEvidence:string;
  pathway:{"ethereum-sepolia":ParsedNetwork;"arbitrum-sepolia":ParsedNetwork};
  pathwayValidation:{
    ethereumSepoliaToArbitrumSepolia:string;
    arbitrumSepoliaToEthereumSepolia:string;
    dvnSelection:string;
    oappConfiguration:string;
  };
  warning:string;
}
interface ParsedNetwork{
  chainId:number;eid:number;endpointV2:string;sendUln302:string;receiveUln302:string;
  executor:string;deadDvn:string;
  confirmations:{prototypeTestValue:number;unapprovedSecurityReviewCandidate:number};
  source:string;
}
interface ParsedBuildManifest{
  schemaVersion:number;
  compiler:{version:string;evmVersion:string;optimizer:{enabled:boolean;runs:number}};
  contracts:Array<{name:string;source:string;sourceSha256:string;abiSha256:string;creationBytecodeSha256:string}>;
}
interface ParsedContractArtifact{abiSha256:string;creationBytecodeSha256:string}

const readinessKeys=[
  "schemaVersion","toolVersion","maximumAuditAgeDays","networkConfig","auditEvidence",
  "buildManifest","productionArtifacts","productionSources","pathway","gates"
];
const gateKeys=[
  "adapterConformance","payableAssignJobResolved","destinationVerificationTopologyResolved",
  "layerZeroOnboardingConfirmed","independentDvnsSelected","livePathwayValidated",
  "confirmationPolicyApproved","liveGenLayerFinalityReader","isolatedSignerOperators",
  "independentRecoveryOperators","deploymentSecurityApproval"
];
const expectedNetworks={
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
}as const;

export function parseDeploymentReadinessConfig(text:string):DeploymentReadinessConfig{
  const root=record(parseJson(text));exactKeys(root,readinessKeys);
  const artifacts=record(root.productionArtifacts),sources=record(root.productionSources);
  const pathway=record(root.pathway),gates=record(root.gates);
  exactKeys(artifacts,["SentinelDVNAdapter","TreasuryPolicyOApp"]);
  exactKeys(sources,["SentinelDVNAdapter","TreasuryPolicyOApp"]);
  exactKeys(pathway,["source","destination"]);exactKeys(gates,gateKeys);
  const maximumAuditAgeDays=uint(root.maximumAuditAgeDays);
  if(root.schemaVersion!==1||root.toolVersion!=="sentinel-readiness/v1"||
    maximumAuditAgeDays<1||maximumAuditAgeDays>30||
    root.networkConfig!=="config/networks.json"||
    root.auditEvidence!=="docs/research/2026-07-29-deployment-readiness-audit.md"||
    root.buildManifest!=="dist/contracts/build-manifest.json"||
    artifacts.SentinelDVNAdapter!=="dist/contracts/SentinelDVNAdapter.json"||
    artifacts.TreasuryPolicyOApp!=="dist/contracts/TreasuryPolicyOApp.json"||
    sources.SentinelDVNAdapter!=="contracts/src/SentinelDVNAdapter.sol"||
    sources.TreasuryPolicyOApp!=="contracts/src/TreasuryPolicyOApp.sol"||
    pathway.source!=="ethereum-sepolia"||pathway.destination!=="arbitrum-sepolia"||
    (gates.adapterConformance!=="LOCAL_ADAPTER_PROTOTYPE"&&gates.adapterConformance!=="LAYERZERO_DVN_CANDIDATE"))invalid();
  const parsedGates:ReadinessGates={
    adapterConformance:gates.adapterConformance,
    payableAssignJobResolved:bool(gates.payableAssignJobResolved),
    destinationVerificationTopologyResolved:bool(gates.destinationVerificationTopologyResolved),
    layerZeroOnboardingConfirmed:bool(gates.layerZeroOnboardingConfirmed),
    independentDvnsSelected:bool(gates.independentDvnsSelected),
    livePathwayValidated:bool(gates.livePathwayValidated),
    confirmationPolicyApproved:bool(gates.confirmationPolicyApproved),
    liveGenLayerFinalityReader:bool(gates.liveGenLayerFinalityReader),
    isolatedSignerOperators:bool(gates.isolatedSignerOperators),
    independentRecoveryOperators:bool(gates.independentRecoveryOperators),
    deploymentSecurityApproval:bool(gates.deploymentSecurityApproval)
  };
  return{
    schemaVersion:1,toolVersion:"sentinel-readiness/v1",maximumAuditAgeDays,
    networkConfig:"config/networks.json",
    auditEvidence:"docs/research/2026-07-29-deployment-readiness-audit.md",
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
    gates:parsedGates
  };
}

export function inspectDeploymentReadinessBindings(input:BindingInput):ReadinessBinding{
  const config=parseDeploymentReadinessConfig(input.readinessConfigText);
  const network=parseNetworkConfig(input.networkConfigText),build=parseBuildManifest(input.buildManifestText);
  const compiledBuild=parseBuildManifest(input.compiledBuildManifestText);
  const adapterArtifact=parseContractArtifact(input.productionArtifacts.SentinelDVNAdapter);
  const oappArtifact=parseContractArtifact(input.productionArtifacts.TreasuryPolicyOApp);
  const blockers:ReadinessBlocker[]=[];
  let artifactDrift=false,metadataMismatch=false;
  if(!/^[a-f0-9]{40}$/.test(input.git.commit)||input.git.commit!==input.manifest.sourceCommit)artifactDrift=true;
  if(input.git.dirty)addBlocker(blockers,"READINESS_SOURCE_DIRTY","ARTIFACT","COMMIT_OR_REMOVE_SOURCE_CHANGES");
  if(canonicalJson(build)!==canonicalJson(compiledBuild)||
    build.compiler.version!=="0.8.30+commit.73712a01.Emscripten.clang"||
    build.compiler.evmVersion!=="shanghai"||build.compiler.optimizer.enabled!==true||
    build.compiler.optimizer.runs!==200)artifactDrift=true;
  const adapter=contract(build,0,"SentinelDVNAdapter","contracts/src/SentinelDVNAdapter.sol");
  const oapp=contract(build,1,"TreasuryPolicyOApp","contracts/src/TreasuryPolicyOApp.sol");
  if(build.schemaVersion!==1||build.contracts.length!==2||
    build.contracts[0]?.name!=="SentinelDVNAdapter"||
    build.contracts[0]?.source!=="contracts/src/SentinelDVNAdapter.sol"||
    build.contracts[1]?.name!=="TreasuryPolicyOApp"||
    build.contracts[1]?.source!=="contracts/src/TreasuryPolicyOApp.sol"||
    sha256(input.productionSources.SentinelDVNAdapter)!==adapter.sourceSha256||
    sha256(input.productionSources.TreasuryPolicyOApp)!==oapp.sourceSha256||
    adapterArtifact.abiSha256!==adapter.abiSha256||
    adapterArtifact.creationBytecodeSha256!==adapter.creationBytecodeSha256||
    oappArtifact.abiSha256!==oapp.abiSha256||
    oappArtifact.creationBytecodeSha256!==oapp.creationBytecodeSha256||
    input.manifest.artifacts.SentinelDVNAdapter.abiSha256!==adapter.abiSha256||
    input.manifest.artifacts.SentinelDVNAdapter.creationBytecodeSha256!==adapter.creationBytecodeSha256||
    input.manifest.artifacts.TreasuryPolicyOApp.abiSha256!==oapp.abiSha256||
    input.manifest.artifacts.TreasuryPolicyOApp.creationBytecodeSha256!==oapp.creationBytecodeSha256)artifactDrift=true;
  if(artifactDrift)addBlocker(blockers,"READINESS_ARTIFACT_DRIFT","ARTIFACT","REBUILD_FROM_COMMITTED_SOURCE");
  const actualNetworkDigest=sha256(input.networkConfigText),actualEvidenceDigest=sha256(input.auditEvidenceText);
  const source=network.pathway["ethereum-sepolia"],destination=network.pathway["arbitrum-sepolia"];
  if(input.manifest.audit.networkConfigSha256!==actualNetworkDigest||
    input.manifest.audit.evidenceSha256!==actualEvidenceDigest||
    input.manifest.audit.date!==network.auditDate||
    network.auditEvidence!==config.auditEvidence||
    network.status!=="AUDITED_CONTRACT_METADATA_NOT_PATHWAY_VALIDATED"||
    !matchesNetwork(source,expectedNetworks["ethereum-sepolia"])||
    !matchesNetwork(destination,expectedNetworks["arbitrum-sepolia"])||
    network.pathwayValidation.ethereumSepoliaToArbitrumSepolia!=="NOT_CHAIN_VALIDATED"||
    network.pathwayValidation.arbitrumSepoliaToEthereumSepolia!=="OUT_OF_M2_SCOPE"||
    network.pathwayValidation.dvnSelection!=="UNSELECTED"||
    network.pathwayValidation.oappConfiguration!=="NOT_DEPLOYED"||
    input.manifest.confirmations.source!==source.confirmations.unapprovedSecurityReviewCandidate||
    input.manifest.confirmations.destination!==destination.confirmations.unapprovedSecurityReviewCandidate)metadataMismatch=true;
  const age=auditAge(network.auditDate,input.evaluationDate);
  if(age<0)metadataMismatch=true;
  if(metadataMismatch)addBlocker(blockers,"READINESS_METADATA_MISMATCH","NETWORK","RECHECK_OFFICIAL_NETWORK_METADATA");
  if(age>config.maximumAuditAgeDays)addBlocker(blockers,"READINESS_METADATA_STALE","NETWORK","REFRESH_PRIMARY_SOURCE_AUDIT");
  blockers.sort((left,right)=>left.code.localeCompare(right.code)||left.category.localeCompare(right.category));
  const sourceDigests={
    SentinelDVNAdapter:sha256(input.productionSources.SentinelDVNAdapter),
    TreasuryPolicyOApp:sha256(input.productionSources.TreasuryPolicyOApp)
  };
  const artifactFileDigests={
    SentinelDVNAdapter:sha256(input.productionArtifacts.SentinelDVNAdapter),
    TreasuryPolicyOApp:sha256(input.productionArtifacts.TreasuryPolicyOApp)
  };
  const repositoryInputSha256=sha256(canonicalJson({
    sourceCommit:input.git.commit,
    readinessConfigSha256:sha256(input.readinessConfigText),
    networkConfigSha256:actualNetworkDigest,
    auditEvidenceSha256:actualEvidenceDigest,
    buildManifestSha256:sha256(input.buildManifestText),
    compiledBuildManifestSha256:sha256(input.compiledBuildManifestText),
    productionArtifactFileSha256:artifactFileDigests,
    productionSourceSha256:sourceDigests
  }));
  return{
    toolVersion:"sentinel-readiness/v1",
    sourceCommit:input.git.commit,
    repositoryInputSha256,
    compiler:{
      version:build.compiler.version,evmVersion:build.compiler.evmVersion,
      optimizer:{...build.compiler.optimizer}
    },
    artifacts:{
      SentinelDVNAdapter:{...adapter},
      TreasuryPolicyOApp:{...oapp}
    },
    audit:{
      date:network.auditDate,evidenceSha256:actualEvidenceDigest,networkConfigSha256:actualNetworkDigest,
      sources:[source.source,destination.source]
    },
    network:{
      source:boundNetwork("ethereum-sepolia",source),
      destination:boundNetwork("arbitrum-sepolia",destination),
      pathwayValidation:{...network.pathwayValidation}
    },
    gates:{...config.gates},
    blockers
  };
}

function parseNetworkConfig(text:string):ParsedNetworkConfig{
  const root=record(parseJson(text));exactKeys(root,["auditDate","status","auditEvidence","pathway","pathwayValidation","warning"]);
  const pathway=record(root.pathway),validation=record(root.pathwayValidation);
  exactKeys(pathway,["ethereum-sepolia","arbitrum-sepolia"]);
  exactKeys(validation,["ethereumSepoliaToArbitrumSepolia","arbitrumSepoliaToEthereumSepolia","dvnSelection","oappConfiguration"]);
  return{
    auditDate:validDate(root.auditDate),status:textValue(root.status),auditEvidence:textValue(root.auditEvidence),
    pathway:{
      "ethereum-sepolia":parseNetwork(pathway["ethereum-sepolia"]),
      "arbitrum-sepolia":parseNetwork(pathway["arbitrum-sepolia"])
    },
    pathwayValidation:{
      ethereumSepoliaToArbitrumSepolia:textValue(validation.ethereumSepoliaToArbitrumSepolia),
      arbitrumSepoliaToEthereumSepolia:textValue(validation.arbitrumSepoliaToEthereumSepolia),
      dvnSelection:textValue(validation.dvnSelection),
      oappConfiguration:textValue(validation.oappConfiguration)
    },
    warning:textValue(root.warning)
  };
}
function parseNetwork(value:unknown):ParsedNetwork{
  const root=record(value);exactKeys(root,["chainId","eid","endpointV2","sendUln302","receiveUln302","executor","deadDvn","confirmations","source"]);
  const confirmations=record(root.confirmations);exactKeys(confirmations,["prototypeTestValue","unapprovedSecurityReviewCandidate"]);
  return{
    chainId:uint(root.chainId),eid:uint(root.eid),
    endpointV2:evmAddress(root.endpointV2),sendUln302:evmAddress(root.sendUln302),
    receiveUln302:evmAddress(root.receiveUln302),executor:evmAddress(root.executor),deadDvn:evmAddress(root.deadDvn),
    confirmations:{
      prototypeTestValue:uint(confirmations.prototypeTestValue),
      unapprovedSecurityReviewCandidate:uint(confirmations.unapprovedSecurityReviewCandidate)
    },
    source:httpsUrl(root.source)
  };
}
function parseBuildManifest(text:string):ParsedBuildManifest{
  const root=record(parseJson(text));exactKeys(root,["schemaVersion","compiler","contracts"]);
  const compiler=record(root.compiler),optimizer=record(compiler.optimizer);
  exactKeys(compiler,["version","evmVersion","optimizer"]);exactKeys(optimizer,["enabled","runs"]);
  if(!Array.isArray(root.contracts))invalid();
  const contracts=root.contracts.map(value=>{
    const item=record(value);exactKeys(item,["name","source","sourceSha256","abiSha256","creationBytecodeSha256"]);
    return{
      name:textValue(item.name),source:textValue(item.source),sourceSha256:digest(item.sourceSha256),
      abiSha256:digest(item.abiSha256),creationBytecodeSha256:digest(item.creationBytecodeSha256)
    };
  });
  return{
    schemaVersion:uint(root.schemaVersion),
    compiler:{
      version:textValue(compiler.version),evmVersion:textValue(compiler.evmVersion),
      optimizer:{enabled:bool(optimizer.enabled),runs:uint(optimizer.runs)}
    },
    contracts
  };
}
function parseContractArtifact(text:string):ParsedContractArtifact{
  const root=record(parseJson(text));exactKeys(root,["abi","evm"]);
  if(!Array.isArray(root.abi))invalid();
  const evm=record(root.evm);exactKeys(evm,["bytecode"]);
  const bytecode=record(evm.bytecode);exactKeys(bytecode,["object"]);
  if(typeof bytecode.object!=="string"||!/^(?:[0-9a-f]{2})+$/.test(bytecode.object))invalid();
  const abiText=JSON.stringify(root.abi);
  if(typeof abiText!=="string")invalid();
  return{
    abiSha256:sha256(abiText),
    creationBytecodeSha256:sha256(Buffer.from(bytecode.object,"hex"))
  };
}
function contract(build:ParsedBuildManifest,index:number,name:string,source:string):BoundContract{
  const value=build.contracts[index];
  if(!value)return{source,sourceSha256:"0".repeat(64),abiSha256:"0".repeat(64),creationBytecodeSha256:"0".repeat(64)};
  return{
    source:value.source,sourceSha256:value.sourceSha256,
    abiSha256:value.abiSha256,creationBytecodeSha256:value.creationBytecodeSha256
  };
}
function matchesNetwork(actual:ParsedNetwork,expected:typeof expectedNetworks[keyof typeof expectedNetworks]):boolean{
  return actual.chainId===expected.chainId&&actual.eid===expected.eid&&
    actual.endpointV2===expected.endpointV2&&actual.sendUln302===expected.sendUln302&&
    actual.receiveUln302===expected.receiveUln302&&actual.executor===expected.executor&&actual.deadDvn===expected.deadDvn&&
    actual.confirmations.prototypeTestValue===expected.confirmations.prototypeTestValue&&
    actual.confirmations.unapprovedSecurityReviewCandidate===expected.confirmations.unapprovedSecurityReviewCandidate&&
    actual.source===expected.source;
}
function boundNetwork(name:string,value:ParsedNetwork):BoundNetwork{
  return{
    name,chainId:value.chainId,eid:value.eid,endpointV2:value.endpointV2,sendUln302:value.sendUln302,
    receiveUln302:value.receiveUln302,executor:value.executor,
    deadDvn:{address:value.deadDvn,selectable:false},
    confirmations:{...value.confirmations},source:value.source
  };
}
function auditAge(auditDate:string,evaluationDate:string):number{
  const start=dateValue(auditDate),end=dateValue(evaluationDate);
  return Math.floor((end-start)/86_400_000);
}
function dateValue(value:string):number{
  const valid=validDate(value),[year,month,day]=valid.split("-").map(Number);
  return Date.UTC(year!,month!-1,day!);
}
function validDate(value:unknown):string{
  if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))invalid();
  const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year!,month!-1,day!));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month!-1||date.getUTCDate()!==day)invalid();
  return value;
}
function addBlocker(blockers:ReadinessBlocker[],code:ReadinessBlockerCode,category:ReadinessBlockerCategory,remediation:string):void{
  if(!blockers.some(item=>item.code===code&&item.category===category))blockers.push({code,category,remediation});
}
function parseJson(text:string):unknown{try{return parseJsonDocument(text)}catch{invalid()}}
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))invalid();
  return value as Record<string,unknown>;
}
function exactKeys(value:Record<string,unknown>,expected:string[]):void{
  const actual=Object.keys(value).sort(),wanted=[...expected].sort();
  if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))invalid();
}
function textValue(value:unknown):string{if(typeof value!=="string"||!value.length||value.includes("\0"))invalid();return value}
function uint(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<0)invalid();return Number(value)}
function bool(value:unknown):boolean{if(typeof value!=="boolean")invalid();return value}
function digest(value:unknown):string{if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))invalid();return value}
function evmAddress(value:unknown):string{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))invalid();
  try{if(getAddress(value)!==value)invalid()}catch{invalid()}
  return value;
}
function httpsUrl(value:unknown):string{
  const text=textValue(value);let parsed:URL;try{parsed=new URL(text)}catch{invalid()}
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.hash)invalid();
  return text;
}
function sha256(value:string|Uint8Array):string{return createHash("sha256").update(value).digest("hex")}
function invalid():never{throw new ReadinessError("READINESS_MANIFEST_INVALID")}
