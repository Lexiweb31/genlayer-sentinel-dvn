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
        creationBytecode:"6000"
      },
      {
        name:"TreasuryPolicyOApp",
        source:"contracts/src/TreasuryPolicyOApp.sol",
        sourceText:"contract B{}",
        abi:[],
        creationBytecode:"6001"
      }
    ]
  };
}

test("binds exact compiler settings, source, ABI and decoded creation bytecode",()=>{
  const manifest=contractBuildManifest(fixture());
  assert.deepEqual(manifest,{
    schemaVersion:1,
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
        creationBytecodeSha256:"f3df0a62b10f205b0f29768aa3d69e777154caaa179f64aabb0a4899c666b017"
      },
      {
        name:"TreasuryPolicyOApp",
        source:"contracts/src/TreasuryPolicyOApp.sol",
        sourceSha256:"b0968d422e1765ca98e8e8b6f4b8caa90b3e19a9f16b94a437c95474da8a4c72",
        abiSha256:"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        creationBytecodeSha256:"9e67b12fd8c58953460459cad7a6d4dd7d6d57594affce8206d1397c9c4db543"
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
    value=>{value.contracts[1].name=value.contracts[0].name}
  ];
  for(const mutate of invalid){
    const value=fixture();mutate(value);
    assert.throws(()=>contractBuildManifest(value),/contract build manifest/);
  }
});

test("returns detached provenance values",()=>{
  const input=fixture(),manifest=contractBuildManifest(input);
  input.settings.optimizer.runs=1;
  input.contracts[0].abi.length=0;
  assert.equal(manifest.compiler.optimizer.runs,200);
  assert.equal(manifest.contracts[0].abiSha256,"fd975e9dda11cf60a9e3a10f7f3d6b7ffd113696ff5e55d88c6e873254c77c8a");
});
