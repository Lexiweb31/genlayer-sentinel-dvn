import test from "node:test";
import assert from "node:assert/strict";
import {canonicalJson} from "../../../dist/services/coordinator/src/canonical-json.js";
import {runGenLayerFinalitySourceCommand} from "../../../dist/services/coordinator/src/genlayer-finality-source-command.js";

const manifest={
  schemaVersion:1,sourceLabel:"bradbury-reviewed-source-a",sourceOriginSha256:"a".repeat(64),
  chainId:4221,policyContract:"0x1111111111111111111111111111111111111111",
  policyRecordMode:"latest-final",callDataCodec:"UNAPPROVED",reviewDate:"2026-08-11",
  acknowledgement:"REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION"
};

test("prints a sanitized finality-source review summary without accessing a network",async()=>{
  const output=[],errors=[],reads=[];
  const code=await runGenLayerFinalitySourceCommand(
    ["--manifest","/tmp/finality-source.json"],
    {stdout:value=>output.push(value),stderr:value=>errors.push(value)},
    {readText:async path=>{reads.push(path);return canonicalJson(manifest)},today:()=> "2026-08-11"}
  );
  assert.equal(code,2);
  assert.deepEqual(reads,["/tmp/finality-source.json"]);
  assert.deepEqual(errors,[]);
  assert.deepEqual(JSON.parse(output[0]),{
    truthLabel:"REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION",
    sourceLabel:"bradbury-reviewed-source-a",sourceOriginSha256:"a".repeat(64),chainId:4221,
    policyContract:"0x1111111111111111111111111111111111111111",
    policyRecordMode:"latest-final",callDataCodec:"UNAPPROVED",reviewDate:"2026-08-11"
  });
});

test("fails closed on invalid arguments and input",async()=>{
  const io={stdout:()=>{throw new Error("must not write")},stderr:()=>{}};
  assert.equal(await runGenLayerFinalitySourceCommand([],io),1);
  assert.equal(await runGenLayerFinalitySourceCommand(["--manifest","relative.json"],io),1);
  assert.equal(await runGenLayerFinalitySourceCommand(["--manifest","/tmp/x"],io,{readText:async()=>"{",today:()=> "2026-08-11"}),1);
});
