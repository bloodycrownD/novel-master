/**
 * IpcResult 转码助手：`Result<T, AppError>` → `IpcResult<T>` 的边界统一出口。
 *
 * 错误通道迁移四期：IPC handler 内不再 `if (!r.ok) throw r.error` 解包——
 * 已知失败沿返回值到达，由本模块经 `formatIpcError` 一次性转码成
 * `IpcErrorPayload`；未知异常仍由各 handler 既有 catch 兜底（转码矩阵
 * 「failed → formatIpcError / 未知 throw → INFRA_UNEXPECTED_ERROR」两行的落地）。
 *
 * @module ipc/ipc-result
 */
import type { IpcErrorPayload, IpcResult } from "../../../shared/ipc-types.js";
import { type AppError } from "@novel-master/core/agent";
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
export function toIpcResult<T>(r: Result<T, AppError>): IpcResult<T> {
  return r.ok ? ipcOk(r.value) : ipcErr(formatIpcError(r.error));
}
