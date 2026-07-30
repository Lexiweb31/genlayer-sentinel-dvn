import{randomBytes}from"node:crypto";
import{execFile}from"node:child_process";
import{
  link as fsLink,
  open as fsOpen,
  readFile,
  unlink as fsUnlink,
  type FileHandle
}from"node:fs/promises";
import{basename,dirname,isAbsolute,join,normalize}from"node:path";
import{canonicalJson}from"./canonical-json.js";
import{
  inspectDeploymentReadinessBindings,
  parseDeploymentReadinessConfig,
  type BindingInput,
  type ReadinessBinding
}from"./deployment-readiness-binding.js";
import{
  buildDeploymentReadinessBundle,
  encodeDeploymentReadinessBundle,
  type DeploymentReadinessBundle
}from"./deployment-readiness-bundle.js";
import{
  parseDeploymentReadinessManifestText,
  ReadinessError,
  type DeploymentReadinessManifest
}from"./deployment-readiness-manifest.js";

export interface ReadinessCommandIo{
  stdout(value:string):void;
  stderr(value:string):void;
}
export interface ReadinessCommandDependencies{
  readText(path:string):Promise<string>;
  repositoryRoot:string;
  gitState():Promise<{commit:string;dirty:boolean}>;
  evaluationDate():string;
  writeExclusive(path:string,contents:string):Promise<void>;
  inspect(input:BindingInput):ReadinessBinding|Promise<ReadinessBinding>;
  build(input:{
    manifest:DeploymentReadinessManifest;
    binding:ReadinessBinding;
    evaluationDate:string;
  }):DeploymentReadinessBundle|Promise<DeploymentReadinessBundle>;
}
export interface ReadinessFilePort{
  open(path:string,flags:"wx",mode:number):Promise<Pick<FileHandle,"writeFile"|"sync"|"close">>;
  link(existingPath:string,newPath:string):Promise<void>;
  unlink(path:string):Promise<void>;
}
export type ReadinessCommandErrorCode=
  "READINESS_MANIFEST_INVALID"|"READINESS_SECRET_FIELD_REJECTED"|
  "READINESS_INPUT_READ_FAILED"|"READINESS_GIT_FAILED"|
  "READINESS_BINDING_FAILED"|"READINESS_BUILD_FAILED"|
  "READINESS_OUTPUT_FAILED"|"READINESS_OUTPUT_EXISTS";
export class ReadinessCommandError extends Error{
  constructor(public readonly code:ReadinessCommandErrorCode){super(code)}
}

const defaultFilePort:ReadinessFilePort={
  open:(path,flags,mode)=>fsOpen(path,flags,mode),
  link:fsLink,
  unlink:fsUnlink
};
const bundleStatuses=new Set([
  "READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL","BLOCKED_DVN_CONFORMANCE",
  "BLOCKED_NETWORK_AUDIT","BLOCKED_ARTIFACT_BINDING","BLOCKED_CONFIGURATION"
]);

export async function runDeploymentReadinessCommand(
  args:string[],
  io:ReadinessCommandIo,
  suppliedDependencies?:ReadinessCommandDependencies
):Promise<number>{
  let paths:{manifest:string;output?:string};
  try{paths=parseArguments(args)}catch{return fail(io,"READINESS_MANIFEST_INVALID")}
  const dependencies=suppliedDependencies??defaultDependencies();
  let manifestText:string;
  try{manifestText=await dependencies.readText(paths.manifest)}
  catch{return fail(io,"READINESS_INPUT_READ_FAILED")}
  let manifest:DeploymentReadinessManifest;
  try{manifest=parseDeploymentReadinessManifestText(manifestText)}
  catch(error){return fail(io,manifestError(error))}
  let evaluationDate:string;
  try{evaluationDate=normalizeDate(dependencies.evaluationDate())}
  catch{return fail(io,"READINESS_BINDING_FAILED")}
  let readinessConfigText:string,config:ReturnType<typeof parseDeploymentReadinessConfig>;
  try{
    exactRoot(dependencies.repositoryRoot);
    readinessConfigText=await dependencies.readText(join(dependencies.repositoryRoot,"config/deployment-readiness.json"));
    config=parseDeploymentReadinessConfig(readinessConfigText);
  }catch{return fail(io,"READINESS_INPUT_READ_FAILED")}
  let git:BindingInput["git"];
  try{git=await dependencies.gitState()}
  catch{return fail(io,"READINESS_GIT_FAILED")}
  let input:BindingInput;
  try{
    const [networkConfigText,auditEvidenceText,buildManifestText,adapterSource,oappSource]=await Promise.all([
      dependencies.readText(join(dependencies.repositoryRoot,config.networkConfig)),
      dependencies.readText(join(dependencies.repositoryRoot,config.auditEvidence)),
      dependencies.readText(join(dependencies.repositoryRoot,config.buildManifest)),
      dependencies.readText(join(dependencies.repositoryRoot,config.productionSources.SentinelDVNAdapter)),
      dependencies.readText(join(dependencies.repositoryRoot,config.productionSources.TreasuryPolicyOApp))
    ]);
    input={
      manifest,evaluationDate,git,networkConfigText,auditEvidenceText,readinessConfigText,buildManifestText,
      productionSources:{SentinelDVNAdapter:adapterSource,TreasuryPolicyOApp:oappSource}
    };
  }catch{return fail(io,"READINESS_INPUT_READ_FAILED")}
  let binding:ReadinessBinding;
  try{binding=await dependencies.inspect(input)}
  catch{return fail(io,"READINESS_BINDING_FAILED")}
  let encoded:string,bundle:DeploymentReadinessBundle;
  try{
    bundle=await dependencies.build({manifest,binding,evaluationDate});
    if(!bundleStatuses.has(bundle.status))throw new Error("invalid readiness status");
    encoded=encodeDeploymentReadinessBundle(bundle);
  }catch{return fail(io,"READINESS_BUILD_FAILED")}
  if(paths.output){
    try{await dependencies.writeExclusive(paths.output,encoded)}
    catch(error){return fail(io,outputError(error))}
  }else{
    try{io.stdout(encoded)}catch{return fail(io,"READINESS_OUTPUT_FAILED")}
  }
  return bundle.status==="READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL"?0:2;
}

export async function writeReadinessFileExclusive(
  target:string,
  contents:string,
  filePort:ReadinessFilePort=defaultFilePort
):Promise<void>{
  if(!validAbsolutePath(target))throw new ReadinessCommandError("READINESS_MANIFEST_INVALID");
  const temporary=join(
    dirname(target),
    `.${basename(target)}.sentinel-readiness-${process.pid}-${randomBytes(16).toString("hex")}.tmp`
  );
  let handle:Awaited<ReturnType<ReadinessFilePort["open"]>>|undefined,closed=false;
  try{
    handle=await filePort.open(temporary,"wx",0o600);
    await handle.writeFile(contents,{encoding:"utf8"});
    await handle.sync();
    await handle.close();closed=true;
    await filePort.link(temporary,target);
    await filePort.unlink(temporary);
  }catch(error){
    if(handle&&!closed)try{await handle.close();closed=true}catch{}
    try{await filePort.unlink(temporary)}catch{}
    if(errorCode(error)==="EEXIST")throw new ReadinessCommandError("READINESS_OUTPUT_EXISTS");
    if(errorCode(error)==="READINESS_OUTPUT_EXISTS")throw error;
    throw new ReadinessCommandError("READINESS_OUTPUT_FAILED");
  }
}

function defaultDependencies():ReadinessCommandDependencies{
  const repositoryRoot=process.cwd();
  return{
    repositoryRoot,
    readText:path=>readFile(path,"utf8"),
    gitState:()=>defaultGitState(repositoryRoot),
    evaluationDate:()=>new Date().toISOString().slice(0,10),
    writeExclusive:writeReadinessFileExclusive,
    inspect:inspectDeploymentReadinessBindings,
    build:buildDeploymentReadinessBundle
  };
}
async function defaultGitState(repositoryRoot:string):Promise<{commit:string;dirty:boolean}>{
  const revision=await runGit(
    ["rev-parse","--show-toplevel","HEAD"],repositoryRoot
  );
  const lines=revision.trimEnd().split("\n");
  if(lines.length!==2||lines[0]!==repositoryRoot||!/^[a-f0-9]{40}$/.test(lines[1]??""))
    throw new ReadinessCommandError("READINESS_GIT_FAILED");
  const status=await runGit(
    ["status","--porcelain=v1","--untracked-files=all"],repositoryRoot
  );
  return{commit:lines[1]!,dirty:status.length>0};
}
function runGit(args:string[],cwd:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    execFile("git",args,{
      cwd,encoding:"utf8",shell:false,
      env:{
        PATH:"/usr/bin:/bin:/usr/local/bin",
        LC_ALL:"C",
        GIT_CONFIG_NOSYSTEM:"1",
        GIT_CONFIG_GLOBAL:"/dev/null"
      }
    },(error,stdout)=>{
      if(error){reject(new ReadinessCommandError("READINESS_GIT_FAILED"));return}
      resolve(stdout);
    });
  });
}
function parseArguments(args:string[]):{manifest:string;output?:string}{
  if(args.length!==2&&args.length!==4)invalid();
  if(args[0]!=="--manifest"||!validAbsolutePath(args[1]))invalid();
  if(args.length===4&&(args[2]!=="--output"||!validAbsolutePath(args[3])))invalid();
  return args.length===2?{manifest:args[1]!}:{manifest:args[1]!,output:args[3]!};
}
function validAbsolutePath(value:unknown):value is string{
  return typeof value==="string"&&value.length>1&&!/[\0-\x1f\x7f]/.test(value)&&
    isAbsolute(value)&&normalize(value)===value;
}
function exactRoot(value:string):void{
  if(!validAbsolutePath(value))throw new ReadinessCommandError("READINESS_BINDING_FAILED");
}
function normalizeDate(value:string):string{
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))invalid();
  const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year!,month!-1,day!));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month!-1||date.getUTCDate()!==day)invalid();
  return value;
}
function manifestError(error:unknown):ReadinessCommandErrorCode{
  if(error instanceof ReadinessError)return error.code;
  return"READINESS_MANIFEST_INVALID";
}
function outputError(error:unknown):ReadinessCommandErrorCode{
  const code=errorCode(error);
  return code==="READINESS_OUTPUT_EXISTS"?"READINESS_OUTPUT_EXISTS":"READINESS_OUTPUT_FAILED";
}
function errorCode(error:unknown):string|undefined{
  if(!error||typeof error!=="object")return;
  const descriptor=Object.getOwnPropertyDescriptor(error,"code");
  return descriptor&&"value"in descriptor&&typeof descriptor.value==="string"?descriptor.value:undefined;
}
function fail(io:ReadinessCommandIo,code:ReadinessCommandErrorCode):1{
  try{io.stderr(canonicalJson({error:code}))}catch{}
  return 1;
}
function invalid():never{throw new ReadinessCommandError("READINESS_MANIFEST_INVALID")}
