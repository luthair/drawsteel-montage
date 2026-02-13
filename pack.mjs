#!/usr/bin/env node
/**
 * Creates drawsteel-montage.zip for distribution.
 * Run: npm run build && npm run pack
 * Then upload the zip to a GitHub release.
 */
import { readdirSync, statSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const INCLUDED = [
  "module.json",
  "drawsteel-montage.js",
  "drawsteel-montage.css",
  "lang",
  "templates",
  "README.md",
  "LICENSE",
];

const AdmZip = (() => {
  try {
    return createRequire(import.meta.url)("adm-zip");
  } catch {
    console.error("Run: npm install adm-zip --save-dev");
    process.exit(1);
  }
})();

const zip = new AdmZip();

function addPath(relPath) {
  const full = join(root, relPath);
  try {
    const st = statSync(full);
    if (st.isDirectory()) {
      zip.addLocalFolder(full, relPath);
    } else if (st.isFile()) {
      zip.addLocalFile(full, relPath);
    }
  } catch (e) {
    if (relPath === "LICENSE" && e.code === "ENOENT") return;
    console.warn("Skip (missing):", relPath);
  }
}

for (const p of INCLUDED) {
  addPath(p);
}

const outZip = join(root, "drawsteel-montage.zip");
zip.writeZip(outZip);
console.log("Created:", outZip);
