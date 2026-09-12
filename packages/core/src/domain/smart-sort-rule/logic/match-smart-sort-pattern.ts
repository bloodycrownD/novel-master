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
 *
 * @module domain/smart-sort-rule/logic/match-smart-sort-pattern
 */

/**
 * Single match: full match text + start offset in the tested text
 * (code-unit offset; zero-width matches carry an empty text) + capture
 * groups (null = group not hit).
 */
export interface SmartSortPatternMatch {
  readonly text: string;
  readonly index: number;
  readonly groups: readonly (string | null)[];
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
 */
export function matchSmartSortPattern(
  pattern: string,
  flags: string,
  text: string
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
    matches.push({
      text: m[0],
      // matchAll 的 m.index 恒为数字；?? 0 仅为类型收窄（never hit）。
      index: m.index ?? 0,
      // m.slice(1) keeps holes as undefined; normalize to null for JSON-safe
      // IPC transport (desktop DTO) and a stable '-' rendering on both GUIs.
      groups: m.slice(1).map((g) => g ?? null),
    });
  }
  return { ok: true, matches };
}
