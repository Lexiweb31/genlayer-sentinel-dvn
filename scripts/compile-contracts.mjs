import fs from "node:fs"; import path from "node:path"; import solc from "solc";
const root=process.cwd(); const files=["contracts/src/SentinelDVNAdapter.sol","contracts/src/TreasuryPolicyOApp.sol","contracts/test/MockVerificationTarget.sol"];
const sources=Object.fromEntries(files.map(f=>[f,{content:fs.readFileSync(f,"utf8")}]))
function findImports(name){for(const base of [root,path.join(root,"node_modules")]){const p=path.join(base,name);if(fs.existsSync(p))return{contents:fs.readFileSync(p,"utf8")}}return{error:`not found: ${name}`}}
const input={language:"Solidity",sources,settings:{evmVersion:"shanghai",optimizer:{enabled:true,runs:200},outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}}};
const out=JSON.parse(solc.compile(JSON.stringify(input),{import:findImports})); const errors=(out.errors??[]).filter(e=>e.severity==="error"); if(errors.length){for(const e of errors)console.error(e.formattedMessage);process.exit(1)}
fs.mkdirSync("dist/contracts",{recursive:true}); for(const [file,contracts] of Object.entries(out.contracts)){for(const [name,a] of Object.entries(contracts)){if(files.includes(file))fs.writeFileSync(`dist/contracts/${name}.json`,JSON.stringify(a,null,2))}}
console.log(`compiled ${files.length} Solidity sources with solc ${solc.version()}`);
