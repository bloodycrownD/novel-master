/**
 * Message block parsing and tool_use / tool_result pairing for chat UI.
 */
import {type ChatMessageData, type ContentBlock, type MessageAttachment, type ToolResultBlock, type ToolUseBlock} from '@novel-master/core/chat';
import {resolveToolResultOk} from '@novel-master/core';
import {summarizeToolInput} from '@novel-master/core/chat';

import {skillToolRefResolver, resolveVfsToolFilePath} from '@novel-master/core/chat';
import type {SkillToolRef} from '@novel-master/core/chat';
import type {TranscriptRow} from './ChatTranscriptBridge';
import {decodeLiteralHtmlEntities} from '@/components/rich-content/decode-literal-html-entities';

export interface ToolCallView {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: 'success' | 'error' | 'pending' | 'interrupted';
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

// nm-style: keep-public — 导出函数的返回类型（buildChatListItems / selectTailTranscriptRows），测试直接 import 命名；撤导出会让签名退回匿名类型并破坏测试编译。
export interface ChatListItem {
  readonly kind: 'message';
  readonly message: ChatMessageData;
  readonly textParts: readonly string[];
  /** Model reasoning (`thinking` blocks); shown separately from reply text. */
  readonly thinkingParts: readonly string[];
  /** 有 tool_use 即渲染（无 result 时 runUiStopped 优先 error，否则 agentRunning + isTurnToolExecuting 决定 pending / error）。 */
  readonly tools: readonly ToolCallView[];
}

// nm-style: keep-public — 四个导出函数的参数类型（buildChatListItems / selectTailTranscriptRows / buildTranscriptRows / buildTranscriptRowsWithContext），测试直接 import 命名。
export interface BuildChatListItemsOptions {
  readonly agentRunning?: boolean;
  /** true 当 uiRunning=false（Composer 已停）；与 agentRunning 正交 */
  readonly runUiStopped?: boolean;
  /**
   * pending task 工具的子会话映射：title → childSessionId（执行中即可点击进入）。
   * 命中优先读 task 的 `input.sessionId`（复用场景下唯一可靠来源），title 仅作回退。
   */
  readonly pendingSubagentSessions?: ReadonlyMap<string, string>;
}

function blocksForMessage(message: ChatMessageData): readonly ContentBlock[] {
  return message.content.blocks ?? [];
}

/**
 * user_ops 已拆除：遗留操作日志附件（非 annotate）不再兼容展示，直接丢弃；
 * 批注（annotate）与其它来源附件照常保留。列表与 transcript 共用此口径。
 */
// nm-style: keep-public — 生产同文件两处回调过滤（buildChatListItemsWithContext 的 .some 与 transcriptRowFromItem 的 .filter，脚本不计数回调值引用）；导出仅供测试直接 import，本片禁改测试。
export function isDisplayableAttachment(a: MessageAttachment): boolean {
  return !(a.source === 'user_ops' && a.action !== 'annotate');
}

/** tool_use ids from an assistant message (block order preserved). */
export function toolUseIdsFromMessage(message: ChatMessageData): string[] {
  return blocksForMessage(message)
    .filter((b): b is ToolUseBlock => b.type === 'tool_use')
    .map(b => b.id);
}

/** User row that only carries tool_result blocks (never shown as its own bubble). */
export function messageIsToolResultsOnly(message: ChatMessageData): boolean {
  if (message.role !== 'user') {
    return false;
  }
  const blocks = message.content?.blocks;
  if (blocks == null || blocks.length === 0) {
    return false;
  }
  return blocks.every(block => block.type === 'tool_result');
}

export function messageHasToolUse(message: ChatMessageData): boolean {
  return blocksForMessage(message).some(block => block.type === 'tool_use');
}

/**
 * First user message after assistant whose tool_result ids cover all assistant tool_use ids.
 */
// prettier-ignore
export function resolveToolResultsMessageId(messages: readonly ChatMessageData[], assistant: ChatMessageData): string | undefined {
  const required = new Set(toolUseIdsFromMessage(assistant));
  if (required.size === 0) {
    return undefined;
  }
  for (const message of messages) {
    if (message.seq <= assistant.seq || message.role !== 'user') {
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
// prettier-ignore
export function buildToolResultByUseId(messages: readonly ChatMessageData[]): Map<string, ToolResultBlock> {
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
// prettier-ignore
export function turnToolResultsComplete(assistant: ChatMessageData, messages: readonly ChatMessageData[]): boolean {
  // prettier-ignore
  return turnToolResultsCompleteWith(assistant, buildToolResultByUseId(messages));
}

/** O(1) 判定版本：tool_use id 全部命中预扫 map 即视为本轮工具结果齐备。 */
// prettier-ignore
function turnToolResultsCompleteWith(assistant: ChatMessageData, results: ReadonlyMap<string, ToolResultBlock>): boolean {
  const required = toolUseIdsFromMessage(assistant);
  if (required.length === 0) {
    return true;
  }
  return required.every(id => results.has(id));
}

/**
 * 工具配对预扫上下文（init-busy-yield Step 5 消 O(n²)）：
 * 一次 O(n) 扫描产出全量 messages 的 toolUseId→result map
 * 与「最后一条结果不齐备的 assistant」，供逐消息循环内 O(1) 判定复用，
 * 取代旧实现里每条消息现场重建 map / 全量重扫的写法（语义严格等价）。
 * Step 6 起快照分片构建（sendSessionSnapshotNow）经 buildTranscriptRowsWithContext
 * 复用同一份预扫，逐片行转换共享全量配对上下文。
 */
interface ToolPairingContext {
  readonly results: ReadonlyMap<string, ToolResultBlock>;
  readonly lastIncompleteAssistant: ChatMessageData | undefined;
}

/** 一次 O(n) 扫描构建工具配对上下文（等价旧 lastIncompleteToolAssistant 的全量扫描）。 */
// prettier-ignore
export function buildToolPairingContext(messages: readonly ChatMessageData[]): ToolPairingContext {
  const results = buildToolResultByUseId(messages);
  let lastIncompleteAssistant: ChatMessageData | undefined;
  for (const message of messages) {
    if (
      message.role === 'assistant' &&
      !turnToolResultsCompleteWith(message, results)
    ) {
      lastIncompleteAssistant = message;
    }
  }
  return {results, lastIncompleteAssistant};
}

/** Current turn tool execution: agent running + last assistant with incomplete results. */
// prettier-ignore
export function isTurnToolExecuting(assistant: ChatMessageData, messages: readonly ChatMessageData[], agentRunning: boolean): boolean {
  // prettier-ignore
  return isTurnToolExecutingWith(assistant, buildToolPairingContext(messages), agentRunning);
}

/** O(1) 判定版本：agent 运行中且该消息正是预扫出的最后一条结果不齐备 assistant。 */
// prettier-ignore
function isTurnToolExecutingWith(assistant: ChatMessageData, context: ToolPairingContext, agentRunning: boolean): boolean {
  if (!agentRunning || !messageHasToolUse(assistant)) {
    return false;
  }
  if (turnToolResultsCompleteWith(assistant, context.results)) {
    return false;
  }
  return context.lastIncompleteAssistant?.id === assistant.id;
}

// nm-style: keep-public — 生产单点在本文件 buildChatListItemsWithContext 的 map 回调；导出仅供测试直接 import（5 处）锁契约，本片禁改测试，撤导出会破坏编译。
// prettier-ignore
export function toolCallViewFromUse(use: ToolUseBlock, results: ReadonlyMap<string, ToolResultBlock>, options?: BuildChatListItemsOptions): ToolCallView {
  const result = results.get(use.id);
  if (result == null) {
    const view: ToolCallView = {
      toolUseId: use.id,
      name: use.name,
      input: use.input,
      status: 'pending',
    };
    // pending task 工具：优先读 input.sessionId。复用既有子会话时 core 不发
    // child-created 事件，title 映射里没有它，这是复用场景唯一可靠来源；
    // 新建路径仍回退按 title 匹配 pendingSubagentSessions（执行中也能点进子会话）。
    if (use.name === 'task') {
      // prettier-ignore
      const reused = typeof use.input?.sessionId === 'string' ? use.input.sessionId.trim() : '';
      if (reused) {
        return {...view, subagentSessionId: reused};
      }
      if (options?.pendingSubagentSessions) {
        // prettier-ignore
        const desc = typeof use.input?.description === 'string' ? use.input.description.trim() : '';
        // prettier-ignore
        const prompt = typeof use.input?.prompt === 'string' ? use.input.prompt.trim() : '';
        const title = desc || prompt.slice(0, 40);
        if (title) {
          const childSessionId = options.pendingSubagentSessions.get(title);
          if (childSessionId) {
            return {...view, subagentSessionId: childSessionId};
          }
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
    status: resolveToolResultOk(result) ? 'success' : 'error',
    resultContent: result.content,
    ...(result.summary != null ? {summary: result.summary} : {}),
    ...(typeof subagentSessionId === 'string' && subagentSessionId.length > 0
      ? {subagentSessionId}
      : {}),
    ...(skillRef != null ? {skillRef} : {}),
  };
}

/**
 * 工具入参摘要：单源在 core（`@novel-master/core/chat` 的 `summarizeToolInput`）。
 * 本文件此前持有一份**两个特判都没有**的副本，与 desktop / mobile WebView 行为不一致，
 * 现已全部改为引用 core；新增特判分支请改 core 的 `domain/chat/logic/message/tool-summary.ts`。
 */

/** 工具卡片可打开的逻辑文件路径；不可打开时返回 undefined。 */
export function vfsToolFilePath(tool: ToolCallView): string | undefined {
  return resolveVfsToolFilePath(tool.name, tool.input);
}

/**
 * 解析 skill 卡片的跳转三元组：优先 tool_result meta 透传的 skillRef
 * （read 缺省域命中生效副本的解析结果），否则从 tool_use 输入解析
 * （write/edit 必含；read 缺省域在 pending 时解析不出，返回 undefined）。
 */
// prettier-ignore
export function skillToolRef(tool: ToolCallView, projectId?: string): SkillToolRef | undefined {
  if (tool.skillRef != null) return tool.skillRef;
  return skillToolRefResolver.fromInput(tool.name, tool.input, projectId);
}

export function toolCallSummary(tool: ToolCallView): string {
  if (tool.status === 'error' && tool.summary) {
    // 失败摘要只取首行（搜索链聚合错误等多行诊断全文见工具详情），
    // 超长按与成功摘要同档截断，卡片不被整段报错撑开。
    const firstLine = tool.summary.split('\n')[0]?.trim() ?? '';
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
  return '';
}

/** Flattens session messages into chat bubbles (tool_use embedded on assistant rows). */
// prettier-ignore
export function buildChatListItems(messages: readonly ChatMessageData[], options: BuildChatListItemsOptions = {}): ChatListItem[] {
  // prettier-ignore
  return buildChatListItemsWithContext(messages, buildToolPairingContext(messages), options);
}

/**
 * 基于既有配对上下文构建聊天气泡（预扫一次、循环内只读，消 O(n²)）。
 * selectTailTranscriptRows 以「全量 messages 的上下文 + tail 消息」调用，
 * 保持与全量构建后按 tail id 过滤完全等价。
 */
// prettier-ignore
function buildChatListItemsWithContext(messages: readonly ChatMessageData[], context: ToolPairingContext, options: BuildChatListItemsOptions): ChatListItem[] {
  const agentRunning = options.agentRunning ?? false;
  const runUiStopped = options.runUiStopped ?? false;
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
    // prettier-ignore
    const hasAttachments = (message.attachments ?? []).some(isDisplayableAttachment);
    // 未配对 tool_use 的展示状态：runUiStopped 一律 error；仅「本轮执行消息」保留 pending。
    // prettier-ignore
    const unpairedPending = hasToolUse && !runUiStopped && isTurnToolExecutingWith(message, context, agentRunning);
    const tools = toolUses.map((use): ToolCallView => {
      const view = toolCallViewFromUse(use, context.results, options);
      return view.status === 'pending' && !unpairedPending
        ? {...view, status: 'error'}
        : view;
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

/** 单个聊天气泡 → Web transcript 行（逐 item 独立转换，不依赖跨消息状态）。 */
function transcriptRowFromItem(item: ChatListItem): TranscriptRow {
  // 与 buildChatListItems 同口径：丢弃 user_ops 遗留操作日志（非 annotate），
  // 仅保留批注与其它来源附件。
  // prettier-ignore
  const rawAttachments = item.message.role === 'user' ? item.message.attachments ?? [] : [];
  // prettier-ignore
  const rowAttachments = rawAttachments.filter(isDisplayableAttachment).map(a => ({
    source: a.source,
    type: a.type,
    name: a.name,
    path: a.path ?? a.name,
    // skillAttach 的技能名真源（落库与 name 同值）：显式透传，
    // 避免 path 兜底把技能名伪装成路径的形状错位
    ...(a.skillName != null ? {skillName: a.skillName} : {}),
    ...(a.action != null ? {action: a.action} : {}),
    ...(a.content !== undefined ? {content: a.content} : {}),
  }));
  return {
    kind: 'message',
    id: item.message.id,
    role: item.message.role === 'user' ? 'user' : 'assistant',
    hidden: item.message.hidden,
    text: decodeLiteralHtmlEntities(item.textParts.join('\n')),
    thinking: decodeLiteralHtmlEntities(item.thinkingParts.join('\n')),
    ...(rawAttachments.length > 0 ? {attachments: rowAttachments} : {}),
    ...(item.tools.length > 0
      ? {
          tools: item.tools.map(t => ({
            toolUseId: t.toolUseId,
            name: t.name,
            input: t.input,
            status: t.status,
            resultContent: t.resultContent,
            ...(t.summary != null ? {summary: t.summary} : {}),
            ...(t.subagentSessionId != null ? {subagentSessionId: t.subagentSessionId} : {}),
            ...(t.skillRef != null ? {skillRef: t.skillRef} : {}),
          })),
        }
      : {}),
  };
}

/**
 * tail 行选择：appendTail 必须带全量上下文，否则 tool pending/complete 在多轮
 * 或已配对 hidden tool_result 时会判错——预扫（toolUseId→result map 与
 * lastIncompleteToolAssistant）基于全量 messages 构建，行转换只遍历 tail 消息。
 * 逐消息转换不依赖跨消息状态，故与「全量构建后按 tail id 过滤」语义严格等价，
 * 且省掉了 tail 之前所有消息的整段构建（原实现为全量 build 再 filter）。
 */
// nm-style: keep-public — 生产单点在 ChatConversationWebView（本片禁改），测试直接 import 锁 tail 行构建语义。
// prettier-ignore
export function selectTailTranscriptRows(messages: readonly ChatMessageData[], tail: readonly ChatMessageData[], options: BuildChatListItemsOptions = {}): TranscriptRow[] {
  if (tail.length === 0) {
    return [];
  }
  const context = buildToolPairingContext(messages);
  // prettier-ignore
  return buildChatListItemsWithContext(tail, context, options).map(transcriptRowFromItem);
}

/**
 * Maps session messages to Web transcript rows (seq ascending, forward DOM order).
 *
 * 流式正文不再是本函数的第二条数据面（spec C10）：流式行由宿主
 * `buildStreamingTranscriptRow` 生成、快照末片携带，本函数只产出 DB 历史行。
 */
// nm-style: keep-public — 生产单点在 ChatConversationWebView（本片禁改），测试直接 import 锁全量行构建。
// prettier-ignore
export function buildTranscriptRows(messages: readonly ChatMessageData[], options: BuildChatListItemsOptions = {}): TranscriptRow[] {
  return buildChatListItems(messages, options).map(transcriptRowFromItem);
}

/**
 * 基于既有配对上下文构建消息片段的 transcript rows（init-busy-yield Step 6
 * 快照分片）：行转换逐消息独立、不依赖跨消息状态，故「按片调用本函数后
 * 顺序拼接」与单次全量 buildTranscriptRows 输出全等——流式行由宿主另行
 * 生成（spec C10），本函数只处理 DB 消息。
 */
// prettier-ignore
export function buildTranscriptRowsWithContext(messages: readonly ChatMessageData[], context: ToolPairingContext, options: BuildChatListItemsOptions = {}): TranscriptRow[] {
  // prettier-ignore
  return buildChatListItemsWithContext(messages, context, options).map(transcriptRowFromItem);
}
