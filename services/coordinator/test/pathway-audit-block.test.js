import test from"node:test";
import assert from"node:assert/strict";
import{PathwayAuditError}from"../../../dist/services/coordinator/src/pathway-audit-model.js";
import{
  agreePinnedBlock,
  assertPinnedBlockStable,
  eip1898
}from"../../../dist/services/coordinator/src/pathway-audit-block.js";

const hash=character=>`0x${character.repeat(64)}`;
const block=(overrides={})=>({
  number:"0x7d",
  hash:hash("A"),
  parentHash:hash("B"),
  stateRoot:hash("C"),
  transactionsRoot:hash("D"),
  timestamp:"0x6553f100",
  ...overrides
});

function client(options={}){
  const calls=[];
  let blockReads=0;
  const value={
    async call(method,params){
      calls.push(structuredClone({method,params}));
      if(method==="eth_chainId")return options.chainId??"0xaa36a7";
      if(method==="eth_blockNumber")return options.head??"0x82";
      if(method==="eth_getBlockByNumber"){
        blockReads++;
        if(options.stableBlock&&blockReads>1)return structuredClone(options.stableBlock);
        return structuredClone(options.block??block());
      }
      throw new Error(`unexpected read-only method ${method}`);
    },
    descriptor(){return{label:"fixture",originSha256:"a".repeat(64),operatorFamily:"fixture"}}
  };
  return{value,calls};
}

const observationFailure=error=>error instanceof PathwayAuditError&&
  error.code==="PATHWAY_AUDIT_OBSERVATION_FAILED"&&
  error.message==="PATHWAY_AUDIT_OBSERVATION_FAILED";

test("pins the lagged minimum agreed block using normalized public evidence",async()=>{
  const first=client({head:"0x82"}),second=client({head:"0x80",block:block({
    number:"0x7d",hash:hash("a"),parentHash:hash("b"),stateRoot:hash("c"),transactionsRoot:hash("d"),timestamp:"0x6553f100"
  })});
  const selected=await agreePinnedBlock({
    clients:[first.value,second.value],expectedChainId:11155111,observationLag:3
  });
  assert.deepEqual(selected,{
    chainId:"11155111",
    blockNumber:"125",
    blockHash:hash("a"),
    parentHash:hash("b"),
    stateRoot:hash("c"),
    transactionsRoot:hash("d"),
    timestamp:"1700000000"
  });
  assert.deepEqual(eip1898(selected),{blockHash:selected.blockHash,requireCanonical:true});
  for(const fixture of[first,second]){
    assert.deepEqual(fixture.calls,[
      {method:"eth_chainId",params:[]},
      {method:"eth_blockNumber",params:[]},
      {method:"eth_getBlockByNumber",params:["0x7d",false]}
    ]);
  }
});

test("fails closed when a provider cannot prove the exact agreed canonical header",async()=>{
  const cases=[
    ["chain-id mismatch",{chainId:"0x66eee"}],
    ["unexpected chain",{chainId:"0xaa36a8"}],
    ["head below lag",{head:"0x2"}],
    ["null block",{block:null}],
    ["wrong returned number",{block:block({number:"0x7e"})}],
    ["hash disagreement",{block:block({hash:hash("e")})}],
    ["parent hash disagreement",{block:block({parentHash:hash("e")})}],
    ["state root disagreement",{block:block({stateRoot:hash("e")})}],
    ["transactions root disagreement",{block:block({transactionsRoot:hash("e")})}],
    ["timestamp disagreement",{block:block({timestamp:"0x6553f101"})}],
    ["malformed quantity",{block:block({timestamp:"0x06553f100"})}],
    ["zero hash",{block:block({hash:hash("0")})}],
    ["pruned block",{block:block({hash:null})}]
  ];
  for(const [name,secondOptions]of cases){
    const first=client(),second=client(secondOptions);
    await assert.rejects(agreePinnedBlock({
      clients:[first.value,second.value],expectedChainId:11155111,observationLag:3
    }),observationFailure,name);
  }
});

test("rechecks the pinned number and rejects a changed canonical hash",async()=>{
  const first=client(),second=client({head:"0x80",stableBlock:block({hash:hash("e")})});
  const selected=await agreePinnedBlock({
    clients:[first.value,second.value],expectedChainId:11155111,observationLag:3
  });
  await assert.rejects(assertPinnedBlockStable([first.value,second.value],selected),observationFailure);
  assert.deepEqual(second.calls.slice(-1),[
    {method:"eth_getBlockByNumber",params:["0x7d",false]}
  ]);
});

test("requires exactly two clients and bounded integer public inputs",async()=>{
  const first=client(),second=client(),third=client();
  for(const input of[
    {clients:[first.value],expectedChainId:11155111,observationLag:3},
    {clients:[first.value,second.value,third.value],expectedChainId:11155111,observationLag:3},
    {clients:[first.value,second.value],expectedChainId:0,observationLag:3},
    {clients:[first.value,second.value],expectedChainId:11155111.5,observationLag:3},
    {clients:[first.value,second.value],expectedChainId:11155111,observationLag:0},
    {clients:[first.value,second.value],expectedChainId:11155111,observationLag:257}
  ])await assert.rejects(agreePinnedBlock(input),observationFailure);
  await assert.rejects(assertPinnedBlockStable([first.value],{
    chainId:"11155111",blockNumber:"125",blockHash:hash("a"),parentHash:hash("b"),stateRoot:hash("c"),transactionsRoot:hash("d"),timestamp:"1700000000"
  }),observationFailure);
});
