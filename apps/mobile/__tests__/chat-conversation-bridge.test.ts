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
  CONVERSATION_THEME_KEYS,
  conversationCapabilitiesInclude,
  conversationDockActionIncludes,
  decodeConversationUpstream,
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

  it('下行 type 全集：RN ConversationHostMessage 与 web 三清单扁平化相等', () => {
    const webDownstreamTypes = [
      'init',
      'themeUpdate',
      ...WEB_CONVERSATION_TRANSCRIPT_TYPES,
      ...WEB_CONVERSATION_COMPOSER_TYPES,
      ...WEB_CONVERSATION_DOCK_TYPES,
    ];
    const rnDownstreamTypes = Object.keys(RN_HOST_MESSAGE_TYPES);
    // web 侧三清单内部不得有重复项（否则扁平化会引入伪计数）
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
