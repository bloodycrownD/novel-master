/**
 * Outcome / Interrupt：控制流结果类型（错误通道迁移总纲 §3.1/§3.2）。
 *
 * 与 {@link ./either.js!Result | Result} 的分工：Result 给纯计算（解析、校验、
 * 编译，不可能被中断）；Outcome 给「可能失败、也可能被中断」的操作（长循环、
 * service 方法、handler 的 doWork）。四分支平级——cancelled / replaced 是中断
 * 不是错误：不带错误码、不进 i18n、不计入错误率；AppError 只表达业务失败。
 * 禁止把 Interrupt 塞进 failed，也禁止把 AppError 塞进 cancelled。
 *
 * `AbortReason` 与 `Interrupt` 的**唯一权威定义处**：errors/ 是全仓最底层，
 * 不允许反向 import domain/abort（否则与 74 个 domain 文件的 errors/either
 * import 成环）；domain/abort 反向 re-export 从这里取，成员与语义以本模块为准。
 *
 * @module errors/outcome
 */

import type { AppError } from "./app-error.js";

/** 中断原因：user-stop 用户停止 / timeout 超时 / shutdown 退出 / parent 上级取消。 */
export type AbortReason = "user-stop" | "timeout" | "shutdown" | "parent";

/** 控制流中断：只表达流程被打断，不含成功、不含错误。 */
export type Interrupt =
    | { readonly kind: "cancelled"; readonly reason: AbortReason }
    | { readonly kind: "replaced" };

/** 一次操作的完整结果：成功 / 被中断 / 被替换 / 失败，四分支平级。 */
export type Outcome<T> =
    | { readonly kind: "completed"; readonly value: T }
    | { readonly kind: "cancelled"; readonly reason: AbortReason }
    | { readonly kind: "replaced" }
    | { readonly kind: "failed"; readonly error: AppError };

/**
 * Outcome 操作族（与类型 {@link Outcome} 同名双声明）。
 */
export const Outcome = {
    /** 成功时变换 value，中断/替换/失败原样透传（同一对象，不换壳）。 */
    map<T, U>(o: Outcome<T>, fn: (v: T) => U): Outcome<U> {
        return o.kind === "completed" ? { kind: "completed", value: fn(o.value) } : o;
    },

    /** 成功时接续下一个会返回 Outcome 的步骤（flatMap）；其余分支短路透传，fn 不被调用。 */
    andThen<T, U>(o: Outcome<T>, fn: (v: T) => Outcome<U>): Outcome<U> {
        return o.kind === "completed" ? fn(o.value) : o;
    },

    /** 四分支穷尽分发：每个分支都必须给值（边界分派与 UI 展示常用）。 */
    match<T, R>(o: Outcome<T>, on: { completed: (v: T) => R; cancelled: (r: AbortReason) => R; replaced: () => R; failed: (e: AppError) => R }): R {
        switch (o.kind) {
            case "completed": return on.completed(o.value);
            case "cancelled": return on.cancelled(o.reason);
            case "replaced": return on.replaced();
            case "failed": return on.failed(o.error);
        }
    },

    /** 从 Outcome 提取中断信号：cancelled / replaced 返回对应 Interrupt，completed / failed 返回 null。 */
    interruptOf(o: Outcome<unknown>): Interrupt | null {
        if (o.kind === "cancelled") return { kind: "cancelled", reason: o.reason };
        return o.kind === "replaced" ? { kind: "replaced" } : null;
    },
} as const;
