import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  createPathwayAuditFileController,
  parsePathwayAuditViewText,
  renderPathwayAudit,
  renderPathwayAuditUnavailable,
  validatePathwayAuditView
} from "../src/pathway-audit.js";
import {buildPathwayAuditBundle,encodePathwayAuditBundle} from "../../../dist/services/coordinator/src/pathway-audit-bundle.js";

const digest=digit=>digit.repeat(64);
const hash=digit=>`0x${digit.repeat(64)}`;
const address=value=>`0x${value.toString(16).padStart(40,"0")}`;
const canonical=value=>`${encode(value,new Set())}\n`;
const sha256=value=>createHash("sha256").update(value,"utf8").digest("hex");

function encode(value,active){
  if(value===null)return"null";
  if(typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"){if(!Number.isFinite(value))throw new Error("invalid fixture");return JSON.stringify(value)}
  if(!value||typeof value!=="object"||active.has(value))throw new Error("invalid fixture");
  active.add(value);
  try{
    if(Array.isArray(value))return`[${value.map(item=>encode(item,active)).join(",")}]`;
    return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${encode(value[key],active)}`).join(",")}}`;
  }finally{active.delete(value)}
}

function provider(label,digit){return{label,originSha256:digest(digit),operatorFamily:`operator-${label}`}}
const providers=(chain,a,b)=>[provider(`${chain}-a`,a),provider(`${chain}-b`,b)];
const pinnedBlock=(chainId,number,digit)=>({chainId:String(chainId),blockNumber:String(number),blockHash:hash(digit),parentHash:hash("c"),stateRoot:hash("d"),transactionsRoot:hash("e"),timestamp:"1710000000"});
const runtimeCode=(name,value,digit)=>({name,address:value,byteLength:2,runtimeCodeKeccak256:hash(digit),identity:"CODE_IDENTITY_REVIEWED"});
const uln=(confirmations,required,optional)=>({confirmations,requiredDvns:[required],optionalDvns:[optional],optionalDvnThreshold:1});
const observedAdapter=(value,library,target)=>({address:value,messageLib:library,verificationTarget:target,supportedDstEid:40231,quorum:"3",signersAuthorized:[true,true,true,true,true]});
const completeSource={endpoint:address(1),send:address(2),receive:address(3),executor:address(4),oapp:address(5),adapter:address(6),dvn:address(7)};
const completeDestination={endpoint:address(11),send:address(12),receive:address(13),oapp:address(14),adapter:address(15),dvn:completeSource.dvn};
const completeSigners=[21,22,23,24,25].map(address);

function completeDeployment(contractName,chainId,value,providerIdentities,digit,constructorArguments){
  return{contractName,chainId:String(chainId),address:value,deployer:address(chainId===11155111?31:32),providerIdentities:structuredClone(providerIdentities),deploymentTxHash:hash(digit),deploymentBlockNumber:"90",deploymentBlockHash:hash(chainId===11155111?"8":"9"),creationBytecodeSha256:digest("1"),deployedBytecodeSha256:digest("2"),immutableReferencesSha256:digest("3"),transactionInputSha256:digest("4"),runtimeCodeKeccak256:hash("5"),constructorArguments};
}

function completeObservation(){
  const sourceProviders=providers("source","1","2"),destinationProviders=providers("destination","3","4");
  const source={
    endpoint:completeSource.endpoint,sourceOApp:completeSource.oapp,dstEid:40231,sendLibrary:completeSource.send,isDefaultSendLibrary:false,supportedEid:true,
    uln:uln("15",completeSource.dvn,completeSource.adapter),
    dvnCodeKeccak256:[{address:completeSource.dvn,codeKeccak256:hash("6")},{address:completeSource.adapter,codeKeccak256:hash("5")}],
    executor:{maxMessageSize:10000,address:completeSource.executor},destinationPeer:`0x${"0".repeat(24)}${completeDestination.oapp.slice(2)}`,
    adapter:observedAdapter(completeSource.adapter,completeSource.send,completeSource.receive)
  };
  const destinationUln=uln("64",completeDestination.dvn,completeDestination.adapter);
  const destination={
    endpoint:completeDestination.endpoint,oapp:completeDestination.oapp,srcEid:40161,receiveLibrary:completeDestination.receive,isDefaultReceiveLibrary:false,supportedEid:true,
    rawAppUln:destinationUln,resolvedUln:structuredClone(destinationUln),sourcePeer:`0x${"0".repeat(24)}${completeSource.oapp.slice(2)}`,
    adapter:observedAdapter(completeDestination.adapter,completeDestination.send,completeDestination.receive)
  };
  return rebindComplete({
    status:"OBSERVED_PATHWAY_CONSISTENT",truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",repositoryBindingSha256:digest("a"),
    rpcIndependence:{source:"OPERATOR_INDEPENDENCE_REVIEWED",destination:"OPERATOR_INDEPENDENCE_REVIEWED"},
    providerAgreement:{source:{state:"TWO_TRANSPORTS_AGREE",providers:sourceProviders,resultSha256:digest("b")},destination:{state:"TWO_TRANSPORTS_AGREE",providers:destinationProviders,resultSha256:digest("c")}},
    blocks:{source:pinnedBlock(11155111,100,"a"),destination:pinnedBlock(421614,200,"b")},
    officialCode:{source:[runtimeCode("sourceEndpointV2",completeSource.endpoint,"1"),runtimeCode("sourceSendUln302",completeSource.send,"2"),runtimeCode("sourceExecutor",completeSource.executor,"3")],destination:[runtimeCode("destinationEndpointV2",completeDestination.endpoint,"4"),runtimeCode("destinationReceiveUln302",completeDestination.receive,"5")]},
    deployments:{
      sourceOApp:completeDeployment("TreasuryPolicyOApp",11155111,completeSource.oapp,sourceProviders,"1",{endpoint:completeSource.endpoint,delegate:address(41)}),
      destinationOApp:completeDeployment("TreasuryPolicyOApp",421614,completeDestination.oapp,destinationProviders,"2",{endpoint:completeDestination.endpoint,delegate:address(42)}),
      sourceAdapter:completeDeployment("SentinelDVNAdapter",11155111,completeSource.adapter,sourceProviders,"3",{messageLib:completeSource.send,verificationTarget:completeSource.receive,supportedDstEid:40231,signers:[...completeSigners],quorum:"3"}),
      destinationAdapter:completeDeployment("SentinelDVNAdapter",421614,completeDestination.adapter,destinationProviders,"4",{messageLib:completeDestination.send,verificationTarget:completeDestination.receive,supportedDstEid:40231,signers:[...completeSigners],quorum:"3"})
    },
    source,destination,configurationSha256:digest("d"),blockers:[]
  });
}

function rebindComplete(value){
  value.configurationSha256=value.source&&value.destination?sha256(canonical({destination:value.destination,source:value.source})):null;
  value.providerAgreement.source.resultSha256=value.blocks.source?sha256(canonical({block:value.blocks.source,deployments:value.deployments?{adapter:value.deployments.sourceAdapter,oapp:value.deployments.sourceOApp}:null,officialCode:value.officialCode.source,path:value.source})):null;
  value.providerAgreement.destination.resultSha256=value.blocks.destination?sha256(canonical({block:value.blocks.destination,deployments:value.deployments?{adapter:value.deployments.destinationAdapter,oapp:value.deployments.destinationOApp}:null,officialCode:value.officialCode.destination,path:value.destination})):null;
  return value;
}

function bundleBody(){
  return{
    schemaVersion:1,
    toolVersion:"sentinel-pathway-auditor/v1",
    runTimestamp:"2026-08-09T12:34:56.789Z",
    status:"BLOCKED_PATHWAY_CONFIGURATION",
    truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED",
    repositoryBindingSha256:digest("1"),
    rpcIndependence:{source:"OPERATOR_INDEPENDENCE_UNPROVEN",destination:"OPERATOR_INDEPENDENCE_UNPROVEN"},
    providerAgreement:{
      source:{state:"PROVIDER_DISAGREEMENT",providers:[provider("source-a","2"),provider("source-b","3")],resultSha256:null},
      destination:{state:"PROVIDER_DISAGREEMENT",providers:[provider("destination-a","4"),provider("destination-b","5")],resultSha256:null}
    },
    blocks:{source:null,destination:null},
    officialCode:{source:[],destination:[]},
    deployments:null,
    source:null,
    destination:null,
    configurationSha256:null,
    blockers:[{code:"AUDIT_PATHWAY_DEPLOYMENTS_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"}]
  };
}

function bindOuter(body){return{...body,evidenceSha256:sha256(canonical(body))}}
function validBundle(){return bindOuter(bundleBody())}
function mutate(value,change){const copy=structuredClone(value);change(copy);return copy}
function rebind(value){const copy=structuredClone(value);delete copy.evidenceSha256;return bindOuter(copy)}

function pathBoundBundle(){
  const body=bundleBody(),sourceDvn=address(6),sourceAdapter=address(7),destinationAdapter=address(8);
  body.source={
    endpoint:address(1),sourceOApp:address(2),dstEid:40231,sendLibrary:address(3),isDefaultSendLibrary:false,
    supportedEid:true,uln:{confirmations:"15",requiredDvns:[sourceDvn],optionalDvns:[sourceAdapter],optionalDvnThreshold:1},
    dvnCodeKeccak256:[{address:sourceDvn,codeKeccak256:hash("6")},{address:sourceAdapter,codeKeccak256:hash("7")}],
    executor:{maxMessageSize:10000,address:address(4)},destinationPeer:hash("8"),
    adapter:{address:sourceAdapter,messageLib:address(3),verificationTarget:address(5),supportedDstEid:40231,quorum:"3",signersAuthorized:[true,true,true,true,true]}
  };
  body.destination={
    endpoint:address(11),oapp:address(12),srcEid:40161,receiveLibrary:address(13),isDefaultReceiveLibrary:false,
    supportedEid:true,
    rawAppUln:{confirmations:"64",requiredDvns:[sourceDvn],optionalDvns:[destinationAdapter],optionalDvnThreshold:1},
    resolvedUln:{confirmations:"64",requiredDvns:[sourceDvn],optionalDvns:[destinationAdapter],optionalDvnThreshold:1},
    sourcePeer:hash("9"),
    adapter:{address:destinationAdapter,messageLib:address(14),verificationTarget:address(13),supportedDstEid:40231,quorum:"3",signersAuthorized:[true,true,true,true,true]}
  };
  body.configurationSha256=sha256(canonical({destination:body.destination,source:body.source}));
  return bindOuter(body);
}

function sourceBlockBundle(){
  const body=bundleBody();
  body.blocks.source={chainId:"11155111",blockNumber:"100",blockHash:hash("a"),parentHash:hash("b"),stateRoot:hash("c"),transactionsRoot:hash("d"),timestamp:"1710000000"};
  body.providerAgreement.source.resultSha256=sha256(canonical({block:body.blocks.source,deployments:null,officialCode:[],path:null}));
  return bindOuter(body);
}

test("accepts a canonical blocked artifact and returns only the public presentation model",async()=>{
  const view=await validatePathwayAuditView(validBundle());
  assert.deepEqual(Object.keys(view),[
    "schemaVersion","toolVersion","runTimestamp","status","truthLabel","repositoryBindingSha256",
    "rpcIndependence","providerAgreement","blocks","pathway","configurationSha256","blockers","evidenceSha256"
  ]);
  assert.equal(view.truthLabel,"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED");
  assert.equal(view.status,"BLOCKED_PATHWAY_CONFIGURATION");
  assert.deepEqual(view.blockers.map(item=>item.code),["AUDIT_PATHWAY_DEPLOYMENTS_MISSING"]);
  assert.equal(view.providerAgreement.source.providers,undefined);
  assert.equal(view.pathway.source,null);
  assert.equal(JSON.stringify(view).includes("transactionInput"),false);
});

test("accepts path-bound evidence only when the configuration digest is recomputed",async()=>{
  const artifact=pathBoundBundle();
  const view=await validatePathwayAuditView(artifact);
  assert.equal(view.configurationSha256,artifact.configurationSha256);
  assert.deepEqual(view.pathway.source,{chainId:"11155111",eid:40161,remoteEid:40231,oapp:address(2),adapter:address(7),library:address(3)});
  assert.deepEqual(view.pathway.destination,{chainId:"421614",eid:40231,remoteEid:40161,oapp:address(12),adapter:address(8),library:address(13)});
  await assert.rejects(validatePathwayAuditView(bindOuter(mutate(artifact,copy=>{delete copy.evidenceSha256;copy.configurationSha256=digest("f")}))),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
});

test("recomputes provider and outer evidence digests instead of trusting supplied hashes",async()=>{
  const artifact=sourceBlockBundle();
  await validatePathwayAuditView(artifact);
  const badInner=mutate(artifact,copy=>{copy.providerAgreement.source.resultSha256=digest("e");delete copy.evidenceSha256});
  await assert.rejects(validatePathwayAuditView(bindOuter(badInner)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
  await assert.rejects(validatePathwayAuditView({...artifact,evidenceSha256:digest("f")}),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
});

test("rejects noncanonical text before returning a view",async()=>{
  const artifact=validBundle(),text=canonical(artifact);
  assert.deepEqual(await parsePathwayAuditViewText(text),await validatePathwayAuditView(artifact));
  await assert.rejects(parsePathwayAuditViewText(JSON.stringify(artifact)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
  await assert.rejects(parsePathwayAuditViewText(` ${text}`),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
  await assert.rejects(parsePathwayAuditViewText(text.replace('"blockers"','"blockers"').replace(/\}\n$/,',"status":"BLOCKED_PATHWAY_CONFIGURATION"}\n')),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
});

test("rejects wrong truth, blocker definitions, order, duplicates, and status precedence",async()=>{
  const cases=[
    mutate(validBundle(),copy=>{copy.truthLabel="DEPLOYED"}),
    mutate(validBundle(),copy=>{copy.status="OBSERVED_PATHWAY_CONSISTENT"}),
    mutate(validBundle(),copy=>{copy.blockers[0].category="RPC_CONSENSUS"}),
    mutate(validBundle(),copy=>{copy.blockers.push(structuredClone(copy.blockers[0]))}),
    mutate(validBundle(),copy=>{copy.blockers=[
      {code:"AUDIT_PATHWAY_DEPLOYMENTS_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"},
      {code:"AUDIT_RPC_UNAVAILABLE",category:"RPC_CONSENSUS",remediation:"REPLACE_RPC_TRANSPORT"}
    ];copy.status="BLOCKED_PATHWAY_CONFIGURATION"}),
    mutate(validBundle(),copy=>{copy.blockers=[
      {code:"AUDIT_RPC_UNAVAILABLE",category:"RPC_CONSENSUS",remediation:"REPLACE_RPC_TRANSPORT"},
      {code:"AUDIT_PATHWAY_DEPLOYMENTS_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"}
    ];copy.status="BLOCKED_RPC_CONSENSUS"})
  ];
  for(const value of cases)await assert.rejects(validatePathwayAuditView(rebind(value)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
});

test("rejects malformed digests, hashes, addresses, decimals, and timestamps",async()=>{
  const badAddress=mutate(validBundle(),copy=>{copy.officialCode.source=[{name:"sourceEndpointV2",address:"0x1234",byteLength:2,runtimeCodeKeccak256:hash("a"),identity:"CODE_IDENTITY_REVIEWED"}]}),
    badDecimal=mutate(sourceBlockBundle(),copy=>{copy.blocks.source.blockNumber="01";copy.providerAgreement.source.resultSha256=sha256(canonical({block:copy.blocks.source,deployments:null,officialCode:[],path:null}))}),
    badHash=mutate(sourceBlockBundle(),copy=>{copy.blocks.source.blockHash="0x1234";copy.providerAgreement.source.resultSha256=sha256(canonical({block:copy.blocks.source,deployments:null,officialCode:[],path:null}))});
  for(const value of[
    mutate(validBundle(),copy=>{copy.repositoryBindingSha256="ABC"}),badAddress,badDecimal,badHash,
    mutate(validBundle(),copy=>{copy.runTimestamp="2026-08-09"})
  ])await assert.rejects(validatePathwayAuditView(rebind(value)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
});

test("accepts lowercase or EIP-55 addresses and rejects incorrect mixed-case checksums",async()=>{
  const code=addressValue=>({name:"sourceEndpointV2",address:addressValue,byteLength:2,runtimeCodeKeccak256:hash("a"),identity:"CODE_IDENTITY_REVIEWED"});
  const checksummed=validBundle();checksummed.officialCode.source=[code("0x6EDCE65403992e310A62460808c4b910D972f10f")];
  await validatePathwayAuditView(rebind(checksummed));
  const wrong=validBundle();wrong.officialCode.source=[code("0x6eDCE65403992e310A62460808c4b910D972f10f")];
  await assert.rejects(validatePathwayAuditView(rebind(wrong)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
});

test("accepts a real server-encoded complete artifact and rejects re-digested consistency contradictions",async()=>{
  const serverBundle=buildPathwayAuditBundle({observation:completeObservation(),runTimestamp:"2026-08-09T12:34:56.789Z"});
  const view=await parsePathwayAuditViewText(encodePathwayAuditBundle(serverBundle));
  assert.equal(view.status,"OBSERVED_PATHWAY_CONSISTENT");
  assert.deepEqual(view.blockers,[]);
  assert.notEqual(view.configurationSha256,null);
  assert.notEqual(view.pathway.source,null);assert.notEqual(view.pathway.destination,null);
  const contradictions=[
    value=>{value.providerAgreement.source.providers[1].label=value.providerAgreement.source.providers[0].label},
    value=>{value.deployments.sourceOApp.address=address(50)},
    value=>{value.source.uln.confirmations="16"},
    value=>{value.source.destinationPeer=hash("f")},
    value=>{value.deployments.sourceAdapter.constructorArguments.signers[0]=address(20)},
    value=>{value.source.dvnCodeKeccak256[1].codeKeccak256=hash("f")},
    value=>{value.deployments.sourceOApp.deploymentBlockNumber="101"}
  ];
  for(const contradict of contradictions){
    const artifact=structuredClone(serverBundle);contradict(artifact);rebindComplete(artifact);delete artifact.evidenceSha256;
    await assert.rejects(validatePathwayAuditView(bindOuter(artifact)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
  }
});

test("recursively refuses URL, raw transaction, secret, filesystem, packet, GenLayer, signer-share, and execution fields",async()=>{
  const forbidden=[
    ["rpcUrl","https://rpc.example"],["url","https://example"],["transactionInput","0x1234"],
    ["privateKey","0xsecret"],["databasePath","/private/state.db"],["packetGuid",hash("a")],
    ["genLayerDecision","ALLOW"],["signerShares",[]],["executionState","EXECUTED"]
  ];
  for(const[key,value]of forbidden){
    const artifact=validBundle();artifact.providerAgreement.source.providers[0][key]=value;
    await assert.rejects(validatePathwayAuditView(rebind(artifact)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/,key);
  }
});

test("rejects unknown fields, accessors, custom prototypes, symbols, sparse arrays, and cycles",async()=>{
  const unknown=validBundle();unknown.unexpected=true;
  const accessor=validBundle();Object.defineProperty(accessor,"unexpected",{get(){throw new Error("getter executed")},enumerable:true});
  const prototype=Object.assign(Object.create({polluted:true}),validBundle());
  const symbol=validBundle();symbol[Symbol("secret")]=true;
  const sparse=validBundle();sparse.blockers=new Array(1);
  const cycle=validBundle();cycle.providerAgreement.source.loop=cycle;
  await assert.rejects(validatePathwayAuditView(rebind(unknown)),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
  for(const value of[accessor,prototype,symbol,sparse,cycle]){
    await assert.rejects(validatePathwayAuditView(value),/PATHWAY_AUDIT_ARTIFACT_REJECTED/);
  }
});

test("rejects every array own key outside length and the exact dense index range",async()=>{
  for(const key of["4294967295","5","999999999999999999999999999999999999999999999999"]){
    const artifact=validBundle();
    Object.defineProperty(artifact.blockers,key,{value:{smuggled:true},enumerable:true,configurable:true,writable:true});
    await assert.rejects(validatePathwayAuditView(artifact),/PATHWAY_AUDIT_ARTIFACT_REJECTED/,key);
  }
});

function fakeElement(initial="stale"){
  const writes=[];
  return{
    writes,
    get textContent(){return writes.at(-1)??initial},
    set textContent(value){writes.push(String(value))},
    set innerHTML(_value){throw new Error("innerHTML must not be used")}
  };
}

function renderElements(){return Object.fromEntries(["status","truthLabel","observedAt","evidenceDigest","configurationDigest","sourceBlock","destinationBlock","blockers","notice"].map(key=>[key,fakeElement()]))}

test("renders the allowlisted view and unavailable state with textContent only",async()=>{
  const elements=renderElements(),view=await validatePathwayAuditView(validBundle());
  renderPathwayAudit(elements,view,value=>`formatted:${value}`);
  assert.equal(elements.status.textContent,"BLOCKED_PATHWAY_CONFIGURATION");
  assert.equal(elements.observedAt.textContent,"formatted:2026-08-09T12:34:56.789Z");
  assert.equal(elements.blockers.textContent,"AUDIT_PATHWAY_DEPLOYMENTS_MISSING · SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE");
  renderPathwayAuditUnavailable(elements,"ARTIFACT REJECTED");
  assert.equal(elements.status.textContent,"NOT OBSERVED");
  assert.equal(elements.notice.textContent,"ARTIFACT REJECTED");
  for(const[key,element]of Object.entries(elements))if(key!=="status"&&key!=="notice")assert.equal(element.textContent,"");
});

function fakeTarget(){
  const listeners=new Map();
  return{
    files:[],disabled:false,value:"selected",
    addEventListener(type,listener){listeners.set(type,listener)},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type)},
    async emit(type){return listeners.get(type)?.({type})},
    listenerCount(){return listeners.size}
  };
}

test("inspects exactly one local File in memory without fetches or storage writes",async(t)=>{
  const previous={fetch:globalThis.fetch,localStorage:Object.getOwnPropertyDescriptor(globalThis,"localStorage"),sessionStorage:Object.getOwnPropertyDescriptor(globalThis,"sessionStorage")};
  let fetchCalls=0,localStorageWrites=0,sessionStorageWrites=0,fileTextCalls=0,releaseText;
  const textGate=new Promise(resolve=>{releaseText=resolve});
  globalThis.fetch=async()=>{fetchCalls++;throw new Error("network forbidden")};
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{setItem(){localStorageWrites++}}});
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{setItem(){sessionStorageWrites++}}});
  t.after(()=>{
    globalThis.fetch=previous.fetch;
    for(const[key,descriptor]of[["localStorage",previous.localStorage],["sessionStorage",previous.sessionStorage]]){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  });
  const fileInput=fakeTarget(),inspectButton=fakeTarget(),status=fakeElement("NOT OBSERVED"),elements=renderElements();
  const file={text:async()=>{fileTextCalls++;await textGate;return canonical(validBundle())}};
  const controller=createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime:value=>value});
  assert.equal(inspectButton.disabled,true);
  fileInput.files=[file];await fileInput.emit("change");
  assert.equal(inspectButton.disabled,false);assert.equal(status.textContent,"READY TO INSPECT");
  const firstInspection=inspectButton.emit("click"),duplicateInspection=inspectButton.emit("click");
  assert.equal(fileTextCalls,1);releaseText();await Promise.all([firstInspection,duplicateInspection]);
  assert.equal(elements.status.textContent,"BLOCKED_PATHWAY_CONFIGURATION");
  assert.equal(inspectButton.disabled,true);assert.equal(fileInput.value,"");
  await inspectButton.emit("click");
  assert.equal(fileTextCalls,1);assert.equal(fetchCalls,0);assert.equal(localStorageWrites,0);assert.equal(sessionStorageWrites,0);
  controller.dispose();assert.equal(fileInput.listenerCount(),0);assert.equal(inspectButton.listenerCount(),0);
});

test("rejects invalid local files with a fixed message and forgets the File",async()=>{
  let calls=0;
  const fileInput=fakeTarget(),inspectButton=fakeTarget(),status=fakeElement("NOT OBSERVED"),elements=renderElements();
  fileInput.files=[{text:async()=>{calls++;return'{"attacker":"<img src=x onerror=alert(1)>"}'}}];
  const controller=createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime:value=>value});
  await fileInput.emit("change");await inspectButton.emit("click");await inspectButton.emit("click");
  assert.equal(calls,1);assert.equal(elements.status.textContent,"NOT OBSERVED");assert.equal(elements.notice.textContent,"ARTIFACT REJECTED");
  assert.equal(Object.values(elements).some(element=>element.textContent.includes("attacker")||element.textContent.includes("img")),false);
  controller.dispose();
});

test("preserves every validated evidence field when a later artifact is rejected",async()=>{
  const fileInput=fakeTarget(),inspectButton=fakeTarget(),status=fakeElement("NOT OBSERVED"),elements=renderElements();
  const controller=createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime:value=>`formatted:${value}`});
  fileInput.files=[{text:async()=>canonical(validBundle())}];
  await fileInput.emit("change");await inspectButton.emit("click");
  assert.equal(status.textContent,"INSPECTED LOCALLY");
  const validated=Object.fromEntries(Object.entries(elements).filter(([key])=>key!=="notice").map(([key,element])=>[key,element.textContent]));
  assert.equal(elements.notice.textContent,"VERIFIED LOCALLY · NOTHING UPLOADED");

  fileInput.files=[{text:async()=>'{"attacker":"<img src=x onerror=alert(1)>"}'}];
  await fileInput.emit("change");await inspectButton.emit("click");
  assert.equal(status.textContent,"ARTIFACT REJECTED");
  assert.equal(elements.notice.textContent,"ARTIFACT REJECTED");
  for(const[key,value]of Object.entries(validated))assert.equal(elements[key].textContent,value,key);
  assert.equal(Object.values(elements).some(element=>element.textContent.includes("attacker")||element.textContent.includes("img")),false);
  controller.dispose();
});

test("ignores reselection while inspection is busy and never starts a second File read",async()=>{
  let releaseA,readsA=0,readsB=0;
  const gate=new Promise(resolve=>{releaseA=resolve}),fileInput=fakeTarget(),inspectButton=fakeTarget(),status=fakeElement("NOT OBSERVED"),elements=renderElements();
  const artifactA=validBundle(),fileA={text:async()=>{readsA++;await gate;return canonical(artifactA)}},fileB={text:async()=>{readsB++;return canonical(validBundle())}};
  const controller=createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime:value=>value});
  fileInput.files=[fileA];await fileInput.emit("change");
  const inspection=inspectButton.emit("click");
  fileInput.files=[fileB];fileInput.value="selected-b";await fileInput.emit("change");await inspectButton.emit("click");
  assert.equal(status.textContent,"INSPECTION IN PROGRESS");assert.equal(inspectButton.disabled,true);assert.equal(fileInput.value,"");
  assert.equal(readsA,1);assert.equal(readsB,0);
  releaseA();await inspection;
  assert.equal(elements.evidenceDigest.textContent,artifactA.evidenceSha256);assert.equal(status.textContent,"INSPECTED LOCALLY");
  controller.dispose();
});

test("dispose invalidates a pending File read and prevents post-dispose rendering",async()=>{
  let release,reads=0;
  const gate=new Promise(resolve=>{release=resolve}),fileInput=fakeTarget(),inspectButton=fakeTarget(),status=fakeElement("NOT OBSERVED"),elements=renderElements();
  const controller=createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime:value=>value});
  fileInput.files=[{text:async()=>{reads++;await gate;return canonical(validBundle())}}];await fileInput.emit("change");
  const inspection=inspectButton.emit("click");controller.dispose();release();await inspection;
  assert.equal(reads,1);for(const element of Object.values(elements))assert.deepEqual(element.writes,[]);
});

test("dispose invalidates pending digest validation and prevents post-dispose rendering",async(t)=>{
  const subtle=globalThis.crypto.subtle,originalDigest=subtle.digest.bind(subtle);
  let releaseDigest,markStarted,digestCalls=0;
  const gate=new Promise(resolve=>{releaseDigest=resolve}),started=new Promise(resolve=>{markStarted=resolve});
  subtle.digest=async(...arguments_)=>{digestCalls++;markStarted();await gate;return originalDigest(...arguments_)};
  t.after(()=>{subtle.digest=originalDigest});
  const fileInput=fakeTarget(),inspectButton=fakeTarget(),status=fakeElement("NOT OBSERVED"),elements=renderElements();
  const controller=createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime:value=>value});
  fileInput.files=[{text:async()=>canonical(validBundle())}];await fileInput.emit("change");
  const inspection=inspectButton.emit("click");await started;controller.dispose();releaseDigest();await inspection;
  assert.equal(digestCalls,1);for(const element of Object.values(elements))assert.deepEqual(element.writes,[]);
});
