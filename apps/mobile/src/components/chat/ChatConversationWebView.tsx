/**
 * 统一对话宿主（chat-webview-unify Step 6）：转录 + 输入框 dock 合并进**单个**
 * chat-conversation WebView。
 *
 * ## 为什么是这一个组件
 * 旧链是 `ChatTranscriptWebView` + `ComposerInputWebView` 两个原生实例，输入框
 * 高度变化要「跨桥上报 heightChange → RN 80ms `withTiming` 渐变 → 容器变高」才
 * 传导到转录区（滞后 1~2 帧 + 一段动画）。合并后 dock 在同一文档内 flex 布局，
 * 输入框换行时转录区 `flex:1` 当帧收缩——**高度链彻底消失**，键盘动画期间每帧
 * relayout 的原生节点也从 2 个降到 1 个。
 *
 * ## 本组件继承的全部机制（转录侧，照 `ChatTranscriptWebView` 逐条搬）
 * 快照分片（`SNAPSHOT_CHUNK_SIZE=50` / `SNAPSHOT_CHUNK_BYTES=256KB` /
 * `./snapshot-chunk-bounds` 的 `planSnapshotChunkBounds` 预扫 / 代次作废）、流式三通道（delta/batch/blockCommit）
 * + 能力协商、`repaintEpoch` 与 visibility 重挂、滚动缓存恢复、安全守卫
 * （`originWhitelist=['file://']` + `onShouldStartLoadWithRequest` 只放行新包目录 +
 * `messageMenuAction` 仍走宿主回调）。
 *
 * ## 三条硬纪律（动本文件前先读）
 *
 * **(A) deferred 队列只装改画三通道**（`appendTailRows` / `prependPage` / `streamCommit`）。
 * composer 域（`setText` / `composerState` / `selectAll` / `composerPaste`）与 dock 上行
 * **一律走 `postToWeb` 直发**。理由：deferred 的唯一目的是防快照末片整体替换 rows 时
 * 抹掉增量行，composer 域根本不碰 `state.rows`；误 defer 的代价是分片窗口（约 1.15s）
 * 内用户打不了字，且重挂时 deferred 队列整队丢弃 → 草稿静默丢失。T-CU7 负面断言。
 *
 * **(B) IME 七条防线的 ref 归属**（spec §IME / 选区防线表，注释标 M 编号）：
 * M3 在 web 侧不动；其余六条落在本组件——打字真源在 web，`change` 只上抛不回写。
 *
 * **(C) ready 只认 `v === 2`**。旧 dist 的 v:1 ready 被拒 → 走 8s 超时兜底错误态，
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
import {type ChatMessage} from '@novel-master/core/chat';
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
  CONVERSATION_CAPABILITY_COMPOSER_DOCK,
  CONVERSATION_COMPOSER_METRICS,
  CONVERSATION_COMPOSER_MODE,
  EMPTY_CONVERSATION_TYPEAHEAD_SOURCE,
  conversationCapabilitiesInclude,
  conversationDockActionIncludes,
  decodeConversationUpstream,
  encodeHostToConversation,
  parseConversationScrollSnapshot,
  readReadyCapabilities,
  type ConversationComposerState,
  type ConversationDockAction,
  type ConversationHostMessage,
  type ConversationTheme,
  type ConversationTypeaheadSource,
} from './ChatConversationBridge';
import type {ComposerInputSelection} from './ComposerInputBridge';
import {enrichTranscriptRows} from './enrich-transcript-rows';
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
  getChatConversationPackageDirUri,
  getChatConversationUri,
} from '@/webview-host/chat-conversation/uri';
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
  CHAT_CONVERSATION_SELECTION_MENU_ITEMS,
  CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS,
} from './chat-transcript-selection-menu';
import type {ChatTranscriptWebViewHandle} from './ChatTranscriptWebViewHandle';

export type {ChatTranscriptWebViewHandle} from './ChatTranscriptWebViewHandle';

/**
 * 统一宿主句柄 = 转录七方法（`ChatTranscriptWebViewHandle` 逐字复用，方法面不变）
 * + **一个** composer 命令式写入。
 *
 * 为什么必须多这一个：IME 防线 M7（命令式 `setText` 带选区**不**作废选区基线）与
 * M2（effect 版 `setText` **要**作废）是两条**相反**规则，只能靠两条独立通道实现——
 * 合并成一条就必然要把其中一条改错。转录七方法本身一个都没动，故
 * `session-stream-webview-adapter` / `ChatTabProvider` / `useInterruptedPartialCommit` /
 * `SubagentSessionScreen` 的消费代码零改动。
 *
 * `transcriptOnly` 变体（子会话屏）的行为面断言在同文件 transcriptOnly describe，
 * web 侧（CSS 隐藏 dock + `init.transcriptOnly` 消费）断言在
 * `__tests__/chat-conversation-boot-script.test.ts` 的产物面。
 */
export type ChatConversationWebViewHandle = ChatTranscriptWebViewHandle & {
  /**
   * M7 · 命令式整段写入（Picker 路径 token 插入 / 草稿水化 / 全屏回填）：
   * 写 web + 同步 web 文本基线 + 光标经 `setText.selection` 一次落位；
   * **选区基线不置 null**（与 M2 相反，勿"顺手统一"）。
   * 未就绪时静默返回：ready 后的恢复链会用最新 `composerText` 补齐全量写入。
   */
  setComposerText: (text: string, cursor?: number) => void;
};

/** 会改变**转录**画面的宿主消息类型；用于「隐藏期间脏推送」计数（composer 域不计）。 */
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

/**
 * 划词「粘贴」跨桥文本上限（r6-I-2）。
 *
 * 口径是 **UTF-16 码元**（`String.length`），不是字节——这里要卡的是
 * `JSON.stringify` 后 postMessage 的串长度量级，码元数与之同数量级，
 * 拿字节数算反而在 RN 侧多绕一层编码。256KB 与快照分片的字节预算同数，
 * 两者互不相干，别互相引用。
 */
const COMPOSER_PASTE_MAX_CHARS = 256 * 1024;

export type ChatConversationWebViewProps = {
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

  /* ---------------- composer 域（全部由 controller 算好后下发） ---------------- */

  /**
   * 外部真源草稿文本。**只为识别「外部变化」**（水化 / 清空 / 回填）——打字真源
   * 在 web 侧，宿主收到 `change` 只上抛、绝不回写（M1 / M6）。
   */
  /** 可选仅因 transcriptOnly 变体（子会话屏）省传；主链恒传。 */
  readonly composerText?: string;
  readonly onComposerChangeText?: (text: string) => void;
  /** 外部受控光标（插入 token / 水化 / 清空后）：随外部 value 变化对齐一次。 */
  readonly composerCursor?: number;
  readonly onComposerSelectionChange?: (selection: ComposerInputSelection) => void;
  readonly composerInputDisabled?: boolean;
  readonly composerHasModel?: boolean;
  readonly composerSendDisabled?: boolean;
  readonly composerRunning?: boolean;
  readonly composerError?: string;
  readonly composerFullscreenEnabled?: boolean;
  readonly composerPlaceholder?: string;
  readonly composerChips?: ConversationComposerState['chips'];
  readonly composerKeyboardUp?: boolean;
  /**
   * typeahead **候选源**（非过滤结果）。
   *
   * 比较口径：**引用相等**（spec 定案 ③）。候选列表是 `buildListRows()` /
   * `effectiveSkills()` 的产物，内容不变时 controller 下发同一引用即可——memo
   * 比较器按引用判等，引用变了就下行一次 `composerState`（不做深比较：那既 O(n)
   * 又必然造出新引用，把这条捷径彻底废掉）。
   */
  readonly composerTypeahead?: ConversationTypeaheadSource;
  /** 安全区底部高度（init.composer.safeAreaBottom 下发；键盘弹起时 dock padding 归零）。 */
  readonly safeAreaBottom?: number;
  /** dock 域上行处置（send/terminate/needModel/fullscreen/atPicker/skillPicker）。 */
  readonly onDockAction?: (action: ConversationDockAction) => void;

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
 * memo 比较器：转录域照旧，composer 域**逐个入列**。
 *
 * 为什么必须逐个入列而不是「`composerState` 一个对象引用比」：spec 记过一次踩坑史
 * （`pendingSubagentSessions` 漏加 → 静默吞更新）。composer 域字段多（11 个），
 * 漏一个就是「改了没生效」且无任何报错。`composerTypeahead` 按**引用**判等
 * （见 props 注释）。
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
    // ---- composer 域（逐个入列，漏一个就是静默吞更新） ----
    prev.composerText === next.composerText &&
    prev.composerCursor === next.composerCursor &&
    prev.composerInputDisabled === next.composerInputDisabled &&
    prev.composerHasModel === next.composerHasModel &&
    prev.composerSendDisabled === next.composerSendDisabled &&
    prev.composerRunning === next.composerRunning &&
    prev.composerError === next.composerError &&
    prev.composerFullscreenEnabled === next.composerFullscreenEnabled &&
    prev.composerPlaceholder === next.composerPlaceholder &&
    prev.composerChips === next.composerChips &&
    prev.composerKeyboardUp === next.composerKeyboardUp &&
    // 候选源按引用判等（controller 内容不变时下发同一引用）
    prev.composerTypeahead === next.composerTypeahead &&
    prev.safeAreaBottom === next.safeAreaBottom &&
    // ---- 变体（transcript-converge）：漏比会吞掉子会话屏的降级形态 ----
    prev.transcriptOnly === next.transcriptOnly
  );
}

/**
 * 主题 9 键超集：transcript 7 键 ∪ composer 6 键去重，一次 `themeUpdate` 全文档生效。
 * `primaryMuted` 由宿主算（`${primary}22`，web 不做颜色计算）；`selection` 直接取
 * tokens（缺了 `::selection` 会回落 `--primary-muted` 变色）。
 */
function conversationThemeFromTokens(tokens: {
  background: string;
  text: string;
  textSecondary: string;
  primary: string;
  selection: string;
  danger: string;
  surface: string;
  borderLight: string;
}): ConversationTheme {
  const theme: ConversationTheme = {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    primaryMuted: `${tokens.primary}22`,
    selection: tokens.selection,
    danger: tokens.danger,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
  return theme;
}

/** 光标落点归一到 [0, len]（对齐 ComposerAtPathInput 的 clamp 口径）。 */
function clampCursor(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.max(0, Math.min(Math.floor(value), length));
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sameSelection(
  a: ComposerInputSelection | null,
  b: ComposerInputSelection | null,
): boolean {
  return a != null && b != null && a.start === b.start && a.end === b.end;
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
    emitChatTranscriptTelemetry({name: 'scroll_restore', mode: 'stick'});
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

/** 跳过 snapshot 的前提是 streamCommit 同步过的行仍全部在当前列表里。 */
function committedStreamRowsStillPresent(
  messages: readonly ChatMessage[],
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
        // transcriptOnly 变体（子会话屏）不需要 composer 域输入——默认空串，
        // 使该 prop 在降级形态下可省（消息无 dock 消费者，值不产生副作用）。
        composerText = '',
        onComposerChangeText,
        composerCursor,
        onComposerSelectionChange,
        composerInputDisabled = false,
        composerHasModel = true,
        composerSendDisabled = false,
        composerRunning = false,
        composerError,
        composerFullscreenEnabled = false,
        composerPlaceholder = '',
        composerChips,
        composerKeyboardUp = false,
        composerTypeahead = EMPTY_CONVERSATION_TYPEAHEAD_SOURCE,
        safeAreaBottom = 0,
        onDockAction,
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
      /** 能力协商：未声明 `composer-dock` → 输入区降级提示（不是静默不可点）。 */
      const [composerDockCapable, setComposerDockCapable] = useState(false);

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

      /* ---- composer 域的基线 ref（IME 防线 M1/M2/M4/M5/M7 的落点） ---- */

      /** M1 · web 侧文本基线：`change` 到达时**先推进再上抛**（详见 handleUpstream change 分支）。 */
      const webTextRef = useRef<string | null>(null);
      /** M4 · web 侧选区基线：web 上报或我们下发，用于回声抑制。 */
      const lastSelectionRef = useRef<ComposerInputSelection | null>(null);
      /**
       * M5 · 短暂受控选区：外部写入/命令式写入给出的「光标期望」。
       * web 上报用户选区即解除（对齐 main 版：原生已应用选区后置空）。
       */
      const [pendingSelection, setPendingSelection] =
        useState<ComposerInputSelection | null>(null);

      const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
      );

      const onComposerChangeTextRef = useRef(onComposerChangeText);
      const onComposerSelectionChangeRef = useRef(onComposerSelectionChange);
      const onDockActionRef = useRef(onDockAction);
      /**
       * 失败态镜像（webview-background-ready-fail）：供 AppState 的 change 回调读
       * 最新失败态。走 ref 而非把 `readyFailed` 塞进回调依赖——依赖一变回调就换，
       * 订阅会被反复摘挂重挂（监听本身也跟着抖动）。
       */
      const readyFailedRef = useRef(false);
      onComposerChangeTextRef.current = onComposerChangeText;
      onComposerSelectionChangeRef.current = onComposerSelectionChange;
      onDockActionRef.current = onDockAction;
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

      /**
       * composer 域三条基线清场（IME 防线 M1/M4/M5 的公共入口）。
       *
       * **唯一调用点是 `ready` 到达**：`webReady` 会 false→true 让 ③ 草稿 effect
       * 重跑，而新文档的 textarea 是空的——不把 `webTextRef` 打回 null，③ 会拿
       * 「与基线同值」早退，草稿永远写不进去。visibility 脏重挂 / 点「重载」/
       * 切会话（`key` 重挂）三条路径都经「换文档 → ready 重来」顺带解决。
       */
      const resetComposerBaselines = useCallback(() => {
        webTextRef.current = null;
        lastSelectionRef.current = null;
        setPendingSelection(null);
      }, []);

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
       * composer / dock 域一律直接走这里（不排队、不 defer）。
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
       * （richText/menuDisabled → `flagsUpdate`；dock 侧一切 → `composerState`）。
       *
       * 取「每次渲染刷新 ref、发送时读 ref」而不是把字段挂 `useCallback` 依赖：
       * 后者会让 `sendInit` 的身份随 `inputDisabled` / `placeholder` 变，
       * 于是 `useEffect([webReady, sendInit])` 在这些字段变化时**重发 init**——
       * 既多一条消息，又会打乱恢复链四消息的固定顺序。
       */
      const initSnapshotRef = useRef({
        theme: conversationThemeFromTokens(tokens),
        flags: resolvedFlags,
        composer: {
          mode: CONVERSATION_COMPOSER_MODE,
          disabled: composerInputDisabled,
          metrics: CONVERSATION_COMPOSER_METRICS,
          placeholder: composerPlaceholder,
          safeAreaBottom,
        },
      });
      initSnapshotRef.current = {
        theme: conversationThemeFromTokens(tokens),
        flags: resolvedFlags,
        composer: {
          mode: CONVERSATION_COMPOSER_MODE,
          disabled: composerInputDisabled,
          metrics: CONVERSATION_COMPOSER_METRICS,
          placeholder: composerPlaceholder,
          safeAreaBottom,
        },
      };

      /**
       * 恢复链第 1 步 · 聚合 `init`。
       *
       * **契约（CR 首评 OQ 定案 ②）**：`readOnly` / `placeholder` / `disabled` 的
       * **唯一真源是 `composerState`**；init 只管 metrics / mode / safeAreaBottom。
       * 这里那份 `disabled` / `placeholder` 是同一渲染拍点的初值快照（web 侧
       * `applyInit` 需要才能摆对首帧），不是第二真源——紧随其后的第 2 步
       * `composerState` 才是真值。改动会让首帧与真源短暂分叉。
       */
      const sendInit = useCallback(() => {
        const snapshot = initSnapshotRef.current;
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'init',
          payload: {
            theme: snapshot.theme,
            flags: snapshot.flags,
            composer: snapshot.composer,
            // 转录 only 变体（transcript-converge）：web 据此隐藏 dock。
            ...(transcriptOnly ? {transcriptOnly: true} : {}),
          },
        });
      }, [postToWeb, transcriptOnly]);

      /** 恢复链第 2 步 · `composerState`（dock 域**直发**，纪律 A）。 */
      const sendComposerState = useCallback(() => {
        const state: ConversationComposerState = {
          inputDisabled: composerInputDisabled,
          hasModel: composerHasModel,
          sendDisabled: composerSendDisabled,
          running: composerRunning,
          ...(composerError != null && composerError !== ''
            ? {error: composerError}
            : {}),
          fullscreenEnabled: composerFullscreenEnabled,
          placeholder: composerPlaceholder,
          chips: composerChips ?? [],
          keyboardUp: composerKeyboardUp,
          // 必达（定案 ①）：不下 undefined，让 web 侧永远拿到可渲染的源
          typeahead: composerTypeahead,
        };
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'composerState',
          payload: state,
        });
      }, [
        postToWeb,
        composerInputDisabled,
        composerHasModel,
        composerSendDisabled,
        composerRunning,
        composerError,
        composerFullscreenEnabled,
        composerPlaceholder,
        composerChips,
        composerKeyboardUp,
        composerTypeahead,
      ]);

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
                // 重挂作废：推迟队列整队丢弃（草稿不靠它保——草稿由 composerState
                // 之后的 setText 恢复链负责）
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

      /**
       * M7 · 命令式整段写入。
       *
       * 与 M2 的**相反**规则：这里**不作废**选区基线，反而把 `lastSelectionRef`
       * 推进到目标位——程序化写入自带 selection，web 落位即期望位，保留基线能白赚
       * 一次回声抑制（若置 null，随后的 setSelection 会多下发一条同值命令，
       * 在 IME 组合态上就是一次多余的光标重摆）。
       */
      const setComposerTextNow = useCallback(
        (text: string, cursor?: number) => {
          if (!webReady) {
            // 未就绪不写基线：ready 后的恢复链第 3 步会用最新 composerText 补写
            return;
          }
          webTextRef.current = text;
          const pos = clampCursor(cursor ?? text.length, text.length);
          const next = {start: pos, end: pos};
          lastSelectionRef.current = next;
          setPendingSelection(next);
          postToWeb({
            v: CONVERSATION_BRIDGE_V,
            type: 'setText',
            payload: {
              text,
              selectionStart: pos,
              selectionEnd: pos,
            },
          });
          // 与现网 ComposerAtPathInput 同口径：程序化写入同样回调 onChangeText
          // （controller 的 text / 草稿靠它同步）与合成选区事件。
          onComposerChangeTextRef.current?.(text);
          onComposerSelectionChangeRef.current?.(next);
        },
        [webReady, postToWeb],
      );

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
          setComposerText: setComposerTextNow,
        }),
        [
          queueStreamDelta,
          queueStreamBatch,
          resetStreamTail,
          tryCommitStreamTail,
          commitAbortOverlaySnapshot,
          forceSnapshotNow,
          commitSyntheticAssistantRow,
          setComposerTextNow,
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
          // 宽松 decoder（纪律 C）：坏 JSON 静默丢弃；ready 由 v===2 判。
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

          /* ---- dock 域上行（v:2） ---- */
          if (message.type === 'dockAction') {
            if (conversationDockActionIncludes(payload.action)) {
              onDockActionRef.current?.(payload.action);
            }
            return;
          }

          /* ---- ready（v:2 单条；能力协商全集） ---- */
          if (message.type === 'ready') {
            webReadyRef.current = true;
            setWebReady(true);
            setReadyFailed(false);
            clearReadyTimeout();
            // 新文档 = 新基线：草稿基线作废（强制恢复链重发 setText，否则草稿丢失）。
            resetComposerBaselines();
            const capabilities = readReadyCapabilities(payload);
            streamBlockCapableRef.current = transcriptCapabilitiesInclude(
              capabilities,
              TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT,
            );
            // 「未声明 = 不支持」：未带 composer-dock 即旧 dist，输入区降级
            const dockCapable = conversationCapabilitiesInclude(
              capabilities,
              CONVERSATION_CAPABILITY_COMPOSER_DOCK,
            );
            setComposerDockCapable(dockCapable);
            if (!dockCapable) {
              // r6-I-1：降级路径原先只渲染横幅、零打点。线上看到「输入框不见了」
              // 分不清是旧 dist、能力位没带、还是 ready 压根没来——这里把
              // 「ready 到了但没带 dock 能力位」这一事实显式上报（含能力位条数，
              // 用来区分「一条没带」和「带了别的、唯独缺 dock」）。
              emitChatTranscriptTelemetry({
                name: 'composer_dock_degraded',
                capabilityCount: capabilities.length,
              });
              bootTimingLog(
                `composer dock degraded (capabilities=${capabilities.length})`,
              );
            }
            timingLog('conversation webview ready (v2 handshake done)');
            bootTimingLog('conversation webview ready (v2 handshake done)');
            onReady?.();
            onWebMermaidViewerOpenChange?.(false);
            return;
          }

          /* ---- composer 域上行（v:1 单例，change / selectionChange / focus / blur） ---- */
          if (message.type === 'change') {
            // M1 + M6：打字真源在 web——**先推进差分基线再上抛，绝不回写 setText**。
            // 不推进的话父层把文本原样写回 composerText 时会被下面的 effect 误判成
            // 「外部写入」，于是按上一拍 cursor 强制摆一次选区——打在正在输入
            // （尤其 IME 组合态）的 textarea 上会把光标拽回去一两个字。
            const text = String(payload.text ?? '');
            webTextRef.current = text;
            onComposerChangeTextRef.current?.(text);
            return;
          }
          if (message.type === 'selectionChange') {
            const next = {
              start: finiteOrNull(payload.start) ?? 0,
              end: finiteOrNull(payload.end) ?? 0,
            };
            // M5：用户选区到达即解除短暂受控
            lastSelectionRef.current = next;
            setPendingSelection(null);
            onComposerSelectionChangeRef.current?.(next);
            return;
          }
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
          onOpenMessageMenu,
          onMessageMenuAction,
          onWebMenuOpenChange,
          onWebMermaidViewerOpenChange,
          onScrollSnapshot,
          uiRunning,
          clearReadyTimeout,
          resetComposerBaselines,
        ],
      );

      /** 划词三项菜单（spec §划词菜单）：复制 / 全选 / 粘贴。 */
      const handleCustomMenuSelection = useCallback(
        (event: {nativeEvent: {key?: string; selectedText?: string}}) => {
          const key = String(event.nativeEvent.key ?? '');
          if (key === 'selectAll') {
            // dock 域直发（纪律 A）：web handler 判 activeElement 是 textarea 就
            // select()，否则整篇文档选区
            postToWeb({
              v: CONVERSATION_BRIDGE_V,
              type: 'selectAll',
              payload: {},
            });
            return;
          }
          if (key === 'paste') {
            // 运行中禁粘贴（与 copy 同口径，r6-D-1）：旧链 textarea 是 RN
            // TextInput，editable=false 时原生粘贴根本进不来；新链走 WebView +
            // 划词菜单，菜单三项静态展示、点击不拦，漏判就等于向被禁用的输入框
            // 注入文本——该文本经 commitComposerText 落库成草稿、下一轮被发出去。
            // web 侧 composerPaste 另有一道 inputDisabled 闸门，这里是宿主侧第一道。
            if (uiRunning) {
              return;
            }
            // 剪贴板读取只经 RN（web 侧不读剪贴板）
            void Clipboard.getString()
              .then(raw => {
                if (raw === '') {
                  // r6-I-2：空串原为静默 return。线上「长按粘贴没反应」无从归因，
                  // 打一条日志（不含剪贴板内容）比静默好排查。
                  console.warn('[chat] composerPaste clipboard empty');
                  return;
                }
                // 跨桥上限：剪贴板全文无上限就是整篇 JSON.stringify 跨 postMessage
                // （5MB 剪贴板 = 5MB 消息），在 RN 侧先截断并打点，别让 web 收超大包。
                const text =
                  raw.length > COMPOSER_PASTE_MAX_CHARS
                    ? raw.slice(0, COMPOSER_PASTE_MAX_CHARS)
                    : raw;
                if (text !== raw) {
                  console.warn(
                    `[chat] composerPaste truncated ${raw.length} -> ${text.length}`,
                  );
                }
                postToWeb({
                  v: CONVERSATION_BRIDGE_V,
                  type: 'composerPaste',
                  payload: {text},
                });
              })
              // r6-I-2：读失败原为 `.catch(() => undefined)` 全吞。失败与「剪贴板
              // 确实是空的」在用户侧表现相同（都没粘上），日志只报失败这一事实，
              // 不带任何剪贴板内容。
              .catch(() => {
                console.warn('[chat] composerPaste clipboard read failed');
              });
            return;
          }
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
        [uiRunning, postToWeb],
      );

      /* ================================================================== *
       * 恢复链（ready → 下行四消息固定顺序）
       *   ① init → ② composerState → ③ 草稿 setText → ④ 快照直发
       * 顺序由 effect 声明序保证（同一次 commit 内按声明序执行）。改动本段
       * 顺序前先想清楚：composerState 晚于 setText 会让首帧 textarea 的
       * readOnly/placeholder 与真源分叉；快照早于 setText 会先渲染空 dock。
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

      // ② composerState（直发；未声明 composer-dock 时不下发——web 侧不认识它）
      useEffect(() => {
        if (!webReady || !composerDockCapable) {
          return;
        }
        sendComposerState();
      }, [webReady, composerDockCapable, sendComposerState]);

      /**
       * ③ 草稿 setText + ④ 光标期望 —— M1 / M2 / M5 的合并落点。
       *
       * **为什么合并成一个 effect**：旧链分两层（`ComposerAtPathInput` 对齐光标、
       * `ComposerInputWebView` 下发 setText），两层的触发判据都是「外部文本相对基线
       * 变了」。合并后判据只有一个（`composerText !== webTextRef.current`），不可能
       * 出现「setText 发了但光标没摆」或反之；顺序也天然是「先 setText 后
       * setSelection」（下面的 M4 effect 声明序在后）。
       *
       * - **M1**：web 上报的 `change` 已把 `webTextRef` 推到同一文本，所以父层把
       *   文本原样写回 `composerText` 时本条**早退**，绝不误判成外部写入——这一条
       *   就是「打字时光标被拽回去一两个字」的根治点（尤其 IME 组合态）。
       * - **M2**：真外部写入时把选区基线**置 null**。web 侧 value 赋值必然把光标推到
       *   文末，旧基线从此不成立；若随后的 setSelection 恰与旧基线同值，会被回声
       *   抑制吞掉，光标就永久停在文末。
       * - **M5**：光标期望 `pendingSelection` 是**短暂**受控——web 上报用户选区即解除。
       */
      useEffect(() => {
        if (!webReady) {
          return;
        }
        if (composerText === webTextRef.current) {
          return;
        }
        webTextRef.current = composerText;
        lastSelectionRef.current = null; // M2：作废选区基线
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'setText',
          payload: {text: composerText},
        });
        const pos = clampCursor(
          composerCursor ?? composerText.length,
          composerText.length,
        );
        const next = {start: pos, end: pos};
        setPendingSelection(next); // M5：短暂受控
        onComposerSelectionChangeRef.current?.(next);
        // 依赖刻意不含 composerCursor：光标只在**文本真变**这一次对齐，
        // 用户自己移动光标不受控（对齐 ComposerAtPathInput 的原口径）。
        //
        // 依赖里也不含 sessionKey：切会话经 `key` 重挂归零，基线本来就是新的。
      }, [webReady, composerText, composerCursor, postToWeb]);

      // M4 · setSelection 回声抑制：web 刚上报的同值 = 自身回声，跳过
      useEffect(() => {
        if (!webReady || pendingSelection == null) {
          return;
        }
        if (sameSelection(lastSelectionRef.current, pendingSelection)) {
          return;
        }
        lastSelectionRef.current = pendingSelection;
        postToWeb({
          v: CONVERSATION_BRIDGE_V,
          type: 'setSelection',
          payload: {start: pendingSelection.start, end: pendingSelection.end},
        });
      }, [webReady, pendingSelection, postToWeb]);

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

      // ④ 快照（恢复链最后一步）
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
          if (req.url.startsWith(getChatConversationPackageDirUri())) {
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
            /* sec/D-1：收紧为包内 file:// */
            originWhitelist={['file://']}
            source={{uri: getChatConversationUri()}}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowingReadAccessToURL={getChatConversationPackageDirUri()}
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
            /* 划词三项：复制（现行 nbsp 清洗链）/ 全选（下行 selectAll）/ 粘贴（下行 composerPaste）。
               transcriptOnly 变体退回旧口径（仅复制）：无 dock 时全选/粘贴的跨桥
               动作没有落点，三项反而制造死按钮（transcript-converge）。 */
            menuItems={
              transcriptOnly
                ? [...CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS]
                : [...CHAT_CONVERSATION_SELECTION_MENU_ITEMS]
            }
            onCustomMenuSelection={handleCustomMenuSelection}
          />
          {/* transcriptOnly 不判降级横幅：该变体本就无 dock，能力位缺失是
              预期形态而非「输入组件版本过低」。 */}
          {!transcriptOnly && webReady && !composerDockCapable ? (
            <View
              style={[styles.degrade, {backgroundColor: tokens.background}]}
              testID="chat-conversation-dock-degraded">
              <Text style={{color: tokens.textSecondary}}>
                输入组件版本过低，请重启应用
              </Text>
            </View>
          ) : null}
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
  degrade: {paddingVertical: 12, alignItems: 'center'},
});
