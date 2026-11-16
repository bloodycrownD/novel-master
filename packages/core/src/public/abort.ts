/**
 * 取消域公开入口（signal-abort-scope spec §二）：只读视图 / 可驱动 scope /
 * 注册表 / key 工厂，以及 `createAbortError` / `isAbortLikeError` 的统一出口。
 *
 * `AbortReason` / `Interrupt` 的权威定义处仍是 `errors/outcome.ts`，这里只转发。
 *
 * @module public/abort
 */

export type { AbortReason, Interrupt } from "../errors/outcome.js";
export type { AbortScope, AbortSignalView, LongTaskHooks } from "../domain/abort/model/abort-scope.js";
export { ABORT_KEY } from "../domain/abort/model/abort-key.js";
export { createAbortScope, scopeFromController, signalView } from "../domain/abort/logic/create-abort-scope.js";
export { createAbortError } from "../domain/abort/logic/create-abort-error.js";
export { createAbortRegistry } from "../domain/abort/logic/create-abort-registry.js";
export type { AbortRegistry } from "../domain/abort/ports/abort-registry.port.js";
export { isAbortLikeError } from "../infra/llm-protocol/logic/request-abort.js";
