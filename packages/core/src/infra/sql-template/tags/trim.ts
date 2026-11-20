/**
 * `<trim>` tag: override tokens and optional prefix/suffix.
 */

/**
 * `<trim>` 标签的前后缀覆写策略。
 */
export const SqlTemplateTrim = {
  parseOverrides(overrides: string | undefined): string[] {
    if (!overrides?.trim()) return [];
    const parts = overrides.split("|");
    return parts.map((t) => t.trim()).filter(Boolean);
  },

  escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  /**
   * Strips leading override tokens (case-insensitive), then trailing overrides.
   */
  applyOverrides(content: string, attrs: { prefix?: string; suffix?: string; prefixOverrides?: string; suffixOverrides?: string }): string {
    let s = content;

    for (const token of SqlTemplateTrim.parseOverrides(attrs.prefixOverrides)) {
      const re = new RegExp(`^\\s*${SqlTemplateTrim.escapeRegExp(token)}\\b\\s*`, "i");
      if (re.test(s)) {
        s = s.replace(re, "");
      }
    }

    for (const token of SqlTemplateTrim.parseOverrides(attrs.suffixOverrides)) {
      const re = new RegExp(`\\s*${SqlTemplateTrim.escapeRegExp(token)}\\b\\s*$`, "i");
      if (re.test(s)) {
        s = s.replace(re, "");
      }
    }

    const prefix = attrs.prefix ?? "";
    const suffix = attrs.suffix ?? "";
    return `${prefix}${s}${suffix}`;
  },
} as const;
