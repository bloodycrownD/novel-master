/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import {
  type ChatMessage,
  type ContentBlock,
  type MessageAttachment,
  type ToolResultBlock,
  type ToolUseBlock,
} from '@novel-master/core/chat';
import { resolveToolResultOk } from '@novel-master/core';

import { resolveSkillToolRefFromInput, resolveVfsToolFilePath } from '@novel-master/core/chat';
import type { SkillToolRef } from '@novel-master/core/chat';
import type { TranscriptRow } from './ChatTranscriptBridge';
import { decodeLiteralHtmlEntities } from '@/components/rich-content/decode-literal-html-entities';

export type ToolCallStatus = 'success' | 'error' | 'pending' | 'interrupted';

export interface ToolCallView {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly resultContent?: string;
  readonly summary?: string;
  /**
   * 子代理会话 id：`task` 工具产生的 tool_result 会带上 meta.subagentSessionId，
   * 这里从 result.meta 读出来供工具卡片点击跳转子会话只读浏览（对称 vfsToolFilePath）。
   */
  readonly subagentSessionId?: string;
  /**
   * skill 跳转三元组：read 由 tool_result meta 透传（实际命中域在结果侧）；
   * write/edit 从 tool_use 输入解析（见 skillToolRef）。
   */
  readonly skillRef?: SkillToolRef;
}

export interface MessageListItem {
  readonly kind: 'message';
  readonly message: ChatMessage;
  readonly textParts: readonly string[];
  /** Model reasoning (`thinking` blocks); shown separately from reply text. */
  readonly thinkingParts: readonly string[];
  /** 有 tool_use 即渲染（无 result 时 runUiStopped 优先 error，否则 agentRunning + isTurnToolExecuting 决定 pending / error）。 */
  readonly tools: readonly ToolCallView[];
}

export type ChatListItem = MessageListItem;

export interface BuildChatListItemsOptions {
  readonly agentRunning?: boolean;
  /** true 当 uiRunning=false（Composer 已停）；与 agentRunning 正交 */
  readonly runUiStopped?: boolean;
  /** pending task 工具的子会话映射：title → childSessionId（执行中即可点击进入）。 */
  readonly pendingSubagentSessions?: ReadonlyMap<string, string>;
}

function blocksForMessage(message: ChatMessage): readonly ContentBlock[] {
  return message.content.blocks ?? [];
}

/**
 * user_ops 已拆除：遗留操作日志附件（非 annotate）不再兼容展示，直接丢弃；
 * 批注（annotate）与其它来源附件照常保留。列表与 transcript 共用此口径。
 */
export function isDisplayableAttachment(a: MessageAttachment): boolean {
  return !(a.source === 'user_ops' && a.action !== 'annotate');
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
  options?: BuildChatListItemsOptions,
): ToolCallView {
  const result = results.get(use.id);
  if (result == null) {
    const view: ToolCallView = {
      toolUseId: use.id,
      name: use.name,
      input: use.input,
      status: 'pending',
    };
    // pending task 工具：尝试从 pendingSubagentSessions 按 title 匹配 childSessionId，
    // 这样执行中的 task 卡片也能点击进入子会话浏览。
    if (use.name === 'task' && options?.pendingSubagentSessions) {
      const desc =
        typeof use.input?.description === 'string'
          ? use.input.description.trim()
          : '';
      const prompt =
        typeof use.input?.prompt === 'string' ? use.input.prompt.trim() : '';
      const title = desc || prompt.slice(0, 40);
      if (title) {
        const childSessionId = options.pendingSubagentSessions.get(title);
        if (childSessionId) {
          return { ...view, subagentSessionId: childSessionId };
        }
      }
    }
    return view;
  }
  const subagentSessionId = result.meta?.subagentSessionId;
  const skillRef = result.meta?.skillRef;
  return {
    toolUseId: use.id,
    name: use.name,
    input: use.input,
    status: toolStatusFromResult(result),
    resultContent: result.content,
    ...(result.summary != null ? { summary: result.summary } : {}),
    ...(typeof subagentSessionId === 'string' && subagentSessionId.length > 0
      ? { subagentSessionId }
      : {}),
    ...(skillRef != null ? { skillRef } : {}),
  };
}

function summarizeToolInput(
  name: string,
  input: Record<string, unknown>,
): string {
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

/** 工具卡片可打开的逻辑文件路径；不可打开时返回 undefined。 */
export function vfsToolFilePath(tool: ToolCallView): string | undefined {
  return resolveVfsToolFilePath(tool.name, tool.input);
}

/**
 * 解析 skill 卡片的跳转三元组：优先 tool_result meta 透传的 skillRef
 * （read 缺省域命中生效副本的解析结果），否则从 tool_use 输入解析
 * （write/edit 必含；read 缺省域在 pending 时解析不出，返回 undefined）。
 */
export function skillToolRef(
  tool: ToolCallView,
  projectId?: string,
): SkillToolRef | undefined {
  if (tool.skillRef != null) return tool.skillRef;
  return resolveSkillToolRefFromInput(tool.name, tool.input, projectId);
}

export function toolCallSummary(tool: ToolCallView): string {
  if (tool.status === 'error' && tool.summary) {
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
  return '';
}

/** Flattens session messages into chat bubbles (tool_use embedded on assistant rows). */
function resolveUnpairedToolStatus(
  assistant: ChatMessage,
  messages: readonly ChatMessage[],
  agentRunning: boolean,
  runUiStopped: boolean,
): ToolCallStatus {
  if (runUiStopped) {
    return 'error';
  }
  return isTurnToolExecuting(assistant, messages, agentRunning)
    ? 'pending'
    : 'error';
}

export function buildChatListItems(
  messages: readonly ChatMessage[],
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
    // user ops 已拆除：遗留的 user_ops 操作日志附件（非 annotate）不再兼容展示，
    // 直接丢弃——仅保留批注（annotate）与其它来源附件。
    const displayAttachments = (message.attachments ?? []).filter(
      isDisplayableAttachment,
    );
    const hasAttachments = displayAttachments.length > 0;
    const unpairedStatus = hasToolUse
      ? resolveUnpairedToolStatus(message, messages, agentRunning, runUiStopped)
      : undefined;
    const tools = toolUses.map(use => {
      const view = toolCallViewFromUse(use, results, options);
      if (view.status === 'pending' && unpairedStatus != null) {
        return { ...view, status: unpairedStatus };
      }
      return view;
    });

    // 空正文但有 attachments 仍须进列表；否则真实提示词看得到、UI 没有。
    // user_ops 遗留操作日志已丢弃：仅剩 ops 日志的旧消息不再生成空行。
    if (
      textParts.length > 0 ||
      thinkingParts.length > 0 ||
      hasToolUse ||
      hasAttachments
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
    // 与 buildChatListItems 同口径：丢弃 user_ops 遗留操作日志（非 annotate），
    // 仅保留批注与其它来源附件。
    const userAttachments =
      item.message.role === 'user' &&
      (item.message.attachments?.length ?? 0) > 0
        ? item.message
            .attachments!.filter(isDisplayableAttachment)!
            .map(a => ({
              source: a.source,
              type: a.type,
              name: a.name,
              path: a.path ?? a.name,
              ...(a.action != null ? { action: a.action } : {}),
              ...(a.content !== undefined ? { content: a.content } : {}),
            }))
        : undefined;
    rows.push({
      kind: 'message',
      id: item.message.id,
      role: item.message.role === 'user' ? 'user' : 'assistant',
      hidden: item.message.hidden,
      text: decodeLiteralHtmlEntities(item.textParts.join('\n')),
      thinking: decodeLiteralHtmlEntities(item.thinkingParts.join('\n')),
      ...(userAttachments != null ? { attachments: userAttachments } : {}),
      ...(item.tools.length > 0
        ? {
            tools: item.tools.map(t => ({
              toolUseId: t.toolUseId,
              name: t.name,
              input: t.input,
              status: t.status,
              resultContent: t.resultContent,
              ...(t.summary != null ? { summary: t.summary } : {}),
              ...(t.subagentSessionId != null
                ? { subagentSessionId: t.subagentSessionId }
                : {}),
              ...(t.skillRef != null ? { skillRef: t.skillRef } : {}),
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
