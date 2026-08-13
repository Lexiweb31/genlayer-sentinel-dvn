const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const SITE_ORIGIN="__SITE_ORIGIN__";
const PUBLIC_PATHS=new Set([
  "/",
  "/console",
  "/console/",
  "/console/index.html",
  "/assets/demo.js",
  "/assets/geist-latin.woff2",
  "/assets/og.png",
  "/assets/sentinel-network-loop.mp4",
  "/assets/sentinel-network-poster.jpg",
  "/assets/special-elite-latin.woff2",
  "/src/app.js",
  "/src/console.css",
  "/src/delivery.css",
  "/src/demo.css",
  "/src/hero-motion.js",
  "/src/landing.css",
  "/src/landing.js",
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

export default{async fetch(request,env){
  if(request.method!=="GET"&&request.method!=="HEAD")return errorResponse(request.method,405,"method not allowed",{"allow":"GET, HEAD"});
  const url=new URL(request.url);
  if(!PUBLIC_PATHS.has(url.pathname))return errorResponse(request.method,404,"not found");
  if(!env?.ASSETS||typeof env.ASSETS.fetch!=="function")return errorResponse(request.method,503,"static assets unavailable");
  const assetUrl=new URL(request.url);
  if(assetUrl.pathname==="/")assetUrl.pathname="/index.html";
  if(assetUrl.pathname==="/console"||assetUrl.pathname==="/console/")assetUrl.pathname="/console/index.html";
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

function cachePolicy(path,status){
  if(path==="/"||path==="/console"||path==="/console/"||path==="/console/index.html"||status!==200)return"no-store";
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
