#!/usr/bin/env node
/**
 * nm-code-style §1/§9：类方法审计（只读、启发式）。
 *
 * 覆盖 check-inline 不处理的类内方法：
 *   DEAD_METHOD       生产引用 0
 *   INLINE_METHOD     生产引用 1
 *   PASS_THROUGH_METHOD  方法体只是 return this.f(x) / return f(x)
 *   DEPRECATED_DEAD   @deprecated 且生产引用 0
 *   AMBIGUOUS_METHOD  同名方法在多个类出现，按名字计数不可靠
 *
 * 口径：只数 packages/apps 的非测试源码里的 `obj.method` / `this.method`；
 * 不是类型感知的符号引用，接口/动态调用可能漏计，报告是线索不是判决。
 *
 * 用法：
 *   node .../check-methods.mjs --changed
 *   node .../check-methods.mjs packages/core/src/domain/chat/logic/message
 */

import ts from "typescript";
import { addedLineFilter, collectFiles, formatTable, forEachNode, lineOf, parseFlags, parseSource, toPosix } from "./lib/style-utils.mjs";

const flags = parseFlags(process.argv.slice(2));
const targetFiles = collectFiles(flags);
const referenceFiles = [...new Set([...collectFiles({ ...flags, changed: false, paths: ["packages", "apps"] }), ...targetFiles])];
const isAdded = addedLineFilter(flags.changed);
const rows = [];

function hasModifier(node, flag) {
  return (ts.getCombinedModifierFlags(node) & flag) !== 0;
}

function isPrivateMethod(node) {
  return ts.isPrivateIdentifier(node.name) || hasModifier(node, ts.ModifierFlags.Private);
}

function methodName(node) {
  if (node.name == null) return null;
  if (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return node.name.getText();
}

function isDeprecated(node, sourceFile) {
  if (ts.getJSDocTags(node).some((tag) => tag.tagName.text === "deprecated")) return true;
  const before = sourceFile.text.slice(Math.max(0, node.getStart() - 500), node.getStart());
  return /@deprecated\b/.test(before);
}

function keepDirective(node, sourceFile) {
  const comments = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return comments.find((range) => /nm-style:\s*keep-local/.test(sourceFile.text.slice(range.pos, range.end))) ?? null;
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

function enclosingClass(node) {
  let current = node;
  while (current != null) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return current;
    current = current.parent;
  }
  return null;
}

const definitions = [];
const definitionsByName = new Map();
for (const file of targetFiles) {
  const sourceFile = parseSource(file);
  forEachNode(sourceFile, (node) => {
    if (!ts.isClassDeclaration(node) || node.name == null) return;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member)) continue;
      const name = methodName(member);
      if (name == null) continue;
      const definition = {
        file,
        sourceFile,
        classNode: node,
        className: node.name.text,
        member,
        name,
        private: isPrivateMethod(member),
        deprecated: isDeprecated(member, sourceFile),
        line: lineOf(sourceFile, member),
        keepLocal: keepDirective(member, sourceFile) != null,
      };
      definitions.push(definition);
      const list = definitionsByName.get(name) ?? [];
      list.push(definition);
      definitionsByName.set(name, list);
    }
  });
}

const propertyRefs = new Map();
for (const file of referenceFiles) {
  const sourceFile = parseSource(file);
  forEachNode(sourceFile, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return;
    const name = node.name.text;
    const owner = enclosingClass(node);
    const call = ts.isCallExpression(node.parent) && node.parent.expression === node;
    const list = propertyRefs.get(name) ?? [];
    list.push({ file, node, owner, call });
    propertyRefs.set(name, list);
  });
}

for (const definition of definitions) {
  const refs = definition.private
    ? (propertyRefs.get(definition.name) ?? []).filter((ref) => ref.file === definition.file && ref.owner?.name?.text === definition.className)
    : (propertyRefs.get(definition.name) ?? []);
  const calls = refs.filter((ref) => ref.call).length;
  const refCount = refs.length;
  if (!isAdded(definition.file, definition.line)) continue;
  const location = `${toPosix(definition.file)}:${definition.line}`;
  const qualifiedName = `${definition.className}.${definition.name}`;
  const note = definition.private ? "private method；按类内引用计数" : "public method；按全仓库属性访问计数";

  if (definition.deprecated) {
    rows.push([refCount === 0 ? "DEPRECATED_DEAD" : "DEPRECATED_METHOD", location, qualifiedName, `${calls} call / ${refCount} ref`, "标记 @deprecated，确认是否还有生产调用"]);
    continue;
  }
  const call = passThroughCall(definition.member);
  if (!hasModifier(definition.member, ts.ModifierFlags.Static) && call != null && isPassThrough(definition.member, call)) {
    rows.push(["PASS_THROUGH_METHOD", location, qualifiedName, `${calls} call / ${refCount} ref`, "方法体只是 return f(x)，无策略"]);
    continue;
  }
  if (!definition.private && (definitionsByName.get(definition.name)?.length ?? 0) > 1) {
    rows.push(["AMBIGUOUS_METHOD", location, qualifiedName, `${calls} call / ${refCount} ref`, "同名方法跨类出现，按名字计数不可靠"]);
    continue;
  }
  if (refCount === 0) {
    rows.push(["DEAD_METHOD", location, qualifiedName, `${calls} call / ${refCount} ref`, "生产引用 0"]);
  } else if (refCount === 1) {
    const lines = lineOf(definition.sourceFile, definition.member.getEnd()) - definition.line + 1;
    if (definition.keepLocal && lines > 20) rows.push(["KEEP_LOCAL", location, qualifiedName, `${calls} call / ${refCount} ref`, "nm-style 保留（需在报告说明理由）"]);
    else rows.push(["INLINE_METHOD", location, qualifiedName, `${calls} call / ${refCount} ref`, "只有一处生产引用，考虑内联"]);
  }
}

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

if (flags.json) {
  console.log(JSON.stringify(rows.map(([verdict, location, name, refs, note]) => ({ verdict, location, name, refs, note })), null, 2));
} else {
  console.log(`check-methods: ${rows.filter(([verdict]) => verdict !== "KEEP_LOCAL").length} 处（扫描 ${definitions.length} 个类方法 / ${targetFiles.length} 个文件）`);
  if (rows.length > 0) console.log(formatTable(["verdict", "location", "name", "refs", "note"], rows));
  console.log("规则：类方法同样按单点内联/死代码/薄包装处理；public 方法单点先撤 public 或写 keep-public 理由；计数是启发式，接口/动态调用需人工复核。");
}

process.exit(rows.some(([verdict]) => verdict !== "KEEP_LOCAL") ? 1 : 0);
