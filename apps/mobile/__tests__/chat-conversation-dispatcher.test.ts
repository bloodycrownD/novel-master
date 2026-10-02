/**
 * chat-conversation 合成 dispatcher 单测（T-CDV 系列 · 纯函数层）。
 *
 * 断言面 = §下行消息路由表：聚合 init 拆包、`themeUpdate` fan-out 三方、
 * transcript / composer / dock 三域各自命中且**不串**（一条消息只投该投的域），
 * 以及坏输入静默丢弃的宽容口径。
 *
 * 环境：RN jest preset（node，无 jsdom，本仓既有约定），故全部走纯函数——
 * `routeHostMessage` 不碰 DOM、不 post，副作用投递由 `dispatchRoute` 单独断言。
 */
import {
  coerceComposerState,
  coerceSessionListPayload,
  coerceTypeaheadSource,
  coerceView,
  createConversationDispatcher,
  dispatchRoute,
  routeHostMessage,
  splitInitPayload,
  type ConversationDockRoute,
  type ConversationDispatcherDeps,
  type ConversationListRoute,
} from '@web/chat-conversation/webview/dispatcher';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_CAPABILITY_COMPOSER_DOCK,
  CONVERSATION_DOCK_ACTIONS,
  CONVERSATION_DOCK_TYPES,
  CONVERSATION_LIST_ACTIONS,
  CONVERSATION_LIST_TYPES,
  CONVERSATION_READY_VERSION,
  CONVERSATION_THEME_KEYS,
  conversationCapabilities,
} from '@web/chat-conversation/webview/model';
// 两个旧 runtime 各自的 BRIDGE_V——dispatcher 重打包用的 v 号直接取自这两处，
// 不再写死 1（见 dispatcher.ts 顶部的一致性守卫）。
import {BRIDGE_V as TRANSCRIPT_BRIDGE_V} from '@web/chat-transcript/webview/runtime/state/state';
import {BRIDGE_V as COMPOSER_BRIDGE_V} from '@web/composer-input/webview/runtime/model';

/** 9 键超集：transcript 7 ∪ composer 6 去重（selection 是合成包补进 HostTheme 的那一键）。 */
const THEME = {
  background: '#fff',
  text: '#111',
  textSecondary: '#8e8e93',
  primary: '#007aff',
  primaryMuted: 'rgba(0,122,255,0.13)',
  selection: 'rgba(0,122,255,0.25)',
  danger: '#d93025',
  surface: '#f7f7f9',
  borderLight: '#e5e5ea',
};

const METRICS = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 122,
};

const v2 = (type: string, payload: Record<string, unknown> = {}) => ({
  v: CONVERSATION_BRIDGE_V,
  type,
  payload,
});

/** 四域全空的路由（空路由的唯一写法——新增域时这里同步长一条）。 */
const EMPTY = {
  transcript: null,
  composer: null,
  dock: null,
  list: null,
  theme: null,
};

describe('协议常量（T-CU3：双端一致的前提）', () => {
  it('T-CDV-01：CONVERSATION_BRIDGE_V = 2，与旧包 BRIDGE_V 刻意不同名', () => {
    expect(CONVERSATION_BRIDGE_V).toBe(2);
  });

  it('T-CDV-01b：重打包用的 v 号恒等于两包各自的 BRIDGE_V（三处恒等）', () => {
    // dispatcher 的 v1() 取 transcript 包的 BRIDGE_V，composer 包的 BRIDGE_V
    // 由模块级一致性守卫保证相等——三处必须指向同一个值，不能各写各的。
    expect(TRANSCRIPT_BRIDGE_V).toBe(1);
    expect(COMPOSER_BRIDGE_V).toBe(1);
    expect(TRANSCRIPT_BRIDGE_V).toBe(COMPOSER_BRIDGE_V);
    // 实际重打包产物上的 v 就是这个常量（而非独立的字面量 1）
    const route = routeHostMessage(v2('setDisabled', {disabled: true}));
    expect(route?.composer?.v).toBe(TRANSCRIPT_BRIDGE_V);
    expect(route?.composer?.v).toBe(COMPOSER_BRIDGE_V);
    // 合成包自身仍是 v:2，与旧包 v:1 区分开
    expect(CONVERSATION_BRIDGE_V).not.toBe(TRANSCRIPT_BRIDGE_V);
  });

  it('T-CDV-02：ready 版本标识 u1；theme 超集 9 键且含 selection', () => {
    expect(CONVERSATION_READY_VERSION).toBe('u1');
    expect(CONVERSATION_THEME_KEYS).toHaveLength(9);
    expect(CONVERSATION_THEME_KEYS).toContain('selection');
  });

  it('T-CDV-03：capabilities 含 composer-dock，且该位不进共享常量数组', () => {
    const caps = conversationCapabilities();
    expect(caps).toContain('streamBlockCommit');
    expect(caps).toContain(CONVERSATION_CAPABILITY_COMPOSER_DOCK);
    // 共享常量数组本身不得被污染（旧 chat-transcript 包的 ready 靠它保持「未声明即降级」）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shared = require('@web/chat-transcript/transcript-capabilities');
    expect(shared.TRANSCRIPT_CAPABILITIES).not.toContain(
      CONVERSATION_CAPABILITY_COMPOSER_DOCK,
    );
  });

  it('T-CDV-04：dockAction 枚举六项齐备', () => {
    expect(CONVERSATION_DOCK_ACTIONS).toEqual([
      'send',
      'terminate',
      'needModel',
      'fullscreen',
      'atPicker',
      'skillPicker',
    ]);
  });
});

describe('聚合 init 拆包（T-CU2 / 契约第 5 条）', () => {
  it('T-CDV-05：拆成 transcript {theme,flags} + composer {mode,disabled,theme,metrics,placeholder}', () => {
    const split = splitInitPayload({
      theme: THEME,
      flags: {richText: true, menuDisabled: false},
      composer: {
        mode: 'composer-token',
        disabled: true,
        metrics: METRICS,
        placeholder: '选择模型后可发送',
        safeAreaBottom: 34,
      },
    });
    expect(Object.keys(split.transcript).sort()).toEqual(['flags', 'theme']);
    expect(split.composer.mode).toBe('composer-token');
    expect(split.composer.disabled).toBe(true);
    // theme 用同一份 9 键超集喂两方；metrics 六值全量透传
    expect(split.composer.theme).toBe(THEME);
    expect(split.composer.metrics).toEqual(METRICS);
    expect(split.composer.placeholder).toBe('选择模型后可发送');
    // safeAreaBottom 不下喂 runtime，由 dock 消费
    expect(split.safeAreaBottom).toBe(34);
    expect(Object.keys(split.composer)).not.toContain('safeAreaBottom');
  });

  it('T-CDV-06：init 一次投三方（transcript + composer + dock 的 safeAreaBottom）', () => {
    const route = routeHostMessage(
      v2('init', {
        theme: THEME,
        flags: {richText: false, menuDisabled: true},
        composer: {disabled: false, metrics: METRICS, placeholder: '输入消息…', safeAreaBottom: 0},
      }),
    );
    expect(route?.transcript).toEqual({
      v: 1,
      type: 'init',
      payload: {theme: THEME, flags: {richText: false, menuDisabled: true}},
    });
    expect(route?.composer?.v).toBe(1);
    expect(route?.composer?.type).toBe('init');
    // transcriptOnly 必填（transcript-converge）：缺省 false，即主链形态。
    expect(route?.dock).toEqual({kind: 'init', safeAreaBottom: 0, transcriptOnly: false});
    // 主题不重复投 dock（init 的 theme 由两份 runtime 各自消费；dock 只吃 safeAreaBottom）
    expect(route?.theme).toBeNull();
  });

  it('transcriptOnly：payload 带 true → dock 路由透传 true（子会话屏隐藏 dock）', () => {
    const route = routeHostMessage(
      v2('init', {
        theme: THEME,
        flags: {richText: false, menuDisabled: true},
        transcriptOnly: true,
        composer: {disabled: false, metrics: METRICS, placeholder: '', safeAreaBottom: 12},
      }),
    );
    expect(route?.dock).toEqual({kind: 'init', safeAreaBottom: 12, transcriptOnly: true});
    // transcriptOnly 只归 dock 消费：两份 runtime 的 init 载荷不被污染
    expect(route?.transcript).toEqual({
      v: 1,
      type: 'init',
      payload: {theme: THEME, flags: {richText: false, menuDisabled: true}},
    });
    expect(Object.keys(route?.composer?.payload ?? {})).not.toContain('transcriptOnly');
  });
});

describe('themeUpdate fan-out 三方（契约第 2 条）', () => {
  it('T-CDV-07：9 键超集同时喂 transcript + composer + dock', () => {
    const route = routeHostMessage(v2('themeUpdate', {theme: THEME}));
    expect(route?.transcript).toEqual({
      v: 1,
      type: 'themeUpdate',
      payload: {theme: THEME},
    });
    expect(route?.composer).toEqual(route?.transcript);
    expect(route?.theme).toBe(THEME);
    expect(route?.dock).toBeNull();
    // 键集完整性：themeUpdate 一次带齐 9 键
    expect(Object.keys(route?.transcript?.payload?.theme ?? {})).toHaveLength(9);
  });

  it('T-CDV-08：theme 缺 payload 时三方全空（不误投）', () => {
    const route = routeHostMessage(v2('themeUpdate', {}));
    expect(route?.transcript).toBeNull();
    expect(route?.composer).toBeNull();
    expect(route?.theme).toBeNull();
  });
});

describe('三域路由各自命中且不串', () => {
  it('T-CDV-09：transcript 域全部 type 重打包为 v1 且只投 transcript', () => {
    // 清单 = CONVERSATION_TRANSCRIPT_TYPES 的字面量展开（不含 stickIfNearBottom：
    // BASE 起无生产方，已从 web 侧清单移除，见 model.ts 注释）
    for (const type of [
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
    ]) {
      const route = routeHostMessage(v2(type, {marker: type}));
      expect(route?.transcript).toEqual({v: 1, type, payload: {marker: type}});
      expect(route?.composer).toBeNull();
      expect(route?.dock).toBeNull();
      expect(route?.theme).toBeNull();
    }
  });

  it('T-CDV-10：composer 域四项只投 composer（setText 属 composer 域，不进 deferred）', () => {
    for (const type of ['setText', 'setSelection', 'setDisabled', 'blur']) {
      const route = routeHostMessage(v2(type, {marker: type}));
      expect(route?.composer).toEqual({v: 1, type, payload: {marker: type}});
      expect(route?.transcript).toBeNull();
      expect(route?.dock).toBeNull();
    }
  });

  it('T-CDV-11：dock 域三项只投 dock，runtime 两域零命中', () => {
    const state = routeHostMessage(v2('composerState', {hasModel: false}));
    expect(state?.transcript).toBeNull();
    expect(state?.composer).toBeNull();
    expect(state?.dock?.kind).toBe('composerState');

    const paste = routeHostMessage(v2('composerPaste', {text: '粘来的'}));
    expect(paste?.transcript).toBeNull();
    expect(paste?.composer).toBeNull();
    expect(paste?.dock).toEqual({kind: 'composerPaste', text: '粘来的'});

    const selectAll = routeHostMessage(v2('selectAll', {}));
    expect(selectAll?.transcript).toBeNull();
    expect(selectAll?.composer).toBeNull();
    expect(selectAll?.dock).toEqual({kind: 'selectAll'});
  });

  it('T-CDV-11b：dock 域不再有兜底 selectAll 的默认分支', () => {
    // 旧写法是「落在 CONVERSATION_DOCK_TYPES 里但没写分支 → 兜底 selectAll」，
    // 那是**带副作用**的默认分支：新加一条 type 忘了写 handler，宿主发来的新意图
    // 会被执行成「全选输入框」。这里钉死：两类未知都必须空路由。

    // ① 清单外的 type：本来就走末尾的 EMPTY_ROUTE，兜底分支够不着它——
    //    但仍钉一遍，防止有人把 `contains` 那层判断删掉后重新裸奔。
    expect(routeHostMessage(v2('__futureDockType', {text: 'x'}))).toEqual(
      EMPTY,
    );

    // ② **清单内但无 handler**——这才是旧兜底分支真正会吃掉的路径。
    //    往清单里临时塞一条合成 type（不进生产代码），跑完立刻摘掉。
    (CONVERSATION_DOCK_TYPES as string[]).push('__registeredButUnhandled');
    try {
      expect(routeHostMessage(v2('__registeredButUnhandled', {}))).toEqual(
        EMPTY,
      );
    } finally {
      (CONVERSATION_DOCK_TYPES as string[]).pop();
    }
    // 摘干净：清单长度复原
    expect(CONVERSATION_DOCK_TYPES).not.toContain('__registeredButUnhandled');
  });

  it('T-CDV-11c：stickIfNearBottom 不再路由（死协议面已从清单移除）', () => {
    // 该 type 只被旧 chat-transcript 包认（其 bridge case 不动）；合成包侧
    // BASE 起无生产方，走到这里必须是空路由，不得回落到 selectAll。
    const route = routeHostMessage(v2('stickIfNearBottom', {}));
    expect(route).toEqual(EMPTY);
  });
});

/* ------------------------------------------------------------------ *
 * 列表域（第四域 · 第二阶段 wave-1）
 * ------------------------------------------------------------------ */

describe('列表域路由（T-CSL-D）', () => {
  it('T-CSL-D-01：清单两条 = sessionList / viewState，且与前三表零交集', () => {
    expect([...CONVERSATION_LIST_TYPES]).toEqual(['sessionList', 'viewState']);
    for (const type of [
      ...CONVERSATION_DOCK_TYPES,
      'sessionSnapshot',
      'setText',
      'init',
      'themeUpdate',
    ]) {
      expect(CONVERSATION_LIST_TYPES).not.toContain(type);
    }
  });

  it('T-CSL-D-02：sessionList 只投 list 域，三条老域全部为 null', () => {
    const sessions = [
      {
        id: 's1',
        title: '写代码',
        updatedAtMs: 5,
        active: true,
        interrupted: false,
        current: true,
      },
    ];
    const route = routeHostMessage(v2('sessionList', {sessions}));
    expect(route?.list).toEqual({kind: 'sessionList', payload: {sessions}});
    expect(route?.transcript).toBeNull();
    expect(route?.composer).toBeNull();
    expect(route?.dock).toBeNull();
    expect(route?.theme).toBeNull();
  });

  it('T-CSL-D-03：viewState 只投 list 域（带 view 值）', () => {
    const route = routeHostMessage(v2('viewState', {view: 'list'}));
    expect(route?.list).toEqual({kind: 'viewState', view: 'list'});
    expect(route?.transcript).toBeNull();
    expect(route?.composer).toBeNull();
    expect(route?.dock).toBeNull();
  });

  it('T-CSL-D-04：前三域新下行走原路径，list 域零命中（加域不许串域）', () => {
    expect(routeHostMessage(v2('composerState', {hasModel: false}))?.list).toBeNull();
    expect(routeHostMessage(v2('setText', {text: 'x'}))?.list).toBeNull();
    expect(routeHostMessage(v2('sessionSnapshot', {generation: 1}))?.list).toBeNull();
    expect(routeHostMessage(v2('init', {}))?.list).toBeNull();
    expect(routeHostMessage(v2('themeUpdate', {theme: THEME}))?.list).toBeNull();
  });

  it('T-CSL-D-05：清单内但无 handler → 空路由，**不得**回落成 viewState', () => {
    // 这是 list 域的红线：若写成「不是 sessionList 就是 viewState」的兜底，
    // 将来新增的 `sessionDetail` 类下行会被当成「切到列表视图」——
    // 用户正写着的对话当场被换成一张列表，正文与草稿一起看不见。
    (CONVERSATION_LIST_TYPES as string[]).push('__listRegisteredButUnhandled');
    try {
      expect(routeHostMessage(v2('__listRegisteredButUnhandled', {}))).toEqual(
        EMPTY,
      );
      // 兜底若复活，这条必然红：它会被解析成 viewState（缺 view → conversation）
      expect(
        routeHostMessage(v2('__listRegisteredButUnhandled', {}))?.list,
      ).toBeNull();
    } finally {
      (CONVERSATION_LIST_TYPES as string[]).pop();
    }
    expect(CONVERSATION_LIST_TYPES).not.toContain('__listRegisteredButUnhandled');
  });

  it('T-CSL-D-06：listAction 枚举十一项齐备（上行白名单口径）', () => {
    expect([...CONVERSATION_LIST_ACTIONS]).toEqual([
      'open',
      'create',
      'menuOpen',
      'rename',
      'copy',
      'delete',
      'stopRun',
      'longPress',
      'batchToggle',
      // wave-3：批量头两项（作用于整个勾选集合，不带 sessionId）
      'batchDelete',
      'batchExit',
    ]);
  });

  it('T-CSL-D-07：coerceView 只认两个合法值，未知回落 conversation', () => {
    expect(coerceView({view: 'list'})).toBe('list');
    expect(coerceView({view: 'conversation'})).toBe('conversation');
    // 未知值不得落 list：落 list 等于把「宿主发了条 web 不认的消息」升级成
    // 「用户正在写的对话连同草稿一起消失」，比不切换坏一个量级
    for (const bad of [{}, {view: 'LIST'}, {view: 1}, {view: null}]) {
      expect(coerceView(bad as Record<string, unknown>)).toBe('conversation');
    }
  });

  it('T-CSL-D-08：coerceSessionListPayload 宽松取值 + batchSelect 可选语义', () => {
    // 缺 sessions → 空列表，不抛
    expect(coerceSessionListPayload({})).toEqual({sessions: []});
    expect(coerceSessionListPayload({sessions: 'oops'})).toEqual({sessions: []});

    // batchSelect 缺省 = 不在批量态（字段整个不出现在返回值里）
    const plain = coerceSessionListPayload({
      sessions: [{id: 's1', updatedAtMs: 3}],
    });
    expect('batchSelect' in plain).toBe(false);
    // 给了空数组 = 在批量态、暂未勾选（两者不可混同）
    expect(coerceSessionListPayload({sessions: [], batchSelect: []})).toEqual({
      sessions: [],
      batchSelect: [],
    });
    // 非字符串 id 被过滤
    expect(
      coerceSessionListPayload({sessions: [], batchSelect: ['s1', 7, null]}),
    ).toEqual({sessions: [], batchSelect: ['s1']});

    // 行字段逐项兜底：title 缺省不出键、布尔一律判 === true
    expect(
      coerceSessionListPayload({
        sessions: [{id: 's1', title: '', active: 'yes', updatedAtMs: 'x'}],
      }).sessions[0],
    ).toEqual({
      id: 's1',
      title: '',
      updatedAtMs: 0,
      active: false,
      interrupted: false,
      current: false,
    });
  });
});

describe('宽容口径（坏输入静默丢弃）', () => {
  it('T-CDV-12：v≠2 / 无 type / 坏 JSON 一律不路由', () => {
    expect(routeHostMessage({v: 1, type: 'init', payload: {}})).toBeNull();
    expect(routeHostMessage({v: 2, payload: {}})).toBeNull();
    expect(routeHostMessage('{不是 json')).toBeNull();
    expect(routeHostMessage(null)).toBeNull();
  });

  it('T-CDV-13：未知 type 路由为空（不串进任何域）', () => {
    const route = routeHostMessage(v2('someLegacyMessage', {a: 1}));
    expect(route).toEqual(EMPTY);
  });
});

describe('composerState 宽松取值（T-CU6：坏字段不打挂 dock）', () => {
  it('T-CDV-14：缺字段逐项回落默认值，error 为空串时不出现', () => {
    const state = coerceComposerState({});
    expect(state).toEqual({
      inputDisabled: false,
      hasModel: false,
      sendDisabled: false,
      running: false,
      fullscreenEnabled: false,
      placeholder: '',
      chips: [],
      keyboardUp: false,
      typeahead: {files: [], skills: []},
    });
    expect(state.error).toBeUndefined();
  });

  it('T-CDV-15：全字段透传（含 error / chips / keyboardUp / typeahead 候选源）', () => {
    const chips = [{source: 'workplace', name: 'src', path: 'src', type: 'text', content: null}];
    const state = coerceComposerState({
      inputDisabled: true,
      hasModel: true,
      sendDisabled: true,
      running: true,
      error: '上一轮失败',
      fullscreenEnabled: true,
      placeholder: '输入消息…',
      chips,
      keyboardUp: true,
      typeahead: {
        files: [{path: 'src/a.ts', kind: 'file'}],
        skills: [{name: 'refactor', valid: true, domain: 'project'}],
      },
    });
    expect(state.error).toBe('上一轮失败');
    expect(state.chips).toBe(chips);
    expect(state.keyboardUp).toBe(true);
    expect(state.typeahead?.files).toHaveLength(1);
    expect(state.typeahead?.skills).toHaveLength(1);
  });

  it('T-CDV-16：typeahead 坏形状回落空源', () => {
    expect(coerceTypeaheadSource(undefined)).toEqual({files: [], skills: []});
    expect(coerceTypeaheadSource({files: 'oops', skills: 3})).toEqual({
      files: [],
      skills: [],
    });
  });
});

describe('副作用投递（dispatchRoute / createConversationDispatcher）', () => {
  function makeDeps() {
    const calls: string[] = [];
    const deps: ConversationDispatcherDeps & {
      transcript: unknown[];
      composer: unknown[];
      dockRoutes: ConversationDockRoute[];
      listRoutes: ConversationListRoute[];
      themes: unknown[];
    } = {
      calls,
      transcript: [],
      composer: [],
      dockRoutes: [],
      listRoutes: [],
      themes: [],
      handleTranscript: raw => {
        calls.push('transcript');
        deps.transcript.push(raw);
      },
      handleComposer: raw => {
        calls.push('composer');
        deps.composer.push(raw);
      },
      applyDockRoute: route => {
        calls.push('dock');
        deps.dockRoutes.push(route);
      },
      applyDockTheme: theme => {
        calls.push('theme');
        deps.themes.push(theme);
      },
      applyListRoute: route => {
        calls.push('list');
        deps.listRoutes.push(route);
      },
    };
    return deps;
  }

  it('T-CDV-17：null 路由零副作用', () => {
    const deps = makeDeps();
    dispatchRoute(deps, null);
    expect(deps.calls).toEqual([]);
  });

  it('T-CDV-18：themeUpdate 的 fan-out 落到三方各一次', () => {
    const deps = makeDeps();
    dispatchRoute(deps, routeHostMessage(v2('themeUpdate', {theme: THEME})));
    expect(deps.calls.sort()).toEqual(['composer', 'theme', 'transcript']);
    expect(deps.themes).toEqual([THEME]);
  });

  it('T-CDV-19：入口闭包可消费宿主消息，且只投该投的域', () => {
    const deps = makeDeps();
    const dispatcher = createConversationDispatcher(deps);
    dispatcher(JSON.stringify(v2('setDisabled', {disabled: true})));
    expect(deps.calls).toEqual(['composer']);
    expect(deps.composer[0]).toEqual({
      v: 1,
      type: 'setDisabled',
      payload: {disabled: true},
    });
  });

  it('T-CDV-20：列表域只投 applyListRoute 一条，零惊动前三域', () => {
    const deps = makeDeps();
    const dispatcher = createConversationDispatcher(deps);
    dispatcher(JSON.stringify(v2('sessionList', {sessions: []})));
    expect(deps.calls).toEqual(['list']);
    expect(deps.listRoutes).toEqual([
      {kind: 'sessionList', payload: {sessions: []}},
    ]);

    dispatcher(JSON.stringify(v2('viewState', {view: 'list'})));
    expect(deps.calls).toEqual(['list', 'list']);
    expect(deps.listRoutes[1]).toEqual({kind: 'viewState', view: 'list'});
    // 前三域与主题全程零命中：切列表视图不该惊动转录 / 输入框 / 主题
    expect(deps.transcript).toEqual([]);
    expect(deps.composer).toEqual([]);
    expect(deps.dockRoutes).toEqual([]);
    expect(deps.themes).toEqual([]);
  });
});
