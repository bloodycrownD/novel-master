/**
 * Desktop renderer 对 `@novel-master/core/errors` 的具名薄再导出。
 * 禁止 `export *`；只出错误通道消费面（Result / AppError），不出码表与守卫。
 */

export { AppError, Result } from "@novel-master/core/errors";
