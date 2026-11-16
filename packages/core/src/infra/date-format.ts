/**
 * Local date/time formatting shared by worktree display and prompt macros.
 *
 * @module infra/date-format
 */

/**
 * Formats a date as local `yyyy-MM-dd HH:mm:ss`.
 */
export function formatLocalDateTime(value: Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
