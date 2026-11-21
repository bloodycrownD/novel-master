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

/** 绑定模式的名字收集：`x` / `{a, b: c, ...rest}` / `[x, , y]`——收「绑定到的名字」（a、c、rest、x、y），不收属性键（b）。 */
function collectBindingNames(pattern: ts.Node, out: Set<string> | Map<string, ts.Node>, source?: ts.Node): void {
  const add = (name: string): void => {
    if (out instanceof Map) out.set(name, source ?? pattern);
    else out.add(name);
  };
  if (ts.isIdentifier(pattern)) { add(pattern.text); return; }
  const visit = (node: ts.Node): void => {
    if (ts.isBindingElement(node)) {
      if (node.propertyName == null || node.name !== node.propertyName) collectBindingNames(node.name, out, source);
      return; // propertyName 的键位名字不入集
    }
    if (ts.isOmittedExpression(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(pattern);
}

/** 闭包体内自声明的全部名字（参数、var/let/const、class、function，含嵌套块与嵌套函数自己的声明）。 */
function ownDeclaredNames(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  for (const param of fn.parameters) collectBindingNames(param.name, names);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) collectBindingNames(node.name, names);
    else if (ts.isFunctionLike(node) && node !== fn) {
      // 嵌套函数的形参也是本闭包的自声明（内层箭头参数不该被计成捕获）。
      for (const param of node.parameters) collectBindingNames(param.name, names);
    }
    else if (ts.isFunctionDeclaration(node) && node.name != null) names.add(node.name.text);
    else if (ts.isClassDeclaration(node) && node.name != null) names.add(node.name.text);
    else if (ts.isInterfaceDeclaration(node) && node.name != null) names.add(node.name.text);
    else if (ts.isTypeAliasDeclaration(node) && node.name != null) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  const body = bodyOf(fn);
  if (body != null) visit(body);
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
    const visit = (node: ts.Node): void => {
      if (node === fn) return; // 自己内部的自声明不算外层
      if (ts.isVariableDeclaration(node)) collectBindingNames(node.name, out, node);
      else if (ts.isFunctionLike(node) && node !== fn) {
        for (const param of node.parameters) collectBindingNames(param.name, out, node);
      }
      else if (ts.isFunctionDeclaration(node) && node.name != null) out.set(node.name.text, node);
      else if (ts.isClassDeclaration(node) && node.name != null) out.set(node.name.text, node);
      ts.forEachChild(node, visit);
    };
    visit(outerBody);
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
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ASSIGN_TOKENS.has(node.operatorToken.kind) && ts.isIdentifier(node.left) && candidates.has(node.left.text)) mutated.add(node.left.text);
    else if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(node.operand) && candidates.has(node.operand.text)) mutated.add(node.operand.text);
    else if (ts.isPostfixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(node.operand) && candidates.has(node.operand.text)) mutated.add(node.operand.text);
    ts.forEachChild(node, visit);
  };
  const body = bodyOf(fn);
  if (body != null) visit(body);
  return mutated;
}

function hasThisReference(fn: ts.FunctionLikeDeclaration): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  const body = bodyOf(fn);
  if (body != null) visit(body);
  return found;
}

function escapesFromOwner(fn: ts.FunctionLikeDeclaration, name: string): boolean {
  for (let current: ts.Node | undefined = fn.parent; current != null; current = current.parent) {
    if (ts.isFunctionLike(current) && bodyOf(current) != null) {
      let escaped = false;
      const visit = (node: ts.Node): void => {
        if (escaped) return;
        if (ts.isReturnStatement(node) && node.expression != null && ts.isIdentifier(node.expression) && node.expression.text === name) { escaped = true; return; }
        ts.forEachChild(node, visit);
      };
      visit(bodyOf(current)!);
      if (escaped) return true;
      return false; // 只看最近一层
    }
  }
  return false;
}

/** 单文件扫描：函数体内定义的命名函数 + 捕获分类。 */
export function nestedClosuresOfText(rel: string, text: string): NestedClosure[] {
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: NestedClosure[] = [];

  const hasKeepDirective = (node: ts.Node): boolean => {
    const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
    return ranges.some((range) => sourceFile.text.slice(range.pos, range.end).includes("nm-style: keep-closure"));
  };

  const isInsideFunction = (node: ts.Node): boolean => {
    for (let current: ts.Node | undefined = node.parent; current != null; current = current.parent) {
      if (ts.isFunctionLike(current)) return true;
      if (ts.isModuleBlock(current)) return false;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    // 形态一：const/let f = () => {...} / function f() {...}，声明在函数体内。
    if (ts.isVariableStatement(node) && !hasKeepDirective(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.initializer == null) continue;
        const init = decl.initializer;
        const isFn = ts.isArrowFunction(init) || ts.isFunctionExpression(init);
        if (!isFn) continue;
        if (!isInsideFunction(node)) continue;
        out.push(buildClosure(rel, sourceFile, decl.name.text, init as ts.FunctionLikeDeclaration, node));
      }
    }
    // 形态二：function f() {...} 函数声明嵌在函数体内。
    if (ts.isFunctionDeclaration(node) && node.name != null && node.body != null && !hasKeepDirective(node) && isInsideFunction(node)) {
      out.push(buildClosure(rel, sourceFile, node.name.text, node, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

function buildClosure(rel: string, sourceFile: ts.SourceFile, name: string, fn: ts.FunctionLikeDeclaration, stmt: ts.Node): NestedClosure {
  const outer = outerDeclaredNames(fn);
  const own = ownDeclaredNames(fn);
  const captured = new Map<string, ts.Node>();
  const visitRefs = (node: ts.Node): void => {
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
    ts.forEachChild(node, visitRefs);
  };
  const body = bodyOf(fn);
  if (body != null) visitRefs(body);
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
