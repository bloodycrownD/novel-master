/**
 * Prompt IPC handlers — real prompt preview segments, chat token label, agent meta.
 */
import {
  AgentRunResolveError,
  resolveAgentForProject,
  resolveApplicationModelId,
} from "@novel-master/core/agent";
import { savedModelDisplayName } from "@novel-master/core/provider";
import { PROJECT_AGENT_META_DISPLAY_LABEL } from "@novel-master/core/chat";
import type {
  IpcResult,
  PromptAgentMetaResponse,
  PromptChatTokenStatsResponse,
  PromptPreviewSegmentDto,
  PromptScopeRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { loadChatPromptTokenStatsResilient } from "../../services/chat-prompt-tokens.service.js";
import { buildRealPromptPreviewSegments } from "../../services/prompt-preview.service.js";
import { formatIpcError } from "../format-ipc-error.js";

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
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePromptChatTokenLabel(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptChatTokenStatsResponse>> {
  try {
    const rt = await getDesktopRuntime();
    const stats = await loadChatPromptTokenStatsResilient(rt, req);
    return { ok: true, data: stats };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePromptAgentMeta(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptAgentMetaResponse>> {
  try {
    const rt = await getDesktopRuntime();
    try {
      const resolved = await resolveAgentForProject(rt, req.projectId);
      const { definition } = resolved;
      const workspaceModelId = (await rt.state.getCurrentModelId()) ?? "";
      const savedModelId = resolveApplicationModelId({
        agentModelId: definition.model,
        workspaceModelId: workspaceModelId || undefined,
      });
      let modelLabel = "未选择模型";
      if (savedModelId) {
        const saved = await rt.providerModels.getSavedById(savedModelId);
        modelLabel = saved != null ? savedModelDisplayName(saved) : savedModelId;
      }
      const hasDedicatedModel =
        definition.model != null && definition.model !== "";
      if (resolved.source === "global") {
        return {
          ok: true,
          data: {
            source: "global",
            agentId: resolved.agentId,
            agentName: definition.name,
            modelLabel,
            hasDedicatedModel,
          },
        };
      }
      return {
        ok: true,
        data: {
          source: "project-custom",
          agentName: PROJECT_AGENT_META_DISPLAY_LABEL,
          modelLabel,
          hasDedicatedModel,
        },
      };
    } catch (error) {
      if (error instanceof AgentRunResolveError) {
        return {
          ok: true,
          data: {
            source: "none",
            agentName: "未配置 Agent",
            modelLabel: "—",
            hasDedicatedModel: false,
          },
        };
      }
      throw error;
    }
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
