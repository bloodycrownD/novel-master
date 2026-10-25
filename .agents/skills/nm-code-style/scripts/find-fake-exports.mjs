#!/usr/bin/env node
/**
 * 找出「假引用 / 假公开 / 死导出 / 单点导出」候选。
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs
 *   node ... packages/core/src/domain/character-card
 *   node ... packages/core/src/domain/chat/logic --strict
 *
 * 口径（v2）：
 * - 生产引用 = `packages/<pkg>/src`、`apps/<app>/src`、`apps/desktop/(renderer|shared|src)` 里的
 *   **调用点 + 值引用点**；不再只数「直接 import 定义文件」的文件数。
 * - 解析 named import 与 `as` 别名；经 `@novel-master/core/chat` / `@shared/logic/chat`
 *   等 barrel 转发的调用也能计入。namespace import 的 `ns.foo()` 也计入。
 * - 测试引用单独统计，不算生产消费者；public allowlist 不算消费者。
 * - 同名多定义 → AMBIGUOUS（计数按名字合并，需人工看）。
 * - 类与常量不做 INLINE_CANDIDATE：类保留状态/行为边界；大写常量是命名契约。
 * - 仍是启发式：同名遮蔽、动态属性、跨包重建导出需人工复核。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const targetArg = args.find((arg) => !arg.startsWith("--")) ?? "packages/core/src";
const repoRoot = process.cwd();
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
    if (!SKIP_DIRS.has(name)) walk(path.join(entry, name), out);
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

function parseSource(file) {
  const text = fs.readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function hasExportModifier(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function exportedSymbols(sourceFile) {
  const symbols = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const keepPublicOf = (statement) => {
    const comments = ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? [];
    return comments.some((range) => /nm-style:\s*(keep-public|public-one-ref)/.test(sourceFile.text.slice(range.pos, range.end)));
  };
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    const keepPublic = keepPublicOf(statement);
    if (ts.isFunctionDeclaration(statement) && statement.name != null) {
      symbols.push({ name: statement.name.text, kind: "function", line: lineOf(statement), keepPublic });
    } else if (ts.isClassDeclaration(statement) && statement.name != null) {
      symbols.push({ name: statement.name.text, kind: "class", line: lineOf(statement), keepPublic });
    } else if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name != null) {
      symbols.push({ name: statement.name.text, kind: "type", line: lineOf(statement), keepPublic });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        const kind = initializer != null && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? "function" : "variable";
        symbols.push({ name: declaration.name.text, kind, line: lineOf(declaration), keepPublic });
      }
    }
  }
  return symbols;
}

function publicNames() {
  const names = new Set();
  if (!fs.existsSync(snapshotDir)) return names;
  for (const file of fs.readdirSync(snapshotDir)) {
    if (!file.endsWith(".json")) continue;
    const value = JSON.parse(fs.readFileSync(path.join(snapshotDir, file), "utf8"));
    if (Array.isArray(value)) for (const name of value) names.add(name);
  }
  return names;
}

function increment(map, name) {
  map.set(name, (map.get(name) ?? 0) + 1);
}

function skipIdentifier(node) {
  const parent = node.parent;
  if (parent == null) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isExportAssignment(parent)) return true;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return true;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) return true;
  return false;
}

const targetFiles = walk(targetPath);
const targetSources = new Map();
const definitions = [];
for (const file of targetFiles) {
  const sourceFile = parseSource(file);
  targetSources.set(file, sourceFile);
  for (const symbol of exportedSymbols(sourceFile)) definitions.push({ ...symbol, file, rel: toPosix(file) });
}

const definitionsByName = new Map();
for (const definition of definitions) {
  const list = definitionsByName.get(definition.name) ?? [];
  list.push(definition);
  definitionsByName.set(definition.name, list);
}
const uniqueNames = new Set([...definitionsByName].filter(([, list]) => list.length === 1).map(([name]) => name));

const allFiles = [...walk(path.join(repoRoot, "packages")), ...walk(path.join(repoRoot, "apps"))];
const prodCalls = new Map();
const prodRefs = new Map();
const testCalls = new Map();
const testRefs = new Map();

for (const file of allFiles) {
  const rel = toPosix(file);
  const production = isProductionPath(rel);
  const test = isTestPath(rel);
  if (!production && !test) continue;
  const sourceFile = parseSource(file);
  const importedNames = new Set();
  const aliases = new Map();
  const namespaceLocals = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings != null && ts.isNamespaceImport(bindings)) namespaceLocals.add(bindings.name.text);
    if (bindings == null || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (!uniqueNames.has(imported)) continue;
      const local = element.name.text;
      importedNames.add(imported);
      if (local !== imported) aliases.set(local, imported);
    }
  }
  const definingNames = new Set(definitions.filter((definition) => definition.rel === rel).map((definition) => definition.name));
  const targets = new Set([...importedNames].filter((name) => !definingNames.has(name)));
  if (targets.size === 0 && namespaceLocals.size === 0) continue;
  const targetFor = (identifier) => aliases.get(identifier.text) ?? (targets.has(identifier.text) ? identifier.text : null);
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        const name = targetFor(expression);
        if (name != null) increment(production ? prodCalls : testCalls, name);
      } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && ts.isIdentifier(expression.name) && namespaceLocals.has(expression.expression.text) && uniqueNames.has(expression.name.text)) {
        increment(production ? prodCalls : testCalls, expression.name.text);
      }
    } else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = targetFor(node.typeName);
      if (name != null && (definitionsByName.get(name) ?? []).some((definition) => definition.kind === "type" || definition.kind === "class")) increment(production ? prodRefs : testRefs, name);
    } else if (ts.isTypeQueryNode(node) && ts.isIdentifier(node.exprName)) {
      const name = targetFor(node.exprName);
      if (name != null) increment(production ? prodRefs : testRefs, name);
    } else if (ts.isIdentifier(node) && !skipIdentifier(node)) {
      const name = targetFor(node);
      if (name != null) increment(production ? prodRefs : testRefs, name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const localCalls = new Map();
for (const [file, sourceFile] of targetSources) {
  const names = new Set(definitions.filter((definition) => definition.file === file).map((definition) => definition.name));
  if (names.size === 0) continue;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) increment(localCalls, node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const publics = publicNames();
const verdictOrder = new Map([
  ["FAKE_PUBLIC", 0],
  ["DEAD", 1],
  ["TEST_ONLY", 2],
  ["INLINE_CANDIDATE", 3],
  ["AMBIGUOUS", 4],
  ["KEEP", 5],
]);

const rows = definitions.map((definition) => {
  const name = definition.name;
  const calls = (prodCalls.get(name) ?? 0) + (localCalls.get(name) ?? 0);
  const refs = prodRefs.get(name) ?? 0;
  const testCallCount = testCalls.get(name) ?? 0;
  const testRefCount = testRefs.get(name) ?? 0;
  const prod = calls + refs;
  const test = testCallCount + testRefCount;
  const isPublic = publics.has(name);
  const duplicate = (definitionsByName.get(name)?.length ?? 0) > 1;
  let verdict;
  if (duplicate) verdict = "AMBIGUOUS";
  else if (prod === 0 && isPublic) verdict = definition.keepPublic ? "KEEP" : "FAKE_PUBLIC";
  else if (prod === 0 && test > 0) verdict = "TEST_ONLY";
  else if (prod === 0) verdict = "DEAD";
  else if (prod === 1 && definition.kind === "function" && calls === 1 && refs === 0) verdict = definition.keepPublic ? "KEEP" : "INLINE_CANDIDATE";
  else verdict = "KEEP";
  return { ...definition, calls, refs, testCalls: testCallCount, testRefs: testRefCount, prod, test, public: isPublic ? "yes" : "", verdict };
});

rows.sort((a, b) => (verdictOrder.get(a.verdict) - verdictOrder.get(b.verdict)) || a.name.localeCompare(b.name));

const header = ["verdict", "prod", "test", "public", "kind", "name", "location"];
const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => String([row.verdict, `${row.calls}c/${row.refs}r`, `${row.testCalls}c/${row.testRefs}r`, row.public, row.kind, row.name, `${row.rel}:${row.line}`][index]).length)));
const format = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join("  ");
console.log(format(header));
console.log(widths.map((width) => "-".repeat(width)).join("  "));
for (const row of rows) {
  console.log(format([row.verdict, `${row.calls}c/${row.refs}r`, `${row.testCalls}c/${row.testRefs}r`, row.public, row.kind, row.name, `${row.rel}:${row.line}`]));
}

const counts = rows.reduce((acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }), {});
console.log("");
console.log(`summary: ${Object.entries(counts).map(([verdict, count]) => `${verdict}=${count}`).join("  ")}`);
console.log("prod/test = 生产/测试代码里的 调用点/值引用点（prod 含同文件调用）；已解析 named import、as 别名与 barrel 转发。");
console.log("同名多定义 → AMBIGUOUS；类与常量不做 INLINE_CANDIDATE；测试 import / allowlist 不算消费者。");
console.log("仍是启发式：同名遮蔽、动态属性、跨包重建导出需人工复核。--strict 时 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE 退出码 1。");
console.log("INLINE_CANDIDATE 默认内联；public=yes 只表示还要撤 barrel/allowlist，不是保留理由。确认不能内联时写 `nm-style: keep-public — 理由`，并在交付报告列未处理项。");

if (strict && rows.some((row) => ["FAKE_PUBLIC", "DEAD", "TEST_ONLY", "INLINE_CANDIDATE"].includes(row.verdict))) process.exitCode = 1;
