#!/usr/bin/env node
/**
 * nm-code-style §1/§4 检测：单点私有函数、死私有函数、单行转手 wrapper。
 * 类方法由 check-methods.mjs 单独审计。
 * 口径：按同文件标识符引用计数（启发式）；导出的符号交给 find-fake-exports.mjs。
 *
 * 用法：
 *   node .agents/skills/nm-code-style/scripts/check-inline.mjs --changed
 *   node .../check-inline.mjs packages/core/src/domain/chat/logic
 */

import ts from "typescript";
import { addedLineFilter, collectFiles, formatTable, forEachNode, lineOf, parseFlags, parseSource, toPosix } from "./lib/style-utils.mjs";

const flags = parseFlags(process.argv.slice(2));
const files = collectFiles(flags);
const rows = [];
const isAdded = addedLineFilter(flags.changed);

function report(file, sourceFile, node, verdict, name, refs, note) {
  const line = lineOf(sourceFile, node);
  if (isAdded(file, line)) rows.push([verdict, `${toPosix(file)}:${line}`, name, refs, note]);
}

function isExported(node, exportedNames) {
  const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0 || exportedNames.has(node.name?.text ?? "");
}

function isInside(node, ancestor) {
  let current = node;
  while (current != null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function passThroughCall(node) {
  if (node.body == null) return null;
  if (!ts.isBlock(node.body)) return ts.isCallExpression(node.body) || ts.isNewExpression(node.body) ? node.body : null;
  if (node.body.statements.length !== 1) return null;
  const statement = node.body.statements[0];
  if (!ts.isReturnStatement(statement) || statement.expression == null) return null;
  return ts.isCallExpression(statement.expression) || ts.isNewExpression(statement.expression) ? statement.expression : null;
}

function isParamDerived(arg, paramName) {
  if (ts.isIdentifier(arg)) return arg.text === paramName;
  if (ts.isParenthesizedExpression(arg) || ts.isAsExpression(arg) || ts.isSatisfiesExpression(arg) || ts.isNonNullExpression(arg)) return isParamDerived(arg.expression, paramName);
  if (ts.isCallExpression(arg)) {
    if (ts.isPropertyAccessExpression(arg.expression) && ts.isIdentifier(arg.expression.expression) && arg.expression.expression.text === paramName) return true;
    if (ts.isIdentifier(arg.expression) && ["String", "Number", "Boolean"].includes(arg.expression.text)) return true;
  }
  return false;
}

function isPassThrough(node, call) {
  const params = node.parameters;
  if (!params.every((param) => ts.isIdentifier(param.name) && param.initializer == null && param.dotDotDotToken == null)) return false;
  const args = call.arguments ?? [];
  return args.length === params.length && args.every((arg, index) => isParamDerived(arg, params[index].name.text));
}

function exportedNamesOf(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier != null || statement.exportClause == null || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) names.add((element.propertyName ?? element.name).text);
  }
  return names;
}

function keepDirective(node, sourceFile) {
  let statement = node;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent != null) statement = node.parent.parent;
  const comments = ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? [];
  return comments.map((range) => sourceFile.text.slice(range.pos, range.end)).find((text) => /nm-style:\s*(keep-local|keep-public)/.test(text)) ?? null;
}

for (const file of files) {
  const sourceFile = parseSource(file);
  const exportedNames = exportedNamesOf(sourceFile);
  const functions = [];
  forEachNode(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name != null) {
      functions.push({ name: node.name.text, nameNode: node.name, node });
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer != null && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functions.push({ name: node.name.text, nameNode: node.name, node: node.initializer });
    }
  });

  for (const fn of functions) {
    const directive = keepDirective(fn.node, sourceFile);
    const call = passThroughCall(fn.node);
    if (call != null && isPassThrough(fn.node, call) && directive == null) {
      report(file, sourceFile, fn.node, "PASS_THROUGH", fn.name, "", "return f(x|g(x)) 无策略薄包装");
    }
    if (isExported(fn.node, exportedNames)) continue;
    let calls = 0;
    let refs = 0;
    let internal = 0;
    forEachNode(sourceFile, (node) => {
      if (!ts.isIdentifier(node) || node.text !== fn.name || node === fn.nameNode) return;
      const parent = node.parent;
      if (parent == null) return;
      if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isQualifiedName(parent)) && (parent.name === node || parent.right === node)) return;
      if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return;
      if (isInside(node, fn.node)) {
        internal++;
        return;
      }
      if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) calls++;
      else refs++;
    });
    const external = calls + refs;
    if (external === 0) report(file, sourceFile, fn.node, "DEAD_LOCAL", fn.name, internal, internal > 0 ? "仅自递归" : "零引用");
    else if (external === 1) {
      const lines = lineOf(sourceFile, fn.node.getEnd()) - lineOf(sourceFile, fn.node) + 1;
      if (directive != null && /keep-local/.test(directive) && lines > 20) report(file, sourceFile, fn.node, "KEEP_LOCAL", fn.name, `${calls} call / ${refs} ref`, "nm-style 保留（需在报告说明理由）");
      else report(file, sourceFile, fn.node, "INLINE_LOCAL", fn.name, `${calls} call / ${refs} ref`, "只有一处外部引用，内联");
    }
  }
}

rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

if (flags.json) {
  console.log(JSON.stringify(rows.map(([verdict, location, name, refs, note]) => ({ verdict, location, name, refs, note })), null, 2));
} else {
  console.log(`check-inline: ${rows.length} 处（扫描 ${files.length} 个文件）`);
  if (rows.length > 0) console.log(formatTable(["verdict", "location", "name", "refs", "note"], rows));
  console.log("规则：单点私有函数内联；零引用私有函数删除；return f(x) 无策略 wrapper 删除；类方法看 check-methods；keep-local 仅限 >20 行有名字管线阶段，且需在报告说明。");
}

process.exit(rows.some(([verdict]) => verdict !== "KEEP_LOCAL") ? 1 : 0);
