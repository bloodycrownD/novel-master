/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import type {
  ChatMessage,
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '@novel-master/core';
import {resolveToolResultOk} from '@novel-master/core';
import type {TranscriptRow} from './ChatTranscriptBridge';
import {decodeLiteralHtmlEntities} from '../rich-content/decode-literal-html-entities';

export type ToolCallStatus = 'success' | 'error' | 'pending';

export interface ToolCallView {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly resultContent?: string;
}


export interface MessageListItem {
  readonly kind: 'message';
  readonly message: ChatMessage;
  readonly textParts: readonly string[];
  /** Model reasoning (`thinking` blocks); shown separately from reply text. */
  readonly thinkingParts: readonly string[];
  /** 有 tool_use 即渲染（无 result 时为 pending）。 */
  readonly tools: readonly ToolCallView[];
}

export type ChatListItem = MessageListItem;

export interface BuildChatListItemsOptions {
  readonly agentRunning?: boolean;
}

function blocksForMessage(message: ChatMessage): readonly ContentBlock[] {
  return message.content.blocks ?? [];
}

/** tool_use ids from an assistant message (block order preserved). */
export function toolUseIdsFromMessage(message: ChatMessage): string[] {
  return blocksForMessage(message)
    .filter((b): b is ToolUseBlock => b.type === 'tool_use')
    .map(b => b.id);
}

/** User row that only carries tool_result blocks (never shown as its own bubble). */
export function messageIsToolResultsOnly(message: ChatMessage): boolean {
  if (message.role !== 'user') {
    return false;
  }
  const blocks = message.content?.blocks;
  if (blocks == null || blocks.length === 0) {
    return false;
  }
  return blocks.every(block => block.type === 'tool_result');
}

export function messageHasToolUse(message: ChatMessage): boolean {
  return toolUseIdsFromMessage(message).length > 0;
}

/**
 * First user message after assistant whose tool_result ids cover all assistant tool_use ids.
 */
export function resolveToolResultsMessageId(
  messages: readonly ChatMessage[],
  assistantMessage: ChatMessage,
): string | undefined {
  const required = new Set(toolUseIdsFromMessage(assistantMessage));
  if (required.size === 0) {
    return undefined;
  }
  for (const message of messages) {
    if (message.seq <= assistantMessage.seq || message.role !== 'user') {
      continue;
    }
    const resultIds = new Set<string>();
    for (const block of blocksForMessage(message)) {
      if (block.type === 'tool_result') {
        resultIds.add(block.toolUseId);
      }
    }
    if ([...required].every(id => resultIds.has(id))) {
      return message.id;
    }
  }
  return undefined;
}

/** Maps tool_use id → tool_result block from user messages in session order. */
export function buildToolResultByUseId(
  messages: readonly ChatMessage[],
): Map<string, ToolResultBlock> {
  const map = new Map<string, ToolResultBlock>();
  // Pair against all messages so hidden tool_result rows still resolve assistant tool cards.
  for (const message of messages) {
    for (const block of blocksForMessage(message)) {
      if (block.type === 'tool_result') {
        map.set(block.toolUseId, block);
      }
    }
  }
  return map;
}

/** True when every tool_use on the assistant has a paired tool_result. */
export function turnToolResultsComplete(
  assistant: ChatMessage,
  messages: readonly ChatMessage[],
): boolean {
  const required = toolUseIdsFromMessage(assistant);
  if (required.length === 0) {
    return true;
  }
  const results = buildToolResultByUseId(messages);
  return required.every(id => results.has(id));
}

function lastIncompleteToolAssistant(
  messages: readonly ChatMessage[],
): ChatMessage | undefined {
  let last: ChatMessage | undefined;
  for (const message of messages) {
    if (
      message.role === 'assistant' &&
      messageHasToolUse(message) &&
      !turnToolResultsComplete(message, messages)
    ) {
      last = message;
    }
  }
  return last;
}

/** Current turn tool execution: agent running + last assistant with incomplete results. */
export function isTurnToolExecuting(
  assistant: ChatMessage,
  messages: readonly ChatMessage[],
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

function toolStatusFromResult(result: ToolResultBlock): ToolCallStatus {
  return resolveToolResultOk(result) ? 'success' : 'error';
}

export function toolCallViewFromUse(
  use: ToolUseBlock,
  results: Map<string, ToolResultBlock>,
): ToolCallView {
  const result = results.get(use.id);
  if (result == null) {
    return {
      toolUseId: use.id,
      name: use.name,
      input: use.input,
      status: 'pending',
    };
  }
  return {
    toolUseId: use.id,
    name: use.name,
    input: use.input,
    status: toolStatusFromResult(result),
    resultContent: result.content,
  };
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const path = input.path ?? input.dir ?? input.from;
  if (typeof path === 'string') {
    return path;
  }
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return '';
  }
  try {
    const raw = JSON.stringify(input);
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  } catch {
    return keys.join(', ');
  }
}

/** File tools whose `input.path` points at a file we can open in session workspace. */
const FILE_OPEN_TOOL_NAMES = new Set(['read', 'write', 'edit']);

/** Logical file path for workspace preview, or undefined if not openable. */
export function vfsToolFilePath(tool: ToolCallView): string | undefined {
  const name =
    tool.name.startsWith('vfs.') ? tool.name.slice(4) : tool.name;
  if (!FILE_OPEN_TOOL_NAMES.has(name)) {
    return undefined;
  }
  const path = tool.input.path;
  if (typeof path === 'string' && path.startsWith('/')) {
    return path;
  }
  return undefined;
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
  return '';
}

/** Flattens session messages into chat bubbles (tool_use embedded on assistant rows). */
export function buildChatListItems(
  messages: readonly ChatMessage[],
  options: BuildChatListItemsOptions = {},
): ChatListItem[] {
  const results = buildToolResultByUseId(messages);
  const items: ChatListItem[] = [];

  for (const message of messages) {
    const blocks = blocksForMessage(message);
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolUses: ToolUseBlock[] = [];
    let hasToolResult = false;

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          if (block.text.trim()) {
            textParts.push(block.text);
          }
          break;
        case 'thinking':
          if (block.text.trim()) {
            thinkingParts.push(block.text);
          }
          break;
        case 'redacted_thinking':
          thinkingParts.push('思考（已脱敏）');
          break;
        case 'tool_use':
          toolUses.push(block);
          break;
        case 'tool_result':
          hasToolResult = true;
          break;
        default:
          break;
      }
    }

    // tool_results-only user rows are paired with assistant; never shown as bubbles.
    if (hasToolResult && textParts.length === 0 && thinkingParts.length === 0) {
      continue;
    }

    const hasToolUse = toolUses.length > 0;
    const tools = toolUses.map(use => toolCallViewFromUse(use, results));

    if (
      textParts.length > 0 ||
      thinkingParts.length > 0 ||
      hasToolUse
    ) {
      items.push({
        kind: 'message',
        message,
        textParts,
        thinkingParts,
        tools,
      });
    }
  }

  return items;
}

export type TranscriptStreamState = {
  readonly text: string;
  readonly thinking: string;
};

/**
 * 基于完整会话构建 transcript 行，再按 tail 消息 id 筛选待 append 行。
 * appendTail 必须带全量上下文，否则 tool pending/complete 在多轮或已配对 hidden tool_result 时会判错。
 */
export function selectTailTranscriptRows(
  allMessages: readonly ChatMessage[],
  tailMessages: readonly ChatMessage[],
  options: BuildChatListItemsOptions = {},
): TranscriptRow[] {
  if (tailMessages.length === 0) {
    return [];
  }
  const tailIds = new Set(tailMessages.map(message => message.id));
  return buildTranscriptRows(allMessages, undefined, options).filter(
    row => row.kind === 'message' && tailIds.has(row.id),
  );
}

/** Maps session messages to Web transcript rows (seq ascending, forward DOM order). */
export function buildTranscriptRows(
  messages: readonly ChatMessage[],
  stream?: TranscriptStreamState,
  options: BuildChatListItemsOptions = {},
): TranscriptRow[] {
  const items = buildChatListItems(messages, options);
  const rows: TranscriptRow[] = [];

  for (const item of items) {
    rows.push({
      kind: 'message',
      id: item.message.id,
      role: item.message.role === 'user' ? 'user' : 'assistant',
      hidden: item.message.hidden,
      text: decodeLiteralHtmlEntities(item.textParts.join('\n')),
      thinking: decodeLiteralHtmlEntities(item.thinkingParts.join('\n')),
      ...(item.tools.length > 0
        ? {
            tools: item.tools.map(t => ({
              toolUseId: t.toolUseId,
              name: t.name,
              input: t.input,
              status: t.status,
              resultContent: t.resultContent,
            })),
          }
        : {}),
    });
  }

  if (
    stream != null &&
    (stream.text.length > 0 || stream.thinking.length > 0)
  ) {
    rows.push({
      kind: 'stream',
      text: stream.text,
      thinking: stream.thinking,
    });
  }

  return rows;
}
