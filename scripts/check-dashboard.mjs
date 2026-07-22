import fs from "node:fs";
const html=fs.readFileSync("apps/dashboard/index.html","utf8"),js=fs.readFileSync("apps/dashboard/src/app.js","utf8");
for(const id of ["live-notice","connection-status","timeline","job-select","inspector","packet-details","verification-details","policy-details","signer-details","quarantine-status","dead-letters"])if(!html.includes(`id="${id}"`))throw new Error(`missing dashboard target ${id}`);
for(const token of ["fetch(\"/api/jobs\"","fetch(\"/api/dead-letters\"","COORDINATOR UNAVAILABLE","No simulated state is shown","job.verifications","job.result","job.signers"])if(!js.includes(token))throw new Error(`missing honest live-data behavior: ${token}`);
if(/demoJobs|mockJobs|samplePacket/i.test(js))throw new Error("dashboard contains simulated job fallback");
if(/fetch\([^)]*,\s*\{[^}]*method\s*:\s*["'](POST|PUT|PATCH|DELETE)/is.test(js))throw new Error("dashboard must remain read-only");
console.log("validated dashboard live-data and no-simulation guardrails");
