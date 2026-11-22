/**
 * hygiene 三合一规则（spec §3.3）：check-inline + check-methods + find-fake-exports 合并为单一规则，
 * 判定全部吃 symbol-index（spec §3.2 八值 form），不再按形态各自开一套计数。
 * 旧名映射：DEAD_LOCAL/DEAD_METHOD/DEPRECATED_DEAD→DEAD（deprecated 只进 note，删除旧 methods
 * 「deprecated 优先于一切」分支——已证误报源）；INLINE_LOCAL/INLINE_METHOD→INLINE_CANDIDATE；
 * PASS_THROUGH_METHOD→PASS_THROUGH；fake-exports 正向 KEEP→KEEP_PUBLIC；AMBIGUOUS_METHOD→AMBIGUOUS。
 * 每行 Finding 附 face（private / class-public / exported）、form 与 note（并入 detail 列）。
 *
 * 求值顺序（spec §3.3 钉死）：同名多定义 → AMBIGUOUS 短路一切 → object-binding 存活让位 →
 * PASS_THROUGH 形态判定（两旧版判据并集：inline 的对象字面量实参分支覆盖 methods 的 this/super
 * callee 分支——无 callee 形态限制是超集）→ 引用计数分支（0/1/多）→ keep 指令裁决
 * （keep-local 现行语义 = 单点引用且 >20 行；keep-public 豁免沿用 methods 的容器成员面）。
 *
 * 阻断矩阵（编码为 blocking 布尔，mode 由 cli 层传入）：AMBIGUOUS / KEEP_* 恒不阻断；
 * private 与 class-public 的 DEAD / INLINE_CANDIDATE / PASS_THROUGH 任何模式阻断（旧 inline+methods
 * 白名单）；exported 的 FAKE_PUBLIC / DEAD / TEST_ONLY / INLINE_CANDIDATE 仅 changed/all/strict 阻断
 * （旧 check-style 的 fakeTargets 口径）。
 *
 * face 判定：private（私有顶层/嵌套函数、private class 方法、未导出 namespace 成员）用 localRefs
 * （同文件计数）；class-public（公有 class 方法）与 exported（顶层导出、namespace 导出成员、
 * object 容器全部成员——工厂返回对象/数组元素对象走 globalRefs 保守归因，见 faceOf 注释）
 * 用 globalRefs（prod/test 分桶）。
 *
 * 审计口径树：仅审计 packages/ 或 apps/ 前缀下的定义。引用模型（import 感知、prod-test 分桶、
 * 成员归因）以 packages+apps 工作区为界校准，树外定义的跨文件消费结构性不可见，审计必然误报
 * （旧 fake-exports 实践中也只在 packages 目标上跑）；private 面虽是同文件计数，为口径一致同收树内。
 *
 * 引用面恒全仓（hygieneUnits = packages+apps 全量 ∪ 扫描面），--changed / --range 的行过滤只作用于
 * 报出（isAdded），不影响计数本身——Step 5 验收项「--changed 行过滤 + 引用面恒全仓语义保形」。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { lineOf, parseSource, toPosix, walk } from "../lib/core.js";
import { keepDirectiveOf, type KeepDirective } from "../lib/directives.js";
import type { AddedLinePredicate } from "../lib/git.js";
import type { Finding, HygieneFace } from "../lib/report.js";
import type { ScanEntry } from "./signatures.js";
import { buildSymbolIndex, type SymbolBinding, type SymbolIndex, type SymbolInfo, type SymbolUnit } from "../lib/symbols.js";

export type HygieneMode = "changed" | "all" | "paths" | "strict";

export interface HygieneScanContext {
    /** 扫描面（与 signatures 同构；file 仓根相对 posix 或绝对，text null=磁盘）。 */
    entries: readonly ScanEntry[];
    /** 引用面恒全仓：packages+apps 全量 ∪ 扫描面（file 仓根相对 posix，text 必有）。 */
    units: readonly SymbolUnit[];
    /** (file, line) => 是否该 diff/模式的新增行；false 的行不报。 */
    isAdded: AddedLinePredicate;
    mode: HygieneMode;
    /** public snapshot allowlist 目录（CLI 层传 <repoRoot>/packages/core/test/package-exports/snapshots）。 */
    snapshotDir?: string;
}

/**
 * 引用面构造：packages+apps 全量走盘（prod/test 分桶与成员归因的口径树）∪ 扫描面 overlay
 * （--range 的 blob 覆盖磁盘文本）。目录缺失静默跳过（测试夹具仓常无 packages/apps）。
 */
export function hygieneUnits(entries: readonly ScanEntry[]): SymbolUnit[] {
    const byFile = new Map<string, string>();
    for (const root of ["packages", "apps"]) {
        const absolute = path.resolve(process.cwd(), root);
        if (!fs.existsSync(absolute)) continue;
        for (const file of walk(absolute)) byFile.set(toPosix(file), fs.readFileSync(file, "utf8"));
    }
    for (const entry of entries) {
        const absolute = path.resolve(process.cwd(), entry.file);
        byFile.set(toPosix(absolute), entry.text ?? fs.readFileSync(absolute, "utf8"));
    }
    return [...byFile].map(([file, text]) => ({ file, text }));
}

/** 扫描一批符号：引用面 index + 扫描面锚点表，逐符号裁决，按 location 再按 verdict 排序（与 signatures 同口径）。 */
export function scanHygiene(ctx: HygieneScanContext): Finding[] {
    const scanSet = new Set(ctx.entries.map((entry) => toPosix(entry.file)));
    const index = buildSymbolIndex(ctx.units, { snapshotDir: ctx.snapshotDir });
    const anchors = buildDeclAnchors(ctx.entries);
    const findings: Finding[] = [];
    for (const symbol of index.symbols) {
        if (!scanSet.has(symbol.file) || !inModeledTree(symbol.file)) continue;
        const finding = judgeSymbol(symbol, index, anchors, scanSet, ctx.mode);
        if (finding != null && ctx.isAdded(finding.file, finding.line)) findings.push(finding);
    }
    findings.sort((a, b) => locationKey(a).localeCompare(locationKey(b)) || a.verdict.localeCompare(b.verdict));
    return findings;
}

function locationKey(finding: Finding): string {
    return `${finding.file}:${finding.line}`;
}

// ---------- 声明锚点 ----------

interface DeclAnchor {
    /** 函数体节点（var-fn/object-arrow 为 initializer；绑定与容器对象为 null）。 */
    fnNode: ts.Node | null;
    declNode: ts.Node;
    isStatic: boolean;
    /** 函数节点行跨度（keep-local >20 行门槛）；无函数体为 0。 */
    lines: number;
}

function parseText(file: string, text: string): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function memberNameText(name: ts.Node): string | null {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : null;
}

function hasStaticModifier(node: ts.Node): boolean {
    return (ts.getCombinedModifierFlags(node as unknown as ts.Declaration) & ts.ModifierFlags.Static) !== 0;
}

/**
 * 扫描面的声明节点锚点：(file, name, line) → 节点。symbol-index 只给 file+line+name，
 * PASS_THROUGH 形态 / keep 指令 / 行跨度需要节点——扫描面就地重解析建立锚点表（引用面文件不需要）。
 * 覆盖面与 symbol-index 的定义收集一一对应（spec §3.2）：函数声明、变量声明、方法/访问器、
 * 属性赋值、简写属性、`X.y = fn`、namespace。
 */
function recordDeclAnchor(anchors: Map<string, DeclAnchor>, sourceFile: ts.SourceFile, name: string, node: ts.Node, fnNode: ts.Node | null, isStatic = false): void {
    anchors.set(`${name}#${lineOf(sourceFile, node)}`, { fnNode, declNode: node, isStatic, lines: fnNode == null ? 0 : lineOf(sourceFile, fnNode.getEnd()) - lineOf(sourceFile, fnNode) + 1 });
}

function visitDeclNodes(node: ts.Node, anchors: Map<string, DeclAnchor>, sourceFile: ts.SourceFile): void {
    if (ts.isFunctionDeclaration(node) && node.name != null) recordDeclAnchor(anchors, sourceFile, node.name.text, node, node);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer != null) {
        const init = node.initializer;
        recordDeclAnchor(anchors, sourceFile, node.name.text, node, ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init : null);
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        const name = memberNameText(node.name);
        if (name != null) recordDeclAnchor(anchors, sourceFile, name, node, node, hasStaticModifier(node));
    } else if (ts.isPropertyAssignment(node)) {
        const name = memberNameText(node.name);
        if (name != null) {
            const init = node.initializer;
            recordDeclAnchor(anchors, sourceFile, name, node, ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init : null);
        }
    } else if (ts.isShorthandPropertyAssignment(node)) recordDeclAnchor(anchors, sourceFile, node.name.text, node, null);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.name)) {
        recordDeclAnchor(anchors, sourceFile, node.left.name.text, node, ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right) ? node.right : null);
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body != null) recordDeclAnchor(anchors, sourceFile, node.name.text, node, null);
    ts.forEachChild(node, (child) => visitDeclNodes(child, anchors, sourceFile));
}

function buildDeclAnchors(entries: readonly ScanEntry[]): Map<string, Map<string, DeclAnchor>> {
    const byFile = new Map<string, Map<string, DeclAnchor>>();
    for (const entry of entries) {
        const sourceFile = entry.text == null ? parseSource(entry.file) : parseText(entry.file, entry.text);
        const anchors = new Map<string, DeclAnchor>();
        visitDeclNodes(sourceFile, anchors, sourceFile);
        byFile.set(toPosix(entry.file), anchors);
    }
    return byFile;
}

// ---------- PASS_THROUGH 形态（旧 check-inline 判据原样移植） ----------

/** 函数体是「单 return 调用 / new」或表达式体时返回该调用；否则 null（旧 passThroughCall 同口径）。 */
function passThroughCall(node: ts.Node): ts.CallExpression | ts.NewExpression | null {
    const fn = node as ts.FunctionLikeDeclaration;
    if (fn.body == null) return null;
    if (!ts.isBlock(fn.body)) return ts.isCallExpression(fn.body) || ts.isNewExpression(fn.body) ? fn.body : null;
    if (fn.body.statements.length !== 1) return null;
    const statement = fn.body.statements[0];
    if (!ts.isReturnStatement(statement) || statement.expression == null) return null;
    return ts.isCallExpression(statement.expression) || ts.isNewExpression(statement.expression) ? statement.expression : null;
}

/** 实参由该形参派生（两旧版判据并集，原样移植）：identifier 直传 / 包裹解包 / 形参方法调用 / String·Number·Boolean 转换 / 对象字面量逐属性派生。 */
function isParamDerived(arg: ts.Expression, paramName: string): boolean {
    if (ts.isIdentifier(arg)) return arg.text === paramName;
    if (ts.isParenthesizedExpression(arg) || ts.isAsExpression(arg) || ts.isSatisfiesExpression(arg) || ts.isNonNullExpression(arg)) return isParamDerived(arg.expression, paramName);
    if (ts.isCallExpression(arg)) {
        if (ts.isPropertyAccessExpression(arg.expression) && ts.isIdentifier(arg.expression.expression) && arg.expression.expression.text === paramName) return true;
        if (ts.isIdentifier(arg.expression) && ["String", "Number", "Boolean"].includes(arg.expression.text)) return true;
    }
    // 对象字面量包裹（旧 inline 版）：`new Impl({conn})` / `f({conn, opts})` —— 每个属性值都必须由该参数派生；
    // 有一处不是（如 `{conn, extra: other}` 或 spread `...deps(x)`）就判「不是纯转发」，避免把真组装误报。
    if (ts.isObjectLiteralExpression(arg)) {
        if (arg.properties.length === 0) return false;
        return arg.properties.every((prop) => {
            if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text === paramName;
            if (ts.isPropertyAssignment(prop)) return isParamDerived(prop.initializer, paramName);
            return false;
        });
    }
    return false;
}

/** 两旧版判据并集：形参全为普通 identifier（无默认值、无 rest）且实参等长、全部形参派生。 */
function isPassThroughShape(fnNode: ts.Node): boolean {
    const fn = fnNode as ts.FunctionLikeDeclaration;
    const call = passThroughCall(fnNode);
    if (call == null) return false;
    const paramNames: string[] = [];
    for (const param of fn.parameters) {
        if (!ts.isIdentifier(param.name) || param.initializer != null || param.dotDotDotToken != null) return false;
        paramNames.push(param.name.text);
    }
    const args = call.arguments ?? [];
    return args.length === paramNames.length && args.every((arg, index) => isParamDerived(arg, paramNames[index]));
}

// ---------- face / 门 / 求值 ----------

/** 引用模型口径树：symbol-index 的 import 感知、prod-test 分桶、成员归因都以 packages+apps 工作区为界。 */
function inModeledTree(file: string): boolean {
    return file.startsWith("packages/") || file.startsWith("apps/");
}

function faceOf(symbol: SymbolInfo): HygieneFace {
    if (symbol.container == null) return symbol.exported ? "exported" : "private";
    if (symbol.container.kind === "class") return symbol.isPrivate ? "private" : "class-public";
    if (symbol.container.kind === "object") return "exported";
    // 工厂返回对象 / 数组元素对象（object 容器）：接收者变量（const log = create() → log.debug()）
    // 结构上归因不到容器名，localRefs 的同文件精确归因会连真实消费都看不见（cr-func-hygiene P0：
    // 真仓 52 条假 DEAD）。按 §3.2 统一走 exported 面 = globalRefs 保守归因（不可归因按属性名命中
    // 全部同名成员，宁漏报不误杀），阻断也随之收窄到 strict 通道——该形态无旧口径可保，取保守。
    return symbol.exported ? "exported" : "private";
}

function qualifiedName(symbol: SymbolInfo): string {
    return symbol.container == null ? symbol.name : `${symbol.container.name}.${symbol.name}`;
}

function blockingOf(face: HygieneFace, verdict: string, mode: HygieneMode): boolean {
    if (verdict === "AMBIGUOUS" || verdict === "KEEP_PUBLIC" || verdict === "KEEP_LOCAL") return false;
    if (face === "exported") {
        const strictChannel = mode === "changed" || mode === "all" || mode === "strict";
        return strictChannel && (verdict === "FAKE_PUBLIC" || verdict === "DEAD" || verdict === "TEST_ONLY" || verdict === "INLINE_CANDIDATE");
    }
    // private / class-public：DEAD / INLINE_CANDIDATE / PASS_THROUGH 任何模式阻断（旧 inline+methods 白名单）
    return verdict === "DEAD" || verdict === "INLINE_CANDIDATE" || verdict === "PASS_THROUGH";
}

function emit(symbol: SymbolInfo, face: HygieneFace, verdict: string, detail: string, blocking: boolean): Finding {
    return {
        rule: "hygiene",
        file: symbol.file,
        line: symbol.line,
        symbol: qualifiedName(symbol),
        verdict,
        detail: symbol.deprecated ? `已标 @deprecated；${detail}` : detail,
        face,
        form: symbol.form,
        blocking,
    };
}

const localRefInfo = (refs: { calls: number; refs: number }): string => `${refs.calls} call / ${refs.refs} ref`;
const globalRefInfo = (refs: { prodCalls: number; prodRefs: number; testCalls: number; testRefs: number }): string => `prod ${refs.prodCalls}c/${refs.prodRefs}r · test ${refs.testCalls}c/${refs.testRefs}r`;

function refInfoOf(symbol: SymbolInfo, index: SymbolIndex): string {
    return faceOf(symbol) === "exported" ? globalRefInfo(index.globalRefs(symbol)) : localRefInfo(index.localRefs(symbol));
}

/**
 * 求值顺序第一步：同名多定义 → AMBIGUOUS 短路一切。返回同名定义处数（0=不歧义）。
 * 顶层按旧 find-fake-exports 口径（扫描面内同名导出顶层定义 >1）；成员按旧 check-methods 口径
 * （扫描面内同名跨容器定义 >1；private 不新增扩张，static 方法走可判定计数）。
 */
function ambiguousCount(symbol: SymbolInfo, index: SymbolIndex, scanSet: ReadonlySet<string>, anchor: DeclAnchor | null): number {
    if (symbol.container == null) {
        if (!symbol.exported) return 0;
        const dups = index.symbols.filter((other) => other.container == null && other.exported && other.name === symbol.name && scanSet.has(other.file));
        return dups.length > 1 ? dups.length : 0;
    }
    if (symbol.isPrivate || (anchor?.isStatic ?? false)) return 0;
    const containers = new Set<string>();
    for (const other of index.symbols) {
        if (other.container == null || other.name !== symbol.name || !scanSet.has(other.file)) continue;
        containers.add(`${other.container.name}#${other.file}`);
    }
    return containers.size > 1 ? containers.size : 0;
}

/** object-binding 存活（spec §3.2）：被绑定函数经容器成员有消费者 → 整体让位给成员审计，函数本体不再判。 */
function bindingAlive(index: SymbolIndex, bindings: readonly SymbolBinding[]): boolean {
    return bindings.some((binding) => {
        const refs = index.globalRefs(binding.member);
        return refs.prodCalls + refs.prodRefs + refs.testCalls + refs.testRefs > 0;
    });
}

function judgeSymbol(symbol: SymbolInfo, index: SymbolIndex, anchors: Map<string, Map<string, DeclAnchor>>, scanSet: ReadonlySet<string>, mode: HygieneMode): Finding | null {
    const face = faceOf(symbol);
    const anchor = anchors.get(symbol.file)?.get(`${symbol.name}#${symbol.line}`) ?? null;
    const directive = anchor == null ? undefined : keepDirectiveOf(anchor.fnNode ?? anchor.declNode);
    const bindings = index.bindings.filter((binding) => binding.bound === symbol);
    // ① 同名多定义 → AMBIGUOUS 短路一切（信息项，不阻断）
    const ambiguous = ambiguousCount(symbol, index, scanSet, anchor);
    if (ambiguous > 0) return emit(symbol, face, "AMBIGUOUS", `同名多定义（${ambiguous} 处），按名计数不可靠`, blockingOf(face, "AMBIGUOUS", mode));
    // ② object-binding 存活让位（注册位不计消费的另一半：函数本体经成员存活就不判死）
    if (bindings.length > 0 && bindingAlive(index, bindings)) return null;
    // ③ PASS_THROUGH 形态判定（static 方法豁免——旧 check-methods 语义）
    if (anchor?.fnNode != null && !anchor.isStatic && isPassThroughShape(anchor.fnNode)) {
        return emit(symbol, face, "PASS_THROUGH", `return f(x) 无策略薄包装（${refInfoOf(symbol, index)}）`, blockingOf(face, "PASS_THROUGH", mode));
    }
    // ④ 引用计数分支（0/1/多）→ keep 指令裁决
    if (face === "private") return judgePrivate(symbol, index, anchor, directive, bindings, mode);
    if (face === "class-public") return judgeClassPublic(symbol, index, anchor, directive, mode);
    return judgeExported(symbol, index, directive, mode);
}

/**
 * 私有面（旧 check-inline + check-methods 的 private 分支并集）：localRefs 同文件计数。
 * keep-public 豁免限容器成员（class/object）——namespace 成员与顶层/嵌套函数是旧 inline 面域，
 * 只有 keep-local（且 >20 行）豁免。
 */
function judgePrivate(symbol: SymbolInfo, index: SymbolIndex, anchor: DeclAnchor | null, directive: KeepDirective | undefined, bindings: readonly SymbolBinding[], mode: HygieneMode): Finding | null {
    const local = index.localRefs(symbol);
    const external = local.calls + local.refs;
    const memberFace = symbol.container != null && symbol.container.kind !== "namespace";
    if (external === 0) {
        if (directive === "keep-public" && memberFace) return emit(symbol, "private", "KEEP_PUBLIC", "nm-style 公共入口（需在报告说明理由）（0 call / 0 ref）", blockingOf("private", "KEEP_PUBLIC", mode));
        const note = local.selfRefs > 0 ? "仅自递归，零外部引用" : bindings.length > 0 ? "零引用（绑定位不计消费）" : "零引用";
        return emit(symbol, "private", "DEAD", `${note}（${localRefInfo(local)}）`, blockingOf("private", "DEAD", mode));
    }
    if (external === 1) {
        if (directive === "keep-local" && anchor != null && anchor.lines > 20) return emit(symbol, "private", "KEEP_LOCAL", "nm-style 保留（需在报告说明理由）（1 call / 0 ref）", blockingOf("private", "KEEP_LOCAL", mode));
        if (directive === "keep-public" && memberFace) return emit(symbol, "private", "KEEP_PUBLIC", "nm-style 公共入口（需在报告说明理由）（1 call / 0 ref）", blockingOf("private", "KEEP_PUBLIC", mode));
        return emit(symbol, "private", "INLINE_CANDIDATE", `只有一处引用，内联（${localRefInfo(local)}）`, blockingOf("private", "INLINE_CANDIDATE", mode));
    }
    return null;
}

/** class-public 面（旧 check-methods 生产口径）：globalRefs 只看 prod，test 不算消费。 */
function judgeClassPublic(symbol: SymbolInfo, index: SymbolIndex, anchor: DeclAnchor | null, directive: KeepDirective | undefined, mode: HygieneMode): Finding | null {
    const refs = index.globalRefs(symbol);
    const prod = refs.prodCalls + refs.prodRefs;
    if (prod === 0) {
        if (directive === "keep-public") return emit(symbol, "class-public", "KEEP_PUBLIC", "nm-style 公共入口（需在报告说明理由）（生产 0 引用）", blockingOf("class-public", "KEEP_PUBLIC", mode));
        return emit(symbol, "class-public", "DEAD", `生产引用 0（${globalRefInfo(refs)}）`, blockingOf("class-public", "DEAD", mode));
    }
    if (prod === 1) {
        if (directive === "keep-local" && anchor != null && anchor.lines > 20) return emit(symbol, "class-public", "KEEP_LOCAL", "nm-style 保留（需在报告说明理由）（生产 1 引用）", blockingOf("class-public", "KEEP_LOCAL", mode));
        if (directive === "keep-public") return emit(symbol, "class-public", "KEEP_PUBLIC", "nm-style 公共入口（需在报告说明理由）（生产 1 引用）", blockingOf("class-public", "KEEP_PUBLIC", mode));
        return emit(symbol, "class-public", "INLINE_CANDIDATE", `只有一处生产引用，内联（${globalRefInfo(refs)}）`, blockingOf("class-public", "INLINE_CANDIDATE", mode));
    }
    return null;
}

/**
 * 导出面（旧 find-fake-exports 语义）：prod/test 分桶；public snapshot allowlist 命中 → FAKE_PUBLIC。
 * 旧 keepPublicOf 认 keep-public|keep-local|public-one-ref 全部——两种指令都按保留裁决。
 * INLINE_CANDIDATE 只对 fn 形态（bare/var/object-method/object-arrow）判——类与常量不做内联、
 * object-binding 是成员注册不是可内联包装（spec §3.2）、namespace-object 是容器本身。
 */
function judgeExported(symbol: SymbolInfo, index: SymbolIndex, directive: KeepDirective | undefined, mode: HygieneMode): Finding | null {
    const refs = index.globalRefs(symbol);
    const prod = refs.prodCalls + refs.prodRefs;
    const test = refs.testCalls + refs.testRefs;
    const keepRescue = directive === "keep-public" || directive === "keep-local";
    if (prod === 0) {
        if (keepRescue) return emit(symbol, "exported", "KEEP_PUBLIC", "nm-style 保留（keep 指令，需在报告说明理由）（生产 0 引用）", blockingOf("exported", "KEEP_PUBLIC", mode));
        if (index.publicNames.has(symbol.name)) return emit(symbol, "exported", "FAKE_PUBLIC", `生产 0 引用且命中 public snapshot allowlist（${globalRefInfo(refs)}）`, blockingOf("exported", "FAKE_PUBLIC", mode));
        if (test > 0) return emit(symbol, "exported", "TEST_ONLY", `生产 0 引用，仅测试消费（${globalRefInfo(refs)}）`, blockingOf("exported", "TEST_ONLY", mode));
        return emit(symbol, "exported", "DEAD", `生产 0 引用（${globalRefInfo(refs)}）`, blockingOf("exported", "DEAD", mode));
    }
    const fnLike = symbol.form === "bare-fn" || symbol.form === "var-fn" || symbol.form === "object-method" || symbol.form === "object-arrow";
    if (prod === 1 && fnLike && refs.prodCalls === 1 && refs.prodRefs === 0) {
        if (keepRescue) return emit(symbol, "exported", "KEEP_PUBLIC", "nm-style 保留（keep 指令，需在报告说明理由）（生产 1 引用）", blockingOf("exported", "KEEP_PUBLIC", mode));
        return emit(symbol, "exported", "INLINE_CANDIDATE", `生产单点调用，内联（${globalRefInfo(refs)}）`, blockingOf("exported", "INLINE_CANDIDATE", mode));
    }
    return emit(symbol, "exported", "KEEP_PUBLIC", `生产消费正常（${globalRefInfo(refs)}）`, false);
}
