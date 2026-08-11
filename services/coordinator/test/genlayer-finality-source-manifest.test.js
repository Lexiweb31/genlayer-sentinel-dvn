import test from "node:test";
import assert from "node:assert/strict";
import {canonicalJson} from "../../../dist/services/coordinator/src/canonical-json.js";
import {
  GenLayerFinalitySourceManifestError,
  parseGenLayerFinalitySourceManifest,
  parseGenLayerFinalitySourceManifestText
} from "../../../dist/services/coordinator/src/genlayer-finality-source-manifest.js";

const contract="0x1111111111111111111111111111111111111111";
const today="2026-08-11";
const fixture=()=>({
  schemaVersion:1,
  sourceLabel:"bradbury-reviewed-source-a",
  sourceOriginSha256:"a".repeat(64),
  chainId:4221,
  policyContract:contract,
  policyRecordMode:"latest-final",
  callDataCodec:"UNAPPROVED",
  reviewDate:"2026-08-11",
  acknowledgement:"REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION"
});

test("parses exactly one future finality-source review record and exposes no URL",()=>{
  const parsed=parseGenLayerFinalitySourceManifest(fixture(),today);
  assert.deepEqual(parsed,fixture());
  assert.deepEqual(parseGenLayerFinalitySourceManifestText(canonicalJson(fixture()),today),fixture());
  assert.equal(JSON.stringify(parsed).includes("http"),false);
});

test("rejects unsafe, stale, and authorization-like source records",()=>{
  const invalid=[
    value=>{value.extra=true},
    value=>{value.sourceOrigin="https://rpc.example"},
    value=>{value.sourceUrl="https://rpc.example"},
    value=>{value.chainId=1},
    value=>{value.policyContract="0x0000000000000000000000000000000000000000"},
    value=>{value.callDataCodec="APPROVED"},
    value=>{value.policyRecordMode="latest"},
    value=>{value.reviewDate="2025-01-01"},
    value=>{value.reviewDate="2099-01-01"},
    value=>{value.acknowledgement="SIGNER_AUTHORIZED"},
    value=>{value.privateKey="secret"},
  ];
  for(const mutate of invalid){
    const value=fixture();mutate(value);
    assert.throws(()=>parseGenLayerFinalitySourceManifest(value,today),error=>
      error instanceof GenLayerFinalitySourceManifestError&&
      error.message==="GENLAYER_FINALITY_SOURCE_MANIFEST_INVALID"&&
      !error.message.includes("secret")
    );
  }
});
