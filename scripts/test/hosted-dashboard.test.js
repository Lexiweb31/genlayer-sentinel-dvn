import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cp,mkdtemp,mkdir,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,relative,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {before,test} from "node:test";

const expectedPublicFiles=[
  "assets/demo.js",
  "assets/geist-latin.woff2",
  "assets/og.png",
  "assets/sentinel-network-loop.mp4",
  "assets/sentinel-network-poster.jpg",
  "assets/special-elite-latin.woff2",
  "console/index.html",
  "index.html",
  "src/app.js",
  "src/console.css",
  "src/delivery.css",
  "src/demo.css",
  "src/hero-motion.js",
  "src/landing.css",
  "src/landing.js",
  "src/pathway-audit.js",
  "src/recovery.css",
  "src/runtime-status.js",
  "src/style.css",
  "src/timeline.js"
];
const expectedCsp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const ogDigest="fbc94eafe380f47b5d2c47067222153c70dc49ef43c72b2568f44ae038c5386a";
let worker,buildHostedDashboard;

before(async()=>{
  const result=spawnSync("npm",["run","build:site"],{cwd:resolve("."),encoding:"utf8"});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  ({default:worker}=await import(`${new URL("../../dist/server/index.js",import.meta.url).href}?test=${Date.now()}`));
  ({buildHostedDashboard}=await import(new URL("../build-hosted-dashboard.mjs",import.meta.url)));
});

test("build:site emits only the reviewed public and worker files",async()=>{
  assert.deepEqual(await filesBelow(resolve("dist/public")),expectedPublicFiles);
  assert.deepEqual(await filesBelow(resolve("dist/client")),expectedPublicFiles);
  assert.deepEqual(await filesBelow(resolve("dist/server")),["index.js"]);
  const hostedHtml=await readFile("dist/public/index.html","utf8");
  const sourceHtml=await readFile("apps/dashboard/index.html","utf8");
  assert.equal((hostedHtml.match(/__SITE_ORIGIN__\/assets\/og\.png/g)??[]).length,2);
  assert.equal(hostedHtml.includes('content="/assets/og.png"'),false);
  assert.equal((sourceHtml.match(/content="\/assets\/og\.png"/g)??[]).length,2);
  assert.equal(sourceHtml.includes("__SITE_ORIGIN__"),false);
  assert.equal(createHash("sha256").update(await readFile("dist/public/assets/og.png")).digest("hex"),ogDigest);
});

test("the package contains distinct public and console experiences",async()=>{
  const publicPage=await readFile("dist/public/index.html","utf8");
  const consolePage=await readFile("dist/public/console/index.html","utf8");
  assert.match(publicPage,/Proof before value moves\./);
  assert.match(consolePage,/Sentinel Console/);
  assert.equal(publicPage.includes("demo-workspace"),false);
});

test("the worker injects only the request origin into hosted social metadata",async()=>{
  const page=await readFile("dist/public/index.html");
  const response=await worker.fetch(
    new Request("https://sentinel.example/?origin=https://attacker.invalid",{headers:{"x-forwarded-host":"attacker.invalid"}}),
    {ASSETS:{fetch:async()=>new Response(page,{headers:{
      "content-type":"text/html; charset=utf-8",
      "content-length":String(page.length),
      "content-encoding":"gzip",
      "etag":'"source-placeholder"'
    }})}}
  );
  const body=await response.text();
  assert.equal(response.status,200);
  assert.equal((body.match(/https:\/\/sentinel\.example\/assets\/og\.png/g)??[]).length,2);
  assert.equal(body.includes("__SITE_ORIGIN__"),false);
  assert.equal(body.includes("attacker.invalid/assets/og.png"),false);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal(response.headers.get("content-security-policy"),expectedCsp);
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.equal(response.headers.get("referrer-policy"),"no-referrer");
  assert.equal(response.headers.get("permissions-policy"),"camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("content-length"),null);
  assert.equal(response.headers.get("content-encoding"),null);
  assert.equal(response.headers.get("etag"),null);
});

test("the worker resolves the hosted root to the packaged index file",async()=>{
  const page=await readFile("dist/public/index.html");
  const response=await worker.fetch(
    new Request("https://sentinel.example/"),
    {ASSETS:{fetch:async request=>{
      const path=new URL(request.url).pathname;
      return path==="/index.html"
        ?new Response(page,{headers:{"content-type":"text/html; charset=utf-8"}})
        :new Response("not found",{status:404});
    }}}
  );
  assert.equal(response.status,200);
  assert.match(await response.text(),/https:\/\/sentinel\.example\/assets\/og\.png/);
});

test("the worker resolves the console route to the packaged console HTML",async()=>{
  const page=await readFile("dist/public/console/index.html");
  const response=await worker.fetch(
    new Request("https://sentinel.example/console/"),
    {ASSETS:{fetch:async request=>
      new URL(request.url).pathname==="/console/index.html"
        ?new Response(page,{headers:{"content-type":"text/html; charset=utf-8"}})
        :new Response("not found",{status:404})
    }}
  );
  assert.equal(response.status,200);
  assert.match(await response.text(),/Sentinel Console/);
});

test("the worker permits HEAD without returning the delegated HTML body",async()=>{
  const page=await readFile("dist/public/index.html");
  const response=await worker.fetch(
    new Request("https://sentinel.example/",{method:"HEAD"}),
    {ASSETS:{fetch:async request=>new Response(request.method==="GET"?page:null,{headers:{"content-type":"text/html; charset=utf-8","x-binding":"used"}})}}
  );
  assert.equal(response.status,200);
  assert.equal(await response.text(),"");
  assert.equal(response.headers.get("x-binding"),"used");
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal(response.headers.get("content-security-policy"),expectedCsp);
});

test("malformed hosted metadata produces GET and HEAD failure parity",async()=>{
  for(const source of[
    "<html><head></head><body>missing metadata</body></html>",
    "<html><head>__SITE_ORIGIN__/assets/og.png</head></html>"
  ]){
    const env={ASSETS:{fetch:async request=>new Response(request.method==="GET"?source:null,{status:200,headers:{
      "content-type":"text/html; charset=utf-8",
      "content-length":String(Buffer.byteLength(source)),
      "content-encoding":"gzip",
      "etag":'"invalid-hosted-page"'
    }})}};
    const get=await worker.fetch(new Request("https://sentinel.example/"),env);
    const head=await worker.fetch(new Request("https://sentinel.example/",{method:"HEAD"}),env);
    assert.equal(get.status,500);
    assert.equal(head.status,get.status);
    assert.deepEqual(headersOf(head),headersOf(get));
    assert.deepEqual(await get.json(),{error:"hosted metadata unavailable"});
    assert.equal(await head.text(),"");
    assert.equal(head.headers.get("cache-control"),"no-store");
    assert.equal(head.headers.get("content-security-policy"),expectedCsp);
    assert.equal(head.headers.get("content-length"),null);
    assert.equal(head.headers.get("content-encoding"),null);
    assert.equal(head.headers.get("etag"),null);
  }
});

test("the worker rejects mutation methods before static delegation",async()=>{
  const response=await worker.fetch(
    new Request("https://sentinel.example/",{method:"POST"}),
    {ASSETS:{fetch:async()=>{throw new Error("static binding must not be called")}}}
  );
  assert.equal(response.status,405);
  assert.deepEqual(await response.json(),{error:"method not allowed"});
  assert.equal(response.headers.get("allow"),"GET, HEAD");
  assert.equal(response.headers.get("cache-control"),"no-store");
});

test("the worker rejects unknown and traversal-like paths before static delegation",async()=>{
  const env={ASSETS:{fetch:async()=>{throw new Error("static binding must not be called")}}};
  for(const path of["/package.json","/src/..%2findex.html","/%2fassets%2fog.png"]){
    const response=await worker.fetch(new Request(`https://sentinel.example${path}`),env);
    assert.equal(response.status,404,path);
    assert.deepEqual(await response.json(),{error:"not found"},path);
    assert.equal(response.headers.get("cache-control"),"no-store",path);
  }
});

test("the retired diagnostic route is never exposed publicly",async()=>{
  const response=await worker.fetch(
    new Request("https://sentinel.example/__sentinel-assets"),
    {ASSETS:{fetch:async()=>{throw new Error("diagnostic route must not delegate")}}}
  );
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:"not found"});
});

test("the worker preserves video bytes and applies immutable caching",async()=>{
  const expected=await readFile("dist/public/assets/sentinel-network-loop.mp4");
  const response=await worker.fetch(
    new Request("https://sentinel.example/assets/sentinel-network-loop.mp4"),
    {ASSETS:{fetch:async()=>new Response(expected,{headers:{"content-type":"video/mp4"}})}}
  );
  assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),"video/mp4");
  assert.equal(response.headers.get("cache-control"),"public, max-age=31536000, immutable");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
  assert.equal(response.headers.get("content-security-policy"),expectedCsp);
});

test("delegated redirects and errors are never publicly cached",async()=>{
  const cases=[
    ["/assets/og.png",301],
    ["/assets/og.png",404],
    ["/assets/og.png",500],
    ["/src/app.js",301],
    ["/src/app.js",404],
    ["/src/app.js",500]
  ];
  for(const[path,status]of cases){
    const response=await worker.fetch(
      new Request(`https://sentinel.example${path}`),
      delegatedEnv(status,`delegated ${status}`)
    );
    assert.equal(response.status,status,`${path} ${status}`);
    assert.equal(await response.text(),`delegated ${status}`,`${path} ${status}`);
    assert.equal(response.headers.get("cache-control"),"no-store",`${path} ${status}`);
    assert.equal(response.headers.get("content-security-policy"),expectedCsp,`${path} ${status}`);
  }
});

test("HEAD fixed failures match GET metadata without a body",async()=>{
  const cases=[
    ["/package.json",{ASSETS:{fetch:async()=>{throw new Error("must not delegate")}}}],
    ["/assets/og.png",undefined],
    ["/assets/og.png",{ASSETS:{fetch:async()=>{throw new Error("binding unavailable")}}}]
  ];
  for(const[path,env]of cases){
    const get=await worker.fetch(new Request(`https://sentinel.example${path}`),env);
    const head=await worker.fetch(new Request(`https://sentinel.example${path}`,{method:"HEAD"}),env);
    assert.equal(head.status,get.status,path);
    assert.deepEqual(headersOf(head),headersOf(get),path);
    assert.equal(await head.text(),"",path);
    assert.notEqual(await get.text(),"",path);
  }
});

test("HEAD delegated redirects and errors match GET metadata without a body",async()=>{
  const cases=[
    ["/assets/og.png",301],
    ["/assets/og.png",500],
    ["/src/app.js",301],
    ["/src/app.js",404]
  ];
  for(const[path,status]of cases){
    const get=await worker.fetch(new Request(`https://sentinel.example${path}`),delegatedEnv(status,"binding response"));
    const head=await worker.fetch(new Request(`https://sentinel.example${path}`,{method:"HEAD"}),delegatedEnv(status,"binding response"));
    assert.equal(head.status,get.status,`${path} ${status}`);
    assert.deepEqual(headersOf(head),headersOf(get),`${path} ${status}`);
    assert.equal(head.headers.get("cache-control"),"no-store",`${path} ${status}`);
    assert.equal(await head.text(),"",`${path} ${status}`);
    assert.equal(await get.text(),"binding response",`${path} ${status}`);
  }
});

test("the package builder refuses an unexpected dashboard source asset",async t=>{
  const fixture=await dashboardFixture(t);
  await writeFile(join(fixture,"apps/dashboard/assets/unreviewed.bin"),"not reviewed");
  await assert.rejects(buildHostedDashboard({root:fixture}),/unexpected dashboard asset: unreviewed\.bin/);
});

test("the package builder refuses a missing dashboard source asset",async t=>{
  const fixture=await dashboardFixture(t);
  await rm(join(fixture,"apps/dashboard/assets/geist-latin.woff2"));
  await assert.rejects(buildHostedDashboard({root:fixture}),/missing dashboard asset: geist-latin\.woff2/);
});

async function dashboardFixture(t){
  const root=await mkdtemp(join(tmpdir(),"sentinel-hosted-dashboard-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,"apps"),{recursive:true});
  await cp(resolve("apps/dashboard"),join(root,"apps/dashboard"),{recursive:true});
  await mkdir(join(root,"dist/apps/dashboard"),{recursive:true});
  await cp(resolve("dist/apps/dashboard/demo.js"),join(root,"dist/apps/dashboard/demo.js"));
  return root;
}

function delegatedEnv(status,body){
  return{ASSETS:{fetch:async()=>new Response(body,{status,headers:{
    "content-type":"text/plain; charset=utf-8",
    "content-length":String(Buffer.byteLength(body)),
    "location":"https://cdn.sentinel.example/replacement",
    "x-binding":"delegated"
  }})}};
}

function headersOf(response){
  return Object.fromEntries([...response.headers].sort(([left],[right])=>left.localeCompare(right)));
}

async function filesBelow(root){
  const files=[];
  async function visit(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);
      if(entry.isDirectory())await visit(path);
      else if(entry.isFile())files.push(relative(root,path).split("\\").join("/"));
      else assert.fail(`unexpected output entry ${path}`);
    }
  }
  await visit(root);
  return files.sort();
}
