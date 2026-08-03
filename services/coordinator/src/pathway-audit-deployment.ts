import{createHash}from"node:crypto";
import{AbiCoder,getAddress,keccak256}from"ethers";
import{canonicalJson,parseJsonDocument}from"./canonical-json.js";
import{eip1898,type PinnedBlockObservation}from"./pathway-audit-block.js";
import{PathwayAuditError}from"./pathway-audit-model.js";
import type{ReadOnlyRpcClient}from"./read-only-json-rpc.js";

export type AuditContractName="SentinelDVNAdapter"|"TreasuryPolicyOApp";
export interface AuditConstructorInput{internalType:string;name:string;type:string}
export interface AuditImmutableReference{start:number;length:number}
export interface AuditContractArtifact{
  name:AuditContractName;
  constructorInputs:AuditConstructorInput[];
  creationBytecode:string;
  deployedBytecode:string;
  immutableReferences:Record<string,AuditImmutableReference[]>;
  abiSha256:string;
  creationBytecodeSha256:string;
  deployedBytecodeSha256:string;
  immutableReferencesSha256:string;
}

export interface AuditOAppDeployment{address:string;deploymentTxHash:string;delegate:string}
export interface AuditAdapterDeployment{address:string;deploymentTxHash:string}
export interface AuditOAppExpectation{endpoint:string}
export interface AuditAdapterExpectation{
  messageLib:string;
  verificationTarget:string;
  supportedDstEid:number;
  signers:[string,string,string,string,string];
  quorum:3;
}
export type AuditConstructorArguments=
  {endpoint:string;delegate:string}|
  {messageLib:string;verificationTarget:string;supportedDstEid:number;signers:[string,string,string,string,string];quorum:string};
export interface AuditProviderIdentity{label:string;originSha256:string;operatorFamily:string}

export interface VerifyDeploymentEvidenceInput{
  artifact:AuditContractArtifact;
  buildManifestText:string;
  deployment:AuditOAppDeployment|AuditAdapterDeployment;
  clients:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient];
  observationBlock:PinnedBlockObservation;
  expectedChainId:11155111|421614;
  expected:AuditOAppExpectation|AuditAdapterExpectation;
}
export interface VerifiedDeploymentEvidence{
  contractName:AuditContractName;
  chainId:string;
  address:string;
  deployer:string;
  providerIdentities:[AuditProviderIdentity,AuditProviderIdentity];
  deploymentTxHash:string;
  deploymentBlockNumber:string;
  deploymentBlockHash:string;
  creationBytecodeSha256:string;
  deployedBytecodeSha256:string;
  immutableReferencesSha256:string;
  transactionInputSha256:string;
  runtimeCodeKeccak256:string;
  constructorArguments:AuditConstructorArguments;
}

interface CanonicalTransaction{
  hash:string;chainId:bigint;blockHash:string;blockNumber:bigint;from:string;input:string;
}
interface CanonicalReceipt{
  transactionHash:string;blockHash:string;blockNumber:bigint;status:bigint;contractAddress:string;
}
interface ProviderDeploymentEvidence{
  transaction:CanonicalTransaction;
  receipt:CanonicalReceipt;
  runtimeCode:string;
}
interface TrustedBuildContract{
  name:AuditContractName;
  source:string;
  sourceSha256:string;
  abiSha256:string;
  creationBytecodeSha256:string;
  deployedBytecodeSha256:string;
  immutableReferencesSha256:string;
}

const coder=AbiCoder.defaultAbiCoder();
const dataPattern=/^0x(?:[0-9a-fA-F]{2})*$/;
const bytecodePattern=/^(?:[0-9a-f]{2})+$/;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
const quantityPattern=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const secretKey=/private|secret|mnemonic|seed|keystore|rpcurl|websocket|wallet|credential|token|signerkey/i;
const constructorShapes={
  SentinelDVNAdapter:[
    ["address","lib","address"],
    ["address","target","address"],
    ["uint32","dstEid","uint32"],
    ["address[]","signers","address[]"],
    ["uint256","q","uint256"]
  ],
  TreasuryPolicyOApp:[
    ["address","endpointV2","address"],
    ["address","delegate","address"]
  ]
}as const;

export function parseAuditContractArtifact(text:string,expectedName:AuditContractName):AuditContractArtifact{
  try{
    if(expectedName!=="SentinelDVNAdapter"&&expectedName!=="TreasuryPolicyOApp")failure();
    const parsed=parseJsonDocument(text);
    rejectSecretKeys(parsed,new Set<object>());
    const root=plainRecord(parsed);exactKeys(root,["abi","evm"]);
    const abi=denseArray(field(root,"abi"));
    const abiText=JSON.stringify(abi);if(typeof abiText!=="string")failure();
    const constructorInputs=parseAbi(abi,expectedName);
    const evm=plainRecord(field(root,"evm"));exactKeys(evm,["bytecode","deployedBytecode"]);
    const bytecode=plainRecord(field(evm,"bytecode"));exactKeys(bytecode,["object"]);
    const deployed=plainRecord(field(evm,"deployedBytecode"));
    exactKeys(deployed,["object","immutableReferences"]);
    const creationBytecode=bytecodeValue(field(bytecode,"object"));
    const deployedBytecode=bytecodeValue(field(deployed,"object"));
    const immutableReferences=immutableReferenceValue(
      field(deployed,"immutableReferences"),deployedBytecode.length/2
    );
    return{
      name:expectedName,
      constructorInputs,
      creationBytecode,
      deployedBytecode,
      immutableReferences,
      abiSha256:sha256(abiText),
      creationBytecodeSha256:sha256(Buffer.from(creationBytecode,"hex")),
      deployedBytecodeSha256:sha256(Buffer.from(deployedBytecode,"hex")),
      immutableReferencesSha256:sha256(canonicalJson(immutableReferences))
    };
  }catch(error){
    if(error instanceof PathwayAuditError&&error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED")throw error;
    return failure();
  }
}

export async function verifyDeploymentEvidence(input:VerifyDeploymentEvidenceInput):Promise<VerifiedDeploymentEvidence>{
  try{
    const root=plainRecord(input);
    exactKeys(root,[
      "artifact","buildManifestText","deployment","clients","observationBlock","expectedChainId","expected"
    ]);
    const artifact=checkedArtifact(field(root,"artifact"));
    const trustedBuild=trustedBuildContract(field(root,"buildManifestText"),artifact.name);
    if(artifact.abiSha256!==trustedBuild.abiSha256||
      artifact.creationBytecodeSha256!==trustedBuild.creationBytecodeSha256||
      artifact.deployedBytecodeSha256!==trustedBuild.deployedBytecodeSha256||
      artifact.immutableReferencesSha256!==trustedBuild.immutableReferencesSha256)failure();
    const expectedChainId=pathwayChainId(field(root,"expectedChainId"));
    const checked=checkedClients(field(root,"clients")),clients=checked.clients;
    const blockReference=eip1898(field(root,"observationBlock")as PinnedBlockObservation);
    const observation=observationIdentity(field(root,"observationBlock"));
    if(observation.chainId!==expectedChainId)failure();
    const policy=deploymentPolicy(artifact.name,field(root,"deployment"),field(root,"expected"));
    const providerEvidence=await Promise.all(clients.map(async client=>{
      const transaction=transactionValue(await client.call("eth_getTransactionByHash",[policy.deploymentTxHash]));
      const receipt=receiptValue(await client.call("eth_getTransactionReceipt",[policy.deploymentTxHash]));
      const runtimeCode=runtimeCodeValue(await client.call("eth_getCode",[policy.address,blockReference]));
      return{transaction,receipt,runtimeCode};
    }));
    const first=providerEvidence[0]!,second=providerEvidence[1]!;
    if(!sameProviderEvidence(first,second))failure();
    if(first.transaction.hash!==policy.deploymentTxHash||
      first.transaction.chainId!==BigInt(expectedChainId)||
      first.receipt.transactionHash!==policy.deploymentTxHash||
      first.receipt.status!==1n||
      first.receipt.contractAddress!==policy.address||
      first.transaction.blockNumber!==first.receipt.blockNumber||
      first.transaction.blockHash!==first.receipt.blockHash||
      first.receipt.blockNumber>observation.blockNumber)failure();
    assertRuntimeMatchesArtifact(artifact,first.runtimeCode);
    const inputBytes=first.transaction.input.slice(2);
    if(!inputBytes.startsWith(artifact.creationBytecode))failure();
    const suffix=inputBytes.slice(artifact.creationBytecode.length);
    if(!suffix.length)failure();
    const constructorArguments=decodeConstructor(artifact,suffix,policy);
    return{
      contractName:artifact.name,
      chainId:String(expectedChainId),
      address:policy.address,
      deployer:first.transaction.from,
      providerIdentities:checked.identities,
      deploymentTxHash:policy.deploymentTxHash,
      deploymentBlockNumber:first.receipt.blockNumber.toString(),
      deploymentBlockHash:first.receipt.blockHash,
      creationBytecodeSha256:artifact.creationBytecodeSha256,
      deployedBytecodeSha256:artifact.deployedBytecodeSha256,
      immutableReferencesSha256:artifact.immutableReferencesSha256,
      transactionInputSha256:sha256(Buffer.from(inputBytes,"hex")),
      runtimeCodeKeccak256:keccak256(first.runtimeCode),
      constructorArguments
    };
  }catch(error){
    if(error instanceof PathwayAuditError&&error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED")throw error;
    return failure();
  }
}

function parseAbi(value:unknown[],name:AuditContractName):AuditConstructorInput[]{
  let constructorInputs:AuditConstructorInput[]|undefined;
  for(const raw of value){
    const entry=plainRecord(raw),type=field(entry,"type");
    if(type==="constructor"){
      exactKeys(entry,["inputs","stateMutability","type"]);
      if(constructorInputs||field(entry,"stateMutability")!=="nonpayable")failure();
      constructorInputs=parseParameters(field(entry,"inputs"),false).map(parameter=>{
        if("components"in parameter||"indexed"in parameter)failure();
        return{internalType:parameter.internalType,name:parameter.name,type:parameter.type};
      });
    }else if(type==="error"){
      exactKeys(entry,["inputs","name","type"]);text(field(entry,"name"));parseParameters(field(entry,"inputs"),false);
    }else if(type==="event"){
      exactKeys(entry,["anonymous","inputs","name","type"]);
      if(typeof field(entry,"anonymous")!=="boolean")failure();
      text(field(entry,"name"));parseParameters(field(entry,"inputs"),true);
    }else if(type==="function"){
      exactKeys(entry,["inputs","name","outputs","stateMutability","type"]);
      text(field(entry,"name"));stateMutability(field(entry,"stateMutability"));
      parseParameters(field(entry,"inputs"),false);parseParameters(field(entry,"outputs"),false);
    }else failure();
  }
  if(!constructorInputs)failure();
  const expected=constructorShapes[name];
  if(constructorInputs.length!==expected.length||constructorInputs.some((input,index)=>{
    const wanted=expected[index];
    return!wanted||input.internalType!==wanted[0]||input.name!==wanted[1]||input.type!==wanted[2];
  }))failure();
  return constructorInputs;
}

type AbiParameter=AuditConstructorInput&{components?:AbiParameter[];indexed?:boolean};
function parseParameters(value:unknown,eventInput:boolean):AbiParameter[]{
  return denseArray(value).map(raw=>{
    const parameter=plainRecord(raw),hasComponents=Object.hasOwn(parameter,"components");
    const expected=["internalType","name","type"];
    if(hasComponents)expected.push("components");
    if(eventInput)expected.push("indexed");
    exactKeys(parameter,expected);
    const typeValue=text(field(parameter,"type")),internalType=text(field(parameter,"internalType"));
    const nameValue=stringValue(field(parameter,"name"));
    const result:AbiParameter={internalType,name:nameValue,type:typeValue};
    if(hasComponents){
      if(!/^tuple(?:\[[0-9]*\])*$/.test(typeValue))failure();
      result.components=parseParameters(field(parameter,"components"),false);
    }else if(typeValue.startsWith("tuple"))failure();
    if(eventInput){
      const indexed=field(parameter,"indexed");if(typeof indexed!=="boolean")failure();result.indexed=indexed;
    }
    return result;
  });
}

function immutableReferenceValue(value:unknown,byteLength:number):Record<string,AuditImmutableReference[]>{
  const root=plainRecord(value),result:Record<string,AuditImmutableReference[]>={};
  const spans:AuditImmutableReference[]=[];
  for(const sourceId of Object.keys(root).sort()){
    if(!/^(?:0|[1-9][0-9]*)$/.test(sourceId))failure();
    const references=denseArray(field(root,sourceId));if(references.length===0)failure();
    result[sourceId]=references.map(raw=>{
      const reference=plainRecord(raw);exactKeys(reference,["start","length"]);
      const start=uint(field(reference,"start"),true),length=uint(field(reference,"length"),false);
      if(length!==32||start>byteLength-length)failure();
      spans.push({start,length});
      return{start,length};
    });
  }
  spans.sort((left,right)=>left.start-right.start||left.length-right.length);
  if(spans.some((span,index)=>index>0&&span.start<spans[index-1]!.start+spans[index-1]!.length))failure();
  return result;
}

function checkedArtifact(value:unknown):AuditContractArtifact{
  const artifact=plainRecord(value);exactKeys(artifact,[
    "name","constructorInputs","creationBytecode","deployedBytecode","immutableReferences",
    "abiSha256","creationBytecodeSha256","deployedBytecodeSha256","immutableReferencesSha256"
  ]);
  const name=field(artifact,"name");
  if(name!=="SentinelDVNAdapter"&&name!=="TreasuryPolicyOApp")failure();
  const constructorInputs=parseConstructorInputs(field(artifact,"constructorInputs"),name);
  const creationBytecode=bytecodeValue(field(artifact,"creationBytecode"));
  const deployedBytecode=bytecodeValue(field(artifact,"deployedBytecode"));
  const immutableReferences=immutableReferenceValue(field(artifact,"immutableReferences"),deployedBytecode.length/2);
  const abiSha256=digest(field(artifact,"abiSha256"));
  const creationBytecodeSha256=digest(field(artifact,"creationBytecodeSha256"));
  const deployedBytecodeSha256=digest(field(artifact,"deployedBytecodeSha256"));
  const immutableReferencesSha256=digest(field(artifact,"immutableReferencesSha256"));
  if(creationBytecodeSha256!==sha256(Buffer.from(creationBytecode,"hex"))||
    deployedBytecodeSha256!==sha256(Buffer.from(deployedBytecode,"hex"))||
    immutableReferencesSha256!==sha256(canonicalJson(immutableReferences)))failure();
  return{
    name,constructorInputs,creationBytecode,deployedBytecode,immutableReferences,
    abiSha256,creationBytecodeSha256,deployedBytecodeSha256,immutableReferencesSha256
  };
}

function trustedBuildContract(value:unknown,name:AuditContractName):TrustedBuildContract{
  if(typeof value!=="string"||value.length===0||Buffer.byteLength(value,"utf8")>2_097_152)failure();
  const parsed=parseJsonDocument(value);rejectSecretKeys(parsed,new Set<object>());
  const root=plainRecord(parsed);exactKeys(root,["schemaVersion","compiler","contracts"]);
  if(field(root,"schemaVersion")!==2)failure();
  const compiler=plainRecord(field(root,"compiler"));exactKeys(compiler,["version","evmVersion","optimizer"]);
  const optimizer=plainRecord(field(compiler,"optimizer"));exactKeys(optimizer,["enabled","runs"]);
  if(field(compiler,"version")!=="0.8.30+commit.73712a01.Emscripten.clang"||
    field(compiler,"evmVersion")!=="shanghai"||field(optimizer,"enabled")!==true||
    field(optimizer,"runs")!==200)failure();
  const rawContracts=denseArray(field(root,"contracts"));if(rawContracts.length!==2)failure();
  const expected=[
    ["SentinelDVNAdapter","contracts/src/SentinelDVNAdapter.sol"],
    ["TreasuryPolicyOApp","contracts/src/TreasuryPolicyOApp.sol"]
  ]as const;
  const contracts=rawContracts.map((raw,index)=>{
    const contract=plainRecord(raw);exactKeys(contract,[
      "name","source","sourceSha256","abiSha256","creationBytecodeSha256",
      "deployedBytecodeSha256","immutableReferencesSha256"
    ]);
    const wanted=expected[index],contractName=field(contract,"name"),source=field(contract,"source");
    if(!wanted||contractName!==wanted[0]||source!==wanted[1])failure();
    return{
      name:contractName,
      source,
      sourceSha256:nonzeroDigest(field(contract,"sourceSha256")),
      abiSha256:nonzeroDigest(field(contract,"abiSha256")),
      creationBytecodeSha256:nonzeroDigest(field(contract,"creationBytecodeSha256")),
      deployedBytecodeSha256:nonzeroDigest(field(contract,"deployedBytecodeSha256")),
      immutableReferencesSha256:nonzeroDigest(field(contract,"immutableReferencesSha256"))
    }as TrustedBuildContract;
  });
  const selected=contracts.find(contract=>contract.name===name);if(!selected)failure();return selected;
}

function parseConstructorInputs(value:unknown,name:AuditContractName):AuditConstructorInput[]{
  const inputs=denseArray(value).map(raw=>{
    const input=plainRecord(raw);exactKeys(input,["internalType","name","type"]);
    return{internalType:text(field(input,"internalType")),name:text(field(input,"name")),type:text(field(input,"type"))};
  });
  const expected=constructorShapes[name];
  if(inputs.length!==expected.length||inputs.some((input,index)=>{
    const wanted=expected[index];
    return!wanted||input.internalType!==wanted[0]||input.name!==wanted[1]||input.type!==wanted[2];
  }))failure();
  return inputs;
}

type DeploymentPolicy={
  kind:"OAPP";address:string;deploymentTxHash:string;delegate:string;endpoint:string;
}|{
  kind:"ADAPTER";address:string;deploymentTxHash:string;messageLib:string;verificationTarget:string;
  supportedDstEid:number;signers:[string,string,string,string,string];quorum:3;
};
function deploymentPolicy(name:AuditContractName,deploymentValue:unknown,expectedValue:unknown):DeploymentPolicy{
  const deployment=plainRecord(deploymentValue),expected=plainRecord(expectedValue);
  if(name==="TreasuryPolicyOApp"){
    exactKeys(deployment,["address","deploymentTxHash","delegate"]);exactKeys(expected,["endpoint"]);
    return{
      kind:"OAPP",address:strictAddress(field(deployment,"address")),
      deploymentTxHash:transactionHash(field(deployment,"deploymentTxHash")),
      delegate:strictAddress(field(deployment,"delegate")),endpoint:strictAddress(field(expected,"endpoint"))
    };
  }
  exactKeys(deployment,["address","deploymentTxHash"]);
  exactKeys(expected,["messageLib","verificationTarget","supportedDstEid","signers","quorum"]);
  const signers=signerTuple(field(expected,"signers"));
  if(field(expected,"quorum")!==3)failure();
  return{
    kind:"ADAPTER",address:strictAddress(field(deployment,"address")),
    deploymentTxHash:transactionHash(field(deployment,"deploymentTxHash")),
    messageLib:strictAddress(field(expected,"messageLib")),
    verificationTarget:strictAddress(field(expected,"verificationTarget")),
    supportedDstEid:uint(field(expected,"supportedDstEid"),false),signers,quorum:3
  };
}

function decodeConstructor(artifact:AuditContractArtifact,suffix:string,policy:DeploymentPolicy):AuditConstructorArguments{
  const types=artifact.constructorInputs.map(input=>input.type);
  const decoded=coder.decode(types,`0x${suffix}`);
  if(coder.encode(types,Array.from(decoded)).slice(2).toLowerCase()!==suffix)failure();
  if(policy.kind==="OAPP"){
    const endpoint=decodedAddress(decoded[0]),delegate=decodedAddress(decoded[1]);
    if(endpoint!==policy.endpoint||delegate!==policy.delegate)failure();
    return{endpoint,delegate};
  }
  const messageLib=decodedAddress(decoded[0]),verificationTarget=decodedAddress(decoded[1]);
  const supportedDstEid=decodedInteger(decoded[2],0xffffffffn),rawSigners=decoded[3];
  if(!Array.isArray(rawSigners)&&!(rawSigners&&typeof rawSigners==="object"&&typeof rawSigners.length==="number"))failure();
  const signers=signerTuple(Array.from(rawSigners as ArrayLike<unknown>),false);
  const quorum=decodedInteger(decoded[4],(1n<<256n)-1n);
  if(messageLib!==policy.messageLib||verificationTarget!==policy.verificationTarget||
    supportedDstEid!==policy.supportedDstEid||quorum!==policy.quorum||
    signers.some((signer,index)=>signer!==policy.signers[index]))failure();
  return{messageLib,verificationTarget,supportedDstEid,signers,quorum:String(quorum)};
}

function transactionValue(value:unknown):CanonicalTransaction{
  const transaction=plainRecord(value),to=field(transaction,"to");
  if(to!==null)failure();
  return{
    hash:transactionHash(field(transaction,"hash")),
    chainId:quantity(field(transaction,"chainId")),
    blockHash:nonzeroHash(field(transaction,"blockHash")),
    blockNumber:quantity(field(transaction,"blockNumber")),
    from:decodedAddress(field(transaction,"from")),
    input:data(field(transaction,"input"),false)
  };
}
function receiptValue(value:unknown):CanonicalReceipt{
  const receipt=plainRecord(value);
  return{
    transactionHash:transactionHash(field(receipt,"transactionHash")),
    blockHash:nonzeroHash(field(receipt,"blockHash")),
    blockNumber:quantity(field(receipt,"blockNumber")),
    status:quantity(field(receipt,"status")),
    contractAddress:decodedAddress(field(receipt,"contractAddress"))
  };
}
function runtimeCodeValue(value:unknown):string{return data(value,false)}

function sameProviderEvidence(left:ProviderDeploymentEvidence,right:ProviderDeploymentEvidence):boolean{
  return left.transaction.hash===right.transaction.hash&&
    left.transaction.chainId===right.transaction.chainId&&
    left.transaction.blockHash===right.transaction.blockHash&&
    left.transaction.blockNumber===right.transaction.blockNumber&&
    left.transaction.from===right.transaction.from&&
    left.transaction.input===right.transaction.input&&
    left.receipt.transactionHash===right.receipt.transactionHash&&
    left.receipt.blockHash===right.receipt.blockHash&&
    left.receipt.blockNumber===right.receipt.blockNumber&&
    left.receipt.status===right.receipt.status&&
    left.receipt.contractAddress===right.receipt.contractAddress&&
    left.runtimeCode===right.runtimeCode;
}

function checkedClients(value:unknown):{
  clients:readonly[ReadOnlyRpcClient,ReadOnlyRpcClient];
  identities:[AuditProviderIdentity,AuditProviderIdentity];
}{
  if(!Array.isArray(value)||value.length!==2||!value.every(client=>
    !!client&&typeof client==="object"&&typeof client.call==="function"&&typeof client.descriptor==="function"))failure();
  if(value[0]===value[1])failure();
  const clients=value as[ReadOnlyRpcClient,ReadOnlyRpcClient];
  const identities=clients.map(client=>providerIdentity(client.descriptor()))as[AuditProviderIdentity,AuditProviderIdentity];
  if(identities[0].label===identities[1].label||
    identities[0].originSha256===identities[1].originSha256)failure();
  return{clients,identities};
}
function providerIdentity(value:unknown):AuditProviderIdentity{
  const identity=plainRecord(value);exactKeys(identity,["label","originSha256","operatorFamily"]);
  return{
    label:text(field(identity,"label")),
    originSha256:nonzeroDigest(field(identity,"originSha256")),
    operatorFamily:text(field(identity,"operatorFamily"))
  };
}
function observationIdentity(value:unknown):{chainId:number;blockNumber:bigint}{
  const record=plainRecord(value),chainId=field(record,"chainId"),blockNumber=field(record,"blockNumber");
  if(typeof chainId!=="string"||!(/^[1-9][0-9]*$/).test(chainId)||
    typeof blockNumber!=="string"||!(/^(?:0|[1-9][0-9]*)$/).test(blockNumber))failure();
  const parsedChainId=Number(chainId);
  if(!Number.isSafeInteger(parsedChainId))failure();
  return{chainId:parsedChainId,blockNumber:BigInt(blockNumber)};
}
function pathwayChainId(value:unknown):11155111|421614{
  if(value!==11155111&&value!==421614)failure();return value;
}
function assertRuntimeMatchesArtifact(artifact:AuditContractArtifact,runtimeCode:string):void{
  const compiled=Buffer.from(artifact.deployedBytecode,"hex"),observed=Buffer.from(runtimeCode.slice(2),"hex");
  if(compiled.length!==observed.length)failure();
  for(const references of Object.values(artifact.immutableReferences)){
    for(const reference of references){
      compiled.fill(0,reference.start,reference.start+reference.length);
      observed.fill(0,reference.start,reference.start+reference.length);
    }
  }
  if(!compiled.equals(observed))failure();
}
function signerTuple(value:unknown,strict=true):[string,string,string,string,string]{
  if(!Array.isArray(value)||value.length!==5)failure();
  const parsed=value.map(item=>strict?strictAddress(item):decodedAddress(item));
  if(parsed.some((item,index)=>index>0&&item.toLowerCase()<=parsed[index-1]!.toLowerCase()))failure();
  return[parsed[0]!,parsed[1]!,parsed[2]!,parsed[3]!,parsed[4]!];
}
function decodedInteger(value:unknown,maximum:bigint):number{
  if(typeof value!=="bigint"||value<0n||value>maximum||value>BigInt(Number.MAX_SAFE_INTEGER))failure();
  return Number(value);
}
function strictAddress(value:unknown):string{
  const normalized=decodedAddress(value);if(normalized!==value)return failure();return normalized;
}
function decodedAddress(value:unknown):string{
  if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value))failure();
  try{return getAddress(value)}catch{return failure()}
}
function transactionHash(value:unknown):string{
  if(typeof value!=="string"||!hashPattern.test(value)||/^0x0{64}$/i.test(value))failure();return value.toLowerCase();
}
function nonzeroHash(value:unknown):string{
  if(typeof value!=="string"||!hashPattern.test(value)||/^0x0{64}$/i.test(value))failure();return value.toLowerCase();
}
function quantity(value:unknown):bigint{
  if(typeof value!=="string"||!quantityPattern.test(value))failure();return BigInt(value);
}
function data(value:unknown,allowEmpty:boolean):string{
  if(typeof value!=="string"||!dataPattern.test(value)||(!allowEmpty&&value==="0x"))failure();return value.toLowerCase();
}
function bytecodeValue(value:unknown):string{
  if(typeof value!=="string"||!bytecodePattern.test(value))failure();return value;
}
function digest(value:unknown):string{
  if(typeof value!=="string"||!/^[0-9a-f]{64}$/.test(value))failure();return value;
}
function nonzeroDigest(value:unknown):string{
  const parsed=digest(value);if(/^0{64}$/.test(parsed))failure();return parsed;
}
function uint(value:unknown,allowZero:boolean):number{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||(!allowZero&&value===0))failure();return value;
}
function stateMutability(value:unknown):string{
  if(value!=="pure"&&value!=="view"&&value!=="nonpayable"&&value!=="payable")failure();return value;
}
function text(value:unknown):string{const result=stringValue(value);if(!result)failure();return result}
function stringValue(value:unknown):string{if(typeof value!=="string"||value.includes("\0"))failure();return value}
function denseArray(value:unknown):unknown[]{if(!Array.isArray(value))failure();return value}
function plainRecord(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))failure();
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)failure();
  return value as Record<string,unknown>;
}
function field(record:Record<string,unknown>,name:string):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(record,name);
  if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)failure();return descriptor.value;
}
function exactKeys(record:Record<string,unknown>,expected:string[]):void{
  const keys=Reflect.ownKeys(record),wanted=[...expected].sort();
  if(keys.length!==wanted.length||keys.some(key=>typeof key!=="string")||
    (keys as string[]).sort().some((key,index)=>key!==wanted[index]))failure();
}
function rejectSecretKeys(value:unknown,active:Set<object>):void{
  if(value===null||typeof value!=="object")return;
  if(active.has(value))failure();active.add(value);
  try{
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=="string")failure();if(Array.isArray(value)&&key==="length")continue;
      if(secretKey.test(key))failure();
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)failure();
      rejectSecretKeys(descriptor.value,active);
    }
  }finally{active.delete(value)}
}
function sha256(value:string|Uint8Array):string{return createHash("sha256").update(value).digest("hex")}
function failure():never{throw new PathwayAuditError("PATHWAY_AUDIT_OBSERVATION_FAILED")}
