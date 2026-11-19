/**
 * 取消错误构造：全仓唯一权威定义处（自 `infra/llm-protocol/logic/request-abort.ts`
 * 上移，原文件保留 re-export 兼容）。只依赖全局 `DOMException` / `Error`，无分层问题。
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
