/**
 * chat-conversation 桥协议 v2 类型（chat-webview-unify Step 5 · web 侧真源）。
 *
 * 定位：本文件是**合成包 web 侧**的协议真源（RN 侧同形声明在 wave-4 的
 * `ChatConversationBridge.ts`，两侧 `CONVERSATION_BRIDGE_V` 必须一致）。
 * 之所以 web 侧也放一份而不直接共享：web 侧不引 RN 模块（合成包只经 `@web/*`
 * 与纯 .ts 的共享函数入 bundle），共享一份会把 RN 依赖拖进 bundle。
 *
 * 与旧包的两处关键差异（spec §桥协议 v2）：
 * 1. 下行信封桥版本 = 2（结构变更防旧 dist 混淆）。runtime 内部上行仍各自 v:1
 *    单例不动——v:2 只用于本包自有的 `ready` / `dockAction`（见 dispatcher）。
 * 2. `init` 聚合为一条：`{theme, flags, composer:{mode, disabled, metrics,
 *    placeholder, safeAreaBottom}}`，由 dispatcher 拆成两份 v1 形状喂两个 runtime。
 *
 * es2018 纪律：禁 ES2021+ 运行时 API 与 lookbehind 正则（esbuild target es2018）。
 */
import type {AtPathRef, MessageAttachment} from '@novel-master/core/chat';
import type {EffectiveSkill} from '@novel-master/core/skills';
// 键集真源在 shared/host-theme（值 import：键集不再在本文件手抄一份）
import {HOST_THEME_KEYS, type HostTheme} from '@web/shared/host-theme';
import type {ComposerMetrics} from '@web/composer-input/webview/runtime/model';
// 运行时值 import（能力清单真源在 chat-transcript 包内，刻意不搬，避免双份漂移）
import {TRANSCRIPT_CAPABILITIES} from '@web/chat-transcript/transcript-capabilities';

export type {AtPathRef, EffectiveSkill, MessageAttachment};

/** 下行信封桥版本（**与旧包 `BRIDGE_V = 1` 刻意不同名**，避免重载歧义）。 */
export const CONVERSATION_BRIDGE_V = 2;

/** 单 ready 的版本号标识（宿主只认 `v === 2` 的 ready）。 */
export const CONVERSATION_READY_VERSION = 'u1';

/**
 * 新包自有能力位（`composer-dock`）。
 *
 * **刻意不写进 `TRANSCRIPT_CAPABILITIES` 共享常量数组**——否则旧 chat-transcript
 * 包的 ready 也会带上该位，「未声明 = 不支持」的降级纪律对旧包失真
 * （spec §能力协商与降级纪律）。由合成入口构造 capabilities 时并入。
 */
export const CONVERSATION_CAPABILITY_COMPOSER_DOCK = 'composer-dock';

/**
 * 主题 token 9 键超集（transcript 7 键 ∪ composer 6 键去重）。
 * 一次 `themeUpdate` 下发全文档生效：transcript runtime / composer runtime /
 * dock 自有 `applyHostTheme` 三方 fan-out，键集互为超集不漏键。
 * 字段形状直接复用 `@web/shared/host-theme` 的 `HostTheme`（已含 `selection`）。
 */
export type ConversationTheme = HostTheme;

/**
 * 主题键数（9）：T-CU2 的「9 键超集」口径。
 *
 * **不手抄**：键集直接取 `@web/shared/host-theme` 的 `HOST_THEME_KEYS`（从
 * `THEME_VARS` 派生）——宿主在 shared 加/删一个 token 时本清单与 RN 侧
 * `ChatConversationBridge` 的同名常量同时跟随，零漂移面。
 */
export const CONVERSATION_THEME_KEYS: readonly (keyof ConversationTheme)[] =
  HOST_THEME_KEYS;

/**
 * 单 ready 上报的**全集**能力：转录域共享常量 ∪ 本包自有 `composer-dock` 位。
 *
 * `composer-dock` 只在这里并入（不写回共享常量数组，理由见该常量注释）；
 * 旧 chat-transcript 包的 ready 因此不带该位，「未声明 = 不支持」对旧包仍成立。
 */
export function conversationCapabilities(): readonly string[] {
  return [
    ...TRANSCRIPT_CAPABILITIES,
    CONVERSATION_CAPABILITY_COMPOSER_DOCK,
  ];
}

/** dock 域的 `input` 尺寸口径（spec Step 4 数值清单，随 `ComposerAtPathInput` 删除整体迁入）。 */
export const CONVERSATION_COMPOSER_METRICS: ComposerMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  // 5 行封顶 = paddingV×2 + lineHeight×5 = 12 + 110
  maxHeight: 122,
};

/** `init.composer` 的 mode：合成包恒为 chat 链的 composer-token（宏链不走本包）。 */
export const CONVERSATION_COMPOSER_MODE = 'composer-token';

/* ------------------------------------------------------------------ *
 * composerState（下行 · dock 域聚合状态）
 * ------------------------------------------------------------------ */

/**
 * typeahead **候选源**（非过滤结果）：RN 在进会话 / 工作区变更（vfsMutated）/
 * 技能变更时拉取下发；query 过滤与点选插入在 web 侧同文档完成（零跨桥）。
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
   * 状态 chip 列表（`projectComposerStatusForSession` 整表替换 + annotate ∪）。
   * **纯展示、不可点、不随 `inputDisabled` 置灰**——现网 `AttachmentDraftChips`
   * 的 `disabled` 是透传后未使用的死参数。
   */
  readonly chips: readonly MessageAttachment[];
  /** 键盘态（RN 侧 `useReanimatedKeyboardAnimation` 派生）：dock 底 padding 归零/恢复。 */
  readonly keyboardUp: boolean;
  /** typeahead 候选源；缺省按空源处理。 */
  readonly typeahead?: ConversationTypeaheadSource;
};

/* ------------------------------------------------------------------ *
 * dockAction（上行 · web → RN）
 * ------------------------------------------------------------------ */

/**
 * dock 上行动作枚举（spec §dockAction）。
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

/* ------------------------------------------------------------------ *
 * 列表域（下行 sessionList / viewState · 上行 listAction）
 * ------------------------------------------------------------------ */

/**
 * 会话列表行（下行 `sessionList` 的元素形状）。
 *
 * **纯数据、零业务推导**：三个徽标判据（生成中 / 已中断 / 当前）由 RN 侧算好后逐会话
 * 下发——`active` 是 manager 的真实判活（starting|running 单元集合），
 * `interrupted` 是水合回填的中断现场，`current` 是「当前会话」。web 侧**不得**自己
 * 推导任何一个（`current` 尤其推不出来：web 只知道自己渲染的是哪个 sessionKey，
 * 而宿主可能同时开着别的会话面板）。理由见 spec §桥协议扩展。
 */
export type SessionListItem = {
  readonly id: string;
  /** 缺省回落 `id`（与现网 `item.title ?? item.id` 同款）。 */
  readonly title?: string;
  readonly updatedAtMs: number;
  /** 「生成中」徽标 + meta 的「 · 活跃中」后缀，二者同判据。 */
  readonly active: boolean;
  /** 「已中断」徽标（RN 侧已与 active 互斥：真在跑就不标中断）。 */
  readonly interrupted: boolean;
  /** 「当前」位置徽标（批量态下 RN 不渲染它）。 */
  readonly current: boolean;
};

/**
 * 下行 `sessionList` 载荷。
 *
 * `batchSelect` 是**可选**而非空数组：它的双重职责是「批量勾选集合」与「批量态开关」
 * （RN 的 `sessionBatchActive` 单独一个 prop）。字段缺省 = 不在批量态；给了（哪怕是
 * 空数组）= 在批量态、暂未勾选任何一行。合成一个字段省掉第二个布尔，省不掉的那层
 * 语义（勾选集合）本来就要传。
 */
export type ConversationSessionListPayload = {
  readonly sessions: readonly SessionListItem[];
  readonly batchSelect?: readonly string[];
};

/** 当前显示哪个视图（宿主把 `chatSubview` 映射下发；web 侧只切 `data-view` 属性）。 */
export type ConversationView = 'list' | 'conversation';

export type ConversationViewStatePayload = {
  readonly view: ConversationView;
};

/**
 * listAction 动作枚举（spec §桥协议扩展 · 上行）。
 *
 * 业务**全留 RN**：open 走 openConversation 状态机、delete 弹原生确认、rename 走既有
 * prompt、stopRun 走 manager 单元 abort。web 侧只做手势识别与命中判定。
 * `menuOpen` 只上报「点了 ⋮」，菜单本身由 RN 的 BottomSheetMenu 渲染（弹层留原生，
 * 见 spec §范围「不做」）。
 *
 * `batchDelete` / `batchExit` 是**批量头专有的两项**（wave-3）：批量 UI 归 web，
 * 但删不删、退出不退出由宿主定——web 侧只报「点了删除 / 点了取消」，确认链
 * （原生 Alert）与批量态真源（`useBatchSelection`）全在 RN。二者同 `create` 一样
 * **不带 sessionId**：作用于整个勾选集合，没有「哪一行」可言。
 */
export type ConversationListAction =
  | 'open'
  | 'create'
  | 'menuOpen'
  | 'rename'
  | 'copy'
  | 'delete'
  | 'stopRun'
  | 'longPress'
  | 'batchToggle'
  | 'batchDelete'
  | 'batchExit';

export const CONVERSATION_LIST_ACTIONS: readonly ConversationListAction[] = [
  'open',
  'create',
  'menuOpen',
  'rename',
  'copy',
  'delete',
  'stopRun',
  'longPress',
  'batchToggle',
  'batchDelete',
  'batchExit',
];

/**
 * 上行 `listAction` 载荷。
 *
 * `sessionId` 只在「作用于某一行」的动作上带（open/menuOpen/longPress/batchToggle/
 * rename/copy/delete/stopRun）；`create` / `batchDelete` / `batchExit` 不带
 * （前者没有行可指，后两者作用于整个勾选集合）。
 */
export type ConversationListActionPayload = {
  readonly kind: ConversationListAction;
  readonly sessionId?: string;
};

/* ------------------------------------------------------------------ *
 * 下行消息清单（v2 信封）
 * ------------------------------------------------------------------ */

/** 聚合 `init` 的 `composer` 段（安全区高度只由 dock 消费，不下喂 runtime）。 */
export type ConversationInitComposer = {
  readonly mode: typeof CONVERSATION_COMPOSER_MODE;
  readonly disabled: boolean;
  readonly metrics: ComposerMetrics;
  readonly placeholder: string;
  readonly safeAreaBottom: number;
};

export type ConversationInitPayload = {
  readonly theme: ConversationTheme;
  readonly flags: {readonly richText: boolean; readonly menuDisabled: boolean};
  readonly composer: ConversationInitComposer;
};

/**
 * 走 transcript runtime 的下行 type（重打包为 v1 信封喂 `handleHostMessage`）。
 *
 * `stickIfNearBottom` 已移除：**BASE 起即无生产方**（唯一潜在发送方
 * `keyboardLiftNonce` 恒为 0，现网也从未真发过），本轮清掉这条死协议面。
 * 旧 chat-transcript 包仍认这条（其 bridge case 不动——旧包仍出产物，
 * 动它有 dist 契约测风险），只是合成包不再路由它。
 */
export const CONVERSATION_TRANSCRIPT_TYPES: readonly string[] = [
  'sessionSnapshot',
  'prependPage',
  'appendTailRows',
  'streamDelta',
  'streamBatch',
  'streamBlockCommit',
  'streamReset',
  'streamCommit',
  'streamToolInvoking',
  'flagsUpdate',
  'closeMenu',
  'closeMermaidViewer',
];

/** 走 composer runtime 的下行 type。 */
export const CONVERSATION_COMPOSER_TYPES: readonly string[] = [
  'setText',
  'setSelection',
  'setDisabled',
  'blur',
];

/** 走 dock 自有 handler 的下行 type。 */
export const CONVERSATION_DOCK_TYPES: readonly string[] = [
  'composerState',
  'composerPaste',
  'selectAll',
];

/**
 * 走 session-list 自有 handler 的下行 type（**第四域**，与前三张表并列）。
 *
 * 独立成域而不挂在 transcript/dock 域下：这两条的下游是 `#session-list` 这块独立视图，
 * 与转录行窗口化、composer 输入区都没有任何共享面；混进已有域会让 `dispatchRoute`
 * 的「该域本条无消息」判据失去意义。
 */
export const CONVERSATION_LIST_TYPES: readonly string[] = [
  'sessionList',
  'viewState',
];

export type ConversationHostMessage = {
  readonly v?: number;
  readonly type?: string;
  readonly payload?: Record<string, unknown>;
};

/** Host → Web（全量 type 清单；未知 type 静默丢弃）。 */
export type ConversationHostToWebType =
  | 'init'
  | 'themeUpdate'
  | (typeof CONVERSATION_TRANSCRIPT_TYPES)[number]
  | (typeof CONVERSATION_COMPOSER_TYPES)[number]
  | (typeof CONVERSATION_DOCK_TYPES)[number]
  | (typeof CONVERSATION_LIST_TYPES)[number];

/**
 * Web → Host（**v:2 的只有新包自有的三条**；其余上行由两 runtime 的 v:1 单例负责）。
 *
 * 命名带 `V2` 是因为它只描述 v:2 那一小段——叫 `ConversationWebToHostType` 会
 * 被误读成「web→host 全量上行 type 清单」，而全量里还混着两 runtime 的 v:1 单例。
 */
export type ConversationWebToHostV2Type =
  | 'ready'
  | 'dockAction'
  | 'listAction';
