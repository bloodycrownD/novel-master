/**
 * 取消错误构造：全仓唯一权威定义处（自 `infra/llm-protocol/logic/request-abort.ts`
 * 上移，原文件保留 re-export 兼容）。只依赖全局 `DOMException` / `Error`，无分层问题。
 *
 * 定位（p29 裁决）：`AbortError` 是**平台线格式，不是错误通道，也不是控制流通道**。
 * - 不是 AppError：全仓 catch 方零个把它当业务失败消费——全部转回控制流
 *   （事务出口转 Outcome.cancelled / tool-runner 放行 / IPC 映射 IPC_ABORTED）；
 * - 不是 Outcome 的替代：有返回值通道的地方取消早已走 Outcome/Interrupt（checkpoint
 *   → Interrupt | null，长循环 → Outcome.cancelled）；AbortError 只出现在**平台拿走
 *   返回值通道**的位置（better-sqlite3 事务回调 void、Promise executor/race reject、
 *   DocumentIo.write 平台回调）——它是取消事实在这些位置上的运输格式，语义在
 *   通道两端表达（throw 点翻译自 Outcome 检查、catch 点立即转回控制流）。
 *
 * @module domain/abort/logic/create-abort-error
 */

export const AbortError = {
    /** Creates an abort error in Node (DOMException) or RN (Error + name). */
    create(message = "Request aborted"): Error {
        const DOMEx = (globalThis as { DOMException?: new (msg: string, name: string) => Error }).DOMException;
        if (typeof DOMEx === "function") {
            return new DOMEx(message, "AbortError");
        }
        const err = new Error(message);
        err.name = "AbortError";
        return err;
    },
} as const;
