import http from "node:http";
import{readFile}from"node:fs/promises";import{join}from"node:path";
import type {Coordinator} from "./coordinator.js";
import type{DeadLetterReader}from"./recovery-service.js";

export interface StatusResponse {status:number;body:string;}
export async function statusResponse(coordinator:Coordinator,method:string,path:string,deadLetters?:DeadLetterReader):Promise<StatusResponse> {
  if(method!=="GET")return{status:405,body:json({error:"method not allowed"})};
  const url=new URL(path,"http://localhost");if(url.pathname==="/health")return{status:200,body:json({status:"ok",mode:"testnet-prototype"})};
  if(url.pathname==="/api/jobs")return{status:200,body:json([...coordinator.jobs.values()].map(j=>j.snapshot))};
  if(url.pathname==="/api/dead-letters"){const records=deadLetters?await deadLetters.listDead():[];return{status:200,body:json(records.map(record=>({transactionHash:record.transactionHash,blockNumber:record.blockNumber,attempts:record.attempts,errorCode:record.errorCode,firstFailedAt:record.firstFailedAt,lastFailedAt:record.lastFailedAt})))}};
  const match=url.pathname.match(/^\/api\/jobs\/(0x[0-9a-fA-F]{64})$/);if(match){const job=coordinator.jobs.get(match[1]!);return job?{status:200,body:json(job.snapshot)}:{status:404,body:json({error:"job not found"})}}
  return{status:404,body:json({error:"not found"})};
}
export function createStatusServer(coordinator:Coordinator,deadLetters?:DeadLetterReader):http.Server{return http.createServer(async(req,res)=>{const value=await statusResponse(coordinator,req.method??"GET",req.url??"/",deadLetters);res.statusCode=value.status;res.setHeader("content-type","application/json; charset=utf-8");res.setHeader("cache-control","no-store");res.setHeader("x-content-type-options","nosniff");res.end(value.body)})}
export interface AppResponse {status:number;body:string|Uint8Array;contentType:string;}
const assets=new Map([["/",["index.html","text/html; charset=utf-8"]],["/src/app.js",["src/app.js","text/javascript; charset=utf-8"]],["/src/style.css",["src/style.css","text/css; charset=utf-8"]],["/src/recovery.css",["src/recovery.css","text/css; charset=utf-8"]]] as const);
export async function dashboardResponse(coordinator:Coordinator,method:string,path:string,root:string,deadLetters?:DeadLetterReader):Promise<AppResponse>{const url=new URL(path,"http://localhost");if(url.pathname==="/health"||url.pathname.startsWith("/api/")){const value=await statusResponse(coordinator,method,path,deadLetters);return{...value,contentType:"application/json; charset=utf-8"}}if(method!=="GET")return{status:405,body:json({error:"method not allowed"}),contentType:"application/json; charset=utf-8"};const asset=assets.get(url.pathname as "/"|"/src/app.js"|"/src/style.css"|"/src/recovery.css");if(!asset)return{status:404,body:json({error:"not found"}),contentType:"application/json; charset=utf-8"};return{status:200,body:await readFile(join(root,asset[0])),contentType:asset[1]}}
export function createDashboardServer(coordinator:Coordinator,root:string,deadLetters?:DeadLetterReader):http.Server{return http.createServer(async(req,res)=>{try{const value=await dashboardResponse(coordinator,req.method??"GET",req.url??"/",root,deadLetters);res.statusCode=value.status;headers(res,value.contentType);res.end(value.body)}catch{res.statusCode=500;headers(res,"application/json; charset=utf-8");res.end(json({error:"dashboard asset unavailable"}))}})}
function headers(res:http.ServerResponse,contentType:string):void{res.setHeader("content-type",contentType);res.setHeader("cache-control","no-store");res.setHeader("x-content-type-options","nosniff");res.setHeader("referrer-policy","no-referrer");res.setHeader("permissions-policy","camera=(), microphone=(), geolocation=()");res.setHeader("content-security-policy","default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")}
function json(value:unknown):string{return JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v)}
