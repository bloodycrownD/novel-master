/**
 * chat-conversation 桥协议 v2 · RN 侧单源契约测试（chat-webview-unify Step 5/6；
 * composer-native-2026-10 Step 2 按 D4c 改写到剥离后 API）。
 *
 * 覆盖三块：
 * 1. **双端一致性**（T-CU3）：直接 import web 侧 `model.ts` 与 RN 侧
 *    `ChatConversationBridge.ts` 比对——这是「两份同形声明」唯一的正确性保障。
 *    composer/dock 域随剥离退役后，对账面收敛到转录域（web 侧
 *    CONVERSATION_COMPOSER_TYPES / CONVERSATION_DOCK_TYPES 是合成包本体的
 *    路由清单，Step 6 随包退役，不再纳入 RN 对账）。
 * 2. **宽松 decoder**：`ready` 判 `v === 2`；其余 type **不校验 v**
 *    （转录域上行恒为 v:1，校验即丢消息；剥离后残余 composer 域上行同样宽松放行、
 *    宿主不消费）。
 * 3. **坏 JSON 宽容**：坏信封返回 `malformed`，宿主静默丢弃、绝不 throw 到渲染树。
 */
import {describe, expect, it} from '@jest/globals';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_READY_VERSION,
  CONVERSATION_THEME_KEYS,
  conversationCapabilitiesInclude,
  decodeConversationUpstream,
  parseConversationScrollSnapshot,
  readReadyCapabilities,
  type ConversationHostMessage,
} from '@/components/chat/ChatConversationBridge';
// web 侧协议真源（同一份声明的另一半）
import {
  CONVERSATION_BRIDGE_V as WEB_CONVERSATION_BRIDGE_V,
  CONVERSATION_READY_VERSION as WEB_CONVERSATION_READY_VERSION,
  CONVERSATION_THEME_KEYS as WEB_CONVERSATION_THEME_KEYS,
  CONVERSATION_COMPOSER_TYPES as WEB_CONVERSATION_COMPOSER_TYPES,
  CONVERSATION_DOCK_TYPES as WEB_CONVERSATION_DOCK_TYPES,
  CONVERSATION_TRANSCRIPT_TYPES as WEB_CONVERSATION_TRANSCRIPT_TYPES,
  conversationCapabilities as webConversationCapabilities,
} from '@/web/chat-conversation/webview/model';
// ready 的 u 标识与转录域能力清单真源（web 独立入口 / RN 桥同源常量）
import {TRANSCRIPT_READY_VERSION} from '@/web/chat-transcript/transcript-capabilities';
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
 *
 * D4c 收口后为纯转录域 14 键：composer 域 7 条下行
 * （setText/setSelection/setDisabled/blur/composerState/composerPaste/selectAll）
 * 已从联合删除。
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
};

describe('chat-conversation 桥协议 v2 · 双端一致性', () => {
  it('T-CU3: CONVERSATION_BRIDGE_V 双端同为 2', () => {
    expect(CONVERSATION_BRIDGE_V).toBe(2);
    expect(WEB_CONVERSATION_BRIDGE_V).toBe(2);
    expect(CONVERSATION_BRIDGE_V).toBe(WEB_CONVERSATION_BRIDGE_V);
  });

  it('ready 的 u 标识：RN 侧与转录域真源同源（独立入口 t1），宿主判定只认 v===2', () => {
    // 宿主对 ready 的判定只认 v === 2（decodeConversationUpstream），version
    // 是辅助信息；同源断言保证「标识字符串」不出现第二份手抄。
    expect(CONVERSATION_READY_VERSION).toBe(TRANSCRIPT_READY_VERSION);
    expect(CONVERSATION_READY_VERSION).toBe('t1');
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

  it('下行 type 全集：RN 联合（纯转录 14 键）与 web init/themeUpdate/TRANSCRIPT_TYPES 相等', () => {
    // D4c 收口：web 侧 COMPOSER_TYPES / DOCK_TYPES 是合成包本体（含 dock）的
    // 路由清单——包本体 Step 6 才退役，本节点不纳入 RN 对账面。
    const webDownstreamTypes = [
      'init',
      'themeUpdate',
      ...WEB_CONVERSATION_TRANSCRIPT_TYPES,
    ];
    const rnDownstreamTypes = Object.keys(RN_HOST_MESSAGE_TYPES);
    // 双向相等：任一侧多一条/少一条都红（RN 侧的增删另由上面的 Record 类型锁住）
    expect([...webDownstreamTypes].sort()).toEqual([...rnDownstreamTypes].sort());
    // stickIfNearBottom 已在 web 清单移除（BASE 起无生产方），双端都不该再有
    expect(webDownstreamTypes).not.toContain('stickIfNearBottom');
    expect(rnDownstreamTypes).not.toContain('stickIfNearBottom');
    // composer/dock 域 7 条下行已随 D4c 从 RN 联合退役
    for (const retired of [
      'setText',
      'setSelection',
      'setDisabled',
      'blur',
      'composerState',
      'composerPaste',
      'selectAll',
    ]) {
      expect(rnDownstreamTypes).not.toContain(retired);
    }
  });

  it('列表域下行/上行协议面已随回滚整体退役（双端都不该再有这些 type）', () => {
    // 会话列表回到 RN：sessionList / viewState 下行与 listAction 上行三条协议面
    // 双端同时删除。这里的 Record 类型锁 + 清单比对已经是强约束，再钉一次显式
    // 名单，避免将来「只删一侧」被静默放过。
    const rnDownstreamTypes = Object.keys(RN_HOST_MESSAGE_TYPES);
    for (const retired of ['sessionList', 'viewState']) {
      expect(rnDownstreamTypes).not.toContain(retired);
    }
    const webDownstreamTypes = [
      ...WEB_CONVERSATION_TRANSCRIPT_TYPES,
      ...WEB_CONVERSATION_COMPOSER_TYPES,
      ...WEB_CONVERSATION_DOCK_TYPES,
    ];
    for (const retired of ['sessionList', 'viewState']) {
      expect(webDownstreamTypes).not.toContain(retired);
    }
    // 上行 listAction 宽松 decoder 仍会收（它不校验 type 白名单），但 RN 侧
    // 已无 parseConversationListAction 消费方 → 不再有任何 action 枚举声明。
    const model = require('@/web/chat-conversation/webview/model');
    expect(model.CONVERSATION_LIST_ACTIONS).toBeUndefined();
    expect(model.CONVERSATION_LIST_TYPES).toBeUndefined();
  });

  it('能力协商：转录域能力位可判定；composer-dock 位不再是 RN 消费面', () => {
    // web 包本体 capabilities 仍含 composer-dock（dock 随合成包过渡期存活）；
    // RN 侧 ready 消费面只剩转录域 streamBlockCommit（D4b 剥离 composer-dock 判定）。
    const caps = webConversationCapabilities();
    expect(caps).toContain('streamBlockCommit');
    expect(conversationCapabilitiesInclude(caps, 'streamBlockCommit')).toBe(true);
    // 「未声明 = 不支持」：空清单一律 false
    expect(conversationCapabilitiesInclude([], 'streamBlockCommit')).toBe(false);
    expect(conversationCapabilitiesInclude(undefined, 'streamBlockCommit')).toBe(
      false,
    );
  });
});

describe('chat-conversation 宽松 decoder', () => {
  it('ready 只认 v === 2', () => {
    const ok = decodeConversationUpstream(
      JSON.stringify({
        v: 2,
        type: 'ready',
        payload: {version: TRANSCRIPT_READY_VERSION, capabilities: []},
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

  it('其余 type **不校验 v**：转录域上行恒为 v:1 也要收', () => {
    // 转录 runtime 的 post 是模块级单例、BRIDGE_V=1 硬编码，上行必然是 v:1。
    // change / selectionChange 是剥离后的残余 composer 域上行（旧 dist 仍在发）：
    // decoder 宽松放行、宿主不消费。
    for (const type of [
      'scrollSnapshot',
      'loadOlder',
      'visibility',
      'menuOpened',
      'openMessageMenu',
      'copyCode',
      'change',
      'selectionChange',
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

  it('dockAction（v:2）宽松收下（宿主已不消费该上行，decoder 不做白名单过滤）', () => {
    const res = decodeConversationUpstream(
      JSON.stringify({v: 2, type: 'dockAction', payload: {action: 'send'}}),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message.payload.action).toBe('send');
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
      payload: {capabilities: ['streamBlockCommit']},
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(readReadyCapabilities(res.message.payload)).toEqual([
        'streamBlockCommit',
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
