/**
 * Local date/time formatting shared by worktree display and prompt macros.
 *
 * 实现在 `common/datetime.ts` 的 `DateTime.localDateTime`；本别名保留给
 * `@novel-master/core/provider` 子入口与既有调用点（workplace 展示 / prompt 宏）。
 *
 * @module infra/date-format
 */

import { DateTime } from "@/common/datetime.js";

/** Formats a date as local `yyyy-MM-dd HH:mm:ss`. */
export const formatLocalDateTime = DateTime.localDateTime;
