import {createHash} from "node:crypto";
import {copyFile,cp,mkdir,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,join,resolve} from "node:path";

const EXPECTED_ASSETS=[
  "ASSET_PROVENANCE.md",
  "geist-latin.woff2",
  "og.png",
  "sentinel-network-loop.mp4",
  "sentinel-network-poster.jpg",
  "special-elite-latin.woff2"
];
const OG_SHA256="fbc94eafe380f47b5d2c47067222153c70dc49ef43c72b2568f44ae038c5386a";
const COPIES=[
  ["apps/dashboard/src/app.js","src/app.js"],
  ["apps/dashboard/src/delivery.css","src/delivery.css"],
  ["apps/dashboard/src/demo.css","src/demo.css"],
  ["apps/dashboard/src/hero-motion.js","src/hero-motion.js"],
  ["apps/dashboard/src/landing.css","src/landing.css"],
  ["apps/dashboard/src/landing.js","src/landing.js"],
  ["apps/dashboard/src/pathway-audit.js","src/pathway-audit.js"],
  ["apps/dashboard/src/recovery.css","src/recovery.css"],
  ["apps/dashboard/src/runtime-status.js","src/runtime-status.js"],
  ["apps/dashboard/src/style.css","src/style.css"],
  ["apps/dashboard/src/timeline.js","src/timeline.js"],
  ["dist/apps/dashboard/demo.js","assets/demo.js"],
  ["apps/dashboard/assets/geist-latin.woff2","assets/geist-latin.woff2"],
  ["apps/dashboard/assets/og.png","assets/og.png"],
  ["apps/dashboard/assets/sentinel-network-loop.mp4","assets/sentinel-network-loop.mp4"],
  ["apps/dashboard/assets/sentinel-network-poster.jpg","assets/sentinel-network-poster.jpg"],
  ["apps/dashboard/assets/special-elite-latin.woff2","assets/special-elite-latin.woff2"]
];

export async function buildHostedDashboard({root=process.cwd()}={}){
  const projectRoot=resolve(root);
  await validateAssets(projectRoot);
  const sourceHtml=await readFile(join(projectRoot,"apps/dashboard/index.html"),"utf8");
  const consoleHtml=await readFile(join(projectRoot,"apps/dashboard/console/index.html"),"utf8");
  const localImage='content="/assets/og.png"';
  if(sourceHtml.split(localImage).length-1!==2||sourceHtml.includes("__SITE_ORIGIN__"))throw new Error("dashboard metadata must contain exactly two local social images");
  for(const[source]of COPIES)await readFile(join(projectRoot,source));
  await readFile(join(projectRoot,"apps/dashboard/src/hosted-worker.js"));

  const publicRoot=join(projectRoot,"dist/public"),clientRoot=join(projectRoot,"dist/client"),serverRoot=join(projectRoot,"dist/server");
  await rm(publicRoot,{recursive:true,force:true});
  await rm(clientRoot,{recursive:true,force:true});
  await rm(serverRoot,{recursive:true,force:true});
  await mkdir(publicRoot,{recursive:true});
  await mkdir(serverRoot,{recursive:true});

  for(const[source,destination]of COPIES){
    const output=join(publicRoot,destination);
    await mkdir(dirname(output),{recursive:true});
    await copyFile(join(projectRoot,source),output);
  }
  const hostedHtml=sourceHtml.replaceAll(localImage,'content="__SITE_ORIGIN__/assets/og.png"');
  await writeFile(join(publicRoot,"index.html"),hostedHtml,"utf8");
  const publicConsole=join(publicRoot,"console/index.html");
  await mkdir(dirname(publicConsole),{recursive:true});
  await writeFile(publicConsole,consoleHtml,"utf8");
  await cp(publicRoot,clientRoot,{recursive:true});
  const clientConsole=join(clientRoot,"console/index.html");
  await mkdir(dirname(clientConsole),{recursive:true});
  await writeFile(clientConsole,consoleHtml,"utf8");
  await copyFile(join(projectRoot,"apps/dashboard/src/hosted-worker.js"),join(serverRoot,"index.js"));
  return{publicRoot,clientRoot,serverRoot};
}

async function validateAssets(root){
  const directory=join(root,"apps/dashboard/assets");
  const entries=await readdir(directory,{withFileTypes:true});
  const names=entries.map(entry=>entry.name).sort();
  for(const expected of EXPECTED_ASSETS)if(!names.includes(expected))throw new Error(`missing dashboard asset: ${expected}`);
  for(const entry of entries){
    if(!entry.isFile())throw new Error(`unexpected dashboard asset: ${entry.name}`);
    if(!EXPECTED_ASSETS.includes(entry.name))throw new Error(`unexpected dashboard asset: ${entry.name}`);
  }
  const og=await readFile(join(directory,"og.png"));
  if(createHash("sha256").update(og).digest("hex")!==OG_SHA256)throw new Error("dashboard social image digest mismatch");
  if(og.length<24||og.toString("hex",0,8)!=="89504e470d0a1a0a"||og.readUInt32BE(16)!==1200||og.readUInt32BE(20)!==630)throw new Error("dashboard social image must be a 1200x630 PNG");
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)await buildHostedDashboard();
