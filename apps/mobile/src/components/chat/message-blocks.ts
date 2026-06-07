/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import type {
  ChatMessage,
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '@novel-master/core';
import type {TranscriptRow} from './ChatTranscriptBridge';
import {decodeLiteralHtmlEntities} from '../rich-content/decode-literal-html-entities';

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
  /** Model reasoning (`thinking` blocks); shown separately from reply text. */
  readonly thinkingParts: readonly string[];
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

/** VFS tools whose `input.path` points at a file we can open in session workspace. */
const VFS_FILE_OPEN_TOOL_NAMES = new Set([
  'vfs.read',
  'vfs.write',
  'vfs.replace',
]);

/** Logical file path for workspace preview, or undefined if not openable. */
export function vfsToolFilePath(tool: ToolCallView): string | undefined {
  if (!VFS_FILE_OPEN_TOOL_NAMES.has(tool.name)) {
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

/** Flattens session messages into bubbles and standalone tool cards (hidden rows stay visible). */
export function buildChatListItems(
  messages: readonly ChatMessage[],
): ChatListItem[] {
  const results = buildToolResultByUseId(messages);
  const items: ChatListItem[] = [];

  for (const message of messages) {
    const blocks = blocksForMessage(message);
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
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
            thinkingParts.push(block.text);
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

    if (textParts.length > 0 || thinkingParts.length > 0) {
      items.push({
        kind: 'message',
        message,
        textParts,
        thinkingParts,
        toolUses: [],
      });
    }

    if (!message.hidden) {
      for (const use of toolUses) {
        items.push({
          kind: 'tool',
          tool: toolCallViewFromUse(use, results),
        });
      }
    }
  }

  return items;
}

export type TranscriptStreamState = {
  readonly text: string;
  readonly thinking: string;
};

/** Maps session messages to Web transcript rows (seq ascending, forward DOM order). */
export function buildTranscriptRows(
  messages: readonly ChatMessage[],
  stream?: TranscriptStreamState,
): TranscriptRow[] {
  const items = buildChatListItems(messages);
  const rows: TranscriptRow[] = [];

  for (const item of items) {
    if (item.kind === 'message') {
      rows.push({
        kind: 'message',
        id: item.message.id,
        role: item.message.role === 'user' ? 'user' : 'assistant',
        hidden: item.message.hidden,
        text: decodeLiteralHtmlEntities(item.textParts.join('\n')),
        thinking: decodeLiteralHtmlEntities(item.thinkingParts.join('\n')),
      });
    } else if (item.kind === 'tool') {
      rows.push({
        kind: 'tool',
        toolUseId: item.tool.toolUseId,
        name: item.tool.name,
        input: item.tool.input,
        status: item.tool.status,
        resultContent: item.tool.resultContent,
      });
    }
  }

  if (stream != null && (stream.text.length > 0 || stream.thinking.length > 0)) {
    rows.push({
      kind: 'stream',
      text: stream.text,
      thinking: stream.thinking,
    });
  }

  return rows;
}
