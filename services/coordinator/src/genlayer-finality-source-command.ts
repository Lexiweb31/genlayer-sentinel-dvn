import{isAbsolute,normalize}from"node:path";
import{canonicalJson}from"./canonical-json.js";
import{readReadinessTextFile}from"./deployment-readiness-command.js";
import{parseGenLayerFinalitySourceManifestText}from"./genlayer-finality-source-manifest.js";

export interface GenLayerFinalitySourceCommandIo{stdout(value:string):void;stderr(value:string):void}
export interface GenLayerFinalitySourceCommandDependencies{readText(path:string):Promise<string>;today():string}

export async function runGenLayerFinalitySourceCommand(
  args:string[],io:GenLayerFinalitySourceCommandIo,dependencies:GenLayerFinalitySourceCommandDependencies=defaults()
):Promise<1|2>{
  const path=args.length===2&&args[0]==="--manifest"&&absolute(args[1])?args[1]:undefined;
  if(!path)return fail(io);
  let text:string;
  try{text=await dependencies.readText(path)}catch{return fail(io)}
  try{
    const source=parseGenLayerFinalitySourceManifestText(text,dependencies.today());
    io.stdout(canonicalJson({
      truthLabel:"REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION",
      sourceLabel:source.sourceLabel,sourceOriginSha256:source.sourceOriginSha256,
      chainId:source.chainId,policyContract:source.policyContract,
      policyRecordMode:source.policyRecordMode,callDataCodec:source.callDataCodec,reviewDate:source.reviewDate
    }));
    return 2;
  }catch{return fail(io)}
}
function defaults():GenLayerFinalitySourceCommandDependencies{return{readText:readReadinessTextFile,today:()=>new Date().toISOString().slice(0,10)}}
function absolute(value:unknown):value is string{return typeof value==="string"&&value.length>1&&!/[\0-\x1f\x7f]/.test(value)&&isAbsolute(value)&&normalize(value)===value}
function fail(io:GenLayerFinalitySourceCommandIo):1{try{io.stderr('{"error":"GENLAYER_FINALITY_SOURCE_MANIFEST_INVALID"}\n')}catch{}return 1}
