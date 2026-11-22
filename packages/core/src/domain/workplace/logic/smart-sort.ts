/**
 * Smart filename sort primitives: ordinal extraction and the total order
 * comparator (spec `smart-filename-sort` Step 4).
 *
 * All functions are pure (no IO, no database); rules must be pre-compiled by
 * the caller (see `compile-smart-sort-rule.ts`, Step 7) into
 * {@link CompiledSmartSortRule}.
 *
 * Reference semantics:
 * - Chinese numeral parsing mirrors legado `StringUtils.chineseNumToInt` /
 *   `stringToInt` (positional form "一零二五" → 1025, power form "一千零二十五"
 *   → 1025, uppercase 壹贰叁…, unit abbreviations "一千二" → 1200).
 * - Natural fallback ordering mirrors legado `AlphanumComparator` (ASCII digit
 *   chunks vs non-digit chunks; digit chunks compare by length first, then by
 *   code unit; otherwise whole-chunk code-unit order; the string that runs out
 *   first sorts first).
 *
 * @module domain/workplace/logic/smart-sort
 */

import type { SortOrder } from "../model/workplace-types.js";
import type { SmartSortCaptureKind } from "../../smart-sort-rule/model/smart-sort-rule.js";
import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import { Number } from "@/common/number.js";
import { Text } from "@/common/text.js";

/** Runtime-compiled smart sort rule (`regex` is built via `new RegExp(pattern, flags)`). */
export interface CompiledSmartSortRule {
    /** Stable rule id (e.g. `builtin-zh-chapter`). */
    readonly ruleId: string;
    /** Human-readable rule name. */
    readonly name: string;
    /** Pre-compiled pattern; each capture group is one ordinal component (D6). */
    readonly regex: RegExp;
    /** 捕获数字档位（D13）：smart = 捕获组→数字管道；fixed = 哨兵元组。 */
    readonly captureKind: SmartSortCaptureKind;
}

/** fixed_min 哨兵元组：排一切数字序号之前（D13；仅内存比较，不序列化）。 */
export const FIXED_MIN_SORT_TUPLE: readonly number[] = [-Infinity];
/** fixed_max 哨兵元组：沉底（D13；仅内存比较，不序列化）。 */
export const FIXED_MAX_SORT_TUPLE: readonly number[] = [Infinity];

/**
 * Decorate-sort-undecorate key cache: basename → extracted ordinal tuple
 * (`null` = no ordinal). The caller pre-extracts keys for every basename with
 * {@link SmartSort.extractSortKey} before sorting (D5), so each name matches the rule
 * list exactly once instead of once per comparison.
 */
export type SmartSortKeyCache = Map<string, readonly number[] | null>;

/** Which rule claimed the basename and the ordinals it yielded (preview / diagnostics). */
interface SmartSortKeyDetail {
    readonly ruleId: string;
    readonly nums: readonly number[];
}

export const SmartSort = {
    /**
   * 元组显示格式化（D13）：数字元组 → "(12,)" / "(2,13,)" 风格（Python 元组
   * repr 尾逗号）；哨兵元组 → label.smart_sort.pinned_min/max descriptor（GUI
   * 测试预览小字消费，不参与比较）。空数组/非哨兵不在此出现。仅识别 ±Infinity
   * 首元素判定哨兵：数字管道永不产出 ±Infinity（Number.parseChineseNum 有限值）。
   */
    formatSortTupleForDisplay(nums: readonly number[]): string | CoreMessageDescriptor {
        if (nums[0] === -Infinity) {
            return { key: "label.smart_sort.pinned_min" };
        }
        if (nums[0] === Infinity) {
            return { key: "label.smart_sort.pinned_max" };
        }
        return `(${nums.join(",")},)`;
    },

    /**
   * Same priority walk as {@link SmartSort.extractSortKey} but also reports which rule
   * claimed the basename (used by the smart-sort-rule preview API, Step 7).
   */
    extractSortKeyDetail(basename: string, rules: readonly CompiledSmartSortRule[]): SmartSortKeyDetail | null {
        for (const rule of rules) {
            // A `g`-flagged regex keeps lastIndex across execs; always match from 0.
            rule.regex.lastIndex = 0;
            const match = rule.regex.exec(basename);
            if (match === null) {
                continue;
            }
            // fixed 档（D13）：命中即哨兵元组，忽略捕获组（pattern 有无捕获组均可）。
            if (rule.captureKind === "fixed_min") {
                return { ruleId: rule.ruleId, nums: FIXED_MIN_SORT_TUPLE };
            }
            if (rule.captureKind === "fixed_max") {
                return { ruleId: rule.ruleId, nums: FIXED_MAX_SORT_TUPLE };
            }
            const groups = match.slice(1);
            // Zero-capture-group patterns are rejected at compile/validate time
            // (Step 7); defended here so they simply never claim the basename.
            if (groups.length === 0) {
                continue;
            }
            const nums: number[] = [];
            let parsed = true;
            for (const group of groups) {
                const value = typeof group === "string" ? Number.parseChineseNum(group) : null;
                if (value === null) {
                    parsed = false;
                    break;
                }
                nums.push(value);
            }
            if (parsed) {
                return { ruleId: rule.ruleId, nums };
            }
        }
        return null;
    },

    /**
   * Extracts the ordinal tuple from a basename by trying `rules` in priority
   * order (D6): the first rule whose regex matches AND whose capture groups all
   * parse as numbers wins; any unparsable / unmatched group skips that rule and
   * falls through to the next one. Returns `null` when no rule yields an
   * ordinal (the basename then orders via the natural fallback).
   */
    extractSortKey(basename: string, rules: readonly CompiledSmartSortRule[]): readonly number[] | null {
        return SmartSort.extractSortKeyDetail(basename, rules)?.nums ?? null;
    },

    /**
   * Total order over basenames under the smart sort (spec「智能比较全序」five
   * clauses):
   *
   * 1. `a` has an ordinal and `b` does not → `a` first;
   * 2. both have ordinals → element-wise numeric compare, equal prefix →
   *    shorter tuple first;
   * 3. neither has an ordinal → natural order (AlphanumComparator semantics);
   * 4. still tied → raw filename natural order tiebreak (deterministic total
   *    order, e.g. `第1章` before `第一章` — same ordinal [1]);
   * 5. `desc` negates the entire order (strict reversal).
   *
   * Ordinals are read from `cache` (see {@link SmartSortKeyCache}); a basename
   * missing from the cache (or with no cache at all) is treated as ordinal-less
   * — callers should pre-decorate every candidate name.
   */
    compareBasenames(a: string, b: string, order: SortOrder, cache?: SmartSortKeyCache): number {
        const keyA = cache?.get(a) ?? null;
        const keyB = cache?.get(b) ?? null;
        let cmp: number;
        if (keyA !== null && keyB !== null) {
            // Number tuple order: element-wise; equal prefix → shorter tuple first.
            const common = Math.min(keyA.length, keyB.length);
            cmp = keyA.length - keyB.length;
            for (let i = 0; i < common; i++) {
                if (keyA[i] !== keyB[i]) {
                    cmp = keyA[i] < keyB[i] ? -1 : 1;
                    break;
                }
            }
            if (cmp === 0) {
                cmp = Text.compareNatural(a, b);
            }
        } else if (keyA !== null) {
            cmp = -1;
        } else if (keyB !== null) {
            cmp = 1;
        } else {
            cmp = Text.compareNatural(a, b);
        }
        return order === "desc" ? (cmp === 0 ? 0 : -cmp) : cmp;
    },
} as const;
