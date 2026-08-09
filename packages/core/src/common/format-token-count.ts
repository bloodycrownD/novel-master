/**
 * 紧凑的 token 数量与 usage 标签格式化（跨端共用）。
 *
 * 大数值会用 K / M 后缀压缩（例如 2500 → "2.5K"），避免 UI 上挤一长串数字。
 * `formatPromptTokenUsageLabel` 在已知 context window 时会输出百分比 + 占比
 * 形式（`88% • 327/128K`），未知时退回纯计数。
 */

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
