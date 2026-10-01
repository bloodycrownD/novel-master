/**
 * 把任意抛出的值取成一句可读的告警/失败原因文案。
 *
 * @remarks 告警/失败原因文案的统一取法。此前散落三份逐字相同的私有副本
 *   （zlib-accelerator 的回落告警、blob-binary-normalization 与
 *   vfs-content-packing 的坏组/坏 pack 摘要），改动文案时容易漏改其中一份。
 *   口径固定为「Error 取 message，其余一律 String 化」——告警链路要求绝不抛错，
 *   所以对任何输入都要有确定返回值。
 *
 * @module common/error-text
 */

/**
 * 取错误文案：`Error` 取其 `message`，其余（含 `null`、字符串、对象）一律
 * `String()` 化。
 *
 * @param error 任意抛出的值
 * @returns 可直接拼进告警/失败原因的文本（不抛错、不返回空串）
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}