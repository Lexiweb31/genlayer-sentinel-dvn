import {build} from "esbuild";

await build({
  entryPoints:["apps/dashboard/src/demo-entry.ts"],
  outfile:"dist/apps/dashboard/demo.js",
  bundle:true,
  format:"esm",
  platform:"browser",
  target:["es2022"],
  sourcemap:false,
  legalComments:"none"
});
