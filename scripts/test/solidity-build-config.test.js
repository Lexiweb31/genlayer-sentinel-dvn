import test from "node:test";
import assert from "node:assert/strict";
import {
  contractBuildManifest,
  solidityBuildConfig
} from "../solidity-build-config.mjs";

function fixture(){
  return{
    compilerVersion:solidityBuildConfig.solcJsVersion,
    settings:{evmVersion:"shanghai",optimizer:{enabled:true,runs:200}},
    contracts:[
      {
        name:"SentinelDVNAdapter",
        source:"contracts/src/SentinelDVNAdapter.sol",
        sourceText:"contract A{}",
        abi:[{type:"constructor",inputs:[]}],
        creationBytecode:"6000",
        deployedBytecode:"6002",
        immutableReferences:{
          "12":[{start:1,length:32}],
          "3":[{start:33,length:20}]
        }
      },
      {
        name:"TreasuryPolicyOApp",
        source:"contracts/src/TreasuryPolicyOApp.sol",
        sourceText:"contract B{}",
        abi:[],
        creationBytecode:"6001",
        deployedBytecode:"6003",
        immutableReferences:{}
      }
    ]
  };
}

test("binds exact compiler settings, source, ABI, creation and deployed bytecode",()=>{
  const manifest=contractBuildManifest(fixture());
  assert.deepEqual(manifest,{
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
  });
});

test("rejects compiler, ordering, source and artifact drift",()=>{
  const invalid=[
    value=>{value.compilerVersion="0.8.29+commit.invalid"},
    value=>{value.settings.optimizer.enabled=false},
    value=>{value.settings.optimizer.runs=201},
    value=>{value.settings.evmVersion="cancun"},
    value=>{value.contracts.reverse()},
    value=>{value.contracts[0].name="Unknown"},
    value=>{value.contracts[0].source="../SentinelDVNAdapter.sol"},
    value=>{value.contracts[0].creationBytecode=""},
    value=>{value.contracts[0].creationBytecode="0x6000"},
    value=>{value.contracts[0].creationBytecode="zz"},
    value=>{value.contracts[0].creationBytecode="600"},
    value=>{value.contracts[0].deployedBytecode=""},
    value=>{value.contracts[0].deployedBytecode="0x6002"},
    value=>{value.contracts[0].deployedBytecode="600"},
    value=>{value.contracts[0].immutableReferences={"12":[{start:-1,length:32}]}},
    value=>{value.contracts[0].immutableReferences={"12":[{start:1,length:0}]}},
    value=>{value.contracts[0].immutableReferences={"secret":[{start:1,length:32}]}},
    value=>{value.contracts[1].name=value.contracts[0].name}
  ];
  for(const mutate of invalid){
    const value=fixture();mutate(value);
    assert.throws(()=>contractBuildManifest(value),/contract build manifest/);
  }
});

test("changes provenance when deployed bytes or immutable references drift",()=>{
  const baseline=contractBuildManifest(fixture()).contracts[0];
  const deployedDrift=fixture();deployedDrift.contracts[0].deployedBytecode="6003";
  const immutableDrift=fixture();immutableDrift.contracts[0].immutableReferences["12"][0].length=33;
  assert.notEqual(
    contractBuildManifest(deployedDrift).contracts[0].deployedBytecodeSha256,
    baseline.deployedBytecodeSha256
  );
  assert.notEqual(
    contractBuildManifest(immutableDrift).contracts[0].immutableReferencesSha256,
    baseline.immutableReferencesSha256
  );
});

test("returns detached provenance values",()=>{
  const input=fixture(),manifest=contractBuildManifest(input);
  input.settings.optimizer.runs=1;
  input.contracts[0].abi.length=0;
  input.contracts[0].immutableReferences["12"][0].length=1;
  assert.equal(manifest.compiler.optimizer.runs,200);
  assert.equal(manifest.contracts[0].abiSha256,"fd975e9dda11cf60a9e3a10f7f3d6b7ffd113696ff5e55d88c6e873254c77c8a");
  assert.equal(manifest.contracts[0].immutableReferencesSha256,"7d38f4f9868bae72125d965c5719f16f4695c9d62a11dec142df339840a70f85");
});
