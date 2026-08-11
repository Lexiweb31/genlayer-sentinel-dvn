import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publicHtml=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const consoleHtml=fs.readFileSync(new URL("../console/index.html",import.meta.url),"utf8");
const js=fs.readFileSync(new URL("../src/app.js",import.meta.url),"utf8");

const consoleElement=(tag,id)=>consoleHtml.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`,"i"))?.[0]??"";

test("keeps the public route static and hands operational inspection to the console",()=>{
  assert.match(publicHtml,/Proof before value moves\./);
  assert.match(publicHtml,/id="landing-inspect"[^>]*href="\/console\/"/);
  for(const token of["demo-workspace","wallet-connect","pathway-audit-file","console-search"]){
    assert.equal(publicHtml.includes(token),false,`public route exposes operational target ${token}`);
  }
  for(const target of["console-search","message-list","console-detail","demo-workspace","pathway-audit-file"]){
    assert.match(consoleHtml,new RegExp(`\\bid="${target}"`,"i"),`console missing ${target}`);
  }
});

test("preserves read-only wallet and no-spend readiness controls",()=>{
  for(const id of["wallet-connect","testnet-readiness-check","layerzero-endpoint-check"]){
    const button=consoleElement("button",id);
    assert.notEqual(button,"",`${id} must remain a native console button`);
    assert.match(button,/\btype="button"/i);
  }
  for(const id of["wallet-account","testnet-readiness-status","layerzero-endpoint-status"]){
    assert.match(consoleHtml,new RegExp(`<[^>]+\\bid="${id}"[^>]*\\brole="status"`,"i"));
  }
  for(const behavior of["eth_requestAccounts","wallet_switchEthereumChain","eth_getBalance","eth_getCode"]){
    assert.ok(js.includes(behavior),`missing read-only wallet behavior ${behavior}`);
  }
  assert.equal(js.includes("eth_sendTransaction"),false);
});

test("preserves evidence, runtime, delivery, recovery, and local-demo inspector targets",()=>{
  for(const id of[
    "runtime-mode","live-notice","demo-workspace","demo-title","demo-status","demo-connect","demo-account","demo-chain",
    "demo-record-label","demo-argument","demo-match","demo-quote","demo-fee","demo-send","demo-transaction","demo-guid",
    "demo-message","demo-source-oapp","demo-destination-eid","demo-target","demo-signature","runtime-status-badge",
    "runtime-lifecycle","runtime-lease","runtime-phase","runtime-heartbeat","runtime-last-tick","runtime-recovery-posture",
    "connection-status","job-select","refresh-time","timeline","quarantine-status","dead-letters","delivery-status",
    "deliveries","recovery-action-status","recovery-actions","inspector","packet-details","verification-details",
    "policy-details","signer-details","destination-details","pathway-audit-file","pathway-audit-load","pathway-audit-upload",
    "pathway-audit-inspect","pathway-audit-status","pathway-audit-source-block","pathway-audit-destination-block",
    "pathway-audit-rpc","pathway-audit-code","pathway-audit-configuration","pathway-audit-blockers"
  ])assert.match(consoleHtml,new RegExp(`\\bid="${id}"`,"i"),`missing existing inspector target ${id}`);

  for(const section of["evidence","runtime-observation","delivery","operator-recovery","demo-workspace"]){
    const selected=["runtime-observation","delivery","operator-recovery"].includes(section)?`class="${section}"`:`id="${section}"`;
    assert.ok(consoleHtml.includes(selected),`missing compact inspector section ${section}`);
  }
  assert.equal((consoleHtml.match(/\bid="live-notice"/g)??[]).length,1,"live notice must be moved, not duplicated");
  assert.doesNotMatch(consoleHtml.match(/<section\b[^>]*\bid="console-detail"[^>]*>/i)?.[0]??"",/\bhidden\b/i,"compact inspectors must remain reachable before the first packet");
  assert.match(consoleHtml.match(/<div\b[^>]*\bid="inspector"[^>]*>/i)?.[0]??"",/\bhidden\b/i,"packet evidence stays hidden until a packet is selected");
});

test("keeps the local evidence viewer independent from coordinator and demo state",()=>{
  assert.match(js,/import\s*\{\s*createPathwayAuditFileController\s*\}\s*from\s*["']\.\/pathway-audit\.js["']/);
  assert.equal((js.match(/createPathwayAuditFileController\s*\(/g)??[]).length,1);
  assert.match(js,/pathway-audit-load/);
  assert.match(js,/pathway-audit-upload/);
  assert.match(js,/fileInput\.click\(\)/);
  assert.equal(/(?:jobs|deliveryByGuid)\s*(?:\.push|\.set|=)[^;]*pathway/i.test(js),false);
  assert.equal(/(?:demo|wallet)[A-Za-z]*\s*(?:\.push|\.set|=)[^;]*pathway/i.test(js),false);
});
