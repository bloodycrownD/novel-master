/**
 * 桌面长任务取消作用域的 IPC 边界骨架（signal-abort-scope §五）。
 *
 * 统一形态：`AbortScopeFactory.create({ controller, timeoutMs })` →（可选）登记进
 * `AbortRegistry` → `doWork(scope)` 返回 `Outcome<T>` → 边界按 `Outcome.match`
 * 三分派：`cancelled`/`replaced` 转 `throw AbortError.create()`（再经
 * `formatIpcError` 映射 `IPC_ABORTED`）、`failed` 转 `throw e`、`completed` 正常
 * 返回；`finally` 反注册 + `dispose`。
 *
 * 两条硬约束：
 * - **禁止**在本层套 `scope.race()` 早 settle：备份导入 / 云同步 pull 这类多资源
 *   补偿链必须与底层流程同生命周期，`finally` 先跑会让 rebootstrap / 临时文件
 *   清理的时序错乱（spec §五策略表）。
 * - 取消是控制流信号不是业务错误：`doWork` 用 `Outcome`，`Result` 只装业务失败。
 *
 * @module ipc/run-scope
 */
import { AbortError, AbortScopeFactory, type AbortRegistry, type AbortScope } from "@novel-master/core/abort";
import { AppError, Outcome } from "@novel-master/core/errors";
import { LogFactory } from "@novel-master/core/log";
import type { IpcResult } from "../../../shared/ipc-types.js";
import { FormatIpcError } from "./format-ipc-error.js";
import { IpcResults } from "./ipc-result.js";

const log = LogFactory.create("desktop.ipc.run-scope");

/** `RunScope.abortable` 的登记参数。 */
export interface AbortableRunOptions {
    /** 登记 key（`ABORT_KEY.*`）；null = 只建 scope + deadline、不注册（runId 缺省）。 */
    readonly key: string | null;
    /** 泛化取消注册表（`runtime.abortRegistry`）；key 为 null 时不触碰。 */
    readonly registry: AbortRegistry;
    /** 任务级 deadline；缺省不设（只提供手动取消）。 */
    readonly timeoutMs?: number;
    /** true 走 `tryRegister` 独占 claim（providerModels 并发冲突），缺省 `register` 覆盖语义。 */
    readonly exclusive?: boolean;
    /**
   * `exclusive` claim 失败时返回的业务错误；缺省 `PROVIDER_MODELS_IN_FLIGHT`。
   *
   * 固定 key 的任务（cloud-sync 的 `sync:local`、compaction 的 sessionId）必须走
   * exclusive：覆盖式 register 会让在途任务从 registry 消失，`nm:run/abort`
   * 变成静默 no-op（随后第二请求的 finally 还会删掉该 key）。
   */
    readonly conflictError?: AppError;
}

export const RunScope = {
    /** `runId`/`id` 缺省或空串时不登记（renderer 只在会展示取消按钮的任务上生成）。 */
    key(factory: (id: string) => string, id: string | undefined): string | null {
        return id == null || id === "" ? null : factory(id);
    },

    /**
   * 检查点命中 → 中断 Outcome；未中断 → null。
   *
   * 判空必须宽松：`scope.checkpoint()` 返回 `Interrupt | null`，`!= null` 同时
   * 挡掉 null 与 undefined（后者不会出现，但宽松写法与 spec §四铁律一致）。
   */
    outcomeIfAborted(scope: AbortScope): Outcome<never> | null {
        const hit = scope.checkpoint();
        if (hit == null) {
            return null;
        }
        return hit.kind === "cancelled" ? { kind: "cancelled", reason: hit.reason } : { kind: "replaced" };
    },

    /**
   * 建 scope →（可选）登记 → `doWork` → 边界三分派 → `finally` 反注册 + `dispose`。
   *
   * `exclusive` 的 claim 失败返回 `conflictError`（缺省 `PROVIDER_MODELS_IN_FLIGHT`），
   * 且不改动既有登记（`tryRegister` 判重与写入同同步段完成）。
   */
    async abortable<T>(opts: AbortableRunOptions, doWork: (scope: AbortScope) => Promise<Outcome<T>>): Promise<IpcResult<T>> {
        const controller = new AbortController();
        const scope = AbortScopeFactory.create({ controller, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
        const key = opts.key;
        if (key != null) {
            if (opts.exclusive === true) {
                if (!opts.registry.tryRegister(key, scope)) {
                    scope.dispose();
                    return IpcResults.err(FormatIpcError.format(opts.conflictError ?? new AppError("PROVIDER_MODELS_IN_FLIGHT", { detail: key })));
                }
            } else {
                opts.registry.register(key, scope);
            }
        }
        try {
            const outcome = await doWork(scope);
            // 控制流在 handler 边界转异常：取消/替换 → AbortError、业务失败 → throw e。
            // 两者都交给统一错误出口 formatIpcError（取消映射 IPC_ABORTED）。
            return Outcome.match(outcome, {
                completed: (value) => IpcResults.ok(value),
                cancelled: (reason) => {
                    log.info("run aborted", { key, reason, phase: "handler" });
                    throw AbortError.create(); // nm-throw: keep — 平台强制（P4 IPC 取消协议）：可中止 handler 统一边界转码，formatIpcError 映射 IPC_ABORTED
                },
                replaced: () => {
                    log.info("run replaced", { key, phase: "handler" });
                    throw AbortError.create(); // nm-throw: keep — 平台强制（P4 IPC 取消协议）：同上，replaced 亦映射 IPC_ABORTED
                },
                failed: (error) => {
                    // nm-throw: keep — IPC handler 边界统一错误出口（signal-abort-scope §五三分派）：failed 的业务失败在此转 throw，由同函数 catch 收进 formatIpcError 转码，与上方 cancelled/replaced 分支同款
                    throw error;
                },
            });
        } catch (err) {
            // 取消 / 业务失败 / 未知异常统一转码（error-matrix-final：控制流哨兵已退役）。
            return IpcResults.err(FormatIpcError.format(err));
        } finally {
            if (key != null) {
                opts.registry.unregister(key, scope);
            }
            scope.dispose();
        }
    },
} as const;
