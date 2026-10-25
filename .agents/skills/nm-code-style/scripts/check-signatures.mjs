#!/usr/bin/env node
/**
 * nm-code-style §2「一行写完」检测。
 * 检测：多行函数参数、多行调用参数、多行 new 构造、1–3 个具名 import 却拆行。
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/check-signatures.mjs --changed
 *   node .../check-signatures.mjs packages/core/src/domain/chat/logic
 *   node .../check-signatures.mjs --include-tests --changed
 */

import ts from "typescript";
import { addedLineFilter, collectFiles, formatTable, forEachNode, lineOf, parseFlags, parseSource, toPosix } from "./lib/style-utils.mjs";

const flags = parseFlags(process.argv.slice(2));
const files = collectFiles(flags);
const rows = [];
const isAdded = addedLineFilter(flags.changed);

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
  if (params.length < 2) return;
  const split = params.some((param, index) => index > 0 && lineOf(sourceFile, param) !== lineOf(sourceFile, params[index - 1]));
  if (split) report(file, sourceFile, node, "PARAMS", `${functionName(node, sourceFile)}(${params.length})`);
}

function checkArguments(node, sourceFile, file) {
  const args = node.arguments;
  if (args == null || args.length < 2) return;
  const split = args.some((arg, index) => index > 0 && lineOf(sourceFile, arg) !== lineOf(sourceFile, args[index - 1]));
  if (split) report(file, sourceFile, node, "ARGS", node.expression.getText(sourceFile).slice(0, 80));
}

function checkImport(node, sourceFile, file) {
  const bindings = node.importClause?.namedBindings;
  if (bindings == null || !ts.isNamedImports(bindings)) return;
  const elements = bindings.elements;
  if (elements.length < 2 || elements.length > 3) return;
  const split = elements.some((element, index) => index > 0 && lineOf(sourceFile, element) !== lineOf(sourceFile, elements[index - 1]));
  if (split) report(file, sourceFile, node, "IMPORT", `${elements.length} 个具名导入`);
}

for (const file of files) {
  const sourceFile = parseSource(file);
  forEachNode(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) checkParameters(node, sourceFile, file);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) checkArguments(node, sourceFile, file);
    if (ts.isImportDeclaration(node)) checkImport(node, sourceFile, file);
  });
}

rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

if (flags.json) {
  console.log(JSON.stringify(rows.map(([kind, location, detail]) => ({ kind, location, detail })), null, 2));
} else {
  console.log(`check-signatures: ${rows.length} 处（扫描 ${files.length} 个文件）`);
  if (rows.length > 0) console.log(formatTable(["kind", "location", "detail"], rows));
  console.log("规则：函数签名 / 调用参数 / new 错误构造 / 短 import 都写一行；放不下就减参数或缩短名字。");
}

process.exit(rows.length > 0 ? 1 : 0);
