import { build } from "esbuild";

const banner = { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" };
const entries = [
  ["src/check.ts", "check/dist/index.mjs"],
  ["src/record-main.ts", "record/dist/main.mjs"],
  ["src/record-post.ts", "record/dist/post.mjs"],
  ["src/watch.ts", "record/dist/watch.mjs"],
  ["src/gate.ts", "gate/dist/index.mjs"],
  ["src/plan.ts", "plan/dist/index.mjs"],
  ["src/await.ts", "await/dist/index.mjs"],
  ["src/fanout.ts", "fanout/dist/index.mjs"],
];
for (const [entry, outfile] of entries) {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", target: "node24", format: "esm", banner, legalComments: "none" });
}
