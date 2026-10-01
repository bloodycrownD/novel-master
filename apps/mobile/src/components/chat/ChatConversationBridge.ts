/**
 * chat-conversation 桥协议 v2 · **RN 侧单源**（chat-webview-unify Step 5 · RN 半）。
 *
 * 定位：web 侧同形声明在 `src/web/chat-conversation/webview/model.ts`，两侧
 * `CONVERSATION_BRIDGE_V` **必须一致**（一致性由 `__tests__/chat-conversation-bridge.test.ts`
 * 直接 import 双端比对断言锁死——这是「两份声明」唯一的正确性保障，勿改任一侧而不改另一侧）。
 * 之所以不共享一份：web bundle 不引 RN 模块，共享会把 RN 依赖拖进 8.9MB 产物。
 *
 * 三条协议定案（CR 首评 OQ，本文件为 RN 侧落点）：
 *
 * 1. **`composerState.typeahead` 必达**（不写可选）。web 侧把它声明为可选是因为
 *    web 侧要兜底「畸形载荷」；RN 侧是生产者，候选源永远随 composerState 一起下发，
 *    写可选只会诱导 controller 造出「有时不带头」的 state 让 web 静默回落空源。
 *    两侧宽严不同是刻意的：生产必达、消费兜底。
 *
 * 2. **`readOnly` / `placeholder` / `disabled` 的唯一真源是 `composerState`**，
 *    `init` 只管 metrics / mode / safeAreaBottom。`init.composer` 里那份
 *    `disabled` / `placeholder` 是同一渲染拍点的初值快照（web 侧 `applyInit` 需要
 *    才能在首帧就把 textarea 摆对），**不是第二真源**——恢复链固定顺序
 *    `init → composerState → 草稿 setText → 快照直发`，composerState 紧随 init 落下，
 *    任何后续变化一律走 composerState。改动 `init.composer` 的这两个字段
 *    （例如让 init 恒传 disabled:false）会让首帧与真源短暂分叉，属回归。
 *
 * 3. **候选源仍搭 `composerState` 携带，但下行必须按引用比**：`typeahead` 走引用
 *    比较即可（controller 在内容不变时下发同一引用），本文件不提供深比较——
 *    候选列表是 `buildListRows()` / `effectiveSkills()` 的产物，深比较每次渲染
 *    O(n) 且必然制造新的对象引用，反而让「引用相同」这条捷径失效。宿主侧见
 *    `ChatConversationWebView.tsx` 的 composerState 下发 effect（typeahead 单列依赖）。
 *
 * 上行 v 号（spec §合成 dispatcher 契约第 1 条）：两旧 runtime 的上行恒为 v:1
 * （模块级 `post` 单例不可替换），新包自有的 `ready` / `dockAction` 才是 v:2。
 * 因此**解码必须宽松**：先宽松 parse 取 `type`，`ready` 判 `v === 2`，
 * 其余 type 一律不校验 `v`（否则 transcript / composer 域的上行会被整段丢弃）。
 *
 * **禁止复用 `decodeTranscriptToHost`**：它对 `v !== 1` 直接 throw，会被宿主
 * try/catch 静默吞掉 → `webReady` 永假 → 全部下行丢弃 → 落进 8s 兜底白屏。
 */
import type {
  AtPathRef,
  MessageAttachment,
} from '@novel-master/core/chat';
import type {EffectiveSkill} from '@novel-master/core/skills';
import type {
  ComposerInputMetrics,
  ComposerInputSelection,
} from './ComposerInputBridge';
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

/**
 * 下行信封桥版本（**与旧包 `BRIDGE_V = 1` 刻意不同名**，避免重载歧义）。
 * 与 `src/web/chat-conversation/webview/model.ts` 同值，双端一致性有测试锁定。
 */
export const CONVERSATION_BRIDGE_V = 2 as const;

/** 单 ready 的版本号标识（宿主只认 `v === 2` 的 ready，`version` 仅作辅助信息）。 */
export const CONVERSATION_READY_VERSION = 'u1' as const;

/** 新包自有能力位（`composer-dock`）——**刻意不进** `TRANSCRIPT_CAPABILITIES` 共享数组。 */
export const CONVERSATION_CAPABILITY_COMPOSER_DOCK = 'composer-dock';

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

/** dock 域 `input` 尺寸口径（随 `ComposerAtPathInput.tsx` 删除整体迁入；5 行封顶 = 12 + 22×5）。 */
export const CONVERSATION_COMPOSER_METRICS: ComposerInputMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 122,
};

/** `init.composer` 的 mode：合成包恒为 chat 链的 composer-token（宏链不走本包）。 */
export const CONVERSATION_COMPOSER_MODE = 'composer-token' as const;

/* ------------------------------------------------------------------ *
 * composerState（下行 · dock 域聚合状态）
 * ------------------------------------------------------------------ */

/**
 * typeahead **候选源**（非过滤结果）：RN 在进会话 / 工作区变更 / 技能变更时拉取下发；
 * query 过滤与点选插入在 web 侧同文档完成（零跨桥）。RN 侧必达（见文件头定案 ①）。
 */
export type ConversationTypeaheadSource = {
  readonly files: readonly AtPathRef[];
  readonly skills: readonly EffectiveSkill[];
};

/**
 * dock 全字段状态（spec §composerState 字段表）。
 *
 * web 侧**不做任何业务推导**：派生值（`inputDisabled` / `sendDisabled` / `running`）
 * 全由 RN controller 算好后下发；`hasModel` 单独携带，因为 hintRow 显隐判据是
 * `!hasModel`——`inputDisabled` 是它的超集，运行态下用后者会误显 hintRow。
 */
export type ConversationComposerState = {
  readonly inputDisabled: boolean;
  readonly hasModel: boolean;
  readonly sendDisabled: boolean;
  readonly running: boolean;
  readonly error?: string;
  readonly fullscreenEnabled: boolean;
  readonly placeholder: string;
  /**
   * 状态 chip 列表。**纯展示、不可点、不随 `inputDisabled` 置灰**——现网
   * `AttachmentDraftChips` 的 `disabled` 是透传后未使用的死参数。
   */
  readonly chips: readonly MessageAttachment[];
  /** 键盘态（RN 侧 `useReanimatedKeyboardAnimation` 派生）：dock 底 padding 归零/恢复。 */
  readonly keyboardUp: boolean;
  /** typeahead 候选源（RN 侧必达——web 侧另有兜底，见文件头定案 ①）。 */
  readonly typeahead: ConversationTypeaheadSource;
};

/** 空候选源（controller 尚未拉取 / 拉取失败时的显式空值，不用 undefined 表达「没有」）。 */
export const EMPTY_CONVERSATION_TYPEAHEAD_SOURCE: ConversationTypeaheadSource = {
  files: [],
  skills: [],
};

/* ------------------------------------------------------------------ *
 * dockAction（上行 · web → RN）
 * ------------------------------------------------------------------ */

/**
 * dock 上行动作枚举（spec §dockAction 六项）。
 * typeahead 点选**不在枚举里**——web 自治完成，无跨桥。
 */
export type ConversationDockAction =
  | 'send'
  | 'terminate'
  | 'needModel'
  | 'fullscreen'
  | 'atPicker'
  | 'skillPicker';

export const CONVERSATION_DOCK_ACTIONS: readonly ConversationDockAction[] = [
  'send',
  'terminate',
  'needModel',
  'fullscreen',
  'atPicker',
  'skillPicker',
];

/** 显式循环判定（老内核风格，与 `transcriptCapabilitiesInclude` 一致，不碰 `includes`）。 */
export function conversationDockActionIncludes(
  value: unknown,
): value is ConversationDockAction {
  if (typeof value !== 'string') {
    return false;
  }
  for (let i = 0; i < CONVERSATION_DOCK_ACTIONS.length; i += 1) {
    if (CONVERSATION_DOCK_ACTIONS[i] === value) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 下行消息清单（v2 信封）
 * ------------------------------------------------------------------ */

/** 聚合 `init` 的 `composer` 段（安全区高度只由 dock 消费，不下喂 runtime）。 */
export type ConversationInitComposer = {
  readonly mode: typeof CONVERSATION_COMPOSER_MODE;
  readonly disabled: boolean;
  readonly metrics: ComposerInputMetrics;
  readonly placeholder: string;
  readonly safeAreaBottom: number;
};

export type ConversationInitPayload = {
  readonly theme: ConversationTheme;
  readonly flags: TranscriptFlags;
  readonly composer: ConversationInitComposer;
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
 * 原先这里还有一份同名的「22 项手写 type 清单」`ConversationHostToWebType`，
 * 与本联合类型同集、零消费方——加下行 type 时它不会跟随，纯粹是漂移面，本轮删除。
 * 需要「全量 type 名」的场合直接取 `ConversationHostMessage['type']`。
 *
 * `stickIfNearBottom` 已不在本联合内：合成包侧 BASE 起无生产方（唯一潜在发送方
 * `keyboardLiftNonce` 恒为 0），web 侧清单已删除该条，双端集相等由
 * `__tests__/chat-conversation-bridge.test.ts` 断言锁死。
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
  | ConversationEnvelope<'closeMermaidViewer', Record<string, never>>
  | ConversationEnvelope<
      'setText',
      {text: string; selectionStart?: number; selectionEnd?: number}
    >
  | ConversationEnvelope<'setSelection', ComposerInputSelection>
  | ConversationEnvelope<'setDisabled', {disabled: boolean}>
  | ConversationEnvelope<'blur', Record<string, never>>
  | ConversationEnvelope<'composerState', ConversationComposerState>
  | ConversationEnvelope<'composerPaste', {text: string}>
  | ConversationEnvelope<'selectAll', Record<string, never>>;

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
 * - 其余 type **一律不校验 `v`**：transcript / composer 两域上行走各自模块级
 *   post 单例，恒为 v:1，校验即丢消息。
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
