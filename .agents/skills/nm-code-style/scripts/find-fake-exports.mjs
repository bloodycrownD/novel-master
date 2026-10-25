#!/usr/bin/env node
/**
 * 找出「假引用 / 假公开」候选。
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs
 *   node ... packages/core/src/domain/character-card
 *
 * 口径：
 * - 生产引用：packages/<pkg>/src 与 apps/<app>/src 里对定义文件的直接 import；
 * - 测试引用单独统计，不算生产引用；
 * - public allowlist 里有名字单独标 public，不算引用；
 * - 只统计直接 import 定义文件；经 barrel 转发的引用会漏计，需人工补看。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();
const targetArg = process.argv[2] ?? "packages/core/src";
const targetPath = path.resolve(repoRoot, targetArg);
const snapshotDir = path.join(repoRoot, "packages/core/test/package-exports/snapshots");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktree", "coverage"]);

function walk(entry, out = []) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(entry);
    return out;
  }
  for (const name of fs.readdirSync(entry)) {
    if (SKIP_DIRS.has(name)) continue;
    walk(path.join(entry, name), out);
  }
  return out;
}

function toPosix(file) {
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

function isTestPath(rel) {
  return rel.includes("/test/") || rel.includes("/__tests__/") || /\.(test|spec)\.tsx?$/.test(rel);
}

function isProductionPath(rel) {
  if (isTestPath(rel)) return false;
  if (rel.startsWith("packages/core/src/public/")) return false;
  return /^packages\/[^/]+\/src\//.test(rel) || /^apps\/[^/]+\/src\//.test(rel) || /^apps\/desktop\/(renderer|shared|src)\//.test(rel);
}

function hasExportModifier(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function exportedSymbols(file) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const symbols = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name != null) {
      symbols.push({name: statement.name.text, line: lineOf(statement)});
    } else if (ts.isClassDeclaration(statement) && statement.name != null) {
      symbols.push({name: statement.name.text, line: lineOf(statement)});
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          symbols.push({name: declaration.name.text, line: lineOf(declaration)});
        }
      }
    }
  }
  return symbols;
}

function importedNames(file) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings == null || !ts.isNamedImports(bindings)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    for (const element of bindings.elements) {
      imports.push({name: (element.propertyName ?? element.name).text, moduleSpecifier});
    }
  }
  return imports;
}

function publicNames() {
  const names = new Set();
  if (!fs.existsSync(snapshotDir)) return names;
  for (const file of fs.readdirSync(snapshotDir)) {
    if (!file.endsWith(".json")) continue;
    const value = JSON.parse(fs.readFileSync(path.join(snapshotDir, file), "utf8"));
    if (Array.isArray(value)) {
      for (const name of value) names.add(name);
    }
  }
  return names;
}

function moduleMatchesSpecifier(specifier, definingFile) {
  const base = path.basename(definingFile).replace(/\.(ts|tsx)$/, "");
  const clean = specifier.replace(/\.(js|ts|tsx)$/, "");
  return clean === base || clean.endsWith(`/${base}`);
}

const targetFiles = walk(targetPath);
const definitions = [];
for (const file of targetFiles) {
  for (const symbol of exportedSymbols(file)) {
    definitions.push({...symbol, file, rel: toPosix(file)});
  }
}

const allFiles = [
  ...walk(path.join(repoRoot, "packages")),
  ...walk(path.join(repoRoot, "apps")),
];
const prodRefs = new Map();
const testRefs = new Map();
for (const definition of definitions) {
  prodRefs.set(definition.name, new Set());
  testRefs.set(definition.name, new Set());
}

for (const file of allFiles) {
  const rel = toPosix(file);
  const production = isProductionPath(rel);
  const test = isTestPath(rel);
  if (!production && !test) continue;
  for (const imported of importedNames(file)) {
    for (const definition of definitions) {
      if (definition.name !== imported.name) continue;
      if (rel === definition.rel) continue;
      if (!moduleMatchesSpecifier(imported.moduleSpecifier, definition.file)) continue;
      (production ? prodRefs : testRefs).get(definition.name).add(rel);
    }
  }
}

const publics = publicNames();
const verdictOrder = new Map([
  ["FAKE_PUBLIC", 0],
  ["TEST_ONLY", 1],
  ["INLINE_CANDIDATE", 2],
  ["PUBLIC_ONE_REF", 3],
  ["DEAD", 4],
  ["KEEP", 5],
]);

const rows = definitions.map((definition) => {
  const prod = prodRefs.get(definition.name).size;
  const test = testRefs.get(definition.name).size;
  const isPublic = publics.has(definition.name);
  let verdict;
  if (isPublic && prod === 0) verdict = "FAKE_PUBLIC";
  else if (!isPublic && prod === 0 && test > 0) verdict = "TEST_ONLY";
  else if (!isPublic && prod === 0) verdict = "DEAD";
  else if (!isPublic && prod === 1) verdict = "INLINE_CANDIDATE";
  else if (isPublic && prod === 1) verdict = "PUBLIC_ONE_REF";
  else verdict = "KEEP";
  return {...definition, prod, test, public: isPublic ? "yes" : "", verdict};
});

rows.sort((a, b) => (verdictOrder.get(a.verdict) - verdictOrder.get(b.verdict)) || a.name.localeCompare(b.name));

const header = ["verdict", "prod", "test", "public", "name", "location"];
const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => String([row.verdict, row.prod, row.test, row.public, row.name, `${row.rel}:${row.line}`][index]).length)));
const format = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join("  ");
console.log(format(header));
console.log(widths.map((width) => "-".repeat(width)).join("  "));
for (const row of rows) {
  console.log(format([row.verdict, row.prod, row.test, row.public, row.name, `${row.rel}:${row.line}`]));
}
console.log("");
const counts = rows.reduce((acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }), {});
console.log(`summary: ${Object.entries(counts).map(([verdict, count]) => `${verdict}=${count}`).join("  ")}`);
console.log("说明：prod=生产 import 文件数；test=测试 import 文件数；public=allowlist 有名字。");
console.log("测试 import 不算消费者；allowlist 不算消费者。INLINE_CANDIDATE 需再判断是否跨层唯一入口。");
console.log("经 barrel 转发的 import 不会计入 prod，需人工补看。");
