import test from"node:test";
import assert from"node:assert/strict";
import{Wallet}from"ethers";
import{makeRecoveryProposal,recoveryProposalDigest,recoveryTypedData,validateRecoveryBundle}from"../../../dist/services/coordinator/src/recovery-proposal.js";

const a=n=>`0x${n.repeat(40)}`,h=n=>`0x${n.repeat(64)}`,b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`,zero=h("0");
const wallets=[6,7,8,9,10].map(value=>new Wallet(`0x${value.toString(16).padStart(64,"0")}`)).sort((left,right)=>left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
const operators=wallets.map(wallet=>wallet.address.toLowerCase());
const config={
  pathway:{sourceChainId:11155111,destinationChainId:421614,srcEid:40161,dstEid:40231,endpoint:a("1"),sendLibrary:a("2"),sourceOAppAddress:a("3"),sourceOApp:b("3"),destinationOApp:b("4"),sentinelDvn:a("5")},
  destination:{chainId:421614,oapp:a("4"),adapter:a("9"),receiveLibrary:a("8"),authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")]},
  genlayer:{policyContract:a("6")},
  recovery:{operators,quorum:3,minimumDelaySeconds:900,maximumLifetimeSeconds:3600}
};
const input={kind:"DESTINATION_CONFIRM",subject:h("1"),expectedState:"RECOVERY_REQUIRED",expectedFailureCode:"SUBMISSION_AMBIGUOUS",preconditionDigest:h("2"),candidateTransactionHash:h("3"),nonce:h("4"),preparedAt:100};
const proposal=makeRecoveryProposal(config,input);
const clone=value=>structuredClone(value);
async function approval(wallet,proposalValue=proposal,domainOverride){
  const typed=recoveryTypedData(config,proposalValue),signature=await wallet.signTypedData(domainOverride??typed.domain,typed.types,typed.value);
  return{address:wallet.address.toLowerCase(),signature};
}
async function bundle(proposalValue=proposal,selected=wallets.slice(0,3)){
  const approvals=await Promise.all(selected.map(wallet=>approval(wallet,proposalValue)));
  approvals.sort((left,right)=>left.address.localeCompare(right.address));
  return{proposal:proposalValue,approvals};
}

test("recovers exactly three authorized EIP-712 recovery operators",async()=>{
  assert.deepEqual(proposal,{version:1,...input,preparedAt:"100",executeAfter:"1000",expiresAt:"3700",deploymentDigest:"0x4ef274bd93298f58eef05c61dbddde76cb6c4b8e07b2d493353bd8a3d1f9156c"});
  assert.equal(recoveryProposalDigest(config,proposal),"0x3a679c16014dc0b3d3098396452b0665eb156f892453d9b55a00bda83c36bb67");
  const validated=validateRecoveryBundle(config,await bundle(),1000);
  assert.equal(validated.actionId,"0x3a679c16014dc0b3d3098396452b0665eb156f892453d9b55a00bda83c36bb67");
  assert.deepEqual(validated.approvals.map(value=>value.address),operators.slice(0,3));
});

test("rejects insufficient, duplicate, unordered, unauthorized and wrong-domain approvals",async()=>{
  const valid=await bundle();
  await assert.rejects(async()=>validateRecoveryBundle(config,{...valid,approvals:valid.approvals.slice(0,2)},1000),/approval/i);
  await assert.rejects(async()=>validateRecoveryBundle(config,{...valid,approvals:[valid.approvals[0],valid.approvals[0],valid.approvals[2]]},1000),/approval/i);
  await assert.rejects(async()=>validateRecoveryBundle(config,{...valid,approvals:[...valid.approvals].reverse()},1000),/approval/i);
  const outsider=new Wallet(`0x${"11".padStart(64,"0")}`),unauthorized=await bundle(proposal,[wallets[0],wallets[1],outsider]);
  await assert.rejects(async()=>validateRecoveryBundle(config,unauthorized,1000),/approval/i);
  const typed=recoveryTypedData(config,proposal),wrong=await approval(wallets[0],proposal,{...typed.domain,chainId:421615}),wrongDomain={...valid,approvals:[wrong,...valid.approvals.slice(1)].sort((left,right)=>left.address.localeCompare(right.address))};
  await assert.rejects(async()=>validateRecoveryBundle(config,wrongDomain,1000),/approval/i);
});

test("rejects altered, cross-deployment, premature, expired and noncanonical proposals",async()=>{
  const valid=await bundle(),mutations=[
    value=>value.proposal.subject=h("f"),
    value=>value.proposal.deploymentDigest=h("e"),
    value=>value.proposal.executeAfter="999",
    value=>value.proposal.expiresAt="1000",
    value=>value.proposal.extra=true
  ];
  for(const mutate of mutations){const value=clone(valid);mutate(value);assert.throws(()=>validateRecoveryBundle(config,value,1000));}
  assert.throws(()=>validateRecoveryBundle(config,valid,999),/ready|delay|time/i);
  assert.throws(()=>validateRecoveryBundle(config,valid,3700),/expired|time/i);
});

test("uses one strict schema for ingestion with a fixed zero candidate",async()=>{
  const ingestion=makeRecoveryProposal(config,{kind:"INGESTION_REQUEUE",subject:h("a"),expectedState:"DEAD",expectedFailureCode:"INGESTION_FAILED",preconditionDigest:h("b"),candidateTransactionHash:zero,nonce:h("c"),preparedAt:100});
  const validated=validateRecoveryBundle(config,await bundle(ingestion),1000);
  assert.equal(validated.proposal.candidateTransactionHash,zero);
  const wrongState=clone(await bundle(ingestion));wrongState.proposal.expectedState="RECOVERY_REQUIRED";
  assert.throws(()=>validateRecoveryBundle(config,wrongState,1000));
  const nonzeroCandidate=clone(await bundle(ingestion));nonzeroCandidate.proposal.candidateTransactionHash=h("d");
  assert.throws(()=>validateRecoveryBundle(config,nonzeroCandidate,1000));
});
