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
