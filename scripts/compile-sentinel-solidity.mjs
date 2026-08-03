import fs from"node:fs";
import path from"node:path";
import solc from"solc";
import{
  assertSolcJsVersion,
  compilationSettings,
  contractBuildManifest,
  solidityBuildConfig
}from"./solidity-build-config.mjs";

export const sentinelSoliditySources=Object.freeze([
  "contracts/src/SentinelDVNAdapter.sol",
  "contracts/src/TreasuryPolicyOApp.sol",
  "contracts/test/MockVerificationTarget.sol",
  "contracts/test/MockEndpointV2.sol",
  "contracts/test/ActionTarget.sol",
  "contracts/test/RevertingActionTarget.sol"
]);

export function compileSentinelSolidity(root){
  const readWithin=(base,name)=>{
    const candidate=path.resolve(base,name),resolvedBase=fs.realpathSync(base);
    if(!candidate.startsWith(`${path.resolve(base)}${path.sep}`))return;
    let resolved;try{resolved=fs.realpathSync(candidate)}catch{return}
    if(!resolved.startsWith(`${resolvedBase}${path.sep}`))return;
    const stat=fs.statSync(resolved);
    if(!stat.isFile()||stat.size>2_097_152)return;
    return fs.readFileSync(resolved,"utf8");
  };
  const sources=Object.fromEntries(sentinelSoliditySources.map(file=>[
    file,{content:readWithin(root,file)??fail()}
  ]));
  const findImports=name=>{
    for(const base of[root,path.join(root,"node_modules")]){
      const contents=readWithin(base,name);
      if(contents!==undefined)return{contents};
    }
    return{error:"import not found"};
  };
  assertSolcJsVersion(solc.version());
  const input={
    language:"Solidity",sources,
    settings:compilationSettings({"*":{"*":[
      "abi",
      "evm.bytecode.object",
      "evm.deployedBytecode.object",
      "evm.deployedBytecode.immutableReferences"
    ]}})
  };
  const output=JSON.parse(solc.compile(JSON.stringify(input),{import:findImports}));
  const errors=(output.errors??[]).filter(entry=>entry.severity==="error");
  if(errors.length)throw new Error("Solidity compilation failed");
  const productionContracts=[
    ["contracts/src/SentinelDVNAdapter.sol","SentinelDVNAdapter"],
    ["contracts/src/TreasuryPolicyOApp.sol","TreasuryPolicyOApp"]
  ].map(([file,name])=>{
    const artifact=output.contracts[file]?.[name];
    if(!artifact)throw new Error("production contract artifact missing");
    return{
      name,source:file,sourceText:sources[file].content,
      abi:artifact.abi,
      creationBytecode:artifact.evm.bytecode.object,
      deployedBytecode:artifact.evm.deployedBytecode.object,
      immutableReferences:artifact.evm.deployedBytecode.immutableReferences
    };
  });
  return{
    output,
    buildManifest:contractBuildManifest({
      compilerVersion:solc.version(),
      settings:{
        evmVersion:solidityBuildConfig.evmVersion,
        optimizer:{...solidityBuildConfig.optimizer}
      },
      contracts:productionContracts
    })
  };
}

function fail(){throw new Error("Solidity source unavailable")}
