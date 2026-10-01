/**
 * 合成包下行消息 dispatcher（chat-webview-unify Step 5 · web 半）。
 *
 * 职责（spec §合成 dispatcher 契约五条之 2/5）：
 * 1. 解析 v2 信封，按 §下行消息路由表分流；
 * 2. transcript / composer 两域**重打包为 v1 信封**再喂各自 runtime 的既有
 *    `handleHostMessage(raw)`——两个 runtime 内部零改动（其 `BRIDGE_V` 硬编码
 *    不动，重打包用的 v 号由本文件 import 两包常量并加一致性守卫；
 *    重打包成本极低：composer 域仅程序化写入时才有下行）；
 * 3. `themeUpdate`（9 键超集）**fan-out 三方**——transcript + composer + dock 自有
 *    `applyHostTheme`，三者写的都是 documentElement、键集互为超集不漏键；
 * 4. 聚合 `init` 拆包：transcript 喂 `{theme, flags}`、composer 喂
 *    `{mode, disabled, theme, metrics, placeholder}`、`safeAreaBottom` 由 dock 消费。
 *
 * 路由判定本身是**纯函数**（`routeHostMessage`）：不碰 DOM、不 post，输入一条
 * raw 消息输出一份「各域该收到什么」的路由表——单测直接在 node 环境断言
 * 域路由各自命中且不串（见 `__tests__/chat-conversation-dispatcher.test.ts`）。
 *
 * es2018 纪律：禁 ES2021+ 运行时 API 与 lookbehind 正则。
 */
import {matchHostMessage} from '@web/shared/host-message-channel';
// 重打包用的 v 号**不写死 1**：直接取两个旧 runtime 各自导出的 BRIDGE_V
// （别名区分，免得与本包的 CONVERSATION_BRIDGE_V 混淆）。
import {BRIDGE_V as TRANSCRIPT_BRIDGE_V} from '@web/chat-transcript/webview/runtime/state/state';
import {BRIDGE_V as COMPOSER_BRIDGE_V} from '@web/composer-input/webview/runtime/model';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_COMPOSER_MODE,
  CONVERSATION_COMPOSER_METRICS,
  CONVERSATION_COMPOSER_TYPES,
  CONVERSATION_DOCK_TYPES,
  CONVERSATION_TRANSCRIPT_TYPES,
  type ConversationComposerState,
  type ConversationHostMessage,
  type ConversationTheme,
  type ConversationTypeaheadSource,
} from './model';

/**
 * 复用的 v1 信封形状（两个 runtime 的 `matchHostMessage(raw, BRIDGE_V)` 口径）。
 * `v` 取 transcript 包的字面量类型——两包 BRIDGE_V 恒等由下方守卫在装配期锁死。
 */
type V1Envelope = {
  readonly v: typeof TRANSCRIPT_BRIDGE_V;
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

/**
 * 一致性守卫：两个旧 runtime 的 BRIDGE_V 必须恒等。
 *
 * 为什么要炸而不是各写各的：重打包出的信封由两侧各自的
 * `matchHostMessage(raw, BRIDGE_V)` 判 v 号，一旦某侧单独把 v 改了而另一侧没改，
 * 那一域的整段下行会被**静默丢弃**（无报错、无日志，只表现为「消息下不来」），
 * 真机排查成本极高。所以在模块装配期就 throw，把问题钉在构建/启动这一步。
 */
if (TRANSCRIPT_BRIDGE_V !== COMPOSER_BRIDGE_V) {
  throw new Error(
    '[chat-conversation] 旧 runtime BRIDGE_V 不一致：transcript=' +
      TRANSCRIPT_BRIDGE_V +
      ' / composer=' +
      COMPOSER_BRIDGE_V,
  );
}

/** dock 域要处理的下行意图（不经旧 runtime，合成包自有 handler 消费）。 */
export type ConversationDockRoute =
  | {readonly kind: 'init'; readonly safeAreaBottom: number}
  | {readonly kind: 'composerState'; readonly state: ConversationComposerState}
  | {readonly kind: 'composerPaste'; readonly text: string}
  | {readonly kind: 'selectAll'};

/**
 * 一次下行的路由结果：三个域各自「该收到什么」。
 * `null` = 该域本条无消息（不调用其 handler）。
 */
export type ConversationRoute = {
  readonly transcript: V1Envelope | null;
  readonly composer: V1Envelope | null;
  readonly dock: ConversationDockRoute | null;
  /** `themeUpdate` 时给 dock 的第三份 fan-out（transcript/composer 走上面两个字段）。 */
  readonly theme: ConversationTheme | null;
};

const EMPTY_ROUTE: ConversationRoute = {
  transcript: null,
  composer: null,
  dock: null,
  theme: null,
};

/** 显式循环（老内核风格，与 `transcriptCapabilitiesInclude` 一致，不碰 `includes`）。 */
function contains(list: readonly string[], target: string): boolean {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === target) {
      return true;
    }
  }
  return false;
}

function v1(type: string, payload: Record<string, unknown>): V1Envelope {
  return {v: TRANSCRIPT_BRIDGE_V, type, payload};
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** typeahead 候选源宽松取值：非数组回落空源（不让宿主一处笔误打挂 typeahead）。 */
export function coerceTypeaheadSource(
  value: unknown,
): ConversationTypeaheadSource {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    files: Array.isArray(raw.files) ? (raw.files as never[]) : [],
    skills: Array.isArray(raw.skills) ? (raw.skills as never[]) : [],
  };
}

/**
 * 聚合 `init` 拆包点（spec 契约第 5 条）——纯函数，单测直断言拆出的两份 v1 形状。
 *
 * `theme` 用同一份 9 键超集喂两方（composer 的 `applyInit` 读它需要的键、
 * 多余键忽略）；`safeAreaBottom` 不下喂 runtime，由 dock 消费。
 */
export function splitInitPayload(payload: Record<string, unknown>): {
  readonly transcript: Record<string, unknown>;
  readonly composer: Record<string, unknown>;
  readonly safeAreaBottom: number;
} {
  const composer = (payload.composer ?? {}) as Record<string, unknown>;
  const theme = (payload.theme ?? {}) as ConversationTheme;
  return {
    transcript: {theme, flags: payload.flags ?? {}},
    composer: {
      mode: str(composer.mode, CONVERSATION_COMPOSER_MODE),
      disabled: composer.disabled === true,
      theme,
      metrics: composer.metrics ?? CONVERSATION_COMPOSER_METRICS,
      placeholder: str(composer.placeholder, ''),
    },
    safeAreaBottom: num(composer.safeAreaBottom, 0),
  };
}

/**
 * 路由纯函数：解析 v2 信封 → 三域投递表。无法解析（坏 JSON / v 不符 / 无 type）
 * 返回 null，语义与两个 runtime 的 `matchHostMessage` 一致（静默丢弃）。
 */
export function routeHostMessage(raw: unknown): ConversationRoute | null {
  const msg = matchHostMessage(raw, CONVERSATION_BRIDGE_V);
  if (msg == null) {
    return null;
  }
  const type = msg.type as string;
  const payload = (msg.payload ?? {}) as Record<string, unknown>;

  if (type === 'init') {
    const split = splitInitPayload(payload);
    return {
      transcript: v1('init', split.transcript),
      composer: v1('init', split.composer),
      dock: {kind: 'init', safeAreaBottom: split.safeAreaBottom},
      theme: null,
    };
  }

  if (type === 'themeUpdate') {
    const theme = (payload.theme ?? null) as ConversationTheme | null;
    if (theme == null) {
      return EMPTY_ROUTE;
    }
    // fan-out 三方：两份 v1 信封 + dock 自有 applyHostTheme
    return {
      transcript: v1('themeUpdate', {theme}),
      composer: v1('themeUpdate', {theme}),
      dock: null,
      theme,
    };
  }

  if (contains(CONVERSATION_TRANSCRIPT_TYPES, type)) {
    return {...EMPTY_ROUTE, transcript: v1(type, payload)};
  }

  if (contains(CONVERSATION_COMPOSER_TYPES, type)) {
    return {...EMPTY_ROUTE, composer: v1(type, payload)};
  }

  if (contains(CONVERSATION_DOCK_TYPES, type)) {
    // 显式分支逐条列举，清单外的 type 一律落到末尾的 EMPTY_ROUTE。
    // 旧写法是「非 composerState / 非 composerPaste 就兜底 selectAll」——那是**带副作用**
    // 的默认分支：以后往 CONVERSATION_DOCK_TYPES 里加一条新 type 而忘了写分支，
    // 宿主发来的新意图会被当成「全选输入框」执行，用户可见的行为完全跑偏。
    if (type === 'composerState') {
      return {
        ...EMPTY_ROUTE,
        dock: {
          kind: 'composerState',
          state: coerceComposerState(payload),
        },
      };
    }
    if (type === 'composerPaste') {
      return {...EMPTY_ROUTE, dock: {kind: 'composerPaste', text: str(payload.text, '')}};
    }
    if (type === 'selectAll') {
      return {...EMPTY_ROUTE, dock: {kind: 'selectAll'}};
    }
    // 清单内但无对应 handler（例如只登记了 type、handler 还没落地）：空路由，不猜。
    return EMPTY_ROUTE;
  }

  // 未知 type：静默丢弃（与两个 runtime 的 matchHostMessage 同口径）。
  return EMPTY_ROUTE;
}

/** `composerState` 宽松取值：逐字段兜底，缺字段不让 dock 崩。 */
export function coerceComposerState(
  payload: ConversationHostMessage['payload'] | Record<string, unknown>,
): ConversationComposerState {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const error = typeof raw.error === 'string' && raw.error !== '' ? raw.error : undefined;
  return {
    inputDisabled: raw.inputDisabled === true,
    hasModel: raw.hasModel === true,
    sendDisabled: raw.sendDisabled === true,
    running: raw.running === true,
    ...(error != null ? {error} : {}),
    fullscreenEnabled: raw.fullscreenEnabled === true,
    placeholder: str(raw.placeholder, ''),
    chips: Array.isArray(raw.chips) ? (raw.chips as never[]) : [],
    keyboardUp: raw.keyboardUp === true,
    typeahead: coerceTypeaheadSource(raw.typeahead),
  };
}

/** dispatcher 依赖的最小面（两 runtime 的 `handleHostMessage` + dock handler）。 */
export type ConversationDispatcherDeps = {
  readonly handleTranscript: (raw: unknown) => void;
  readonly handleComposer: (raw: unknown) => void;
  readonly applyDockRoute: (route: ConversationDockRoute) => void;
  readonly applyDockTheme: (theme: ConversationTheme) => void;
};

/** 路由表 → 副作用（分开是为了单测能只测纯路由、或只测副作用投递）。 */
export function dispatchRoute(
  deps: ConversationDispatcherDeps,
  route: ConversationRoute | null,
): void {
  if (route == null) {
    return;
  }
  if (route.transcript != null) {
    deps.handleTranscript(route.transcript);
  }
  if (route.composer != null) {
    deps.handleComposer(route.composer);
  }
  if (route.dock != null) {
    deps.applyDockRoute(route.dock);
  }
  if (route.theme != null) {
    deps.applyDockTheme(route.theme);
  }
}

/** 入口绑定用的 handler 闭包（`bindHostMessageChannel(dispatcher)` 的入参）。 */
export function createConversationDispatcher(
  deps: ConversationDispatcherDeps,
): (raw: unknown) => void {
  return raw => {
    dispatchRoute(deps, routeHostMessage(raw));
  };
}
