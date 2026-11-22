/**
 * 取消域核心契约：只读视图、可驱动作用域与长任务钩子。
 *
 * `AbortReason` / `Interrupt` 的**唯一定义处是 `errors/outcome.ts`**，本模块只
 * re-export：`errors/` 是全仓最底层，若把联合定义在这里，`errors/outcome.ts`
 * 就得反向 import domain，会和 domain 里大量 `errors/either` 依赖成环。
 *
 * @module domain/abort/model/abort-scope
 */

import type { AbortReason, Interrupt } from "@/errors/outcome.js";

export type { AbortReason, Interrupt } from "@/errors/outcome.js";

/** 只读能力集：工具域与裸 `AbortSignal` 适配用，不能发起取消。 */
export interface AbortSignalView {
    readonly signal: AbortSignal;
    /** 裸 signal 造出的视图恒为 null（无从得知原因）。 */
    readonly reason: AbortReason | null;
    /** 已中断返回 `Interrupt`，否则 null；不 throw、不占 Result 通道。 */
    checkpoint(): Interrupt | null;
    /** 先 `checkpoint()`；未中断则让出事件循环后返回 null。 */
    yieldToUi(): Promise<Interrupt | null>;
    /** 平台协议例外：Promise 只能 reject；settle 后摘监听。 */
    race<T>(work: Promise<T>, rejectWith?: () => unknown): Promise<T>;
    /** 清理钩子；已中断则立即同步执行并返回 noop。 */
    onCancel(fn: (reason: AbortReason) => void): () => void;
}

/** 可驱动能力集：run / service / handler 入口用。 */
export interface AbortScope extends AbortSignalView {
    /** 绝对超时时刻（毫秒时间戳）；没有 deadline 时为 null。 */
    readonly deadlineAt: number | null;
    /** 默认 `"user-stop"`；幂等，首个 reason 生效。 */
    abort(reason?: AbortReason): void;
    fork(opts?: { timeoutMs?: number }): AbortScope;
    /** 幂等；正常完成调用，不触发自身 onCancel。 */
    dispose(): void;
}

/** 同步长循环的可选注入钩子（domain 纯函数不接 `AbortScope`）。 */
export interface LongTaskHooks {
    /** 同步检查；非 null 时按调用方既有返回契约中止。 */
    readonly checkpoint?: () => Interrupt | null;
    /** 异步让路点（`yieldToUi` 需包一层 `() => { void scope.yieldToUi(); }`）。 */
    readonly onProgress?: () => void | Promise<unknown>;
}
