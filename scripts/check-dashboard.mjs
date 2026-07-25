import fs from "node:fs";
const html=fs.readFileSync("apps/dashboard/index.html","utf8"),js=fs.readFileSync("apps/dashboard/src/app.js","utf8"),timeline=fs.readFileSync("apps/dashboard/src/timeline.js","utf8"),demo=fs.readFileSync("apps/dashboard/src/demo-entry.ts","utf8"),wallet=fs.readFileSync("apps/dashboard/src/wallet-action.ts","utf8"),bundle=fs.readFileSync("dist/apps/dashboard/demo.js","utf8");
for(const id of ["runtime-mode","live-notice","connection-status","timeline","job-select","inspector","packet-details","verification-details","policy-details","signer-details","quarantine-status","dead-letters","delivery-status","deliveries","recovery-action-status","recovery-actions","demo-workspace","demo-status","demo-connect","demo-record-label","demo-argument","demo-quote","demo-fee","demo-send","demo-transaction","demo-guid","demo-message"])if(!html.includes(`id="${id}"`))throw new Error(`missing dashboard target ${id}`);
for(const token of ["fetch(\"/health\"","fetch(\"/api/jobs\"","fetch(\"/api/dead-letters\"","fetch(\"/api/deliveries\"","fetch(\"/api/recovery-actions\"","LOCAL TEST","Signing intent","Destination submission","OPERATOR RECOVERY","3 of 5 approvals","deliveryByGuid","SIGNING","SUBMITTED","COORDINATOR UNAVAILABLE","No simulated state is shown","job.verifications","job.result","job.signers"])if(!`${html}\n${js}`.includes(token))throw new Error(`missing honest live-data behavior: ${token}`);
for(const token of ["deliveryTimelineIndex","SIGNING_EXPIRED","transactionHash","executionFailureCode"])if(!timeline.includes(token))throw new Error(`missing delivery timeline behavior: ${token}`);
for(const token of ["LOCAL TEST · FIXTURE POLICY","Connect wallet","Quote LayerZero fee","Packet emitted; Sentinel decision pending"])if(!html.includes(token)&&!demo.includes(token))throw new Error(`missing honest demo behavior: ${token}`);
for(const token of ["SEMANTIC ENGINE","PACKET PROOFS"])if(!html.includes(token))throw new Error(`missing honest operations label: ${token}`);
for(const claim of ["ETHEREUM SEPOLIA → ARBITRUM SEPOLIA","Sentinel independently proves","decentralized semantic consensus","requires isolated signer quorum","awaiting independent confirmations","verification independently confirmed","No independent provider verification recorded."])if(browserText(html,js).includes(claim))throw new Error(`dashboard overstates local or configured infrastructure: ${claim}`);
for(const token of ["fetch(\"/api/demo/config\"","sentinel:guid-observed","WalletActionClient","COORDINATOR_STAGE","executionFailureCode","/api/jobs/","/api/deliveries"])if(!demo.includes(token))throw new Error(`missing coordinator-bound demo behavior: ${token}`);
if(!js.includes("sentinel:guid-observed"))throw new Error("operations workspace does not receive observed GUIDs");
const browserSources=`${html}\n${js}\n${demo}\n${wallet}`;
const recoverySection=html.match(/<section class="operator-recovery"[\s\S]*?<\/section>/i)?.[0];if(!recoverySection)throw new Error("missing operator recovery audit section");
if(/<(button|form|input|select)\b/i.test(recoverySection))throw new Error("operator recovery dashboard must remain read-only");
if(/mockRecovery|sampleRecovery|simulated receipt/i.test(browserSources))throw new Error("dashboard contains simulated recovery evidence");
if(/demoJobs|mockJobs|samplePacket/i.test(browserSources))throw new Error("dashboard contains simulated job fallback");
if(/fetch\([^)]*,\s*\{[^}]*method\s*:\s*["'](POST|PUT|PATCH|DELETE)/is.test(browserSources))throw new Error("dashboard must not expose coordinator mutations");
if(/https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/i.test(browserSources)||/\bcdn\b/i.test(browserSources))throw new Error("dashboard must use self-origin assets only");
if(/private.?key|seed.?phrase|mnemonic/i.test(browserSources))throw new Error("dashboard must not request or embed wallet secrets");
if(!wallet.includes('method:"eth_sendTransaction"')||/personal_sign|eth_sign|eth_sendRawTransaction/.test(wallet))throw new Error("dashboard must delegate one ordinary transaction to the injected wallet");
if(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html))throw new Error("dashboard must not contain inline scripts");
if(/\bimport\s*\(/.test(bundle)||/^\s*import\s.+from\s+["']https?:/m.test(bundle))throw new Error("dashboard bundle must be self-contained");
console.log("validated dashboard live-data and no-simulation guardrails");

function browserText(...sources){return sources.join("\n")}
