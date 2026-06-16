/**
 * Agent IPC handlers — run turn, resolve current, picker list/set.
 *
 * @module ipc/handlers/agent
 */
import { resolveApplicationModelId } from "@novel-master/core/agent";

import { formatApplicationModelId } from "@novel-master/core/provider";
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
  AgentRunError,
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
  resolveDesktopApplicationModelId,
  runAgentTurn,
} from "../../services/agent-run.service.js";
import {
  isDesktopAgentActive,
  setDesktopAgentActive,
} from "../../runtime/agent-activity.js";
import { desktopLogError } from "../../log/desktop-log.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof AgentRunError) {
    return { code: "AGENT_RUN_ERROR", message: err.message };
  }
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

async function resolveModelLabel(
  _rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  applicationModelId: string,
): Promise<string> {
  return applicationModelId;
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
    const applicationModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
    });
    let modelLabel = "未选择模型";
    if (applicationModelId) {
      modelLabel = await resolveModelLabel(rt, applicationModelId);
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
        const applicationModelId = formatApplicationModelId(
          provider.id,
          model.vendorModelId,
        );
        let label = applicationModelId;
        try {
          label = await resolveModelLabel(rt, applicationModelId);
        } catch {
          /* keep id */
        }
        rows.push({ applicationModelId, label });
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    return { ok: true, data: { rows, currentId } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleModelSetCurrent(
  req: ModelSetCurrentRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setCurrentModelId(req.applicationModelId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

const activeRuns = new Map<string, AbortController>();

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
    await resolveDesktopApplicationModelId(
      rt,
      (await resolveCurrentAgentDefinition(rt)).definition,
    );
    const controller = new AbortController();
    activeRuns.set(req.sessionId, controller);
    setDesktopAgentActive(true);

    void runAgentTurn(
      rt,
      { projectId: req.projectId, sessionId: req.sessionId },
      req.userContent,
      {
        stream: req.stream !== false,
        allowResumeWithoutInput: req.allowResumeWithoutInput,
        signal: controller.signal,
      },
    )
      .catch((err) => {
        desktopLogError("agent/run IPC background task failed", {
          sessionId: req.sessionId,
          projectId: req.projectId,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      })
      .finally(() => {
        activeRuns.delete(req.sessionId);
        setDesktopAgentActive(false);
      });

    return { ok: true, data: { started: true } };
  } catch (err) {
    setDesktopAgentActive(false);
    return { ok: false, error: formatError(err) };
  }
}

export function abortAgentRun(sessionId: string): void {
  activeRuns.get(sessionId)?.abort();
  activeRuns.delete(sessionId);
  setDesktopAgentActive(false);
}
