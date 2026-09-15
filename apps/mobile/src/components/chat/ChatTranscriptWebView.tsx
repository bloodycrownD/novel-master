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
import {Linking, StyleSheet, View, AppState} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
// 根入口 index.d.ts 未 re-export 此类型，只能从 lib/WebViewTypes 深导入；
// import type 会被擦除，不影响运行时打包。
import type {WebViewOpenWindowEvent} from 'react-native-webview/lib/WebViewTypes';
import {type ChatMessage} from '@novel-master/core/chat';
import {bootTimingLog, timingLog} from '@/debug/run-timing';
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
import {createQuantumYield} from '@/services/yield-quantum';

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
  buildToolPairingContext,
  buildTranscriptRowsWithContext,
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
  /**
   * 强制直发全量快照（Step 6 单元接线的控制消息消费面）：绕过
   * uiRunning+streamActive 的 defer 拦截——subagent 长任务期间消息可见、
   * 重挂后空基线直发均走此路径（对齐组件内 pendingSubagentSessions
   * 变化时的 force 直发语义）。
   */
  forceSnapshot: () => void;
  /**
   * 轻量合成提交（Step 6 中断现场渲染）：把单元持有的 interrupted
   * partial（text/thinking 由调用方传入，不依赖组件本地累积）组装为
   * 一条只读 assistant 终态行经 streamCommit 通道呈现。成功返回 true；
   * webview 未就绪或 partial 全空返回 false。
   */
  commitSyntheticAssistantRow: (text: string, thinking: string) => boolean;
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
  /** 点击 markdown 链接（webview 发 linkClick 原始 href；识别与路由在宿主侧单源完成）。 */
  readonly onLinkClick?: (href: string) => void;
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

/**
 * 快照分片大小（init-busy-yield Step 6）：每片最多承载的消息数。行由消息
 * 一对一派生（一条消息至多产出一行，tool_results-only 与空消息被跳过），
 * 故「按消息分片」与「按行分片」同界——单片行数 ≤ 本常量。
 */
const SNAPSHOT_CHUNK_SIZE = 50;

/**
 * 快照分片代次（模块级单调递增计数器）：每次 sendSessionSnapshotNow 开新
 * 代次，在途旧代次分片循环在每个让步点检查代次、失效即中止丢弃；web 侧
 * 以代次大小判定「未知/迟到分片」并丢弃（等重传语义=RN 侧 force 新代次）。
 */
let snapshotGenerationCounter = 0;

/**
 * 分片在途期间推迟的动作（单一队列保序，C-orch-1）：
 * - streamFlush：流式 flush 的占位（无载荷，补发时触发两个 flush 尝试）；
 * - post：appendTailRows / prependPage / streamCommit 三通道的完整消息。
 */
type DeferredSnapshotAction =
  | {kind: 'streamFlush'}
  | {kind: 'post'; message: HostToTranscriptMessage};

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
        onLinkClick,
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
      // 首帧延迟打点：流式标志翻真（消息面生成态的起点，webview 注入将随之而来）
      useEffect(() => {
        if (streamGenerating) {
          timingLog('webview streamGenerating=true (transcript live)');
        }
      }, [streamGenerating]);
      const transcriptListOptions = {
        agentRunning,
        runUiStopped: !uiRunning,
        pendingSubagentSessions,
      };
      const {tokens} = useTheme();
      const webRef = useRef<WebView>(null);
      const [webReady, setWebReady] = useState(false);
      // webReady 的 ref 镜像：ready/visibility 分支同步写入（不经 effect，避免
      // 一帧窗口期），postToWeb 的 ready 守卫与分片循环的让步点检查都读它——
      // repaintEpoch 重挂（webReady=false）期间在途分片序列随之作废复位。
      const webReadyRef = useRef(false);
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
      /**
       * 当前在途快照分片的代次（null=无分片在途）。新快照开新代次时覆盖，
       * 旧循环在让步点检测到代次被顶替即中止；流式 RAF flush 与三通道
       * （appendTailRows / prependPage / streamCommit）的发送入口读它决定
       * 是否推迟（T-S3 + C-orch-1：分片序列必须完整先于后续改画消息）。
       */
      const inFlightSnapshotGenerationRef = useRef<number | null>(null);
      /**
       * 快照分片在途期间被推迟的动作队列（单一容器保序，C-orch-1）：
       * - streamFlush 占位：流式 RAF flush 尝试时分片在途（T-S3，原布尔标记）；
       * - post：三通道已构建好的消息（末片旧闭包快照会整体替换基线，直发
       *   会被抹掉——推迟到末片 post 之后按入队原序补发）。
       * 重挂（webReady=false）时队列一并丢弃，恢复注入链负责重推。
       */
      const deferredSnapshotActionsRef = useRef<DeferredSnapshotAction[]>([]);

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
        // ready 守卫：repaintEpoch 重挂期间（webReady=false）不再向未就绪的
        // WebView 投递——分片序列随之复位，ready 后由 force 快照重建基线。
        if (!webReadyRef.current) {
          return;
        }
        if (STATE_PAINTING_HOST_MESSAGES.has(message.type)) {
          statePushSinceResumeRef.current += 1;
        }
        webRef.current?.postMessage(encodeHostToTranscript(message));
      }, []);

      /**
       * 改画基线消息的推迟发送（C-orch-1）：分片在途时 appendTailRows /
       * prependPage / streamCommit 直发会插进分片序列中间——web 侧先按
       * concat 渲染增量行，末片 applySnapshot 再用旧闭包快照整体替换，
       * 增量行被抹掉且 RN 侧去重标志已推进、缺口留存。此处入 deferred
       * 队列（与流式 flush 占位同容器保序），末片 post 后统一按原序补发。
       */
      const postOrDeferSnapshotPaint = useCallback(
        (message: HostToTranscriptMessage) => {
          if (inFlightSnapshotGenerationRef.current != null) {
            deferredSnapshotActionsRef.current.push({kind: 'post', message});
            return;
          }
          postToWeb(message);
        },
        [postToWeb],
      );

      /**
       * 流式 flush 占位入队（T-S3，原布尔标记并入单队列）：队列已有占位则
       * 不重复——flush 幂等（segments 空转），占位只承担「末片后补发一次」。
       */
      const enqueueDeferredStreamFlush = useCallback(() => {
        for (const action of deferredSnapshotActionsRef.current) {
          if (action.kind === 'streamFlush') {
            return;
          }
        }
        deferredSnapshotActionsRef.current.push({kind: 'streamFlush'});
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
          // 快照分片在途：推迟流式 post（segments 留队），末片 post 后由快照
          // 流程统一补发——保证分片序列完整先于后续 streamDelta（T-S3）。
          if (inFlightSnapshotGenerationRef.current != null) {
            enqueueDeferredStreamFlush();
            return;
          }
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
      }, [postToWeb, enqueueDeferredStreamFlush]);

      const flushPendingStreamBatch = useCallback(() => {
        if (streamRafRef.current != null) {
          return;
        }
        streamRafRef.current = requestAnimationFrame(() => {
          streamRafRef.current = null;
          // 同 flushPendingStreamDeltas：分片在途时推迟 batch post。
          if (inFlightSnapshotGenerationRef.current != null) {
            enqueueDeferredStreamFlush();
            return;
          }
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
      }, [postToWeb, enqueueDeferredStreamFlush]);

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
      // 分片化（init-busy-yield Step 6）：大快照按片构建+enrich+编码 post，
      // 片间量子让步防长任务；每次调用开新代次，在途旧代次在让步点作废。
      const sendSessionSnapshotNow = useCallback(
        async (
          scrollIntent: TranscriptScrollIntent,
          restoreScroll?: TranscriptRestoreScroll,
        ) => {
          // 起点固定：分片跨帧，循环全程只读本闭包捕获的这份快照——
          // transcriptListOptions 每次渲染都重建，让步后的重渲染绝不能
          // 改变本次快照的构建口径。
          const snapshotMessages = messages;
          const listOptions = transcriptListOptions;
          const richText = flags?.richText ?? false;
          const snapshotSessionKey = sessionKey;
          const snapshotHasMore = hasMore;
          const generating = uiRunning;
          const generation = ++snapshotGenerationCounter;
          inFlightSnapshotGenerationRef.current = generation;
          // 预扫全局配对上下文（Step 5 同款 O(n) 一次扫描）：逐片行转换共享，
          // 分片拼接结果与单次全量 buildTranscriptRows 严格全等。
          const pairingContext = buildToolPairingContext(snapshotMessages);
          const chunkTotal = Math.max(
            1,
            Math.ceil(snapshotMessages.length / SNAPSHOT_CHUNK_SIZE),
          );
          const yieldFn = createQuantumYield();
          bootTimingLog(
            `snapshot begin (msgs=${snapshotMessages.length}, chunks=${chunkTotal}, gen=${generation})`,
          );
          try {
            for (
              let chunkIndex = 0;
              chunkIndex < chunkTotal;
              chunkIndex += 1
            ) {
              // 让步点校验：代次被新快照顶替（六条 force/直发路径均收敛到
              // 这里开新代次）或 WebView 重挂（webReady=false）即中止丢弃。
              if (
                inFlightSnapshotGenerationRef.current !== generation ||
                !webReadyRef.current
              ) {
                bootTimingLog(
                  `snapshot gen=${generation} aborted at chunk ${chunkIndex}/${chunkTotal} (superseded or remount)`,
                );
                return;
              }
              const chunkMessages = snapshotMessages.slice(
                chunkIndex * SNAPSHOT_CHUNK_SIZE,
                (chunkIndex + 1) * SNAPSHOT_CHUNK_SIZE,
              );
              const rows = enrichTranscriptRows(
                buildTranscriptRowsWithContext(
                  chunkMessages,
                  pairingContext,
                  listOptions,
                ),
                richText,
              );
              const isLastChunk = chunkIndex === chunkTotal - 1;
              postToWeb({
                v: 1,
                type: 'sessionSnapshot',
                payload: {
                  sessionKey: snapshotSessionKey,
                  rows,
                  hasMore: snapshotHasMore,
                  // 快照级标量每片重复携带；滚动字段仅末片（T-S4 聚合口径）。
                  ...(isLastChunk ? {scrollIntent} : {}),
                  ...(generating ? {generating: true} : {}),
                  ...(isLastChunk &&
                  scrollIntent === 'restore' &&
                  restoreScroll != null
                    ? {restoreScroll}
                    : {}),
                  generation,
                  chunkIndex,
                  chunkTotal,
                },
              });
              bootTimingLog(
                `snapshot chunk ${chunkIndex + 1}/${chunkTotal} posted (rows=${rows.length})`,
              );
              if (!isLastChunk) {
                // 片间量子让步：防止分片构建本身又变成长任务。
                await yieldFn();
              }
            }
            // 分片全部发完后统一同步（末片 post 之后）：保持「工具调用条与
            // 快照末态一致」的既有时序语义；单片快照等价旧单包行为。
            syncStreamToolInvoking();
            bootTimingLog(`snapshot all chunks done (gen=${generation})`);
            // 补发分片期间被推迟的动作（单一队列按入队原序，末片 post 先于
            // 全部补发消息）：T-S3 流式 flush + C-orch-1 三通道 post。
            const deferredActions = deferredSnapshotActionsRef.current;
            if (deferredActions.length > 0) {
              deferredSnapshotActionsRef.current = [];
              for (const action of deferredActions) {
                if (action.kind === 'streamFlush') {
                  flushPendingStreamDeltas();
                  flushPendingStreamBatch();
                } else {
                  postToWeb(action.message);
                }
              }
            }
          } finally {
            if (inFlightSnapshotGenerationRef.current === generation) {
              inFlightSnapshotGenerationRef.current = null;
              if (!webReadyRef.current) {
                // 重挂作废：推迟队列（流式 flush 占位 + 三通道 post）一并
                // 丢弃，恢复注入链负责重推（与旧协议下 post 到未就绪
                // WebView 即丢失等价）。
                deferredSnapshotActionsRef.current = [];
              }
            }
          }
        },
        [
          messages,
          hasMore,
          postToWeb,
          sessionKey,
          flags?.richText,
          uiRunning,
          syncStreamToolInvoking,
          transcriptListOptions,
          flushPendingStreamDeltas,
          flushPendingStreamBatch,
          enqueueDeferredStreamFlush,
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
          void sendSessionSnapshotNow(pending.intent, pending.restoreScroll);
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
            void sendSessionSnapshotNow(
              pending?.intent ?? intent,
              pending?.restoreScroll ?? restoreScroll,
            );
            return;
          }
          if (!uiRunning) {
            void sendSessionSnapshotNow(intent, restoreScroll);
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
              void sendSessionSnapshotNow(
                pending.intent,
                pending.restoreScroll,
              );
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
          // C-orch-1：分片在途时入 deferred 队列，末片 post 后补发——直发会
          // 被 web 侧末片的旧闭包整体替换抹掉。
          postOrDeferSnapshotPaint({
            v: 1,
            type: 'appendTailRows',
            payload: {rows},
          });
        },
        [
          postOrDeferSnapshotPaint,
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
          // C-orch-1：分片在途时 streamCommit 推迟到末片后补发。本地状态
          // （buffer 清理 / streamActive / 去重 ids）照常同步推进——只推迟
          // post 本身。tryCommitStreamTail / commitAbortOverlaySnapshot /
          // commitSyntheticAssistantRow 均经此入口，第四入口天然覆盖。
          postOrDeferSnapshotPaint({
            v: 1,
            type: 'streamCommit',
            payload: {rows, scrollIntent},
          });
          syncStreamToolInvoking();
        },
        [
          webReady,
          postOrDeferSnapshotPaint,
          clearLocalStreamBuffers,
          syncStreamToolInvoking,
        ],
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

      /**
       * 轻量合成提交（Step 6 中断现场渲染）：与 commitAbortOverlaySnapshot
       * 的差异在数据源——后者读组件本地累积（streamTextAccumRef）且以
       * streamActiveRef 为前置（重启水合出的 interrupted 单元两者皆空，
       * 直接调用必 false）；本方法把单元投影携带的 partial 作为参数传入，
       * 不依赖任何本地状态，专职「中断现场的只读终态行」呈现。
       */
      const commitSyntheticAssistantRow = useCallback(
        (text: string, thinking: string): boolean => {
          if (!webReady) {
            return false;
          }
          if (text.length === 0 && thinking.length === 0) {
            return false;
          }
          const richText = flags?.richText ?? false;
          const rows = enrichTranscriptRows(
            [
              {
                kind: 'message',
                id: `interrupted-partial-${Date.now()}`,
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
        },
        [webReady, flags?.richText, commitStreamTail],
      );

      /** handle 的 forceSnapshot 叶子：经 ref 取最新快照实现（force 直发）。 */
      const forceSnapshotNow = useCallback(() => {
        sendSessionSnapshotRef.current('preserve', undefined, true);
      }, []);

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
          forceSnapshot: forceSnapshotNow,
          commitSyntheticAssistantRow,
        }),
        [
          queueStreamDelta,
          queueStreamBatch,
          resetStreamTail,
          tryCommitStreamTail,
          commitAbortOverlaySnapshot,
          forceSnapshotNow,
          commitSyntheticAssistantRow,
        ],
      );

      const sendPrependPage = useCallback(
        (prependedCount: number) => {
          const richText = flags?.richText ?? false;
          const olderMessages = messages.slice(0, prependedCount);
          // C-orch-1：与 appendTailRows 同款推迟——分片在途时入队，末片后补发。
          postOrDeferSnapshotPaint({
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
          postOrDeferSnapshotPaint,
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
            webReadyRef.current = true;
            setWebReady(true);
            timingLog('webview ready (bridge handshake done)');
            bootTimingLog('webview ready (bridge handshake done)');
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
          if (message.type === 'linkClick') {
            onLinkClick?.(message.payload.href);
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
                // 同步置 ref：此后在途快照分片的下一个让步点即因 webReady
                // 守卫中止（分片序列复位），重挂后由 force 快照重建基线。
                webReadyRef.current = false;
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
          onLinkClick,
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
      // 必须 force：子会话创建时父 run 必然 uiRunning 且常 streamActive，
      // 普通 snapshot 会走 defer（挂起到流结束）——子代理长任务期间任务卡
      // 永远进不了基线，表现为「调用 subagent 时消息不显示，终止后才渲染」。
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
          forceAfterRepaint || (pendingSubagentSessions?.size ?? 0) > 0,
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
          void sendSessionSnapshotNow(intent, restoreScroll);
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
