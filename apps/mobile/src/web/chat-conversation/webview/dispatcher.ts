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
 *    `{mode, disabled, theme, metrics, placeholder}`、`safeAreaBottom` 由 dock 消费；
 * 5. **列表域（第四域）**：`sessionList` / `viewState` 走 `applyListRoute` 一条回调，
 *    与前三域正交、互不影响（切列表视图不该惊动转录与输入框）。
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
  CONVERSATION_LIST_TYPES,
  CONVERSATION_TRANSCRIPT_TYPES,
  type ConversationComposerState,
  type ConversationHostMessage,
  type ConversationSessionListPayload,
  type ConversationTheme,
  type ConversationTypeaheadSource,
  type ConversationView,
  type SessionListItem,
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
  | {
      readonly kind: 'init';
      readonly safeAreaBottom: number;
      /** 转录 only 变体（transcript-converge）：#app 挂类隐藏 dock。 */
      readonly transcriptOnly: boolean;
    }
  | {readonly kind: 'composerState'; readonly state: ConversationComposerState}
  | {readonly kind: 'composerPaste'; readonly text: string}
  | {readonly kind: 'selectAll'};

/**
 * 列表域要处理的下行意图（第四域，自有 handler 消费）。
 *
 * 显式枚举逐条列举，**不带默认分支**——与 dock 域同款红线：清单里登记了 type 而
 * 分支没跟上时，宁可空路由也不要让宿主发来的新意图被猜成别的动作。
 */
export type ConversationListRoute =
  | {readonly kind: 'sessionList'; readonly payload: ConversationSessionListPayload}
  | {readonly kind: 'viewState'; readonly view: ConversationView};

/**
 * 一次下行的路由结果：四个域各自「该收到什么」。
 * `null` = 该域本条无消息（不调用其 handler）。
 */
export type ConversationRoute = {
  readonly transcript: V1Envelope | null;
  readonly composer: V1Envelope | null;
  readonly dock: ConversationDockRoute | null;
  /** 列表域（第四域）：`sessionList` / `viewState` 两条走这里，与前三域正交。 */
  readonly list: ConversationListRoute | null;
  /** `themeUpdate` 时给 dock 的第三份 fan-out（transcript/composer 走上面两个字段）。 */
  readonly theme: ConversationTheme | null;
};

const EMPTY_ROUTE: ConversationRoute = {
  transcript: null,
  composer: null,
  dock: null,
  list: null,
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
      dock: {
        kind: 'init',
        safeAreaBottom: split.safeAreaBottom,
        transcriptOnly: payload.transcriptOnly === true,
      },
      list: null,
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
      list: null,
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

  if (contains(CONVERSATION_LIST_TYPES, type)) {
    // 同 dock 域的显式分支纪律：登记了 type 却没写分支时**空路由**，不猜动作。
    // 这条尤其要紧——list 域的兜底若写成「不是 sessionList 就是 viewState」，
    // 将来新增的 `sessionDetail` 类下行会被当成「切到列表视图」，用户当场被踢出对话。
    if (type === 'sessionList') {
      return {
        ...EMPTY_ROUTE,
        list: {kind: 'sessionList', payload: coerceSessionListPayload(payload)},
      };
    }
    if (type === 'viewState') {
      return {...EMPTY_ROUTE, list: {kind: 'viewState', view: coerceView(payload)}};
    }
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

/** 单条会话行宽松取值：坏字段逐项回落，绝不因一行畸形打挂整张列表。 */
export function coerceSessionListItem(raw: unknown): SessionListItem {
  const item = (raw ?? {}) as Record<string, unknown>;
  const id = str(item.id, '');
  return {
    id,
    // title 缺省回落 id（现网 `item.title ?? item.id` 的同款口径）
    ...(typeof item.title === 'string' ? {title: item.title} : {}),
    updatedAtMs: num(item.updatedAtMs, 0),
    active: item.active === true,
    interrupted: item.interrupted === true,
    current: item.current === true,
  };
}

/**
 * `sessionList` 载荷宽松取值。
 *
 * `batchSelect` 保持**可选**语义：`undefined` = 不在批量态；给了（哪怕空数组）= 批量态。
 * 丢了这个区分，批量态下点行会走成「打开会话」而不是「勾选」——用户看到的是点一下
 * 直接跳进对话，且没有返回路径（返回键判定看的是 chatSubview，已被 open 改掉了）。
 */
export function coerceSessionListPayload(
  payload: ConversationHostMessage['payload'] | Record<string, unknown>,
): ConversationSessionListPayload {
  const raw = (payload ?? {}) as Record<string, unknown>;
  return {
    sessions: Array.isArray(raw.sessions)
      ? raw.sessions.map(coerceSessionListItem)
      : [],
    ...(Array.isArray(raw.batchSelect)
      ? {
          batchSelect: (raw.batchSelect as unknown[]).filter(
            (id): id is string => typeof id === 'string',
          ),
        }
      : {}),
  };
}

/**
 * `viewState` 宽松取值：**只认两个合法值**。
 *
 * 未知值回落 `conversation` 而不是 `list`：默认落列表意味着「宿主下发了一条 web 不认的
 * 消息」时，用户正写着的对话会被换成一张列表、正文连同草稿一起看不见。落 conversation
 * 最多是「这次切换没生效」，损害小一个量级。
 */
export function coerceView(
  payload: ConversationHostMessage['payload'] | Record<string, unknown>,
): ConversationView {
  const raw = (payload ?? {}) as Record<string, unknown>;
  return raw.view === 'list' ? 'list' : 'conversation';
}

/** dispatcher 依赖的最小面（两 runtime 的 `handleHostMessage` + dock / list handler）。 */
export type ConversationDispatcherDeps = {
  readonly handleTranscript: (raw: unknown) => void;
  readonly handleComposer: (raw: unknown) => void;
  readonly applyDockRoute: (route: ConversationDockRoute) => void;
  readonly applyDockTheme: (theme: ConversationTheme) => void;
  /** 列表域第四回调：`sessionList` 渲染行 / `viewState` 切 data-view。 */
  readonly applyListRoute: (route: ConversationListRoute) => void;
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
  if (route.list != null) {
    deps.applyListRoute(route.list);
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
