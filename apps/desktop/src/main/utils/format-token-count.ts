/** Compact token count labels (ported from mobile). */

function trimTrailingZeros(s: string): string {
  return s.replace(/\.0$/, "");
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "—";
  }
  const rounded = Math.round(n);
  if (rounded < 1000) {
    return String(rounded);
  }
  if (rounded < 1_000_000) {
    const k = rounded / 1000;
    if (k >= 100) {
      return `${Math.round(k)}K`;
    }
    return `${trimTrailingZeros(k.toFixed(1))}K`;
  }
  const m = rounded / 1_000_000;
  if (m >= 100) {
    return `${Math.round(m)}M`;
  }
  return `${trimTrailingZeros(m.toFixed(1))}M`;
}

export function formatPromptTokenUsageLabel(
  count: number,
  contextWindowTokens?: number,
  options?: { readonly estimated?: boolean },
): string {
  const prefix = options?.estimated ? "~" : "";
  const current = formatTokenCount(count);
  if (contextWindowTokens == null || contextWindowTokens <= 0) {
    return options?.estimated
      ? `${prefix}${current} tokens (est.)`
      : `${current} tokens`;
  }
  const pct = Math.min(999, Math.round((count / contextWindowTokens) * 100));
  return `${prefix}${pct}% • ${current}/${formatTokenCount(contextWindowTokens)}`;
}
