/**
 * Prompt IPC handlers — real prompt preview turns, chat token label, agent meta.
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
  PromptPreviewTurnDto,
  PromptScopeRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { loadChatPromptTokenStatsResilient } from "../../services/chat-prompt-tokens.service.js";
import { buildRealPromptPreviewTurns } from "../../services/prompt-preview.service.js";
import { formatIpcError } from "../format-ipc-error.js";

export async function handlePromptRealPreview(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptPreviewTurnDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const turns = await buildRealPromptPreviewTurns(rt, req);
    return {
      ok: true,
      data: turns.map((turn) => ({
        id: turn.id,
        kind: turn.kind,
        summaryText: turn.summaryText,
        metaText: turn.metaText,
        // cards 是唯一正文载体：三类轮统一下发，body / items 已从 DTO 退役
        // （它们是同一份正文的两种粒度，各下发一次才需要按 kind 分叉压体积；
        // 详见 shared/ipc-types.ts 的体积策略注释）。
        cards: turn.cards.map((card) =>
          card.type === "toolGroup"
            ? {
                type: card.type,
                id: card.id,
                toolName: card.toolName,
                inputJson: card.inputJson,
                result: card.result,
                status: card.status,
                parallel: card.parallel,
              }
            : {
                type: card.type,
                id: card.id,
                role: card.role,
                body: card.body,
              },
        ),
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * chat token 占用读口 IPC。
 *
 * `data` 允许为 `null`（r3-dt-align 第 2 层的返回契约）：run 在途时读口跳过本轮
 * （整串级重活与发送链抢同一条 SQLite 连接），或中途被弃权，两种情况都回
 * `{ok:true, data:null}`。renderer 收到 null 必须**保留旧标签**——不清空、不显示
 * 占位（与 mobile 的空串哨兵同口径）。
 */
export async function handlePromptChatTokenLabel(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptChatTokenStatsResponse | null>> {
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
