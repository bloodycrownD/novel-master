/**
 * 统计页展示层纯函数（desktop 侧）：请求流水时间、耗时/首字延迟、页码条窗口。
 * 结构等价复制自 packages/core/src/common/usage-stats-format.ts
 * ——renderer 禁止 import core（eslint X1 门禁），desktop 侧副本统一放 shared/logic。
 * 双端行为一致契约：修改任一份时同步另一份。
 */

/** 请求流水时间展示：本地时区 `MM-DD HH:mm`。 */
export function formatRequestTime(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hh}:${mm}`;
}

/**
 * 耗时/首字延迟展示：秒级 `x.x s` / 毫秒级 `xxx ms`；无数据显示横杠。
 * （原 `formatFirstTokenMs` 与本函数语义等价，已合并为一份。）
 */
export function formatDurationMs(ms: number | null): string {
  if (ms == null) {
    return "—";
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 页码条窗口：总页数 ≤7 全展示；否则首尾页 + 当前页 ±1，间隙用省略号。 */
export function pageWindowItems(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items: (number | "…")[] = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(totalPages - 1, current + 1);
  if (lo > 2) {
    items.push("…");
  }
  for (let p = lo; p <= hi; p += 1) {
    items.push(p);
  }
  if (hi < totalPages - 1) {
    items.push("…");
  }
  items.push(totalPages);
  return items;
}
