/**
 * Local date/time formatting shared by worktree display and prompt macros.
 *
 * @module infra/date-format
 */

import { pad2 } from "@/common/format-number.js";

/**
 * Formats a date as local `yyyy-MM-dd HH:mm:ss`.
 */
export function formatLocalDateTime(value: Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
