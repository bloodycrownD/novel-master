/**
 * known-false-positives（KFP）加载与匹配。
 * schema v2：entry = { rule, file, symbol(null=整文件), line?, category?, reason, basis? }，顶层 suppressPrefixes。
 * rule 值域 signatures | hygiene | oop；bare-exports / dup / clusters 不吃 KFP（bare-exports 的唯一豁免通道
 * 是源码内 keep-bare 注释，gate 类新增即红）。
 * 匹配：rule+file 相等 + symbol（null → 整文件；精确相等；或 finding.symbol 以 "."+symbol 结尾）+
 * line 可选（entry.line 为 0/缺省不比行）。signatures 例外：用 finding.detail 包含 entry.symbol 匹配
 * （v2 修正——旧精确/后缀匹配对 signatures 的 detail 切片从未命中过）。
 * suppressPrefixes 由调用方用 isSuppressed 先行跳过（对齐旧 check-style 的 assess 流程）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toPosix } from "./core.js";
import type { Finding, RuleName } from "./report.js";

export type KfpRule = Extract<RuleName, "signatures" | "hygiene" | "oop">;
const KFP_RULES: ReadonlySet<string> = new Set(["signatures", "hygiene", "oop"]);

export interface KfpEntry {
    rule: KfpRule;
    file: string;
    /** null = 整文件命中。 */
    symbol: string | null;
    /** 0/缺省 = 不比行。 */
    line?: number;
    category?: string;
    reason: string;
    basis?: string;
}

export interface KfpManifest {
    entries: KfpEntry[];
    /** 已归一为带尾斜杠的 posix 前缀。 */
    suppressPrefixes: string[];
}

/** 缺省取包根的 known-false-positives.json：dist/lib/kfp.js 按自身位置回指包根，禁用 cwd 定位自己的资产。 */
const DEFAULT_KFP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "known-false-positives.json");

function emptyManifest(): KfpManifest {
    return { entries: [], suppressPrefixes: [] };
}

/** 加载 KFP：值域外或缺 file/reason 的条目打 console.error 后剔除，其余原样保留。 */
export function loadKfp(file: string = DEFAULT_KFP_PATH): KfpManifest {
    if (!fs.existsSync(file)) return emptyManifest();
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.error(`nm-style: ${path.basename(file)} 解析失败，按无豁免运行 —— ${error instanceof Error ? error.message : String(error)}`);
        return emptyManifest();
    }
    const record = (parsed ?? {}) as Record<string, unknown>;
    const entries: KfpEntry[] = [];
    for (const raw of Array.isArray(record.entries) ? record.entries : []) {
        const entry = (raw ?? {}) as Record<string, unknown>;
        if (typeof entry.rule !== "string" || !KFP_RULES.has(entry.rule)) {
            console.error(`nm-style: KFP 条目 rule「${String(entry.rule)}」不在值域 signatures|hygiene|oop，已忽略（file=${String(entry.file)}）`);
            continue;
        }
        if (typeof entry.file !== "string" || entry.file.length === 0 || typeof entry.reason !== "string") {
            console.error(`nm-style: KFP 条目缺 file/reason，已忽略（rule=${String(entry.rule)}）`);
            continue;
        }
        entries.push({
            rule: entry.rule as KfpRule,
            file: entry.file,
            symbol: typeof entry.symbol === "string" && entry.symbol.length > 0 ? entry.symbol : null,
            line: typeof entry.line === "number" && Number.isFinite(entry.line) ? entry.line : undefined,
            category: typeof entry.category === "string" ? entry.category : undefined,
            reason: entry.reason,
            basis: typeof entry.basis === "string" ? entry.basis : undefined,
        });
    }
    const suppressPrefixes = (Array.isArray(record.suppressPrefixes) ? record.suppressPrefixes : []).filter((value): value is string => typeof value === "string" && value.length > 0).map((value) => {
        const posix = toPosix(value);
        return posix.endsWith("/") ? posix : `${posix}/`;
    });
    return { entries, suppressPrefixes };
}

export type KfpFinding = Pick<Finding, "rule" | "file" | "line" | "symbol" | "detail">;

/** 单条 finding 是否命中清单：命中返回条目（供降级 INFO），未命中返回 null。 */
export function matchEntry(finding: KfpFinding, kfp: KfpManifest): KfpEntry | null {
    const file = toPosix(finding.file);
    for (const entry of kfp.entries) {
        if (entry.rule !== finding.rule) continue;
        if (toPosix(entry.file) !== file) continue;
        if (entry.line != null && entry.line !== 0 && entry.line !== finding.line) continue;
        if (entry.symbol == null) return entry;
        const target = finding.rule === "signatures" ? finding.detail ?? finding.symbol : finding.symbol;
        const hit = finding.rule === "signatures" ? target.includes(entry.symbol) : target === entry.symbol || target.endsWith(`.${entry.symbol}`);
        if (hit) return entry;
    }
    return null;
}

/** suppressPrefixes 命中（前缀开头，或恰好等于目录本身）→ 该 finding 不进报告。 */
export function isSuppressed(file: string, kfp: KfpManifest): boolean {
    const rel = toPosix(file);
    return kfp.suppressPrefixes.some((prefix) => rel.startsWith(prefix) || rel === prefix.slice(0, -1));
}
