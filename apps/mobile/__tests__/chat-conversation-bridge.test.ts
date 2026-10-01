/**
 * chat-conversation 桥协议 v2 · RN 侧单源契约测试（chat-webview-unify Step 5/6）。
 *
 * 覆盖三块：
 * 1. **双端一致性**（T-CU3）：直接 import web 侧 `model.ts` 与 RN 侧
 *    `ChatConversationBridge.ts` 比对——这是「两份同形声明」唯一的正确性保障。
 * 2. **宽松 decoder**：`ready` 判 `v === 2`；其余 type **不校验 v**
 *    （transcript / composer 两域上行恒为 v:1，校验即丢消息）。
 * 3. **坏 JSON 宽容**：坏信封返回 `malformed`，宿主静默丢弃、绝不 throw 到渲染树。
 */
import {describe, expect, it} from '@jest/globals';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_DOCK_ACTIONS,
  CONVERSATION_LIST_ACTIONS,
  CONVERSATION_THEME_KEYS,
  conversationCapabilitiesInclude,
  conversationDockActionIncludes,
  conversationListActionIncludes,
  decodeConversationUpstream,
  encodeHostToConversation,
  parseConversationListAction,
  parseConversationScrollSnapshot,
  readReadyCapabilities,
  type ConversationHostMessage,
} from '@/components/chat/ChatConversationBridge';
// web 侧协议真源（同一份声明的另一半）
import {
  CONVERSATION_BRIDGE_V as WEB_CONVERSATION_BRIDGE_V,
  CONVERSATION_READY_VERSION as WEB_CONVERSATION_READY_VERSION,
  CONVERSATION_COMPOSER_METRICS as WEB_CONVERSATION_COMPOSER_METRICS,
  CONVERSATION_DOCK_ACTIONS as WEB_CONVERSATION_DOCK_ACTIONS,
  CONVERSATION_LIST_ACTIONS as WEB_CONVERSATION_LIST_ACTIONS,
  CONVERSATION_LIST_TYPES as WEB_CONVERSATION_LIST_TYPES,
  CONVERSATION_THEME_KEYS as WEB_CONVERSATION_THEME_KEYS,
  CONVERSATION_COMPOSER_TYPES as WEB_CONVERSATION_COMPOSER_TYPES,
  CONVERSATION_DOCK_TYPES as WEB_CONVERSATION_DOCK_TYPES,
  CONVERSATION_TRANSCRIPT_TYPES as WEB_CONVERSATION_TRANSCRIPT_TYPES,
  conversationCapabilities as webConversationCapabilities,
} from '@/web/chat-conversation/webview/model';
// 主题键集的唯一真源（web 侧 shared/host-theme；RN 与 web 两侧清单都从它派生）
import {HOST_THEME_KEYS} from '@/web/shared/host-theme';
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '@/services/chat-transcript-scroll-cache';

/**
 * RN 侧 `ConversationHostMessage` 的全量 type 名（运行时投影）。
 *
 * 键类型写成 `Record<ConversationHostMessage['type'], true>` 而不是裸对象字面量：
 * RN 联合类型增删一条 type 时这里是**编译错误**（缺键 / 多键都红），
 * 逼着同步本清单——否则「RN 加了下行 type 而 web 侧不跟随」就又变成无声漂移。
 * 类型擦除拿不到联合成员，所以这里必须落一份运行时名单；关键是让它被类型锁住。
 */
const RN_HOST_MESSAGE_TYPES: Record<ConversationHostMessage['type'], true> = {
  init: true,
  themeUpdate: true,
  sessionSnapshot: true,
  prependPage: true,
  appendTailRows: true,
  streamDelta: true,
  streamBatch: true,
  streamBlockCommit: true,
  streamReset: true,
  streamCommit: true,
  streamToolInvoking: true,
  flagsUpdate: true,
  closeMenu: true,
  closeMermaidViewer: true,
  setText: true,
  setSelection: true,
  setDisabled: true,
  blur: true,
  composerState: true,
  composerPaste: true,
  selectAll: true,
  // 列表域（第四域，第二阶段 wave-1）
  sessionList: true,
  viewState: true,
};

describe('chat-conversation 桥协议 v2 · 双端一致性', () => {
  it('T-CU3: CONVERSATION_BRIDGE_V 双端同为 2', () => {
    expect(CONVERSATION_BRIDGE_V).toBe(2);
    expect(WEB_CONVERSATION_BRIDGE_V).toBe(2);
    expect(CONVERSATION_BRIDGE_V).toBe(WEB_CONVERSATION_BRIDGE_V);
  });

  it('主题 9 键超集双端同序同集，且三处同源于 HOST_THEME_KEYS', () => {
    expect(CONVERSATION_THEME_KEYS).toHaveLength(9);
    expect(CONVERSATION_THEME_KEYS).toContain('selection');
    expect([...CONVERSATION_THEME_KEYS]).toEqual([...WEB_CONVERSATION_THEME_KEYS]);
    // 排序对照（顺序之外的集合相等，防止两侧把同九个键排成两种顺序）
    expect([...CONVERSATION_THEME_KEYS].sort()).toEqual(
      [...WEB_CONVERSATION_THEME_KEYS].sort(),
    );
    expect([...CONVERSATION_THEME_KEYS].sort()).toEqual(
      [...HOST_THEME_KEYS].sort(),
    );
    // 三份键集不是各抄一份，而是同一个数组的三次引用——宿主改 THEME_VARS 一处即全跟随
    expect(CONVERSATION_THEME_KEYS).toBe(HOST_THEME_KEYS);
    expect(WEB_CONVERSATION_THEME_KEYS).toBe(HOST_THEME_KEYS);
  });

  it('下行 type 全集：RN ConversationHostMessage 与 web 四清单扁平化相等', () => {
    const webDownstreamTypes = [
      'init',
      'themeUpdate',
      ...WEB_CONVERSATION_TRANSCRIPT_TYPES,
      ...WEB_CONVERSATION_COMPOSER_TYPES,
      ...WEB_CONVERSATION_DOCK_TYPES,
      ...WEB_CONVERSATION_LIST_TYPES,
    ];
    const rnDownstreamTypes = Object.keys(RN_HOST_MESSAGE_TYPES);
    // web 侧四清单内部不得有重复项（否则扁平化会引入伪计数）
    expect(new Set(webDownstreamTypes).size).toBe(webDownstreamTypes.length);
    // 双向相等：任一侧多一条/少一条都红（RN 侧的增删另由上面的 Record 类型锁住）
    expect([...webDownstreamTypes].sort()).toEqual([...rnDownstreamTypes].sort());
    // stickIfNearBottom 已在 web 清单移除（BASE 起无生产方），双端都不该再有
    expect(webDownstreamTypes).not.toContain('stickIfNearBottom');
    expect(rnDownstreamTypes).not.toContain('stickIfNearBottom');
  });

  it('metrics 六值双端一致（漏 minHeight/fontSize 都违反 UI 一致）', () => {
    expect(WEB_CONVERSATION_COMPOSER_METRICS).toEqual({
      fontSize: 16,
      lineHeight: 22,
      paddingH: 4,
      paddingV: 6,
      minHeight: 56,
      maxHeight: 122,
    });
  });

  it('dockAction 六项双端一致', () => {
    expect([...CONVERSATION_DOCK_ACTIONS]).toEqual([
      ...WEB_CONVERSATION_DOCK_ACTIONS,
    ]);
    expect(CONVERSATION_DOCK_ACTIONS).toHaveLength(6);
  });

  it('能力协商：composer-dock 在 web capabilities 内，RN 侧可判定', () => {
    const caps = webConversationCapabilities();
    expect(caps).toContain('composer-dock');
    expect(conversationCapabilitiesInclude(caps, 'composer-dock')).toBe(true);
    // 「未声明 = 不支持」：空清单一律 false
    expect(conversationCapabilitiesInclude([], 'composer-dock')).toBe(false);
    expect(conversationCapabilitiesInclude(undefined, 'composer-dock')).toBe(
      false,
    );
  });

  it('dockAction 判定：枚举外一律拒（含类型混淆）', () => {
    expect(conversationDockActionIncludes('send')).toBe(true);
    expect(conversationDockActionIncludes('skillPicker')).toBe(true);
    expect(conversationDockActionIncludes('rollback')).toBe(false);
    expect(conversationDockActionIncludes(42)).toBe(false);
    expect(conversationDockActionIncludes(null)).toBe(false);
  });

  it('listAction 十一项双端一致（第二阶段 wave-1 · 第四域；wave-3 加批量头两项）', () => {
    expect([...CONVERSATION_LIST_ACTIONS]).toEqual([
      ...WEB_CONVERSATION_LIST_ACTIONS,
    ]);
    expect(CONVERSATION_LIST_ACTIONS).toHaveLength(11);
    // 判定函数与 dockAction 同款口径：枚举外一律拒
    expect(conversationListActionIncludes('open')).toBe(true);
    expect(conversationListActionIncludes('batchToggle')).toBe(true);
    expect(conversationListActionIncludes('stopRun')).toBe(true);
    // 批量头两项（wave-3）：双端都在白名单里
    expect(conversationListActionIncludes('batchDelete')).toBe(true);
    expect(conversationListActionIncludes('batchExit')).toBe(true);
    expect(conversationListActionIncludes('menu')).toBe(false);
    expect(conversationListActionIncludes(7)).toBe(false);
  });
});

describe('上行 listAction 解码（v:2 · 第二阶段 wave-1）', () => {
  /** 走完整的「web 发 → 宽松 decoder → 收窄」往返，断言两头都认。 */
  function roundTrip(payload: Record<string, unknown>) {
    const decoded = decodeConversationUpstream(
      JSON.stringify({v: 2, type: 'listAction', payload}),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('listAction 应被宽松 decoder 收下');
    }
    return parseConversationListAction(decoded.message);
  }

  it('带 sessionId 的行级动作原样往返（open / menuOpen / longPress / batchToggle）', () => {
    for (const kind of ['open', 'menuOpen', 'longPress', 'batchToggle'] as const) {
      expect(roundTrip({kind, sessionId: 's1'})).toEqual({kind, sessionId: 's1'});
    }
  });

  it('create 不带 sessionId（没有行可指）——缺省即正确形状', () => {
    expect(roundTrip({kind: 'create'})).toEqual({kind: 'create'});
    // 空串视同缺省：空 sessionId 传进 openConversation 只会让状态机查不到会话
    expect(roundTrip({kind: 'create', sessionId: ''})).toEqual({kind: 'create'});
    expect(roundTrip({kind: 'open', sessionId: 42})).toEqual({kind: 'open'});
  });

  it('batchDelete / batchExit 同 create：作用于整个勾选集合，不带 sessionId', () => {
    // wave-3：批量头的两钮只报「点了删除 / 点了取消」，勾选集合由宿主自己读——
    // web 侧传上来的 sessionId 若是脏值，宿主也应当整个忽略（判据是批量态真源）。
    for (const kind of ['batchDelete', 'batchExit'] as const) {
      expect(roundTrip({kind})).toEqual({kind});
      expect(roundTrip({kind, sessionId: ''})).toEqual({kind});
    }
  });

  it('批量头两项即便带了 sessionId 也原样收（解码器不做语义裁剪）', () => {
    // 解码层只做「非空字符串就带上」；真正的忽略发生在宿主分发
    // （useSessionListBridge 里 batchDelete/batchExit 分支先于取 targetId）。
    expect(roundTrip({kind: 'batchDelete', sessionId: 's1'})).toEqual({
      kind: 'batchDelete',
      sessionId: 's1',
    });
  });

  it('kind 不在白名单内一律 null（行为闸门，不许掉进既有分支）', () => {
    for (const bad of [
      {kind: 'menu'},
      {kind: ''},
      {kind: 42},
      {kind: null},
      {},
    ]) {
      expect(roundTrip(bad as Record<string, unknown>)).toBeNull();
    }
  });

  it('非 listAction 的上行不误判（parse 只认自己的 type）', () => {
    const decoded = decodeConversationUpstream(
      JSON.stringify({v: 2, type: 'dockAction', payload: {action: 'send'}}),
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(parseConversationListAction(decoded.message)).toBeNull();
    }
  });

  it('v:1 的 listAction 同样收（宽松口径不校验 v，与两 runtime 上行同款）', () => {
    // web 侧 listAction 走 createBoundPost(2) 恒为 v:2，但解码器不因 v 拒收：
    // 与 dockAction 同一口径——校验 v 等于给「上行 v 号写错」关一扇静默门。
    const decoded = decodeConversationUpstream(
      JSON.stringify({v: 1, type: 'listAction', payload: {kind: 'open', sessionId: 's1'}}),
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(parseConversationListAction(decoded.message)).toEqual({
        kind: 'open',
        sessionId: 's1',
      });
    }
  });
});

describe('下行列表域载荷（宿主接线前的协议形状 · wave-2 接口）', () => {
  it('sessionList / viewState 两信封可编码，载荷形状被类型锁住', () => {
    // 这里只钉**协议形状**（wave-2 宿主接线按这个形状发），不断言任何宿主行为。
    const sessionList: ConversationHostMessage = {
      v: 2,
      type: 'sessionList',
      payload: {
        sessions: [
          {
            id: 's1',
            title: '写代码',
            updatedAtMs: 1_700_000_000_000,
            active: false,
            interrupted: false,
            current: true,
          },
        ],
        batchSelect: ['s1'],
      },
    };
    const viewState: ConversationHostMessage = {
      v: 2,
      type: 'viewState',
      payload: {view: 'list'},
    };
    expect(encodeHostToConversation(sessionList)).toContain('"sessionList"');
    expect(encodeHostToConversation(viewState)).toContain('"viewState"');
    // batchSelect 可选：不在批量态时字段整个缺省
    const plain: ConversationHostMessage = {
      v: 2,
      type: 'sessionList',
      payload: {sessions: []},
    };
    expect(encodeHostToConversation(plain)).not.toContain('batchSelect');
  });
});

describe('chat-conversation 宽松 decoder', () => {
  it('ready 只认 v === 2', () => {
    const ok = decodeConversationUpstream(
      JSON.stringify({
        v: 2,
        type: 'ready',
        payload: {version: WEB_CONVERSATION_READY_VERSION, capabilities: []},
      }),
    );
    expect(ok.ok).toBe(true);

    // 旧 dist 的 v:1 ready 被拒（不得置位 webReady → 走 8s 超时兜底）
    const stale = decodeConversationUpstream(
      JSON.stringify({v: 1, type: 'ready', payload: {version: 'm4'}}),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe('stale-ready');
    }
  });

  it('ready 缺 v（undefined）同样按 stale 拒——不得「无 v 也放行」', () => {
    const res = decodeConversationUpstream(
      JSON.stringify({type: 'ready', payload: {}}),
    );
    expect(res.ok).toBe(false);
  });

  it('其余 type **不校验 v**：transcript / composer 域上行恒为 v:1 也要收', () => {
    // 两旧 runtime 的 post 是模块级单例、BRIDGE_V=1 硬编码，上行必然是 v:1
    for (const type of [
      'scrollSnapshot',
      'loadOlder',
      'visibility',
      'menuOpened',
      'openMessageMenu',
      'copyCode',
      'change',
      'selectionChange',
      'focus',
      'blur',
    ]) {
      const res = decodeConversationUpstream(
        JSON.stringify({v: 1, type, payload: {}}),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.message.type).toBe(type);
      }
    }
    // 缺 v 的普通上行同样收
    const noV = decodeConversationUpstream(
      JSON.stringify({type: 'visibility', payload: {hidden: false}}),
    );
    expect(noV.ok).toBe(true);
  });

  it('dockAction（v:2）收下并保留 payload.action 供枚举判定', () => {
    const res = decodeConversationUpstream(
      JSON.stringify({v: 2, type: 'dockAction', payload: {action: 'send'}}),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message.payload.action).toBe('send');
      expect(conversationDockActionIncludes(res.message.payload.action)).toBe(
        true,
      );
    }
  });

  it('坏 JSON / 非对象 / 无 type 一律 malformed（宽容丢弃，绝不 throw）', () => {
    for (const raw of [
      '{not json',
      '',
      'null',
      '[1,2,3]',
      '"just-a-string"',
      JSON.stringify({v: 2, payload: {}}),
      JSON.stringify({v: 2, type: 42, payload: {}}),
      JSON.stringify({v: 2, type: '', payload: {}}),
    ]) {
      const res = decodeConversationUpstream(raw);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe('malformed');
      }
    }
  });

  it('payload 缺省 / 非对象按空对象处理（不因载荷畸形丢整条消息）', () => {
    const res = decodeConversationUpstream(
      JSON.stringify({v: 1, type: 'visibility'}),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message.payload).toEqual({});
    }
  });

  it('已解析对象（非字符串）入参同样可解（测试与 RN 内部调用皆覆盖）', () => {
    const res = decodeConversationUpstream({
      v: 2,
      type: 'ready',
      payload: {capabilities: ['composer-dock']},
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(readReadyCapabilities(res.message.payload)).toEqual([
        'composer-dock',
      ]);
    }
  });

  it('capabilities 缺省 / 非数组 → 空清单（「未声明 = 不支持」）', () => {
    expect(readReadyCapabilities({})).toEqual([]);
    expect(readReadyCapabilities({capabilities: 'nope'})).toEqual([]);
  });
});

describe('scrollSnapshot 解析（口径照旧宿主）', () => {
  it('schema 版本不符 → null；缺字段 → null；正常 → 快照', () => {
    expect(
      parseConversationScrollSnapshot(
        {
          v: 1,
          type: 'scrollSnapshot',
          payload: {
            schemaVersion: 999,
            offsetY: 10,
            nearBottom: true,
          },
        },
        CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      ),
    ).toBeNull();

    expect(
      parseConversationScrollSnapshot(
        {
          v: 1,
          type: 'scrollSnapshot',
          payload: {
            schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
            offsetY: 'x',
            nearBottom: true,
          },
        },
        CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      ),
    ).toBeNull();

    expect(
      parseConversationScrollSnapshot(
        {
          v: 1,
          type: 'loadOlder',
          payload: {},
        },
        CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      ),
    ).toBeNull();

    expect(
      parseConversationScrollSnapshot(
        {
          v: 1,
          type: 'scrollSnapshot',
          payload: {
            schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
            offsetY: 42,
            nearBottom: true,
          },
        },
        CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      ),
    ).toEqual({
      schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      offsetY: 42,
      nearBottom: true,
    });
  });
});
