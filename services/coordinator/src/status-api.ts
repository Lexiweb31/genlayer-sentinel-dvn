import http from "node:http";
import type {Coordinator} from "./coordinator.js";

export interface StatusResponse {status:number;body:string;}
export function statusResponse(coordinator:Coordinator,method:string,path:string):StatusResponse {
  if(method!=="GET")return{status:405,body:json({error:"method not allowed"})};
  const url=new URL(path,"http://localhost");if(url.pathname==="/health")return{status:200,body:json({status:"ok",mode:"testnet-prototype"})};
  if(url.pathname==="/api/jobs")return{status:200,body:json([...coordinator.jobs.values()].map(j=>j.snapshot))};
  const match=url.pathname.match(/^\/api\/jobs\/(0x[0-9a-fA-F]{64})$/);if(match){const job=coordinator.jobs.get(match[1]!);return job?{status:200,body:json(job.snapshot)}:{status:404,body:json({error:"job not found"})}}
  return{status:404,body:json({error:"not found"})};
}
export function createStatusServer(coordinator:Coordinator):http.Server{return http.createServer((req,res)=>{const value=statusResponse(coordinator,req.method??"GET",req.url??"/");res.statusCode=value.status;res.setHeader("content-type","application/json; charset=utf-8");res.setHeader("cache-control","no-store");res.setHeader("x-content-type-options","nosniff");res.end(value.body)})}
function json(value:unknown):string{return JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v)}
