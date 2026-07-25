export async function safeJsonRpc(url:string,method:string,params:unknown[]):Promise<unknown>{
  try{
    if(typeof method!=="string"||!/^eth_[A-Za-z0-9_]+$/.test(method)||!Array.isArray(params))throw new Error();
    const response=await fetch(url,{
      method:"POST",
      headers:{"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
      redirect:"error",
      signal:AbortSignal.timeout(10_000)
    });
    if(!response.ok)throw new Error();
    const text=await response.text();
    if(text.length===0||text.length>2_000_000)throw new Error();
    const value=JSON.parse(text) as unknown;
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();
    const body=value as Record<string,unknown>,hasResult=Object.hasOwn(body,"result"),hasError=Object.hasOwn(body,"error");
    if(body.jsonrpc!=="2.0"||body.id!==1||hasResult===hasError||hasError)throw new Error();
    return body.result;
  }catch{throw new Error("JSON-RPC request failed")}
}
