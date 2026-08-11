import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html=fs.readFileSync(new URL("../console/index.html",import.meta.url),"utf8");
const cssPath=new URL("../src/console.css",import.meta.url);
const css=fs.existsSync(cssPath)?fs.readFileSync(cssPath,"utf8"):"";
const js=fs.readFileSync(new URL("../src/app.js",import.meta.url),"utf8");

test("console starts with an inbox and an explicit empty observation state",()=>{
  for(const id of["console-search","message-list","console-empty","console-detail"]){
    assert.match(html,new RegExp(`\\bid="${id}"`,"i"));
  }
  assert.ok(html.includes("No packets are currently observed."));
  assert.ok(html.includes("Open public site"));
});

test("console is message-first rather than a marketing hero or fixed portal",()=>{
  assert.match(html,/Sentinel Console/);
  for(const heading of["Origin","Destination","Identifier","Observed","Stage"]){
    assert.match(html,new RegExp(`>${heading}<`,"i"),`missing message column ${heading}`);
  }
  for(const retired of["hero-shell","hero-media","portal-sidebar","homepage-intro","signal-orbit"]){
    assert.equal(html.includes(retired),false,`retired console shell remains: ${retired}`);
  }
});

test("selected-message detail covers every evidence gate and destination state",()=>{
  const detail=html.match(/<section\b[^>]*\bid="console-detail"[\s\S]*?<\/section>/i)?.[0]??"";
  for(const label of["Canonical identity","Ordered evidence","Policy result","Signer progress","Destination state"]){
    assert.ok(detail.includes(label),`missing selected-message detail: ${label}`);
  }
});

test("console styles provide an ink-blue responsive inspector with accessible targets",()=>{
  assert.notEqual(css,"","console stylesheet must exist");
  for(const token of["--console-ink:","--console-blue:","#message-list",".message-row",".console-detail-grid"]){
    assert.ok(css.includes(token),`missing console style token ${token}`);
  }
  assert.match(css,/min-height\s*:\s*44px/i);
  assert.match(css,/@media\s*\(max-width\s*:\s*760px\)/i);
  assert.match(css,/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  assert.match(css,/:focus-visible/i);
});

test("query helpers normalize input and match canonical packet fields",async()=>{
  const previousDocument=globalThis.document;
  const previousWindow=globalThis.window;
  const previousLocation=globalThis.location;
  const previousHistory=globalThis.history;
  const nodes=new Map();
  const node=()=>({
    addEventListener(){},removeEventListener(){},replaceChildren(){},append(){},setAttribute(){},click(){},
    className:"",disabled:false,hidden:false,textContent:"",title:"",value:"",files:[]
  });
  globalThis.document={
    querySelector(selector){if(selector===".hero-media")return null;if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector)},
    createElement:node
  };
  globalThis.window={ethereum:undefined,addEventListener(){}};
  globalThis.location={search:"?q=%20TxHash%20&guid=0xselected"};
  globalThis.history={replaceState(){}};
  try{
    const {matchesConsoleQuery,normalizeConsoleQuery}=await import(`../src/app.js?console-shell=${Date.now()}`);
    assert.equal(normalizeConsoleQuery("  0xABCD  "),"0xabcd");
    assert.equal(normalizeConsoleQuery(null),"");
    const job={packet:{guid:"0xGUID",txHash:"0xTransaction",srcEid:40161,dstEid:40231},stage:"POLICY_FINALIZED"};
    for(const query of["0xguid","transaction","40161","40231","policy_finalized",""]){
      assert.equal(matchesConsoleQuery(job,query),true,`query should match ${query}`);
    }
    assert.equal(matchesConsoleQuery(job,"missing"),false);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;
    if(previousHistory===undefined)delete globalThis.history;else globalThis.history=previousHistory;
  }
});

test("console reads URL query and selection state without coordinator mutation requests",()=>{
  assert.match(js,/new URLSearchParams\(location\.search\)/);
  assert.match(js,/history\.replaceState\(/);
  assert.ok(js.includes("No observed packet matches this query."));
  assert.equal(/fetch\([^)]*,\s*\{[^}]*method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)/is.test(js),false);
});
