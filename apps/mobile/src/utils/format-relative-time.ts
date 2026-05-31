/**
 * Short relative time for list subtitles (zh).
 */
export function formatRelativeTimeMs(ms: number, nowMs = Date.now()): string {
  const delta = Math.max(0, nowMs - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < minute) {
    return '刚刚';
  }
  if (delta < hour) {
    return `${Math.floor(delta / minute)} 分钟前`;
  }
  if (delta < day) {
    return `${Math.floor(delta / hour)} 小时前`;
  }
  if (delta < 7 * day) {
    return `${Math.floor(delta / day)} 天前`;
  }
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
