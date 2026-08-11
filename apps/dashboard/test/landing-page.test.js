import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");

test("public site focuses on the truthful product thesis and console handoff",()=>{
  assert.match(html,/Proof before value moves\./);
  assert.match(html,/id="landing-inspect"[^>]*href="\/console\/"/);
  assert.match(html,/id="landing-query"/);
  assert.match(html,/id="landing-proof-path"/);
  assert.equal(html.includes("demo-workspace"),false);
  assert.equal(html.includes("local harness"),false);
});

test("landing query handoff encodes nonempty input and omits an empty query",async()=>{
  const previousDocument=globalThis.document;
  const previousWindow=globalThis.window;
  const inertElement={addEventListener(){}};
  globalThis.document={querySelector(){return inertElement}};
  globalThis.window={location:{assign(){}}};
  try{
    const {getConsoleDestination}=await import(`../src/landing.js?test=${Date.now()}`);
    assert.equal(typeof getConsoleDestination,"function");
    assert.equal(getConsoleDestination("0xabc / packet"),"/console/?q=0xabc%20%2F%20packet");
    assert.equal(getConsoleDestination("  \t"),"/console/");
  }finally{
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
  }
});
