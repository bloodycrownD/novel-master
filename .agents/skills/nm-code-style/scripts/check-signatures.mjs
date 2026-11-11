#!/usr/bin/env node
/**
 * nm-code-style §2「一行写完」检测。
 * 检测：多行函数参数、多行调用参数、多行 new 构造、1–3 个具名 import 却拆行、
 * const/赋值右侧简单表达式拆行。
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/check-signatures.mjs --changed
 *   node .../check-signatures.mjs packages/core/src/domain/chat/logic
 *   node .../check-signatures.mjs --include-tests --changed
 *   node .../check-signatures.mjs --since <base>        # <base>...HEAD 的新增行
 *   node .../check-signatures.mjs --range main...HEAD   # 指定 diff 范围的新增行
 */

import { execSync } from "node:child_process";
import ts from "typescript";
import { addedLineFilter, collectFiles, formatTable, forEachNode, isTestPath, lineOf, parseFlags, parseSource, toPosix } from "./lib/style-utils.mjs";

const argv = process.argv.slice(2);
const flags = parseFlags(argv);
const rangeFlagIndex = argv.findIndex((arg) => arg === "--range" || arg === "--since");
const rangeValue = rangeFlagIndex >= 0 ? argv[rangeFlagIndex + 1] : null;
const range = rangeValue == null || rangeValue.startsWith("--") ? null : argv[rangeFlagIndex] === "--since" ? `${rangeValue}...HEAD` : rangeValue;
const sources = range == null ? collectFiles(flags).map((file) => ({ file, text: null })) : collectRangeSources(range);
const rows = [];
const isAdded = range == null ? addedLineFilter(flags.changed) : addedLineFilterInRange(range);

function gitLines(command) {
  try {
    return execSync(command, { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** `--range/--since` 的扫描面：读 range 右端的 blob（不是工作树），结果不随并行编辑漂移。 */
function collectRangeSources(diffRange) {
  const end = diffRange.includes("...") ? diffRange.split("...")[1] : diffRange.includes("..") ? diffRange.split("..")[1] : diffRange;
  const revision = end || "HEAD";
  return gitLines(`git diff --name-only --diff-filter=ACM ${diffRange}`)
    .filter((rel) => /\.(ts|tsx)$/.test(rel) && (flags.includeTests || !isTestPath(rel)))
    .map((file) => ({ file, text: gitShow(revision, file) }))
    .filter((entry) => entry.text != null)
    .sort((a, b) => a.file.localeCompare(b.file));
}

function gitShow(revision, file) {
  try {
    return execSync(`git show ${revision}:${file}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function parseText(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** `--range/--since` 时只报该 diff 的新增行；未出现在 diff 的文件视为整文件。 */
function addedLineFilterInRange(diffRange) {
  const ranges = new Map();
  let current = null;
  for (const line of gitLines(`git diff ${diffRange} -U0`)) {
    if (line.startsWith("diff --git ")) current = null;
    else if (line.startsWith("+++ b/")) current = line.slice(6);
    else if (current != null && line.startsWith("@@")) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (match == null) continue;
      const start = Number(match[1]);
      const count = match[2] == null ? 1 : Number(match[2]);
      const list = ranges.get(current) ?? [];
      list.push([start, start + count - 1]);
      ranges.set(current, list);
    }
  }
  return (file, line) => {
    const list = ranges.get(toPosix(file));
    return list == null || list.some(([start, end]) => line >= start && line <= end);
  };
}

function report(file, sourceFile, node, kind, detail) {
  const line = lineOf(sourceFile, node);
  if (isAdded(file, line)) rows.push([kind, `${toPosix(file)}:${line}`, detail]);
}

function functionName(node, sourceFile) {
  if (node.name != null) return node.name.getText(sourceFile);
  if (node.parent != null && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return "(anonymous)";
}

function checkParameters(node, sourceFile, file) {
  const params = node.parameters;
  if (params.length === 0) return;
  const startLine = lineOf(sourceFile, node.getStart(sourceFile));
  const split = lineOf(sourceFile, params[0]) !== startLine || params.some((param, index) => index > 0 && lineOf(sourceFile, param) !== lineOf(sourceFile, params[index - 1]));
  if (split) report(file, sourceFile, node, "PARAMS", `${functionName(node, sourceFile)}(${params.length})`);
}

function checkArguments(node, sourceFile, file) {
  const args = node.arguments;
  if (args == null || args.length === 0) return;
  // 回调实参自身的函数体天然跨行：只跳过该实参，其余普通实参仍按「调用写一行」校验。
  // 有回调时不再用「首实参 vs 调用起点」判定（prettier 必因回调体拆行）；只看普通实参之间是否拆行。
  const callbacks = args.filter((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
  const regular = args.filter((arg) => !ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg));
  if (regular.length === 0) return;
  const startLine = lineOf(sourceFile, node.getStart(sourceFile));
  const split =
    (callbacks.length === 0 && regular[0] === args[0] && lineOf(sourceFile, regular[0]) !== startLine) ||
    regular.some((arg, index) => index > 0 && lineOf(sourceFile, arg) !== lineOf(sourceFile, regular[index - 1]));
  if (split) report(file, sourceFile, node, "ARGS", node.expression.getText(sourceFile).slice(0, 80));
}

function checkImport(node, sourceFile, file) {
  const bindings = node.importClause?.namedBindings;
  if (bindings == null || !ts.isNamedImports(bindings)) return;
  const elements = bindings.elements;
  if (elements.length === 0 || elements.length > 3) return;
  // 长 import 的一行形式必然超过 prettier printWidth；这种拆行不是风格问题。
  const oneLine = node.getText(sourceFile).replace(/\s+/g, " ");
  if (oneLine.length > 80) return;
  const startLine = lineOf(sourceFile, node.getStart(sourceFile));
  const split = lineOf(sourceFile, elements[0]) !== startLine || elements.some((element, index) => index > 0 && lineOf(sourceFile, element) !== lineOf(sourceFile, elements[index - 1]));
  if (split) report(file, sourceFile, node, "IMPORT", `${elements.length} 个具名导入`);
}

function isBlockExpression(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isAwaitExpression(current)) current = current.expression;
  return ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isClassExpression(current) || ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current) || ts.isTemplateExpression(current);
}

function checkOneLineValue(node, value, startLine, sourceFile, file, kind, detail) {
  if (value == null) return;
  const valueLine = lineOf(sourceFile, value);
  const valueEndLine = lineOf(sourceFile, value.getEnd());
  const moved = valueLine !== startLine;
  const multiline = valueLine !== valueEndLine;
  if (isBlockExpression(value)) {
    if (moved && !multiline) report(file, sourceFile, node, kind, detail);
    return;
  }
  if (!moved && multiline && (ts.isCallExpression(value) || ts.isNewExpression(value))) return;
  if (moved || multiline) report(file, sourceFile, node, kind, detail);
}

function checkVariable(node, sourceFile, file) {
  if (!ts.isVariableDeclaration(node) || node.initializer == null) return;
  if (lineOf(sourceFile, node.name) !== lineOf(sourceFile, node.name.getEnd())) return;
  if (node.type != null && lineOf(sourceFile, node.type) !== lineOf(sourceFile, node.type.getEnd())) return;
  checkOneLineValue(node, node.initializer, lineOf(sourceFile, node.name.getEnd()), sourceFile, file, "VARDECL", node.name.getText(sourceFile));
}

function checkAssignment(node, sourceFile, file) {
  if (!ts.isAssignmentExpression(node)) return;
  checkOneLineValue(node, node.right, lineOf(sourceFile, node.left.getEnd()), sourceFile, file, "ASSIGN", node.left.getText(sourceFile).slice(0, 80));
}

for (const { file, text } of sources) {
  const sourceFile = text == null ? parseSource(file) : parseText(file, text);
  forEachNode(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) checkParameters(node, sourceFile, file);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) checkArguments(node, sourceFile, file);
    if (ts.isImportDeclaration(node)) checkImport(node, sourceFile, file);
    if (ts.isVariableDeclaration(node)) checkVariable(node, sourceFile, file);
    if (ts.isAssignmentExpression(node)) checkAssignment(node, sourceFile, file);
  });
}

rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

if (flags.json) {
  console.log(JSON.stringify(rows.map(([kind, location, detail]) => ({ kind, location, detail })), null, 2));
} else {
  console.log(`check-signatures: ${rows.length} 处（扫描 ${sources.length} 个文件）`);
  if (rows.length > 0) console.log(formatTable(["kind", "location", "detail"], rows));
  console.log("规则：函数签名 / 调用参数 / new 错误构造 / 短 import / const 或赋值右侧简单表达式都写一行；放不下就减参数、缩短名字或拆成有名字的中间变量。");
}

process.exit(rows.length > 0 ? 1 : 0);
