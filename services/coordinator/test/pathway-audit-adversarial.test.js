import test from"node:test";
import assert from"node:assert/strict";
import{evaluatePathwayInvariants}from"../../../dist/services/coordinator/src/pathway-audit-observer.js";

const address=value=>`0x${value.toString(16).padStart(40,"0")}`;
const peer=value=>`0x${"0".repeat(24)}${value.slice(2)}`;
const source={endpoint:address(1),send:address(2),executor:address(3),dead:address(4),receive:address(5),oapp:address(6),adapter:address(7)};
const destination={endpoint:address(11),send:address(12),executor:address(13),dead:address(14),receive:address(15),oapp:address(16),adapter:address(17)};
const independent=address(20),otherIndependent=address(21);
const signers=[31,32,33,34,35].map(address);

function manifest(){
  return{
    source:{chainId:11155111,eid:40161,contracts:{endpointV2:source.endpoint,sendUln302:source.send,executor:source.executor,deadDvn:source.dead}},
    destination:{chainId:421614,eid:40231,contracts:{endpointV2:destination.endpoint,receiveUln302:destination.receive,deadDvn:destination.dead}},
    deployment:{
      sourceOApp:{address:source.oapp,delegate:address(40)},destinationOApp:{address:destination.oapp,delegate:address(41)},
      sourceAdapter:{address:source.adapter},destinationAdapter:{address:destination.adapter},authorizedSigners:[...signers],quorum:3
    },
    confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"}
  };
}

function binding(){
  const dvnSource="docs/research/reviewed-dvn-operators.md";
  return{
    network:{
      source:{contracts:{endpointV2:source.endpoint,sendUln302:source.send,receiveUln302:source.receive,executor:source.executor,deadDvn:source.dead}},
      destination:{contracts:{endpointV2:destination.endpoint,sendUln302:destination.send,receiveUln302:destination.receive,executor:destination.executor,deadDvn:destination.dead}}
    },
    reviewedDvns:{
      source:[{chain:"ethereum-sepolia",chainId:11155111,address:independent,operatorFamily:"independent-dvn-a",operatorEvidenceSha256:"7".repeat(64),sources:[dvnSource]}],
      destination:[{chain:"arbitrum-sepolia",chainId:421614,address:independent,operatorFamily:"independent-dvn-a",operatorEvidenceSha256:"7".repeat(64),sources:[dvnSource]}]
    },
    blockers:[]
  };
}

function uln(confirmations,adapter){return{confirmations:String(confirmations),requiredDvns:[independent],optionalDvns:[adapter],optionalDvnThreshold:1}}
function adapter(value,network){return{address:value,messageLib:network.send,verificationTarget:network.receive,supportedDstEid:40231,quorum:"3",signersAuthorized:[true,true,true,true,true]}}

function evidence(){
  return{
    sourceOApp:{constructorArguments:{endpoint:source.endpoint,delegate:address(40)}},
    destinationOApp:{constructorArguments:{endpoint:destination.endpoint,delegate:address(41)}},
    sourceAdapter:{constructorArguments:{messageLib:source.send,verificationTarget:source.receive,supportedDstEid:40231,signers:[...signers],quorum:"3"}},
    destinationAdapter:{constructorArguments:{messageLib:destination.send,verificationTarget:destination.receive,supportedDstEid:40231,signers:[...signers],quorum:"3"}}
  };
}

function observations(){
  return{
    source:{
      endpoint:source.endpoint,sourceOApp:source.oapp,dstEid:40231,sendLibrary:source.send,isDefaultSendLibrary:false,supportedEid:true,
      uln:uln(15,source.adapter),dvnCodeKeccak256:[],executor:{maxMessageSize:10000,address:source.executor},
      destinationPeer:peer(destination.oapp),adapter:adapter(source.adapter,source)
    },
    destination:{
      endpoint:destination.endpoint,oapp:destination.oapp,srcEid:40161,receiveLibrary:destination.receive,isDefaultReceiveLibrary:false,supportedEid:true,
      rawAppUln:uln(64,destination.adapter),resolvedUln:uln(64,destination.adapter),sourcePeer:peer(source.oapp),
      adapter:adapter(destination.adapter,destination)
    }
  };
}

function setup(){const paths=observations();return{manifest:manifest(),policyBinding:binding(),source:paths.source,destination:paths.destination,deployments:evidence()}}
function mutateBoth(input,field,value){input.source.uln[field]=structuredClone(value);input.destination.rawAppUln[field]=structuredClone(value);input.destination.resolvedUln[field]=structuredClone(value)}

test("the pure evaluator accepts only the explicit optional-Sentinel, independent-DVN, exact 3-of-5 posture",()=>{
  const result=evaluatePathwayInvariants(setup());
  assert.deepEqual(result,{status:"OBSERVED_PATHWAY_CONSISTENT",blockers:[]});
});

test("configuration mutations produce their exact stable blocker category and never a consistency claim",async t=>{
  const cases=[
    ["unexpected source send library","AUDIT_ULN_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.source.sendLibrary=address(98)}],
    ["unexpected destination receive library","AUDIT_ULN_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.destination.receiveLibrary=address(98)}],
    ["unexpected source adapter message library","AUDIT_ADAPTER_BINDING_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.source.adapter.messageLib=address(99)}],
    ["unexpected destination adapter target","AUDIT_ADAPTER_BINDING_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.destination.adapter.verificationTarget=address(99)}],
    ["unexpected adapter EID","AUDIT_ADAPTER_BINDING_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.source.adapter.supportedDstEid=40161}],
    ["default library","AUDIT_DEFAULT_LIBRARY","PATHWAY_CONFIGURATION",input=>{input.source.isDefaultSendLibrary=true}],
    ["inherited zero ULN","AUDIT_INHERITED_ULN_CONFIG","PATHWAY_CONFIGURATION",input=>{input.destination.rawAppUln={confirmations:"0",requiredDvns:[],optionalDvns:[],optionalDvnThreshold:0}}],
    ["unsupported EID","AUDIT_UNSUPPORTED_EID","PATHWAY_CONFIGURATION",input=>{input.destination.supportedEid=false}],
    ["peer mismatch","AUDIT_PEER_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.source.destinationPeer=peer(address(99))}],
    ["Executor mismatch","AUDIT_EXECUTOR_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.source.executor.address=address(99)}],
    ["source confirmation mismatch","AUDIT_ULN_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.source.uln.confirmations="16"}],
    ["Dead DVN in a required list","AUDIT_DEAD_DVN_PRESENT","PATHWAY_CONFIGURATION",input=>{input.source.uln.requiredDvns=[source.dead]}],
    ["Dead DVN in an optional list","AUDIT_DEAD_DVN_PRESENT","PATHWAY_CONFIGURATION",input=>{input.destination.rawAppUln.optionalDvns=[destination.adapter,destination.dead].sort();input.destination.resolvedUln=structuredClone(input.destination.rawAppUln)}],
    ["duplicated DVNs","AUDIT_DVN_ORDER_INVALID","PATHWAY_CONFIGURATION",input=>{input.source.uln.requiredDvns=[independent,independent]}],
    ["unsorted DVNs","AUDIT_DVN_ORDER_INVALID","PATHWAY_CONFIGURATION",input=>{input.source.uln.requiredDvns=[otherIndependent,independent]}],
    ["threshold zero with optional DVNs","AUDIT_DVN_THRESHOLD_INVALID","PATHWAY_CONFIGURATION",input=>mutateBoth(input,"optionalDvnThreshold",0)],
    ["threshold above optional count","AUDIT_DVN_THRESHOLD_INVALID","PATHWAY_CONFIGURATION",input=>mutateBoth(input,"optionalDvnThreshold",2)],
    ["source and destination ULN mismatch","AUDIT_ULN_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.destination.rawAppUln.requiredDvns=[otherIndependent];input.destination.resolvedUln.requiredDvns=[otherIndependent]}],
    ["Sentinel absent","AUDIT_SENTINEL_NOT_OPTIONAL","PATHWAY_CONFIGURATION",input=>{input.source.uln.optionalDvns=[otherIndependent];input.destination.rawAppUln.optionalDvns=[otherIndependent];input.destination.resolvedUln.optionalDvns=[otherIndependent]}],
    ["Sentinel required","AUDIT_SENTINEL_NOT_OPTIONAL","PATHWAY_CONFIGURATION",input=>{input.source.uln.requiredDvns=[independent,source.adapter].sort();input.source.uln.optionalDvns=[];input.source.uln.optionalDvnThreshold=0}],
    ["Sentinel sole effective verifier","AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER","PATHWAY_CONFIGURATION",input=>{input.source.uln.requiredDvns=[];input.destination.rawAppUln.requiredDvns=[];input.destination.resolvedUln.requiredDvns=[]}],
    ["one unauthorized signer","AUDIT_SIGNER_MEMBERSHIP_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.destination.adapter.signersAuthorized[2]=false}],
    ["constructor and mapping membership conflict","AUDIT_SIGNER_MEMBERSHIP_MISMATCH","PATHWAY_CONFIGURATION",input=>{input.deployments.sourceAdapter.constructorArguments.signers[4]=address(99)}]
  ];
  for(const[name,code,category,mutate]of cases)await t.test(name,()=>{
    const input=setup();mutate(input);
    const result=evaluatePathwayInvariants(input);
    assert.notEqual(result.status,"OBSERVED_PATHWAY_CONSISTENT");
    const blockers=result.blockers.filter(blocker=>blocker.code===code);
    assert.deepEqual(blockers,[{code,category,remediation:remediation(code)}],JSON.stringify(result.blockers));
  });
});

test("an arbitrary second optional DVN cannot substitute for repository-reviewed independent identity",()=>{
  const input=setup();
  input.source.uln={confirmations:"15",requiredDvns:[],optionalDvns:[source.adapter,otherIndependent].sort(),optionalDvnThreshold:2};
  input.destination.rawAppUln={confirmations:"64",requiredDvns:[],optionalDvns:[destination.adapter,otherIndependent].sort(),optionalDvnThreshold:2};
  input.destination.resolvedUln=structuredClone(input.destination.rawAppUln);
  const result=evaluatePathwayInvariants(input);
  assert.notEqual(result.status,"OBSERVED_PATHWAY_CONSISTENT");
  assert.deepEqual(result.blockers.filter(value=>value.code==="AUDIT_DVN_REVIEW_MISSING"),[
    {code:"AUDIT_DVN_REVIEW_MISSING",category:"PATHWAY_CONFIGURATION",remediation:"SELECT_INDEPENDENT_DVNS"}
  ]);
});

test("direct null invariant input is fail-closed even when a deployment manifest exists",()=>{
  const input=setup();input.source=null;input.destination=null;input.deployments=null;
  const result=evaluatePathwayInvariants(input);
  assert.notEqual(result.status,"OBSERVED_PATHWAY_CONSISTENT");
  assert.equal(result.blockers.length>0,true);
  assert.equal(result.blockers.some(value=>value.code==="AUDIT_DEPLOYMENT_EVIDENCE_MISSING"),true);
});

test("earlier hardened policy blockers are preserved and retain status precedence",()=>{
  const input=setup(),policy={code:"AUDIT_PROVIDER_EVIDENCE_MISSING",category:"RPC_INDEPENDENCE",remediation:"REVIEW_RPC_OPERATORS"};
  input.policyBinding.blockers=[policy];
  const result=evaluatePathwayInvariants(input);
  assert.equal(result.status,"BLOCKED_RPC_INDEPENDENCE");
  assert.deepEqual(result.blockers,[policy]);
});

function remediation(code){
  return{
    AUDIT_ADAPTER_BINDING_MISMATCH:"CORRECT_ADAPTER_BINDINGS",AUDIT_DEFAULT_LIBRARY:"CONFIGURE_EXPLICIT_LIBRARIES",
    AUDIT_INHERITED_ULN_CONFIG:"CONFIGURE_EXPLICIT_LIBRARIES",AUDIT_UNSUPPORTED_EID:"CONFIGURE_MATCHING_ULN",
    AUDIT_PEER_MISMATCH:"CORRECT_PEERS",AUDIT_EXECUTOR_MISMATCH:"CORRECT_EXECUTOR",AUDIT_ULN_MISMATCH:"CONFIGURE_MATCHING_ULN",
    AUDIT_DEAD_DVN_PRESENT:"REMOVE_DEAD_DVN",AUDIT_DVN_ORDER_INVALID:"SELECT_INDEPENDENT_DVNS",
    AUDIT_DVN_THRESHOLD_INVALID:"SELECT_INDEPENDENT_DVNS",AUDIT_SENTINEL_NOT_OPTIONAL:"CONFIGURE_SENTINEL_OPTIONAL",
    AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER:"SELECT_INDEPENDENT_DVNS",AUDIT_SIGNER_MEMBERSHIP_MISMATCH:"CORRECT_SIGNER_MEMBERSHIP"
  }[code];
}
