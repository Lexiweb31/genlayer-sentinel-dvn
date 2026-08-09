import test from"node:test";
import assert from"node:assert/strict";
import{createHash}from"node:crypto";
import{readFile}from"node:fs/promises";
import{join}from"node:path";
import{AbiCoder,Interface,getAddress,keccak256}from"ethers";
import{canonicalJson}from"../../../dist/services/coordinator/src/canonical-json.js";
import{buildPathwayAuditBundle,encodePathwayAuditBundle,parsePathwayAuditBundleText}from"../../../dist/services/coordinator/src/pathway-audit-bundle.js";
import{runPathwayAuditCommand,writePathwayAuditFileExclusive}from"../../../dist/services/coordinator/src/pathway-audit-command.js";
import{observePathway}from"../../../dist/services/coordinator/src/pathway-audit-observer.js";
import{bindPathwayAuditPolicy}from"../../../dist/services/coordinator/src/pathway-audit-policy.js";

const root=process.cwd(),coder=AbiCoder.defaultAbiCoder();
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
  "function messageLib() view returns(address)","function verificationTarget() view returns(address)",
  "function supportedDstEid() view returns(uint32)","function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)"
]);
const contracts={
  source:{endpoint:"0x6EDCE65403992e310A62460808c4b910D972f10f",send:"0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE",receive:"0xdAf00F5eE2158dD58E0d3857851c432E34A3A851",executor:"0x718B92b5CB0a5552039B593faF724D182A881eDA",dead:"0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8"},
  destination:{endpoint:"0x6EDCE65403992e310A62460808c4b910D972f10f",send:"0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E",receive:"0x75Db67CDab2824970131D5aa9CECfC9F69c69636",executor:"0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897",dead:"0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611"},
  sourceOApp:address(0x201),sourceAdapter:address(0x202),destinationOApp:address(0x211),destinationAdapter:address(0x212),independentDvn:address(0x301)
};
const signers=[0x401,0x402,0x403,0x404,0x405].map(address);
const delegates={source:address(0x501),destination:address(0x502)};

function publicManifest(networkAuditSha256,deployment=true){
  const rpc=(label,url,operatorFamily,digit)=>({label,url,operatorFamily,originSha256:digit.repeat(64)});
  return{
    schemaVersion:1,networkAuditSha256,
    source:{name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:3,contracts:{endpointV2:contracts.source.endpoint,sendUln302:contracts.source.send,executor:contracts.source.executor,deadDvn:contracts.source.dead},rpcs:[rpc("source-a","https://source-a.example/","operator-source-a","1"),rpc("source-b","https://source-b.example/","operator-source-b","2")]},
    destination:{name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:20,contracts:{endpointV2:contracts.destination.endpoint,receiveUln302:contracts.destination.receive,deadDvn:contracts.destination.dead},rpcs:[rpc("destination-a","https://destination-a.example/","operator-destination-a","3"),rpc("destination-b","https://destination-b.example/","operator-destination-b","4")]},
    deployment:deployment?{
      sourceOApp:{address:contracts.sourceOApp,deploymentTxHash:hash("1"),delegate:delegates.source},destinationOApp:{address:contracts.destinationOApp,deploymentTxHash:hash("2"),delegate:delegates.destination},
      sourceAdapter:{address:contracts.sourceAdapter,deploymentTxHash:hash("3")},destinationAdapter:{address:contracts.destinationAdapter,deploymentTxHash:hash("4")},authorizedSigners:[...signers],quorum:3
    }:null,
    confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
  };
}

function policyText(){return JSON.stringify({
  schemaVersion:1,toolVersion:"sentinel-pathway-auditor/v1",maximumProviderAuditAgeDays:30,
  networkConfig:"config/networks.json",networkAuditEvidence:"docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
  providerAudit:"config/rpc-provider-audit.json",dvnOperatorAudit:"config/dvn-operator-audit.json",
  pathway:{source:"ethereum-sepolia",destination:"arbitrum-sepolia"},
  officialRuntimeCodeKeccak256:{sourceEndpointV2:keccak256("0x6000"),sourceSendUln302:keccak256("0x6000"),sourceExecutor:keccak256("0x6000"),destinationEndpointV2:keccak256("0x6000"),destinationReceiveUln302:keccak256("0x6000")}
},null,2)+"\n"}

function providerAuditText(manifest){return JSON.stringify({
  schemaVersion:1,auditDate:"2026-08-02",status:"PROVIDER_OPERATORS_REVIEWED",
  providers:[...manifest.source.rpcs,...manifest.destination.rpcs].map(rpc=>({label:rpc.label,operatorFamily:rpc.operatorFamily,originSha256:rpc.originSha256,operatorEvidenceSha256:sha256(`review:${rpc.label}`),sources:[`review:${rpc.label}`]})),
  sources:["operator-review-2026-08-02"],warning:"Reviewed deterministic integration evidence."
},null,2)+"\n"}

function dvnAuditText(){const source="docs/research/reviewed-dvn-operators.md";return canonicalJson({
  schemaVersion:1,auditDate:"2026-08-03",status:"DVN_OPERATORS_REVIEWED",
  dvns:[
    {chain:"ethereum-sepolia",chainId:11155111,address:contracts.independentDvn,operatorFamily:"independent-dvn-a",operatorEvidenceSha256:"7".repeat(64),sources:[source]},
    {chain:"arbitrum-sepolia",chainId:421614,address:contracts.independentDvn,operatorFamily:"independent-dvn-a",operatorEvidenceSha256:"7".repeat(64),sources:[source]}
  ],sources:[source],warning:"Reviewed deterministic integration evidence."
})}

function header(number,chain){return{number:`0x${number.toString(16)}`,hash:hash(chain==="source"?"a":"b"),parentHash:hash("c"),stateRoot:hash("d"),transactionsRoot:hash("e"),timestamp:"0x6553f100"}}

function deploymentRecords(manifest,chain,artifacts){
  const entries=new Map(),isSource=chain==="source",network=contracts[chain];
  const add=(deployment,artifact,types,values)=>entries.set(deployment.deploymentTxHash,{
    transaction:{hash:deployment.deploymentTxHash,chainId:isSource?"0xaa36a7":"0x66eee",blockHash:isSource?hash("5"):hash("6"),blockNumber:isSource?"0x64":"0x96",from:isSource?address(0x601):address(0x602),to:null,input:`0x${artifact.evm.bytecode.object}${coder.encode(types,values).slice(2)}`},
    receipt:{transactionHash:deployment.deploymentTxHash,blockHash:isSource?hash("5"):hash("6"),blockNumber:isSource?"0x64":"0x96",status:"0x1",contractAddress:deployment.address},
    runtime:`0x${artifact.evm.deployedBytecode.object}`
  });
  const oapp=isSource?manifest.deployment.sourceOApp:manifest.deployment.destinationOApp;
  add(oapp,artifacts.oapp,["address","address"],[network.endpoint,oapp.delegate]);
  const adapter=isSource?manifest.deployment.sourceAdapter:manifest.deployment.destinationAdapter;
  add(adapter,artifacts.adapter,["address","address","uint32","address[]","uint256"],[network.send,network.receive,40231,signers,3n]);
  return entries;
}

function clientFixtures(manifest,artifacts){
  const calls=[];
  function pair(chain){
    const isSource=chain==="source",network=contracts[chain],selected=isSource?125:178,block=header(selected,chain);
    const uln=isSource?[15n,1,1,1,[contracts.independentDvn],[contracts.sourceAdapter]]:[64n,1,1,1,[contracts.independentDvn],[contracts.destinationAdapter]];
    const deployments=manifest.deployment?deploymentRecords(manifest,chain,artifacts):new Map();
    return manifest[chain].rpcs.map((rpc,index)=>({
      descriptor:()=>({label:rpc.label,originSha256:rpc.originSha256,operatorFamily:rpc.operatorFamily}),
      async call(method,params){
        calls.push({label:rpc.label,method,params:structuredClone(params)});
        if(method==="eth_chainId")return isSource?"0xaa36a7":"0x66eee";
        if(method==="eth_blockNumber")return isSource?"0x80":"0xc6";
        if(method==="eth_getBlockByNumber")return structuredClone(block);
        if(method==="eth_getTransactionByHash")return structuredClone(deployments.get(params[0])?.transaction);
        if(method==="eth_getTransactionReceipt")return structuredClone(deployments.get(params[0])?.receipt);
        if(method==="eth_getCode"){
          const target=lower(params[0]),record=[...deployments.values()].find(value=>lower(value.receipt.contractAddress)===target);
          return record?.runtime??"0x6000";
        }
        if(method==="eth_call")return callResult(isSource,network,uln,params[0].to,params[0].data);
        throw new Error(`forbidden ${method} ${index}`);
      }
    }));
  }
  const source=pair("source"),destination=pair("destination");
  return{calls,byLabel:new Map([...source,...destination].map(client=>[client.descriptor().label,client]))};
}

function callResult(isSource,network,uln,to,data){
  const target=lower(to);
  if(data.startsWith(endpointInterface.getFunction("getSendLibrary").selector))return endpointInterface.encodeFunctionResult("getSendLibrary",[contracts.source.send]);
  if(data.startsWith(endpointInterface.getFunction("isDefaultSendLibrary").selector))return endpointInterface.encodeFunctionResult("isDefaultSendLibrary",[false]);
  if(data.startsWith(endpointInterface.getFunction("getReceiveLibrary").selector))return endpointInterface.encodeFunctionResult("getReceiveLibrary",[contracts.destination.receive,false]);
  if(data.startsWith(ulnInterface.getFunction("isSupportedEid").selector))return ulnInterface.encodeFunctionResult("isSupportedEid",[true]);
  if(data.startsWith(ulnInterface.getFunction("getAppUlnConfig").selector))return ulnInterface.encodeFunctionResult("getAppUlnConfig",[uln]);
  if(data.startsWith(ulnInterface.getFunction("getUlnConfig").selector))return ulnInterface.encodeFunctionResult("getUlnConfig",[uln]);
  if(data.startsWith(ulnInterface.getFunction("executorConfigs").selector))return ulnInterface.encodeFunctionResult("executorConfigs",[10000,contracts.source.executor]);
  if(data.startsWith(oappInterface.getFunction("peers").selector))return oappInterface.encodeFunctionResult("peers",[peer(isSource?contracts.destinationOApp:contracts.sourceOApp)]);
  const adapter=lower(isSource?contracts.sourceAdapter:contracts.destinationAdapter);
  if(target===adapter&&data.startsWith(adapterInterface.getFunction("messageLib").selector))return adapterInterface.encodeFunctionResult("messageLib",[network.send]);
  if(target===adapter&&data.startsWith(adapterInterface.getFunction("verificationTarget").selector))return adapterInterface.encodeFunctionResult("verificationTarget",[network.receive]);
  if(target===adapter&&data.startsWith(adapterInterface.getFunction("supportedDstEid").selector))return adapterInterface.encodeFunctionResult("supportedDstEid",[40231]);
  if(target===adapter&&data.startsWith(adapterInterface.getFunction("quorum").selector))return adapterInterface.encodeFunctionResult("quorum",[3]);
  if(target===adapter&&data.startsWith(adapterInterface.getFunction("signer").selector))return adapterInterface.encodeFunctionResult("signer",[true]);
  throw new Error("unexpected eth_call");
}

async function fixture(deployment){
  const [networksText,networkAuditEvidenceText,adapterArtifactText,oappArtifactText,buildManifestText]=await Promise.all([
    readFile(join(root,"config/networks.json"),"utf8"),readFile(join(root,"docs/research/2026-08-02-layerzero-interface-conformance-audit.md"),"utf8"),
    readFile(join(root,"dist/contracts/SentinelDVNAdapter.json"),"utf8"),readFile(join(root,"dist/contracts/TreasuryPolicyOApp.json"),"utf8"),readFile(join(root,"dist/contracts/build-manifest.json"),"utf8")
  ]);
  const networkAuditSha256=sha256(canonicalJson({destination:"arbitrum-sepolia",networkAuditEvidenceSha256:sha256(networkAuditEvidenceText),networkConfigSha256:sha256(networksText),source:"ethereum-sepolia"}));
  const manifest=publicManifest(networkAuditSha256,deployment),manifestPath=join("/tmp",`sentinel-pathway-integration-${deployment?"deployed":"null"}.json`);
  const artifacts={adapter:JSON.parse(adapterArtifactText),oapp:JSON.parse(oappArtifactText)},clients=clientFixtures(manifest,artifacts);
  const files=new Map([
    [manifestPath,canonicalJson(manifest)],[join(root,"config/pathway-auditor.json"),policyText()],
    [join(root,"config/networks.json"),networksText],[join(root,"docs/research/2026-08-02-layerzero-interface-conformance-audit.md"),networkAuditEvidenceText],
    [join(root,"config/rpc-provider-audit.json"),providerAuditText(manifest)],[join(root,"config/dvn-operator-audit.json"),dvnAuditText()],
    [join(root,"dist/contracts/build-manifest.json"),buildManifestText],[join(root,"dist/contracts/SentinelDVNAdapter.json"),adapterArtifactText],[join(root,"dist/contracts/TreasuryPolicyOApp.json"),oappArtifactText]
  ]);
  return{manifestPath,clients,dependencies:{repositoryRoot:root,readText:async path=>{if(!files.has(path))throw new Error("unexpected path");return files.get(path)},now:()=>"2026-08-09T12:34:56.789Z",writeExclusive:writePathwayAuditFileExclusive,bind:bindPathwayAuditPolicy,createClient:endpoint=>clients.byLabel.get(endpoint.label),observe:observePathway,build:buildPathwayAuditBundle,encode:encodePathwayAuditBundle}};
}

function capture(){const stdout=[],stderr=[];return{stdout,stderr,io:{stdout:value=>stdout.push(value),stderr:value=>stderr.push(value)}}}

test("real policy, observer, bundle, and repository artifacts emit one consistent read-only bundle",async()=>{
  const setup=await fixture(true),result=capture();
  assert.equal(await runPathwayAuditCommand(["--manifest",setup.manifestPath],result.io,setup.dependencies),0,result.stderr.join(""));
  assert.equal(result.stdout.length,1);assert.deepEqual(result.stderr,[]);
  const artifact=parsePathwayAuditBundleText(result.stdout[0]);
  assert.equal(artifact.status,"OBSERVED_PATHWAY_CONSISTENT",JSON.stringify(artifact.blockers));
  assert.equal(artifact.truthLabel,"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED");
  assert.equal(encodePathwayAuditBundle(artifact),result.stdout[0]);
  assert.equal(setup.clients.calls.length>0,true);
  assert.equal(setup.clients.calls.some(call=>!new Set(["eth_chainId","eth_blockNumber","eth_getBlockByNumber","eth_getCode","eth_call","eth_getTransactionByHash","eth_getTransactionReceipt"]).has(call.method)),false);
});

test("the real pipeline emits a pathway-configuration blocker for a null deployment",async()=>{
  const setup=await fixture(false),result=capture();
  assert.equal(await runPathwayAuditCommand(["--manifest",setup.manifestPath],result.io,setup.dependencies),2,result.stderr.join(""));
  assert.deepEqual(result.stderr,[]);assert.equal(result.stdout.length,1);
  const artifact=parsePathwayAuditBundleText(result.stdout[0]);
  assert.equal(artifact.status,"BLOCKED_PATHWAY_CONFIGURATION");
  assert.deepEqual(artifact.blockers,[{code:"AUDIT_PATHWAY_DEPLOYMENTS_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"}]);
  assert.equal(setup.clients.calls.some(call=>call.method==="eth_call"||call.method==="eth_getTransactionByHash"||call.method==="eth_getTransactionReceipt"),false);
});
