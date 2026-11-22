/**
 * nm-code-style §2「一行写完」检测——旧 .agents/skills/nm-code-style/scripts/check-signatures.mjs 原样迁移。
 * 五类 verdict：PARAMS / ARGS / IMPORT / VARDECL / ASSIGN。
 * p27 R7 修订：五类 verdict + 形态豁免（hook 调用与声明 E1 / JSX 上下文 E2 /
 * hook 与组件 props 解构形参 E3 / 非 call RHS 展平宽度闸 E4）+ 两处判据修正
 * （M1：await 调用与 call 同口径；M2：ARGS「首实参移动」基准改取实参列表前界——
 * 成员链的实参紧跟调用点不再误判）。一行规则本意是逻辑代码可读性；React 生态
 * 惯用的 hook/JSX 排版与 prettier-200 必拆的形态不再逼一行。
 * p27 R5 修订：全大写 `*_SQL` 后缀常量的模板字面量豁免一行要求（多行 SQL 文本
 * 按关键字引导换行是合法排版；spec p27 R5）。
 * 判据、正则、排序与旧脚本逐条对照；diff 行过滤分两路：
 *   - 磁盘扫描（--changed / <paths>）：isAdded 由 lib/git.addedLineFilter 提供（hunk 配对版）；
 *   - --range/--since：rangeScanInput 读 range 右端 blob（不是工作树，结果不随并行编辑漂移），
 *     新增行按 `git diff <range> -U0` 的 hunk 区间判定——旧 addedLineFilterInRange 语义原样保留。
 * 遍历用旧脚本同款 getChildren 全遍历（signatures 判据原样迁移，遍历语义不动；symbol-index 的
 * forEachChild 语义是 §3.2 的另一条线，与本规则无关）。
 */

import { spawnSync } from "node:child_process";
import ts from "typescript";
import { isTestPath, lineOf, parseSource, toPosix } from "../lib/core.js";
import { gitLines, type AddedLinePredicate } from "../lib/git.js";
import { locationOf, type Finding } from "../lib/report.js";

export interface ScanEntry {
    /** 被扫仓根相对（posix）或绝对路径；range 模式下来自 diff，本身即仓根相对路径。 */
    file: string;
    /** null = 磁盘模式（parseSource 读盘）；非 null = range 模式的 blob 内容。 */
    text: string | null;
}

export interface SignaturesScanContext {
    entries: readonly ScanEntry[];
    /** (file, line) => 是否该 diff/模式的新增行；false 的行不报。 */
    isAdded: AddedLinePredicate;
}

interface ScanState {
    file: string;
    sourceFile: ts.SourceFile;
    isAdded: AddedLinePredicate;
    findings: Finding[];
}

/**
 * `--range/--since` 的扫描面：文件集来自 `git diff --name-only --diff-filter=ACM <range>`，
 * 内容读 range 右端的 blob（`...` 取右端；纯 revision 直取本身），排序与旧脚本一致（file localeCompare）。
 */
export function rangeScanInput(diffRange: string, includeTests: boolean): SignaturesScanContext {
    const end = diffRange.includes("...") ? diffRange.split("...")[1] : diffRange.includes("..") ? diffRange.split("..")[1] : diffRange;
    const revision = end.length > 0 ? end : "HEAD";
    const entries: ScanEntry[] = gitLines(`git diff --name-only --diff-filter=ACM ${diffRange}`)
        .filter((rel) => /\.(ts|tsx)$/.test(rel) && (includeTests || !isTestPath(rel)))
        .map((file) => ({ file, text: showBlob(revision, file) }))
        .filter((entry): entry is ScanEntry & { text: string } => entry.text != null)
        .sort((a, b) => a.file.localeCompare(b.file));
    return { entries, isAdded: addedLineFilterInRange(diffRange) };
}

function showBlob(revision: string, file: string): string | null {
    const result = spawnSync("git", ["show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error != null) console.error(`nm-style: git show 执行失败（${revision}:${file}）—— ${result.error.message}`);
    if (result.status !== 0 || result.stdout == null) return null;
    return result.stdout;
}

/** `--range/--since` 时只报该 diff 的新增行；未出现在 diff 的文件视为整文件（旧语义原样）。 */
function addedLineFilterInRange(diffRange: string): AddedLinePredicate {
    const ranges = new Map<string, Array<[number, number]>>();
    let current: string | null = null;
    for (const raw of gitLines(`git diff ${diffRange} -U0`)) {
        const line = raw.replace(/\r$/, "");
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

/** 扫描一批条目：每条解析为 SourceFile 后跑五类检测，按 location（file:line 字典序）再按 verdict 排序（旧排序原样）。 */
export function scanSignatures(context: SignaturesScanContext): Finding[] {
    const findings: Finding[] = [];
    for (const entry of context.entries) {
        const state: ScanState = { file: entry.file, sourceFile: entry.text == null ? parseSource(entry.file) : parseText(entry.file, entry.text), isAdded: context.isAdded, findings };
        forEachNode(state.sourceFile, (node) => {
            if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) checkParameters(state, node);
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) checkArguments(state, node);
            if (ts.isImportDeclaration(node)) checkImport(state, node);
            if (ts.isVariableDeclaration(node)) checkVariable(state, node);
            if (isAssignmentExpression(node)) checkAssignment(state, node);
        });
    }
    findings.sort((a, b) => locationOf(a).localeCompare(locationOf(b)) || a.verdict.localeCompare(b.verdict));
    return findings;
}

/** 与旧脚本 forEachNode 同口径：getChildren 全遍历（含 JSDoc 挂载节点）。 */
function forEachNode(node: ts.Node, callback: (node: ts.Node) => void): void {
    callback(node);
    for (const child of node.getChildren()) forEachNode(child, callback);
}

/**
 * 旧脚本用的 ts.isAssignmentExpression：d.ts 未声明该守卫（运行时存在、类型层缺失），按其运行时语义
 * 本地重建——BinaryExpression 且 operatorToken.kind 落在 FirstAssignment..LastAssignment（含 = 与全部复合赋值）。
 */
function isAssignmentExpression(node: ts.Node): node is ts.AssignmentExpression<ts.AssignmentOperatorToken> {
    return ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

function parseText(file: string, text: string): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function report(state: ScanState, node: ts.Node, verdict: string, symbol: string, detail: string): void {
    const line = lineOf(state.sourceFile, node);
    if (!state.isAdded(state.file, line)) return;
    state.findings.push({ rule: "signatures", file: toPosix(state.file), line, symbol, verdict, detail, blocking: true });
}

function functionName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
    if (node.name != null) return node.name.getText(sourceFile);
    if (node.parent != null && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
    return "(anonymous)";
}

/** E3：hook / 组件 props 解构形参豁免——解构一行化必出超长签名，是 React 惯用排版。 */
function isDestructuredParam(node: ts.FunctionLikeDeclaration): boolean {
    return node.parameters.some((param) => !ts.isIdentifier(param.name));
}

/** E3：组件启发式——函数体直接产出 JSX（最外层 return JSX 或体首层 return 后接 `<`）。 */
function isJsxBody(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): boolean {
    if (node.body == null) return false;
    return ts.isJsxElement(node.body) || ts.isJsxFragment(node.body) || ts.isJsxSelfClosingElement(node.body) || /return\s*\(?\s*</.test(node.body.getText(sourceFile).slice(0, 500));
}

function checkParameters(state: ScanState, node: ts.FunctionLikeDeclaration): void {
    const params = node.parameters;
    if (params.length === 0) return;
    const startLine = lineOf(state.sourceFile, node.getStart(state.sourceFile));
    const split = lineOf(state.sourceFile, params[0]) !== startLine || params.some((param, index) => index > 0 && lineOf(state.sourceFile, param) !== lineOf(state.sourceFile, params[index - 1]));
    if (!split) return;
    const name = functionName(node, state.sourceFile);
    // E3：解构形参 + hook 名或组件 JSX 体 → 豁免（hook options 解构 / 组件 props 解构）。
    if (isDestructuredParam(node) && (isHookCallText(name) || isJsxBody(node, state.sourceFile))) return;
    report(state, node, "PARAMS", name, `${name}(${params.length})`);
}

/** E2：调用位于 JSX 属性/表达式上下文内，或任一实参本身是 JSX——prettier 对 JSX 实参/内联回调的标准格式就是拆行。 */
function isJsxContext(node: ts.CallExpression | ts.NewExpression, args: readonly ts.Expression[]): boolean {
    for (let current: ts.Node | undefined = node.parent; current != null; current = current.parent) {
        if (ts.isJsxAttribute(current) || ts.isJsxExpression(current)) return true;
    }
    return args.some((arg) => ts.isJsxElement(arg) || ts.isJsxSelfClosingElement(arg) || ts.isJsxFragment(arg) || (ts.isParenthesizedExpression(arg) && (ts.isJsxElement(arg.expression) || ts.isJsxSelfClosingElement(arg.expression))));
}

/** M2：「首实参移动」的基准行 = 实参列表前界（成员调用取 method 名 token 行，直接调用取 callee 结束行）——成员链的实参紧跟调用点不算拆行。 */
function callSiteLine(node: ts.CallExpression | ts.NewExpression, sourceFile: ts.SourceFile): number {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) return lineOf(sourceFile, callee.name.getEnd());
    return lineOf(sourceFile, callee.getEnd());
}

function checkArguments(state: ScanState, node: ts.CallExpression | ts.NewExpression): void {
    const args = node.arguments;
    if (args == null || args.length === 0) return;
    // 回调实参自身的函数体天然跨行：只跳过该实参，其余普通实参仍按「调用写一行」校验。
    // 有回调时不再用「首实参 vs 调用起点」判定（prettier 必因回调体拆行）；只看普通实参之间是否拆行。
    const callbacks = args.filter((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
    const regular = args.filter((arg) => !ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg));
    if (regular.length === 0) return;
    // E1：useXxx hook 调用豁免（长泛型/内联对象类型的 hook 拆行是 React 惯用排版）。
    if (isHookCallText(node.expression.getText(state.sourceFile))) return;
    // E2：JSX 上下文/JSX 实参豁免。
    if (isJsxContext(node, args)) return;
    // E5（p29 W2）：SQL 模板实参豁免——`TdbcTemplate.query(conn, parser, `多行SQL`, bindings)` 的
    // SQL 文本按关键字排版是合法形态，与 R5 常量豁免同口径。
    if (args.some((arg) => isSqlTemplateValue(arg))) return;
    const firstArgMoved = callbacks.length === 0 && regular[0] === args[0] && lineOf(state.sourceFile, regular[0]) !== callSiteLine(node, state.sourceFile);
    const regularSplit = regular.some((arg, index) => index > 0 && lineOf(state.sourceFile, arg) !== lineOf(state.sourceFile, regular[index - 1]));
    if (!firstArgMoved && !regularSplit) return;
    const detail = node.expression.getText(state.sourceFile).slice(0, 80);
    report(state, node, "ARGS", detail, detail);
}

function checkImport(state: ScanState, node: ts.ImportDeclaration): void {
    const bindings = node.importClause?.namedBindings;
    if (bindings == null || !ts.isNamedImports(bindings)) return;
    const elements = bindings.elements;
    if (elements.length === 0 || elements.length > 3) return;
    // 长 import 的一行形式必然超过 prettier printWidth；这种拆行不是风格问题。
    const oneLine = node.getText(state.sourceFile).replace(/\s+/g, " ");
    if (oneLine.length > 80) return;
    const startLine = lineOf(state.sourceFile, node.getStart(state.sourceFile));
    const split = lineOf(state.sourceFile, elements[0]) !== startLine || elements.some((element, index) => index > 0 && lineOf(state.sourceFile, element) !== lineOf(state.sourceFile, elements[index - 1]));
    if (split) report(state, node, "IMPORT", node.moduleSpecifier.getText(state.sourceFile), `${elements.length} 个具名导入`);
}

/** 解包包裹层（括号/类型断言/satisfies/非空断言/await），取表达式本体（M1：call 宽容分支与块形态判定共用同一解包口径）。 */
function unwrapValue(node: ts.Node): ts.Node {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isAwaitExpression(current)) current = current.expression;
    return current;
}

function isBlockExpression(node: ts.Node): boolean {
    const current = unwrapValue(node);
    return ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isClassExpression(current) || ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current) || ts.isTemplateExpression(current);
}

/** E4 宽度闸上限（与 scripts/prettier-guard.mjs 的 --print-width 200 工作宽度同源）：prettier-200 必拆的 RHS 不逼一行。 */
const SIGNATURES_FLAT_LIMIT = 200;

/** 该行（1-based）的前导缩进宽度（E4 展平长度计算用）。 */
function indentOf(sourceFile: ts.SourceFile, line: number): number {
    const starts = sourceFile.getLineStarts();
    const start = starts[line - 1];
    const end = starts[line] ?? sourceFile.getEnd();
    const match = /^[ \t]*/.exec(sourceFile.getFullText().slice(start, end));
    return match == null ? 0 : match[0].length;
}

/** E1：`useXxx` hook 调用（useState/useRef/useMemo/... 及 `React.useXxx` 成员形态——RN 替身惯用）。 */
function isHookCallText(text: string): boolean {
    return /^use[A-Z]/.test(text) || /^React\.use[A-Z]/.test(text);
}

function checkOneLineValue(state: ScanState, node: ts.Node, value: ts.Expression, startLine: number, verdict: string, symbol: string, detail: string): void {
    const valueLine = lineOf(state.sourceFile, value);
    const valueEndLine = lineOf(state.sourceFile, value.getEnd());
    const moved = valueLine !== startLine;
    const multiline = valueLine !== valueEndLine;
    if (isBlockExpression(value)) {
        if (moved && !multiline) report(state, node, verdict, symbol, detail);
        return;
    }
    // M1：await 调用与 call 同口径——RHS 起始同行、调用体多行不报（实参拆行归 ARGS）。
    const unwrapped = unwrapValue(value);
    if (!moved && multiline && (ts.isCallExpression(unwrapped) || ts.isNewExpression(unwrapped))) return;
    if (moved || multiline) {
        // E4：非 call RHS 展平超宽度闸（prettier-200 必拆，一行状态维持不住）不报。
        const flat = indentOf(state.sourceFile, startLine) + value.getText(state.sourceFile).replace(/\s+/g, " ").length;
        if (flat > SIGNATURES_FLAT_LIMIT) return;
        report(state, node, verdict, symbol, detail);
    }
}

/** R5：全大写 `*_SQL` 后缀常量的模板字面量豁免一行要求（多行 SQL 文本按关键字引导换行是合法排版）。 */
const SQL_CONST_NAME_RE = /^[A-Z][A-Z0-9_]*_SQL$/;

/** SQL 语句起始关键字——模板字面量内容以其开头即视为 SQL 文本（p29 W2：局部 `const sql = ...` 同享豁免）。 */
const SQL_HEAD_RE = /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE)\b/;

function isSqlTemplateValue(value: ts.Expression): boolean {
    if (!ts.isTemplateExpression(value) && !ts.isNoSubstitutionTemplateLiteral(value)) return false;
    const head = ts.isNoSubstitutionTemplateLiteral(value) ? value.text : value.head.text;
    return SQL_HEAD_RE.test(head);
}

function isSqlTemplateConst(name: string, value: ts.Expression): boolean {
    if (!SQL_CONST_NAME_RE.test(name)) return false;
    return ts.isTemplateExpression(value) || ts.isNoSubstitutionTemplateLiteral(value);
}

function checkVariable(state: ScanState, node: ts.VariableDeclaration): void {
    if (node.initializer == null) return;
    if (lineOf(state.sourceFile, node.name) !== lineOf(state.sourceFile, node.name.getEnd())) return;
    if (node.type != null && lineOf(state.sourceFile, node.type) !== lineOf(state.sourceFile, node.type.getEnd())) return;
    const name = node.name.getText(state.sourceFile);
    // R5 / E1：SQL 模板常量多行合法（p29 W2 扩：模板内容以 SQL 关键字开头的局部变量同享）；hook 调用 RHS（useState/useMemo/...）拆行是 React 惯用排版。
    if (isSqlTemplateConst(name, node.initializer) || isSqlTemplateValue(node.initializer)) return;
    if (ts.isCallExpression(node.initializer) && isHookCallText(node.initializer.expression.getText(state.sourceFile))) return;
    checkOneLineValue(state, node, node.initializer, lineOf(state.sourceFile, node.name.getEnd()), "VARDECL", name, name);
}

function checkAssignment(state: ScanState, node: ts.AssignmentExpression<ts.AssignmentOperatorToken>): void {
    const detail = node.left.getText(state.sourceFile).slice(0, 80);
    // R5：ASSIGN 侧同豁免（SQL 模板常量重赋值形态；p29 W2 扩同 isSqlTemplateValue）。
    if (isSqlTemplateConst(node.left.getText(state.sourceFile), node.right) || isSqlTemplateValue(node.right)) return;
    checkOneLineValue(state, node, node.right, lineOf(state.sourceFile, node.left.getEnd()), "ASSIGN", detail, detail);
}
