import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import{AbiCoder,Interface,getAddress,keccak256}from"ethers";
import{observePathway}from"../../../dist/services/coordinator/src/pathway-audit-observer.js";

const coder=AbiCoder.defaultAbiCoder();
const address=value=>getAddress(`0x${value.toString(16).padStart(40,"0")}`);
const lower=value=>value.toLowerCase();
const hash=value=>`0x${value.repeat(64)}`;
const sha256=value=>createHash("sha256").update(value).digest("hex");
const peer=value=>`0x${"0".repeat(24)}${value.slice(2).toLowerCase()}`;

const endpointInterface=new Interface([
  "function getSendLibrary(address sender,uint32 dstEid) view returns(address lib)",
  "function isDefaultSendLibrary(address sender,uint32 dstEid) view returns(bool)",
  "function getReceiveLibrary(address receiver,uint32 srcEid) view returns(address lib,bool isDefault)"
]);
const ulnInterface=new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function executorConfigs(address oapp,uint32 remoteEid) view returns(uint32 maxMessageSize,address executor)"
]);
const oappInterface=new Interface(["function peers(uint32 eid) view returns(bytes32 peer)"]);
const adapterInterface=new Interface([
  "function messageLib() view returns(address)",
  "function verificationTarget() view returns(address)",
  "function supportedDstEid() view returns(uint32)",
  "function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)"
]);

const contracts={
  source:{endpoint:address(0x101),send:address(0x102),executor:address(0x103),dead:address(0x104),receive:address(0x105)},
  destination:{endpoint:address(0x111),send:address(0x112),executor:address(0x114),dead:address(0x115),receive:address(0x113)},
  sourceOApp:address(0x201),sourceAdapter:address(0x202),destinationOApp:address(0x211),destinationAdapter:address(0x212),
  independentDvn:address(0x301)
};
const signers=[0x401,0x402,0x403,0x404,0x405].map(address);
const delegates={source:address(0x501),destination:address(0x502)};
const creationBytecode="6000",deployedBytecode="6001",runtimeCode=`0x${deployedBytecode}`;
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
    abi:[{inputs:(name==="SentinelDVNAdapter"?adapterInputs:oappInputs).map(value=>({...value})),stateMutability:"nonpayable",type:"constructor"}],
    evm:{bytecode:{object:creationBytecode},deployedBytecode:{object:deployedBytecode,immutableReferences:{}}}
  };
}

function artifacts(){
  const adapter=artifact("SentinelDVNAdapter"),oapp=artifact("TreasuryPolicyOApp");
  const contract=(name,source,sourceSha256,abi)=>({
    name,source,sourceSha256,abiSha256:sha256(JSON.stringify(abi)),
    creationBytecodeSha256:sha256(Buffer.from(creationBytecode,"hex")),
    deployedBytecodeSha256:sha256(Buffer.from(deployedBytecode,"hex")),
    immutableReferencesSha256:sha256("{}\n")
  });
  return{
    adapterArtifactText:JSON.stringify(adapter),
    oappArtifactText:JSON.stringify(oapp),
    buildManifestText:JSON.stringify({
      schemaVersion:2,
      compiler:{version:"0.8.30+commit.73712a01.Emscripten.clang",evmVersion:"shanghai",optimizer:{enabled:true,runs:200}},
      contracts:[
        contract("SentinelDVNAdapter","contracts/src/SentinelDVNAdapter.sol","1".repeat(64),adapter.abi),
        contract("TreasuryPolicyOApp","contracts/src/TreasuryPolicyOApp.sol","2".repeat(64),oapp.abi)
      ]
    })
  };
}

function manifest(deployment=true){
  const endpoint=(label,url,operatorFamily,digit)=>({label,url,operatorFamily,originSha256:digit.repeat(64)});
  return{
    schemaVersion:1,networkAuditSha256:"a".repeat(64),
    source:{
      name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:3,
      contracts:{endpointV2:contracts.source.endpoint,sendUln302:contracts.source.send,executor:contracts.source.executor,deadDvn:contracts.source.dead},
      rpcs:[endpoint("source-a","https://source-a.example/","operator-source-a","1"),endpoint("source-b","https://source-b.example/","operator-source-b","2")]
    },
    destination:{
      name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:20,
      contracts:{endpointV2:contracts.destination.endpoint,receiveUln302:contracts.destination.receive,deadDvn:contracts.destination.dead},
      rpcs:[endpoint("destination-a","https://destination-a.example/","operator-destination-a","3"),endpoint("destination-b","https://destination-b.example/","operator-destination-b","4")]
    },
    deployment:deployment?{
      sourceOApp:{address:contracts.sourceOApp,deploymentTxHash:hash("1"),delegate:delegates.source},
      destinationOApp:{address:contracts.destinationOApp,deploymentTxHash:hash("2"),delegate:delegates.destination},
      sourceAdapter:{address:contracts.sourceAdapter,deploymentTxHash:hash("3")},
      destinationAdapter:{address:contracts.destinationAdapter,deploymentTxHash:hash("4")},
      authorizedSigners:[...signers],quorum:3
    }:null,
    confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
    acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
  };
}

function policyBinding(value){
  const codeHash=keccak256("0x6000");
  const dvnSource="docs/research/reviewed-dvn-operators.md";
  return{
    networkAuditSha256:value.networkAuditSha256,providerAuditSha256:"b".repeat(64),dvnOperatorAuditSha256:"d".repeat(64),repositoryBindingSha256:"c".repeat(64),
    network:{
      source:{chainId:11155111,eid:40161,contracts:{endpointV2:contracts.source.endpoint,sendUln302:contracts.source.send,receiveUln302:contracts.source.receive,executor:contracts.source.executor,deadDvn:contracts.source.dead}},
      destination:{chainId:421614,eid:40231,contracts:{endpointV2:contracts.destination.endpoint,sendUln302:contracts.destination.send,receiveUln302:contracts.destination.receive,executor:contracts.destination.executor,deadDvn:contracts.destination.dead}}
    },
    officialRuntimeCodeKeccak256:{
      sourceEndpointV2:codeHash,sourceSendUln302:codeHash,sourceExecutor:codeHash,
      destinationEndpointV2:codeHash,destinationReceiveUln302:codeHash
    },
    providerState:{
      source:value.source.rpcs.map(rpc=>({label:rpc.label,state:"OPERATOR_EVIDENCE_REVIEWED"})),
      destination:value.destination.rpcs.map(rpc=>({label:rpc.label,state:"OPERATOR_EVIDENCE_REVIEWED"}))
    },
    reviewedDvns:{
      source:[{chain:"ethereum-sepolia",chainId:11155111,address:contracts.independentDvn,operatorFamily:"independent-dvn-a",operatorEvidenceSha256:"7".repeat(64),sources:[dvnSource]}],
      destination:[{chain:"arbitrum-sepolia",chainId:421614,address:contracts.independentDvn,operatorFamily:"independent-dvn-a",operatorEvidenceSha256:"7".repeat(64),sources:[dvnSource]}]
    },
    rpcIndependence:{source:"OPERATOR_INDEPENDENCE_REVIEWED",destination:"OPERATOR_INDEPENDENCE_REVIEWED"},
    blockers:[]
  };
}

function header(numberValue,chain,changed=false){
  const digit=chain==="source"?(changed?"9":"a"):(changed?"8":"b");
  return{number:`0x${numberValue.toString(16)}`,hash:hash(digit),parentHash:hash("c"),stateRoot:hash("d"),transactionsRoot:hash("e"),timestamp:"0x6553f100"};
}

function deploymentEvidence(value,chain,options={}){
  const chainId=chain==="source"?"0xaa36a7":"0x66eee";
  const blockNumber=chain==="source"?"0x64":"0x96";
  const blockHash=chain==="source"?hash("5"):hash("6");
  const from=chain==="source"?address(0x601):address(0x602);
  const entryByHash=new Map();
  const add=(entry,suffix)=>entryByHash.set(entry.deploymentTxHash,{
    transaction:{hash:entry.deploymentTxHash,chainId,blockHash,blockNumber,from,to:null,input:`0x${options.creationDrift?"61":"60"}00${suffix}`},
    receipt:{transactionHash:entry.deploymentTxHash,blockHash,blockNumber,status:"0x1",contractAddress:entry.address}
  });
  const oapp=chain==="source"?value.deployment.sourceOApp:value.deployment.destinationOApp;
  add(oapp,coder.encode(oappInputs.map(input=>input.type),[chain==="source"?contracts.source.endpoint:contracts.destination.endpoint,oapp.delegate]).slice(2));
  const adapter=chain==="source"?value.deployment.sourceAdapter:value.deployment.destinationAdapter;
  const network=chain==="source"?contracts.source:contracts.destination;
  add(adapter,coder.encode(adapterInputs.map(input=>input.type),[network.send,network.receive,40231,signers,3n]).slice(2));
  return entryByHash;
}

function chainFixture(value,chain,options={}){
  const isSource=chain==="source",baseHead=isSource?128:198,headA=options.unequalHeads?baseHead+2:baseHead,headB=baseHead;
  const selected=isSource?125:178,block=header(selected,chain);
  const network=isSource?contracts.source:contracts.destination;
  const pathUln=isSource?[15n,1,1,1,[contracts.independentDvn],[contracts.sourceAdapter]]:[64n,1,1,1,[contracts.independentDvn],[contracts.destinationAdapter]];
  const deployments=value.deployment?deploymentEvidence(value,chain,options):new Map();
  const codeByAddress=new Map([
    [lower(network.endpoint),"0x6000"],[lower(network.send),"0x6000"],[lower(network.receive),"0x6000"],
    [lower(network.executor),"0x6000"],[lower(network.dead),"0x6000"],[lower(contracts.independentDvn),"0x6000"],
    [lower(isSource?contracts.sourceOApp:contracts.destinationOApp),runtimeCode],
    [lower(isSource?contracts.sourceAdapter:contracts.destinationAdapter),runtimeCode]
  ]);

  const createClient=index=>{
    const calls=[];let blockReads=0;
    const rpc=value[chain].rpcs[index];
    return{
      calls,
      client:{
        descriptor(){return{label:rpc.label,originSha256:rpc.originSha256,operatorFamily:rpc.operatorFamily}},
        async call(method,params){
          calls.push(structuredClone({method,params}));
          if(method==="eth_chainId")return options.chainEquivocation&&index===1?"0x66eee":isSource?"0xaa36a7":"0x66eee";
          if(method==="eth_blockNumber")return`0x${(index===0?headA:headB).toString(16)}`;
          if(method==="eth_getBlockByNumber"){
            blockReads++;
            if(options.latestInstead&&index===1&&blockReads===1)return header(headB,chain);
            if(options.reorg&&index===1&&blockReads>1)return header(selected,chain,true);
            return structuredClone(block);
          }
          if(method==="eth_getCode"){
            const target=lower(params[0]);
            if(options.codeMissing&&index===1&&target===lower(network.endpoint))return"0x";
            if(options.codeDisagreement&&index===1&&target===lower(network.endpoint))return"0x6002";
            if(options.deploymentCodeDisagreement&&index===1&&target===lower(isSource?contracts.sourceAdapter:contracts.destinationAdapter))return"0x6002";
            return codeByAddress.get(target)??"0x6000";
          }
          if(method==="eth_getTransactionByHash"){
            const result=structuredClone(deployments.get(params[0])?.transaction);
            if(options.transactionDisagreement&&index===1&&params[0]===(isSource?value.deployment.sourceAdapter.deploymentTxHash:value.deployment.destinationAdapter.deploymentTxHash))result.from=address(0x999);
            return result;
          }
          if(method==="eth_getTransactionReceipt")return structuredClone(deployments.get(params[0])?.receipt);
          if(method==="eth_call")return callResult(params[0].to,params[0].data);
          throw new Error("unexpected RPC method");
        }
      }
    };
  };

  function callResult(to,data){
    const target=lower(to);
    if(data.startsWith(endpointInterface.getFunction("getSendLibrary").selector))return endpointInterface.encodeFunctionResult("getSendLibrary",[options.sendLibrary??contracts.source.send]);
    if(data.startsWith(endpointInterface.getFunction("isDefaultSendLibrary").selector))return endpointInterface.encodeFunctionResult("isDefaultSendLibrary",[false]);
    if(data.startsWith(endpointInterface.getFunction("getReceiveLibrary").selector))return endpointInterface.encodeFunctionResult("getReceiveLibrary",[options.receiveLibrary??contracts.destination.receive,false]);
    if(data.startsWith(ulnInterface.getFunction("isSupportedEid").selector))return ulnInterface.encodeFunctionResult("isSupportedEid",[true]);
    if(data.startsWith(ulnInterface.getFunction("getAppUlnConfig").selector))return ulnInterface.encodeFunctionResult("getAppUlnConfig",[pathUln]);
    if(data.startsWith(ulnInterface.getFunction("getUlnConfig").selector))return ulnInterface.encodeFunctionResult("getUlnConfig",[pathUln]);
    if(data.startsWith(ulnInterface.getFunction("executorConfigs").selector))return ulnInterface.encodeFunctionResult("executorConfigs",[10000,contracts.source.executor]);
    if(data.startsWith(oappInterface.getFunction("peers").selector))return oappInterface.encodeFunctionResult("peers",[peer(isSource?contracts.destinationOApp:contracts.sourceOApp)]);
    const adapterAddress=lower(isSource?contracts.sourceAdapter:contracts.destinationAdapter);
    if(target===adapterAddress&&data.startsWith(adapterInterface.getFunction("messageLib").selector))return adapterInterface.encodeFunctionResult("messageLib",[network.send]);
    if(target===adapterAddress&&data.startsWith(adapterInterface.getFunction("verificationTarget").selector))return adapterInterface.encodeFunctionResult("verificationTarget",[network.receive]);
    if(target===adapterAddress&&data.startsWith(adapterInterface.getFunction("supportedDstEid").selector))return adapterInterface.encodeFunctionResult("supportedDstEid",[40231]);
    if(target===adapterAddress&&data.startsWith(adapterInterface.getFunction("quorum").selector))return adapterInterface.encodeFunctionResult("quorum",[3]);
    if(target===adapterAddress&&data.startsWith(adapterInterface.getFunction("signer").selector))return adapterInterface.encodeFunctionResult("signer",[true]);
    throw new Error("unexpected eth_call");
  }

  return{block,providers:[createClient(0),createClient(1)]};
}

function fixture({deployment=true,source={},destination={}}={}){
  const value=manifest(deployment),sourceFixture=chainFixture(value,"source",source),destinationFixture=chainFixture(value,"destination",destination);
  const clients={source:sourceFixture.providers.map(provider=>provider.client),destination:destinationFixture.providers.map(provider=>provider.client)};
  return{
    input:{manifest:value,policyBinding:policyBinding(value),clients, ...artifacts()},
    calls:{source:sourceFixture.providers.map(provider=>provider.calls),destination:destinationFixture.providers.map(provider=>provider.calls)},
    blocks:{source:sourceFixture.block,destination:destinationFixture.block}
  };
}

function codes(observation){return observation.blockers.map(blocker=>blocker.code)}

test("observes two reviewed providers per chain at exact stable blocks and evaluates the complete 3-of-5 pathway",async()=>{
  const setup=fixture(),observation=await observePathway(setup.input);
  assert.equal(observation.status,"OBSERVED_PATHWAY_CONSISTENT",JSON.stringify(observation.blockers));
  assert.equal(observation.truthLabel,"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED");
  assert.deepEqual(observation.blockers,[]);
  assert.equal(observation.officialCode.source.length,3);
  assert.equal(observation.officialCode.destination.length,2);
  assert.deepEqual(observation.source.uln,{confirmations:"15",requiredDvns:[lower(contracts.independentDvn)],optionalDvns:[lower(contracts.sourceAdapter)],optionalDvnThreshold:1});
  assert.deepEqual(observation.destination.rawAppUln,{confirmations:"64",requiredDvns:[lower(contracts.independentDvn)],optionalDvns:[lower(contracts.destinationAdapter)],optionalDvnThreshold:1});
  assert.deepEqual(observation.source.adapter.signersAuthorized,[true,true,true,true,true]);
  assert.deepEqual(observation.destination.adapter.signersAuthorized,[true,true,true,true,true]);
  assert.equal(observation.deployments.sourceAdapter.constructorArguments.quorum,"3");
  assert.equal(observation.deployments.destinationAdapter.constructorArguments.signers.length,5);
  assert.match(observation.providerAgreement.source.resultSha256,/^[a-f0-9]{64}$/);
  assert.match(observation.providerAgreement.destination.resultSha256,/^[a-f0-9]{64}$/);
  assert.notEqual(observation.providerAgreement.source.resultSha256,observation.providerAgreement.destination.resultSha256);
  assert.deepEqual({source:observation.providerAgreement.source.resultSha256,destination:observation.providerAgreement.destination.resultSha256},{
    source:"46ff91395012705bf46cd626b97c79d6c2c68d0ae719f71c3f20b291a6808d1c",
    destination:"b14b2e302162489ed3cd323a66ef1fbf7fde81ef78ba0261e7d123725cb54bb8"
  });
  assert.match(observation.configurationSha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(observation).match(/liveness|genlayer|finality|productionReadiness/gi),null);
  for(const [chain,groups]of Object.entries(setup.calls))for(const calls of groups){
    const reference={blockHash:setup.blocks[chain].hash,requireCanonical:true};
    for(const call of calls.filter(value=>value.method==="eth_getCode"||value.method==="eth_call"))assert.deepEqual(call.params.at(-1),reference);
    assert.equal(calls.some(value=>value.method.startsWith("eth_send")||value.method.startsWith("wallet_")||value.method.startsWith("personal_")),false);
  }
});

test("a null deployment still records all official code and never probes pathway or creation state",async()=>{
  const setup=fixture({deployment:false}),observation=await observePathway(setup.input);
  assert.equal(observation.status,"BLOCKED_PATHWAY_CONFIGURATION");
  assert.deepEqual(codes(observation),["AUDIT_PATHWAY_DEPLOYMENTS_MISSING"]);
  assert.equal(observation.source,null);
  assert.equal(observation.destination,null);
  assert.equal(observation.deployments,null);
  assert.equal(observation.officialCode.source.length,3);
  assert.equal(observation.officialCode.destination.length,2);
  for(const groups of Object.values(setup.calls))for(const calls of groups){
    assert.equal(calls.some(value=>value.method==="eth_call"||value.method==="eth_getTransactionByHash"||value.method==="eth_getTransactionReceipt"),false);
    const codeTargets=calls.filter(value=>value.method==="eth_getCode").map(value=>lower(value.params[0]));
    assert.equal(codeTargets.some(target=>[contracts.sourceOApp,contracts.destinationOApp,contracts.sourceAdapter,contracts.destinationAdapter].map(lower).includes(target)),false);
  }
});

test("a partial official code review preserves the code-identity blocker before deployment",async()=>{
  const setup=fixture({deployment:false}),codeHash=keccak256("0x6000");
  setup.input.policyBinding.officialRuntimeCodeKeccak256={
    sourceEndpointV2:codeHash,sourceSendUln302:null,sourceExecutor:null,
    destinationEndpointV2:null,destinationReceiveUln302:null
  };
  const observation=await observePathway(setup.input);
  assert.equal(observation.officialCode.source[0].identity,"CODE_IDENTITY_REVIEWED");
  assert.equal(observation.officialCode.source[1].identity,"CODE_PRESENT_IDENTITY_UNPROVEN");
  assert.equal(observation.status,"BLOCKED_CODE_IDENTITY");
  assert.deepEqual(codes(observation),["AUDIT_CODE_IDENTITY_UNPROVEN","AUDIT_PATHWAY_DEPLOYMENTS_MISSING"]);
});

test("predeployment missing-vs-code disagreement cannot be labeled transport agreement",async()=>{
  const observation=await observePathway(fixture({deployment:false,source:{codeMissing:true}}).input);
  assert.equal(observation.blockers.some(value=>value.code==="AUDIT_CODE_MISSING"),true);
  assert.equal(observation.providerAgreement.source.state,"PROVIDER_DISAGREEMENT");
  assert.notEqual(observation.status,"OBSERVED_PATHWAY_CONSISTENT");
});

test("valid unequal heads remain provider agreement when both providers prove the selected canonical block",async()=>{
  const observation=await observePathway(fixture({source:{unequalHeads:true}}).input);
  assert.equal(observation.blocks.source.blockNumber,"125");
  assert.equal(observation.providerAgreement.source.state,"TWO_TRANSPORTS_AGREE");
  assert.deepEqual(observation.blockers,[]);
  assert.equal(observation.status,"OBSERVED_PATHWAY_CONSISTENT");
});

test("orchestration failures map to deterministic sanitized consensus and provenance blockers",async t=>{
  const cases=[
    ["chain equivocation",{source:{chainEquivocation:true}},"AUDIT_CHAIN_MISMATCH","RPC_CONSENSUS","source"],
    ["block reorg",{source:{reorg:true}},"AUDIT_BLOCK_UNSTABLE","RPC_CONSENSUS","source"],
    ["latest substituted for exact block",{source:{latestInstead:true}},"AUDIT_BLOCK_DISAGREEMENT","RPC_CONSENSUS","source"],
    ["one provider missing code",{source:{codeMissing:true}},"AUDIT_CODE_MISSING","CODE_IDENTITY","source"],
    ["official runtime code disagreement",{source:{codeDisagreement:true}},"AUDIT_PROVIDER_RESULT_DISAGREEMENT","RPC_CONSENSUS","source"],
    ["deployment transaction disagreement",{source:{transactionDisagreement:true}},"AUDIT_PROVIDER_RESULT_DISAGREEMENT","RPC_CONSENSUS","source"],
    ["deployment runtime code disagreement",{destination:{deploymentCodeDisagreement:true}},"AUDIT_PROVIDER_RESULT_DISAGREEMENT","RPC_CONSENSUS","destination"],
    ["creation bytecode drift",{source:{creationDrift:true}},"AUDIT_DEPLOYMENT_ARTIFACT_MISMATCH","CODE_IDENTITY","source"]
  ];
  for(const[name,mutation,code,category,chain]of cases)await t.test(name,async()=>{
    const observation=await observePathway(fixture(mutation).input);
    assert.notEqual(observation.status,"OBSERVED_PATHWAY_CONSISTENT");
    assert.equal(observation.blockers.some(blocker=>blocker.code===code&&blocker.category===category),true,JSON.stringify(observation.blockers));
    if(category==="RPC_CONSENSUS"||name==="one provider missing code")assert.equal(observation.providerAgreement[chain].state,"PROVIDER_DISAGREEMENT");
    assert.equal(JSON.stringify(observation).includes("https://"),false);
  });
});
