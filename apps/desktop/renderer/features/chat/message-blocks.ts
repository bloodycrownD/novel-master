/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import type { ChatMessageDto, ContentBlockDto } from "../../../shared/ipc-types";

export type ToolCallStatus = "success" | "error";

export interface ToolCallView {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly resultContent?: string;
}

export type ToolPhase = "executing";

export interface MessageListItem {
  readonly kind: "message";
  readonly message: ChatMessageDto;
  readonly textParts: readonly string[];
  readonly thinkingParts: readonly string[];
  readonly tools: readonly ToolCallView[];
  readonly toolPhase?: ToolPhase;
}

export type ChatListItem = MessageListItem;

export interface BuildChatListItemsOptions {
  readonly agentRunning?: boolean;
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
  const lower = result.content.toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.startsWith("[error")
  ) {
    return "error";
  }
  return "success";
}

export function toolCallViewFromUse(
  use: Extract<ContentBlockDto, { type: "tool_use" }>,
  results: Map<string, Extract<ContentBlockDto, { type: "tool_result" }>>,
): ToolCallView {
  const result = results.get(use.id)!;
  return {
    toolUseId: use.id,
    name: use.name,
    input: use.input,
    status: toolStatusFromResult(result),
    resultContent: result.content,
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

export function toolCallSummary(tool: ToolCallView): string {
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

export function buildChatListItems(
  messages: readonly ChatMessageDto[],
  options: BuildChatListItemsOptions = {},
): ChatListItem[] {
  const agentRunning = options.agentRunning ?? false;
  const results = buildToolResultByUseId(messages);
  const items: ChatListItem[] = [];

  for (const message of messages) {
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
    const complete = !hasToolUse || turnToolResultsComplete(message, messages);
    const executing = isTurnToolExecuting(message, messages, agentRunning);
    const tools = complete
      ? toolUses.map((use) => toolCallViewFromUse(use, results))
      : [];

    if (
      textParts.length > 0 ||
      thinkingParts.length > 0 ||
      hasToolUse
    ) {
      items.push({
        kind: "message",
        message,
        textParts,
        thinkingParts,
        tools,
        ...(executing ? { toolPhase: "executing" as const } : {}),
      });
    }
  }

  return items;
}
