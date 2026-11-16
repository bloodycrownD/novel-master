/**
 * 桌面长任务取消作用域的 IPC 边界骨架（signal-abort-scope §五）。
 *
 * 统一形态：`createAbortScope({ controller, timeoutMs })` →（可选）登记进
 * `AbortRegistry` → `doWork(scope)` 返回 `Outcome<T>` → 边界按 `matchOutcome`
 * 三分派：`cancelled`/`replaced` 转 `throw createAbortError()`（再经
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
import { createAbortError, createAbortScope, type AbortRegistry, type AbortScope } from "@novel-master/core/abort";
import { AppError, matchOutcome, type Outcome } from "@novel-master/core/errors";
import { createLogger } from "@novel-master/core/log";
import type { IpcResult } from "../../../shared/ipc-types.js";
import { formatIpcError } from "./format-ipc-error.js";
import { ipcErr, ipcOk } from "./ipc-result.js";

const log = createLogger("desktop.ipc.run-scope");

/** `runAbortable` 的登记参数。 */
export interface AbortableRunOptions {
  /** 登记 key（`ABORT_KEY.*`）；null = 只建 scope + deadline、不注册（runId 缺省）。 */
  readonly key: string | null;
  /** 泛化取消注册表（`runtime.abortRegistry`）；key 为 null 时不触碰。 */
  readonly registry: AbortRegistry;
  /** 任务级 deadline；缺省不设（只提供手动取消）。 */
  readonly timeoutMs?: number;
  /** true 走 `tryRegister` 独占 claim（providerModels 并发冲突），缺省 `register` 覆盖语义。 */
  readonly exclusive?: boolean;
}

/** `runId`/`id` 缺省或空串时不登记（renderer 只在会展示取消按钮的任务上生成）。 */
export function runKey(factory: (id: string) => string, id: string | undefined): string | null {
  return id == null || id === "" ? null : factory(id);
}

/**
 * 检查点命中 → 中断 Outcome；未中断 → null。
 *
 * 判空必须宽松：`scope.checkpoint()` 返回 `Interrupt | null`，`!= null` 同时
 * 挡掉 null 与 undefined（后者不会出现，但宽松写法与 spec §四铁律一致）。
 */
export function outcomeIfAborted(scope: AbortScope): Outcome<never> | null {
  const hit = scope.checkpoint();
  if (hit == null) {
    return null;
  }
  return hit.kind === "cancelled" ? { kind: "cancelled", reason: hit.reason } : { kind: "replaced" };
}

/**
 * 建 scope →（可选）登记 → `doWork` → 边界三分派 → `finally` 反注册 + `dispose`。
 *
 * `exclusive` 的 claim 失败返回 `PROVIDER_MODELS_IN_FLIGHT`，且不改动既有登记
 * （`tryRegister` 判重与写入同同步段完成）。
 */
export async function runAbortable<T>(opts: AbortableRunOptions, doWork: (scope: AbortScope) => Promise<Outcome<T>>): Promise<IpcResult<T>> {
  const controller = new AbortController();
  const scope = createAbortScope({ controller, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
  const key = opts.key;
  if (key != null) {
    if (opts.exclusive === true) {
      if (!opts.registry.tryRegister(key, scope)) {
        scope.dispose();
        return ipcErr(formatIpcError(new AppError("PROVIDER_MODELS_IN_FLIGHT", { detail: key })));
      }
    } else {
      opts.registry.register(key, scope);
    }
  }
  try {
    const outcome = await doWork(scope);
    // 控制流在 handler 边界转异常：取消/替换 → AbortError、业务失败 → throw e。
    // 两者都交给统一错误出口 formatIpcError（取消映射 IPC_ABORTED）。
    return matchOutcome(outcome, {
      completed: (value) => ipcOk(value),
      cancelled: (reason) => {
        log.info("run aborted", { key, reason, phase: "handler" });
        throw createAbortError();
      },
      replaced: () => {
        log.info("run replaced", { key, phase: "handler" });
        throw createAbortError();
      },
      failed: (error) => {
        throw error;
      },
    });
  } catch (err) {
    // 取消 / 业务失败 / 未知异常（含补偿链里重抛的 DatabaseReplacedError）统一转码。
    return ipcErr(formatIpcError(err));
  } finally {
    if (key != null) {
      opts.registry.unregister(key, scope);
    }
    scope.dispose();
  }
}
