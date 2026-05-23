/**
 * `<trim>` tag: override tokens and optional prefix/suffix.
 */

function parseOverrides(overrides: string | undefined): string[] {
  if (!overrides?.trim()) return [];
  return overrides.split("|").map((t) => t.trim()).filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips leading override tokens (case-insensitive), then trailing overrides.
 */
export function applyTrimOverrides(
  content: string,
  attrs: {
    prefix?: string;
    suffix?: string;
    prefixOverrides?: string;
    suffixOverrides?: string;
  },
): string {
  let s = content;

  for (const token of parseOverrides(attrs.prefixOverrides)) {
    const re = new RegExp(`^\\s*${escapeRegExp(token)}\\b\\s*`, "i");
    if (re.test(s)) {
      s = s.replace(re, "");
    }
  }

  for (const token of parseOverrides(attrs.suffixOverrides)) {
    const re = new RegExp(`\\s*${escapeRegExp(token)}\\b\\s*$`, "i");
    if (re.test(s)) {
      s = s.replace(re, "");
    }
  }

  const prefix = attrs.prefix ?? "";
  const suffix = attrs.suffix ?? "";
  return `${prefix}${s}${suffix}`;
}
