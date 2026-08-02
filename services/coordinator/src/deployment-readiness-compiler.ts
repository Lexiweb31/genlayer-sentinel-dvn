import{createHash}from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import solc from"solc";

const sourceFiles=[
  "contracts/src/SentinelDVNAdapter.sol",
  "contracts/src/TreasuryPolicyOApp.sol",
  "contracts/test/MockVerificationTarget.sol",
  "contracts/test/MockEndpointV2.sol",
  "contracts/test/ActionTarget.sol",
  "contracts/test/RevertingActionTarget.sol"
]as const;
const compiler={
  version:"0.8.30+commit.73712a01.Emscripten.clang",
  evmVersion:"shanghai",
  optimizer:{enabled:true,runs:200}
}as const;

export function compileDeploymentReadinessProvenance(repositoryRoot:string):string{
  if(solc.version()!==compiler.version)invalid();
  const readWithin=(base:string,name:string):string|undefined=>{
    const candidate=path.resolve(base,name),basePath=path.resolve(base);
    if(!candidate.startsWith(`${basePath}${path.sep}`))return;
    let resolvedBase:string,resolved:string;
    try{resolvedBase=fs.realpathSync(base);resolved=fs.realpathSync(candidate)}catch{return}
    if(!resolved.startsWith(`${resolvedBase}${path.sep}`))return;
    const stat=fs.statSync(resolved);
    if(!stat.isFile()||stat.size>2_097_152)return;
    return fs.readFileSync(resolved,"utf8");
  };
  const sources=Object.fromEntries(sourceFiles.map(file=>[
    file,{content:readWithin(repositoryRoot,file)??invalid()}
  ]));
  const output=JSON.parse(solc.compile(JSON.stringify({
    language:"Solidity",sources,
    settings:{
      evmVersion:compiler.evmVersion,
      optimizer:{...compiler.optimizer},
      outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}
    }
  }),{import:(name:string)=>{
    for(const base of[repositoryRoot,path.join(repositoryRoot,"node_modules")]){
      const contents=readWithin(base,name);
      if(contents!==undefined)return{contents};
    }
    return{error:"import not found"};
  }}));
  if((output.errors??[]).some((entry:{severity?:unknown})=>entry.severity==="error"))invalid();
  const contracts=[
    ["contracts/src/SentinelDVNAdapter.sol","SentinelDVNAdapter"],
    ["contracts/src/TreasuryPolicyOApp.sol","TreasuryPolicyOApp"]
  ].map(([source,name])=>{
    const artifact=output.contracts?.[source!]?.[name!];
    if(!artifact||!Array.isArray(artifact.abi)||
      typeof artifact.evm?.bytecode?.object!=="string"||
      !/^(?:[0-9a-f]{2})+$/.test(artifact.evm.bytecode.object))invalid();
    return{
      name:name!,source:source!,sourceSha256:sha256(sources[source!]!.content),
      abiSha256:sha256(JSON.stringify(artifact.abi)),
      creationBytecodeSha256:sha256(Buffer.from(artifact.evm.bytecode.object,"hex"))
    };
  });
  return`${JSON.stringify({schemaVersion:1,compiler,contracts})}\n`;
}

function sha256(value:string|Uint8Array):string{
  return createHash("sha256").update(value).digest("hex");
}
function invalid():never{throw new Error("readiness compilation failed")}
