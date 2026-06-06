/**
 * Prompt IPC handlers — real prompt preview segments, chat token label, agent meta.
 */
import { resolveApplicationModelId } from "@novel-master/core";
import type {
  IpcResult,
  PromptAgentMetaResponse,
  PromptPreviewSegmentDto,
  PromptScopeRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
} from "../../services/agent-run.service.js";
import { loadChatPromptTokenLabelResilient } from "../../services/chat-prompt-tokens.service.js";
import { buildRealPromptPreviewSegments } from "../../services/prompt-preview.service.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

export async function handlePromptRealPreview(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptPreviewSegmentDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const segments = await buildRealPromptPreviewSegments(rt, req);
    return {
      ok: true,
      data: segments.map((s) => ({
        id: s.id,
        role: s.role,
        title: s.title,
        body: s.body,
      })),
    };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handlePromptChatTokenLabel(
  req: PromptScopeRequest,
): Promise<IpcResult<string>> {
  try {
    const rt = await getDesktopRuntime();
    const label = await loadChatPromptTokenLabelResilient(rt, req);
    return { ok: true, data: label };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handlePromptAgentMeta(): Promise<
  IpcResult<PromptAgentMetaResponse>
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
    const workspaceModelId = (await rt.state.getCurrentModelId()) ?? "";
    const applicationModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
    });
    let modelLabel = "未选择模型";
    if (applicationModelId) {
      modelLabel = applicationModelId;
    }
    return {
      ok: true,
      data: {
        agentId,
        agentName: definition.name,
        modelLabel,
        hasDedicatedModel:
          definition.model != null && definition.model !== "",
      },
    };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
