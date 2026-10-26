/**
 * 对话宿主（chat-webview-unify Step 6 引入；composer-native-2026-10 Step 2 剥离）：
 * 转录 + 输入框 dock 曾合并进**单个** chat-conversation WebView；输入框原生化迭代
 * 起本组件按 D4b 剥离 composer/dock 域，退为**纯转录宿主**——composer 域的 props、
 * 桥消息（下行 setText/setSelection/setDisabled/blur/composerState/composerPaste/
 * selectAll，上行 change/selectionChange/dockAction）、IME 桥侧防线（M2/M4/M5）、
 * COMPOSER_PASTE_MAX_CHARS 消费与「composerState → 草稿 setText」恢复链两步全部拆除，
 * 恢复链缩为 `init → 快照直发`。dock 在 Step 5 由 RN 原生 composer 承接。

 * ## 继承的全部机制（转录侧，照 `ChatTranscriptWebView` 逐条搬）
 * 快照分片（`SNAPSHOT_CHUNK_SIZE=50` / `SNAPSHOT_CHUNK_BYTES=256KB` /
 * `./snapshot-chunk-bounds` 的 `planSnapshotChunkBounds` 预扫 / 代次作废）、流式三通道（delta/batch/blockCommit）
 * + 能力协商、`repaintEpoch` 与 visibility 重挂、滚动缓存恢复、安全守卫
 * （`originWhitelist=['file://']` + `onShouldStartLoadWithRequest` 只放行新包目录 +
 * `messageMenuAction` 仍走宿主回调）。

 * ## 两条硬纪律（动本文件前先读）
 *
 * **(A) deferred 队列只装改画三通道**（`appendTailRows` / `prependPage` / `streamCommit`）。
 * 其余域一律走 `postToWeb` 直发。理由：deferred 的唯一目的是防快照末片整体替换 rows 时
 * 抹掉增量行；误 defer 的代价是分片窗口（约 1.15s）内的增量被排队。composer 域已随
 * 剥离退役，本纪律对转录域其余直发消息同样生效。
 *
 * **(B) ready 只认 `v === 2`**。旧 dist 的 v:1 ready 被拒 → 走 8s 超时兜底错误态，
 * **不得**因为「收到了 ready」就置位 `webReady`：置位了就会把 v2 协议消息灌进一个
 * 根本不认得的页面（静默白屏，比报错更难查）。
 *
 * ## 回滚 SPA 化之后的形态
 *
 * 1. **列表域已整体拆除**：`view` / `sessionList` 下行与 `onListAction` 上行随会话
 *    列表回迁 RN（`ChatSessionListPanel`）一并删掉，文档恒停在对话视图。
 * 2. **重挂归零靠 key，不靠 effect**：调用方（`ChatConversationPanel`）给本组件
 *    传 `key={chatScrollKey ?? 'no-session-scroll'}`，切会话销毁重建整个实例——
 *    文档内状态、`ref` 状态、8s 握手计时全部天然归零，本组件内**不再有任何
 *    `[sessionKey]` 清场 effect**。这份「新增 ref 必须同步补清场」的负担随 key
 *    恢复一并消失（它在 SPA 化那轮才被引进来）。
 */
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {AppState, Linking, StyleSheet, Text, View} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
// 根入口 index.d.ts 未 re-export 此类型，只能从 lib/WebViewTypes 深导入；
// import type 会被擦除，不影响运行时打包。
import type {WebViewOpenWindowEvent} from 'react-native-webview/lib/WebViewTypes';
import {type ChatMessageData} from '@novel-master/core/chat';
import {
  bootTimingLog,
  rollbackTimingLog,
  timingLog,
} from '@/debug/run-timing';
import Clipboard from '@react-native-clipboard/clipboard';
import type {
  ChatTranscriptScrollSnapshot,
  TranscriptFlags,
  TranscriptRestoreScroll,
  TranscriptRow,
  TranscriptScrollIntent,
  TranscriptSkillRef,
} from './ChatTranscriptBridge';
import {
  CONVERSATION_BRIDGE_V,
  decodeConversationUpstream,
  encodeHostToConversation,
  parseConversationScrollSnapshot,
  readReadyCapabilities,
  type ConversationHostMessage,
} from './ChatConversationBridge';
import {enrichTranscriptRows} from './enrich-transcript-rows';
import {conversationThemeFromTokens} from './conversation-theme';
import {createQuantumYield} from '@/services/yield-quantum';
import {
  buildTranscriptRows,
  buildToolPairingContext,
  buildTranscriptRowsWithContext,
  messageHasToolUse,
  messageIsToolResultsOnly,
  selectTailTranscriptRows,
} from './message-blocks';
import {planSnapshotChunkBounds} from './snapshot-chunk-bounds';
import {
  getChatTranscriptPackageDirUri,
  getChatTranscriptUri,
} from '@/webview-host/chat-transcript/uri';
import {buildThemeInjectScript} from '@/webview-host/webview-theme-inject';
import {emitChatTranscriptTelemetry} from '@/services/chat-transcript-telemetry';
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '@/services/chat-transcript-scroll-cache';
import {useTheme} from '@/theme/ThemeProvider';
import {prepareStreamTailHtml} from './prepare-stream-tail-html';
import {splitStreamBlocks} from '@/web/chat-transcript/stream/block-split';
import {
  TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT,
  transcriptCapabilitiesInclude,
} from '@/web/chat-transcript/transcript-capabilities';
import type {StreamWireChunk} from '@/services/stream-wire-queue';
import {appendWireChunk} from '@/services/stream-wire-queue';
import {decodeLiteralHtmlEntities} from '@/components/rich-content/decode-literal-html-entities';
import {
  CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS,
} from './chat-transcript-selection-menu';
import type {ChatTranscriptWebViewHandle} from './ChatTranscriptWebViewHandle';

export type {ChatTranscriptWebViewHandle} from './ChatTranscriptWebViewHandle';

/**
 * 宿主句柄 = 转录七方法（`ChatTranscriptWebViewHandle` 逐字复用，方法面不变）。
 *
 * composer 命令式写入（`setComposerText`）随 D4b 剥离删除：composer 域下行
 * `setText` 桥消息退役后该方法失去落点，M7 命令式通道语义由 Step 3 起的
 * `NativeChatComposer` ref 通道承接。`session-stream-webview-adapter` /
 * `ChatTabProvider` / `useInterruptedPartialCommit` / `SubagentSessionScreen`
 * 的转录七方法消费零改动。
 *
 * `transcriptOnly` 变体（子会话屏）的行为面断言在
 * `__tests__/chat-conversation-webview.test.tsx` 的 transcriptOnly describe
 * （RN 侧 init 载荷 + memo 比较器）；web 侧旧产物面断言随 chat-conversation
 * 包退役已删（chat-transcript web 侧亦无 dock/transcriptOnly 消费）。
 */
export type ChatConversationWebViewHandle = ChatTranscriptWebViewHandle;

/**
 * 会改变**转录**画面的宿主消息类型；用于「隐藏期间脏推送」计数。
 */
const STATE_PAINTING_HOST_MESSAGES: ReadonlySet<string> = new Set([
  'sessionSnapshot',
  'prependPage',
  'appendTailRows',
  'streamDelta',
  'streamBatch',
  'streamBlockCommit',
  'streamCommit',
  'streamReset',
  'streamToolInvoking',
  'flagsUpdate',
]);

/**
 * 渲染块级化默认开关（回滚开关，语义照搬 ChatTranscriptWebView）：
 * 运行时以 ready 上报的 capabilities 覆盖——未声明 `streamBlockCommit` 的旧 dist
 * 一律按不支持处理（块提交会被静默丢弃、流中只剩尾块）。
 */
const STREAM_BLOCK_RENDER_ENABLED = true;

/**
 * ready 超时兜底窗口（spec T-CU15，锚 **onLoad** 而非 init）。
 *
 * 锚 init 是时序死锁：init 本身要等 ready 才发。白屏的成因链是「旧 dist 发不出
 * v2 ready → webReady 永假 → 全部下行丢弃」，因此这里只做**兜底**：超时即渲染
 * 错误态 + 提示重载，而不是依赖 ready 门控本身发现。
 */
const READY_TIMEOUT_MS = 8000;

export type ChatConversationWebViewProps = {
  readonly sessionKey: string;
  readonly messages: readonly ChatMessageData[];
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
  readonly mermaidViewerCloseSignal?: number;
  readonly onScrollSnapshot?: (snap: ChatTranscriptScrollSnapshot) => void;
  readonly onReady?: () => void;
  readonly onLoadOlder?: () => void;
  readonly onOpenToolFile?: (path: string) => void;
  readonly onLinkClick?: (href: string) => void;
  readonly onOpenSubagentSession?: (sessionId: string) => void;
  readonly onOpenSkillDetail?: (ref: TranscriptSkillRef) => void;
  /** 工具结果阅读（search/curl/grep/glob 卡片点击 → 全屏阅读页）。 */
  readonly onOpenToolResult?: (payload: {
    title: string;
    content: string;
    /** 入参原文 pretty JSON；无入参时宿主不带该字段。 */
    inputJson?: string;
  }) => void;
  readonly onOpenMessageMenu?: (
    messageId: string,
    pageX: number,
    pageY: number,
  ) => void;
  readonly onMessageMenuAction?: (messageId: string, action: string) => void;
  readonly onWebMenuOpenChange?: (open: boolean) => void;
  readonly onWebMermaidViewerOpenChange?: (open: boolean) => void;
  readonly pendingSubagentSessions?: ReadonlyMap<string, string>;
  readonly onSnapshotComplete?: () => void;

  /**
   * 转录 only 变体（transcript-converge，子会话屏）：只要转录、不要输入
   * dock 的降级形态。init 下发该字段，web 侧给 #app 挂类隐藏
   * dock；该变体下 composer-dock 能力位缺失也不渲染降级横幅（本就没有
   * dock，横幅的「输入组件版本过低」语义不成立）。
   */
  readonly transcriptOnly?: boolean;
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
 * memo 比较器：转录域照旧（composer 域已随 D4b 剥离，比较面只剩转录字段）。
 *
 * 历史教训（spec 记过一次踩坑史）：`pendingSubagentSessions` 漏加 → 静默吞更新。
 * 往本比较器加字段时逐个入列，漏一个就是「改了没生效」且无任何报错。
 */
function chatConversationWebViewPropsEqual(
  prev: ChatConversationWebViewProps,
  next: ChatConversationWebViewProps,
): boolean {
  return (
    // ---- 转录域（照 ChatTranscriptWebView 原样） ----
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
    prev.initialScroll === next.initialScroll &&
    transcriptFlagsEqual(prev.flags, next.flags) &&
    prev.pendingSubagentSessions === next.pendingSubagentSessions &&
    // ---- 变体（transcript-converge）：漏比会吞掉子会话屏的降级形态 ----
    prev.transcriptOnly === next.transcriptOnly
  );
}

/**
 * init / themeUpdate 的主题载荷即 `conversationThemeFromTokens(tokens)` 的产物
 * （映射本体在 `conversation-theme.ts`，与原生 composer 共用一份）。
 */

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
    emitChatTranscriptTelemetry({name: 'scroll_restore', mode: 'stick'});
  }
}

/** streamCommit 已同步的行，跳过 messages effect 重复 snapshot/append。 */
function shouldSkipSnapshotAfterStreamCommit(
  messages: readonly ChatMessageData[],
  prevCount: number,
  committedIds: readonly string[],
): boolean {
  if (committedIds.length === 0 || messages.length <= prevCount) {
    return false;
  }
  const addedIds = messages.slice(prevCount).map(message => message.id);
  return addedIds.length > 0 && addedIds.every(id => committedIds.includes(id));
}

/** 跳过 snapshot 的前提是 streamCommit 同步过的行仍全部在当前列表里。 */
function committedStreamRowsStillPresent(
  messages: readonly ChatMessageData[],
  committedIds: readonly string[],
): boolean {
  const idSet = new Set(messages.map(message => message.id));
  return committedIds.every(id => idSet.has(id));
}

/** 分片在途期间推迟的动作（单一队列保序）：流式 flush 占位 + 改画三通道完整消息。 */
type DeferredSnapshotAction =
  | {kind: 'streamFlush'}
  | {kind: 'post'; message: ConversationHostMessage};

/** 快照分片代次（模块级单调递增计数器，见 ChatTranscriptWebView 同款注释）。 */
let snapshotGenerationCounter = 0;

export const ChatConversationWebView = memo(
  forwardRef<ChatConversationWebViewHandle, ChatConversationWebViewProps>(
    function ChatConversationWebView(
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
        onScrollSnapshot,
        onReady,
        onLoadOlder,
        onOpenToolFile,
        onLinkClick,
        onOpenSubagentSession,
        onOpenSkillDetail,
        onOpenToolResult,
        onOpenMessageMenu,
        onMessageMenuAction,
        onWebMenuOpenChange,
        onWebMermaidViewerOpenChange,
        pendingSubagentSessions,
        onSnapshotComplete,
        transcriptOnly = false,
      },
      ref,
    ) {
      const uiRunning = uiRunningProp ?? agentRunning;
      const streamGenerating = uiRunning || toolInvoking;
      useEffect(() => {
        if (streamGenerating) {
          timingLog('webview streamGenerating=true (conversation live)');
        }
      }, [streamGenerating]);

      /**
       * 列表构建选项：memo 到「三个输入真变」为止。
       *
       * 旧链每次渲染都重建这个对象——那样会让下游 `useCallback` 身份逐帧变化、
       * 依赖数组失配；memo 之后**语义完全等价**：它本来就只由这三个输入决定，
       * 而快照闭包「取发起那一刻的值」的口径靠 `sendSessionSnapshotNow` 自己
       * 捕获该对象保证，与本对象是否逐帧重建无关。
       */
      const transcriptListOptions = useMemo(
        () => ({
          agentRunning,
          runUiStopped: !uiRunning,
          pendingSubagentSessions,
        }),
        [agentRunning, uiRunning, pendingSubagentSessions],
      );
      /** 解析后的 flags：同样 memo，避免下游 effect 被逐帧新对象惊扰。 */
      const resolvedFlags = useMemo<TranscriptFlags>(
        () => ({richText: flags?.richText ?? false, menuDisabled: uiRunning}),
        [flags?.richText, uiRunning],
      );
      const {tokens} = useTheme();
      const webRef = useRef<WebView>(null);
      const [webReady, setWebReady] = useState(false);
      const webReadyRef = useRef(false);
      // repaintEpoch 重挂（Android WebView 恢复显示后可能仍渲染摘除前的旧帧）
      const [repaintEpoch, setRepaintEpoch] = useState(0);
      /** T-CU15：ready 超时兜底错误态（onLoad 后 8s 未收到 v:2 ready）。 */
      const [readyFailed, setReadyFailed] = useState(false);

      const forceSnapshotOnReadyRef = useRef(false);
      const statePushSinceResumeRef = useRef(0);
      /**
       * web 上报 `visibility {hidden:true}` 那一刻的 app 前台态快照（2026-10-05
       * 加）。用于区分「WebView 不可见」的两种成因：
       * - **app 进后台**（锁屏/切走）：Chromium 冻结 web JS，恢复后文档可能陈旧，
       *   沿用 visibility 脏重挂（webview-background-ready-fail 的原始场景）；
       * - **被栈内屏盖住**（push 子会话屏时 native-stack 把主屏 view 摘出窗口）：
       *   app 仍前台、web JS 活着、RN→web 的推送照发照收，文档**不脏**——
       *   不可见期间有推送就重挂 = 误伤（真机实锤：退出子会话返回主屏落
       *   「对话页加载失败」错误页，重挂后 8s 握手赛跑在 dev 包下必超时）。
       *
       * 快照为 `null`（本次可见周期内没收到过 hidden，如 jest 用例只喂 visible、
       * 或后台期间 JS 冻结到 hidden 都没发出）时保守沿用原重挂判据——与 :680
       * 的方向约定不同（那边未知态当前台防误判死，这边未知态当后台保重挂兜底）。
       */
      const visibilityHiddenAppStateRef = useRef<string | null>(null);
      const prevStreamTextRef = useRef('');
      const prevStreamThinkingRef = useRef('');
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
      const pendingStreamDeltaSegmentsRef = useRef<StreamWireChunk[]>([]);
      const pendingStreamSegmentsRef = useRef<StreamWireChunk[]>([]);
      const streamTextAccumRef = useRef('');
      const streamThinkingAccumRef = useRef('');
      const streamCommittedTextPartsRef = useRef<string[]>([]);
      const streamCommittedThinkingPartsRef = useRef<string[]>([]);
      const streamBlockCapableRef = useRef(false);
      const richTextRef = useRef(flags?.richText ?? false);
      const streamActiveRef = useRef(false);
      const lastStreamCommitIdsRef = useRef<readonly string[]>([]);
      const inFlightSnapshotGenerationRef = useRef<number | null>(null);
      const deferredSnapshotActionsRef = useRef<DeferredSnapshotAction[]>([]);

      const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
      );

      /**
       * 失败态镜像（webview-background-ready-fail）：供 AppState 的 change 回调读
       * 最新失败态。走 ref 而非把 `readyFailed` 塞进回调依赖——依赖一变回调就换，
       * 订阅会被反复摘挂重挂（监听本身也跟着抖动）。
       */
      const readyFailedRef = useRef(false);
      readyFailedRef.current = readyFailed;

      const clearReadyTimeout = useCallback(() => {
        if (readyTimeoutRef.current != null) {
          clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
      }, []);

      /**
       * T-CU15：重新计时。**只在「真的换了文档」时重置**——onLoad 与
       * repaintEpoch 重挂（Android WebView 恢复显示后仍渲染摘除前的旧帧 /
       * 用户点「重载」）。重挂后是新文档、新一轮握手，不能拿上一轮的计时器判超时。
       *
       * **切会话（`sessionKey` 变化）靠 `key` 重挂自然重新计时**：调用方传
       * `key={chatScrollKey}`，切会话销毁重建整个组件实例，`onLoad` 天然重新
       * 走一遍本计时器，本组件内不必再为 sessionKey 补一条重计时。
       */
      const armReadyTimeout = useCallback(() => {
        clearReadyTimeout();
        readyTimeoutRef.current = setTimeout(() => {
          readyTimeoutRef.current = null;
          if (webReadyRef.current) {
            return;
          }
          // 前后台感知（webview-background-ready-fail）：锁屏/后台时 Chromium 冻结
          // web JS，ready 发不出来不是装配失败——非前台态不判死，挂起等回前台由
          // AppState 订阅重新计时。显式列举 background/inactive 而非 !== 'active'：
          // 启动早期 currentState 为 null、jest 环境（@react-native/jest-preset mock）
          // 为 undefined，按前台处理（真机到期时刻不会处于启动早期）。
          const appState = AppState.currentState;
          if (appState === 'background' || appState === 'inactive') {
            return;
          }
          setReadyFailed(true);
        }, READY_TIMEOUT_MS);
      }, [clearReadyTimeout]);

      useEffect(() => clearReadyTimeout, [clearReadyTimeout]);

      const clearLocalStreamBuffers = useCallback(() => {
        if (streamRafRef.current != null) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        pendingStreamDeltaSegmentsRef.current = [];
        pendingStreamSegmentsRef.current = [];
        streamTextAccumRef.current = '';
        streamThinkingAccumRef.current = '';
        streamCommittedTextPartsRef.current = [];
        streamCommittedThinkingPartsRef.current = [];
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

      /**
       * 唯一的下行出口。
       *
       * 纪律 (A)：只有改画三通道的调用方才允许改走 `postOrDeferSnapshotPaint`；
       * 其余域一律直接走这里（不排队、不 defer）。
       */
      const postToWeb = useCallback((message: ConversationHostMessage) => {
        if (!webReadyRef.current) {
          return;
        }
        if (STATE_PAINTING_HOST_MESSAGES.has(message.type)) {
          statePushSinceResumeRef.current += 1;
        }
        webRef.current?.postMessage(encodeHostToConversation(message));
      }, []);

      /**
       * 改画基线消息的推迟发送（C-orch-1）：分片在途时三通道直发会插进分片序列
       * 中间，末片 applySnapshot 用旧闭包整体替换会把增量行抹掉。此处入 deferred
       * 队列，末片 post 后按入队原序补发。
       */
      const postOrDeferSnapshotPaint = useCallback(
        (message: ConversationHostMessage) => {
          if (inFlightSnapshotGenerationRef.current != null) {
            deferredSnapshotActionsRef.current.push({kind: 'post', message});
            return;
          }
          postToWeb(message);
        },
        [postToWeb],
      );

      /** 流式 flush 占位入队（幂等，flush 本身空转安全）。 */
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
          v: CONVERSATION_BRIDGE_V,
          type: 'streamToolInvoking',
          payload: {active: streamGenerating},
        });
      }, [webReady, streamGenerating, postToWeb]);

      type PendingStreamBlockSplit = {
        kind: 'text' | 'thinking';
        commits: {html?: string; text: string}[];
        tailHtml?: string;
        tailText: string;
      };

      /** 块感知切分（照搬 ChatTranscriptWebView；未声明能力时恒返回 []）。 */
      const takeStreamBlockSplits =
        useCallback((): PendingStreamBlockSplit[] => {
          if (
            !richTextRef.current ||
            !STREAM_BLOCK_RENDER_ENABLED ||
            !streamBlockCapableRef.current
          ) {
            return [];
          }
          const splits: PendingStreamBlockSplit[] = [];
          const kinds = [
            {
              kind: 'text' as const,
              tail: streamTextAccumRef,
              committed: streamCommittedTextPartsRef,
            },
            {
              kind: 'thinking' as const,
              tail: streamThinkingAccumRef,
              committed: streamCommittedThinkingPartsRef,
            },
          ];
          for (const {kind, tail, committed} of kinds) {
            const {blocks, activeTail} = splitStreamBlocks(tail.current);
            if (blocks.length === 0) {
              continue;
            }
            tail.current = activeTail;
            committed.current.push(...blocks);
            splits.push({
              kind,
              commits: blocks.map(block => ({
                html: prepareStreamTailHtml(block, true),
                text: block,
              })),
              tailHtml: prepareStreamTailHtml(activeTail, true),
              tailText: activeTail,
            });
          }
          return splits;
        }, []);

      const postStreamBlockSplits = useCallback(
        (splits: readonly PendingStreamBlockSplit[]) => {
          for (const split of splits) {
            const lastCommitIndex = split.commits.length - 1;
            for (let i = 0; i <= lastCommitIndex; i += 1) {
              const commit = split.commits[i]!;
              // 尾块载荷只挂每 kind 每次切分的最后一个 commit（同 split 内尾块态相同）
              const carriesTail = i === lastCommitIndex;
              postToWeb({
                v: CONVERSATION_BRIDGE_V,
                type: 'streamBlockCommit',
                payload: {
                  kind: split.kind,
                  html: commit.html,
                  text: commit.text,
                  ...(carriesTail
                    ? {tailHtml: split.tailHtml, tailText: split.tailText}
                    : {}),
                },
              });
            }
          }
        },
        [postToWeb],
      );

      const flushPendingStreamDeltas = useCallback(() => {
        if (pendingStreamDeltaSegmentsRef.current.length === 0) {
          return;
        }
        if (streamRafRef.current != null) {
          return;
        }
        streamRafRef.current = requestAnimationFrame(() => {
          streamRafRef.current = null;
          if (inFlightSnapshotGenerationRef.current != null) {
            enqueueDeferredStreamFlush();
            return;
          }
          const segments = pendingStreamDeltaSegmentsRef.current;
          if (segments.length === 0) {
            return;
          }
          pendingStreamDeltaSegmentsRef.current = [];
          const richText = richTextRef.current;
          const blockSplits = takeStreamBlockSplits();
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
              v: CONVERSATION_BRIDGE_V,
              type: 'streamDelta',
              payload: {
                kind: seg.kind,
                delta: seg.delta,
                html: seg.kind === 'text' ? textHtml : thinkingHtml,
              },
            });
          }
          postStreamBlockSplits(blockSplits);
        });
      }, [
        postToWeb,
        enqueueDeferredStreamFlush,
        takeStreamBlockSplits,
        postStreamBlockSplits,
      ]);

      const flushPendingStreamBatch = useCallback(() => {
        if (pendingStreamSegmentsRef.current.length === 0) {
          return;
        }
        if (streamRafRef.current != null) {
          return;
        }
        streamRafRef.current = requestAnimationFrame(() => {
          streamRafRef.current = null;
          if (inFlightSnapshotGenerationRef.current != null) {
            enqueueDeferredStreamFlush();
            return;
          }
          const segments = pendingStreamSegmentsRef.current;
          if (segments.length === 0) {
            return;
          }
          pendingStreamSegmentsRef.current = [];
          const richText = richTextRef.current;
          const blockSplits = takeStreamBlockSplits();
          const textHtml = prepareStreamTailHtml(
            streamTextAccumRef.current,
            richText,
          );
          const thinkingHtml = prepareStreamTailHtml(
            streamThinkingAccumRef.current,
            richText,
          );
          postToWeb({
            v: CONVERSATION_BRIDGE_V,
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
          postStreamBlockSplits(blockSplits);
        });
      }, [
        postToWeb,
        enqueueDeferredStreamFlush,
        takeStreamBlockSplits,
        postStreamBlockSplits,
      ]);

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
            if (seg.kind === 'text') {
              streamTextAccumRef.current += seg.delta;
            } else {
              streamThinkingAccumRef.current += seg.delta;
            }
            appendWireChunk(pendingStreamSegmentsRef.current, seg);
          }
          flushPendingStreamBatch();
        },
        [webReady, flushPendingStreamBatch],
      );

            /**
       * `init` 是 ready 后的一次性快照：取当拍值，此后变化各有专线消息
       * （richText/menuDisabled → `flagsUpdate`）。
       *
       * 取「每次渲染刷新 ref、发送时读 ref」而不是把字段挂 `useCallback` 依赖：
       * 后者会让 `sendInit` 的身份随依赖变，导致 `useEffect([webReady, sendInit])`
       * 重发 init。D4b 剥离后 init 不再带 `composer` 段（web 侧 dispatcher 的
       * splitInitPayload 对缺失段有兜底，合成包过渡期不崩）。
       */
      const initSnapshotRef = useRef({
        theme: conversationThemeFromTokens(tokens),
        flags: resolvedFlags,
      });
      initSnapshotRef.current = {
        theme: conversationThemeFromTokens(tokens),
        flags: resolvedFlags,
      };

      /**
       * 恢复链第 1 步 · 聚合 `init`。
       */
      const sendInit = useCallback(() => {
        const snapshot = initSnapshotRef.current;
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'init',
          payload: {
            theme: snapshot.theme,
            flags: snapshot.flags,
            // 转录 only 变体（transcript-converge）：web 据此隐藏 dock。
            ...(transcriptOnly ? {transcriptOnly: true} : {}),
          },
        });
      }, [postToWeb, transcriptOnly]);

      /** 快照分片化（照搬 ChatTranscriptWebView 全部语义）。 */
      const sendSessionSnapshotNow = useCallback(
        async (
          scrollIntent: TranscriptScrollIntent,
          restoreScroll?: TranscriptRestoreScroll,
        ) => {
          const snapshotMessages = messages;
          const listOptions = transcriptListOptions;
          const richText = flags?.richText ?? false;
          const snapshotSessionKey = sessionKey;
          const snapshotHasMore = hasMore;
          const generating = uiRunning;
          const generation = ++snapshotGenerationCounter;
          inFlightSnapshotGenerationRef.current = generation;
          rollbackTimingLog(
            `snapshot build begin (msgs=${snapshotMessages.length})`,
          );
          const pairingContext = buildToolPairingContext(snapshotMessages);
          const chunkBounds = planSnapshotChunkBounds(snapshotMessages);
          const chunkTotal = chunkBounds.length;
          rollbackTimingLog(
            `snapshot prescan done (pairing+bucket, chunks=${chunkTotal})`,
          );
          const yieldFn = createQuantumYield();
          bootTimingLog(
            `snapshot begin (msgs=${snapshotMessages.length}, chunks=${chunkTotal}, gen=${generation})`,
          );
          try {
            for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex += 1) {
              if (
                inFlightSnapshotGenerationRef.current !== generation ||
                !webReadyRef.current
              ) {
                bootTimingLog(
                  `snapshot gen=${generation} aborted at chunk ${chunkIndex}/${chunkTotal} (superseded or remount)`,
                );
                return;
              }
              const [chunkStart, chunkEnd] = chunkBounds[chunkIndex]!;
              const rows = enrichTranscriptRows(
                buildTranscriptRowsWithContext(
                  snapshotMessages.slice(chunkStart, chunkEnd),
                  pairingContext,
                  listOptions,
                ),
                richText,
              );
              const isLastChunk = chunkIndex === chunkTotal - 1;
              postToWeb({
                v: CONVERSATION_BRIDGE_V,
                type: 'sessionSnapshot',
                payload: {
                  sessionKey: snapshotSessionKey,
                  rows,
                  hasMore: snapshotHasMore,
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
                `snapshot chunk ${chunkIndex + 1}/${chunkTotal} posted (rows=${
                  rows.length
                })`,
              );
              rollbackTimingLog(
                `snapshot chunk ${chunkIndex + 1}/${chunkTotal} posted (rows=${rows.length})`,
              );
              if (!isLastChunk) {
                await yieldFn();
              }
            }
            syncStreamToolInvoking();
            bootTimingLog(`snapshot all chunks done (gen=${generation})`);
            rollbackTimingLog(
              `snapshot all chunks done (gen=${generation}, chunks=${chunkTotal})`,
            );
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
            onSnapshotComplete?.();
          } finally {
            if (inFlightSnapshotGenerationRef.current === generation) {
              inFlightSnapshotGenerationRef.current = null;
              if (!webReadyRef.current) {
                // 重挂作废：推迟队列整队丢弃（重挂后 ready 会重来，快照链重发）
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
          onSnapshotComplete,
          syncStreamToolInvoking,
          transcriptListOptions,
          flushPendingStreamDeltas,
          flushPendingStreamBatch,
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

      const sendSessionSnapshotRef = useRef(sendSessionSnapshot);
      useEffect(() => {
        sendSessionSnapshotRef.current = sendSessionSnapshot;
      });

      /**
       * 卸载 cleanup：掐掉 defer 定时器并丢掉 pending 快照档。
       *
       * 这份清理原本挂在「视图切离对话」那条 effect 上（会话列表进同一文档期间
       * 切离视图是唯一的「不进对话却还留着快照」场景）。列表域拆除后那条路径
       * 不复存在，但**切会话 = `key` 重挂 = 组件卸载**这条路径仍在：uiRunning
       * 期间挂起的 pending 档若没人掐，0ms 定时器会在实例已卸载后照常 fire，
       * 拿已失效的 webRef 发起一次快照分片。清理顺序与 `flushPendingSnapshot`
       * 同款：先掐定时器再丢档。
       */
      useEffect(() => {
        return () => {
          if (snapshotDeferTimerRef.current != null) {
            clearTimeout(snapshotDeferTimerRef.current);
            snapshotDeferTimerRef.current = null;
          }
          pendingSnapshotRef.current = null;
        };
      }, []);

      const sendAppendTailRows = useCallback(
        (tailMessages: readonly ChatMessageData[]) => {
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
          postOrDeferSnapshotPaint({
            v: CONVERSATION_BRIDGE_V,
            type: 'appendTailRows',
            payload: {rows},
          });
        },
        [
          postOrDeferSnapshotPaint,
          flags?.richText,
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
          postOrDeferSnapshotPaint({
            v: CONVERSATION_BRIDGE_V,
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
        (allMessages: readonly ChatMessageData[], prevCount: number): boolean => {
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
        [webReady, flags?.richText, commitStreamTail, transcriptListOptions],
      );

      const commitAbortOverlaySnapshot = useCallback((): boolean => {
        if (!webReady) {
          return false;
        }
        const text =
          streamCommittedTextPartsRef.current.join('') +
          streamTextAccumRef.current;
        const thinking =
          streamCommittedThinkingPartsRef.current.join('') +
          streamThinkingAccumRef.current;
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

      const forceSnapshotNow = useCallback(() => {
        sendSessionSnapshotRef.current('preserve', undefined, true);
      }, []);

      const resetStreamTail = useCallback(() => {
        clearLocalStreamBuffers();
        const wasActive = streamActiveRef.current;
        streamActiveRef.current = false;
        if (webReady && wasActive) {
          postToWeb({v: CONVERSATION_BRIDGE_V, type: 'streamReset', payload: {}});
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
          postOrDeferSnapshotPaint({
            v: CONVERSATION_BRIDGE_V,
            type: 'prependPage',
            payload: {
              rows: enrichTranscriptRows(
                buildTranscriptRows(
                  messages.slice(0, prependedCount),
                  undefined,
                  transcriptListOptions,
                ),
                richText,
              ),
              prependedCount,
            },
          });
        },
        [messages, postOrDeferSnapshotPaint, flags?.richText, transcriptListOptions],
      );

      const handleUpstream = useCallback(
        (event: WebViewMessageEvent) => {
          // 宽松 decoder（纪律 B）：坏 JSON 静默丢弃；ready 由 v===2 判。
          const decoded = decodeConversationUpstream(event.nativeEvent.data);
          if (!decoded.ok) {
            if (decoded.reason === 'stale-ready') {
              // 旧 dist 的 ready：不置 webReady，等 8s 兜底错误态
              bootTimingLog('stale ready (v !== 2) ignored');
            }
            return;
          }
          const message = decoded.message;
          const payload = message.payload;

          /* ---- ready（v:2 单条；转录域能力协商） ---- */
          if (message.type === 'ready') {
            webReadyRef.current = true;
            setWebReady(true);
            setReadyFailed(false);
            clearReadyTimeout();
            const capabilities = readReadyCapabilities(payload);
            streamBlockCapableRef.current = transcriptCapabilitiesInclude(
              capabilities,
              TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT,
            );
            timingLog('conversation webview ready (v2 handshake done)');
            bootTimingLog('conversation webview ready (v2 handshake done)');
            onReady?.();
            onWebMermaidViewerOpenChange?.(false);
            return;
          }

          // change / selectionChange / dockAction 三条 composer/dock 域上行已随
          // D4b 剥离删除（解码器对未知 type 宽松放行，本组件不再消费）。
          // 键盘链路由 keyboard-controller insets 驱动，focus / blur 无消费。
          // heightChange 不上行（heightReport: false，高度由文档内布局消化）。

          /* ---- 转录域上行（v:1 单例） ---- */
          if (message.type === 'copyCode') {
            const code = String(payload.code ?? '');
            if (code) {
              Clipboard.setString(code);
            }
            return;
          }
          if (message.type === 'scrollSnapshot') {
            const snap = parseConversationScrollSnapshot(
              message,
              CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
            );
            if (snap != null) {
              rollbackTimingLog('web render receipt (scrollSnapshot)');
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
            onOpenToolFile?.(String(payload.path ?? ''));
            return;
          }
          if (message.type === 'linkClick') {
            onLinkClick?.(String(payload.href ?? ''));
            return;
          }
          if (message.type === 'openSubagentSession') {
            onOpenSubagentSession?.(String(payload.sessionId ?? ''));
            return;
          }
          if (message.type === 'openSkillDetail') {
            onOpenSkillDetail?.({
              domain: payload.domain as TranscriptSkillRef['domain'],
              name: String(payload.name ?? ''),
              ...(payload.projectId != null
                ? {projectId: String(payload.projectId)}
                : {}),
            });
            return;
          }
          if (message.type === 'openToolResult') {
            onOpenToolResult?.({
              title: String(payload.title ?? ''),
              content: String(payload.content ?? ''),
              // 入参原文：无入参的卡片不带该字段，宿主据此只铺输出。
              ...(typeof payload.inputJson === 'string'
                ? {inputJson: payload.inputJson}
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
              String(payload.messageId ?? ''),
              Number(payload.pageX ?? 0),
              Number(payload.pageY ?? 0),
            );
            return;
          }
          if (message.type === 'messageMenuAction') {
            // 安全防线不弱化：rollback / fork / set-floor 仍在宿主回调处置
            onMessageMenuAction?.(
              String(payload.messageId ?? ''),
              String(payload.action ?? ''),
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
          if (message.type === 'visibility') {
            if (payload.hidden) {
              // 快照 hidden 时刻的 app 前台态，供恢复可见时区分成因（见 ref 声明注释）。
              visibilityHiddenAppStateRef.current = AppState.currentState ?? null;
              return;
            }
            const hiddenAppState = visibilityHiddenAppStateRef.current;
            visibilityHiddenAppStateRef.current = null;
            // 仅「hidden 发生在 app 前台期间」判为栈内被盖（不重挂）；后台/未知
            // （null）沿用原脏重挂判据，保守兼容既有行为。
            const coveredWhileForeground = hiddenAppState === 'active';
            const dirty =
              !coveredWhileForeground && statePushSinceResumeRef.current > 0;
            statePushSinceResumeRef.current = 0;
            if (dirty) {
              prevStreamTextRef.current = '';
              prevStreamThinkingRef.current = '';
              forceSnapshotOnReadyRef.current = true;
              webReadyRef.current = false;
              setWebReady(false);
              setRepaintEpoch(epoch => epoch + 1);
            }
            return;
          }
        },
        [
          onReady,
          onLoadOlder,
          onOpenToolFile,
          onLinkClick,
          onOpenSubagentSession,
          onOpenSkillDetail,
          onOpenToolResult,
          onOpenMessageMenu,
          onMessageMenuAction,
          onWebMenuOpenChange,
          onWebMermaidViewerOpenChange,
          onScrollSnapshot,
          uiRunning,
          clearReadyTimeout,
        ],
      );

      /** 划词菜单（D4b 剥离后仅剩「复制」）：nbsp 清洗链保留。 */
      const handleCustomMenuSelection = useCallback(
        (event: {nativeEvent: {key?: string; selectedText?: string}}) => {
          const key = String(event.nativeEvent.key ?? '');
          // selectAll / paste 两项是跨桥动作（下行 selectAll / composerPaste），
          // 随 composer/dock 域剥离删除——menuItems 也退回仅复制，不留死按钮。
          if (uiRunning) {
            return;
          }
          const selectedText = String(event.nativeEvent.selectedText ?? '')
            .replace(/\u00a0/g, ' ')
            .trim();
          if (key === 'copy' && selectedText) {
            Clipboard.setString(selectedText);
          }
        },
        [uiRunning],
      );

      /* ================================================================== *
       * 恢复链（ready → 下行两步固定顺序）
       *   ① init → ② 快照直发
       * 顺序由 effect 声明序保证（同一次 commit 内按声明序执行）。
       * （composer 域的 composerState / 草稿 setText 两步随 D4b 剥离删除：
       *   桥侧 setText / composerState 下行退役，草稿链落点移步原生 composer。）
       *
       * **触发点只有 ready 一个**：调用方按 `key={chatScrollKey}` 重挂本组件，
       * 切会话即销毁重建、所有 ref 重新初始化，故这些 effect 的依赖里**不必**
       * 再列 `sessionKey`。
       * ================================================================== */

      // ① init
      useEffect(() => {
        if (!webReady) {
          return;
        }
        sendInit();
      }, [webReady, sendInit]);

      /* ---- 其余转录域 effects（照搬 ChatTranscriptWebView） ---- */

      useEffect(() => {
        if (!webReady) {
          return;
        }
        // resolvedFlags 已 memo 到两个真值字段，依赖直接引它即可
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
          v: CONVERSATION_BRIDGE_V,
          type: 'flagsUpdate',
          payload: {flags: resolvedFlags},
        });
      }, [webReady, resolvedFlags, postToWeb]);

      // themeUpdate：9 键超集一次下发全文档（init 已带同值时本条会重复一次，
      // 与旧宿主同款——首帧顺序上 themeUpdate 落在恢复链四消息之后，无副作用）
      useEffect(() => {
        if (!webReady) {
          return;
        }
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'themeUpdate',
          payload: {theme: conversationThemeFromTokens(tokens)},
        });
      }, [webReady, tokens, postToWeb]);

      useEffect(() => {
        if (!webReady || menuCloseSignal === 0) {
          return;
        }
        postToWeb({v: CONVERSATION_BRIDGE_V, type: 'closeMenu', payload: {}});
      }, [webReady, menuCloseSignal, postToWeb]);

      useEffect(() => {
        if (!webReady || mermaidViewerCloseSignal === 0) {
          return;
        }
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'closeMermaidViewer',
          payload: {},
        });
      }, [webReady, mermaidViewerCloseSignal, postToWeb]);

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

      // pendingSubagentSessions 变化时 force 重发快照（照搬，注释见旧组件）
      useEffect(() => {
        if (!webReady) {
          return;
        }
        const forceAfterRepaint = forceSnapshotOnReadyRef.current;
        forceSnapshotOnReadyRef.current = false;
        sendSessionSnapshotRef.current(
          'preserve',
          undefined,
          forceAfterRepaint || (pendingSubagentSessions?.size ?? 0) > 0,
        );
      }, [webReady, pendingSubagentSessions]);

      // ② 快照（恢复链最后一步）
      useEffect(() => {
        if (!webReady) {
          return;
        }
        // 无需再判「换会话」：切会话经 `key` 重挂，本组件整体重新初始化，
        // `needsOpenSnapshotRef` 从 true 起、流式基线本来就是空的。
        if (needsOpenSnapshotRef.current) {
          if (messages.length === 0) {
            return;
          }
          needsOpenSnapshotRef.current = false;
          const {intent, restoreScroll} = resolveOpenScrollIntent(
            initialScrollRef.current,
            defaultScrollToBottomRef.current,
          );
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

        if (
          !grew &&
          prevFirstId === firstId &&
          prevCount === messages.length &&
          prevCount > 0
        ) {
          const prevMsgs = prevMessagesRef.current;
          if (prevMsgs != null && prevMsgs.length === messages.length) {
            let hiddenChanged = false;
            for (let i = 0; i < messages.length; i += 1) {
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
          const needsFullSnapshot =
            added.some(messageIsToolResultsOnly) ||
            added.some(
              message =>
                message.role === 'assistant' && messageHasToolUse(message),
            );
          if (needsFullSnapshot) {
            sendSessionSnapshot('preserve', undefined, true);
          } else {
            sendAppendTailRows(added);
          }
        } else if (
          lastStreamCommitIdsRef.current.length > 0 &&
          messages.length === prevMessageCountRef.current &&
          committedStreamRowsStillPresent(
            messages,
            lastStreamCommitIdsRef.current,
          )
        ) {
          lastStreamCommitIdsRef.current = [];
          prevFirstMessageIdRef.current = firstId;
          prevMessageCountRef.current = messages.length;
        } else {
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
       * 导航守卫（sec/D-1）：只放行 **新包目录**内的 file:// 加载；http/https 外跳
       * 系统浏览器并拒绝页内导航，其余 scheme 一律拒绝。外部页面无法在 WebView 内
       * 落地，其 postMessage 伪造桥消息即无从成立。
       */
      const shouldStartLoadWithRequest = useCallback(
        (req: {url: string}): boolean => {
          if (req.url.startsWith(getChatTranscriptPackageDirUri())) {
            return true;
          }
          if (/^https?:\/\//i.test(req.url)) {
            void Linking.openURL(req.url).catch(() => undefined);
          }
          return false;
        },
        [],
      );

      /** iOS window.open / target="_blank" 兜底：拒绝 WebView 内打开，外跳系统浏览器。 */
      const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
        event.preventDefault();
        void Linking.openURL(event.nativeEvent.targetUrl).catch(() => undefined);
      }, []);

      /** T-CU15：onLoad 锚点。每次 onLoad 重新计时。 */
      const handleLoad = useCallback(() => {
        armReadyTimeout();
      }, [armReadyTimeout]);

      /**
       * 首挂 / repaintEpoch 重挂后重新计时（换文档 = 新一轮握手）。
       *
       * 依赖里**没有 `sessionKey`**：切会话由调用方的 `key={chatScrollKey}`
       * 销毁重建整个组件实例（首挂即重新计时），本组件实例存活期内它根本不会变。
       */
      useEffect(() => {
        armReadyTimeout();
      }, [armReadyTimeout, repaintEpoch]);

      const handleReload = useCallback(() => {
        setReadyFailed(false);
        webReadyRef.current = false;
        setWebReady(false);
        setRepaintEpoch(epoch => epoch + 1);
        armReadyTimeout();
      }, [armReadyTimeout]);

      /**
       * 回前台自愈（webview-background-ready-fail）：
       * - 错误态（readyFailed）：WebView 已被 early-return 卸载，onLoad/重挂 effect 都
       *   不会再触发，handleReload 是唯一自洽恢复入口（重置失败态 + 换 key 重挂 + 重新计时）。
       * - 非错误但握手在途（含后台期间计时器到期挂起的）：重新计 8s，把「冻结期」从
       *   计时窗口里剔除。
       * 天然限流：handleReload 置 readyFailed=false 后，后续 active 只走重计时分支，
       * 前后台抖动不会反复重载。
       */
      const handleAppStateChange = useCallback(
        (state: string) => {
          if (state !== 'active') {
            return;
          }
          if (webReadyRef.current) {
            return;
          }
          if (readyFailedRef.current) {
            handleReload();
            return;
          }
          armReadyTimeout();
        },
        [armReadyTimeout, handleReload],
      );

      useEffect(() => {
        const sub = AppState.addEventListener('change', handleAppStateChange);
        return () => {
          sub.remove();
        };
      }, [handleAppStateChange]);

      /**
       * 渲染进程被系统回收/崩溃（webview-background-ready-fail）：webview 库只发事件
       * 不做恢复，WebView 实例残留死态——复用 handleReload 换 key 重建 + 重新握手。
       * onContentProcessDidTerminate 是 iOS 对应物，防御性同接。
       */
      const handleRenderProcessGone = useCallback(() => {
        emitChatTranscriptTelemetry({name: 'render_process_gone'});
        handleReload();
      }, [handleReload]);

      if (readyFailed) {
        return (
          <View style={styles.fill} testID="chat-conversation-ready-error">
            <Text style={{color: tokens.text}}>对话页加载失败</Text>
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              页面加载超时，点重载恢复；若持续出现请重启应用
            </Text>
            <Text
              style={[styles.retry, {color: tokens.primary}]}
              onPress={handleReload}
              testID="chat-conversation-ready-retry">
              重载
            </Text>
          </View>
        );
      }

      return (
        <View style={styles.fill}>
          <WebView
            key={`conversation-repaint-${repaintEpoch}`}
            ref={webRef}
            /* 白屏防线（2026-10-01 切 tab 白屏一闪）：Android WebView 的画面层
               在隐藏/重新可见的窗口里露的是控件自己的原生底色（默认白）。
               背景色设成主题背景后，即使有重建空窗，露的也是主题色、与周围
               融合。走 style：native 控件底色不在 WebView props 白名单里。 */
            style={[styles.fill, {backgroundColor: tokens.background}]}
            /* 首帧主题预注入（白闪 B，fix-D）：文档开始加载前先写 `--bg`。
               Android 侧本注入落在 onPageStarted 上异步执行、输给首绘
               （2026-10-18 录屏取证实锤），确定性通道是 C′（source `#bg=` +
               index.html head 内联 bootstrap，解析期同步执行）；本注入是
               iOS 主通道 + Android 双层兜底。 */
            injectedJavaScriptBeforeContentLoaded={buildThemeInjectScript(
              tokens.background,
            )}
            /* sec/D-1：收紧为包内 file:// */
            originWhitelist={['file://']}
            /* 首帧主题预注入（白闪 C′，fix-D）：URI 追加 `#bg=` hash 参数
               （file:// + query 在部分 WebView 实现会被丢弃，hash 全平台保留），
               供 index.html head 内联 bootstrap 首绘前同步写 `--bg`。
               会话屏消息区冷挂载白窗（2026-10-18 二轮取证）即本链 CSS 兜底
               `var(--bg,#fff)` 的首绘帧。 */
            source={{
              uri:
                getChatTranscriptUri() +
                '#bg=' +
                encodeURIComponent(tokens.background),
            }}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowingReadAccessToURL={getChatTranscriptPackageDirUri()}
            onShouldStartLoadWithRequest={shouldStartLoadWithRequest}
            onOpenWindow={handleOpenWindow}
            onMessage={handleUpstream}
            onLoad={handleLoad}
            /* 渲染进程被系统回收/崩溃（Android onRenderProcessGone / iOS
               onContentProcessDidTerminate）——webview 库只发事件不恢复，换 key 重挂。 */
            onRenderProcessGone={handleRenderProcessGone}
            onContentProcessDidTerminate={handleRenderProcessGone}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
            keyboardDisplayRequiresUserAction={false}
            /* 划词菜单（composer-native-2026-10 D4b 剥离后退回仅复制）：全选/粘贴
               的跨桥落点（selectAll / composerPaste 下行）已随 composer/dock 域
               删除，三项形态不再有落点、留了就是死按钮。transcriptOnly 与否不再
               分叉（该字段仍进 init 载荷，web 侧 CSS 隐藏机制沿用）。 */
            menuItems={[...CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS]}
            onCustomMenuSelection={handleCustomMenuSelection}
          />
        </View>
      );
    },
  ),
  chatConversationWebViewPropsEqual,
);

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0, overflow: 'hidden'},
  hint: {marginTop: 8, fontSize: 13},
  retry: {marginTop: 16, fontSize: 15},
});
