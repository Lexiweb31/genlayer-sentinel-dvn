const failure=():never=>{throw new Error("invalid canonical JSON")};

export function canonicalJson(value:unknown):string{
  return`${encode(value,new Set<object>())}\n`;
}

export function parseCanonicalJsonDocument(text:string):unknown{
  if(typeof text!=="string"||text.includes("\0"))failure();
  let value:unknown;
  try{value=JSON.parse(text)}catch{failure()}
  if(canonicalJson(value)!==text)failure();
  return value;
}

function encode(value:unknown,active:Set<object>):string{
  if(value===null)return"null";
  if(typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"){
    if(!Number.isFinite(value))failure();
    return JSON.stringify(value);
  }
  if(typeof value!=="object")return failure();
  if(active.has(value))return failure();
  active.add(value);
  try{
    if(Array.isArray(value))return encodeArray(value,active);
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)return failure();
    return encodeObject(value as Record<string,unknown>,active);
  }finally{active.delete(value)}
}

function encodeArray(value:unknown[],active:Set<object>):string{
  const ownKeys=Reflect.ownKeys(value);
  if(ownKeys.some(key=>key!=="length"&&(typeof key!=="string"||!/^(0|[1-9][0-9]*)$/.test(key))))return failure();
  const encoded:string[]=[];
  for(let index=0;index<value.length;index++){
    if(!Object.hasOwn(value,index))return failure();
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return failure();
    encoded.push(encode(descriptor.value,active));
  }
  return`[${encoded.join(",")}]`;
}

function encodeObject(value:Record<string,unknown>,active:Set<object>):string{
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=="string"))return failure();
  const sorted=(keys as string[]).sort();
  const encoded:string[]=[];
  for(const key of sorted){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!("value"in descriptor)||!descriptor.enumerable)return failure();
    encoded.push(`${JSON.stringify(key)}:${encode(descriptor.value,active)}`);
  }
  return`{${encoded.join(",")}}`;
}
