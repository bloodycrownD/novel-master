/**
 * `/pattern/flags` literal-style input parsing for the smart sort rule editor
 * (GUI single source; CLI keeps explicit --pattern/--flags and does not use it).
 *
 * Semantics (JS-literal aligned):
 * - Input not starting with `/` is a bare pattern: `{ pattern: input, flags: '' }`.
 * - Input starting with `/` is treated as a literal only when it closes
 *   cleanly: the delimiter is the rightmost UNESCAPED `/` (a `\/` pair stays
 *   inside the body), the tail after it must be valid flags (gimsuy subset,
 *   no repeats — same rule as the schema-level assertFlagsValid), and the body
 *   must be non-empty and contain no unescaped `/`. Otherwise the whole input
 *   degrades to a bare pattern with empty flags (e.g. `/x/q`, `//`, `/a/b/i`).
 *
 * @module domain/smart-sort-rule/logic/parse-pattern-input
 */

/** Parse result of {@link parsePatternInput}: pattern + flags ('' when bare). */
export interface ParsedPatternInput {
  readonly pattern: string;
  readonly flags: string;
}

/** Flags validity (gimsuy subset, no repeats) — mirrors schema assertFlagsValid. */
function isValidFlags(flags: string): boolean {
  return (
    /^[gimsuy]*$/.test(flags) && new Set(flags).size === flags.length
  );
}

/** Whether `text` contains a `/` not preceded by an odd number of backslashes. */
function containsUnescapedSlash(text: string): boolean {
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === "/") {
      return true;
    }
  }
  return false;
}

/** Escape unescaped `/` as `\/` so a formatted literal always round-trips. */
function escapeUnescapedSlash(text: string): string {
  let result = "";
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      result += ch;
      escaped = false;
    } else if (ch === "\\") {
      result += ch;
      escaped = true;
    } else if (ch === "/") {
      result += "\\/";
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Parses a GUI regex input that may use `/pattern/flags` literal style.
 *
 * - `第(\d+)章` → `{ pattern: "第(\\d+)章", flags: "" }`
 * - `/第(\d+)章/i` → `{ pattern: "第(\\d+)章", flags: "i" }`
 * - Malformed literals (`/x/q`, `//`, unclosed `/x`, unescaped `/` in body)
 *   fall back to the whole input as a bare pattern with empty flags.
 */
export function parsePatternInput(input: string): ParsedPatternInput {
  if (!input.startsWith("/")) {
    return { pattern: input, flags: "" };
  }
  // Rightmost unescaped `/` closes the literal; `\/` pairs stay in the body.
  for (let i = input.length - 1; i >= 1; i--) {
    if (input[i] !== "/") {
      continue;
    }
    let backslashes = 0;
    for (let j = i - 1; j >= 1 && input[j] === "\\"; j--) {
      backslashes++;
    }
    if (backslashes % 2 === 1) {
      continue; // `\/` — escaped, still part of the body.
    }
    const body = input.slice(1, i);
    const flags = input.slice(i + 1);
    // Empty body (JS has no empty-regex literal), invalid flags, or an
    // unescaped `/` inside the body all mean "not a literal" — degrade to
    // treating the whole input as a bare pattern.
    if (body === "" || !isValidFlags(flags) || containsUnescapedSlash(body)) {
      break;
    }
    return { pattern: body, flags };
  }
  return { pattern: input, flags: "" };
}

/**
 * Formats a stored pattern + flags back into editor input text: always the
 * `/pattern/flags` literal form (empty flags render as `/pattern/`, so the
 * echo-back style stays uniform regardless of flags). Unescaped `/` inside
 * the pattern is escaped as `\/` so the formatted text always parses back
 * to the same pattern + flags (round-trip).
 */
export function formatPatternInput(pattern: string, flags: string): string {
  return `/${escapeUnescapedSlash(pattern)}/${flags}`;
}
