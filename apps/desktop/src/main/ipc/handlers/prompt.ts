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
      const resolved = await resolveAgentForProject(
        rt,
        req.projectId,
        req.sessionId,
      );
      const { definition } = resolved;
      const workspaceModelId = (await rt.state.getCurrentModelId()) ?? "";
      const savedModelId = resolveApplicationModelId({
        agentModelId: definition.model,
        workspaceModelId: workspaceModelId || undefined,
      });
      let modelLabel = "未选择模型";
      if (savedModelId) {
        const saved = await rt.providerModels.getSavedById(savedModelId);
        if (saved != null) {
          const provider = await rt.providers.get(saved.providerId);
          modelLabel = savedModelDisplayName(saved, provider.displayName);
        } else {
          modelLabel = savedModelId;
        }
      }
      const hasDedicatedModel =
        definition.model != null && definition.model !== "";
      // modelSource 优先级链：agent pin 压制一切 → 会话 bind 带 modelId 覆盖 → 回退 workspace。
      // project-custom / global / none 不产生 session-override（custom 截断 session，global 表示 session 为 follow）。
      let modelSource: 'agent-pin' | 'session-override' | 'workspace';
      if (hasDedicatedModel) {
        modelSource = 'agent-pin';
      } else if (resolved.source === 'session-bind') {
        const sessionConfig = await rt.sessions.getSessionAgentConfig(
          req.sessionId,
        );
        modelSource =
          sessionConfig.mode === 'bind' && sessionConfig.modelId
            ? 'session-override'
            : 'workspace';
      } else {
        modelSource = 'workspace';
      }
      if (resolved.source === "global") {
        return {
          ok: true,
          data: {
            source: "global",
            agentId: resolved.agentId,
            agentName: definition.name,
            modelLabel,
            hasDedicatedModel,
            modelSource,
          },
        };
      }
      if (resolved.source === "session-bind") {
        return {
          ok: true,
          data: {
            source: "session-bind",
            agentId: resolved.agentId,
            agentName: definition.name,
            modelLabel,
            hasDedicatedModel,
            modelSource,
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
          modelSource,
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
