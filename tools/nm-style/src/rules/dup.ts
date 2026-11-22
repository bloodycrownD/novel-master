/**
 * dup 规则：同名/同形态签名重复增量门禁——主仓 scripts/list-dup-signatures.mjs 口径原样迁移。
 * 收集口径（键空间对齐的关键，旧脚本为全递归）：具名 FunctionDeclaration（含嵌套）、函数值
 * VariableDeclaration（箭头/函数表达式，含嵌套）、具名 class 的方法与箭头函数属性——export 与
 * 非 export 一视同仁（跨域重复的典型形态是一处 export 另一处私有）。分组键：
 *   named = 函数名；shaped = 参数名剥离后的类型形态 `(...)`
 * （paramText 的空格归一、`?`/`...` 位置、shapeKey 的 identifier: 剥离正则逐字保留）。
 * gate 只比键集合（新增键 → exit 1），site 列表纯展示；消除键不阻断（改善）。
 * 基线 v2 schema：{ note, toolVersion, generatedAt, namedGroups, shapedGroups, named, shaped,
 * judged:{named, shaped} }——judged 段由 baseline write 时从同路径旧文件抢救（judgedAfterP17/
 * judgedAfterP18/旧 v2 judged 三层都认，后写覆盖；键不在当前扫描的落 console.error 警告）。
 * 扫描域 = git ls-files packages apps（旧 --all 口径：tracked，不含 --others）∩ 含 /src/、
 * 排除 .d.ts 与 apps/cli/；测试目录天然不在 /src/ 下，无需另滤。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { gitLines } from "../lib/git.js";
import { toolVersion } from "./bare-exports.js";

export interface DupRecord {
    file: string;
    line: number;
    kind: "function" | "const-fn" | "method" | "method-private" | "prop-fn" | "prop-fn-private";
    name: string;
    exported: boolean;
    signature: string;
    shapeKey: string;
}

export type DupGroups = { named: Record<string, string[]>; shaped: Record<string, string[]> };

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
}

function isExported(node: ts.Node): boolean {
    return hasModifier(node, ts.SyntaxKind.ExportKeyword) || (node.parent != null && ts.isExportDeclaration(node.parent));
}

function paramText(p: ts.ParameterDeclaration, sf: ts.SourceFile): string {
    const name = p.name.getText(sf).replace(/\s+/g, " ");
    const opt = p.questionToken ? "?" : "";
    const rest = p.dotDotDotToken ? "..." : "";
    const type = p.type ? `: ${p.type.getText(sf).replace(/\s+/g, " ")}` : "";
    return `${rest}${name}${opt}${type}`;
}

function retText(node: ts.SignatureDeclaration, sf: ts.SourceFile): string {
    return node.type ? `: ${node.type.getText(sf).replace(/\s+/g, " ")}` : "";
}

/** 分组键：忽略名字与返回类型，只看「参数形态」——重复实现最常表现为此相同。 */
function shapeKeyOf(params: readonly string[]): string {
    return `(${params.join(", ").replace(/[A-Za-z_$][\w$]*:/g, ":")})`;
}

function pushRecord(records: DupRecord[], sf: ts.SourceFile, file: string, node: ts.Node, kind: DupRecord["kind"], name: string, params: readonly string[], ret: string, exported: boolean): void {
    records.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        kind,
        name,
        exported,
        signature: `${name}(${params.join(", ")})${ret}`,
        shapeKey: shapeKeyOf(params),
    });
}

/** 旧脚本 walk 原样：全递归（forEachChild），函数形定义三种载体全收。 */
function collectFromNode(node: ts.Node, sf: ts.SourceFile, file: string, records: DupRecord[]): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
        const params = node.parameters.map((p) => paramText(p, sf));
        pushRecord(records, sf, file, node, "function", node.name.getText(sf), params, retText(node, sf), isExported(node));
    }
    if (ts.isVariableStatement(node)) {
        const stmtExported = isExported(node);
        for (const d of node.declarationList.declarations) {
            const init = d.initializer;
            if (!init || (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init))) continue;
            const params = init.parameters.map((p) => paramText(p, sf));
            pushRecord(records, sf, file, d, "const-fn", d.name.getText(sf), params, retText(init, sf), stmtExported);
        }
    }
    if (ts.isClassDeclaration(node) && node.name) {
        const cls = node.name.getText(sf);
        for (const m of node.members) {
            if (ts.isMethodDeclaration(m) && m.name) {
                const kind = hasModifier(m, ts.SyntaxKind.PrivateKeyword) ? "method-private" : "method";
                const params = m.parameters.map((p) => paramText(p, sf));
                pushRecord(records, sf, file, m, kind, `${cls}.${m.name.getText(sf)}`, params, retText(m, sf), isExported(node));
            }
            if (ts.isPropertyDeclaration(m) && m.name && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
                const kind = hasModifier(m, ts.SyntaxKind.PrivateKeyword) ? "prop-fn-private" : "prop-fn";
                const params = m.initializer.parameters.map((p) => paramText(p, sf));
                pushRecord(records, sf, file, m, kind, `${cls}.${m.name.getText(sf)}`, params, retText(m.initializer, sf), isExported(node));
            }
        }
    }
    ts.forEachChild(node, (c) => collectFromNode(c, sf, file, records));
}

/** 单文件收集（text 直解析，供测试内存构造）。 */
export function dupRecordsOfText(file: string, text: string): DupRecord[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const records: DupRecord[] = [];
    collectFromNode(sf, sf, file, records);
    return records;
}

/** dup 扫描文件集（旧 list-dup-signatures --all 口径）：tracked 的 packages/apps 下含 /src/ 的 .ts/.tsx，排除 .d.ts 与 apps/cli。 */
export function dupScanFiles(): string[] {
    return gitLines("git ls-files packages apps")
        .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".d.ts"))
        .filter((f) => f.includes("/src/"))
        .filter((f) => !f.startsWith("apps/cli/"))
        .sort();
}

function appendTo(map: Map<string, DupRecord[]>, key: string, value: DupRecord): void {
    const list = map.get(key);
    if (list != null) list.push(value);
    else map.set(key, [value]);
}

/** /src/ 侧判定：测试 helper 的自包含重复是刻意设计，不参与门禁（旧 collectDupGroups 同判据）。 */
function isSrc(r: DupRecord): boolean {
    return r.file.includes("/src/");
}

/** 只把 /src/ 侧的重复计入。 */
export function groupDupRecords(records: readonly DupRecord[]): DupGroups {
    const byName = new Map<string, DupRecord[]>();
    const byShape = new Map<string, DupRecord[]>();
    for (const r of records) {
        appendTo(byName, r.name, r);
        appendTo(byShape, r.shapeKey, r);
    }
    return {
        named: Object.fromEntries([...byName.entries()].filter(([, v]) => v.length > 1 && v.every(isSrc)).map(([k, v]) => [k, v.map((r) => `${r.file}:${r.line}`).sort()])),
        shaped: Object.fromEntries([...byShape.entries()].filter(([, v]) => v.length > 1 && v.every(isSrc)).map(([k, v]) => [k, v.map((r) => `${r.file}:${r.line}`).sort()])),
    };
}

/** 全仓分组（gate / baseline write 共用）。 */
export function scanDupGroups(): DupGroups {
    const records: DupRecord[] = [];
    for (const rel of dupScanFiles()) {
        let text: string;
        try {
            text = readFileSync(path.resolve(process.cwd(), rel), "utf8");
        } catch {
            continue;
        }
        records.push(...dupRecordsOfText(rel, text));
    }
    return groupDupRecords(records);
}

export interface DupGateResult {
    addedNamed: string[];
    addedShaped: string[];
    goneNamed: string[];
    goneShaped: string[];
}

/** gate 比对：新增键即 FIND（exit 1），消除键=改善（不阻断），site 列表纯展示。 */
export function dupGateCompare(baseline: { named?: Record<string, unknown>; shaped?: Record<string, unknown> }, current: DupGroups): DupGateResult {
    return {
        addedNamed: Object.keys(current.named).filter((k) => !(k in (baseline.named ?? {}))),
        addedShaped: Object.keys(current.shaped).filter((k) => !(k in (baseline.shaped ?? {}))),
        goneNamed: Object.keys(baseline.named ?? {}).filter((k) => !(k in current.named)),
        goneShaped: Object.keys(baseline.shaped ?? {}).filter((k) => !(k in current.shaped)),
    };
}

export type JudgedSections = { named: Record<string, unknown>; shaped: Record<string, unknown> };

function objOf(value: unknown): Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * judged 抢救：旧文件 judgedAfterP17 → judgedAfterP18 → 旧 v2 judged 三层并入（后写覆盖同名键）；
 * 键仍存在于新扫描的照搬含理由，键消失的进 dropped 清单（调用方 console.error）。
 */
export function salvageJudged(oldPayload: unknown, current: DupGroups): { judged: JudgedSections; dropped: Array<{ section: "named" | "shaped"; key: string }> } {
    const record = (oldPayload ?? {}) as Record<string, unknown>;
    const merged: JudgedSections = { named: {}, shaped: {} };
    for (const field of ["judgedAfterP17", "judgedAfterP18", "judged"]) {
        const section = objOf(record[field]);
        for (const key of Object.keys(objOf(section.named))) merged.named[key] = objOf(section.named)[key];
        for (const key of Object.keys(objOf(section.shaped))) merged.shaped[key] = objOf(section.shaped)[key];
    }
    const judged: JudgedSections = { named: {}, shaped: {} };
    const dropped: Array<{ section: "named" | "shaped"; key: string }> = [];
    for (const section of ["named", "shaped"] as const) {
        for (const key of Object.keys(merged[section])) {
            if (key in current[section]) judged[section][key] = merged[section][key];
            else dropped.push({ section, key });
        }
    }
    return { judged, dropped };
}

/** 基线 v2 payload：judged 段为人工裁决的有意保留组（gate 不消费，键消失由下次 write 警告）。 */
export function dupBaselinePayload(current: DupGroups, judged: JudgedSections, note: string): Record<string, unknown> {
    return {
        note,
        toolVersion: toolVersion(),
        generatedAt: new Date().toISOString(),
        namedGroups: Object.keys(current.named).length,
        shapedGroups: Object.keys(current.shaped).length,
        named: current.named,
        shaped: current.shaped,
        judged,
    };
}
