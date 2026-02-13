#!/usr/bin/env node
import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: [join(__dirname, "src/module/main.ts")],
  bundle: true,
  format: "esm",
  outfile: join(__dirname, "drawsteel-montage.js"),
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  console.log("Build complete.");
}
