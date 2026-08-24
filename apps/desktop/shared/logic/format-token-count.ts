/**
 * token 数量紧凑格式化（999 以下原样 / K / M 一位小数压缩）。
 * 结构等价复制自 packages/core/src/common/format-token-count.ts 的 formatTokenCount
 * ——renderer 禁止 import core（eslint X1 门禁），desktop 侧副本统一放 shared/logic。
 * 两份实现需保持行为一致：修改任一份时同步另一份。
 */
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
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = rounded / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
}
