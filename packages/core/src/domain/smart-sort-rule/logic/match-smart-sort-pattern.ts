/**
 * Regex match test for the smart sort rule editor preview (fix ②):
 * given a compiled-ready pattern + flags + free text, list every match
 * with its capture groups. Pure function — GUI single source (mobile calls
 * core directly; desktop reaches it via IPC).
 *
 * Semantics:
 * - Invalid regex never throws: it returns `{ ok: false, error }` so the
 *   editor can render it inline (the test is user-triggered, errors are a
 *   legitimate test outcome rather than an exceptional failure).
 * - Non-global flags still find ALL matches: the matcher clones the regex
 *   with `g` appended and iterates via `matchAll`. Cloning also keeps the
 *   original's `lastIndex` untouched (no hidden state leaking between
 *   repeated test runs when flags already contain `g`).
 * - Each match carries the full match text, its start offset in the tested
 *   text (`index`, from matchAll) and one entry per capture group; a group
 *   that did not participate in the match (optional group) maps to `null`
 *   and renders as '-' in the GUI. The offset lets both GUIs split the
 *   text into plain/highlighted segments without re-searching (duplicate
 *   match texts would make indexOf-style lookups drift).
 * - Zero-width matches report their index with an empty `text`; callers
 *   skip empty segments when rendering.
 * - Each match also carries `tuple` (D13): the display-friendly ordinal
 *   tuple for the given captureKind (fixed kinds render sentinel wording,
 *   smart renders "(12,)"; null = no ordinal, GUI renders 「无序号」).
 *
 * @module domain/smart-sort-rule/logic/match-smart-sort-pattern
 */

import type { SmartSortCaptureKind } from "../model/smart-sort-rule.js";
import {
  FIXED_MAX_SORT_TUPLE,
  FIXED_MIN_SORT_TUPLE,
  formatSortTupleForDisplay,
  parseChineseNum,
} from "@/domain/workplace/logic/smart-sort.js";

/**
 * Single match: full match text + start offset in the tested text
 * (code-unit offset; zero-width matches carry an empty text) + capture
 * groups (null = group not hit) + the display-friendly ordinal tuple
 * (D13; see `tuple`).
 */
export interface SmartSortPatternMatch {
  readonly text: string;
  readonly index: number;
  readonly groups: readonly (string | null)[];
  /**
   * 提取元组的显示字符串（D13）：fixed 档恒为 "(固定最小,)"/"(固定最大,)"
   * （忽略捕获组）；smart 档为捕获组→数字转换后的 "(12,)" 风格，无捕获组
   * 或任一组转换失败时为 null（GUI 渲染「无序号」）。文案单源
   * formatSortTupleForDisplay（C-3）。仅显示用途，排序比较走
   * extractSortKey 的数值元组。
   */
  readonly tuple: string | null;
}

/** Success shape: all matches in first-occurrence order. */
export interface MatchSmartSortPatternOk {
  readonly ok: true;
  readonly matches: readonly SmartSortPatternMatch[];
}

/** Failure shape: regex did not compile (message from the engine). */
export interface MatchSmartSortPatternErr {
  readonly ok: false;
  readonly error: string;
}

export type MatchSmartSortPatternResult =
  | MatchSmartSortPatternOk
  | MatchSmartSortPatternErr;

/**
 * Runs a pattern against free text and lists every match + capture groups.
 * Pure and side-effect free: the returned result is fully derived from the
 * arguments, safe to call on every keystroke (the editor still triggers it
 * manually via the test button, fix ②).
 *
 * captureKind（D13，缺省 'smart'）只影响每个 match 的 `tuple` 展示字段：
 * fixed 档恒显哨兵文案（捕获组被忽略）；smart 档走捕获组→数字转换，
 * 任一组失败则该 match 的 tuple 为 null。匹配本身（text/index/groups）
 * 与档位无关。
 */
export function matchSmartSortPattern(
  pattern: string,
  flags: string,
  text: string,
  captureKind: SmartSortCaptureKind = "smart"
): MatchSmartSortPatternResult {
  let base: RegExp;
  try {
    base = new RegExp(pattern, flags);
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Clone with g for matchAll (needs g even when flags lack it); cloning
  // leaves `base.lastIndex` (and any caller-held regex) untouched.
  const globalFlags = base.flags.includes("g") ? base.flags : `${base.flags}g`;
  const matcher = new RegExp(base.source, globalFlags);
  const matches: SmartSortPatternMatch[] = [];
  for (const m of text.matchAll(matcher)) {
    // m.slice(1) keeps holes as undefined; normalize to null for JSON-safe
    // IPC transport (desktop DTO) and a stable '-' rendering on both GUIs.
    const groups = m.slice(1).map((g) => g ?? null);
    matches.push({
      text: m[0],
      // matchAll 的 m.index 恒为数字；?? 0 仅为类型收窄（never hit）。
      index: m.index ?? 0,
      groups,
      tuple: tupleForCaptureKind(captureKind, groups),
    });
  }
  return { ok: true, matches };
}

/**
 * 单 match 的 tuple 计算（D13）：fixed 档哨兵元组与 smart 档数字元组统一经
 * {@link formatSortTupleForDisplay} 格式化（C-3 单源：哨兵/数字元组文案不再
 * 内联平行实现；smart 档数字管道经 core/B-4 守卫后永不产出 ±Infinity，不会
 * 误触 formatSortTupleForDisplay 的哨兵分支）。
 */
function tupleForCaptureKind(
  captureKind: SmartSortCaptureKind,
  groups: readonly (string | null)[]
): string | null {
  if (captureKind === "fixed_min") {
    return formatSortTupleForDisplay(FIXED_MIN_SORT_TUPLE);
  }
  if (captureKind === "fixed_max") {
    return formatSortTupleForDisplay(FIXED_MAX_SORT_TUPLE);
  }
  if (groups.length === 0) {
    return null;
  }
  const nums: number[] = [];
  for (const group of groups) {
    const value =
      typeof group === "string" ? parseChineseNum(group) : null;
    if (value === null) {
      return null;
    }
    nums.push(value);
  }
  return formatSortTupleForDisplay(nums);
}
