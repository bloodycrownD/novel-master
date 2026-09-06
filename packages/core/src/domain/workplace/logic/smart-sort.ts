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

/** Chinese numeral char → numeric value (mirrors legado `ChnMap`). */
const CHN_NUM_VALUE: Readonly<Record<string, number>> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  〇: 0,
  壹: 1,
  贰: 2,
  叁: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  柒: 7,
  捌: 8,
  玖: 9,
  拾: 10,
  两: 2,
  百: 100,
  佰: 100,
  千: 1000,
  仟: 1000,
  万: 10000,
  亿: 100000000,
};

/**
 * Positional form accepts exactly the single-digit characters (mirrors legado
 * `^[〇零一二三四五六七八九壹贰叁肆伍陆柒捌玖]+$` — no 两/十/百/千/万/亿).
 */
const CHN_POSITIONAL_CHARS = /^[〇零一二三四五六七八九壹贰叁肆伍陆柒捌玖]+$/;

/** Whole-run ASCII integer (mirrors legado `toInt` acceptance: `-?[0-9]+`). */
const ASCII_INT = /^-?[0-9]+$/;

function isAsciiDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/**
 * Full-width ASCII range → half-width (mirrors legado `fullToHalf`, including
 * the full-width space U+3000). Chinese numerals are unaffected.
 */
function fullWidthToHalf(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      out += " ";
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Chinese numeral string → number, power form ("一千零二十五" → 1025, including
 * unit abbreviations like "一千二" → 1200 and 亿-level carry).
 *
 * Returns `null` when any character is not a recognized Chinese numeral
 * (legado returns -1 there; `null` keeps the caller from conflating it with a
 * real value).
 */
function chineseNumToIntPowerForm(s: string): number | null {
  let result = 0;
  let tmp = 0;
  let billion = 0;
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const value = CHN_NUM_VALUE[chars[i]];
    if (value === undefined) {
      return null;
    }
    if (value === 100000000) {
      result += tmp;
      result *= value;
      billion = billion * 100000000 + result;
      result = 0;
      tmp = 0;
    } else if (value === 10000) {
      result += tmp;
      result *= value;
      tmp = 0;
    } else if (value >= 10) {
      if (tmp === 0) {
        tmp = 1;
      }
      result += value * tmp;
      tmp = 0;
    } else {
      // Single digit. A trailing digit directly after a 百/千/万/亿 unit is
      // the abbreviated form: "一千二" → 2 * 1000 / 10 = 200 (legado rule:
      // i >= 2, last char, previous char's unit > 10).
      const prevUnit =
        i >= 2 && i === chars.length - 1 ? CHN_NUM_VALUE[chars[i - 1]] : undefined;
      tmp =
        prevUnit !== undefined && prevUnit > 10
          ? (value * prevUnit) / 10
          : tmp * 10 + value;
    }
  }
  return result + tmp + billion;
}

/**
 * Parses a captured group into a number (legado `stringToInt` semantics).
 *
 * Whitespace is stripped and full-width digits are folded to half-width first;
 * a pure ASCII integer run converts via `Number()` ("001" → 1, keeping leading
 * zeros); otherwise the string is parsed as a Chinese numeral (positional
 * "一零二五" → 1025, power "一千零二十五" → 1025, uppercase forms included).
 * Returns `null` when neither path applies (empty / mixed / unknown chars).
 */
export function parseChineseNum(input: string): number | null {
  const s = fullWidthToHalf(input).replace(/\s+/g, "");
  if (s === "") {
    return null;
  }
  if (ASCII_INT.test(s)) {
    return Number(s);
  }
  if (s.length > 1 && CHN_POSITIONAL_CHARS.test(s)) {
    let digits = "";
    for (const ch of s) {
      digits += String(CHN_NUM_VALUE[ch]);
    }
    return Number(digits);
  }
  return chineseNumToIntPowerForm(s);
}

/**
 * Splits a string into alternating ASCII-digit / non-digit chunks (digits are
 * exactly `0-9`; everything else, including full-width digits and Chinese
 * characters, is non-digit). Mirrors legado `AlphanumComparator.getChunk`.
 */
export function tokenizeNatural(s: string): string[] {
  const chunks: string[] = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const digitChunk = isAsciiDigitCode(s.charCodeAt(i));
    const start = i;
    i++;
    while (i < n && isAsciiDigitCode(s.charCodeAt(i)) === digitChunk) {
      i++;
    }
    chunks.push(s.slice(start, i));
  }
  return chunks;
}

/**
 * Natural order over raw strings (legado `AlphanumComparator`):
 * both digit chunks → longer chunk first (digit count), then code unit by
 * code unit; otherwise whole-chunk code-unit order; a string whose chunks run
 * out first sorts first (by total length difference).
 */
function compareNatural(a: string, b: string): number {
  const chunksA = tokenizeNatural(a);
  const chunksB = tokenizeNatural(b);
  const common = Math.min(chunksA.length, chunksB.length);
  for (let i = 0; i < common; i++) {
    const x = chunksA[i];
    const y = chunksB[i];
    if (isAsciiDigitCode(x.charCodeAt(0)) && isAsciiDigitCode(y.charCodeAt(0))) {
      if (x.length !== y.length) {
        return x.length - y.length;
      }
      for (let j = 0; j < x.length; j++) {
        const r = x.charCodeAt(j) - y.charCodeAt(j);
        if (r !== 0) {
          return r;
        }
      }
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/** Number tuple order: element-wise; equal prefix → shorter tuple first. */
function compareNumberTuples(a: readonly number[], b: readonly number[]): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/** Runtime-compiled smart sort rule (`regex` is built via `new RegExp(pattern, flags)`). */
export interface CompiledSmartSortRule {
  /** Stable rule id (e.g. `builtin-zh-chapter`). */
  readonly ruleId: string;
  /** Human-readable rule name. */
  readonly name: string;
  /** Pre-compiled pattern; each capture group is one ordinal component (D6). */
  readonly regex: RegExp;
}

/**
 * Decorate-sort-undecorate key cache: basename → extracted ordinal tuple
 * (`null` = no ordinal). The caller pre-extracts keys for every basename with
 * {@link extractSortKey} before sorting (D5), so each name matches the rule
 * list exactly once instead of once per comparison.
 */
export type SmartSortKeyCache = Map<string, readonly number[] | null>;

/** Which rule claimed the basename and the ordinals it yielded (preview / diagnostics). */
export interface SmartSortKeyDetail {
  readonly ruleId: string;
  readonly nums: readonly number[];
}
/**
 * Same priority walk as {@link extractSortKey} but also reports which rule
 * claimed the basename (used by the smart-sort-rule preview API, Step 7).
 */
export function extractSortKeyDetail(
  basename: string,
  rules: readonly CompiledSmartSortRule[],
): SmartSortKeyDetail | null {
  for (const rule of rules) {
    // A `g`-flagged regex keeps lastIndex across execs; always match from 0.
    rule.regex.lastIndex = 0;
    const match = rule.regex.exec(basename);
    if (match === null) {
      continue;
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
      const value = typeof group === "string" ? parseChineseNum(group) : null;
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
}

/**
 * Extracts the ordinal tuple from a basename by trying `rules` in priority
 * order (D6): the first rule whose regex matches AND whose capture groups all
 * parse as numbers wins; any unparsable / unmatched group skips that rule and
 * falls through to the next one. Returns `null` when no rule yields an
 * ordinal (the basename then orders via the natural fallback).
 */
export function extractSortKey(
  basename: string,
  rules: readonly CompiledSmartSortRule[],
): readonly number[] | null {
  return extractSortKeyDetail(basename, rules)?.nums ?? null;
}

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
export function compareSmartBasenames(
  a: string,
  b: string,
  order: SortOrder,
  cache?: SmartSortKeyCache,
): number {
  const keyA = cache?.get(a) ?? null;
  const keyB = cache?.get(b) ?? null;
  let cmp: number;
  if (keyA !== null && keyB !== null) {
    cmp = compareNumberTuples(keyA, keyB);
    if (cmp === 0) {
      cmp = compareNatural(a, b);
    }
  } else if (keyA !== null) {
    cmp = -1;
  } else if (keyB !== null) {
    cmp = 1;
  } else {
    cmp = compareNatural(a, b);
  }
  return order === "desc" ? (cmp === 0 ? 0 : -cmp) : cmp;
}
