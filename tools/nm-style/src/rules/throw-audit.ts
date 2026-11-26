/**
 * throw-audit 规则（p26 R3 + error-channel-debt §5）：八形态 throw 全量盘点 + 判定矩阵 + baseline 门禁。
 * 语句六形态（spec §5.1 的前四个 + 后补的两个，堵「自定义错误类 / 再抛」的盲区）：
 * T1 `throw <expr>.error`（unwrap throw，与门⑦同口径——属性链以 .error 收尾）、
 * T2 `throw createAbortError(...)`、T3 `throw new AppError(...)`、T4 `throw new Error(...)`、
 * T5 `throw new <其它错误类>(...)`（McpTransportError / NativeSseAbortError / TypeError…）、
 * T6 `throw <其它表达式>`（再抛 `throw e`、三元、await、调用结果等）。
 * 转抛 helper 两形态（error-channel-debt §5 新增，堵「把 throw 包进 never helper 转手」的盲区）：
 * T7 转抛 helper 定义站点——显式标注 `never` 返回的函数（FunctionDeclaration / MethodDeclaration /
 *    PropertyAssignment 箭头 / VariableDeclaration 箭头），体为单条 ThrowStatement（直接形态）或单条
 *    ReturnStatement 且返回表达式调用已知 T7（传递链，候选随名单扩展到不动点，支持跨文件）；键取合成
 *    文本 `never-throw helper: <名>`，不与体内 throw 语句的 T1-T6 键碰撞（两站并存各占一键）；
 * T8 转抛 helper 调用站点——裸 Identifier 或属性访问链（末段标识符命中 T7 名单）的 CallExpression；
 *    键取调用原文空白归一（含实参），helper 字段带名。
 * 断言类豁免（T7/T8 都不产生站点）：名字以 assert 开头（大小写不敏感），或 T7 体内 throw 的表达式含
 * `new AssertionError(...)`——编程错误走合法不变量通道；nm-throw: keep 不豁免收集，站点照常入表判 KEEP。
 * 每站点产出：形态 | file:line | 所在函数（类方法含类名，匿名箭头 <arrow>，模块顶层 <module>）|
 * 函数返回形态（八值桶：result/outcome/async-result/async-outcome/promise-plain/plain/never/none）|
 * 同函数有 catch? | 邻近 nm-throw: keep 注释（九期既有约定，理由必填）。
 *
 * 判定矩阵（spec §5.2，求值顺序 KEEP > ALLOWED > VIOLATION > BOUNDARY > VIOLATION-B）：
 *   KEEP        —— 邻近 `nm-throw: keep — 理由` 注释（显式人工标记压过一切机械判定）
 *   ALLOWED     —— 白名单三类：事务回调（transaction-helper / *-in-transaction）、tdbc 驱动层
 *                  （core infra/tdbc + tdbc-driver-* + tdbc-conformance 的 src）、控制信号转码
 *                  （DatabaseReplacedError / CoordinatedWriteRollbackError / ChatPromptBuildBailedError
 *                  出现在 throw 语句或其外层 if 条件里，以及 cloud-sync.service.ts 登记文件）
 *   VIOLATION   —— 所在函数返回 Result/Outcome：改 return，唯一修法
 *   BOUNDARY    —— 返回普通类型 + 同函数有 catch：合法边界转码，但必须在 baseline 登记理由
 *   VIOLATION-B —— 返回普通类型 + 无 catch：该层应改返 Result
 *
 * baseline（scripts/throw-audit-baseline.json）：站点键 = 文件 + throw 语句空白归一原文（行号会漂，
 * 文本才是稳定身份）。disposition 四值：ALLOWED / BOUNDARY / KEEP / UNTRIAGED——定性不了的标
 * UNTRIAGED，gate 不拦但报告首行强制显数（防静默膨胀）。gate 拦「未登记站点」：矩阵判
 * VIOLATION/VIOLATION-B/BOUNDARY 且键不在 baseline → exit 1；baseline 里的存量（含 UNTRIAGED）
 * 不拦——UNTRIAGED 是显式欠账，靠报告显数压着往下还。
 *
 * 扫描面：packages + apps + tools 全量（含 renderer——throw 不分 UI 与逻辑），排除 apps/cli、
 * dist、node_modules、.d.ts、test 路径（--include-tests 才收）。走 git ls-files + others：
 * 未跟踪新文件必须可见（gate 防回归的前提），gitignored 的 tmp 夹具天然不可见。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isTestPath } from "../lib/core.js";
import { gitLines } from "../lib/git.js";
import { toolVersion } from "./bare-exports.js";

// ---------- 公开类型 ----------

export type ThrowForm = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8";
export type ThrowVerdict = "VIOLATION" | "VIOLATION-B" | "BOUNDARY" | "ALLOWED" | "KEEP";
/** 返回形态八值（spec §5.1「八值形态」列）：Result/Outcome × 同步异步 + 普通标注 + Promise 普通类型 + never + 无标注。 */
export type RetBucket = "result" | "outcome" | "async-result" | "async-outcome" | "promise-plain" | "plain" | "never" | "none";

export interface ThrowSite {
    form: ThrowForm;
    /** 仓根相对 posix 路径。 */
    file: string;
    line: number;
    /** 站点身份成分：throw 语句 / T8 调用原文（空白归一）；T7 定义站点取合成文本 `never-throw helper: <名>`——与 file 组成稳定键。 */
    text: string;
    /** 限定函数路径（Class.method / fn / fn.<arrow> / <module>）。 */
    fn: string;
    ret: RetBucket;
    /** 返回类型标注原文（无标注空串）。 */
    retText: string;
    hasCatch: boolean;
    /** nm-throw: keep 的理由文本；无注释 null；有指令缺理由空串。 */
    keep: string | null;
    verdict: ThrowVerdict;
    /** ALLOWED 时命中的白名单类目；其余 null。 */
    allow: string | null;
    /** 站点键：`${file}#${text}`。 */
    key: string;
    /** T8 站点的转抛 helper 名；T7 定义站点不带（名字已在合成键文本里）。 */
    helper?: string;
}

export type Disposition = "ALLOWED" | "BOUNDARY" | "KEEP" | "UNTRIAGED";

export interface ThrowBaselineEntry {
    form: ThrowForm;
    line: number;
    disposition: Disposition;
    reason: string;
}

export interface ThrowBaseline {
    note?: string;
    toolVersion?: string;
    generatedAt?: string;
    includeTests?: boolean;
    sites: Record<string, ThrowBaselineEntry>;
}

// ---------- 白名单三类 ----------

/** 控制信号转码类名单（spec §5.2）：携带状态字段的控制信号，Result 装不下，rethrow 喂 throw 通道 port。 */
// error-matrix-final W5：三类控制流哨兵类已全部退役（CoordinatedWriteRollbackError→INFRA_ROLLBACK_DEGRADED、
// DatabaseReplacedError→DB_BACKUP_REPLACE_INCOMPLETE、ChatPromptBuildBailedError→null 哨兵），
// 「控制信号借异常通道」形态清零，白名单清空——若未来再出现控制信号类，先按矩阵裁决返回值承载，不加回此表。

const ALLOWED_FILE_RULES: ReadonlyArray<{ category: string; test: (rel: string) => boolean }> = [
    { category: "transaction", test: (rel) => /(?:^|\/)(?:transaction-helper|[^/]*in-transaction)\.tsx?$/.test(rel) },
    { category: "tdbc-driver", test: (rel) => rel.startsWith("packages/core/src/infra/tdbc/") || /^packages\/tdbc-(?:driver-[^/]+|conformance)\/src\//.test(rel) },
    { category: "control-signal", test: (rel) => rel === "apps/mobile/src/services/cloud-sync.service.ts" },
];

// ---------- 单站点判定 ----------

function formOf(expr: ts.Expression): ThrowForm {
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name) && expr.name.text === "error") return "T1";
    if (ts.isCallExpression(expr) && isAbortFactoryText(expr.expression)) return "T2";
    if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "AppError") return "T3";
    if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "Error") return "T4";
    if (ts.isNewExpression(expr)) return "T5";
    return "T6";
}

/** T2 载荷识别（p29 补丁）：工厂 namespace 化后 `AbortError.create()`（属性访问）与旧名 `createAbortError()`（裸标识符）都要认——p23 改名曾让 T2 全量漏网。 */
function isAbortFactoryText(expr: ts.Expression): boolean {
    if (ts.isIdentifier(expr)) return expr.text === "createAbortError";
    return ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "AbortError" && ts.isIdentifier(expr.name) && expr.name.text === "create";
}

/** 限定函数：从 throw 向上找最近函数节点（返回形态/catch 都按最近一层算——回调槽的标注不该被外层函数顶替），同时收全部祖先函数段（方法拼类名、箭头找绑定名，外层在前 . 连接）。 */
function enclosingFnOf(node: ts.Node): { fn: ts.FunctionLikeDeclaration; path: string } | null {
    const segments: string[] = [];
    let fn: ts.FunctionLikeDeclaration | null = null;
    for (let current: ts.Node | undefined = node.parent; current != null; current = current.parent) {
        if (!isFnLike(current)) continue;
        if (fn == null) fn = current; // 最近一层：ret/catch 的判定对象
        segments.unshift(fnSegmentOf(current));
    }
    return fn == null ? null : { fn, path: segments.join(".") };
}

function isFnLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function fnSegmentOf(fn: ts.FunctionLikeDeclaration): string {
    if (ts.isConstructorDeclaration(fn)) return classOf(fn) == null ? "<ctor>" : `${classOf(fn)}.<ctor>`;
    if (ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) {
        const name = memberNameText(fn.name) ?? "<method>";
        return classOf(fn) == null ? name : `${classOf(fn)}.${name}`;
    }
    if (ts.isFunctionDeclaration(fn)) return fn.name == null ? "<fn>" : fn.name.text;
    // 箭头 / 函数表达式：从绑定上下文取名（变量名 / 属性名 / 对象成员），实参位记 <callback>。
    const parent = fn.parent;
    if (parent != null && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (parent != null && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
        const name = memberNameText(parent.name);
        if (name != null) return ts.isPropertyDeclaration(parent) && parent.parent != null && ts.isClassDeclaration(parent.parent) && parent.parent.name != null ? `${parent.parent.name.text}.${name}` : name;
    }
    if (parent != null && (ts.isCallExpression(parent) || ts.isNewExpression(parent))) return "<callback>";
    return "<arrow>";
}

function classOf(node: ts.Node): string | null {
    for (let current: ts.Node | undefined = node.parent; current != null; current = current.parent) {
        if (ts.isClassDeclaration(current) && current.name != null) return current.name.text;
        if (ts.isClassExpression(current) && current.name != null) return current.name.text;
        if (ts.isStatement(current)) return null;
    }
    return null;
}

function memberNameText(name: ts.Node): string | null {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : null;
}

function retBucketOf(fn: ts.FunctionLikeDeclaration | null): { bucket: RetBucket; text: string } {
    if (fn == null) return { bucket: "none", text: "" };
    const typeNode = (fn as ts.SignatureDeclaration).type;
    if (typeNode == null) return { bucket: "none", text: "" };
    const text = typeNode.getText().replace(/\s+/g, " ");
    if (text === "never") return { bucket: "never", text };
    const promise = /^Promise<(.*)>$/.exec(text);
    const inner = promise == null ? text : promise[1];
    const async = promise != null;
    if (/\bResult\b/.test(inner)) return { bucket: async ? "async-result" : "result", text };
    if (/\bOutcome\b/.test(inner)) return { bucket: async ? "async-outcome" : "outcome", text };
    return { bucket: async ? "promise-plain" : "plain", text };
}

function containsCatch(node: ts.Node | null | undefined): boolean {
    if (node == null) return false;
    if (ts.isCatchClause(node)) return true;
    let found = false;
    node.forEachChild((child) => {
        if (!found && containsCatch(child)) found = true;
    });
    return found;
}

const KEEP_RE = /nm-throw:\s*keep\b\s*(?:[-—:：]\s*([^*\n\r]+))?/;

/** keep 注释锚点：`if (!ok) throw x.error;` / `if (!ok) helper(x.error);` 形态取所在语句的外层 if（连带 if 行的领先注释），其余取节点本身。 */
function keepAnchorOf(node: ts.Node): ts.Node {
    let statement = node;
    while (statement.parent != null && !ts.isStatement(statement)) statement = statement.parent;
    return statement.parent != null && ts.isIfStatement(statement.parent) ? statement.parent : node;
}

/** nm-throw: keep 注释：锚点与节点的领先 trivia + 同行尾注释；返回理由（无注释 null，缺理由空串）。T1-T6 传 throw 语句、T8 传调用点、T7 走 keepReasonOfHelper。 */
function keepReasonAt(anchor: ts.Node, node: ts.Node, sf: ts.SourceFile): string | null {
    const chunks: string[] = [];
    chunks.push(sf.text.slice(anchor.getFullStart(), anchor.getStart(sf)));
    chunks.push(sf.text.slice(node.getFullStart(), node.getStart(sf)));
    const lineEnd = sf.text.indexOf("\n", node.getEnd());
    chunks.push(sf.text.slice(node.getEnd(), lineEnd < 0 ? sf.text.length : lineEnd));
    for (const chunk of chunks) {
        const match = KEEP_RE.exec(chunk);
        if (match == null) continue;
        return match[1] == null ? "" : match[1].trim();
    }
    return null;
}

function keepReasonOf(node: ts.Node, sf: ts.SourceFile): string | null {
    return keepReasonAt(keepAnchorOf(node), node, sf);
}

/** T7 定义站点的 keep 判定：体内语句（真实形态：keep 写在体内 throw 上方）优先，再查定义处——属性/变量绑定节点的领先注释，最后函数节点自身。 */
function keepReasonOfHelper(fn: ts.FunctionLikeDeclaration, bodyStmt: ts.Statement | null | undefined, sf: ts.SourceFile): string | null {
    if (bodyStmt != null) {
        const fromBody = keepReasonOf(bodyStmt, sf);
        if (fromBody != null) return fromBody;
    }
    const parent: ts.Node | undefined = fn.parent;
    if (parent != null && (ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent))) return keepReasonAt(parent, parent, sf);
    return keepReasonAt(fn, fn, sf);
}

/** 白名单三类命中：文件规则（事务回调文件名 / tdbc 驱动层 / cloud-sync 登记文件）→ 事务回调 AST 判定（函数是 `xxx.transaction(fn)` 的实参——总纲 §五例外 2：只认抛错回滚）→ 控制信号类名出现在语句/外层 if 文本里。T7 传定义函数节点、T8 传调用点。 */
function allowCategoryOf(node: ts.Node, rel: string): string | null {
    for (const rule of ALLOWED_FILE_RULES) if (rule.test(rel)) return rule.category;
    if (isTransactionCallbackArgument(node)) return "transaction";
    return null;
}

/** 节点的任一层祖先函数是 `.transaction(...)` / `transaction(...)` 的实参（回调本体即可，不必是直接实参）。 */
function isTransactionCallbackArgument(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node; current != null; current = current.parent) {
        if (!isFnLike(current)) continue;
        const parent: ts.Node | undefined = current.parent;
        if (parent == null || !ts.isCallExpression(parent)) continue;
        const args: readonly ts.Node[] = parent.arguments;
        if (!args.includes(current)) continue;
        const callee = parent.expression;
        const name = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
        if (name === "transaction") return true;
    }
    return false;
}

function sfOf(node: ts.Node): ts.SourceFile {
    return node.getSourceFile();
}

function verdictOf(site: Pick<ThrowSite, "ret" | "hasCatch" | "keep" | "allow">): ThrowVerdict {
    if (site.keep != null) return "KEEP";
    if (site.allow != null) return "ALLOWED";
    if (site.ret === "result" || site.ret === "outcome" || site.ret === "async-result" || site.ret === "async-outcome") return "VIOLATION";
    if (site.hasCatch) return "BOUNDARY";
    return "VIOLATION-B";
}

// ---------- 扫描 ----------

/** 单站点构造（T1-T6 传 throw 语句、T8 传调用点；helper 仅 T8 非空）。 */
function buildSite(node: ts.Node, form: ThrowForm, file: string, helper: string | null): ThrowSite {
    const sf = sfOf(node);
    const enclosing = enclosingFnOf(node);
    const ret = retBucketOf(enclosing?.fn ?? null);
    const keep = keepReasonOf(node, sf);
    const allow = allowCategoryOf(node, file);
    const text = node.getText(sf).replace(/\s+/g, " ");
    const hasCatch = enclosing != null && containsCatch(enclosing.fn.body);
    const site: ThrowSite = {
        form,
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        text,
        fn: enclosing?.path ?? "<module>",
        ret: ret.bucket,
        retText: ret.text,
        hasCatch,
        keep,
        verdict: verdictOf({ ret: ret.bucket, hasCatch, keep, allow }),
        allow,
        key: `${file}#${text}`,
    };
    if (helper != null) site.helper = helper;
    return site;
}

function parseSourceFileOf(rel: string, text: string): ts.SourceFile {
    return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** 站点排序：文件序（与 throwAuditFiles 的字典序一致）+ 行序；同文件同行时按收集批次（T1-T6 在 T7/T8 前）。 */
function siteOrder(a: ThrowSite, b: ThrowSite): number {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
}

/** 单文件扫描（text 直解析，供测试内存构造）。T8 用本文件 T7 名单；全仓扫描走 scanThrowAudit 的两阶段（名单为全量，跨文件传递链与跨文件调用都收全）。 */
export function throwSitesOfText(file: string, text: string): ThrowSite[] {
    const sf = parseSourceFileOf(file, text);
    const sites: ThrowSite[] = [];
    collectThrowSites(sf, sites, file);
    const candidates = collectNeverThrowCandidatesAll(sf, file);
    const helpers = settleNeverThrowNames(candidates, new Set<string>());
    for (const candidate of candidates) {
        if (helpers.has(candidate.name)) sites.push(buildNeverThrowSite(candidate));
    }
    collectNeverThrowCallSites(sf, sites, file, helpers);
    return sites.sort(siteOrder);
}

function collectThrowSites(node: ts.Node, sites: ThrowSite[], file: string): void {
    if (ts.isThrowStatement(node) && node.expression != null) {
        sites.push(buildSite(node, formOf(node.expression), file, null));
    }
    ts.forEachChild(node, (child) => collectThrowSites(child, sites, file));
}

// ---------- T7/T8 转抛 helper（error-channel-debt §5） ----------

/** T7 候选：显式标注 never 的绑定函数（四种形态），体为单条 throw（直接形态）或单条 return 调用（传递链候选，callee 名待名单扩展）。 */
interface NeverThrowCandidate {
    fn: ts.FunctionLikeDeclaration;
    name: string;
    file: string;
    body: ts.Block;
    /** 直接形态的单条 throw；传递链形态 null。 */
    thrown: ts.ThrowStatement | null;
    /** 传递链形态的单条 return；直接形态 null。 */
    returned: ts.ReturnStatement | null;
    /** 传递链形态的 callee 末段名；直接形态 null。 */
    returnsCallOf: string | null;
}

/** T7 绑定名：函数声明 / 方法直接有名；箭头从 PropertyAssignment / VariableDeclaration 取绑定名（设计 §5.1 的四种形态，其余绑定不认）。 */
function neverThrowNameOf(fn: ts.FunctionLikeDeclaration): string | null {
    if (ts.isFunctionDeclaration(fn)) return fn.name == null ? null : fn.name.text;
    if (ts.isMethodDeclaration(fn)) return memberNameText(fn.name);
    const parent = fn.parent;
    if (parent != null && ts.isPropertyAssignment(parent)) return memberNameText(parent.name);
    if (parent != null && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    return null;
}

/** 断言类豁免（设计 §5.2）：名字以 assert 开头（大小写不敏感），或体内 throw 的表达式含 `new AssertionError(...)`——豁免函数不进 T7 名单，其调用点也不产生 T8。 */
function isAssertExempt(name: string, thrown: ts.ThrowStatement | null): boolean {
    if (/^assert/i.test(name)) return true;
    return thrown != null && containsAssertionErrorNew(thrown.expression);
}

/** 表达式内（含嵌套）是否存在 `new AssertionError(...)`。 */
function containsAssertionErrorNew(node: ts.Node): boolean {
    let found = false;
    const walk = (current: ts.Node): void => {
        if (found) return;
        if (ts.isNewExpression(current) && calleeTailNameOf(current.expression) === "AssertionError") {
            found = true;
            return;
        }
        ts.forEachChild(current, walk);
    };
    walk(node);
    return found;
}

/** 调用 callee 的末段名：裸 Identifier 或属性访问链（`helper(e)` / `Obj.helper(e)` 都认——设计 §5.1 的 T8 口径）。 */
function calleeTailNameOf(expr: ts.Expression): string | null {
    if (ts.isIdentifier(expr)) return expr.text;
    return ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name) ? expr.name.text : null;
}

/** 单文件 T7 候选收集（直接形态与传递链候选都收，断言豁免已滤；全量扫描对全部文件各跑一遍后统一 settle）。 */
function collectNeverThrowCandidates(node: ts.Node, file: string, out: NeverThrowCandidate[]): void {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
        pushNeverThrowCandidate(node, file, out);
    }
    ts.forEachChild(node, (child) => collectNeverThrowCandidates(child, file, out));
}

function collectNeverThrowCandidatesAll(sf: ts.SourceFile, file: string): NeverThrowCandidate[] {
    const candidates: NeverThrowCandidate[] = [];
    collectNeverThrowCandidates(sf, file, candidates);
    return candidates;
}

/** 形态判定 + 入候选：显式标注 never（retBucketOf 的 never 桶；推断型不在口径内，设计 §5.1 检测边界）、Block 体单条语句、非断言豁免；体形态决定直接/传递链，两者都不是则不入。 */
function pushNeverThrowCandidate(fn: ts.FunctionLikeDeclaration, file: string, out: NeverThrowCandidate[]): void {
    const name = neverThrowNameOf(fn);
    if (name == null) return;
    if (retBucketOf(fn).bucket !== "never") return;
    const body = fn.body;
    if (body == null || !ts.isBlock(body) || body.statements.length !== 1) return;
    const only = body.statements[0];
    if (ts.isThrowStatement(only)) {
        if (isAssertExempt(name, only)) return;
        out.push({ fn, name, file, body, thrown: only, returned: null, returnsCallOf: null });
        return;
    }
    if (ts.isReturnStatement(only) && only.expression != null && ts.isCallExpression(only.expression)) {
        const callee = calleeTailNameOf(only.expression.expression);
        if (callee == null || isAssertExempt(name, null)) return;
        out.push({ fn, name, file, body, thrown: null, returned: only, returnsCallOf: callee });
    }
}

/** T7 名单到不动点：直接形态先入名单，传递链候选（体只 return 调用已知 T7）循环扩展直到不再新增——全量候选一次 settle，跨文件依赖也收全。 */
function settleNeverThrowNames(candidates: readonly NeverThrowCandidate[], seed: ReadonlySet<string>): Set<string> {
    const names = new Set<string>(seed);
    for (const candidate of candidates) {
        if (candidate.thrown != null) names.add(candidate.name);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const candidate of candidates) {
            if (candidate.thrown != null || names.has(candidate.name) || candidate.returnsCallOf == null) continue;
            if (names.has(candidate.returnsCallOf)) {
                names.add(candidate.name);
                changed = true;
            }
        }
    }
    return names;
}

/** T7 定义站点：键取合成文本 `never-throw helper: <名>`（不与体内 throw 语句的 T1-T6 键碰撞）；fn 列是定义处外层函数路径（模块顶层对象字面量 → <module>）；ret 恒 never 桶、体单条语句故无 catch → 默认 VIOLATION-B（唯一修法是删 helper）。 */
function buildNeverThrowSite(candidate: NeverThrowCandidate): ThrowSite {
    const sf = sfOf(candidate.fn);
    const enclosing = enclosingFnOf(candidate.fn);
    const ret = retBucketOf(candidate.fn);
    const keep = keepReasonOfHelper(candidate.fn, candidate.thrown ?? candidate.returned, sf);
    const allow = allowCategoryOf(candidate.fn, candidate.file);
    const hasCatch = containsCatch(candidate.body);
    const text = `never-throw helper: ${candidate.name}`;
    return {
        form: "T7",
        file: candidate.file,
        line: sf.getLineAndCharacterOfPosition(candidate.fn.getStart(sf)).line + 1,
        text,
        fn: enclosing?.path ?? "<module>",
        ret: ret.bucket,
        retText: ret.text,
        hasCatch,
        keep,
        verdict: verdictOf({ ret: ret.bucket, hasCatch, keep, allow }),
        allow,
        key: `${candidate.file}#${text}`,
    };
}

/** T8 调用站点收集：callee 末段命中 T7 名单的 CallExpression（依赖名单，两阶段扫描的第二阶段；单文件入口用本文件名单）。体内 return 调用另一 helper 的传递链站点同样按调用收 T8。 */
function collectNeverThrowCallSites(node: ts.Node, sites: ThrowSite[], file: string, helpers: ReadonlySet<string>): void {
    if (ts.isCallExpression(node)) {
        const callee = calleeTailNameOf(node.expression);
        if (callee != null && helpers.has(callee)) sites.push(buildSite(node, "T8", file, callee));
    }
    ts.forEachChild(node, (child) => collectNeverThrowCallSites(child, sites, file, helpers));
}

/** 扫描文件集（packages+apps+tools，git 口径含未跟踪；排除 cli/dist/test/.d.ts）。 */
export function throwAuditFiles(includeTests = false): string[] {
    return [...gitLines("git ls-files packages apps tools"), ...gitLines("git ls-files --others --exclude-standard packages apps tools")]
        .filter((rel) => (rel.endsWith(".ts") || rel.endsWith(".tsx")) && !rel.endsWith(".d.ts"))
        .filter((rel) => !rel.startsWith("apps/cli/"))
        .filter((rel) => !rel.split("/").some((seg) => seg === "dist" || seg === "node_modules"))
        .filter((rel) => includeTests || !isTestPath(rel))
        .sort();
}

/** 全仓扫描两阶段（设计 §5.3）：pass1 逐文件收 T1-T6 站点与全量 T7 候选；pass2 用全量名单（settle 到不动点，跨文件传递链）产 T7 定义站点、补收 T8 调用站点。 */
export function scanThrowAudit(includeTests = false): ThrowSite[] {
    const sites: ThrowSite[] = [];
    const parsed: Array<{ file: string; sf: ts.SourceFile }> = [];
    const candidates: NeverThrowCandidate[] = [];
    for (const rel of throwAuditFiles(includeTests)) {
        let text: string;
        try {
            text = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
        } catch {
            continue; // 未跟踪又已删除的暂存文件等
        }
        const sf = parseSourceFileOf(rel, text);
        parsed.push({ file: rel, sf });
        collectThrowSites(sf, sites, rel);
        candidates.push(...collectNeverThrowCandidatesAll(sf, rel));
    }
    const helpers = settleNeverThrowNames(candidates, new Set<string>());
    for (const candidate of candidates) {
        if (helpers.has(candidate.name)) sites.push(buildNeverThrowSite(candidate));
    }
    for (const { file, sf } of parsed) collectNeverThrowCallSites(sf, sites, file, helpers);
    return sites.sort(siteOrder);
}

// ---------- baseline 与 gate ----------

export const BLOCKING_VERDICTS: ReadonlySet<string> = new Set(["VIOLATION", "VIOLATION-B", "BOUNDARY"]);

export interface ThrowGateResult {
    /** 矩阵判 VIOLATION/VIOLATION-B/BOUNDARY 且键不在 baseline 的站点（gate 拦这些）。 */
    blockers: ThrowSite[];
    /** baseline 里的 UNTRIAGED 欠账（不拦，报告显数）。 */
    untriaged: Array<{ site: ThrowSite; entry: ThrowBaselineEntry }>;
    /** verdict=KEEP 但注释缺理由（信息项）。 */
    keepWithoutReason: ThrowSite[];
    /** baseline 有而当前扫描没有的键（已修复/改写，改善）。 */
    dropped: string[];
    /** baseline 里已登记的 BOUNDARY/ALLOWED/KEEP 站点数。 */
    registered: number;
}

export function throwGateCompare(baseline: ThrowBaseline, current: readonly ThrowSite[]): ThrowGateResult {
    const result: ThrowGateResult = { blockers: [], untriaged: [], keepWithoutReason: [], dropped: [], registered: 0 };
    const seen = new Set<string>();
    for (const site of current) {
        seen.add(site.key);
        const entry = baseline.sites[site.key];
        if (entry == null) {
            if (BLOCKING_VERDICTS.has(site.verdict)) result.blockers.push(site);
            continue;
        }
        if (entry.disposition === "UNTRIAGED") result.untriaged.push({ site, entry });
        else result.registered += 1;
        if (site.verdict === "KEEP" && (site.keep == null || site.keep === "")) result.keepWithoutReason.push(site);
    }
    result.dropped = Object.keys(baseline.sites).filter((key) => !seen.has(key)).sort();
    return result;
}

/** write-baseline payload：当前站点全量入表；旧 disposition+reason 按 key salvage（键消失警告由调用方打）。 */
export function throwBaselinePayload(current: readonly ThrowSite[], old: ThrowBaseline | null, note: string, includeTests: boolean): ThrowBaseline {
    const sites: Record<string, ThrowBaselineEntry> = {};
    for (const site of current) {
        const saved = old?.sites[site.key];
        if (saved != null) {
            // error-matrix-final W5：disposition 跟随当前机器判定刷新（KEEP/ALLOWED 的判定依据——
            // 注释与白名单——都在源码可复核），旧 reason 优先保留（人工写过的理由不被注释文案覆盖）；
            // 须人工定性的 verdict（VIOLATION/VIOLATION-B/BOUNDARY）沿用旧登记，无旧条目才 UNTRIAGED。
            if (site.verdict === "KEEP" || site.verdict === "ALLOWED") {
                sites[site.key] = { form: site.form, line: site.line, disposition: site.verdict, reason: saved.reason || (site.verdict === "KEEP" ? site.keep || "缺理由：nm-throw: keep 注释未带理由，须补" : `白名单自动判定（${site.allow}）`) };
                continue;
            }
            sites[site.key] = { form: site.form, line: site.line, disposition: saved.disposition, reason: saved.reason };
            continue;
        }
        if (site.verdict === "ALLOWED") sites[site.key] = { form: site.form, line: site.line, disposition: "ALLOWED", reason: `白名单自动判定（${site.allow}）` };
        else if (site.verdict === "KEEP") sites[site.key] = { form: site.form, line: site.line, disposition: "KEEP", reason: site.keep || "缺理由：nm-throw: keep 注释未带理由，须补" };
        else sites[site.key] = { form: site.form, line: site.line, disposition: "UNTRIAGED", reason: "" };
    }
    return { note, toolVersion: toolVersion(), generatedAt: new Date().toISOString(), includeTests, sites };
}

/** baseline JSON 解析（容错：sites 缺失/形状不对按空表处理，调用方决定是否报错）。 */
export function parseThrowBaseline(raw: string): ThrowBaseline {
    const parsed = JSON.parse(raw) as Partial<ThrowBaseline>;
    const sites: Record<string, ThrowBaselineEntry> = {};
    for (const [key, entry] of Object.entries(parsed.sites ?? {})) {
        if (entry == null || typeof entry !== "object") continue;
        sites[key] = { form: entry.form, line: entry.line, disposition: entry.disposition, reason: entry.reason };
    }
    return { note: parsed.note, toolVersion: parsed.toolVersion, generatedAt: parsed.generatedAt, includeTests: parsed.includeTests, sites };
}
