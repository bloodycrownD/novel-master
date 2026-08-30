/**
 * 统计页展示层纯函数（跨端共用）：请求流水时间、耗时/首字延迟、页码条窗口。
 *
 * 双端行为一致契约：desktop renderer 因 X1 门禁不能 import core，那边在
 * `apps/desktop/shared/logic/usage-stats-format.ts` 维护等价镜像，
 * 修改任一份时同步另一份（两份注释互指）。
 */

/** 请求流水时间：MM-DD HH:mm（本地时区）。 */
export function formatRequestTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** 耗时/首字延迟展示：秒级 x.x s / 毫秒级 xxx ms；无数据显示横杠。 */
export function formatDurationMs(ms: number | null): string {
  if (ms == null) {
    return "—";
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 页码条窗口：总页数 ≤7 全展示；否则首尾页 + 当前页 ±1，间隙用省略号。 */
export function pageWindowItems(
  current: number,
  totalPages: number
): (number | "…")[] {
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
