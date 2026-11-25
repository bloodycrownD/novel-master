/**
 * IpcResult 转码助手：`Result<T, AppError>` → `IpcResult<T>` 的边界统一出口。
 *
 * 错误通道迁移四期：IPC handler 内不再 `if (!r.ok) throw r.error` 解包——
 * 已知失败沿返回值到达，由本模块经 `FormatIpcError.format` 一次性转码成
 * `IpcErrorPayload`（转码矩阵「failed → formatIpcError / 未知 throw →
 * INFRA_UNEXPECTED_ERROR」两行的落地）。两种形态同名重载：值形态给自带
 * catch 的既有 handler 复用（未知异常仍由 handler 兜底）；thunk 形态
 * `IpcResults.from(() => work())` 把 handler 收敛成单行 return，work() 的
 * 未知异常也在此就地转码，不再经 handler catch。
 *
 * @module ipc/ipc-result
 */
import type { IpcErrorPayload, IpcResult } from "../../../shared/ipc-types.js";
import { type AppError } from "@novel-master/core/errors";
import { type Result } from "@novel-master/core/errors";
import { FormatIpcError } from "./format-ipc-error.js";

/**
 * 从 Result / Promise<Result> 整体抽出成功值类型。
 *
 * 不用 `from<T>(r: Result<T, AppError>)` 让 T 直接参与推断：thunk 多路返回
 * （err 短路 + 值路）产出 `Ok | Err` 类联合，T 在类联合里推断会塌成 never
 * （desktop 主进程 62 处 TS2769/TS2322 的根因，基点就有、一直被陈旧 dist 掩蔽）。
 * 改成先约束整个 R（unknown 放宽 E 的窄码形态），再条件抽取 T——联合自动分派，
 * 多路返回的 T 推断稳定。
 */
type ResultValueOf<R> = R extends PromiseLike<infer P>
    ? (P extends Result<infer T, AppError> ? T : never)
    : (R extends Result<infer T, AppError> ? T : never);

function from<R extends Result<unknown, AppError>>(r: R): IpcResult<ResultValueOf<R>>;
function from<R extends PromiseLike<Result<unknown, AppError>>>(work: () => R): Promise<IpcResult<ResultValueOf<R>>>;
function from(r: unknown): unknown {
    if (typeof r === "function") {
        return (r as () => PromiseLike<Result<unknown, AppError>>)().then(
            (x) => (x.ok ? IpcResults.ok(x.value) : IpcResults.err(FormatIpcError.format(x.error))),
            (err) => IpcResults.err(FormatIpcError.format(err)),
        );
    }
    if ((r as Result<unknown, AppError>).ok) {
        return IpcResults.ok((r as Result<unknown, AppError> & { ok: true }).value);
    }
    return IpcResults.err(FormatIpcError.format((r as Result<never, AppError> & { ok: false }).error));
}

export const IpcResults = {
    /** 成功侧包装（与既有 `{ ok: true, data }` 字面量同形）。 */
    ok<T>(data: T): IpcResult<T> {
        return { ok: true, data };
    },
    /** 失败侧包装：入参是已转码的 payload（`formatIpcError` 的产物）。 */
    err(error: IpcErrorPayload): IpcResult<never> {
        return { ok: false, error };
    },
    /** `Result`（E 为 AppError）一次性转码；成功值原样透传，不在此层做映射。 */
    from,
} as const;
