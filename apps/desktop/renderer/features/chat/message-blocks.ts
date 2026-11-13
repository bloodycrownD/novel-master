/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import { skillToolRefResolver, resolveVfsToolFilePath } from "@shared/logic/chat";
import { resolveToolResultOk } from "@shared/logic/root";
import { summarizeToolInput } from "@shared/logic/chat";
import type { ChatMessageDto, ContentBlockDto } from "@shared/ipc-types";

type ToolCallStatus = "success" | "error" | "pending" | "interrupted";

export interface ToolCallView {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly resultContent?: string;
  readonly summary?: string;
  /** task 工具产生的子会话 id；存在则卡片可点跳转子会话。 */
  readonly subagentSessionId?: string;
  /** skill 跳转三元组（read 由 meta 透传，实际命中域在 tool_result 侧）；write/edit 的输入侧解析见 {@link skillToolRef}。 */
  readonly skillRef?: {
    readonly domain: "global" | "project";
    readonly projectId?: string;
    readonly name: string;
  };
}

interface ChatListItem {
  readonly kind: "message";
  readonly message: ChatMessageDto;
  readonly textParts: readonly string[];
  readonly thinkingParts: readonly string[];
  readonly tools: readonly ToolCallView[];
}

interface BuildChatListItemsOptions {
  readonly agentRunning?: boolean;
  /** true 当 uiRunning=false（Composer 已停）；与 agentRunning 正交 */
  readonly runUiStopped?: boolean;
}

function blocksForMessage(message: ChatMessageDto): readonly ContentBlockDto[] {
  return message.contentBlocks ?? [];
}

/** O(1) 判定版本：tool_use id 全部命中预扫 map 即视为本轮工具结果齐备。 */
function turnToolResultsCompleteWith(assistant: ChatMessageDto, results: ReadonlyMap<string, Extract<ContentBlockDto, { type: "tool_result" }>>): boolean {
  const toolUseIds = blocksForMessage(assistant)
    .filter((b): b is Extract<ContentBlockDto, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => b.id);
  if (toolUseIds.length === 0) {
    return true;
  }
  return toolUseIds.every((id) => results.has(id));
}

/**
 * 工具配对预扫上下文（E-1 消 O(n²)：照 mobile buildToolPairingContext 移栽）——
 * 一次 O(n) 扫描产出全量 messages 的 toolUseId→result map 与「最后一条结果
 * 不齐备的 assistant」，供逐消息循环内 O(1) 判定复用，取代旧实现里每条
 * assistant 现场重建 map / 全量重扫的写法（语义严格等价）。
 */
interface ToolPairingContext {
  readonly results: ReadonlyMap<string, Extract<ContentBlockDto, { type: "tool_result" }>>;
  readonly lastIncomplete: ChatMessageDto | undefined;
}

/** 一次 O(n) 扫描构建工具配对上下文（含 toolUseId→result map 的全量收集）。 */
function buildToolPairingContext(messages: readonly ChatMessageDto[]): ToolPairingContext {
  const results = new Map<string, Extract<ContentBlockDto, { type: "tool_result" }>>();
  for (const message of messages) {
    for (const block of blocksForMessage(message)) {
      if (block.type === "tool_result") {
        results.set(block.toolUseId, block);
      }
    }
  }
  let lastIncomplete: ChatMessageDto | undefined;
  for (const message of messages) {
    if (message.role === "assistant" && !turnToolResultsCompleteWith(message, results)) {
      lastIncomplete = message;
    }
  }
  return { results, lastIncomplete };
}

// nm-style: keep-public — 测试直连的行为锁（本轮禁改测试）；生产仅 buildChatListItems 单点调用
export function isTurnToolExecuting(assistant: ChatMessageDto, messages: readonly ChatMessageDto[], agentRunning: boolean): boolean {
  return isTurnToolExecutingWith(assistant, buildToolPairingContext(messages), agentRunning);
}

/** O(1) 判定版本：agent 运行中且该消息正是预扫出的最后一条结果不齐备 assistant。 */
function isTurnToolExecutingWith(assistant: ChatMessageDto, context: ToolPairingContext, agentRunning: boolean): boolean {
  const hasToolUse = blocksForMessage(assistant).some((block) => block.type === "tool_use");
  if (!agentRunning || !hasToolUse || turnToolResultsCompleteWith(assistant, context.results)) {
    return false;
  }
  // 只有「最后一个仍缺 tool_result 的 assistant」算执行中；后续 assistant 已有结果时不归它
  return context.lastIncomplete?.id === assistant.id;
}

/**
 * 工具入参摘要：单源在 core（经 `@shared/logic/chat` 再导出的 `summarizeToolInput`）。
 * 本文件此前持有一份带 `skill` 特判的副本，与 mobile 两面（WebView / RN）行为不一致，
 * 现已全部改为引用 core；新增特判分支请改 core 的 `domain/chat/logic/message/tool-summary.ts`。
 */

/** 解析工具卡片对应的 VFS 文件路径；不可打开时返回 undefined。 */
export function vfsToolFilePath(tool: ToolCallView): string | undefined {
  return resolveVfsToolFilePath(tool.name, tool.input);
}

/**
 * 解析 skill 卡片的跳转三元组：优先 tool_result meta 透传的 skillRef
 * （read 缺省域命中生效副本的解析结果），否则从 tool_use 输入解析
 * （write/edit 必含；read 缺省域在 pending 时解析不出，返回 undefined）。
 */
export function skillToolRef(tool: ToolCallView, projectId?: string): ToolCallView["skillRef"] {
  if (tool.skillRef != null) return tool.skillRef;
  return skillToolRefResolver.fromInput(tool.name, tool.input, projectId);
}

export function toolCallSummary(tool: ToolCallView): string {
  if (tool.status === "error" && tool.summary) {
    // 失败摘要只取首行（搜索链聚合错误等多行诊断全文见工具详情），
    // 超长按与成功摘要同档截断，卡片不被整段报错撑开。
    const firstLine = tool.summary.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  }
  const fromInput = summarizeToolInput(tool.name, tool.input);
  if (fromInput) {
    return fromInput;
  }
  if (tool.resultContent) {
    const t = tool.resultContent.trim();
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }
  return "";
}

// nm-style: keep-public — 消息 → 列表项的视图组装入口；MessageList 只负责渲染，解析与工具配对语义不归调用方
export function buildChatListItems(messages: readonly ChatMessageDto[], options: BuildChatListItemsOptions = {}): ChatListItem[] {
  const agentRunning = options.agentRunning ?? false;
  const runUiStopped = options.runUiStopped ?? false;
  // 全量配对上下文只预扫一次，逐消息 O(1) 判定（E-1）
  const context = buildToolPairingContext(messages);
  const results = context.results;
  const items: ChatListItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const blocks = blocksForMessage(message);
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolUses: Extract<ContentBlockDto, { type: "tool_use" }>[] = [];
    let hasToolResult = false;

    for (const block of blocks) {
      switch (block.type) {
        case "text":
          if (block.text.trim()) {
            textParts.push(block.text);
          }
          break;
        case "thinking":
          if (block.text.trim()) {
            thinkingParts.push(block.text);
          }
          break;
        case "tool_use":
          toolUses.push(block);
          break;
        case "tool_result":
          hasToolResult = true;
          break;
        default:
          break;
      }
    }

    if (hasToolResult && textParts.length === 0 && thinkingParts.length === 0) {
      continue;
    }

    const hasToolUse = toolUses.length > 0;
    // Composer 已停时未配对卡直接 error；否则只有最后一个待结果的 assistant 保持 pending
    const unpairedStatus: ToolCallStatus = runUiStopped ? "error" : isTurnToolExecutingWith(message, context, agentRunning) ? "pending" : "error";
    const tools = toolUses.map((use): ToolCallView => {
      const result = results.get(use.id);
      if (result == null) {
        return {
          toolUseId: use.id,
          name: use.name,
          input: use.input,
          status: unpairedStatus,
        };
      }
      // Prefer persisted `ok`; legacy blocks fall back to Error: prefix only (core helper).
      return {
        toolUseId: use.id,
        name: use.name,
        input: use.input,
        status: resolveToolResultOk(result) ? "success" : "error",
        resultContent: result.content,
        ...(result.summary != null ? { summary: result.summary } : {}),
        ...(result.meta?.subagentSessionId != null ? { subagentSessionId: result.meta.subagentSessionId } : {}),
        ...(result.meta?.skillRef != null ? { skillRef: result.meta.skillRef } : {}),
      };
    });

    // 空正文但有 attachments（如仅 flush 的 user_ops / materialize workplace）仍须进列表
    if (textParts.length > 0 || thinkingParts.length > 0 || hasToolUse || (message.attachments?.length ?? 0) > 0) {
      items.push({ kind: "message", message, textParts, thinkingParts, tools });
    }
  }

  return items;
}
