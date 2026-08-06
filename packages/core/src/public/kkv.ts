/**
 * 模块级键值存储（KKV）的公开入口。
 *
 * 应用运行时通过 `@novel-master/core/kkv` 这个子路径消费本 barrel，
 * 主要用于 AppUiPreferences 的接线。业务代码如果可以，
 * 优先使用 `PersistentState` / `PersistentPreferences` 这类端口。
 *
 * @module public/kkv
 */

export { createKkvService } from "../service/kkv/create-kkv-service.js";
export type { KkvService } from "../service/kkv/kkv.port.js";
export { KkvError, isKkvError } from "../errors/kkv-errors.js";
export type { KkvErrorCode } from "../errors/kkv-errors.js";