/**
 * 取消域公开入口（signal-abort-scope spec §二）：只读视图 / 可驱动 scope /
 * 注册表 / key 工厂，以及 `AbortError.create` 的统一出口。
 *
 * `AbortReason` / `Interrupt` 走 `@novel-master/core/errors`；
 * `isAbortLikeError` 走 `@novel-master/core/llm-protocol`。
 *
 * @module public/abort
 */

export type { AbortScope, AbortSignalView, LongTaskHooks } from "../domain/abort/model/abort-scope.js";
export { ABORT_KEY } from "../domain/abort/model/abort-key.js";
export { AbortScopeFactory } from "../domain/abort/logic/create-abort-scope.js";
export { AbortError } from "../domain/abort/logic/create-abort-error.js";
export { AbortRegistryFactory } from "../domain/abort/logic/create-abort-registry.js";
export type { AbortRegistry } from "../domain/abort/ports/abort-registry.port.js";
