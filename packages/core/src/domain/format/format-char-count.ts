/**
 * 紧凑 locale 整数格式化（编辑器字数统计、指标条 token 数等共用单点）。
 *
 * 实现在 `common/number.ts` 的 `Number.charCount`；本别名保留给
 * `@novel-master/core/format` 子入口与既有调用点（mobile 编辑器字数统计）。
 */
import { Number } from "@/common/number.js";

export const formatCharCount = Number.charCount;
