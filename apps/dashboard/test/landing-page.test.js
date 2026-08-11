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
