/**
 * Compact token count labels (e.g. 2500 → "2.5K").
 */

function trimTrailingZeros(s: string): string {
  return s.replace(/\.0$/, '');
}

/** Formats a token count with K / M suffix when large enough. */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return '—';
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

/** Chat meta: `~88% • 327/128K` when context window known; `~64K tokens (est.)` when estimated. */
export function formatPromptTokenUsageLabel(
  count: number,
  contextWindowTokens?: number,
  options?: { readonly estimated?: boolean },
): string {
  const prefix = options?.estimated ? '~' : '';
  const current = formatTokenCount(count);
  if (contextWindowTokens == null || contextWindowTokens <= 0) {
    return options?.estimated
      ? `${prefix}${current} tokens (est.)`
      : `${current} tokens`;
  }
  const pct = Math.min(999, Math.round((count / contextWindowTokens) * 100));
  return `${prefix}${pct}% • ${current}/${formatTokenCount(contextWindowTokens)}`;
}

/** @deprecated Use {@link formatPromptTokenUsageLabel} */
export function formatTokenCountLabel(
  count: number,
  budget?: number,
): string {
  return formatPromptTokenUsageLabel(count, budget);
}
