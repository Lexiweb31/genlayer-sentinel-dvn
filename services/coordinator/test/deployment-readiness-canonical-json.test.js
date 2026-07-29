import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  parseCanonicalJsonDocument
} from "../../../dist/services/coordinator/src/canonical-json.js";

test("encodes recursively sorted canonical JSON with one terminal newline",()=>{
  const value={z:[{b:2,a:1}],a:{d:false,c:null}};
  const encoded='{"a":{"c":null,"d":false},"z":[{"a":1,"b":2}]}\n';
  assert.equal(canonicalJson(value),encoded);
  assert.deepEqual(parseCanonicalJsonDocument(encoded),value);
});

test("rejects noncanonical and duplicate-key documents",()=>{
  for(const text of[
    '{"b":1,"a":2}\n',
    '{"a":1,"a":2}\n',
    '{"a":1}',
    '{"a":1}\n\n',
    '\uFEFF{"a":1}\n',
    '{"a":1} trailing\n',
    '{"a":1}\u0000\n'
  ])assert.throws(()=>parseCanonicalJsonDocument(text),/canonical JSON/);
});

test("rejects values outside the canonical JSON data model",()=>{
  const sparse=[];sparse[1]=1;
  const cyclic={};cyclic.self=cyclic;
  const accessor={};Object.defineProperty(accessor,"value",{enumerable:true,get:()=>1});
  const symbol={a:1};symbol[Symbol("hidden")]=2;
  for(const value of[
    undefined,NaN,Infinity,-Infinity,1n,new Date(0),{value:undefined},
    sparse,cyclic,accessor,symbol
  ])assert.throws(()=>canonicalJson(value),/canonical JSON/);
});
