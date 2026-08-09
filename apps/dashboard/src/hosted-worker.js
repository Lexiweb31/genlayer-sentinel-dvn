const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const SITE_ORIGIN="__SITE_ORIGIN__";
const PUBLIC_PATHS=new Set([
  "/",
  "/assets/demo.js",
  "/assets/geist-latin.woff2",
  "/assets/og.png",
  "/assets/sentinel-network-loop.mp4",
  "/assets/sentinel-network-poster.jpg",
  "/assets/special-elite-latin.woff2",
  "/src/app.js",
  "/src/delivery.css",
  "/src/demo.css",
  "/src/hero-motion.js",
  "/src/pathway-audit.js",
  "/src/recovery.css",
  "/src/runtime-status.js",
  "/src/style.css",
  "/src/timeline.js"
]);
const IMMUTABLE_PATHS=new Set([
  "/assets/geist-latin.woff2",
  "/assets/og.png",
  "/assets/sentinel-network-loop.mp4",
  "/assets/sentinel-network-poster.jpg",
  "/assets/special-elite-latin.woff2"
]);
const DIAGNOSTIC_CANDIDATES=["/index.html","/public/index.html","/dist/public/index.html","/assets/og.png","/public/assets/og.png","/dist/public/assets/og.png"];

export default{async fetch(request,env){
  if(request.method!=="GET"&&request.method!=="HEAD")return errorResponse(request.method,405,"method not allowed",{"allow":"GET, HEAD"});
  const url=new URL(request.url);
  if(url.pathname==="/__sentinel-assets")return assetDiagnosis(request,env,url);
  if(!PUBLIC_PATHS.has(url.pathname))return errorResponse(request.method,404,"not found");
  if(!env?.ASSETS||typeof env.ASSETS.fetch!=="function")return errorResponse(request.method,503,"static assets unavailable");
  const assetUrl=new URL(request.url);
  if(assetUrl.pathname==="/")assetUrl.pathname="/index.html";
  const assetRequest=new Request(assetUrl,{method:"GET",headers:request.headers});
  let response;
  try{response=await env.ASSETS.fetch(assetRequest)}catch{return errorResponse(request.method,502,"static asset request failed")}
  const headers=securityHeaders(response.headers,cachePolicy(url.pathname,response.status));
  if(url.pathname==="/")invalidateRepresentationHeaders(headers);
  if(url.pathname==="/"&&response.ok){
    const source=await response.text();
    const placeholders=source.split(`${SITE_ORIGIN}/assets/og.png`).length-1;
    if(placeholders!==2)return errorResponse(request.method,500,"hosted metadata unavailable");
    if(request.method==="HEAD")return new Response(null,{status:response.status,statusText:response.statusText,headers});
    return new Response(source.replaceAll(SITE_ORIGIN,url.origin),{status:response.status,statusText:response.statusText,headers});
  }
  if(request.method==="HEAD")return new Response(null,{status:response.status,statusText:response.statusText,headers});
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}};

async function assetDiagnosis(request,env,url){
  if(!env?.ASSETS||typeof env.ASSETS.fetch!=="function")return errorResponse(request.method,503,"static assets unavailable");
  const candidates={};
  for(const path of DIAGNOSTIC_CANDIDATES){
    try{candidates[path]=(await env.ASSETS.fetch(new Request(new URL(path,url),{method:"GET"}))).status}
    catch{candidates[path]=0}
  }
  const headers=securityHeaders(new Headers({"content-type":"application/json; charset=utf-8"}),"no-store");
  return new Response(request.method==="HEAD"?null:JSON.stringify({candidates}),{status:200,headers});
}

function cachePolicy(path,status){
  if(path==="/"||status!==200)return"no-store";
  return IMMUTABLE_PATHS.has(path)?"public, max-age=31536000, immutable":"public, max-age=300";
}

function securityHeaders(source,cacheControl){
  const headers=new Headers(source);
  headers.set("cache-control",cacheControl);
  headers.set("x-content-type-options","nosniff");
  headers.set("referrer-policy","no-referrer");
  headers.set("permissions-policy","camera=(), microphone=(), geolocation=()");
  headers.set("content-security-policy",CSP);
  return headers;
}

function invalidateRepresentationHeaders(headers){
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
}

function errorResponse(method,status,error,extra={}){
  const headers=securityHeaders(new Headers({"content-type":"application/json; charset=utf-8",...extra}),"no-store");
  return new Response(method==="HEAD"?null:JSON.stringify({error}),{status,headers});
}
