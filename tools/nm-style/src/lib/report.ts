/**
 * 发现（Finding）类型、verdict 集合、阻断判定辅助与输出聚合。
 * blocking 由规则层按 spec §3.3 阻断矩阵 + 模式计算后写进 Finding；本模块只做 verdict 集合判定与聚合输出。
 */

import { formatTable } from "./core.js";

export type RuleName = "signatures" | "hygiene" | "bare-exports" | "dup" | "clusters" | "oop" | "top-level-let";
export type HygieneFace = "private" | "class-public" | "exported";

export interface Finding {
    rule: RuleName;
    /** 相对被扫仓根的 posix 路径。 */
    file: string;
    line: number;
    symbol: string;
    verdict: string;
    detail?: string;
    /** hygiene 预留（Step 5 填值）：private / class-public / exported。 */
    face?: HygieneFace;
    /** hygiene 预留（Step 5 填值）：symbol-index 的八值 form。 */
    form?: string;
    blocking: boolean;
}

export const SIGNATURES_VERDICTS = ["PARAMS", "ARGS", "IMPORT", "VARDECL", "ASSIGN"] as const;
export const HYGIENE_VERDICTS = ["FAKE_PUBLIC", "DEAD", "TEST_ONLY", "INLINE_CANDIDATE", "PASS_THROUGH", "AMBIGUOUS", "KEEP_PUBLIC", "KEEP_LOCAL"] as const;
export const OOP_VERDICTS = ["OOP_CANDIDATE", "MANY_EXPORTS"] as const;
export const TOP_LEVEL_LET_VERDICTS = ["TOP_LEVEL_LET"] as const;
/** hygiene 里永不阻断的 verdict（AMBIGUOUS 是短路信息项，KEEP_* 是豁免结果）。 */
export const HYGIENE_NEVER_BLOCKING: ReadonlySet<string> = new Set(["AMBIGUOUS", "KEEP_PUBLIC", "KEEP_LOCAL"]);

/**
 * verdict 本身决定的部分：signatures 五类全阻断；hygiene 除 AMBIGUOUS/KEEP_* 外均为阻断候选
 * （exported 面仅在 --changed/--all/--strict 阻断的差异化由 hygiene 规则补齐）。
 * bare-exports/dup/clusters 走 gate 语义、oop 默认记录——是否阻断取决于模式，由规则层定，这里恒 false。
 */
export function isBlockingVerdict(rule: RuleName, verdict: string): boolean {
    if (rule === "signatures") return (SIGNATURES_VERDICTS as readonly string[]).includes(verdict);
    if (rule === "hygiene") return !HYGIENE_NEVER_BLOCKING.has(verdict);
    return false;
}

export function locationOf(finding: Finding): string {
    return `${finding.file}:${finding.line}`;
}

/** 列布局对齐旧脚本（verdict 在前、location 其次）；face/form 未填时留空列。 */
export function formatFindingsTable(findings: readonly Finding[]): string {
    const headers = ["verdict", "location", "rule", "face", "form", "symbol", "detail"];
    const rows = findings.map((finding) => [finding.verdict, locationOf(finding), finding.rule, finding.face ?? "", finding.form ?? "", finding.symbol, finding.detail ?? ""]);
    return formatTable(headers, rows);
}

export function toJson(findings: readonly Finding[]): string {
    return JSON.stringify(findings, null, 2);
}

/** 退出码聚合：有阻断发现 → 1，干净 → 0。用法错误 2 由 cli 层管。 */
export function exitCodeFor(findings: readonly Finding[]): 0 | 1 {
    return findings.some((finding) => finding.blocking) ? 1 : 0;
}
