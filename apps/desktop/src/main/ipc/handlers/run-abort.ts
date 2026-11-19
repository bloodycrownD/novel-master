/**
 * 统一取消入口 IPC（signal-abort-scope §五）：`nm:run/abort` 与 `nm:agent/abort`
 * 转发别名。
 *
 * `kind` 选择取消目标类别，`id` 由 renderer 在发起任务时生成并持有：
 * backup / dbmaint / stats 用 runId（uuid）、models 用 providerId、sync 固定
 * `"local"`、compaction 用 sessionId。id 缺省/空串或 key 不存在时**静默 ok**
 * （与既有 `nm:agent/abort` 的 no-op 语义一致）；未知 kind 回
 * `IPC_INVALID_ABORT_TARGET`。
 *
 * @module ipc/handlers/run-abort
 */
import { ABORT_KEY } from "@novel-master/core/abort";
import { AppError } from "@novel-master/core/errors";
import { LogFactory } from "@novel-master/core/log";
import type { AgentAbortRequest, IpcResult, RunAbortRequest, RunAbortResponse } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";
import { ipcErr, ipcOk } from "../ipc-result.js";

const log = LogFactory.create("desktop.ipc.run-abort");

/** kind → `ABORT_KEY` 工厂；键集合与 shared `RunAbortRequest.kind` 一一对应。 */
const ABORT_KEY_BY_KIND = {
  backup: ABORT_KEY.backup,
  dbmaint: ABORT_KEY.dbMaintenance,
  stats: ABORT_KEY.usageStats,
  models: ABORT_KEY.providerModels,
  sync: ABORT_KEY.cloudSync,
  compaction: ABORT_KEY.compaction,
} as const;

type RunAbortKind = keyof typeof ABORT_KEY_BY_KIND;

/**
 * 按完整 key 取消；key 未注册、或 runtime 尚未就位时静默 no-op。
 *
 * 与 `handleAgentAbort`（agent.ts，原 abortAgentRun）同口径：runtime 未就绪时
 * 无在途任务可中断，留痕后返回，不让取消按钮把错误弹给用户。
 */
async function abortRegisteredKey(key: string): Promise<void> {
  const built = await getDesktopRuntime();
  if (!built.ok) {
    log.warn("abort before runtime ready", { key, error: built.error });
    return;
  }
  built.value.abortRegistry.abort(key);
}

/** `nm:run/abort`：`{ kind, id }` → `abort(ABORT_KEY[kind](id))`。 */
export async function handleRunAbort(req: RunAbortRequest | undefined): Promise<RunAbortResponse> {
  const kind: unknown = req?.kind;
  // 渲染进程可能传来任意字符串：`Object.hasOwn` 做运行时收窄（不信任 DTO 联合）。
  const keyOfKind = typeof kind === "string" && Object.hasOwn(ABORT_KEY_BY_KIND, kind) ? ABORT_KEY_BY_KIND[kind as RunAbortKind] : null;
  if (keyOfKind == null) {
    return ipcErr(formatIpcError(new AppError("IPC_INVALID_ABORT_TARGET", { detail: `unknown kind: ${String(kind)}` })));
  }
  const id = req?.id;
  if (id == null || id === "") {
    return ipcOk(null);
  }
  await abortRegisteredKey(keyOfKind(id));
  return ipcOk(null);
}

/** `nm:agent/abort` 转发别名：等价于 `abort(ABORT_KEY.agent(sessionId))`。 */
export async function handleAgentAbortAlias(req: AgentAbortRequest): Promise<IpcResult<void>> {
  await abortRegisteredKey(ABORT_KEY.agent(req.sessionId));
  return ipcOk(undefined);
}
