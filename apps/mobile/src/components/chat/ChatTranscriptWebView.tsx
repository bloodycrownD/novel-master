/**
 * RN WebView wrapper for chat transcript — postMessage both directions via bridge envelopes.
 */
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {Linking, StyleSheet, View} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
// 根入口 index.d.ts 未 re-export 此类型，只能从 lib/WebViewTypes 深导入；
// import type 会被擦除，不影响运行时打包。
import type {WebViewOpenWindowEvent} from 'react-native-webview/lib/WebViewTypes';
import {type ChatMessage} from '@novel-master/core/chat';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  encodeHostToTranscript,
  decodeTranscriptToHost,
  parseScrollSnapshotFromHost,
  type ChatTranscriptScrollSnapshot,
  type HostToTranscriptMessage,
  type TranscriptFlags,
  type TranscriptRestoreScroll,
  type TranscriptRow,
  type TranscriptScrollIntent,
  type TranscriptSkillRef,
  type TranscriptTheme,
} from './ChatTranscriptBridge';
import {enrichTranscriptRows} from './enrich-transcript-rows';

/** 会改变 WebView 画面的宿主消息类型；用于「隐藏期间脏推送」计数。 */
const STATE_PAINTING_HOST_MESSAGES: ReadonlySet<string> = new Set([
  'sessionSnapshot',
  'prependPage',
  'appendTailRows',
  'streamDelta',
  'streamBatch',
  'streamCommit',
  'streamReset',
  'streamToolInvoking',
  'flagsUpdate',
]);
import {
  buildTranscriptRows,
  messageHasToolUse,
  messageIsToolResultsOnly,
  selectTailTranscriptRows,
} from './message-blocks';
import {
  getChatTranscriptPackageDirUri,
  getChatTranscriptUri,
} from '@/webview-host/chat-transcript/uri';
import {emitChatTranscriptTelemetry} from '@/services/chat-transcript-telemetry';
import {useTheme} from '@/theme/ThemeProvider';
import {prepareStreamTailHtml} from './prepare-stream-tail-html';
import type {StreamWireChunk} from '@/services/stream-wire-queue';
import {appendWireChunk} from '@/services/stream-wire-queue';
import {decodeLiteralHtmlEntities} from '@/components/rich-content/decode-literal-html-entities';
import {CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS} from './chat-transcript-selection-menu';

export {CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS} from './chat-transcript-selection-menu';

export type ChatTranscriptWebViewHandle = {
  pushStreamDelta: (kind: 'text' | 'thinking', delta: string) => void;
  pushStreamBatch: (payload: {segments: readonly StreamWireChunk[]}) => void;
  resetStream: () => void;
  /** 流式结束：单次 DOM 提交落库行并清 stream tail（纯文本 assistant）。成功返回 true。 */
  tryCommitStreamTail: (
    allMessages: readonly ChatMessage[],
    prevCount: number,
  ) => boolean;
  /** abort 极早 stop：将 overlay stream tail 固化为 assistant 行（不含 tools）。无 tail 则 skip。 */
  commitAbortOverlaySnapshot: () => boolean;
};

export type ChatTranscriptWebViewProps = {
  readonly sessionKey: string;
  readonly messages: readonly ChatMessage[];
  readonly streamingText?: string;
  readonly streamingThinking?: string;
  readonly hasMore?: boolean;
  readonly flags?: Partial<TranscriptFlags>;
  readonly initialScroll?: ChatTranscriptScrollSnapshot | null;
  /** No cached snapshot: open pinned to bottom. */
  readonly defaultScrollToBottom?: boolean;
  readonly agentRunning?: boolean;
  /** 菜单禁用与流式快照推迟；未传时回退 agentRunning。 */
  readonly uiRunning?: boolean;
  readonly toolInvoking?: boolean;
  readonly menuCloseSignal?: number;
  /** 递增时下发 closeMermaidViewer（Android 返回键先关全屏；照 menuCloseSignal 先例）。 */
  readonly mermaidViewerCloseSignal?: number;
  /**
   * Bumped when Android IME lifts the composer; web stick-if-near-bottom so
   * the last messages stay above the input after the viewport shrinks.
   */
  readonly keyboardLiftNonce?: number;
  readonly onScrollSnapshot?: (snap: ChatTranscriptScrollSnapshot) => void;
  readonly onReady?: () => void;
  readonly onLoadOlder?: () => void;
  readonly onOpenToolFile?: (path: string) => void;
  /** 点击 task 工具卡片跳转子会话只读浏览（webview web app 发 openSubagentSession）。 */
  readonly onOpenSubagentSession?: (sessionId: string) => void;
  /** 点击 skill 卡片跳技能详情（webview web app 发 openSkillDetail；project 域缺 projectId 时由调用方补齐）。 */
  readonly onOpenSkillDetail?: (ref: TranscriptSkillRef) => void;
  readonly onOpenMessageMenu?: (
    messageId: string,
    pageX: number,
    pageY: number,
  ) => void;
  readonly onMessageMenuAction?: (messageId: string, action: string) => void;
  readonly onWebMenuOpenChange?: (open: boolean) => void;
  /** mermaid 全屏查看器开/关上浮（照 menuOpened→onWebMenuOpenChange 先例；RN 侧据此拦返回键）。 */
  readonly onWebMermaidViewerOpenChange?: (open: boolean) => void;
  /** pending task 工具的子会话映射（title → childSessionId），让执行中的 task 卡片可点击。 */
  readonly pendingSubagentSessions?: ReadonlyMap<string, string>;
};

function transcriptFlagsEqual(
  a: Partial<TranscriptFlags> | undefined,
  b: Partial<TranscriptFlags> | undefined,
): boolean {
  return (
    (a?.richText ?? false) === (b?.richText ?? false) &&
    (a?.menuDisabled ?? false) === (b?.menuDisabled ?? false)
  );
}

function chatTranscriptWebViewPropsEqual(
  prev: ChatTranscriptWebViewProps,
  next: ChatTranscriptWebViewProps,
): boolean {
  return (
    prev.sessionKey === next.sessionKey &&
    prev.messages === next.messages &&
    prev.streamingText === next.streamingText &&
    prev.streamingThinking === next.streamingThinking &&
    prev.hasMore === next.hasMore &&
    prev.agentRunning === next.agentRunning &&
    (prev.uiRunning ?? prev.agentRunning) ===
      (next.uiRunning ?? next.agentRunning) &&
    prev.toolInvoking === next.toolInvoking &&
    prev.defaultScrollToBottom === next.defaultScrollToBottom &&
    prev.menuCloseSignal === next.menuCloseSignal &&
    prev.mermaidViewerCloseSignal === next.mermaidViewerCloseSignal &&
    prev.keyboardLiftNonce === next.keyboardLiftNonce &&
    prev.initialScroll === next.initialScroll &&
    transcriptFlagsEqual(prev.flags, next.flags) &&
    prev.pendingSubagentSessions === next.pendingSubagentSessions
  );
}

function themeFromTokens(tokens: {
  background: string;
  text: string;
  textSecondary: string;
  primary: string;
  danger: string;
  surface: string;
  borderLight: string;
}): TranscriptTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    danger: tokens.danger,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
}

function resolveOpenScrollIntent(
  initialScroll: ChatTranscriptScrollSnapshot | null,
  defaultScrollToBottom: boolean,
): {intent: TranscriptScrollIntent; restoreScroll?: TranscriptRestoreScroll} {
  if (defaultScrollToBottom) {
    return {intent: 'stick'};
  }
  if (initialScroll == null) {
    return {intent: 'stick'};
  }
  if (initialScroll.nearBottom) {
    return {intent: 'stick'};
  }
  return {
    intent: 'restore',
    restoreScroll: {
      offsetY: initialScroll.offsetY,
      nearBottom: initialScroll.nearBottom,
    },
  };
}

function emitScrollRestoreTelemetry(
  intent: TranscriptScrollIntent,
  restoreScroll?: TranscriptRestoreScroll,
): void {
  if (intent === 'restore' && restoreScroll != null) {
    emitChatTranscriptTelemetry({
      name: 'scroll_restore',
      mode: restoreScroll.nearBottom ? 'near_bottom' : 'offset',
      offsetY: restoreScroll.offsetY,
      nearBottom: restoreScroll.nearBottom,
    });
    return;
  }
  if (intent === 'stick') {
    emitChatTranscriptTelemetry({
      name: 'scroll_restore',
      mode: 'stick',
    });
  }
}

/** streamCommit 已同步的行，跳过 messages effect 重复 snapshot/append。 */
function shouldSkipSnapshotAfterStreamCommit(
  messages: readonly ChatMessage[],
  prevCount: number,
  committedIds: readonly string[],
): boolean {
  if (committedIds.length === 0 || messages.length <= prevCount) {
    return false;
  }
  const addedIds = messages.slice(prevCount).map(message => message.id);
  return addedIds.length > 0 && addedIds.every(id => committedIds.includes(id));
}

export const ChatTranscriptWebView = memo(
  forwardRef<ChatTranscriptWebViewHandle, ChatTranscriptWebViewProps>(
    function ChatTranscriptWebView(
      {
        sessionKey,
        messages,
        streamingText = '',
        streamingThinking = '',
        hasMore = false,
        flags,
        initialScroll = null,
        defaultScrollToBottom = true,
        agentRunning = false,
        uiRunning: uiRunningProp,
        toolInvoking = false,
        menuCloseSignal = 0,
        mermaidViewerCloseSignal = 0,
        keyboardLiftNonce = 0,
        onScrollSnapshot,
        onReady,
        onLoadOlder,
        onOpenToolFile,
        onOpenSubagentSession,
        onOpenSkillDetail,
        onOpenMessageMenu,
        onMessageMenuAction,
        onWebMenuOpenChange,
        onWebMermaidViewerOpenChange,
        pendingSubagentSessions,
      },
      ref,
    ) {
      const uiRunning = uiRunningProp ?? agentRunning;
      const streamGenerating = uiRunning || toolInvoking;
      const transcriptListOptions = {
        agentRunning,
        runUiStopped: !uiRunning,
        pendingSubagentSessions,
      };
      const {tokens} = useTheme();
      const webRef = useRef<WebView>(null);
      const [webReady, setWebReady] = useState(false);
      // Android WebView 恢复显示后可能仍渲染摘除前的旧帧（子会话压栈期间主会话
      // 跑完、退出后【生成中】残留的根因：屏幕上的是旧帧而非当前 DOM）。
      // 恢复可见时若隐藏期间发生过改画推送，强制重挂 WebView；ready 后
      // webReady effect 会自动重发快照，流式部分由 resume 注入链补齐。
      const [repaintEpoch, setRepaintEpoch] = useState(0);
      // 可见性重挂后 WebView 是空基线：ready 后的首个快照必须直发（force 绕过
      // uiRunning+streamActive 的 defer）。否则快照 pending 到流式结束，恢复注入
      // 只补当前 partial，页面只剩当前 assistant 消息在流（v1.5.9 回归）。
      const forceSnapshotOnReadyRef = useRef(false);
      const statePushSinceResumeRef = useRef(0);
      const prevStreamTextRef = useRef('');
      const prevStreamThinkingRef = useRef('');
      const sessionKeyRef = useRef(sessionKey);
      const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
      const prevMessageCountRef = useRef(0);
      const prevRichTextRef = useRef(flags?.richText ?? false);
      const prevMessagesRef = useRef(messages);
      const prevSentFlagsRef = useRef<TranscriptFlags | null>(null);
      const lastScrollRef = useRef({nearBottom: true, offsetY: 0});
      const initialScrollRef = useRef(initialScroll);
      const defaultScrollToBottomRef = useRef(defaultScrollToBottom);
      const needsOpenSnapshotRef = useRef(true);
      const snapshotDeferTimerRef = useRef<ReturnType<
        typeof setTimeout
      > | null>(null);
      const pendingSnapshotRef = useRef<{
        intent: TranscriptScrollIntent;
        restoreScroll?: TranscriptRestoreScroll;
      } | null>(null);
      const streamRafRef = useRef<number | null>(null);
      /** batch-off 回滚路径：按到达序排队，RAF 内逐条 post streamDelta（禁止 text/thinking 分区重排）。 */
      const pendingStreamDeltaSegmentsRef = useRef<StreamWireChunk[]>([]);
      const pendingStreamSegmentsRef = useRef<StreamWireChunk[]>([]);
      const streamTextAccumRef = useRef('');
      const streamThinkingAccumRef = useRef('');
      const richTextRef = useRef(flags?.richText ?? false);
      const streamActiveRef = useRef(false);
      /** streamCommit 已写入的行 id，用于 messages effect 去重 snapshot。 */
      const lastStreamCommitIdsRef = useRef<readonly string[]>([]);

      const clearLocalStreamBuffers = useCallback(() => {
        if (streamRafRef.current != null) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        pendingStreamDeltaSegmentsRef.current = [];
        pendingStreamSegmentsRef.current = [];
        streamTextAccumRef.current = '';
        streamThinkingAccumRef.current = '';
        prevStreamTextRef.current = '';
        prevStreamThinkingRef.current = '';
      }, []);

      useEffect(() => {
        richTextRef.current = flags?.richText ?? false;
      }, [flags?.richText]);

      useEffect(() => {
        initialScrollRef.current = initialScroll;
      }, [initialScroll]);

      useEffect(() => {
        defaultScrollToBottomRef.current = defaultScrollToBottom;
      }, [defaultScrollToBottom]);

      const postToWeb = useCallback((message: HostToTranscriptMessage) => {
        if (STATE_PAINTING_HOST_MESSAGES.has(message.type)) {
          statePushSinceResumeRef.current += 1;
        }
        webRef.current?.postMessage(encodeHostToTranscript(message));
      }, []);

      const syncStreamToolInvoking = useCallback(() => {
        if (!webReady) {
          return;
        }
        postToWeb({
          v: 1,
          type: 'streamToolInvoking',
          payload: {active: streamGenerating},
        });
      }, [webReady, streamGenerating, postToWeb]);

      const flushPendingStreamDeltas = useCallback(() => {
        if (streamRafRef.current != null) {
          return;
        }
        streamRafRef.current = requestAnimationFrame(() => {
          streamRafRef.current = null;
          const segments = pendingStreamDeltaSegmentsRef.current;
          if (segments.length === 0) {
            return;
          }
          pendingStreamDeltaSegmentsRef.current = [];
          // WHY（中文）：
          // - spec 要求 RN 保留 `prepareStreamTailHtml` 产物并透传 `payload.html`。
          // - Web 侧在 richText 开启时会优先用 html 走 `innerHTML` 路径，以保证 text/thinking 的流式 rich 行为一致。
          const richText = richTextRef.current;
          const textHtml = prepareStreamTailHtml(
            streamTextAccumRef.current,
            richText,
          );
          const thinkingHtml = prepareStreamTailHtml(
            streamThinkingAccumRef.current,
            richText,
          );

          for (const seg of segments) {
            postToWeb({
              v: 1,
              type: 'streamDelta',
              payload: {
                kind: seg.kind,
                delta: seg.delta,
                html: seg.kind === 'text' ? textHtml : thinkingHtml,
              },
            });
          }
        });
      }, [postToWeb]);

      const flushPendingStreamBatch = useCallback(() => {
        if (streamRafRef.current != null) {
          return;
        }
        streamRafRef.current = requestAnimationFrame(() => {
          streamRafRef.current = null;
          const segments = pendingStreamSegmentsRef.current;
          if (segments.length === 0) {
            return;
          }
          pendingStreamSegmentsRef.current = [];
          for (const seg of segments) {
            if (seg.kind === 'text') {
              streamTextAccumRef.current += seg.delta;
            } else {
              streamThinkingAccumRef.current += seg.delta;
            }
          }
          const richText = richTextRef.current;
          const textHtml = prepareStreamTailHtml(
            streamTextAccumRef.current,
            richText,
          );
          const thinkingHtml = prepareStreamTailHtml(
            streamThinkingAccumRef.current,
            richText,
          );
          postToWeb({
            v: 1,
            type: 'streamBatch',
            payload: {
              segments: segments.map(seg => ({
                kind: seg.kind,
                delta: seg.delta,
              })),
              textHtml,
              thinkingHtml,
            },
          });
        });
      }, [postToWeb]);

      const queueStreamDelta = useCallback(
        (kind: 'text' | 'thinking', delta: string) => {
          if (!webReady || delta.length === 0) {
            return;
          }
          streamActiveRef.current = true;
          if (kind === 'text') {
            streamTextAccumRef.current += delta;
          } else {
            streamThinkingAccumRef.current += delta;
          }
          appendWireChunk(pendingStreamDeltaSegmentsRef.current, {
            kind,
            delta,
          });
          flushPendingStreamDeltas();
        },
        [webReady, flushPendingStreamDeltas],
      );

      const queueStreamBatch = useCallback(
        (payload: {segments: readonly StreamWireChunk[]}) => {
          if (!webReady || payload.segments.length === 0) {
            return;
          }
          streamActiveRef.current = true;
          for (const seg of payload.segments) {
            if (seg.delta.length === 0) {
              continue;
            }
            appendWireChunk(pendingStreamSegmentsRef.current, seg);
          }
          flushPendingStreamBatch();
        },
        [webReady, flushPendingStreamBatch],
      );

      const sendInit = useCallback(() => {
        const resolvedFlags: TranscriptFlags = {
          richText: flags?.richText ?? false,
          menuDisabled: uiRunning,
        };
        postToWeb({
          v: 1,
          type: 'init',
          payload: {theme: themeFromTokens(tokens), flags: resolvedFlags},
        });
      }, [flags?.richText, postToWeb, tokens, uiRunning]);

      // C1: sessionSnapshot must not depend on streamingText/streamingThinking — stream tail only via streamDelta.
      const sendSessionSnapshotNow = useCallback(
        (
          scrollIntent: TranscriptScrollIntent,
          restoreScroll?: TranscriptRestoreScroll,
        ) => {
          const richText = flags?.richText ?? false;
          const rows = enrichTranscriptRows(
            buildTranscriptRows(messages, undefined, transcriptListOptions),
            richText,
          );
          postToWeb({
            v: 1,
            type: 'sessionSnapshot',
            payload: {
              sessionKey,
              rows,
              hasMore,
              scrollIntent,
              ...(uiRunning ? {generating: true} : {}),
              ...(scrollIntent === 'restore' && restoreScroll != null
                ? {restoreScroll}
                : {}),
            },
          });
          syncStreamToolInvoking();
        },
        [
          messages,
          hasMore,
          postToWeb,
          sessionKey,
          flags?.richText,
          agentRunning,
          uiRunning,
          syncStreamToolInvoking,
          transcriptListOptions,
        ],
      );

      const flushPendingSnapshot = useCallback(() => {
        if (snapshotDeferTimerRef.current != null) {
          clearTimeout(snapshotDeferTimerRef.current);
          snapshotDeferTimerRef.current = null;
        }
        const pending = pendingSnapshotRef.current;
        pendingSnapshotRef.current = null;
        if (pending != null) {
          sendSessionSnapshotNow(pending.intent, pending.restoreScroll);
        }
      }, [sendSessionSnapshotNow]);

      const sendSessionSnapshot = useCallback(
        (
          intent: TranscriptScrollIntent,
          restoreScroll?: TranscriptRestoreScroll,
          force?: boolean,
        ) => {
          if (force) {
            // D4：force 直发——消费 pending（沿用其 intent/restoreScroll）、
            // 取消 defer timer、绕过 streamActiveRef 拦截，且不再设置新的 defer timer。
            // needsFullSnapshot 场景下快照必须先于后续 streamDelta 到达，
            // 否则 web 端会先渲染旧基线再被快照回跳。
            if (snapshotDeferTimerRef.current != null) {
              clearTimeout(snapshotDeferTimerRef.current);
              snapshotDeferTimerRef.current = null;
            }
            const pending = pendingSnapshotRef.current;
            pendingSnapshotRef.current = null;
            sendSessionSnapshotNow(
              pending?.intent ?? intent,
              pending?.restoreScroll ?? restoreScroll,
            );
            return;
          }
          if (!uiRunning) {
            sendSessionSnapshotNow(intent, restoreScroll);
            return;
          }
          pendingSnapshotRef.current = {intent, restoreScroll};
          if (streamActiveRef.current) {
            return;
          }
          if (snapshotDeferTimerRef.current != null) {
            return;
          }
          snapshotDeferTimerRef.current = setTimeout(() => {
            snapshotDeferTimerRef.current = null;
            if (streamActiveRef.current) {
              return;
            }
            const pending = pendingSnapshotRef.current;
            pendingSnapshotRef.current = null;
            if (pending != null) {
              sendSessionSnapshotNow(pending.intent, pending.restoreScroll);
            }
          }, 0);
        },
        [uiRunning, sendSessionSnapshotNow],
      );

      // sendSessionSnapshot 的闭包身份随渲染变化（内部挂着每次渲染重建的
      // transcriptListOptions 与 messages）。pendingSubagentSessions 快照重发
      // 只应由映射本身的变化触发，否则任何无关重渲染（如 streamingText 更新）
      // 都会多发一次全量 sessionSnapshot——用 ref 取最新实现，依赖里只留映射。
      const sendSessionSnapshotRef = useRef(sendSessionSnapshot);
      useEffect(() => {
        sendSessionSnapshotRef.current = sendSessionSnapshot;
      });

      const sendAppendTailRows = useCallback(
        (tailMessages: readonly ChatMessage[]) => {
          if (tailMessages.length === 0) {
            return;
          }
          const richText = flags?.richText ?? false;
          const rows = enrichTranscriptRows(
            selectTailTranscriptRows(
              messages,
              tailMessages,
              transcriptListOptions,
            ),
            richText,
          );
          if (rows.length === 0) {
            return;
          }
          postToWeb({
            v: 1,
            type: 'appendTailRows',
            payload: {rows},
          });
        },
        [
          postToWeb,
          flags?.richText,
          agentRunning,
          messages,
          transcriptListOptions,
        ],
      );

      const commitStreamTail = useCallback(
        (
          rows: readonly TranscriptRow[],
          scrollIntent: 'preserve' | 'none' = 'preserve',
        ) => {
          if (!webReady || rows.length === 0) {
            return;
          }
          clearLocalStreamBuffers();
          streamActiveRef.current = false;
          pendingSnapshotRef.current = null;
          if (snapshotDeferTimerRef.current != null) {
            clearTimeout(snapshotDeferTimerRef.current);
            snapshotDeferTimerRef.current = null;
          }
          lastStreamCommitIdsRef.current = rows
            .filter(row => row.kind === 'message')
            .map(row => row.id);
          postToWeb({
            v: 1,
            type: 'streamCommit',
            payload: {rows, scrollIntent},
          });
          syncStreamToolInvoking();
        },
        [webReady, postToWeb, clearLocalStreamBuffers, syncStreamToolInvoking],
      );

      const tryCommitStreamTail = useCallback(
        (allMessages: readonly ChatMessage[], prevCount: number): boolean => {
          if (!webReady) {
            return false;
          }
          const added = allMessages.slice(prevCount);
          if (added.length === 0) {
            return false;
          }
          const addedIds = added.map(message => message.id);
          if (
            addedIds.every(id => lastStreamCommitIdsRef.current.includes(id))
          ) {
            return true;
          }
          const needsFullSnapshot =
            added.some(messageIsToolResultsOnly) ||
            added.some(
              message =>
                message.role === 'assistant' && messageHasToolUse(message),
            );
          if (needsFullSnapshot) {
            return false;
          }
          const richText = flags?.richText ?? false;
          const rows = enrichTranscriptRows(
            selectTailTranscriptRows(allMessages, added, transcriptListOptions),
            richText,
          );
          if (rows.length === 0) {
            return false;
          }
          commitStreamTail(rows, 'preserve');
          prevMessagesRef.current = allMessages;
          prevMessageCountRef.current = allMessages.length;
          prevFirstMessageIdRef.current = allMessages[0]?.id;
          return true;
        },
        [
          webReady,
          flags?.richText,
          agentRunning,
          commitStreamTail,
          transcriptListOptions,
        ],
      );

      const commitAbortOverlaySnapshot = useCallback((): boolean => {
        if (!webReady) {
          return false;
        }
        const text = streamTextAccumRef.current;
        const thinking = streamThinkingAccumRef.current;
        if (text.length === 0 && thinking.length === 0) {
          return false;
        }
        if (!streamActiveRef.current) {
          return false;
        }
        const richText = flags?.richText ?? false;
        const rows = enrichTranscriptRows(
          [
            {
              kind: 'message',
              id: `abort-overlay-${Date.now()}`,
              role: 'assistant',
              hidden: false,
              text: decodeLiteralHtmlEntities(text),
              thinking: decodeLiteralHtmlEntities(thinking),
            },
          ],
          richText,
        );
        commitStreamTail(rows, 'preserve');
        return true;
      }, [webReady, flags?.richText, commitStreamTail]);

      const resetStreamTail = useCallback(() => {
        clearLocalStreamBuffers();
        const wasActive = streamActiveRef.current;
        streamActiveRef.current = false;
        if (webReady && wasActive) {
          postToWeb({v: 1, type: 'streamReset', payload: {}});
          flushPendingSnapshot();
          syncStreamToolInvoking();
        }
      }, [
        webReady,
        postToWeb,
        flushPendingSnapshot,
        clearLocalStreamBuffers,
        syncStreamToolInvoking,
      ]);

      useImperativeHandle(
        ref,
        () => ({
          pushStreamDelta: queueStreamDelta,
          pushStreamBatch: queueStreamBatch,
          resetStream: resetStreamTail,
          tryCommitStreamTail,
          commitAbortOverlaySnapshot,
        }),
        [
          queueStreamDelta,
          queueStreamBatch,
          resetStreamTail,
          tryCommitStreamTail,
          commitAbortOverlaySnapshot,
        ],
      );

      const sendPrependPage = useCallback(
        (prependedCount: number) => {
          const richText = flags?.richText ?? false;
          const olderMessages = messages.slice(0, prependedCount);
          postToWeb({
            v: 1,
            type: 'prependPage',
            payload: {
              rows: enrichTranscriptRows(
                buildTranscriptRows(
                  olderMessages,
                  undefined,
                  transcriptListOptions,
                ),
                richText,
              ),
              prependedCount,
            },
          });
        },
        [
          messages,
          postToWeb,
          flags?.richText,
          agentRunning,
          transcriptListOptions,
        ],
      );

      const handleMessage = useCallback(
        (event: WebViewMessageEvent) => {
          const raw = event.nativeEvent.data;
          let message;
          try {
            message = decodeTranscriptToHost(raw);
          } catch {
            return;
          }
          if (message.type === 'copyCode') {
            // 代码块复制按钮：webview 收集源码文本，RN 侧原生剪贴板落盘
            const code = String(message.payload.code ?? '');
            if (code) {
              Clipboard.setString(code);
            }
            return;
          }
          if (message.type === 'ready') {
            setWebReady(true);
            onReady?.();
            // WebView 被系统回收重建后，webview 侧全屏层已不存在；对称复位
            // 上浮给外层的全屏开合状态，避免外层返回键拦截态关真。
            onWebMermaidViewerOpenChange?.(false);
            return;
          }
          if (message.type === 'scrollSnapshot') {
            const snap = parseScrollSnapshotFromHost(message);
            if (snap) {
              lastScrollRef.current = {
                nearBottom: snap.nearBottom,
                offsetY: snap.offsetY,
              };
              onScrollSnapshot?.(snap);
            }
            return;
          }
          if (message.type === 'loadOlder') {
            onLoadOlder?.();
            return;
          }
          if (message.type === 'openToolFile') {
            onOpenToolFile?.(message.payload.path);
            return;
          }
          if (message.type === 'openSubagentSession') {
            onOpenSubagentSession?.(message.payload.sessionId);
            return;
          }
          if (message.type === 'openSkillDetail') {
            onOpenSkillDetail?.({
              domain: message.payload.domain,
              name: message.payload.name,
              ...(message.payload.projectId != null
                ? {projectId: message.payload.projectId}
                : {}),
            });
            return;
          }
          if (message.type === 'openMessageMenu') {
            if (uiRunning) {
              return;
            }
            emitChatTranscriptTelemetry({name: 'menu_open'});
            onOpenMessageMenu?.(
              message.payload.messageId,
              message.payload.pageX,
              message.payload.pageY,
            );
            return;
          }
          if (message.type === 'messageMenuAction') {
            onMessageMenuAction?.(
              message.payload.messageId,
              message.payload.action,
            );
            return;
          }
          if (message.type === 'menuOpened') {
            onWebMenuOpenChange?.(true);
            return;
          }
          if (message.type === 'menuClosed') {
            onWebMenuOpenChange?.(false);
            return;
          }
          if (message.type === 'mermaidViewerOpened') {
            onWebMermaidViewerOpenChange?.(true);
            return;
          }
          if (message.type === 'mermaidViewerClosed') {
            onWebMermaidViewerOpenChange?.(false);
            return;
          }
          // WebView 恢复可见：若隐藏期间有改画推送（旧帧风险），强制重挂重绘。
          if (message.type === 'visibility') {
            if (!message.payload.hidden) {
              const dirty = statePushSinceResumeRef.current > 0;
              statePushSinceResumeRef.current = 0;
              if (dirty) {
                prevStreamTextRef.current = '';
                prevStreamThinkingRef.current = '';
                forceSnapshotOnReadyRef.current = true;
                setWebReady(false);
                setRepaintEpoch(epoch => epoch + 1);
              }
            }
            return;
          }
        },
        [
          onReady,
          onScrollSnapshot,
          onLoadOlder,
          onOpenToolFile,
          onOpenSubagentSession,
          onOpenSkillDetail,
          onOpenMessageMenu,
          onMessageMenuAction,
          onWebMenuOpenChange,
          onWebMermaidViewerOpenChange,
          uiRunning,
        ],
      );

      const handleCustomMenuSelection = useCallback(
        (event: {nativeEvent: {key?: string; selectedText?: string}}) => {
          if (uiRunning) {
            return;
          }
          const key = String(event.nativeEvent.key ?? '');
          const selectedText = String(event.nativeEvent.selectedText ?? '')
            .replace(/\u00a0/g, ' ')
            .trim();
          // 仅复制；消息批注入口已移除
          if (key === 'copy' && selectedText) {
            Clipboard.setString(selectedText);
          }
        },
        [uiRunning],
      );

      useEffect(() => {
        if (!webReady) {
          return;
        }
        sendInit();
      }, [webReady, sendInit]);

      useEffect(() => {
        if (!webReady) {
          return;
        }
        const resolvedFlags: TranscriptFlags = {
          richText: flags?.richText ?? false,
          menuDisabled: uiRunning,
        };
        const prev = prevSentFlagsRef.current;
        if (
          prev != null &&
          prev.richText === resolvedFlags.richText &&
          prev.menuDisabled === resolvedFlags.menuDisabled
        ) {
          return;
        }
        prevSentFlagsRef.current = resolvedFlags;
        postToWeb({
          v: 1,
          type: 'flagsUpdate',
          payload: {flags: resolvedFlags},
        });
      }, [webReady, flags?.richText, uiRunning, postToWeb]);

      useEffect(() => {
        if (!webReady) {
          return;
        }
        postToWeb({
          v: 1,
          type: 'themeUpdate',
          payload: {theme: themeFromTokens(tokens)},
        });
      }, [webReady, tokens, postToWeb]);

      useEffect(() => {
        if (!webReady || menuCloseSignal === 0) {
          return;
        }
        postToWeb({v: 1, type: 'closeMenu', payload: {}});
      }, [webReady, menuCloseSignal, postToWeb]);

      useEffect(() => {
        if (!webReady || mermaidViewerCloseSignal === 0) {
          return;
        }
        postToWeb({v: 1, type: 'closeMermaidViewer', payload: {}});
      }, [webReady, mermaidViewerCloseSignal, postToWeb]);

      useEffect(() => {
        if (!webReady || keyboardLiftNonce === 0) {
          return;
        }
        postToWeb({v: 1, type: 'stickIfNearBottom', payload: {}});
      }, [webReady, keyboardLiftNonce, postToWeb]);

      useEffect(() => {
        syncStreamToolInvoking();
      }, [syncStreamToolInvoking, toolInvoking]);

      useEffect(() => {
        if (!webReady) {
          return;
        }
        const richText = flags?.richText ?? false;
        if (prevRichTextRef.current === richText) {
          return;
        }
        prevRichTextRef.current = richText;
        sendSessionSnapshot('preserve');
      }, [webReady, flags?.richText, sendSessionSnapshot]);

      // pendingSubagentSessions 变化时（task 工具创建子会话事件到达），
      // 重发 snapshot 让 pending task 卡片立即获得 subagentSessionId 可点击。
      // 注意经 ref 调用：不能把 sendSessionSnapshot 放进依赖（闭包身份不稳定，
      // 会退化成每次重渲染都发全量快照）。
      useEffect(() => {
        if (!webReady) {
          return;
        }
        // 重挂路径的 ready：空基线快照直发，绕过 defer（见 forceSnapshotOnReadyRef）。
        const forceAfterRepaint = forceSnapshotOnReadyRef.current;
        forceSnapshotOnReadyRef.current = false;
        sendSessionSnapshotRef.current(
          'preserve',
          undefined,
          forceAfterRepaint,
        );
      }, [webReady, pendingSubagentSessions]);

      useEffect(() => {
        if (!webReady) {
          return;
        }
        if (sessionKeyRef.current !== sessionKey) {
          sessionKeyRef.current = sessionKey;
          prevStreamTextRef.current = '';
          prevStreamThinkingRef.current = '';
          prevFirstMessageIdRef.current = undefined;
          prevMessageCountRef.current = 0;
          needsOpenSnapshotRef.current = true;
        }

        if (needsOpenSnapshotRef.current) {
          if (messages.length === 0) {
            return;
          }
          needsOpenSnapshotRef.current = false;
          const {intent, restoreScroll} = resolveOpenScrollIntent(
            initialScrollRef.current,
            defaultScrollToBottomRef.current,
          );
          // needsOpenSnapshot 建立 WebView rows 基线，必须立即送达——
          // 不能走 sendSessionSnapshot 的 deferred 路径（uiRunning+streamActive
          // 时会 pending 到流式结束，导致子会话进入时 user 消息不可见）。
          sendSessionSnapshotNow(intent, restoreScroll);
          emitScrollRestoreTelemetry(intent, restoreScroll);
          emitChatTranscriptTelemetry({
            name: 'transcript_ready',
            sessionKey,
            rowCount: messages.length,
            hasInitialScroll: initialScrollRef.current != null,
            defaultScrollToBottom: defaultScrollToBottomRef.current,
          });
          prevFirstMessageIdRef.current = messages[0]?.id;
          prevMessageCountRef.current = messages.length;
          prevMessagesRef.current = messages;
          return;
        }

        if (prevMessagesRef.current === messages) {
          return;
        }

        const firstId = messages[0]?.id;
        const prevFirstId = prevFirstMessageIdRef.current;
        const prevCount = prevMessageCountRef.current;
        const grew = messages.length > prevCount;
        const prependedOlder =
          grew &&
          prevFirstId != null &&
          firstId != null &&
          firstId !== prevFirstId;

        // 压缩/置位后消息数量和首条 ID 不变，但 hidden 字段变了。
        // 前面的分支（grew/streamCommit/uiRunning）都不命中，会走到 else sendSessionSnapshot，
        // 但 L976 的 streamCommit 分支可能在 lastStreamCommitIdsRef 非空时提前拦截。
        // 这里在分流前检测 hidden 变化，确保走 sendSessionSnapshot 而不是被拦截。
        if (
          !grew &&
          prevFirstId === firstId &&
          prevCount === messages.length &&
          prevCount > 0
        ) {
          const prevMsgs = prevMessagesRef.current;
          if (prevMsgs != null && prevMsgs.length === messages.length) {
            let hiddenChanged = false;
            for (let i = 0; i < messages.length; i++) {
              if (prevMsgs[i]!.hidden !== messages[i]!.hidden) {
                hiddenChanged = true;
                break;
              }
            }
            if (hiddenChanged) {
              sendSessionSnapshot('preserve');
              prevFirstMessageIdRef.current = firstId;
              prevMessageCountRef.current = messages.length;
              prevMessagesRef.current = messages;
              return;
            }
          }
        }

        prevMessagesRef.current = messages;

        if (prependedOlder) {
          const prependedCount = messages.length - prevCount;
          emitChatTranscriptTelemetry({
            name: 'prepend_detected',
            prependedCount,
            wasNearBottom: lastScrollRef.current.nearBottom,
            offsetYBefore: lastScrollRef.current.offsetY,
          });
          sendPrependPage(prependedCount);
        } else if (
          grew &&
          shouldSkipSnapshotAfterStreamCommit(
            messages,
            prevCount,
            lastStreamCommitIdsRef.current,
          )
        ) {
          lastStreamCommitIdsRef.current = [];
          prevFirstMessageIdRef.current = firstId;
          prevMessageCountRef.current = messages.length;
        } else if (uiRunning && grew) {
          const added = messages.slice(prevCount);
          // WHY: appendTail 无法刷新既有行的 toolPhase；含 tool_use / tool_result 落库需全量 snapshot。
          const needsFullSnapshot =
            added.some(messageIsToolResultsOnly) ||
            added.some(
              message =>
                message.role === 'assistant' && messageHasToolUse(message),
            );
          if (needsFullSnapshot) {
            // force：流式 tail 可能仍在追加（streamActiveRef 为 true），
            // 但含 tool_use/tool_result 的落库行必须立即进快照基线，不能 pending。
            sendSessionSnapshot('preserve', undefined, true);
          } else {
            sendAppendTailRows(added);
          }
        } else if (
          lastStreamCommitIdsRef.current.length > 0 &&
          messages.length === prevMessageCountRef.current
        ) {
          lastStreamCommitIdsRef.current = [];
          prevFirstMessageIdRef.current = firstId;
          prevMessageCountRef.current = messages.length;
        } else {
          // WHY: 回滚后 tail 仍满页（length 不变但 firstId 变）时 preserve 会保留中间读位；须 stick。
          const shrink = messages.length < prevCount;
          const tailWindowReplaced =
            !grew &&
            prevFirstId != null &&
            firstId != null &&
            firstId !== prevFirstId;
          sendSessionSnapshot(
            shrink || tailWindowReplaced ? 'stick' : 'preserve',
          );
        }

        prevFirstMessageIdRef.current = firstId;
        prevMessageCountRef.current = messages.length;
      }, [
        webReady,
        sessionKey,
        messages,
        uiRunning,
        sendSessionSnapshot,
        sendSessionSnapshotNow,
        sendPrependPage,
        sendAppendTailRows,
      ]);

      // Legacy MessageList path: stream via props. WebView path uses imperative ref (no parent re-render).
      useEffect(() => {
        if (!webReady) {
          return;
        }
        const prevText = prevStreamTextRef.current;
        const prevThinking = prevStreamThinkingRef.current;
        if (
          streamingText.length < prevText.length ||
          streamingThinking.length < prevThinking.length
        ) {
          resetStreamTail();
          return;
        }
        const textDelta = streamingText.slice(prevText.length);
        const thinkingDelta = streamingThinking.slice(prevThinking.length);
        prevStreamTextRef.current = streamingText;
        prevStreamThinkingRef.current = streamingThinking;
        if (textDelta.length > 0) {
          queueStreamDelta('text', textDelta);
        }
        if (thinkingDelta.length > 0) {
          queueStreamDelta('thinking', thinkingDelta);
        }
      }, [
        webReady,
        streamingText,
        streamingThinking,
        queueStreamDelta,
        resetStreamTail,
      ]);

      /**
       * 导航守卫（sec/D-1）：只放行包目录内的 file:// 加载（初始 index.html 与同包相对资源）；
       * http/https 外跳系统浏览器并拒绝页内导航，其余 scheme 一律拒绝。
       * 外部页面无法在 WebView 内落地后，其 postMessage 伪造桥消息
       * （messageMenuAction 触发 rollback/fork/set-floor、copyCode 写攻击者剪贴板）即无从成立。
       */
      const shouldStartLoadWithRequest = useCallback(
        (req: {url: string}): boolean => {
          if (req.url.startsWith(getChatTranscriptPackageDirUri())) {
            return true;
          }
          if (/^https?:\/\//i.test(req.url)) {
            // 外跳失败（无浏览器可处理等）静默兜底：绝不回退到 WebView 页内导航。
            // 防御性保留：库自身在 originWhitelist 拦截失败时也会外跳，此处兜住回调直达的场景。
            void Linking.openURL(req.url).catch(() => undefined);
          }
          return false;
        },
        [],
      );

      /**
       * iOS window.open / target="_blank" 新开窗口兜底：拒绝 WebView 内打开，外跳系统浏览器。
       */
      const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
        event.preventDefault();
        // WebViewOpenWindow 的字段是 targetUrl（新窗口目标地址），无 url 字段。
        void Linking.openURL(event.nativeEvent.targetUrl).catch(
          () => undefined,
        );
      }, []);

      return (
        <View style={styles.fill}>
          <WebView
            key={`transcript-repaint-${repaintEpoch}`}
            ref={webRef}
            style={styles.fill}
            /* sec/D-1：收紧为包内 file://（库会自动附带 about:blank）；初始加载与同包相对资源
               均命中此前缀，已验证收紧不影响首载。白名单外的导航由库自行外跳系统浏览器。 */
            originWhitelist={['file://']}
            source={{uri: getChatTranscriptUri()}}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowingReadAccessToURL={getChatTranscriptPackageDirUri()}
            onShouldStartLoadWithRequest={shouldStartLoadWithRequest}
            onOpenWindow={handleOpenWindow}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
            keyboardDisplayRequiresUserAction={false}
            /* 划词：仅「复制」（勿改 RICH_DOCUMENT_ANNOTATE_MENU_ITEMS）。 */
            menuItems={[...CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS]}
            onCustomMenuSelection={handleCustomMenuSelection}
          />
        </View>
      );
    },
  ),
  chatTranscriptWebViewPropsEqual,
);

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0, overflow: 'hidden'},
});
