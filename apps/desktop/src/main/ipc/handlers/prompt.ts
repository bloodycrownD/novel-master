/**
 * Prompt IPC handlers — real prompt preview turns, chat token label, agent meta.
 */
import {
  AGENT_RUN_RESOLVE_KEYS,
  resolveAgentForProject,
  type AppError,
} from "@novel-master/core/agent";
import { savedModelDisplayName } from "@novel-master/core/provider";
import { formatToolUsePreviewJson } from "@novel-master/core/prompt";
import { Result } from "@novel-master/core/errors";
import type {
  IpcResult,
  PromptAgentMetaResponse,
  PromptChatTokenStatsResponse,
  PromptPreviewTurnDto,
  PromptScopeRequest,
  PromptTextCardDto,
  PromptToolGroupDto,
  PromptTurnCardDto,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { loadChatPromptTokenStatsResilient } from "../../services/chat-prompt-tokens.service.js";
import { buildRealPromptPreviewTurns } from "../../services/prompt-preview.service.js";
import { coreT } from "../../../../shared/logic/core-i18n.js";
import { toIpcResult } from "../ipc-result.js";

export function handlePromptRealPreview(req: PromptScopeRequest): Promise<IpcResult<PromptPreviewTurnDto[]>> {
  return toIpcResult(async (): Promise<Result<PromptPreviewTurnDto[], AppError>> => {
    const built = await getDesktopRuntime();
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const preview = await buildRealPromptPreviewTurns(rt, req);
    if (!preview.ok) return Result.err(preview.error);
    return Result.ok(preview.value.map((turn) => ({
      id: turn.id,
      kind: turn.kind,
      // core 产出 MessageLike（G3.5）：main 翻译后写 string DTO（spec G4.3）
      summaryText: coreT(turn.summaryText),
      metaText: turn.metaText.map(coreT).join(" · "),
      // cards 是唯一正文载体：三类轮统一下发，body / items 已从 DTO 退役
      // （它们是同一份正文的两种粒度，各下发一次才需要按 kind 分叉压体积；
      // 详见 shared/ipc-types.ts 的体积策略注释）。
      cards: turn.cards.map((card) =>
        card.type === "toolGroup"
          ? ({
              type: card.type,
              id: card.id,
              toolName: card.toolName,
              inputJson: card.inputJson,
              // 保结构截大 key 的预览在 main 侧算好下发（renderer 不引
              // core 运行时——这条 import 会把 zod 等整图拖进沙箱 bundle）。
              inputPreview: formatToolUsePreviewJson(card.inputJson),
              result: card.result,
              status: card.status,
              parallel: card.parallel,
            } satisfies PromptTurnCardDto)
          : card.type === "workplace"
            ? ({
                type: card.type,
                id: card.id,
                files: card.files,
              } satisfies PromptTurnCardDto)
            : ({
                type: card.type,
                id: card.id,
                role: card.role,
                body: card.body,
              } satisfies PromptTurnCardDto),
      ),
    })));
  });
}

/**
 * chat token 占用读口 IPC。
 *
 * `data` 允许为 `null`（r3-dt-align 第 2 层的返回契约）：run 在途时读口跳过本轮
 * （整串级重活与发送链抢同一条 SQLite 连接），或中途被弃权，两种情况都回
 * `{ok:true, data:null}`。renderer 收到 null 必须**保留旧标签**——不清空、不显示
 * 占位（与 mobile 的空串哨兵同口径）。
 */
export function handlePromptChatTokenLabel(req: PromptScopeRequest): Promise<IpcResult<PromptChatTokenStatsResponse | null>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    // resilient 的已知失败（主路径 + fallback 双双失败）原样转码；弃权 → null（保留旧标签）。
    return loadChatPromptTokenStatsResilient(rt, req);
  });
}

export function handlePromptAgentMeta(req: PromptScopeRequest): Promise<IpcResult<PromptAgentMetaResponse>> {
  return toIpcResult(async (): Promise<Result<PromptAgentMetaResponse, AppError>> => {
    const built = await getDesktopRuntime();
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const resolved = await resolveAgentForProject(rt, req.projectId, req.sessionId);
    // resolve 已知失败沿 Result 到达（错误通道迁移四期），就地归一（错误通道
    // 迁移七期）：resolve keys → source:'none'（T-C2 口径不变），其余沿 Result
    // 上行交 toIpcResult 转码。
    if (!resolved.ok) {
      if (AGENT_RUN_RESOLVE_KEYS.has(resolved.error.key)) {
        return Result.ok({
          source: "none",
          agentName: "未配置 Agent",
          modelLabel: "—",
          hasDedicatedModel: false,
        });
      }
      return Result.err(resolved.error);
    }
    const { definition, agentId } = resolved.value;
    // workspace 层已移除：模型解析链收窄为 agent pin → session.modelId。
    // 这里读 session 配置拿 modelId，同时用于 modelSource 判定。
    const sessionConfig = await rt.sessions.getSessionAgentConfig(req.sessionId);
    if (!sessionConfig.ok) return Result.err(sessionConfig.error);
    const savedModelId = definition.model ?? sessionConfig.value.modelId;
    let modelLabel = "未选择模型";
    if (savedModelId) {
      const saved = await rt.providerModels.getSavedById(savedModelId);
      if (!saved.ok) return Result.err(saved.error);
      if (saved.value != null) {
        const provider = await rt.providers.get(saved.value.providerId);
        if (!provider.ok) return Result.err(provider.error);
        modelLabel = savedModelDisplayName(saved.value, provider.value.displayName);
      } else {
        modelLabel = savedModelId;
      }
    }
    const hasDedicatedModel = definition.model != null && definition.model !== "";
    // modelSource 优先级链：agent pin 压制一切 → 否则取 session。
    const modelSource: "agent-pin" | "session" = hasDedicatedModel ? "agent-pin" : "session";
    // 项目智能体已下线：resolve 永远走 session 分支。
    return Result.ok({
      source: "session",
      agentId,
      agentName: definition.name,
      modelLabel,
      hasDedicatedModel,
      modelSource,
    });
  });
}

// core 侧加字段而 DTO 未跟时，下列导出 const 构造 {} 编译红（TS2741：差集键 missing）
type CoreGroupParityCheck = Record<
  Exclude<
    keyof import("@novel-master/core/prompt").PromptToolGroupCardData,
    keyof PromptToolGroupDto
  >,
  never
>;
type CoreTextParityCheck = Record<
  Exclude<
    keyof import("@novel-master/core/prompt").PromptTextCardData,
    keyof PromptTextCardDto
  >,
  never
>;
type CoreWorkplaceParityCheck = Record<
  Exclude<
    keyof import("@novel-master/core/prompt").PromptWorkplaceCardData,
    keyof import("../../../../shared/ipc-types.js").PromptWorkplaceDto
  >,
  never
>;
type CoreWorkplaceFileParityCheck = Record<
  Exclude<
    keyof import("@novel-master/core/prompt").PromptWorkplaceFileCardData,
    keyof import("../../../../shared/ipc-types.js").PromptWorkplaceFileDto
  >,
  never
>;

// nm-style: keep-public — 编译期 DTO/core 字段对齐断言（构造 {} 迫使差集键为 never）
export const CORE_GROUP_PARITY_CHECK: CoreGroupParityCheck = {};
// nm-style: keep-public — 编译期 DTO/core 字段对齐断言（构造 {} 迫使差集键为 never）
export const CORE_TEXT_PARITY_CHECK: CoreTextParityCheck = {};
// nm-style: keep-public — 编译期 DTO/core 字段对齐断言（构造 {} 迫使差集键为 never）
export const CORE_WORKPLACE_PARITY_CHECK: CoreWorkplaceParityCheck = {};
// nm-style: keep-public — 编译期 DTO/core 字段对齐断言（构造 {} 迫使差集键为 never）
export const CORE_WORKPLACE_FILE_PARITY_CHECK: CoreWorkplaceFileParityCheck = {};
