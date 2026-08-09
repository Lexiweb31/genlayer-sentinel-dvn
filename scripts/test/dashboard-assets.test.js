import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";

const assets=[
  ["apps/dashboard/assets/sentinel-network-loop.mp4","547fddfb71d644a47c9e268868ff557eae8ad8934a2b0b7b445f2c765e4709a4",5_000_000],
  ["apps/dashboard/assets/sentinel-network-poster.jpg","1c7db6b9ca74d9017faad3e989539a44c5a0d6b680ad3d20ad6d62974557d3f3",100_000],
  ["apps/dashboard/assets/geist-latin.woff2","9b6f5ff45b278c744b5f379a2c4ecbaf858a842b8eaf82ac8d21b699ca16c608",100_000],
  ["apps/dashboard/assets/special-elite-latin.woff2","3cf06771841c778db94dfc003a9239338613c07a9e8c8125d0641a1ba6e7977a",100_000]
];

test("dashboard visual assets match reviewed bytes and web size limits",async()=>{
  for(const[path,digest,maxBytes]of assets){
    const bytes=await readFile(path),metadata=await stat(path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
    assert.ok(metadata.size>0&&metadata.size<=maxBytes,`${path} exceeds ${maxBytes}`);
  }
});
