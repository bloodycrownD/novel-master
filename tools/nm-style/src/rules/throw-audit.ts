/**
 * throw-audit 规则（p26 R3）：四形态 throw 全量盘点 + 判定矩阵 + baseline 门禁。
 * 四形态（spec §5.1）：T1 `throw <expr>.error`（unwrap throw，与门⑦同口径——属性链以 .error 收尾）、
 * T2 `throw createAbortError(...)`、T3 `throw new AppError(...)`、T4 `throw new Error(...)`。
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

export type ThrowForm = "T1" | "T2" | "T3" | "T4";
export type ThrowVerdict = "VIOLATION" | "VIOLATION-B" | "BOUNDARY" | "ALLOWED" | "KEEP";
/** 返回形态八值（spec §5.1「八值形态」列）：Result/Outcome × 同步异步 + 普通标注 + Promise 普通类型 + never + 无标注。 */
export type RetBucket = "result" | "outcome" | "async-result" | "async-outcome" | "promise-plain" | "plain" | "never" | "none";

export interface ThrowSite {
  form: ThrowForm;
  /** 仓根相对 posix 路径。 */
  file: string;
  line: number;
  /** 站点身份成分：throw 语句原文（空白归一）——与 file 组成稳定键。 */
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

function formOf(expr: ts.Expression): ThrowForm | null {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name) && expr.name.text === "error") return "T1";
  if (ts.isCallExpression(expr) && isAbortFactoryText(expr.expression)) return "T2";
  if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "AppError") return "T3";
  if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "Error") return "T4";
  return null;
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

/** nm-throw: keep 注释：throw 语句与外层 if 语句（`if (!ok) throw r.error` 形态）的领先 trivia + 同行尾注释；返回理由（无注释 null，缺理由空串）。 */
function keepReasonOf(stmt: ts.ThrowStatement, sf: ts.SourceFile): string | null {
  const chunks: string[] = [];
  const anchor: ts.Node = ts.isIfStatement(stmt.parent) ? stmt.parent : stmt;
  chunks.push(sf.text.slice(anchor.getFullStart(), anchor.getStart(sf)));
  chunks.push(sf.text.slice(stmt.getFullStart(), stmt.getStart(sf)));
  const lineEnd = sf.text.indexOf("\n", stmt.getEnd());
  chunks.push(sf.text.slice(stmt.getEnd(), lineEnd < 0 ? sf.text.length : lineEnd));
  for (const chunk of chunks) {
    const match = KEEP_RE.exec(chunk);
    if (match == null) continue;
    return match[1] == null ? "" : match[1].trim();
  }
  return null;
}

/** 白名单三类命中：文件规则（事务回调文件名 / tdbc 驱动层 / cloud-sync 登记文件）→ 事务回调 AST 判定（函数是 `xxx.transaction(fn)` 的实参——总纲 §五例外 2：只认抛错回滚）→ 控制信号类名出现在语句/外层 if 文本里。 */
function allowCategoryOf(stmt: ts.ThrowStatement, rel: string): string | null {
  for (const rule of ALLOWED_FILE_RULES) if (rule.test(rel)) return rule.category;
  if (isTransactionCallbackArgument(stmt)) return "transaction";
  return null;
}

/** throw 的任一层祖先函数是 `.transaction(...)` / `transaction(...)` 的实参（回调本体即可，不必是直接实参）。 */
function isTransactionCallbackArgument(stmt: ts.ThrowStatement): boolean {
  for (let current: ts.Node | undefined = stmt; current != null; current = current.parent) {
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

function buildSite(stmt: ts.ThrowStatement, form: ThrowForm, file: string): ThrowSite {
  const sf = sfOf(stmt);
  const enclosing = enclosingFnOf(stmt);
  const ret = retBucketOf(enclosing?.fn ?? null);
  const keep = keepReasonOf(stmt, sf);
  const allow = allowCategoryOf(stmt, file);
  const text = stmt.getText(sf).replace(/\s+/g, " ");
  const hasCatch = enclosing != null && containsCatch(enclosing.fn.body);
  return {
    form,
    file,
    line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1,
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
}

/** 单文件扫描（text 直解析，供测试内存构造）。 */
export function throwSitesOfText(file: string, text: string): ThrowSite[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: ThrowSite[] = [];
  collectThrowSites(sf, sites, file);
  return sites;
}

function collectThrowSites(node: ts.Node, sites: ThrowSite[], file: string): void {
  if (ts.isThrowStatement(node) && node.expression != null) {
    const form = formOf(node.expression);
    if (form != null) sites.push(buildSite(node, form, file));
  }
  ts.forEachChild(node, (child) => collectThrowSites(child, sites, file));
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

export function scanThrowAudit(includeTests = false): ThrowSite[] {
  const sites: ThrowSite[] = [];
  for (const rel of throwAuditFiles(includeTests)) {
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
    } catch {
      continue; // 未跟踪又已删除的暂存文件等
    }
    sites.push(...throwSitesOfText(rel, text));
  }
  return sites;
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
