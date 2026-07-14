/**
 * Agent IPC handlers — run turn, resolve current, picker list/set.
 *
 * @module ipc/handlers/agent
 */
import { resolveApplicationModelId } from "@novel-master/core/agent";

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

async function resolveModelLabel(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  savedModelId: string,
): Promise<string> {
  const saved = await rt.providerModels.getSavedById(savedModelId);
  if (saved == null) {
    return savedModelId;
  }
  return savedModelDisplayName(saved);
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
    const workspaceModelId = (await rt.state.getCurrentModelId()) ?? "";
    const savedModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
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
        let label = savedModelDisplayName(model);
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

type RunEntry = { controller: AbortController; runId: string | null };

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
  abortAgentRun(req.sessionId);
  return { ok: true, data: undefined };
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
    );
    const controller = new AbortController();
    const { sessionId } = req;
    activeRuns.set(sessionId, { controller, runId: null });
    incrementDesktopAgentActive();

    void runAgentTurn(
      rt,
      { projectId: req.projectId, sessionId },
      req.userContent,
      {
        stream: req.stream !== false,
        allowResumeWithoutInput: req.allowResumeWithoutInput,
        attachments: req.attachments,
        signal: controller.signal,
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
        const entry = activeRuns.get(sessionId);
        if (entry?.controller !== controller) {
          return;
        }
        if (entry.runId != null) {
          // 正常路径由 RUN_FINISHED/FAILED 递减；此处仅兜底 controller 结束但事件未达
          if (sessionRunIds.get(sessionId) === entry.runId) {
            activeRuns.delete(sessionId);
            sessionRunIds.delete(sessionId);
            decrementDesktopAgentActive();
          }
          return;
        }
        // 无 RUN_STARTED 的早退（T23）
        activeRuns.delete(sessionId);
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

/** 仅 abort；decrement 交给 RUN_FINISHED/FAILED 或 finally 兜底。 */
export function abortAgentRun(sessionId: string): void {
  activeRuns.get(sessionId)?.controller.abort();
  activeRuns.delete(sessionId);
}
