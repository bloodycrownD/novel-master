/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import type {
  ChatMessage,
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '@novel-master/core';

export type ToolCallStatus = 'pending' | 'success' | 'error';

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
  readonly toolUses: readonly ToolUseBlock[];
}

export interface ToolCallListItem {
  readonly kind: 'tool';
  readonly tool: ToolCallView;
}

export type ChatListItem = MessageListItem | ToolCallListItem;

function blocksForMessage(message: ChatMessage): readonly ContentBlock[] {
  return message.content.blocks ?? [];
}

/** Maps tool_use id → tool_result block from user messages in session order. */
export function buildToolResultByUseId(
  messages: readonly ChatMessage[],
): Map<string, ToolResultBlock> {
  const map = new Map<string, ToolResultBlock>();
  for (const message of messages) {
    if (message.hidden) {
      continue;
    }
    for (const block of blocksForMessage(message)) {
      if (block.type === 'tool_result') {
        map.set(block.toolUseId, block);
      }
    }
  }
  return map;
}

function toolStatusFromResult(
  result: ToolResultBlock | undefined,
): ToolCallStatus {
  if (result == null) {
    return 'pending';
  }
  const lower = result.content.toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.startsWith('[error')
  ) {
    return 'error';
  }
  return 'success';
}

export function toolCallViewFromUse(
  use: ToolUseBlock,
  results: Map<string, ToolResultBlock>,
): ToolCallView {
  const result = results.get(use.id);
  return {
    toolUseId: use.id,
    name: use.name,
    input: use.input,
    status: toolStatusFromResult(result),
    resultContent: result?.content,
  };
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  if (name.startsWith('vfs.')) {
    const path = input.path;
    if (typeof path === 'string') {
      return path;
    }
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

/** Flattens visible messages into bubbles and standalone tool cards. */
export function buildChatListItems(
  messages: readonly ChatMessage[],
): ChatListItem[] {
  const visible = messages.filter(m => !m.hidden);
  const results = buildToolResultByUseId(visible);
  const items: ChatListItem[] = [];

  for (const message of visible) {
    const blocks = blocksForMessage(message);
    const textParts: string[] = [];
    const toolUses: ToolUseBlock[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          if (block.text.trim()) {
            textParts.push(block.text);
          }
          break;
        case 'thinking':
          if (block.text.trim()) {
            textParts.push(block.text);
          }
          break;
        case 'tool_use':
          toolUses.push(block);
          break;
        case 'tool_result':
          break;
        default:
          break;
      }
    }

    if (textParts.length > 0) {
      items.push({
        kind: 'message',
        message,
        textParts,
        toolUses: [],
      });
    }

    for (const use of toolUses) {
      items.push({
        kind: 'tool',
        tool: toolCallViewFromUse(use, results),
      });
    }
  }

  return items;
}
