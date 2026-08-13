/**
 * Prompt IPC handlers — real prompt preview segments, chat token label, agent meta.
 */
import {
  AgentRunResolveError,
  resolveAgentForProject,
  resolveSavedModelId,
} from "@novel-master/core/agent";
import { savedModelDisplayName } from "@novel-master/core/provider";
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
      // workspace 层已移除：模型解析链收窄为 agent pin → session.modelId。
      // 这里读 session 配置拿 modelId，同时用于 modelSource 判定。
      const sessionConfig = await rt.sessions.getSessionAgentConfig(
        req.sessionId,
      );
      const savedModelId = resolveSavedModelId({
        agentModelId: definition.model,
        sessionModelId: sessionConfig.modelId,
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
      // modelSource 优先级链：agent pin 压制一切 → 否则取 session。
      const modelSource: 'agent-pin' | 'session' = hasDedicatedModel
        ? 'agent-pin'
        : 'session';
      // 项目智能体已下线：resolve 永远走 session 分支。
      return {
        ok: true,
        data: {
          source: "session",
          agentId: resolved.agentId,
          agentName: definition.name,
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
