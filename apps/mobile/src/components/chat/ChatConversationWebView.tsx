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
 * **(A) 流式 wire 只有一条通道**：unit 的 stream-batch 经 `pushStream` 进入
 * `pendingWireSegmentsRef`，rAF 合流后由本组件**唯一**分配 `seq`（1 起连续）并发
 * `streamDelta`；块提交 `streamBlockCommit` 复用同一 seq 做对账。宿主不再有
 * defer 队列（Web 侧 `pendingChunkActions` 自己保序），也不再有第二条
 * delta/batch 通道——任何「再开一条」都会重新制造 seq 空洞与双数据面。
 *
 * **(B) ready 只认 `v === 2` + `version === 't2'` + `streamProjection` 能力位**。
 * 旧 dist 的 v:1 ready 被拒 → 走 8s 超时兜底错误态；v2 但版本/能力不符（陈旧 t1
 * dist）→ **立即**错误态。**不得**因为「收到了 ready」就置位 `webReady`：置位了就会
 * 把 v2 协议消息灌进一个根本不认得的页面（静默白屏，比报错更难查）。
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
 *
 * ## 流式投影（chat-streaming-projection Step 4 / C9 wire 段）
 *
 * 宿主是 wire 序号的唯一分配者：`pushStream` → rAF 合流 → `streamDelta{streamId,
 * seq, segments, textHtml, tailHtml, tools?}`；`streamingRows` prop 的最后一条驱动
 * `beginStream/finishStream/resetStream`（status 翻转不走句柄）。`sessionSnapshot`
 * 是唯一全量真源，末片带 `stream{id, seq, status}` 检查点。
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
import {bootTimingLog, rollbackTimingLog, timingLog} from '@/debug/run-timing';
import Clipboard from '@react-native-clipboard/clipboard';
import type {
  ChatTranscriptScrollSnapshot,
  TranscriptFlags,
  TranscriptRestoreScroll,
  TranscriptRow,
  TranscriptRowStatus,
  TranscriptScrollIntent,
  TranscriptSkillRef,
  TranscriptStreamingMessage,
  TranscriptToolView,
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
  selectTailTranscriptRows,
} from './message-blocks';
import {planRowChunkBounds} from './snapshot-chunk-bounds';
import {planSnapshotChunkBounds} from './snapshot-chunk-bounds';
import {planMessagesUpdate} from './chat-conversation-update-plan';
import {planOpenSnapshot} from './chat-conversation-update-plan';
import {
  EMPTY_STREAMING_ROWS,
  EMPTY_STREAM_ROW_IDS,
  applyStreamRowIds,
  buildStreamingTranscriptRow,
} from './transcript-stream-projection';
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
  TRANSCRIPT_CAPABILITY_STREAM_PROJECTION,
  TRANSCRIPT_READY_VERSION,
  transcriptCapabilitiesInclude,
} from '@/web/chat-transcript/transcript-capabilities';
import {createLogger} from '@novel-master/core/log';
import {coreT} from '@/i18n/core';
import {buildTranscriptLabels} from './transcript-labels';
import type {StreamWireChunk} from '@/services/stream-wire-queue';
import {appendWireChunk} from '@/services/stream-wire-queue';
import {CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS} from './chat-transcript-selection-menu';
import type {ChatTranscriptWebViewHandle} from './ChatTranscriptWebViewHandle';

export type {ChatTranscriptWebViewHandle} from './ChatTranscriptWebViewHandle';

const log = createLogger('chat.transcript-host');

/**
 * 宿主句柄 = 转录三命令（`ChatTranscriptWebViewHandle` 逐字复用，方法面不变）。
 *
 * composer 命令式写入（`setComposerText`）随 D4b 剥离删除：composer 域下行
 * `setText` 桥消息退役后该方法失去落点，M7 命令式通道语义由 Step 3 起的
 * `NativeChatComposer` ref 通道承接。`session-stream-webview-adapter` /
 * `ChatTabProvider` / `SubagentSessionScreen` 的转录三命令消费零改动；
 * 中断 partial 由单元 `streamRows` 投影随普通快照下发（不再有独立合成提交通道）。
 *
 * `transcriptOnly` 变体（子会话屏）的行为面断言在
 * `__tests__/chat-conversation-webview.test.tsx` 的 transcriptOnly describe
 * （RN 侧 init 载荷 + memo 比较器）；web 侧旧产物面断言随 chat-conversation
 * 包退役已删（chat-transcript web 侧亦无 dock/transcriptOnly 消费）。
 */
export type ChatConversationWebViewHandle = ChatTranscriptWebViewHandle;

/**
 * 会改变**转录**画面的宿主消息类型；用于「隐藏期间脏推送」计数。
 *
 * 流式投影协议后：`streamDelta` 合并原 delta/batch 两条通道，
 * `streamStatus/streamReset` 取代 `streamCommit/streamToolInvoking`。
 */
const STATE_PAINTING_HOST_MESSAGES: ReadonlySet<string> = new Set([
  'sessionSnapshot',
  'prependPage',
  'appendTailRows',
  'streamDelta',
  'streamBlockCommit',
  'streamStatus',
  'streamReset',
  'flagsUpdate',
]);

/**
 * 渲染块级化默认开关（回滚开关，语义照搬 ChatTranscriptWebView）：
 * 运行时以 ready 上报的 capabilities 覆盖——未声明 `streamBlockCommit` 的旧 dist
 * 一律按不支持处理（块提交会被静默丢弃、流中只剩尾块）。
 */
const STREAM_BLOCK_RENDER_ENABLED = true;

/**
 * 流式投影回滚闸（spec §6.5 / C9 第 15 条）：false 时 `streamingRows` 与
 * `streamRowIds` 全按空处理——快照只发 DB 行、行 id 保持 DB id、不发任何
 * 流式消息。只影响本轮新增代码，不复活旧双数据面。
 */
const STREAM_PROJECTION_ENABLED = true;

/**
 * ready 超时兜底窗口（spec T-CU15，锚 **onLoad** 而非 init）。
 *
 * 锚 init 是时序死锁：init 本身要等 ready 才发。白屏的成因链是「旧 dist 发不出
 * v2 ready → webReady 永假 → 全部下行丢弃」，因此这里只做**兜底**：超时即渲染
 * 错误态 + 提示重载，而不是依赖 ready 门控本身发现。
 */
const READY_TIMEOUT_MS = 8000;

type ChatConversationWebViewProps = {
  readonly sessionKey: string;
  readonly messages: readonly ChatMessageData[];
  /**
   * 流式行投影（copy-on-write 数组）：最后一条是当前 streaming 行，前面可能
   * 还有 finished-未接管行。空会话 run 启动时据此发只含流式行的开屏快照。
   */
  readonly streamingRows?: readonly TranscriptStreamingMessage[];
  /** DB message id → streamId 的接管映射（DB 行改写为流式行身份用）。 */
  readonly streamRowIds?: ReadonlyMap<string, string>;
  readonly hasMore?: boolean;
  readonly flags?: Partial<TranscriptFlags>;
  readonly initialScroll?: ChatTranscriptScrollSnapshot | null;
  /** No cached snapshot: open pinned to bottom. */
  readonly defaultScrollToBottom?: boolean;
  readonly agentRunning?: boolean;
  /** 菜单禁用与流式快照；未传时回退 agentRunning。 */
  readonly uiRunning?: boolean;
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

/**
 * memo 比较器：转录域照旧（composer 域已随 D4b 剥离，比较面只剩转录字段）。
 *
 * 历史教训（spec 记过一次踩坑史）：`pendingSubagentSessions` 漏加 → 静默吞更新。
 * 往本比较器加字段时逐个入列，漏一个就是「改了没生效」且无任何报错。
 *
 * nm-style: keep-local — 比较器是 props 契约的逐字段登记表（漏字段 = 静默吞更新），
 * 内联成 memo 第二参不消除任何层，且比较面必须保持命名以便逐字段审阅与回归引用。
 */
function chatConversationWebViewPropsEqual(
  prev: ChatConversationWebViewProps,
  next: ChatConversationWebViewProps,
): boolean {
  return (
    // ---- 转录域（照 ChatTranscriptWebView 原样） ----
    prev.sessionKey === next.sessionKey &&
    prev.messages === next.messages &&
    prev.streamingRows === next.streamingRows &&
    prev.streamRowIds === next.streamRowIds &&
    prev.hasMore === next.hasMore &&
    prev.agentRunning === next.agentRunning &&
    (prev.uiRunning ?? prev.agentRunning) ===
      (next.uiRunning ?? next.agentRunning) &&
    prev.defaultScrollToBottom === next.defaultScrollToBottom &&
    prev.menuCloseSignal === next.menuCloseSignal &&
    prev.mermaidViewerCloseSignal === next.mermaidViewerCloseSignal &&
    prev.initialScroll === next.initialScroll &&
    (prev.flags?.richText ?? false) === (next.flags?.richText ?? false) &&
    (prev.flags?.menuDisabled ?? false) ===
      (next.flags?.menuDisabled ?? false) &&
    prev.pendingSubagentSessions === next.pendingSubagentSessions &&
    // ---- 变体（transcript-converge）：漏比会吞掉子会话屏的降级形态 ----
    prev.transcriptOnly === next.transcriptOnly
  );
}

/**
 * init / themeUpdate 的主题载荷即 `conversationThemeFromTokens(tokens)` 的产物
 * （映射本体在 `conversation-theme.ts`，与原生 composer 共用一份）。
 */

/** 上一拍最后一条流式行的身份（text 每拍变，不进依赖，只按 id/status/messageId 差分）。 */
type LastStreamSnapshot = {
  readonly id: string;
  readonly status: TranscriptRowStatus;
  readonly messageId: string | null;
  readonly isEmpty: boolean;
};

/** 一次块切分的提交批（postStreamBlockSplits 的唯一入参）。 */
type SplitBatch = {
  readonly splits: readonly PendingStreamBlockSplit[];
  readonly streamId: string;
  readonly seq: number;
};

/** 一块切分的产物：完成块（html+text）、尾块 html 与尾块 text。 */
type PendingStreamBlockSplit = {
  readonly kind: 'text' | 'thinking';
  readonly commits: {html?: string; text: string}[];
  readonly tailHtml?: string;
  readonly tailText: string;
};

/** 待发 wire 段队列（单一队列，带归属 streamId；flush 后清空 segments）。 */
type PendingWire = {streamId: string | null; segments: StreamWireChunk[]};

/** pushStream 入参（unit 的 stream-batch 原样透传）。 */
type PushStreamPayload = {
  readonly streamId: string;
  readonly segments: readonly StreamWireChunk[];
  readonly tools?: readonly TranscriptToolView[];
};

/** 快照直发入口（ref 保存当拍闭包；`null` 未挂载）。 */
type SendSnapshot = (
  intent: TranscriptScrollIntent,
  restore?: TranscriptRestoreScroll,
) => void;

/** 快照末片的流检查点（payload.stream）。 */
type StreamCheckpoint = {id: string; seq: number; status: TranscriptRowStatus};

/** 快照分片代次（模块级单调递增计数器，见 ChatTranscriptWebView 同款注释）。 */
let snapshotGenerationCounter = 0;

/** streamResync 宿主侧限流窗口（spec T-SP29）：同 streamId 100ms 内只补一次快照。 */
const STREAM_RESYNC_MIN_INTERVAL_MS = 100;

/** 全量正文 html = 已提交块 html 缓存 + 活跃尾块 html（空串降级为 undefined）。 */
function joinStreamHtml(parts: readonly string[], tail?: string) {
  const full = parts.join('') + (tail ?? '');
  return full.length > 0 ? full : undefined;
}

/** 已提交块正文 + 活跃尾块（宿主累加器口径的当前全量文本）。 */
function accumulated(parts: readonly string[], tail: string) {
  return parts.join('') + tail;
}

/**
 * 稳定身份回调：deps 表在 prettier 80 列下必然拆行，与 check-signatures 的
 * 「调用写一行」互斥；而 eslint react-hooks/exhaustive-deps 只接受**字面量**
 * 依赖数组（传变量会报 "not an array literal"）。这里用 ref 持有最新实现，
 * 调用点保持单行 + 空依赖字面量，身份稳定且总是读到当拍闭包。
 */
function useLatest<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

export const ChatConversationWebView = memo(
  forwardRef<ChatConversationWebViewHandle, ChatConversationWebViewProps>(
    function ChatConversationWebView(
      {
        sessionKey,
        messages,
        streamingRows: streamingRowsProp,
        streamRowIds: streamRowIdsProp,
        hasMore = false,
        flags,
        initialScroll = null,
        defaultScrollToBottom = true,
        agentRunning = false,
        uiRunning: uiRunningProp,
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
      // 回滚闸：false 时按「无流式行 / 无映射」处理（快照只发 DB 行）。
      const rowsProp = STREAM_PROJECTION_ENABLED ? streamingRowsProp : null;
      const streamingRows = rowsProp ?? EMPTY_STREAMING_ROWS;
      const idsProp = STREAM_PROJECTION_ENABLED ? streamRowIdsProp : null;
      const streamRowIds = idsProp ?? EMPTY_STREAM_ROW_IDS;
      const hasStreamingMessage = streamingRows.length > 0;
      /** 投影最后一条（当前 streaming 行；status 翻转 effect 的依赖源）。 */
      const lastIdx = streamingRows.length - 1;
      const lastStreamingRow = lastIdx >= 0 ? streamingRows[lastIdx]! : null;

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

      /**
       * 本次 hidden 期间的改画推送计数（P2-14）：hidden:true 到达时清零，
       * 恢复可见时读取——只统计 hidden 期间，可见期间的历史推送不参与
       * 「hidden 零推送」判定。
       */
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
      const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
      const prevMessageCountRef = useRef(0);
      const prevRichTextRef = useRef(flags?.richText ?? false);
      const prevMessagesRef = useRef(messages);
      /**
       * 快照构建只读 ref（C9 第 4 条）：`streamingRows` 每 64ms 换引用，若进
       * 依赖数组会让发快照的 effect 被反复触发；渲染期写 ref 保证快照拿到当拍值。
       */
      const streamingRowsRef = useRef(streamingRows);
      streamingRowsRef.current = streamingRows;
      const prevSentFlagsRef = useRef<TranscriptFlags | null>(null);
      const lastScrollRef = useRef({nearBottom: true, offsetY: 0});
      const initialScrollRef = useRef(initialScroll);
      const defaultScrollToBottomRef = useRef(defaultScrollToBottom);
      const needsOpenSnapshotRef = useRef(true);
      /* ---- 流式 wire（C9）：宿主唯一 seq 分配 + rAF 合流 ---- */
      const streamRafRef = useRef<number | null>(null);
      /** 待发 segments（单一队列，带归属 streamId；beginStream 切流前先 flush）。 */
      const initialPendingWire: PendingWire = {streamId: null, segments: []};
      const pendingWireSegmentsRef = useRef<PendingWire>(initialPendingWire);
      const streamTextAccumRef = useRef('');
      const streamThinkingAccumRef = useRef('');
      const committedTextPartsRef = useRef<string[]>([]);
      const committedThinkingPartsRef = useRef<string[]>([]);
      /** 已提交块的 html 缓存（与 parts 一一对应；P2-10 全量 html 免重复 parse）。 */
      const committedTextHtmlPartsRef = useRef<string[]>([]);
      const committedThinkingHtmlPartsRef = useRef<string[]>([]);
      const streamToolsRef = useRef<readonly TranscriptToolView[]>([]);
      const streamToolsDirtyRef = useRef(false);
      /** 当前流的 wire 序号（1 起连续；新流从 0 重新开始）。 */
      const streamWireSeqRef = useRef(0);
      const streamIdRef = useRef<string | null>(null);
      /** 本宿主最后见过的 streamId（reset 清 streamIdRef 后仍保留，供迟到 status 判旧）。 */
      const lastStreamIdRef = useRef<string | null>(null);
      /** 块级渲染武装位：新 step / 空 streaming 行为 true，快照 seed 有内容后 false。 */
      const streamBlockArmedRef = useRef(false);
      /** 块提交序号（blockKey = `<streamId>:<kind>:<ordinal>`）。 */
      const streamBlockCommitOrdinalRef = useRef(0);
      const streamBlockCapableRef = useRef(false);
      const richTextRef = useRef(flags?.richText ?? false);
      /** 快照分片代次（唯一消费者：sendSessionSnapshotNow 的片间中止检查）。 */
      const activeSnapshotGenerationRef = useRef<number | null>(null);
      /** streamResync 宿主侧 100ms 限流（streamId → performance.now）。 */
      const resyncSentAtRef = useRef<Map<string, number>>(new Map());
      /** 上一拍最后一条流式行的身份（status 翻转 effect 的差分基准）。 */
      const lastStreamSnapshotRef = useRef<LastStreamSnapshot | null>(null);
      /** 快照直发入口（供 beginStream / streamResync / forceSnapshot 读当拍闭包）。 */
      const sendSessionSnapshotRef = useRef<SendSnapshot | null>(null);

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

      useEffect(() => {
        richTextRef.current = flags?.richText ?? false;
      }, [flags?.richText]);

      useEffect(() => {
        initialScrollRef.current = initialScroll;
      }, [initialScroll]);

      useEffect(() => {
        defaultScrollToBottomRef.current = defaultScrollToBottom;
      }, [defaultScrollToBottom]);

      /** 唯一的下行出口（不再有宿主侧 defer 队列：Web 的 pendingChunkActions 自保序）。 */
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
       * 块感知切分（照搬 ChatTranscriptWebView）：完成块移入 committed、accum 改成
       * activeTail；每块 html 同步缓存进 `streamCommitted*HtmlPartsRef`（P2-10：全量
       * html 用「committedHtml.join('') + tailHtml」拼，不重复 parse 已提交块）。
       * 未武装（快照 seed 后）/未声明能力时恒返回 []。
       *
       * nm-style: keep-local — 逐 kind 读写四组 ref（accum / committed / committedHtml
       * / 武装位），"切分并把完成块搬到 committed"是独立的状态阶段；内联会把 8 处
       * ref 读写摊回 flush 调用点。
       */
      const takeSplits = (): PendingStreamBlockSplit[] => {
        if (
          !streamBlockArmedRef.current ||
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
            committed: committedTextPartsRef,
            committedHtml: committedTextHtmlPartsRef,
          },
          {
            kind: 'thinking' as const,
            tail: streamThinkingAccumRef,
            committed: committedThinkingPartsRef,
            committedHtml: committedThinkingHtmlPartsRef,
          },
        ];
        for (const {kind, tail, committed, committedHtml} of kinds) {
          const {blocks, activeTail} = splitStreamBlocks(tail.current);
          if (blocks.length === 0) {
            continue;
          }
          tail.current = activeTail;
          committed.current.push(...blocks);
          const commits = blocks.map(block => {
            const html = prepareStreamTailHtml(block, true);
            committedHtml.current.push(html ?? '');
            return {html, text: block};
          });
          splits.push({
            kind,
            commits,
            tailHtml: prepareStreamTailHtml(activeTail, true),
            tailText: activeTail,
          });
        }
        return splits;
      };
      const takeStreamBlockSplits = useCallback(takeSplits, []);

      /**
       * 块提交上行：blockKey 序号与每 kind 尾块标记必须和一次切分绑定。
       *
       * nm-style: keep-local — 序号递进（streamBlockCommitOrdinalRef）与尾块归属
       * 是同一次切分内的不变量，内联会让 ++ 散落在 flush 调用点。
       */
      const postBlockSplits = (batch: SplitBatch): void => {
        const {splits, streamId, seq} = batch;
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
                streamId,
                seq,
                blockKey: `${streamId}:${
                  split.kind
                }:${++streamBlockCommitOrdinalRef.current}`,
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
      };
      const postStreamBlockSplits = useCallback(postBlockSplits, [postToWeb]);

      /**
       * 把 rAF 队列里的 segments/tools 合流成**一条** `streamDelta`（seq 在此唯一
       * 分配）。块切分先于 html 计算：完成块移入 committed、accum 只剩活跃尾块。
       *
       * nm-style: keep-local — wire seq 分配（streamWireSeqRef）、待发队列摘取与
       * 累加器→html 的换算必须同拍完成；内联到 pushStream / 快照 / reset 会复制
       * 「谁先 flush 谁占小 seq」这条协议不变量。
       */
      const flushPendingStream = (): void => {
        if (streamRafRef.current != null) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        const pending = pendingWireSegmentsRef.current;
        if (pending.segments.length === 0 && !streamToolsDirtyRef.current) {
          return;
        }
        const streamId = pending.streamId ?? streamIdRef.current;
        const segments = pending.segments;
        pending.segments = [];
        if (streamId == null || !webReadyRef.current) {
          streamToolsDirtyRef.current = false;
          return;
        }
        pending.streamId = streamId;
        const blockSplits = takeStreamBlockSplits();
        const richText = richTextRef.current;
        const liveText = streamTextAccumRef.current;
        const liveThinking = streamThinkingAccumRef.current;
        const tailHtml = prepareStreamTailHtml(liveText, richText);
        const tailThinking = prepareStreamTailHtml(liveThinking, richText);
        const textParts = committedTextHtmlPartsRef.current;
        const thinkingParts = committedThinkingHtmlPartsRef.current;
        const textHtml = joinStreamHtml(textParts, tailHtml);
        const thinkingHtml = joinStreamHtml(thinkingParts, tailThinking);
        const seq = ++streamWireSeqRef.current;
        const toolsDirty = streamToolsDirtyRef.current;
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'streamDelta',
          payload: {
            streamId,
            seq,
            segments: segments.map(seg => ({
              kind: seg.kind,
              delta: seg.delta,
            })),
            ...(textHtml != null ? {textHtml} : {}),
            ...(thinkingHtml != null ? {thinkingHtml} : {}),
            ...(tailHtml != null ? {tailHtml} : {}),
            ...(tailThinking != null ? {thinkingTailHtml: tailThinking} : {}),
            ...(toolsDirty ? {tools: streamToolsRef.current} : {}),
          },
        });
        streamToolsDirtyRef.current = false;
        postStreamBlockSplits({splits: blockSplits, streamId, seq});
      };
      const flushPendingStreamNow = useLatest(flushPendingStream);

      /**
       * 切到新流：先把旧流的尾 delta 按旧 seq 发完，再用投影行播种累加器。
       * **幂等**：`pushStream` 抢先建流后 effect 不得再重置累加器（会丢掉已入队
       * 的 delta）。
       *
       * nm-style: keep-local — 切流时 seq 归零、五组累加器/块状态复位与投影行
       * 播种是同一条不变量；内联进 pushStream 后活效应无法复用同一段复位。
       */
      const beginStreamNow = (streamId: string): void => {
        if (streamIdRef.current === streamId) {
          if (
            streamWireSeqRef.current === 0 &&
            lastStreamIdRef.current === streamId &&
            streamingRowsRef.current.some(item => item.streamId === streamId)
          ) {
            // 同 id 的旧行已在文档里（cp.seq 可能大于 0）：先补一份快照对账，
            // 否则后续新 delta 会因「seq <= applied」被全部 ignore。
            const where = `stream begin: existing row ${streamId}`;
            bootTimingLog(`${where} at wire seq 0, forcing snapshot`);
            sendSessionSnapshotRef.current?.('preserve');
          }
          return;
        }
        flushPendingStreamNow();
        streamIdRef.current = streamId;
        lastStreamIdRef.current = streamId;
        streamWireSeqRef.current = 0;
        committedTextPartsRef.current = [];
        committedThinkingPartsRef.current = [];
        committedTextHtmlPartsRef.current = [];
        committedThinkingHtmlPartsRef.current = [];
        streamToolsDirtyRef.current = false;
        streamBlockCommitOrdinalRef.current = 0;
        const rows = streamingRowsRef.current;
        const hit = rows.find(item => item.streamId === streamId);
        const row = hit ?? null;
        streamTextAccumRef.current = row?.text ?? '';
        streamThinkingAccumRef.current = row?.thinking ?? '';
        streamToolsRef.current = row?.tools ?? [];
        // 新 step 重新允许块切分；Web 侧块状态由快照换主复位。
        streamBlockArmedRef.current = true;
        pendingWireSegmentsRef.current = {streamId, segments: []};
      };
      const beginStream = useLatest(beginStreamNow);

      /**
       * 单元 stream-batch 的唯一入口：同拍把 segments 累加进正文/思考，入队待
       * rAF 合流；tools 有值即标记 dirty（下一拍 delta 携带完整工具数组）。
       *
       * nm-style: keep-local — segments 入队 + 累加器/工具数组/合流排程三者共享
       * 同一拍状态（rAF 句柄与 pending 队列），内联会把它摊进句柄与效应两处。
       */
      const pushStreamNow = (payload: PushStreamPayload): void => {
        if (!STREAM_PROJECTION_ENABLED || !webReadyRef.current) {
          return;
        }
        const {streamId, segments, tools} = payload;
        if (streamId !== streamIdRef.current) {
          beginStream(streamId);
        }
        pendingWireSegmentsRef.current.streamId = streamId;
        let queued = 0;
        for (const segment of segments) {
          if (segment.delta.length === 0) {
            continue;
          }
          if (segment.kind === 'text') {
            streamTextAccumRef.current += segment.delta;
          } else {
            streamThinkingAccumRef.current += segment.delta;
          }
          appendWireChunk(pendingWireSegmentsRef.current.segments, segment);
          queued += 1;
        }
        if (tools != null) {
          streamToolsRef.current = tools;
          streamToolsDirtyRef.current = true;
        }
        if (queued > 0 || tools != null) {
          if (streamRafRef.current == null) {
            streamRafRef.current = requestAnimationFrame(() => {
              streamRafRef.current = null;
              flushPendingStreamNow();
            });
          }
        }
      };
      const pushStream = useLatest(pushStreamNow);

      /**
       * 收尾只改 status，且**必带全量终态行**（多块 richText 下不能只带尾块，
       * P0-1）。先 flush 保证尾 delta 的 seq 小于 status 引用的 seq。
       *
       * nm-style: keep-local — 终态行必须同时读宿主累加器（committed + 活跃尾块）
       * 与最后一条 props 行，且先 flush 才能保证尾 delta 的 seq 小于 status 引用
       * 的 seq；这三条 ref 的读取顺序就是终态消息的协议不变量。
       */
      const finishStreamNow = (streamId: string): void => {
        flushPendingStreamNow();
        const rows = streamingRowsRef.current;
        const hit = rows.find(item => item.streamId === streamId);
        const found = hit ?? null;
        const isCurrent = streamId === streamIdRef.current;
        if (found == null && !isCurrent) {
          // 行已被快照收走：旧 step 的迟到 status 直接忽略（终态行由
          // messages effect 的 stream-adopted 发送）。
          return;
        }
        const textParts = committedTextPartsRef.current;
        let text = found?.text ?? '';
        if (isCurrent) {
          text = accumulated(textParts, streamTextAccumRef.current);
        }
        const thinkingParts = committedThinkingPartsRef.current;
        let thinking = found?.thinking ?? '';
        if (isCurrent) {
          thinking = accumulated(thinkingParts, streamThinkingAccumRef.current);
        }
        const finished: TranscriptStreamingMessage = {
          streamId,
          status: 'finished',
          text,
          thinking,
          tools: streamToolsRef.current,
          messageId: null,
        };
        let message = finished;
        if (found != null) {
          message = {...found, status: 'finished'};
        }
        const body = {text, thinking};
        const richText = richTextRef.current;
        const row = buildStreamingTranscriptRow(message, richText, body);
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'streamStatus',
          payload: {
            streamId,
            status: 'finished',
            ...(message.messageId != null
              ? {messageId: message.messageId}
              : {}),
            row,
          },
        });
      };
      const finishStream = useLatest(finishStreamNow);

      /**
       * 消息操作（rollback/fork）清流：新代次作废在途旧快照（防 reset 后复活）。
       *
       * nm-style: keep-local — 十七组流式 ref（seq / 累加器 / committed / 块序号 /
       * 武装位）必须在同一次清场里原子复位；内联到两个调用点会复制状态机。
       */
      const resetStreamNow = (streamIds?: readonly string[]): void => {
        // 回滚闸关闭时不发任何流式消息（行 id 保持 DB id，由快照对账）。
        if (!STREAM_PROJECTION_ENABLED) {
          return;
        }
        const active = streamIdRef.current;
        const filtered = streamIds != null && active != null;
        const dropsActive = !filtered || streamIds!.includes(active!);
        if (dropsActive) {
          if (streamRafRef.current != null) {
            cancelAnimationFrame(streamRafRef.current);
            streamRafRef.current = null;
          }
          pendingWireSegmentsRef.current = {streamId: null, segments: []};
          streamWireSeqRef.current = 0;
          streamTextAccumRef.current = '';
          streamThinkingAccumRef.current = '';
          committedTextPartsRef.current = [];
          committedThinkingPartsRef.current = [];
          committedTextHtmlPartsRef.current = [];
          committedThinkingHtmlPartsRef.current = [];
          streamToolsRef.current = [];
          streamToolsDirtyRef.current = false;
          streamBlockArmedRef.current = false;
          streamBlockCommitOrdinalRef.current = 0;
          streamIdRef.current = null;
        }
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'streamReset',
          payload: {streamIds, generation: ++snapshotGenerationCounter},
        });
      };
      const resetStream = useLatest(resetStreamNow);

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
            // 转录渲染层文案（spec §2.2.8）：4 个 `label.transcript.*` 经 core
            // i18n 取值；web 缺省回退内置中文常量。
            labels: buildTranscriptLabels(coreT),
            // 转录 only 变体（transcript-converge）：web 据此隐藏 dock。
            ...(transcriptOnly ? {transcriptOnly: true} : {}),
          },
        });
      }, [postToWeb, transcriptOnly]);

      /**
       * 快照分片化（唯一全量真源）：
       * - DB 行按 50 行 / 256KB 分片，行 id 经接管映射改写为流式行身份；
       * - 有流式行时追加只装流式行的片（同预算），末片携带 `stream` 检查点；
       * - 开头与流式片前都 `flushPendingStreamNow()`（尾 delta 的 seq 必须先于快照）；
       * - 开头捕获 `streamingRows`：片间 DB 接管把某行从投影剔除时，本次快照
       *   仍带上它（不丢行），下一次快照再按映射对账；每片发送前再与当前
       *   `streamingRowsRef` 按 id 合并，快照开始后新启动的 step 行也不丢；
       * - 快照 seed 后的块状态：最后一条 streaming 有内容 → disarm（后续只发全量
       *   textHtml）；空 streaming（新 step）→ 保持 armed（允许块切分）。
       */
      const sendSessionSnapshotNow = useCallback(
        async (
          scrollIntent: TranscriptScrollIntent,
          restoreScroll?: TranscriptRestoreScroll,
        ) => {
          const snapshotMessages = messages;
          const richText = flags?.richText ?? false;
          const snapshotSessionKey = sessionKey;
          const snapshotHasMore = hasMore;
          // 在途 rAF 的尾 delta 必须先以更小 seq 发出（快照 checkpoint 才能覆盖它）。
          flushPendingStreamNow();
          const streamRowsAtStart = streamingRowsRef.current;
          const generation = ++snapshotGenerationCounter;
          activeSnapshotGenerationRef.current = generation;
          rollbackTimingLog(
            `snapshot build begin (msgs=${snapshotMessages.length})`,
          );
          const ctx = buildToolPairingContext(snapshotMessages);
          const opts = transcriptListOptions;
          // 发片时都重取「捕获行 + 当前行」的合并结果（spec C9 第 7 条）：
          // 快照是异步分片的，期间新 step 启动会往 `streamingRowsRef` 追加新 id。
          // 当前行覆盖捕获行、新 id 按捕获序之后追加；分片边界仍用开头规划的
          // 预算（chunkTotal 已随 DB 片发出，不能中途变），末尾新增行由**最后
          // 一个流式片**兜住，保证本次快照不丢行。
          const currentStreamRows = () => {
            const captured = streamRowsAtStart;
            const current = streamingRowsRef.current;
            if (captured === current) {
              return current;
            }
            const merged = [...captured];
            const pairs = merged.map((row, i) => [row.streamId, i] as const);
            const indexById = new Map(pairs);
            for (const message of current) {
              const index = indexById.get(message.streamId);
              if (index == null) {
                indexById.set(message.streamId, merged.length);
                merged.push(message);
                continue;
              }
              merged[index] = message;
            }
            return merged;
          };
          /** 流式投影行 → wire 行（正文/思考优先取宿主累加器）。 */
          const toWireRow = (message: TranscriptStreamingMessage) => {
            if (message.streamId !== streamIdRef.current) {
              return buildStreamingTranscriptRow(message, richText, undefined);
            }
            const textParts = committedTextPartsRef.current;
            const thinkingParts = committedThinkingPartsRef.current;
            const textTail = streamTextAccumRef.current;
            const thinkingTail = streamThinkingAccumRef.current;
            const text = accumulated(textParts, textTail);
            const thinking = accumulated(thinkingParts, thinkingTail);
            const body = {text, thinking};
            return buildStreamingTranscriptRow(message, richText, body);
          };
          const initialStreamRows = currentStreamRows();
          // 空会话但已有流式行：只发流式片，不额外发空 DB 片。
          const noDbRows = snapshotMessages.length === 0;
          const onlyStream = noDbRows && initialStreamRows.length > 0;
          const planned = planSnapshotChunkBounds(snapshotMessages);
          const dbChunkBounds = onlyStream ? [] : planned;
          const streamWireRows = initialStreamRows.map(toWireRow);
          const streamChunkBounds = planRowChunkBounds(streamWireRows);
          const dbChunkCount = dbChunkBounds.length;
          const chunkTotal = dbChunkCount + streamChunkBounds.length;
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
                activeSnapshotGenerationRef.current !== generation ||
                !webReadyRef.current
              ) {
                bootTimingLog(
                  `snapshot gen=${generation} aborted at chunk ${chunkIndex}/${chunkTotal} (superseded or remount)`,
                );
                return;
              }
              let rows: readonly TranscriptRow[];
              // 每片都重取合并结果（快照期间新 step 启动 → 新 id 追加在末尾，
              // 由最后一个流式片兜住，见上方 `currentStreamRows` 注释）。
              const streamRowsForChunk = currentStreamRows();
              if (chunkIndex < dbChunkCount) {
                const [start, end] = dbChunkBounds[chunkIndex]!;
                const part = snapshotMessages.slice(start, end);
                const built = buildTranscriptRowsWithContext(part, ctx, opts);
                const enriched = enrichTranscriptRows(built, richText);
                rows = applyStreamRowIds(enriched, streamRowIds);
              } else {
                // 流式片前再 flush：快照期间新到的 delta 必须先以更小 seq 发出。
                flushPendingStreamNow();
                const idx = chunkIndex - dbChunkCount;
                const [start, end] = streamChunkBounds[idx]!;
                const wireRows = streamRowsForChunk.map(toWireRow);
                if (idx === streamChunkBounds.length - 1) {
                  rows = wireRows.slice(start);
                } else {
                  rows = wireRows.slice(start, end);
                }
              }
              const n = streamRowsForChunk.length;
              const tailRow = n > 0 ? streamRowsForChunk[n - 1]! : null;
              let seq = 0;
              if (tailRow != null && tailRow.streamId === streamIdRef.current) {
                // 该 streamId 自己的 wire seq（不能跨流复用全局计数）。
                seq = streamWireSeqRef.current;
              }
              let streamCp: StreamCheckpoint | null = null;
              if (tailRow != null) {
                const {streamId: id, status} = tailRow;
                streamCp = {id, seq, status};
              }
              const isLastChunk = chunkIndex === chunkTotal - 1;
              postToWeb({
                v: CONVERSATION_BRIDGE_V,
                type: 'sessionSnapshot',
                payload: {
                  sessionKey: snapshotSessionKey,
                  rows,
                  hasMore: snapshotHasMore,
                  ...(streamCp != null ? {stream: streamCp} : {}),
                  ...(isLastChunk ? {scrollIntent} : {}),
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
                `snapshot chunk ${chunkIndex + 1}/${chunkTotal} posted (rows=${
                  rows.length
                })`,
              );
              if (!isLastChunk) {
                await yieldFn();
              }
            }
            // 快照 seed 后的块状态（宿主侧规则，与 Web 的 fullReplaceOnly 同一条）：
            // 有内容的 streaming 行 → 后续只发全量 html；空 streaming → 允许块切分。
            // 当前流的内容以累加器为准（props 行可能落后于已 flush 的 delta）。
            const finalRows = currentStreamRows();
            const finalCount = finalRows.length;
            const lastIx = finalCount - 1;
            const lastFinal = lastIx >= 0 ? finalRows[lastIx]! : null;
            const finalStreamId = lastFinal?.streamId;
            const isFinal = finalStreamId === streamIdRef.current;
            const textParts = committedTextPartsRef.current;
            const thinkingParts = committedThinkingPartsRef.current;
            const textTail = streamTextAccumRef.current;
            const thinkingTail = streamThinkingAccumRef.current;
            const liveText = accumulated(textParts, textTail);
            const liveThinking = accumulated(thinkingParts, thinkingTail);
            const liveToolCount = streamToolsRef.current.length;
            const prevText = lastFinal?.text ?? '';
            const prevThinking = lastFinal?.thinking ?? '';
            const prevTools = lastFinal?.tools.length ?? 0;
            let textNow = prevText;
            if (isFinal) textNow = liveText;
            let thinkingNow = prevThinking;
            if (isFinal) thinkingNow = liveThinking;
            let toolCountNow = prevTools;
            if (isFinal) toolCountNow = liveToolCount;
            const noText = textNow.length === 0;
            const noThinking = thinkingNow.length === 0;
            const empty = noText && noThinking && toolCountNow === 0;
            const streaming = isFinal && lastFinal!.status === 'streaming';
            streamBlockArmedRef.current = streaming && empty;
            bootTimingLog(`snapshot all chunks done (gen=${generation})`);
            rollbackTimingLog(
              `snapshot all chunks done (gen=${generation}, chunks=${chunkTotal})`,
            );
            onSnapshotComplete?.();
          } finally {
            if (activeSnapshotGenerationRef.current === generation) {
              activeSnapshotGenerationRef.current = null;
            }
          }
        },
        [
          messages,
          hasMore,
          postToWeb,
          sessionKey,
          flags?.richText,
          streamRowIds,
          onSnapshotComplete,
          transcriptListOptions,
          flushPendingStreamNow,
        ],
      );

      useEffect(() => {
        sendSessionSnapshotRef.current = sendSessionSnapshotNow;
      });

      const sendAppendTailRows = useCallback(
        (tail: readonly ChatMessageData[]) => {
          const richText = flags?.richText ?? false;
          const opts = transcriptListOptions;
          const picked = selectTailTranscriptRows(messages, tail, opts);
          const enriched = enrichTranscriptRows(picked, richText);
          const rows = applyStreamRowIds(enriched, streamRowIds);
          if (rows.length === 0) {
            return;
          }
          postToWeb({
            v: CONVERSATION_BRIDGE_V,
            type: 'appendTailRows',
            payload: {rows},
          });
        },
        [
          postToWeb,
          flags?.richText,
          messages,
          streamRowIds,
          transcriptListOptions,
        ],
      );

      const transcriptHandle: ChatConversationWebViewHandle = {
        pushStream,
        resetStream,
        forceSnapshot: () => sendSessionSnapshotRef.current?.('preserve'),
      };
      // 句柄对象每拍重建、方法本身稳定（useLatest），用 ref 让命令式入口恒读当拍对象。
      const handleRef = useRef(transcriptHandle);
      handleRef.current = transcriptHandle;
      useImperativeHandle(ref, () => handleRef.current, []);

      /* ---- 上行分发：每域一个 handler，依赖即该域闭包契约（见 handleUpstream） ---- */

      /**
       * ready 处理：版本/能力门（spec §6.2 / C3 / T-SP20）+ 累加器播种（C9 第 10 条）。
       *
       * 版本门：v2 信封只说明语言对得上，旧 t1 dist 不认识流式投影协议——进了
       * webReady 会把 streamDelta/streamStatus 灌进不认得的页面（半认：只在
       * step 边界补文本）。缺 streamProjection 同样按旧 dist 处理：立即错误态，
       * 比静默白屏可诊断（纪律 B）。约束只有 dist 与宿主同包构建，所以这里拒绝的
       * 一定是拼包/陈旧资源，重载也没用。
       *
       * 播种：新文档的正文由快照全量 seed，后续 delta 走全量 `textHtml` 替换，
       * 不再发块提交——否则块提交会把快照已有的完成块再 append 一次（重复 DOM）。
       * 下一个新 step 的 beginStream 重新武装块模式。seq 不重置：后续 delta 从
       * 快照的 seq+1 继续。
       *
       * nm-style: keep-local — 版本门与「新文档基线」播种共享同一握手生命周期
       * （webReady/clearReadyTimeout 与四组 committed ref 同时归零），内联到
       * onMessage 的 case 会把手势拆成两段。
       */
      const handleReadyNow = (payload: Record<string, unknown>): void => {
        const caps = readReadyCapabilities(payload);
        const projection = TRANSCRIPT_CAPABILITY_STREAM_PROJECTION;
        const blockCommit = TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT;
        if (
          payload.version !== TRANSCRIPT_READY_VERSION ||
          !transcriptCapabilitiesInclude(caps, projection)
        ) {
          webReadyRef.current = false;
          setWebReady(false);
          clearReadyTimeout();
          setReadyFailed(true);
          log.error('incompatible transcript dist', {
            version: payload.version,
            capabilities: caps,
          });
          return;
        }
        webReadyRef.current = true;
        setWebReady(true);
        setReadyFailed(false);
        clearReadyTimeout();
        const blockOk = transcriptCapabilitiesInclude(caps, blockCommit);
        streamBlockCapableRef.current = blockOk;
        const rows = streamingRowsRef.current;
        const last = rows.length > 0 ? rows[rows.length - 1]! : null;
        if (last != null) {
          streamIdRef.current = last.streamId;
          lastStreamIdRef.current = last.streamId;
          streamTextAccumRef.current = last.text;
          streamThinkingAccumRef.current = last.thinking;
          committedTextPartsRef.current = [];
          committedThinkingPartsRef.current = [];
          committedTextHtmlPartsRef.current = [];
          committedThinkingHtmlPartsRef.current = [];
          streamBlockArmedRef.current = false;
        }
        timingLog('conversation webview ready (v2 handshake done)');
        bootTimingLog('conversation webview ready (v2 handshake done)');
        onReady?.();
        onWebMermaidViewerOpenChange?.(false);
      };
      const handleReady = useLatest(handleReadyNow);

      /**
       * 恢复可见时的快照校正（webview-background-ready-fail）。
       *
       * 依赖 hidden 时刻的 app 前台态区分「WebView 不可见」两种成因：app 进后台
       * （锁屏/切走）文档可能陈旧 → 换 key 重挂；被栈内屏盖住（仍前台）→ 补一次
       * 全量快照校正 DOM，不重挂（避免 dev 包下 8s 握手赛跑）。
       *
       * nm-style: keep-local — 前台态快照 ref（visibilityHiddenAppStateRef）与
       * hidden 期推送计数 ref 一起构成可见性状态机，内联到 onMessage 会让
       * 「hidden 清零 / visible 判脏」分居两处。
       */
      const handleVisibilityNow = (payload: Record<string, unknown>): void => {
        if (payload.hidden) {
          // 快照 hidden 时刻的 app 前台态，供恢复可见时区分成因（见 ref 声明注释）。
          visibilityHiddenAppStateRef.current = AppState.currentState ?? null;
          // 计数口径 = 本次 hidden 期间的改画推送：hidden:true 同拍清零，
          // 否则可见期间的推送也会累进，「hidden 期间零推送」分支永不可达。
          statePushSinceResumeRef.current = 0;
          return;
        }
        const hiddenAppState = visibilityHiddenAppStateRef.current;
        visibilityHiddenAppStateRef.current = null;
        // 仅「hidden 发生在 app 前台期间」判为栈内被盖（不重挂）；后台/未知
        // （null）沿用原脏重挂判据，保守兼容既有行为。
        const coveredWhileForeground = hiddenAppState === 'active';
        const pushesWhileHidden = statePushSinceResumeRef.current;
        const dirty = !coveredWhileForeground && pushesWhileHidden > 0;
        statePushSinceResumeRef.current = 0;
        if (dirty) {
          // 后台期间文档可能陈旧：换 key 重挂 + 重新握手（ready 后按当前消息面
          // 补一次普通快照，见 webReady 触发的重发 effect）。
          webReadyRef.current = false;
          setWebReady(false);
          setRepaintEpoch(epoch => epoch + 1);
        } else if (coveredWhileForeground && pushesWhileHidden > 0) {
          // 前台期间被盖（工作区 / FileEditor / 子会话）不重挂，避免 10-05 的
          // 「对话页加载失败」；但被盖期间的状态推送可能没被 webview 消化
          //（view 被 detach、画面停在旧帧），恢复可见时补一次普通全量快照
          // 校正 DOM。快照是唯一真源：流式行与其 status 都随快照到达，
          // 不需要 restore 之类的清流语义。
          void sendSessionSnapshotNow('preserve');
        }
      };
      const handleVisibility = useLatest(handleVisibilityNow);

      /**
       * 上行分发：decoder → 每条消息的域处理（单点消费，不再为每域造 hook）。
       *
       * nm-style: keep-local — 宽松解码 + 协议判决 + 副作用（telemetry / 剪贴板 /
       * 菜单 / 重同步限流）是一条消息状态机；内联进 JSX 会把 18 个 case 塞进
       * render 表达式，也无法集中说明丢弃口径。
       */
      const onUpstream = (event: WebViewMessageEvent): void => {
        // 宽松 decoder（纪律 B）：坏 JSON 静默丢弃；ready 由 v===2 判。
        const decoded = decodeConversationUpstream(event.nativeEvent.data);
        if (!decoded.ok) {
          if (decoded.reason === 'stale-ready') {
            // 旧 dist 的 ready：不置 webReady，等 8s 兜底错误态
            bootTimingLog('stale ready (v !== 2) ignored');
          }
          return;
        }
        const {message} = decoded;
        const payload = message.payload;
        // change / selectionChange / dockAction 三条 composer/dock 域上行已随
        // D4b 剥离删除（解码器对未知 type 宽松放行，本组件不再消费）。
        // 键盘链路由 keyboard-controller insets 驱动，focus / blur 无消费。
        // heightChange 不上行（heightReport: false，高度由文档内布局消化）。
        switch (message.type) {
          case 'ready':
            handleReady(payload);
            return;
          case 'copyCode': {
            const code = String(payload.code ?? '');
            if (code) {
              Clipboard.setString(code);
            }
            return;
          }
          case 'scrollSnapshot': {
            const schema = CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION;
            const snap = parseConversationScrollSnapshot(message, schema);
            if (snap != null) {
              rollbackTimingLog('web render receipt (scrollSnapshot)');
              const nearBottom = snap.nearBottom;
              lastScrollRef.current = {nearBottom, offsetY: snap.offsetY};
              onScrollSnapshot?.(snap);
            }
            return;
          }
          case 'loadOlder':
            onLoadOlder?.();
            return;
          case 'openToolFile':
            onOpenToolFile?.(String(payload.path ?? ''));
            return;
          case 'linkClick':
            onLinkClick?.(String(payload.href ?? ''));
            return;
          case 'openSubagentSession':
            onOpenSubagentSession?.(String(payload.sessionId ?? ''));
            return;
          case 'openSkillDetail':
            onOpenSkillDetail?.({
              domain: payload.domain as TranscriptSkillRef['domain'],
              name: String(payload.name ?? ''),
              ...(payload.projectId != null
                ? {projectId: String(payload.projectId)}
                : {}),
            });
            return;
          case 'openToolResult':
            onOpenToolResult?.({
              title: String(payload.title ?? ''),
              content: String(payload.content ?? ''),
              // 入参原文：无入参的卡片不带该字段，宿主据此只铺输出。
              ...(typeof payload.inputJson === 'string'
                ? {inputJson: payload.inputJson}
                : {}),
            });
            return;
          case 'openMessageMenu': {
            if (uiRunning) {
              return;
            }
            emitChatTranscriptTelemetry({name: 'menu_open'});
            const messageId = String(payload.messageId ?? '');
            const pageX = Number(payload.pageX ?? 0);
            const pageY = Number(payload.pageY ?? 0);
            onOpenMessageMenu?.(messageId, pageX, pageY);
            return;
          }
          case 'messageMenuAction': {
            // 安全防线不弱化：rollback / fork / set-floor 仍在宿主回调处置
            const messageId = String(payload.messageId ?? '');
            const action = String(payload.action ?? '');
            onMessageMenuAction?.(messageId, action);
            return;
          }
          case 'menuOpened':
            onWebMenuOpenChange?.(true);
            return;
          case 'menuClosed':
            onWebMenuOpenChange?.(false);
            return;
          case 'mermaidViewerOpened':
            onWebMermaidViewerOpenChange?.(true);
            return;
          case 'mermaidViewerClosed':
            onWebMermaidViewerOpenChange?.(false);
            return;
          case 'visibility':
            handleVisibility(payload);
            return;
          case 'streamResync': {
            // Web 的 gap/未知 streamId 重同步请求：同 streamId 100ms 内只补一次
            // 普通快照（T-SP29 宿主限流）。
            const streamId = String(payload.streamId ?? '');
            if (streamId.length === 0) {
              return;
            }
            const now = performance.now();
            const lastSentAt = resyncSentAtRef.current.get(streamId);
            if (
              lastSentAt != null &&
              now - lastSentAt < STREAM_RESYNC_MIN_INTERVAL_MS
            ) {
              return;
            }
            resyncSentAtRef.current.set(streamId, now);
            sendSessionSnapshotRef.current?.('preserve');
            return;
          }
          default:
            // 宽松解码器放行的未知 type（旧 dist 的 composer 域残余 change/selectionChange/
            // dockAction、诊断探针 __nmGhostProbe）一律静默丢弃——不要打日志刷屏。
            return;
        }
      };
      const handleUpstream = useLatest(onUpstream);

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
        if (!webReady) {
          return;
        }
        const richText = flags?.richText ?? false;
        if (prevRichTextRef.current === richText) {
          return;
        }
        prevRichTextRef.current = richText;
        void sendSessionSnapshotNow('preserve');
      }, [webReady, flags?.richText, sendSessionSnapshotNow]);

      // pendingSubagentSessions 变化时重发快照（照搬，注释见旧组件）
      useEffect(() => {
        if (!webReady) {
          return;
        }
        sendSessionSnapshotRef.current?.('preserve');
      }, [webReady, pendingSubagentSessions]);

      /**
       * 流式行状态翻转（C9 第 9 条）：一次更新里可能同时发生「旧 id finished +
       * 新 id streaming」。依赖只列最后一行的 id/status/messageId + 映射引用——
       * text 每 64ms 变，进依赖会把 effect 打成每帧一次。
       *
       * nm-style: keep-local — 上一拍基线（lastStreamSnapshotRef）的读-判-写与
       * begin/finish/reset 三向分流是同一个状态机；内联会让基线读写分离在
       * effect 表里。
       */
      const runStreamStatusFlip = (): void => {
        if (!webReady) {
          return;
        }
        const rows = streamingRowsRef.current;
        const current = rows.length > 0 ? rows[rows.length - 1]! : null;
        const previous = lastStreamSnapshotRef.current;
        if (current == null) {
          if (previous != null) {
            // 先判是否已接管（P0-7）：adoption 已把行从投影剔除，终态行由
            // messages effect 的 stream-adopted 补发，这里不动作、不发快照。
            const adopted = [...streamRowIds.values()].includes(previous.id);
            if (!adopted && previous.isEmpty) {
              // 首字前结束/空 step 留下的空 streaming 行：快照收掉。
              sendSessionSnapshotRef.current?.('preserve');
            } else if (!adopted && previous.status === 'finished') {
              // 未被接管的合成 partial（失败/移除）：按 id 移除，随后由 DB 错误行接管。
              resetStream([previous.id]);
            }
          }
          lastStreamSnapshotRef.current = null;
          return;
        }
        if (previous != null && previous.id !== current.streamId) {
          finishStream(previous.id);
        } else if (
          previous != null &&
          previous.status === 'streaming' &&
          current.status === 'finished'
        ) {
          finishStream(current.streamId);
        }
        if (previous == null || previous.id !== current.streamId) {
          beginStream(current.streamId);
          sendSessionSnapshotRef.current?.('preserve');
        } else if (previous.messageId == null && current.messageId != null) {
          // 防御分支：正常 adoption 会让该行从 streamRows 消失；这里只在
          // 「记录尚未被剔除」的竞态下补一次终态行。
          const isCurrent = current.streamId === streamIdRef.current;
          const textParts = committedTextPartsRef.current;
          const thinkingParts = committedThinkingPartsRef.current;
          const textTail = streamTextAccumRef.current;
          const thinkingTail = streamThinkingAccumRef.current;
          const liveText = accumulated(textParts, textTail);
          const liveThinking = accumulated(thinkingParts, thinkingTail);
          let text = current.text;
          if (isCurrent) text = liveText;
          let thinking = current.thinking;
          if (isCurrent) thinking = liveThinking;
          const finished = {...current, status: 'finished' as const};
          const body = {text, thinking};
          const richText = richTextRef.current;
          const row = buildStreamingTranscriptRow(finished, richText, body);
          postToWeb({
            v: CONVERSATION_BRIDGE_V,
            type: 'streamStatus',
            payload: {
              streamId: current.streamId,
              status: 'finished',
              messageId: current.messageId,
              row,
            },
          });
        }
        lastStreamSnapshotRef.current = {
          id: current.streamId,
          status: current.status,
          messageId: current.messageId,
          isEmpty:
            current.text.length === 0 &&
            current.thinking.length === 0 &&
            current.tools.length === 0,
        };
      };
      const flipKey = `${webReady}|${lastStreamingRow?.streamId}`;
      const rowKey = `${lastStreamingRow?.status}|${lastStreamingRow?.messageId}`;
      const flipRun = useLatest(runStreamStatusFlip);
      useEffect(flipRun, [flipKey, rowKey, streamRowIds, flipRun]);

      // ② 快照（恢复链最后一步）
      useEffect(() => {
        if (!webReady) {
          return;
        }
        // 无需再判「换会话」：切会话经 `key` 重挂，本组件整体重新初始化，
        // `needsOpenSnapshotRef` 从 true 起、流式基线本来就是空的。
        if (needsOpenSnapshotRef.current) {
          const plan = planOpenSnapshot({
            messageCount: messages.length,
            hasStreamingMessage,
            sessionKey,
            initialScroll: initialScrollRef.current,
            defaultScrollToBottom: defaultScrollToBottomRef.current,
          });
          if (plan.kind === 'wait-empty') {
            return;
          }
          needsOpenSnapshotRef.current = false;
          void sendSessionSnapshotNow(plan.intent, plan.restoreScroll);
          for (const event of plan.events) {
            emitChatTranscriptTelemetry(event);
          }
          prevFirstMessageIdRef.current = messages[0]?.id;
          prevMessageCountRef.current = messages.length;
          prevMessagesRef.current = messages;
          return;
        }

        const plan = planMessagesUpdate({
          messages,
          previousMessages: prevMessagesRef.current,
          prevFirstId: prevFirstMessageIdRef.current,
          prevCount: prevMessageCountRef.current,
          uiRunning,
          streamRowIds,
          lastScroll: lastScrollRef.current,
        });
        if (plan.kind === 'same-reference') {
          return;
        }
        if (plan.kind === 'hidden-changed') {
          void sendSessionSnapshotNow('preserve');
          prevFirstMessageIdRef.current = messages[0]?.id;
          prevMessageCountRef.current = messages.length;
          prevMessagesRef.current = messages;
          return;
        }
        prevMessagesRef.current = messages;
        switch (plan.kind) {
          case 'prepend': {
            emitChatTranscriptTelemetry(plan.event);
            const richText = flags?.richText ?? false;
            const head = messages.slice(0, plan.prependedCount);
            const built = buildTranscriptRows(head, transcriptListOptions);
            const enriched = enrichTranscriptRows(built, richText);
            const rows = applyStreamRowIds(enriched, streamRowIds);
            postToWeb({
              v: CONVERSATION_BRIDGE_V,
              type: 'prependPage',
              payload: {rows, prependedCount: plan.prependedCount},
            });
            break;
          }
          case 'stream-adopted': {
            // DB 接管：不发 append/快照，对每条命中补 streamStatus{row}（逐条
            // 带 messageId，菜单/回滚可用）。
            const ctx = buildToolPairingContext(messages);
            const opts = transcriptListOptions;
            const richText = flags?.richText ?? false;
            for (const {streamId, messageId} of plan.adopted) {
              const message = messages.find(item => item.id === messageId);
              if (message == null) {
                continue;
              }
              const one = [message];
              const built = buildTranscriptRowsWithContext(one, ctx, opts);
              const enriched = enrichTranscriptRows(built, richText);
              const wired = applyStreamRowIds(enriched, streamRowIds);
              const row = wired.find(
                candidate =>
                  candidate.kind === 'message' && candidate.id === streamId,
              );
              if (row == null) {
                continue;
              }
              postToWeb({
                v: CONVERSATION_BRIDGE_V,
                type: 'streamStatus',
                payload: {streamId, status: 'finished', messageId, row},
              });
            }
            break;
          }
          case 'append':
            sendAppendTailRows(plan.added);
            break;
          case 'force-snapshot':
            void sendSessionSnapshotNow('preserve');
            break;
          case 'snapshot':
            void sendSessionSnapshotNow(plan.intent);
            break;
        }
        prevFirstMessageIdRef.current = messages[0]?.id;
        prevMessageCountRef.current = messages.length;
      }, [
        webReady,
        sessionKey,
        messages,
        hasStreamingMessage,
        uiRunning,
        streamRowIds,
        flags?.richText,
        transcriptListOptions,
        postToWeb,
        sendSessionSnapshotNow,
        sendAppendTailRows,
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
        void Linking.openURL(event.nativeEvent.targetUrl).catch(
          () => undefined,
        );
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
              testID="chat-conversation-ready-retry"
            >
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
