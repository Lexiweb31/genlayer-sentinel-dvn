import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import{AbiCoder,getAddress}from"ethers";
import{PathwayAuditError}from"../../../dist/services/coordinator/src/pathway-audit-model.js";
import{
  parseAuditContractArtifact,
  verifyDeploymentEvidence
}from"../../../dist/services/coordinator/src/pathway-audit-deployment.js";

const coder=AbiCoder.defaultAbiCoder();
const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const hash=value=>`0x${value.repeat(64)}`;
const sha256Hex=value=>createHash("sha256").update(Buffer.from(value,"hex")).digest("hex");
const creationBytecode="60006000556001600055";
const runtimeCode="0x600160005260206000f3";
const deploymentTxHash=hash("a");
const deploymentAddress=address(0x901);
const deployer=address(0x902);
const blockHash=hash("b");
const endpoint=address(0x101);
const delegate=address(0x102);
const messageLib=address(0x201);
const verificationTarget=address(0x202);
const sortedSigners=[address(0x301),address(0x302),address(0x303),address(0x304),address(0x305)];

const adapterInputs=[
  {internalType:"address",name:"lib",type:"address"},
  {internalType:"address",name:"target",type:"address"},
  {internalType:"uint32",name:"dstEid",type:"uint32"},
  {internalType:"address[]",name:"signers",type:"address[]"},
  {internalType:"uint256",name:"q",type:"uint256"}
];
const oappInputs=[
  {internalType:"address",name:"endpointV2",type:"address"},
  {internalType:"address",name:"delegate",type:"address"}
];

function artifact(name){
  return{
    abi:[{
      inputs:(name==="SentinelDVNAdapter"?adapterInputs:oappInputs).map(value=>({...value})),
      stateMutability:"nonpayable",
      type:"constructor"
    }],
    evm:{
      bytecode:{object:creationBytecode},
      deployedBytecode:{
        object:"600160005260206000f3",
        immutableReferences:name==="SentinelDVNAdapter"?{
          "18":[{start:1,length:20}],
          "19":[{start:22,length:32}]
        }:{}
      }
    }
  };
}

function observation(){
  return{
    chainId:"11155111",blockNumber:"125",blockHash:hash("c"),parentHash:hash("d"),
    stateRoot:hash("e"),transactionsRoot:hash("f"),timestamp:"1700000000"
  };
}

function adapterSuffix(overrides={}){
  const values=[
    overrides.messageLib??messageLib,
    overrides.verificationTarget??verificationTarget,
    overrides.supportedDstEid??40231,
    overrides.signers??sortedSigners,
    overrides.quorum??3n
  ];
  return coder.encode(adapterInputs.map(value=>value.type),values).slice(2);
}

function oappSuffix(overrides={}){
  return coder.encode(
    oappInputs.map(value=>value.type),
    [overrides.endpoint??endpoint,overrides.delegate??delegate]
  ).slice(2);
}

function transaction(input){
  return{
    hash:deploymentTxHash,
    blockHash,
    blockNumber:"0x64",
    from:deployer,
    to:null,
    input:`0x${input}`
  };
}

function receipt(){
  return{
    transactionHash:deploymentTxHash,
    blockHash,
    blockNumber:"0x64",
    status:"0x1",
    contractAddress:deploymentAddress
  };
}

function client({tx,txReceipt,code=runtimeCode}={}){
  const calls=[];
  return{
    calls,
    value:{
      async call(method,params){
        calls.push(structuredClone({method,params}));
        if(method==="eth_getTransactionByHash")return structuredClone(tx);
        if(method==="eth_getTransactionReceipt")return structuredClone(txReceipt);
        if(method==="eth_getCode")return code;
        throw new Error("unexpected read-only call");
      },
      descriptor(){return{label:"fixture",originSha256:"1".repeat(64),operatorFamily:"fixture"}}
    }
  };
}

function adapterInput(overrides={}){
  const suffix=overrides.suffix??adapterSuffix();
  const first=client({
    tx:overrides.firstTx??transaction(`${creationBytecode}${suffix}`),
    txReceipt:overrides.firstReceipt??receipt(),
    code:overrides.firstCode??runtimeCode
  });
  const second=client({
    tx:overrides.secondTx??transaction(`${creationBytecode}${suffix}`),
    txReceipt:overrides.secondReceipt??receipt(),
    code:overrides.secondCode??runtimeCode
  });
  return{
    input:{
      artifact:parseAuditContractArtifact(JSON.stringify(artifact("SentinelDVNAdapter")),"SentinelDVNAdapter"),
      deployment:{address:deploymentAddress,deploymentTxHash},
      clients:[first.value,second.value],
      observationBlock:observation(),
      expected:{
        messageLib,verificationTarget,supportedDstEid:40231,
        signers:sortedSigners,quorum:3
      }
    },
    first,second
  };
}

const deploymentFailure=error=>error instanceof PathwayAuditError&&
  error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED"&&
  error.message==="PATHWAY_AUDIT_OBSERVATION_FAILED";

test("parses a closed repository artifact and returns detached provenance",()=>{
  const raw=artifact("SentinelDVNAdapter");
  const parsed=parseAuditContractArtifact(JSON.stringify(raw),"SentinelDVNAdapter");
  assert.equal(parsed.name,"SentinelDVNAdapter");
  assert.equal(parsed.creationBytecode,creationBytecode);
  assert.equal(parsed.creationBytecodeSha256,sha256Hex(creationBytecode));
  assert.match(parsed.deployedBytecodeSha256,/^[0-9a-f]{64}$/);
  assert.match(parsed.immutableReferencesSha256,/^[0-9a-f]{64}$/);
  raw.abi[0].inputs[0].name="changed";
  raw.evm.deployedBytecode.immutableReferences["18"][0].length=1;
  assert.equal(parsed.constructorInputs[0].name,"lib");
  assert.equal(parsed.immutableReferences["18"][0].length,20);
});

test("rejects malformed, open, secret-bearing, or wrong-constructor artifacts",()=>{
  const cases=[
    value=>{value.extra=true},
    value=>{value.privateKey="secret"},
    value=>{delete value.evm.deployedBytecode},
    value=>{value.evm.bytecode.object="0x6000"},
    value=>{value.evm.deployedBytecode.object=""},
    value=>{value.evm.deployedBytecode.immutableReferences["18"][0].length=0},
    value=>{value.abi[0].inputs.pop()},
    value=>{value.abi[0].inputs[0].extra=true}
  ];
  for(const mutate of cases){
    const value=artifact("SentinelDVNAdapter");mutate(value);
    assert.throws(
      ()=>parseAuditContractArtifact(JSON.stringify(value),"SentinelDVNAdapter"),
      deploymentFailure
    );
  }
  assert.throws(
    ()=>parseAuditContractArtifact('{"abi":[],"abi":[],"evm":{}}',"SentinelDVNAdapter"),
    deploymentFailure
  );
  assert.throws(
    ()=>parseAuditContractArtifact(JSON.stringify(artifact("SentinelDVNAdapter")),"Unknown"),
    deploymentFailure
  );
});

test("proves exact adapter creation, receipt, runtime code, and constructor membership",async()=>{
  const fixture=adapterInput();
  const result=await verifyDeploymentEvidence(fixture.input);
  assert.deepEqual(result.constructorArguments,{
    messageLib,
    verificationTarget,
    supportedDstEid:40231,
    signers:sortedSigners,
    quorum:"3"
  });
  assert.equal(result.contractName,"SentinelDVNAdapter");
  assert.equal(result.address,deploymentAddress);
  assert.equal(result.deploymentTxHash,deploymentTxHash);
  assert.equal(result.deploymentBlockNumber,"100");
  assert.equal(result.deploymentBlockHash,blockHash);
  assert.equal(result.creationBytecodeSha256,sha256Hex(creationBytecode));
  assert.match(result.transactionInputSha256,/^[0-9a-f]{64}$/);
  assert.match(result.runtimeCodeKeccak256,/^0x[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes(transaction(`${creationBytecode}${adapterSuffix()}`).input),false);
  for(const provider of[fixture.first,fixture.second]){
    assert.deepEqual(provider.calls,[
      {method:"eth_getTransactionByHash",params:[deploymentTxHash]},
      {method:"eth_getTransactionReceipt",params:[deploymentTxHash]},
      {method:"eth_getCode",params:[deploymentAddress,{blockHash:observation().blockHash,requireCanonical:true}]}
    ]);
    assert.equal(provider.calls.some(value=>value.method==="eth_call"),false);
  }
});

test("decodes and verifies the exact OApp Endpoint and manifest delegate",async()=>{
  const inputSuffix=oappSuffix(),first=client({tx:transaction(`${creationBytecode}${inputSuffix}`),txReceipt:receipt()}),
    second=client({tx:transaction(`${creationBytecode}${inputSuffix}`),txReceipt:receipt()});
  const input={
    artifact:parseAuditContractArtifact(JSON.stringify(artifact("TreasuryPolicyOApp")),"TreasuryPolicyOApp"),
    deployment:{address:deploymentAddress,deploymentTxHash,delegate},
    clients:[first.value,second.value],observationBlock:observation(),expected:{endpoint}
  };
  const result=await verifyDeploymentEvidence(input);
  assert.deepEqual(result.constructorArguments,{endpoint,delegate});
  for(const suffix of[oappSuffix({endpoint:address(0x999)}),oappSuffix({delegate:address(0x998)})]){
    const changed=transaction(`${creationBytecode}${suffix}`);
    await assert.rejects(verifyDeploymentEvidence({
      ...input,
      clients:[
        client({tx:changed,txReceipt:receipt()}).value,
        client({tx:changed,txReceipt:receipt()}).value
      ]
    }),deploymentFailure);
  }
});

test("rejects invalid creation transaction and receipt evidence",async()=>{
  const validSuffix=adapterSuffix();
  const cases=[
    ["transaction to is not null",{firstTx:transaction(`${creationBytecode}${validSuffix}`),secondTx:transaction(`${creationBytecode}${validSuffix}`)},value=>{value.firstTx.to=address(0x777);value.secondTx.to=address(0x777)}],
    ["failed receipt",{firstReceipt:receipt(),secondReceipt:receipt()},value=>{value.firstReceipt.status="0x0";value.secondReceipt.status="0x0"}],
    ["address mismatch",{firstReceipt:receipt(),secondReceipt:receipt()},value=>{value.firstReceipt.contractAddress=address(0x777);value.secondReceipt.contractAddress=address(0x777)}],
    ["receipt after observation",{firstReceipt:receipt(),secondReceipt:receipt()},value=>{value.firstReceipt.blockNumber="0x7e";value.secondReceipt.blockNumber="0x7e"}],
    ["transaction receipt block mismatch",{firstReceipt:receipt(),secondReceipt:receipt()},value=>{value.firstReceipt.blockHash=hash("9");value.secondReceipt.blockHash=hash("9")}],
    ["transaction provider disagreement",{secondTx:transaction(`${creationBytecode}${validSuffix}`)},value=>{value.secondTx.from=address(0x778)}],
    ["receipt provider disagreement",{secondReceipt:receipt()},value=>{value.secondReceipt.contractAddress=address(0x779)}],
    ["creation prefix drift",{firstTx:transaction(`61${creationBytecode.slice(2)}${validSuffix}`),secondTx:transaction(`61${creationBytecode.slice(2)}${validSuffix}`)},()=>{}],
    ["malformed constructor suffix",{firstTx:transaction(`${creationBytecode}${validSuffix.slice(0,-2)}`),secondTx:transaction(`${creationBytecode}${validSuffix.slice(0,-2)}`)},()=>{}],
    ["empty runtime code",{firstCode:"0x",secondCode:"0x"},()=>{}],
    ["runtime provider disagreement",{secondCode:"0x6002"},()=>{}]
  ];
  for(const[name,options,mutate]of cases){
    mutate(options);
    await assert.rejects(verifyDeploymentEvidence(adapterInput(options).input),deploymentFailure,name);
  }
});

test("rejects constructor signer and quorum drift instead of trusting runtime mappings",async()=>{
  const cases=[
    ["unexpected message library",adapterSuffix({messageLib:address(0x777)})],
    ["unexpected verification target",adapterSuffix({verificationTarget:address(0x778)})],
    ["unexpected destination EID",adapterSuffix({supportedDstEid:40161})],
    ["unsorted signers",adapterSuffix({signers:[...sortedSigners].reverse()})],
    ["extra signers",adapterSuffix({signers:[...sortedSigners,address(0x306)]})],
    ["signer membership drift",adapterSuffix({signers:[...sortedSigners.slice(0,4),address(0x399)]})],
    ["quorum drift",adapterSuffix({quorum:2n})]
  ];
  for(const[name,suffix]of cases){
    await assert.rejects(verifyDeploymentEvidence(adapterInput({suffix}).input),deploymentFailure,name);
  }
});

test("rejects partial or open deployment metadata and expected policy",async()=>{
  const fixture=adapterInput();
  for(const mutate of[
    input=>{delete input.deployment.deploymentTxHash},
    input=>{input.deployment.delegate=delegate},
    input=>{delete input.expected.signers},
    input=>{input.expected.signerMappings=sortedSigners}
  ]){
    const input=adapterInput().input;mutate(input);
    await assert.rejects(verifyDeploymentEvidence(input),deploymentFailure);
  }
});
