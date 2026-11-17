/**
 * Local date/time formatting shared by worktree display and prompt macros.
 *
 * @module infra/date-format
 */

import { Number } from "@/common/number.js";

/**
 * Formats a date as local `yyyy-MM-dd HH:mm:ss`.
 */
export function formatLocalDateTime(value: Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${Number.pad2(d.getMonth() + 1)}-${Number.pad2(d.getDate())} ${Number.pad2(d.getHours())}:${Number.pad2(d.getMinutes())}:${Number.pad2(d.getSeconds())}`;
}
