/**
 * nested-closures 规则（盘点型，不进 gate）：函数体内定义的命名函数（局部闭包）全量盘点 + 捕获集分类。
 *
 * 动机（error-matrix-final 后追加，用户提出的维护性问题）：局部命名闭包把依赖藏进词法捕获，
 * 签名不完整描述依赖（CoordinatedWrite.run 的 rollbackExecuted 签名只声明 (from, rootCause)、
 * 实际还依赖捕获的 executed）——review 看不见、复用性为零。终态判据：
 *   - 零捕获 → 提升为模块级函数（纯搬，复用性最高）；
 *   - 捕获 this → 提为私有方法；
 *   - 捕获外层局部变量 → 把捕获集参数化后提升（签名诚实，可复用可测试）；
 *   - 捕获集被重绑定（x = / ++/--）→ 参数化后是引用共享，建议对象槽/holder 承载。
 *
 * 只盘「命名」的局部函数（const f = () => / function f(){}），不盘匿名回调——
 * .map(x => …) 这类传给高阶函数的内联行为是惯用法不在判据内。豁免标记：nm-style: keep-closure。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isTestPath, toPosix } from "../lib/core.js";
import { gitLines } from "../lib/git.js";

export interface NestedClosure {
  /** 仓根相对 posix 路径。 */
  file: string;
  /** 闭包声明起始行（1 起）。 */
  line: number;
  /** 闭包名；匿名赋值形态为 "<anonymous>"（当前不收集，保留字段）。 */
  name: string;
  /** 外层函数（最近函数祖先）的名字；顶层函数内为 "<module>"。 */
  owner: string;
  /** 捕获的外层局部变量名列表（不含 this / 模块级 / import）。 */
  captures: string[];
  /** 其中被闭包体重绑定（= / ++ / --）的名字。 */
  mutated: string[];
  /** 闭包体引用了 this（箭头捕获外层 this）。 */
  usesThis: boolean;
  /** 外层函数把这个闭包名字 return 出去了（逃逸出调用作用域）。 */
  escapes: boolean;
  /** 结构化建议（四桶）。 */
  suggestion: "hoist" | "method" | "method+params" | "parametrize" | "parametrize-shared" | "keep-closure";
  /** 建议的可读说明。 */
  advice: string;
}

/** FunctionLikeDeclaration 的 body 在联合类型上不可直达（CallSignature 无 body）——按属性兜底取。 */
function bodyOf(fn: ts.Node): ts.Node | undefined {
  return (fn as { body?: ts.Node }).body;
}

/** 绑定名写入：Map 目标记名字→声明节点（source 兜底 fallback），Set 目标只记名字。 */
function addBindingName(out: Set<string> | Map<string, ts.Node>, name: string, source: ts.Node | undefined, fallback: ts.Node): void {
  if (out instanceof Map) out.set(name, source ?? fallback);
  else out.add(name);
}

/** 绑定模式遍历：BindingElement 只递归绑定名（propertyName 键位不入集），其余节点逐层下探。 */
function visitBindingPattern(node: ts.Node, out: Set<string> | Map<string, ts.Node>, source: ts.Node | undefined): void {
  if (ts.isBindingElement(node)) {
    if (node.propertyName == null || node.name !== node.propertyName) visitBindingPattern(node.name, out, source);
    return;
  }
  if (ts.isOmittedExpression(node)) return;
  ts.forEachChild(node, (child) => visitBindingPattern(child, out, source));
}

/** 绑定模式的名字收集：`x` / `{a, b: c, ...rest}` / `[x, , y]`——收「绑定到的名字」（a、c、rest、x、y），不收属性键（b）。 */
function collectBindingNames(pattern: ts.Node, out: Set<string> | Map<string, ts.Node>, source?: ts.Node): void {
  if (ts.isIdentifier(pattern)) { addBindingName(out, pattern.text, source, pattern); return; }
  visitBindingPattern(pattern, out, source);
}


/**
 * 声明名收集的唯一 walker（自声明与外层声明两个收集器共用一条递归骨架）：
 * 变量声明（解构展开）/ 嵌套函数形参 / function / class / interface / type alias 的名字
 * 交给 onDecl；`stopAt` 命中的子树跳过（外层收集器用它排除闭包自身）。
 */
function walkDeclaredNames(node: ts.Node, onDecl: (name: string, decl: ts.Node) => void, stopAt: ts.FunctionLikeDeclaration | null): void {
  if (stopAt != null && node === stopAt) return; // 自己内部的自声明不算外层
  if (ts.isVariableDeclaration(node)) {
    const names = new Set<string>();
    collectBindingNames(node.name, names);
    for (const name of names) onDecl(name, node);
  } else if (ts.isFunctionLike(node)) {
    // 嵌套函数的形参也是所在作用域的自声明（内层箭头参数不该被计成捕获）。
    for (const param of node.parameters) {
      const names = new Set<string>();
      collectBindingNames(param.name, names);
      for (const name of names) onDecl(name, node);
    }
  } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name != null) {
    onDecl(node.name.text, node);
  }
  ts.forEachChild(node, (child) => walkDeclaredNames(child, onDecl, stopAt));
}

/** 闭包体内自声明的全部名字（参数、var/let/const、class、function，含嵌套块与嵌套函数自己的声明）。 */
function collectDeclaredNames(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  for (const param of fn.parameters) collectBindingNames(param.name, names);
  const body = bodyOf(fn);
  if (body != null) walkDeclaredNames(body, (name) => names.add(name), null);
  return names;
}

/** 沿函数祖先链收集所有外层函数的局部声明名（参数 + 局部声明），不含模块顶层与 import。 */
function outerDeclaredNames(fn: ts.FunctionLikeDeclaration): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (let current: ts.Node | undefined = fn.parent; current != null; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    for (const param of current.parameters) collectBindingNames(param.name, out, param);
    const outerBody = bodyOf(current);
    if (outerBody == null) continue;
    walkDeclaredNames(outerBody, (name, decl) => out.set(name, decl), fn);
  }
  return out;
}

/** 最近函数祖先的显示名（方法名 / 函数名 / "<anonymous>"）。 */
function ownerNameOf(fn: ts.FunctionLikeDeclaration): string {
  for (let current: ts.Node | undefined = fn.parent; current != null; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    if (ts.isFunctionDeclaration(current) && current.name != null) return current.name.text;
    if ((ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)) && ts.isIdentifier(current.name)) return current.name.text;
    const parent: ts.Node | undefined = current.parent;
    if (parent != null && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (parent != null && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    return "<anonymous>";
  }
  return "<module>";
}

/** 赋值/复合赋值 token 集合（=、+=、-=、&&=……凡是对左值写入的都算重绑定）。 */
const ASSIGN_TOKENS = new Set<ts.SyntaxKind>([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken, ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);

/** 体内对名字的重绑定形态（x = / x += / ++x / x--）。 */
function mutatedNames(fn: ts.FunctionLikeDeclaration, candidates: ReadonlySet<string>): Set<string> {
  const mutated = new Set<string>();
  const body = bodyOf(fn);
  if (body != null) collectMutatedNames(body, candidates, mutated);
  return mutated;
}

function collectMutatedNames(node: ts.Node, candidates: ReadonlySet<string>, mutated: Set<string>): void {
  if (ts.isBinaryExpression(node) && ASSIGN_TOKENS.has(node.operatorToken.kind) && ts.isIdentifier(node.left) && candidates.has(node.left.text)) mutated.add(node.left.text);
  else if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(node.operand) && candidates.has(node.operand.text)) mutated.add(node.operand.text);
  else if (ts.isPostfixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(node.operand) && candidates.has(node.operand.text)) mutated.add(node.operand.text);
  ts.forEachChild(node, (child) => collectMutatedNames(child, candidates, mutated));
}

function hasThisReference(fn: ts.FunctionLikeDeclaration): boolean {
  const body = bodyOf(fn);
  return body != null && containsThis(body);
}

/** 体内是否引用 this（命中即短路，替代原 found 布尔标志的返回值递归形态）。 */
function containsThis(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.ThisKeyword) return true;
  let hit = false;
  ts.forEachChild(node, (child) => {
    if (!hit) hit = containsThis(child);
  });
  return hit;
}

function escapesFromOwner(fn: ts.FunctionLikeDeclaration, name: string): boolean {
  for (let current: ts.Node | undefined = fn.parent; current != null; current = current.parent) {
    if (ts.isFunctionLike(current) && bodyOf(current) != null) {
      return returnsIdentifier(bodyOf(current)!, name); // 只看最近一层
    }
  }
  return false;
}

/** 体内是否有 return <name>（命中即短路，替代原 escaped 布尔标志的返回值递归形态）。 */
function returnsIdentifier(body: ts.Node, name: string): boolean {
  if (ts.isReturnStatement(body) && body.expression != null && ts.isIdentifier(body.expression) && body.expression.text === name) return true;
  let hit = false;
  ts.forEachChild(body, (child) => {
    if (!hit) hit = returnsIdentifier(child, name);
  });
  return hit;
}

/** nestedClosuresOfText 的 per-file 遍历上下文（原 visit 闭包的捕获集）。 */
interface ClosureScanCtx {
  rel: string;
  sourceFile: ts.SourceFile;
  out: NestedClosure[];
}

/** 节点 leading trivia 是否带 nm-style: keep-closure 豁免标记。 */
function hasKeepDirectiveAt(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return ranges.some((range) => sourceFile.text.slice(range.pos, range.end).includes("nm-style: keep-closure"));
}

function isInsideFunction(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current != null; current = current.parent) {
    if (ts.isFunctionLike(current)) return true;
    if (ts.isModuleBlock(current)) return false;
  }
  return false;
}

function visitClosureDecls(node: ts.Node, ctx: ClosureScanCtx): void {
  // 形态一：const/let f = () => {...} / function f() {...}，声明在函数体内。
  if (ts.isVariableStatement(node) && !hasKeepDirectiveAt(ctx.sourceFile, node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer == null) continue;
      const init = decl.initializer;
      const isFn = ts.isArrowFunction(init) || ts.isFunctionExpression(init);
      if (!isFn) continue;
      if (!isInsideFunction(node)) continue;
      ctx.out.push(buildClosure(ctx.rel, ctx.sourceFile, decl.name.text, init as ts.FunctionLikeDeclaration, node));
    }
  }
  // 形态二：function f() {...} 函数声明嵌在函数体内。
  if (ts.isFunctionDeclaration(node) && node.name != null && node.body != null && !hasKeepDirectiveAt(ctx.sourceFile, node) && isInsideFunction(node)) {
    ctx.out.push(buildClosure(ctx.rel, ctx.sourceFile, node.name.text, node, node));
  }
  ts.forEachChild(node, (child) => visitClosureDecls(child, ctx));
}

/** 单文件扫描：函数体内定义的命名函数 + 捕获分类。 */
export function nestedClosuresOfText(rel: string, text: string): NestedClosure[] {
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: NestedClosure[] = [];
  visitClosureDecls(sourceFile, { rel, sourceFile, out });
  return out;
}

function collectCapturedRefs(node: ts.Node, own: Set<string>, outer: Map<string, ts.Node>, captured: Map<string, ts.Node>): void {
  if (ts.isIdentifier(node)) {
    const parent: ts.Node | undefined = node.parent;
    const isNamePosition = (parent != null && (
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isMethodDeclaration(parent) && parent.name === node) ||
      (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
      (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
      (ts.isPropertyDeclaration(parent) && parent.name === node) ||
      (ts.isBindingElement(parent) && parent.propertyName === node) ||
      (ts.isQualifiedName(parent) && parent.left === node)
    ));
    if (!isNamePosition && !own.has(node.text) && outer.has(node.text)) captured.set(node.text, outer.get(node.text)!);
  }
  ts.forEachChild(node, (child) => collectCapturedRefs(child, own, outer, captured));
}

function buildClosure(rel: string, sourceFile: ts.SourceFile, name: string, fn: ts.FunctionLikeDeclaration, stmt: ts.Node): NestedClosure {
  const outer = outerDeclaredNames(fn);
  const own = collectDeclaredNames(fn);
  const captured = new Map<string, ts.Node>();
  const body = bodyOf(fn);
  if (body != null) collectCapturedRefs(body, own, outer, captured);
  const captures = [...captured.keys()];
  const mutated = [...mutatedNames(fn, new Set(captured.keys()))];
  const usesThis = hasThisReference(fn);
  const escapes = escapesFromOwner(fn, name);

  let suggestion: NestedClosure["suggestion"];
  let advice: string;
  if (captures.length === 0 && !usesThis) {
    suggestion = "hoist";
    advice = "零捕获：提升为模块级函数（纯搬）";
  } else if (usesThis && captures.length === 0) {
    suggestion = "method";
    advice = "捕获 this：提为私有方法";
  } else if (usesThis) {
    suggestion = "method+params";
    advice = `捕获 this + ${captures.length} 个外层变量：提为私有方法并参数化（${captures.join(", ")}）`;
  } else if (mutated.length > 0) {
    suggestion = "parametrize-shared";
    advice = `捕获集 ${mutated.join(", ")} 被重绑定/变异：参数化是引用共享，建议对象槽/holder 承载后再参数化`;
  } else {
    suggestion = "parametrize";
    advice = `捕获集 ${captures.join(", ")}：参数化后提升为模块级函数（签名诚实、可复用可测试）`;
  }

  return {
    file: toPosix(rel),
    line: sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile)).line + 1,
    name,
    owner: ownerNameOf(fn),
    captures,
    mutated,
    usesThis,
    escapes,
    suggestion,
    advice,
  };
}

/** 扫描文件集（同 throw-audit 口径：packages+apps+tools，排除 cli/dist/.d.ts）。 */
export function nestedClosureFiles(includeTests = false): string[] {
  return [...gitLines("git ls-files packages apps tools"), ...gitLines("git ls-files --others --exclude-standard packages apps tools")]
    .filter((rel) => (rel.endsWith(".ts") || rel.endsWith(".tsx")) && !rel.endsWith(".d.ts"))
    .filter((rel) => !rel.startsWith("apps/cli/"))
    .filter((rel) => !rel.split("/").some((seg) => seg === "dist" || seg === "node_modules"))
    .filter((rel) => includeTests || !isTestPath(rel))
    .sort();
}

export function scanNestedClosures(includeTests = false): NestedClosure[] {
  const out: NestedClosure[] = [];
  for (const rel of nestedClosureFiles(includeTests)) {
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
    } catch {
      continue;
    }
    out.push(...nestedClosuresOfText(rel, text));
  }
  return out;
}
