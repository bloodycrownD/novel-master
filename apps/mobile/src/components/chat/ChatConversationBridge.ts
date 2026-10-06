/**
 * chat-conversation 桥协议 v2 · **RN 侧单源**（chat-webview-unify Step 5 · RN 半；
 * composer-native-2026-10 Step 2 按 D4c 收口、Step 6 随合成包退役完成单源化）。
 *
 * 定位：本文件是宿主（RN）侧下行信封与上行宽松解码的**唯一真源**。原本与
 * 合成包 web 侧 `model.ts` 互为镜像、由 `chat-conversation-bridge.test.ts` 双端
 * 比对锁定——合成包已于 Step 6 退役，web 侧不再有第二份声明，下行 type 的
 * web 侧路由面在 `chat-transcript` 独立入口的 runtime（`bridge.ts` 的 switch），
 * 能力位真源在 `@/web/chat-transcript/transcript-capabilities`（本文件已 import
 * 同源常量）。之所以不共享一份类型：web bundle 不引 RN 模块，共享会把 RN 依赖
 * 拖进 8.9MB 产物。
 *
 * **D4c 收口**：composer/dock 域的 10 条消息（下行 `setText` / `setSelection` /
 * `setDisabled` / `blur` / `composerState` / `composerPaste` / `selectAll`，上行
 * `change` / `selectionChange` / `dockAction`）与 `CONVERSATION_CAPABILITY_COMPOSER_DOCK`
 * 能力位、`init.composer` 段全部删除——输入框由 RN 原生组件承接，本桥退为纯转录
 * 协议。宏链与全屏编辑走独立的 `ComposerInputBridge.ts`
 * （`COMPOSER_INPUT_BRIDGE_VERSION`），与该文件零耦合，不受影响。
 *
 * **dock 域残余类型面（Step 6 现状）**：`ConversationComposerState` 已迁
 * `useChatComposerController` 自持（唯一消费方）；`CONVERSATION_DOCK_ACTIONS`
 * 死导出已删。`ConversationTypeaheadSource` / `EMPTY_CONVERSATION_TYPEAHEAD_SOURCE` /
 * `ConversationDockAction` 仍被 `NativeChatComposer` 与 `native-composer/` 下的
 * `send-button` / `typeahead-view` 消费，暂留此处（不再经桥收发，只做类型载体）；
 * 待消费侧共享模块落位后再迁出本文件。
 *
 * 上行 v 号：转录 runtime 上行恒为 v:1（模块级 `post` 单例不可替换），宿主自有的
 * `ready` 才是 v:2。因此**解码必须宽松**：先宽松 parse 取 `type`，`ready` 判
 * `v === 2`，其余 type 一律不校验 `v`（否则转录域上行会被整段丢弃）。
 *
 * **禁止复用 `decodeTranscriptToHost`**：它对 `v !== 1` 直接 throw，会被宿主
 * try/catch 静默吞掉 → `webReady` 永假 → 全部下行丢弃 → 落进 8s 兜底白屏。
 */
import type {AtPathRef} from '@novel-master/core/chat';
import type {EffectiveSkill} from '@novel-master/core/skills';
import type {
  ChatTranscriptScrollSnapshot,
  TranscriptFlags,
  TranscriptRestoreScroll,
  TranscriptRow,
  TranscriptScrollIntent,
} from './ChatTranscriptBridge';
// 主题键集的唯一真源在 web 侧 shared/host-theme——本文件与 web 侧 model 都从这里取，
// 不再各抄一份（原先两份手抄零约束，宿主加 token 时都不红）。
//
// **为什么用 `@/web/...` 而不是 `@web/...`**：`@web/*` 只在 web 侧 tsconfig 与 jest 的
// moduleNameMapper 里有映射，Metro 的 resolveRequest **没有**这个别名（只有 `@/` 与
// `@novel-master/core`），走 `@web/` 的话 RN 生产包会在模块解析阶段直接失败。
// `@/` 前缀 tsc / jest / Metro 三处都能解析。
import {HOST_THEME_KEYS} from '@/web/shared/host-theme';
// ready 的 u 标识与转录域能力清单同源（web 独立入口 main.ts 与本桥 import 同一
// 常量，不留第二份手抄；宿主对 ready 的判定只认 v === 2，标识仅辅助信息）。
import {TRANSCRIPT_READY_VERSION} from '@/web/chat-transcript/transcript-capabilities';

/**
 * 下行信封桥版本（**与旧包 `BRIDGE_V = 1` 刻意不同名**，避免重载歧义）。
 * 宿主下行恒为 v:2；web 侧（chat-transcript 独立入口 runtime）对下行信封的
 * 解码容忍该 v 号，不再有第二份同值常量需要对账。
 */
export const CONVERSATION_BRIDGE_V = 2 as const;

/**
 * 单 ready 的版本号标识（宿主只认 `v === 2` 的 ready，`version` 仅作辅助信息）。
 * 与 web 侧 `TRANSCRIPT_READY_VERSION` 同源：独立入口 ready 带 't1'、合成包壳
 * ready 仍带 'u1'（其 web 侧 model 未动），宿主对两者一视同仁（都判 v === 2）。
 */
export const CONVERSATION_READY_VERSION = TRANSCRIPT_READY_VERSION;

/**
 * 主题 token 9 键超集（transcript 7 ∪ composer 6 去重）。
 * 一次 `themeUpdate` 下发全文档生效（dispatcher fan-out 三方）。
 */
export type ConversationTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly primaryMuted: string;
  readonly selection: string;
  readonly danger: string;
  readonly surface: string;
  readonly borderLight: string;
};

/**
 * 键集常量（与 web 侧 `CONVERSATION_THEME_KEYS` **同一个数组引用**，同序同集）。
 *
 * 下面这行赋值同时是一道**编译期**守卫：`HOST_THEME_KEYS` 的元素类型是
 * `keyof HostTheme`，若宿主加了第 10 个 token 而上面的 `ConversationTheme`
 * 没跟着补字段，这里立刻类型不匹配——RN 侧漏键在 build 阶段就红，不必等 UI 变色。
 */
export const CONVERSATION_THEME_KEYS: readonly (keyof ConversationTheme)[] =
  HOST_THEME_KEYS;

/* ------------------------------------------------------------------ *
 * dock 域残余类型面（纯类型载体，不再经桥收发）
 * ------------------------------------------------------------------ */

/**
 * typeahead **候选源**（非过滤结果）。
 *
 * D4c 后不经桥收发（composerState 下行消息已删）；Step 5 起是
 * `useChatComposerController` → `NativeChatComposer.typeaheadSource` 的
 * 数据面类型。
 */
export type ConversationTypeaheadSource = {
  readonly files: readonly AtPathRef[];
  readonly skills: readonly EffectiveSkill[];
};

/** 空候选源（controller 尚未拉取 / 拉取失败时的显式空值，不用 undefined 表达「没有」）。 */
export const EMPTY_CONVERSATION_TYPEAHEAD_SOURCE: ConversationTypeaheadSource = {
  files: [],
  skills: [],
};

/**
 * dock 上行动作枚举（`handleDockAction` 的入参；调用方自 Step 5 起是
 * `NativeChatComposer` 的 toolbar / hintRow / 发送钮直调，枚举语义不变）。
 */
export type ConversationDockAction =
  | 'send'
  | 'terminate'
  | 'needModel'
  | 'fullscreen'
  | 'atPicker'
  | 'skillPicker';

/* ------------------------------------------------------------------ *
 * 下行消息清单（v2 信封 · D4c 收口后纯转录域）
 * ------------------------------------------------------------------ */

export type ConversationInitPayload = {
  readonly theme: ConversationTheme;
  readonly flags: TranscriptFlags;
  /**
   * 转录 only 变体（子会话屏，transcript-converge）：无输入 dock 的降级形态。
   * web 侧据此给 #app 挂 transcript-only 类（CSS 隐藏
   * dock）；可选字段、旧 dist 忽略，v 号不动。
   */
  readonly transcriptOnly?: boolean;
};

/** `sessionSnapshot` 分片载荷（字段分布约定与旧包逐字一致，见 ChatTranscriptBridge 注释）。 */
export type ConversationSnapshotPayload = {
  readonly sessionKey: string;
  readonly rows: readonly TranscriptRow[];
  readonly hasMore: boolean;
  /** 仅末片携带。 */
  readonly scrollIntent?: TranscriptScrollIntent;
  readonly restoreScroll?: TranscriptRestoreScroll;
  readonly generating?: boolean;
  readonly generation: number;
  readonly chunkIndex: number;
  readonly chunkTotal: number;
};

/** 下行信封（v2）。 */
export type ConversationEnvelope<T extends string, P> = {
  readonly v: typeof CONVERSATION_BRIDGE_V;
  readonly type: T;
  readonly payload: P;
};

/**
 * Host → Web 全量下行消息（**穷举**，载荷逐 type 收窄）。
 *
 * D4c 收口：composer 域 7 条下行（`setText` / `setSelection` / `setDisabled` /
 * `blur` / `composerState` / `composerPaste` / `selectAll`）已删——输入框由 RN
 * 原生组件承接。web 侧 `CONVERSATION_COMPOSER_TYPES` / `CONVERSATION_DOCK_TYPES`
 * 是合成包本体的路由清单（Step 6 随包退役），不再纳入 RN 侧对账。
 *
 * `stickIfNearBottom` 已不在本联合内：合成包侧 BASE 起无生产方（唯一潜在发送方
 * `keyboardLiftNonce` 恒为 0），web 侧清单已删除该条。
 */
export type ConversationHostMessage =
  | ConversationEnvelope<'init', ConversationInitPayload>
  | ConversationEnvelope<'themeUpdate', {theme: ConversationTheme}>
  | ConversationEnvelope<'flagsUpdate', {flags: TranscriptFlags}>
  | ConversationEnvelope<'sessionSnapshot', ConversationSnapshotPayload>
  | ConversationEnvelope<
      'prependPage',
      {rows: readonly TranscriptRow[]; prependedCount: number}
    >
  | ConversationEnvelope<'appendTailRows', {rows: readonly TranscriptRow[]}>
  | ConversationEnvelope<
      'streamCommit',
      {rows: readonly TranscriptRow[]; scrollIntent?: 'preserve' | 'none'}
    >
  | ConversationEnvelope<
      'streamDelta',
      {kind: 'text' | 'thinking'; delta?: string; html?: string}
    >
  | ConversationEnvelope<
      'streamBatch',
      {
        segments: readonly {kind: 'text' | 'thinking'; delta: string}[];
        textHtml?: string;
        thinkingHtml?: string;
      }
    >
  | ConversationEnvelope<
      'streamBlockCommit',
      {
        kind: 'text' | 'thinking';
        html?: string;
        text: string;
        tailHtml?: string;
        tailText?: string;
      }
    >
  | ConversationEnvelope<'streamReset', Record<string, never>>
  | ConversationEnvelope<'streamToolInvoking', {active: boolean}>
  | ConversationEnvelope<'closeMenu', Record<string, never>>
  | ConversationEnvelope<'closeMermaidViewer', Record<string, never>>;

export function encodeHostToConversation(
  message: ConversationHostMessage,
): string {
  return JSON.stringify(message);
}

/* ------------------------------------------------------------------ *
 * 上行（Web → Host）宽松解码
 * ------------------------------------------------------------------ */

/**
 * 上行信封（宽松形状）：`v` 可缺（老 runtime 上行恒 v:1）、`payload` 按 record 取。
 * **不做按 type 的载荷收窄**——收窄放在消费点（`ChatConversationWebView`），与旧
 * 宿主「先 decode 再 if-type 分发」的写法同款。
 */
export type ConversationUpstreamEnvelope = {
  readonly v?: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

/** 解码失败的原因（`ready` 单独一类：它是被 v 号判定的，不是形状问题）。 */
export type ConversationDecodeFailure = 'malformed' | 'stale-ready';

export type ConversationDecodeResult =
  | {readonly ok: true; readonly message: ConversationUpstreamEnvelope}
  | {readonly ok: false; readonly reason: ConversationDecodeFailure};

/**
 * 宽松 decoder（spec §合成 dispatcher 契约第 1 条，**自带、禁止复用
 * `decodeTranscriptToHost`**）。
 *
 * 口径：
 * - 坏 JSON / 非对象 / `type` 非字符串 → `malformed`（宿主静默丢弃）；
 * - `type === 'ready'` 且 `v !== 2` → `stale-ready`（旧 dist 的 ready，宿主走
 *   8s 超时兜底，**不得**因此置位 `webReady`——置位了就会把 v2 协议消息灌进
 *   一个不认得的页面）；
 * - 其余 type **一律不校验 `v`、不做白名单过滤**：转录域上行走模块级 post
 *   单例恒为 v:1；剥离后的 composer 域残余上行（旧 dist 的 change 等）也按
 *   「宽松放行、宿主不消费」处理，校验即丢消息反而掩盖问题。
 */
export function decodeConversationUpstream(
  raw: unknown,
): ConversationDecodeResult {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {ok: false, reason: 'malformed'};
    }
  }
  if (!isRecord(parsed)) {
    return {ok: false, reason: 'malformed'};
  }
  const type = parsed.type;
  if (typeof type !== 'string' || type === '') {
    return {ok: false, reason: 'malformed'};
  }
  if (type === 'ready' && parsed.v !== CONVERSATION_BRIDGE_V) {
    return {ok: false, reason: 'stale-ready'};
  }
  return {
    ok: true,
    message: {
      v: typeof parsed.v === 'number' ? parsed.v : undefined,
      type,
      payload: isRecord(parsed.payload) ? parsed.payload : {},
    },
  };
}

/** ready 携带的能力清单（缺省/非数组 → 空清单；「未声明 = 不支持」是硬约定）。 */
export function readReadyCapabilities(
  payload: Record<string, unknown>,
): readonly string[] {
  const raw = payload.capabilities;
  return Array.isArray(raw) ? (raw as readonly string[]) : [];
}

/** 能力清单判定：显式循环（老内核风格，与 `transcriptCapabilitiesInclude` 一致）。 */
export function conversationCapabilitiesInclude(
  capabilities: readonly string[] | undefined | null,
  target: string,
): boolean {
  if (!capabilities) {
    return false;
  }
  for (let i = 0; i < capabilities.length; i += 1) {
    if (capabilities[i] === target) {
      return true;
    }
  }
  return false;
}

/** `scrollSnapshot` → 滚动缓存快照（schema 版本不符返回 null；与旧宿主同口径）。 */
export function parseConversationScrollSnapshot(
  message: ConversationUpstreamEnvelope,
  schemaVersion: number,
): ChatTranscriptScrollSnapshot | null {
  if (message.type !== 'scrollSnapshot') {
    return null;
  }
  const {schemaVersion: msgSchemaVersion, offsetY, nearBottom} =
    message.payload;
  if (msgSchemaVersion !== schemaVersion) {
    return null;
  }
  if (typeof offsetY !== 'number' || typeof nearBottom !== 'boolean') {
    return null;
  }
  return {
    schemaVersion: msgSchemaVersion as ChatTranscriptScrollSnapshot['schemaVersion'],
    offsetY,
    nearBottom,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
