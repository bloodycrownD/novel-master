/**
 * IpcResult 转码助手：`Result<T, AppError>` → `IpcResult<T>` 的边界统一出口。
 *
 * 错误通道迁移四期：IPC handler 内不再 `if (!r.ok) throw r.error` 解包——
 * 已知失败沿返回值到达，由本模块经 `formatIpcError` 一次性转码成
 * `IpcErrorPayload`（转码矩阵「failed → formatIpcError / 未知 throw →
 * INFRA_UNEXPECTED_ERROR」两行的落地）。两种形态同名重载：值形态给自带
 * catch 的既有 handler 复用（未知异常仍由 handler 兜底）；thunk 形态
 * `toIpcResult(() => work())` 把 handler 收敛成单行 return，work() 的
 * 未知异常也在此就地转码，不再经 handler catch。
 *
 * @module ipc/ipc-result
 */
import type { IpcErrorPayload, IpcResult } from "../../../shared/ipc-types.js";
import { type AppError } from "@novel-master/core/errors";
import { type Result } from "@novel-master/core/errors";
import { formatIpcError } from "./format-ipc-error.js";

/** 成功侧包装（与既有 `{ ok: true, data }` 字面量同形）。 */
export function ipcOk<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

/** 失败侧包装：入参是已转码的 payload（`formatIpcError` 的产物）。 */
export function ipcErr(error: IpcErrorPayload): IpcResult<never> {
  return { ok: false, error };
}

/** `Result`（E 为 AppError）一次性转码；成功值原样透传，不在此层做映射。 */
export function toIpcResult<T>(r: Result<T, AppError>): IpcResult<T>;
/** thunk 形态：已知失败沿 Result 返回、未知异常就地转码，handler 不再自写 try/catch。 */
export function toIpcResult<T>(work: () => Promise<Result<T, AppError>>): Promise<IpcResult<T>>;
export function toIpcResult<T>(r: Result<T, AppError> | (() => Promise<Result<T, AppError>>)): IpcResult<T> | Promise<IpcResult<T>> {
  return typeof r === "function"
    ? r().then(
        (x) => (x.ok ? ipcOk(x.value) : ipcErr(formatIpcError(x.error))),
        (err) => ipcErr(formatIpcError(err)),
      )
    : r.ok ? ipcOk(r.value) : ipcErr(formatIpcError(r.error));
}
