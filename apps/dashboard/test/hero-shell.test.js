import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../src/style.css",import.meta.url),"utf8");
const js=fs.readFileSync(new URL("../src/app.js",import.meta.url),"utf8");

const element=(tag,id)=>html.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`,"i"))?.[0]??"";
const attribute=(markup,name)=>new RegExp(`\\b${name}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?`,"i").test(markup);

test("presents the approved Sentinel policy-firewall hero without travel or deployment claims",()=>{
  for(const text of[
    "sentinel",
    "A policy firewall for messages that move value.",
    "Inspect a local, read-only pathway audit before trusting a cross-chain action. Nothing is uploaded.",
    "Inspect Evidence",
    "Packet proof",
    "Policy decision",
    "Signer quorum",
    "Destination check",
    "NOT OBSERVED"
  ])assert.ok(html.includes(text),`missing approved hero text: ${text}`);
  assert.equal(/Wandor|Japan|travel|itinerary/i.test(html),false);
  assert.equal(html.includes("<title>GenLayer Sentinel — Verify policy before messages cross chains.</title>"),true);
});

test("uses only the self-origin loop and poster with ambient playback attributes",()=>{
  const video=html.match(/<video\b[^>]*>/i)?.[0]??"";
  assert.match(video,/\bsrc="\/assets\/sentinel-network-loop\.mp4"/i);
  assert.match(video,/\bposter="\/assets\/sentinel-network-poster\.jpg"/i);
  for(const name of["autoplay","muted","loop","playsinline"])assert.equal(attribute(video,name),true,`video missing ${name}`);
  assert.equal(/<video\b[^>]*(?:https?:\/\/|\/\/)/i.test(html),false);
});

test("exposes keyboard and screen-reader operable local evidence controls",()=>{
  const fileInput=element("input","pathway-audit-file");
  assert.match(fileInput,/\btype="file"/i);
  assert.match(fileInput,/\baccept="application\/json,\.json"/i);
  assert.match(fileInput,/\bhidden\b/i);

  const load=element("button","pathway-audit-load");
  const upload=element("button","pathway-audit-upload");
  const inspect=element("button","pathway-audit-inspect");
  for(const [name,button]of[["load",load],["upload",upload],["inspect",inspect]]){
    assert.notEqual(button,"",`${name} must be a native button`);
    assert.match(button,/\btype="button"/i);
  }
  assert.match(upload,/\baria-label="Select local pathway audit evidence"/i);
  assert.match(inspect,/\bdisabled\b/i);
  const status=html.match(/<[^>]+\bid="pathway-audit-status"[^>]*>/i)?.[0]??"";
  assert.match(status,/\brole="status"/i);
  assert.match(status,/\baria-live="polite"/i);
});

test("links navigation to the local pathway, evidence, and trust sections",()=>{
  for(const target of["pathway","evidence","trust-model"]){
    assert.match(html,new RegExp(`<a\\b[^>]*href="#${target}"[^>]*>`,`i`));
    assert.match(html,new RegExp(`\\bid="${target}"`,`i`));
  }
});

test("offers a truthful top-level wallet connection that does not imply transaction authority",()=>{
  const wallet=element("button","wallet-connect");
  const account=html.match(/<[^>]+\bid="wallet-account"[^>]*>/i)?.[0]??"";
  assert.notEqual(wallet,"","wallet connection button must be visible in the console top bar");
  assert.match(wallet,/\btype="button"/i);
  assert.equal(html.includes("READ-ONLY WALLET CONNECTION"),true);
  assert.match(account,/\brole="status"/i);
  assert.match(account,/\baria-live="polite"/i);
  assert.equal(js.includes("eth_requestAccounts"),true);
  assert.equal(js.includes("wallet_switchEthereumChain"),true);
  assert.equal(js.includes('ethereumSepoliaChainId="0xaa36a7"'),true);
  assert.equal(js.includes("eth_sendTransaction"),false);
});

test("preserves the existing live operations and demo targets",()=>{
  for(const id of[
    "runtime-mode","live-notice","demo-workspace","demo-title","demo-status","demo-connect","demo-account","demo-chain",
    "demo-record-label","demo-argument","demo-match","demo-quote","demo-fee","demo-send","demo-transaction","demo-guid",
    "demo-message","demo-source-oapp","demo-destination-eid","demo-target","demo-signature","runtime-status-badge",
    "runtime-lifecycle","runtime-lease","runtime-phase","runtime-heartbeat","runtime-last-tick","runtime-recovery-posture",
    "connection-status","job-select","refresh-time","timeline","quarantine-status","dead-letters","delivery-status",
    "deliveries","recovery-action-status","recovery-actions","inspector","packet-details","verification-details",
    "policy-details","signer-details"
  ])assert.match(html,new RegExp(`\\bid="${id}"`,`i`),`missing existing target ${id}`);
  assert.equal((html.match(/\bid="live-notice"/g)??[]).length,1,"live notice must be moved, not duplicated");
});

test("renders every allowlisted pathway evidence field before coordinator operations",()=>{
  for(const id of[
    "pathway-audit-file","pathway-audit-inspect","pathway-audit-status","pathway-audit-source-block",
    "pathway-audit-destination-block","pathway-audit-rpc","pathway-audit-code","pathway-audit-configuration",
    "pathway-audit-blockers","pathway-audit-truth-label","pathway-audit-observed-at","pathway-audit-evidence-digest",
    "pathway-audit-configuration-digest","pathway-audit-notice"
  ])assert.match(html,new RegExp(`\\bid="${id}"`,`i`),`missing pathway target ${id}`);
  assert.ok(html.indexOf('id="evidence"')<html.indexOf('id="demo-workspace"'));
  for(const text of["Verification desk","What Sentinel can establish","What it cannot establish from this file"])assert.ok(html.includes(text),`missing evidence workspace copy: ${text}`);
});

test("implements the exact glass composition and resilient responsive states",()=>{
  assert.match(css,/@font-face\s*\{[^}]*font-family\s*:\s*Geist[^}]*geist-latin\.woff2/is);
  assert.match(css,/@font-face\s*\{[^}]*font-family\s*:\s*['"]Special Elite['"][^}]*special-elite-latin\.woff2/is);
  assert.match(css,/\.hero-shell\s*\{[^}]*min-height\s*:\s*100svh/is);
  assert.match(css,/\.hero-gradient\s*\{[^}]*height\s*:\s*687px/is);
  assert.match(css,/\.evidence-glass\s*\{[^}]*border-radius\s*:\s*44px/is);
  assert.match(css,/\.evidence-glass\s*\{[^}]*backdrop-filter\s*:\s*blur\(20px\)/is);
  assert.match(css,/@media\s*\(max-width\s*:\s*760px\)/i);
  assert.match(css,/width\s*:\s*calc\(100vw\s*-\s*48px\)/i);
  assert.match(css,/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  assert.match(css,/:focus-visible/i);
});

test("carries the Sentinel surface system through the operational workspace",()=>{
  for(const token of["--surface:",".operations-content::before",".pathway-evidence,.runtime-observation,.quarantine,.delivery,.operator-recovery",".section-head","border-radius:24px","backdrop-filter:blur(18px)"])assert.ok(css.includes(token),`missing unified workspace token: ${token}`);
});

test("uses the Sentinel Portal shell across the overview and operations",()=>{
  assert.match(html,/<header class="portal-topbar"/i);
  assert.match(html,/<aside class="portal-sidebar"/i);
  for(const label of["Overview","Pathway evidence","Packet lifecycle","Trust model"])assert.ok(html.includes(label),`missing portal navigation label: ${label}`);
  assert.match(css,/\.portal-topbar\s*\{[^}]*position\s*:\s*fixed/is);
  assert.match(css,/\.portal-sidebar\s*\{[^}]*position\s*:\s*fixed/is);
  assert.match(css,/\.sentinel-experience\s*\{[^}]*background\s*:\s*#f7f7f9/is);
});

test("uses a proof-story transition instead of a hard hero-to-dashboard seam",()=>{
  assert.match(html,/<section class="homepage-intro experience-section"[^>]*>/i);
  assert.ok(html.includes("One packet. Four independent gates."));
  assert.ok(html.indexOf('class="homepage-intro experience-section"')<html.indexOf('id="evidence"'));
  assert.match(css,/\.sentinel-experience \.operations-content::before\s*\{[^}]*display\s*:\s*none/is);
  assert.match(css,/\.homepage-intro\s*\{[^}]*padding\s*:\s*72px 0 56px/is);
});

test("keeps the mobile status clear of the circular upload control",()=>{
  const statusRules=[...css.matchAll(/\.evidence-state\s*\{([^}]*)\}/g)].map(match=>match[1]);
  assert.equal(statusRules.some(rule=>/left\s*:\s*21px/i.test(rule)),false,"status must start after the 44-pixel upload control");
  assert.match(css,/@media\s*\(max-width\s*:\s*430px\)[\s\S]*\.evidence-state\s*\{[^}]*top\s*:\s*137px[^}]*right\s*:\s*auto[^}]*left\s*:\s*80px/is);
});

test("keeps 44-pixel upload and 56-pixel inspect targets separated at a 390-pixel viewport",()=>{
  const compact=css.match(/@media\s*\(max-width\s*:\s*430px\)\s*\{([\s\S]*?)\n\}/i)?.[1]??"";
  const rules=(source,selector)=>[...source.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\s*\\{([^}]*)\\}`,"gi"))].map(match=>match[1]);
  const pixels=(source,selector,property)=>{
    for(const body of rules(source,selector)){
      const match=body.match(new RegExp(`${property}\\s*:\\s*([0-9]+)px`,"i"));
      if(match)return Number(match[1]);
    }
    return Number.NaN;
  };
  const cardHeight=pixels(compact,".evidence-glass","min-height");
  const uploadTop=pixels(compact,".evidence-upload","top"),uploadHeight=pixels(css,".evidence-upload","height");
  const inspectBottom=pixels(compact,".inspect-evidence","bottom"),inspectHeight=pixels(css,".inspect-evidence","height");
  const inspectTop=cardHeight-inspectBottom-inspectHeight;
  assert.ok(Number.isFinite(inspectTop));
  assert.ok(inspectTop-(uploadTop+uploadHeight)>=12,"compact touch targets need at least a 12-pixel vertical gap");

  const clientWidth=375,cardWidth=390-48,cardLeft=(clientWidth-cardWidth)/2;
  assert.ok(cardLeft>=0);
  assert.ok(cardLeft+21>=0&&cardLeft+cardWidth-21<=clientWidth,"compact inspect target must remain within the 375-pixel client width");
});

test("initializes one independent local-file controller without joining coordinator or demo state",()=>{
  assert.match(js,/import\s*\{\s*createPathwayAuditFileController\s*\}\s*from\s*["']\.\/pathway-audit\.js["']/);
  assert.equal((js.match(/createPathwayAuditFileController\s*\(/g)??[]).length,1);
  assert.match(js,/pathway-audit-load/);
  assert.match(js,/pathway-audit-upload/);
  assert.match(js,/fileInput\.click\(\)/);
  assert.equal(/(?:jobs|deliveryByGuid)\s*(?:\.push|\.set|=)[^;]*pathway/i.test(js),false);
  assert.equal(/(?:demo|wallet)[A-Za-z]*\s*(?:\.push|\.set|=)[^;]*pathway/i.test(js),false);
});

test("binds reduced-motion video lifecycle once and disposes it with the page",()=>{
  assert.match(js,/import\s*\{\s*createHeroMotionController\s*\}\s*from\s*["']\.\/hero-motion\.js["']/);
  assert.match(js,/querySelector\(["']\.hero-media["']\)/);
  assert.match(js,/matchMedia\(["']\(prefers-reduced-motion:\s*reduce\)["']\)/);
  assert.equal((js.match(/createHeroMotionController\s*\(/g)??[]).length,1);
  assert.match(js,/heroMotionController\.dispose\(\)/);
});
