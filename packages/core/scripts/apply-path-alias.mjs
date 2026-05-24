import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "test"];
/** Cross top-level src folders only; keep ../model and ../port within a domain module. */
const rules = [
  [/from "\.\.\/\.\.\/\.\.\/\.\.\//g, 'from "@/'],
  [/from "\.\.\/\.\.\/\.\.\//g, 'from "@/'],
  [/from "\.\.\/\.\.\//g, 'from "@/'],
  [
    /from "\.\.\//g,
    (match, offset, text) => {
      const after = text.slice(offset + match.length);
      if (/^(infra|domain|errors|service|bootstrap)\//.test(after)) {
        return 'from "@/';
      }
      return match;
    },
  ],
  [/from "\.\.\/\.\.\/src\//g, 'from "@/'],
  [/from "\.\.\/\.\.\/\.\.\/src\//g, 'from "@/'],
  [/from "@\/src\//g, 'from "@/'],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, files);
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

let updated = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    let text = readFileSync(file, "utf8");
    const original = text;
    for (const [pattern, replacement] of rules) {
      text = text.replace(pattern, replacement);
    }
    if (text !== original) {
      writeFileSync(file, text);
      updated += 1;
    }
  }
}

console.log(`Updated ${updated} files.`);
