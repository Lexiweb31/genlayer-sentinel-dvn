import{isAbsolute,join,normalize}from"node:path";
import{
  buildPathwayAuditBundle,encodePathwayAuditBundle,
  type BuildPathwayAuditBundleInput,type PathwayAuditBundle
}from"./pathway-audit-bundle.js";
import{parsePathwayAuditManifestText}from"./pathway-audit-manifest.js";
import{type PathwayAuditManifest,type PathwayAuditStatus}from"./pathway-audit-model.js";
import{observePathway,type PathwayAuditObservation,type PathwayAuditObserverInput}from"./pathway-audit-observer.js";
import{bindPathwayAuditPolicy,type PathwayAuditPolicyBinding,type PathwayAuditPolicyInput}from"./pathway-audit-policy.js";
import{createReadOnlyRpcClient,type ReadOnlyRpcClient}from"./read-only-json-rpc.js";
import{readReadinessTextFile,writeReadinessFileExclusive}from"./deployment-readiness-command.js";

export type PathwayAuditCommandErrorCode=
  "PATHWAY_AUDIT_MANIFEST_INVALID"|"PATHWAY_AUDIT_SECRET_FIELD_REJECTED"|
  "PATHWAY_AUDIT_INPUT_READ_FAILED"|"PATHWAY_AUDIT_POLICY_BINDING_FAILED"|
  "PATHWAY_AUDIT_TRANSPORT_FAILED"|"PATHWAY_AUDIT_OBSERVATION_FAILED"|
  "PATHWAY_AUDIT_BUILD_FAILED"|"PATHWAY_AUDIT_OUTPUT_FAILED"|"PATHWAY_AUDIT_OUTPUT_EXISTS";

export class PathwayAuditCommandError extends Error{
  constructor(public readonly code:PathwayAuditCommandErrorCode){super(code)}
}

export interface PathwayAuditCommandIo{
  stdout(value:string):void;
  stderr(value:string):void;
}

export interface PathwayAuditCommandDependencies{
  repositoryRoot:string;
  readText(path:string):Promise<string>;
  now():string;
  writeExclusive(path:string,contents:string):Promise<void>;
  bind(input:PathwayAuditPolicyInput):PathwayAuditPolicyBinding|Promise<PathwayAuditPolicyBinding>;
  createClient(endpoint:PathwayAuditManifest["source"]["rpcs"][number]):ReadOnlyRpcClient;
  observe(input:PathwayAuditObserverInput):Promise<PathwayAuditObservation>;
  build(input:BuildPathwayAuditBundleInput):PathwayAuditBundle|Promise<PathwayAuditBundle>;
  encode(bundle:PathwayAuditBundle):string;
}

const repositoryInputs=[
  "config/pathway-auditor.json","config/networks.json",
  "docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
  "config/rpc-provider-audit.json","config/dvn-operator-audit.json",
  "dist/contracts/build-manifest.json","dist/contracts/SentinelDVNAdapter.json",
  "dist/contracts/TreasuryPolicyOApp.json"
]as const;
const statuses=new Set<PathwayAuditStatus>([
  "BLOCKED_INPUT_BINDING","BLOCKED_RPC_INDEPENDENCE","BLOCKED_RPC_CONSENSUS",
  "BLOCKED_CODE_IDENTITY","BLOCKED_PATHWAY_CONFIGURATION","OBSERVED_PATHWAY_CONSISTENT"
]);

export async function runPathwayAuditCommand(
  args:string[],io:PathwayAuditCommandIo,suppliedDependencies?:PathwayAuditCommandDependencies
):Promise<0|1|2>{
  let paths:{manifest:string;output?:string};
  try{paths=parseArguments(args)}catch{return fail(io,"PATHWAY_AUDIT_MANIFEST_INVALID")}
  const dependencies=suppliedDependencies??defaultDependencies();
  let manifestText:string;
  try{manifestText=await dependencies.readText(paths.manifest)}
  catch{return fail(io,"PATHWAY_AUDIT_INPUT_READ_FAILED")}
  let manifest:PathwayAuditManifest;
  try{manifest=parsePathwayAuditManifestText(manifestText)}
  catch(error){return fail(io,manifestError(error))}

  let root:string,inputs:string[];
  try{
    root=exactRoot(dependencies.repositoryRoot);
    inputs=[];
    for(const relative of repositoryInputs)inputs.push(await dependencies.readText(join(root,relative)));
  }catch{return fail(io,"PATHWAY_AUDIT_INPUT_READ_FAILED")}

  let runTimestamp:string;
  try{runTimestamp=utcTimestamp(dependencies.now())}
  catch{return fail(io,"PATHWAY_AUDIT_POLICY_BINDING_FAILED")}
  let policyBinding:PathwayAuditPolicyBinding;
  try{
    policyBinding=await dependencies.bind({
      manifest,policyText:inputs[0]!,networksText:inputs[1]!,networkAuditEvidenceText:inputs[2]!,
      providerAuditText:inputs[3]!,dvnOperatorAuditText:inputs[4]!,evaluationDate:runTimestamp.slice(0,10)
    });
  }catch{return fail(io,"PATHWAY_AUDIT_POLICY_BINDING_FAILED")}

  let clients:PathwayAuditObserverInput["clients"];
  try{
    clients={
      source:[dependencies.createClient(manifest.source.rpcs[0]),dependencies.createClient(manifest.source.rpcs[1])],
      destination:[dependencies.createClient(manifest.destination.rpcs[0]),dependencies.createClient(manifest.destination.rpcs[1])]
    };
  }catch(error){return fail(io,observationError(error))}
  let observation:PathwayAuditObservation;
  try{
    observation=await dependencies.observe({
      manifest,policyBinding,clients,buildManifestText:inputs[5]!,adapterArtifactText:inputs[6]!,oappArtifactText:inputs[7]!
    });
  }catch(error){return fail(io,observationError(error))}

  let bundle:PathwayAuditBundle,encoded:string;
  try{
    bundle=await dependencies.build({observation,runTimestamp});
    if(!statuses.has(bundle.status))throw new Error("invalid pathway audit status");
    encoded=dependencies.encode(bundle);
    if(typeof encoded!=="string"||encoded.length===0||Buffer.byteLength(encoded,"utf8")>2_097_152||!encoded.endsWith("\n"))throw new Error("invalid pathway audit encoding");
  }catch{return fail(io,"PATHWAY_AUDIT_BUILD_FAILED")}
  if(paths.output){
    try{await dependencies.writeExclusive(paths.output,encoded)}
    catch(error){return fail(io,outputError(error))}
  }else{
    try{io.stdout(encoded)}catch{return fail(io,"PATHWAY_AUDIT_OUTPUT_FAILED")}
  }
  return bundle.status==="OBSERVED_PATHWAY_CONSISTENT"?0:2;
}

export async function readPathwayAuditTextFile(path:string):Promise<string>{
  try{return await readReadinessTextFile(path)}
  catch{throw new PathwayAuditCommandError("PATHWAY_AUDIT_INPUT_READ_FAILED")}
}

export async function writePathwayAuditFileExclusive(path:string,contents:string):Promise<void>{
  try{await writeReadinessFileExclusive(path,contents)}
  catch(error){throw new PathwayAuditCommandError(outputError(error))}
}

function defaultDependencies():PathwayAuditCommandDependencies{return{
  repositoryRoot:process.cwd(),readText:readPathwayAuditTextFile,now:()=>new Date().toISOString(),
  writeExclusive:writePathwayAuditFileExclusive,bind:bindPathwayAuditPolicy,
  createClient:endpoint=>createReadOnlyRpcClient(endpoint),observe:observePathway,
  build:buildPathwayAuditBundle,encode:encodePathwayAuditBundle
}}

function parseArguments(args:string[]):{manifest:string;output?:string}{
  if(args.length!==2&&args.length!==4)invalid();
  if(args[0]!=="--manifest"||!validAbsolutePath(args[1]))invalid();
  if(args.length===4&&(args[2]!=="--output"||!validAbsolutePath(args[3])))invalid();
  return args.length===2?{manifest:args[1]!}:{manifest:args[1]!,output:args[3]!};
}
function validAbsolutePath(value:unknown):value is string{return typeof value==="string"&&value.length>1&&!/[\0-\x1f\x7f]/.test(value)&&isAbsolute(value)&&normalize(value)===value}
function exactRoot(value:unknown):string{if(!validAbsolutePath(value))throw new PathwayAuditCommandError("PATHWAY_AUDIT_INPUT_READ_FAILED");return value}
function utcTimestamp(value:unknown):string{
  if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))throw new Error("invalid timestamp");
  const parsed=new Date(value);if(Number.isNaN(parsed.getTime())||parsed.toISOString()!==value)throw new Error("invalid timestamp");return value;
}
function manifestError(error:unknown):PathwayAuditCommandErrorCode{return ownCode(error)==="PATHWAY_AUDIT_SECRET_FIELD_REJECTED"?"PATHWAY_AUDIT_SECRET_FIELD_REJECTED":"PATHWAY_AUDIT_MANIFEST_INVALID"}
function observationError(error:unknown):PathwayAuditCommandErrorCode{return ownCode(error)==="PATHWAY_AUDIT_TRANSPORT_FAILED"?"PATHWAY_AUDIT_TRANSPORT_FAILED":"PATHWAY_AUDIT_OBSERVATION_FAILED"}
function outputError(error:unknown):PathwayAuditCommandErrorCode{return ownCode(error)==="PATHWAY_AUDIT_OUTPUT_EXISTS"||ownCode(error)==="READINESS_OUTPUT_EXISTS"?"PATHWAY_AUDIT_OUTPUT_EXISTS":"PATHWAY_AUDIT_OUTPUT_FAILED"}
function ownCode(error:unknown):unknown{
  if(!error||typeof error!=="object")return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(error,"code");return descriptor&&"value"in descriptor?descriptor.value:undefined;
}
function fail(io:PathwayAuditCommandIo,code:PathwayAuditCommandErrorCode):1{try{io.stderr(`${JSON.stringify({error:code})}\n`)}catch{}return 1}
function invalid():never{throw new PathwayAuditCommandError("PATHWAY_AUDIT_MANIFEST_INVALID")}
