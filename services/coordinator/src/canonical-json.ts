const failure=():never=>{throw new Error("invalid canonical JSON")};

export function canonicalJson(value:unknown):string{
  return`${encode(value,new Set<object>())}\n`;
}

export function parseCanonicalJsonDocument(text:string):unknown{
  const value=parseJsonDocument(text);
  if(canonicalJson(value)!==text)failure();
  return value;
}

export function parseJsonDocument(text:string):unknown{
  if(typeof text!=="string"||text.includes("\0"))failure();
  let offset=0;
  const whitespace=():void=>{while(offset<text.length&&/[ \t\r\n]/.test(text[offset]!))offset++};
  const string=():string=>{
    if(text[offset]!=='"')failure();
    const start=offset++;
    while(offset<text.length){
      const character=text[offset++]!;
      if(character==='"'){
        try{return JSON.parse(text.slice(start,offset))}catch{failure()}
      }
      if(character==="\\"){
        const escaped=text[offset++];
        if(!escaped||!/^["\\/bfnrtu]$/.test(escaped))failure();
        if(escaped==="u"){
          if(!/^[0-9a-fA-F]{4}$/.test(text.slice(offset,offset+4)))failure();
          offset+=4;
        }
      }else if(character.charCodeAt(0)<0x20)failure();
    }
    return failure();
  };
  const value=():unknown=>{
    whitespace();
    const character=text[offset];
    if(character==='"')return string();
    if(character==="{"){
      offset++;whitespace();
      const result={}as Record<string,unknown>,keys=new Set<string>();
      if(text[offset]==="}"){offset++;return result}
      while(true){
        whitespace();const key=string();
        if(keys.has(key))failure();keys.add(key);
        whitespace();if(text[offset++]!==":")failure();
        Object.defineProperty(result,key,{value:value(),enumerable:true,writable:true,configurable:true});
        whitespace();
        const separator=text[offset++];
        if(separator==="}")return result;
        if(separator!==",")failure();
      }
    }
    if(character==="["){
      offset++;whitespace();const result:unknown[]=[];
      if(text[offset]==="]"){offset++;return result}
      while(true){
        result.push(value());whitespace();
        const separator=text[offset++];
        if(separator==="]")return result;
        if(separator!==",")failure();
      }
    }
    for(const [literal,parsed]of[["true",true],["false",false],["null",null]]as const){
      if(text.startsWith(literal,offset)){offset+=literal.length;return parsed}
    }
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));
    if(!match)return failure();
    offset+=match[0].length;
    const parsed=Number(match[0]);if(!Number.isFinite(parsed))failure();
    return parsed;
  };
  const result=value();whitespace();
  if(offset!==text.length)failure();
  return result;
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
