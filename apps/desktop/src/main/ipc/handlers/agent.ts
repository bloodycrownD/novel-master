/**
 * Agent IPC handlers — run turn, resolve current, picker list/set.
 *
 * @module ipc/handlers/agent
 */
import { resolveSavedModelId } from "@novel-master/core/agent";

import {
  assertSavedModelUuid,
  savedModelDisplayName,
} from "@novel-master/core/provider";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  type AgentRunFailedPayload,
  type AgentRunFinishedPayload,
  type AgentRunStartedPayload,
  type SimpleEventBus,
} from "@novel-master/core/events";
import type {
  AgentAbortRequest,
  AgentListPickerResponse,
  AgentResolveCurrentResponse,
  AgentRunIsActiveRequest,
  AgentRunRequest,
  AgentSetCurrentRequest,
  IpcResult,
  ModelListPickerResponse,
  ModelSetCurrentRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
  resolveDesktopSavedModelId,
  runAgentTurn,
} from "../../services/agent-run.service.js";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
  isDesktopAgentActive,
} from "../../runtime/agent-activity.js";
import { desktopLogError } from "../../log/desktop-log.js";
import { formatIpcError } from "../format-ipc-error.js";
import { notifyUserMessageAppendedToRenderer } from "../forward-user-message-appended.js";

async function resolveModelLabel(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  savedModelId: string,
): Promise<string> {
  const saved = await rt.providerModels.getSavedById(savedModelId);
  if (saved == null) {
    return savedModelId;
  }
  const provider = await rt.providers.get(saved.providerId);
  return savedModelDisplayName(saved, provider.displayName);
}

export async function handleAgentResolveCurrent(): Promise<
  IpcResult<AgentResolveCurrentResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const agentId = await resolveCurrentAgentId(rt);
    if (agentId == null) {
      return {
        ok: true,
        data: {
          agentId: undefined,
          agentName: "未配置 Agent",
          modelLabel: "—",
          hasDedicatedModel: false,
        },
      };
    }
    const { definition } = await resolveCurrentAgentDefinition(rt);
    const hasDedicatedModel =
      definition.model != null && definition.model !== "";
    // workspace 层已移除：workspace 级 agent 显示只取 agent pin，不再回退 workspace 模型。
    const savedModelId = resolveSavedModelId({
      agentModelId: definition.model,
    });
    let modelLabel = "未选择模型";
    if (savedModelId) {
      modelLabel = await resolveModelLabel(rt, savedModelId);
    }
    return {
      ok: true,
      data: {
        agentId,
        agentName: definition.name,
        modelLabel,
        hasDedicatedModel,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentListPicker(): Promise<
  IpcResult<AgentListPickerResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const currentId = (await rt.state.getCurrentAgentId()) ?? undefined;
    const ids = await rt.agentRegistry.listAgentIds();
    const rows = [];
    for (const agentId of ids) {
      let label = agentId;
      try {
        const def = await rt.agentRegistry.get(agentId);
        if (def.mode === "subagent") continue;
        label = def.name?.trim() || agentId;
      } catch {
        /* keep id */
      }
      rows.push({ agentId, label });
    }
    return { ok: true, data: { rows, currentId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentSetCurrent(
  req: AgentSetCurrentRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setCurrentAgentId(req.agentId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleModelListPicker(): Promise<
  IpcResult<ModelListPickerResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const currentId = (await rt.state.getCurrentModelId()) ?? undefined;
    const providers = await rt.providers.list();
    const rows = [];
    for (const provider of providers) {
      const saved = await rt.providerModels.savedList(provider.id);
      for (const model of saved) {
        const savedModelId = model.id;
        let label = savedModelDisplayName(model, provider.displayName);
        try {
          label = await resolveModelLabel(rt, savedModelId);
        } catch {
          /* keep derived label */
        }
        rows.push({ savedModelId, label });
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    return { ok: true, data: { rows, currentId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleModelSetCurrent(
  req: ModelSetCurrentRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await assertSavedModelUuid(
      req.savedModelId,
      rt.savedModelRepo,
    );
    await rt.state.setCurrentModelId(saved.id);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

type RunEntry = { runId: string | null };

const activeRuns = new Map<string, RunEntry>();
/** abort 删除 activeRuns 后仍用于 FINISHED/FAILED 与 runId 匹配。 */
const sessionRunIds = new Map<string, string>();

let lifecycleSubscriptions: Array<{ unsubscribe: () => void }> = [];

/**
 * RUN_STARTED 时登记 runId（main 进程 eventBus 订阅，非 renderer 侧）。
 */
export function onCoreRunStarted({
  sessionId,
  runId,
}: AgentRunStartedPayload): void {
  const entry = activeRuns.get(sessionId);
  if (entry != null) {
    entry.runId = runId;
  }
  sessionRunIds.set(sessionId, runId);
}

function finishTrackedRun(sessionId: string, runId: string): void {
  const entry = activeRuns.get(sessionId);
  const trackedRunId = entry?.runId ?? sessionRunIds.get(sessionId);
  if (trackedRunId !== runId) {
    return;
  }
  activeRuns.delete(sessionId);
  sessionRunIds.delete(sessionId);
  decrementDesktopAgentActive();
}

/** RUN_FINISHED 时清理 run 登记。 */
export function onCoreRunFinished({
  sessionId,
  runId,
}: AgentRunFinishedPayload): void {
  finishTrackedRun(sessionId, runId);
}

/** RUN_FAILED 时清理 run 登记。 */
export function onCoreRunFailed({
  sessionId,
  runId,
}: AgentRunFailedPayload): void {
  finishTrackedRun(sessionId, runId);
}

function detachAgentRunLifecycleListeners(): void {
  for (const sub of lifecycleSubscriptions) {
    sub.unsubscribe();
  }
  lifecycleSubscriptions = [];
}

/**
 * 订阅 core run 生命周期事件，与 handleAgentRun 同模块维护 activeRuns / agentActive。
 * 返回 cleanup 供 rebootstrap / quit。
 */
export function attachAgentRunLifecycleListeners(
  eventBus: SimpleEventBus,
): () => void {
  detachAgentRunLifecycleListeners();

  lifecycleSubscriptions = [
    eventBus.subscribe(EVENT_AGENT_RUN_STARTED, onCoreRunStarted),
    eventBus.subscribe(EVENT_AGENT_RUN_FINISHED, onCoreRunFinished),
    eventBus.subscribe(EVENT_AGENT_RUN_FAILED, (payload: unknown) => {
      onCoreRunFailed(payload as AgentRunFailedPayload);
    }),
  ];

  return detachAgentRunLifecycleListeners;
}

export async function handleAgentAbort(
  req: AgentAbortRequest,
): Promise<IpcResult<void>> {
  await abortAgentRun(req.sessionId);
  return { ok: true, data: undefined };
}

/**
 * 查询某 session 是否有 in-flight run——转调 rt.abortRegistry.has(sessionId)。
 * renderer 的 readOnly 子面板用它判断 stale，避免在 run 进行中渲染可交互 UI。
 */
export async function handleAgentRunIsActive(
  req: AgentRunIsActiveRequest,
): Promise<IpcResult<boolean>> {
  const rt = await getDesktopRuntime();
  return { ok: true, data: rt.abortRegistry.has(req.sessionId) };
}

export async function handleAgentRun(
  req: AgentRunRequest,
): Promise<IpcResult<{ started: boolean }>> {
  if (isDesktopAgentActive()) {
    return { ok: false, error: { code: "AGENT_BUSY", message: "Agent 正在运行" } };
  }

  try {
    const rt = await getDesktopRuntime();
    await resolveDesktopSavedModelId(
      rt,
      (await resolveCurrentAgentDefinition(rt)).definition,
      req.sessionId,
    );
    const { sessionId } = req;
    // Phase 3 Step 24：不再自建 AbortController / 不再传 signal。
    // core runAgentTurn 内部自建 internalController 注册到 rt.abortRegistry，
    // 停止按钮经 ipcAgentAbort → rt.abortRegistry.abort(sessionId) 中断。
    // activeRuns 退化为 refcount 影子——只跟 RUN_STARTED/FINISHED/FAILED 与
    // runId 比对 + finishTrackedRun 的 decrementDesktopAgentActive()。
    activeRuns.set(sessionId, { runId: null });
    incrementDesktopAgentActive();

    void runAgentTurn(
      rt,
      { projectId: req.projectId, sessionId },
      req.userContent,
      {
        stream: req.stream !== false,
        allowResumeWithoutInput: req.allowResumeWithoutInput,
        attachments: req.attachments,
        annotateDrafts: req.annotateDrafts,
        onUserMessageAppended: () => {
          notifyUserMessageAppendedToRenderer({ sessionId });
        },
      },
    )
      .catch((err) => {
        desktopLogError("agent/run IPC background task failed", {
          sessionId,
          projectId: req.projectId,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      })
      .finally(() => {
        // Phase 3 Step 24(d)：refcount 单一归属——只由 finishTrackedRun 递减。
        // 这里仅做房子——清掉没收到 RUN_STARTED 的早退 entry，避免 activeRuns 泄漏。
        // core 侧正常路径会发 RUN_FINISHED/RUN_FAILED → finishTrackedRun 已完成递减；
        // 若事件途中丢失（极罕见）且 entry 仍在，这里作为最后的 map 清理兑底。
        const entry = activeRuns.get(sessionId);
        if (entry == null) {
          return;
        }
        if (entry.runId != null) {
          // 正常路径：RUN_STARTED 已达，FINISHED/FAILED 的 finishTrackedRun 负责清理。
          return;
        }
        // 无 RUN_STARTED 的早退（T23）：finishTrackedRun 不会触发，手动清 map。
        // C-orch-1：早退分支必须同步递减 refcount，否则 incrementDesktopAgentActive()
        // 的增量永不回落，isDesktopAgentActive() 永久 true，后续 run 全部 AGENT_BUSY。
        // 不会双递减：正常路径 runId != null 已提前 return，递减归 finishTrackedRun。
        activeRuns.delete(sessionId);
        sessionRunIds.delete(sessionId);
        decrementDesktopAgentActive();
      });

    return { ok: true, data: { started: true } };
  } catch (err) {
    activeRuns.delete(req.sessionId);
    sessionRunIds.delete(req.sessionId);
    decrementDesktopAgentActive();
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 中断指定 sessionId 的当前 run——Phase 3 Step 24(a)。
 *
 * 改调 core registry（rt.abortRegistry.abort），不再依赖 activeRuns 里的
 * controller。refcount 递减交给 RUN_FINISHED/FAILED 的 finishTrackedRun。
 */
export async function abortAgentRun(sessionId: string): Promise<void> {
  const rt = await getDesktopRuntime();
  rt.abortRegistry.abort(sessionId);
  // activeRuns 的清理交给 finally / finishTrackedRun；这里只负责中断信号。
}

/**
 * 测试专用内省：暴露 run 追踪 map 的当前大小，用于断言早退兜底无泄漏。
 * 仅在单测中引用，生产代码不应依赖。
 */
export function __testRunTrackingState(): {
  activeRunsCount: number;
  sessionRunIdsCount: number;
} {
  return {
    activeRunsCount: activeRuns.size,
    sessionRunIdsCount: sessionRunIds.size,
  };
}
