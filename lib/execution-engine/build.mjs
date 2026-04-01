import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  external: [
    "@google-cloud/bigquery",
    "@google-cloud/secret-manager",
    "pg",
    "drizzle-orm",
    "drizzle-orm/*",
  ],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});

console.log("Build complete: dist/index.mjs");
