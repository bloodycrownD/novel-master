/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import { resolveSkillToolRefFromInput, resolveVfsToolFilePath } from "@shared/logic/chat";
import { resolveToolResultOk } from "@shared/logic/root";
import type { ChatMessageDto, ContentBlockDto } from "@shared/ipc-types";

export type ToolCallStatus = "success" | "error" | "pending" | "interrupted";

export interface ToolCallView {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly resultContent?: string;
  readonly summary?: string;
  /** task 工具产生的子会话 id；存在则卡片可点跳转子会话。 */
  readonly subagentSessionId?: string;
  /** skill_opt 跳转三元组（read 由 meta 透传，实际命中域在 tool_result 侧）；write/edit 的输入侧解析见 {@link skillToolRef}。 */
  readonly skillRef?: {
    readonly domain: 'global' | 'project';
    readonly projectId?: string;
    readonly name: string;
  };
}


export interface MessageListItem {
  readonly kind: "message";
  readonly message: ChatMessageDto;
  readonly textParts: readonly string[];
  readonly thinkingParts: readonly string[];
  readonly tools: readonly ToolCallView[];
}

export type ChatListItem = MessageListItem;

export interface BuildChatListItemsOptions {
  readonly agentRunning?: boolean;
  /** true 当 uiRunning=false（Composer 已停）；与 agentRunning 正交 */
  readonly runUiStopped?: boolean;
}

function blocksForMessage(message: ChatMessageDto): readonly ContentBlockDto[] {
  return message.contentBlocks ?? [];
}

export function toolUseIdsFromMessage(message: ChatMessageDto): string[] {
  return blocksForMessage(message)
    .filter((b): b is Extract<ContentBlockDto, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => b.id);
}

export function messageHasToolUse(message: ChatMessageDto): boolean {
  return toolUseIdsFromMessage(message).length > 0;
}

export function resolveToolResultsMessageId(
  messages: readonly ChatMessageDto[],
  assistantMessage: ChatMessageDto,
): string | undefined {
  const required = new Set(toolUseIdsFromMessage(assistantMessage));
  if (required.size === 0) {
    return undefined;
  }
  for (const message of messages) {
    if (message.seq <= assistantMessage.seq || message.role !== "user") {
      continue;
    }
    const resultIds = new Set<string>();
    for (const block of blocksForMessage(message)) {
      if (block.type === "tool_result") {
        resultIds.add(block.toolUseId);
      }
    }
    if ([...required].every((id) => resultIds.has(id))) {
      return message.id;
    }
  }
  return undefined;
}

export function buildToolResultByUseId(
  messages: readonly ChatMessageDto[],
): Map<string, Extract<ContentBlockDto, { type: "tool_result" }>> {
  const map = new Map<
    string,
    Extract<ContentBlockDto, { type: "tool_result" }>
  >();
  for (const message of messages) {
    for (const block of blocksForMessage(message)) {
      if (block.type === "tool_result") {
        map.set(block.toolUseId, block);
      }
    }
  }
  return map;
}

export function turnToolResultsComplete(
  assistant: ChatMessageDto,
  messages: readonly ChatMessageDto[],
): boolean {
  const required = toolUseIdsFromMessage(assistant);
  if (required.length === 0) {
    return true;
  }
  const results = buildToolResultByUseId(messages);
  return required.every((id) => results.has(id));
}

function lastIncompleteToolAssistant(
  messages: readonly ChatMessageDto[],
): ChatMessageDto | undefined {
  let last: ChatMessageDto | undefined;
  for (const message of messages) {
    if (
      message.role === "assistant" &&
      messageHasToolUse(message) &&
      !turnToolResultsComplete(message, messages)
    ) {
      last = message;
    }
  }
  return last;
}

export function isTurnToolExecuting(
  assistant: ChatMessageDto,
  messages: readonly ChatMessageDto[],
  agentRunning: boolean,
): boolean {
  if (!agentRunning || !messageHasToolUse(assistant)) {
    return false;
  }
  if (turnToolResultsComplete(assistant, messages)) {
    return false;
  }
  return lastIncompleteToolAssistant(messages)?.id === assistant.id;
}

function toolStatusFromResult(
  result: Extract<ContentBlockDto, { type: "tool_result" }>,
): ToolCallStatus {
  // Prefer persisted `ok`; legacy blocks fall back to Error: prefix only (core helper).
  return resolveToolResultOk(result) ? "success" : "error";
}

export function toolCallViewFromUse(
  use: Extract<ContentBlockDto, { type: "tool_use" }>,
  results: Map<string, Extract<ContentBlockDto, { type: "tool_result" }>>,
): ToolCallView {
  const result = results.get(use.id);
  if (result == null) {
    return {
      toolUseId: use.id,
      name: use.name,
      input: use.input,
      status: "pending",
    };
  }
  return {
    toolUseId: use.id,
    name: use.name,
    input: use.input,
    status: toolStatusFromResult(result),
    resultContent: result.content,
    ...(result.summary != null ? { summary: result.summary } : {}),
    ...(result.meta?.subagentSessionId != null
      ? { subagentSessionId: result.meta.subagentSessionId }
      : {}),
    ...(result.meta?.skillRef != null
      ? { skillRef: result.meta.skillRef }
      : {}),
  };
}

function summarizeToolInput(
  name: string,
  input: Record<string, unknown>,
): string {
  const path = input.path ?? input.dir ?? input.from;
  if (typeof path === "string") {
    return path;
  }
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return "";
  }
  try {
    const raw = JSON.stringify(input);
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  } catch {
    return keys.join(", ");
  }
}

/** 解析工具卡片对应的 VFS 文件路径；不可打开时返回 undefined。 */
export function vfsToolFilePath(tool: ToolCallView): string | undefined {
  return resolveVfsToolFilePath(tool.name, tool.input);
}

/**
 * 解析 skill_opt 卡片的跳转三元组：优先 tool_result meta 透传的 skillRef
 * （read 缺省域命中生效副本的解析结果），否则从 tool_use 输入解析
 * （write/edit 必含；read 缺省域在 pending 时解析不出，返回 undefined）。
 */
export function skillToolRef(
  tool: ToolCallView,
  projectId?: string,
): ToolCallView["skillRef"] {
  if (tool.skillRef != null) return tool.skillRef;
  return resolveSkillToolRefFromInput(tool.name, tool.input, projectId);
}

export function toolCallSummary(tool: ToolCallView): string {
  if (tool.status === "error" && tool.summary) {
    return tool.summary;
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

function resolveUnpairedToolStatus(
  assistant: ChatMessageDto,
  messages: readonly ChatMessageDto[],
  agentRunning: boolean,
  runUiStopped: boolean,
): ToolCallStatus {
  if (runUiStopped) {
    return "error";
  }
  return isTurnToolExecuting(assistant, messages, agentRunning)
    ? "pending"
    : "error";
}

export function buildChatListItems(
  messages: readonly ChatMessageDto[],
  options: BuildChatListItemsOptions = {},
): ChatListItem[] {
  const agentRunning = options.agentRunning ?? false;
  const runUiStopped = options.runUiStopped ?? false;
  const results = buildToolResultByUseId(messages);
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
    const unpairedStatus = hasToolUse
      ? resolveUnpairedToolStatus(message, messages, agentRunning, runUiStopped)
      : undefined;
    const tools = toolUses.map((use) => {
      const view = toolCallViewFromUse(use, results);
      if (view.status === "pending" && unpairedStatus != null) {
        return { ...view, status: unpairedStatus };
      }
      return view;
    });

    // 空正文但有 attachments（如仅 flush 的 user_ops / materialize workplace）仍须进列表
    if (
      textParts.length > 0 ||
      thinkingParts.length > 0 ||
      hasToolUse ||
      (message.attachments?.length ?? 0) > 0
    ) {
      items.push({
        kind: "message",
        message,
        textParts,
        thinkingParts,
        tools,
      });
    }
  }

  return items;
}
