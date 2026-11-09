/**
 * 统一宿主 `ChatConversationWebView` 行为测试（chat-webview-unify Step 6；
 * composer-native-2026-10 Step 2 按 D4b 改写到剥离后 API）。
 *
 * mock 手法照 `chat-transcript-webview.test.tsx`（同一套 webview mock / yield-quantum
 * mock / sanitize-html mock），断言面按 spec 的 T-CU 族挑与**本组件**的部分：
 * - ready 的 v 判定（v:2 才置 webReady；v:1 ready 被拒 → 走 8s 超时兜底错误态）；
 * - ready → 恢复链两步固定顺序（init → 快照直发；composer 域两步已随剥离退役）；
 * - 划词菜单（仅复制：nbsp 清洗链；全选/粘贴跨桥动作随 composer/dock 域退役）；
 * - 前后台感知自愈与渲染进程回收（webview-background-ready-fail 全套）；
 * - 8s 超时兜底（假时钟；每次 onLoad / 重挂重新计时）；
 * - 切会话 key 重挂、transcriptOnly 变体、流式命令式 API 与块提交判路。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState, Linking, Platform, Text} from 'react-native';
import {type ChatMessageData} from '@novel-master/core/chat';
import {CONVERSATION_BRIDGE_V} from '@/components/chat/ChatConversationBridge';
import type {TranscriptStreamingMessage} from '@/components/chat/ChatTranscriptBridge';
import {
  ChatConversationWebView,
  type ChatConversationWebViewHandle,
} from '@/components/chat/ChatConversationWebView';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';
import {CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS} from '@/components/chat/chat-transcript-selection-menu';
import {buildTranscriptLabels} from '@/components/chat/transcript-labels';
import {CORE_CATALOGS} from '@novel-master/core/i18n';
import {coreT} from '@/i18n/core';
import {
  TRANSCRIPT_CAPABILITIES,
  TRANSCRIPT_READY_VERSION,
} from '@/web/chat-transcript/transcript-capabilities';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      borderLight: '#222',
      border: '#333',
      textSecondary: '#ccc',
      primary: '#08f',
      text: '#fff',
      selection: '#08f55',
      danger: '#f55',
    },
  }),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {
    setString: jest.fn(),
    getString: jest.fn(async () => 'clipboard-text'),
  },
}));

// sanitize-html 嵌套依赖 htmlparser2 为 ESM，Jest 默认不转换——与既有测试同款透传。
jest.mock('sanitize-html', () => {
  const fn = jest.fn((html: string) => html);
  (fn as {defaults?: unknown}).defaults = {
    allowedTags: ['p', 'a', 'span', 'div'],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
    },
  };
  return fn;
});

jest.mock('@/services/chat-transcript-telemetry', () => ({
  emitChatTranscriptTelemetry: jest.fn(),
}));

/**
 * 快照分片循环的片间让步 mock：**由用例手动开闸**。
 *
 * 为什么要开闸而不是 `setTimeout(0)`：本文件要断言「分片在途窗口内 composer 域
 * 仍直发」（T-CU7），而开闸式的窗口由测试精确控制——不 release，余片就永远不发，
 * 「在途」这个前提不再依赖 act 是否顺带把宏任务抽干（那会让窗口悄悄消失、断言假绿）。
 */
let mockChunkGate: {promise: Promise<void>; release: () => void} | null = null;

/** 关闸：此后每次片间让步都挂起，直到 `releaseChunkGate()`。 */
function closeChunkGate(): void {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  mockChunkGate = {promise, release};
}

function releaseChunkGate(): void {
  mockChunkGate?.release();
  mockChunkGate = null;
}

jest.mock('@/services/yield-quantum', () => ({
  createQuantumYield: () => () => {
    const gate = mockChunkGate;
    return gate != null ? gate.promise : Promise.resolve();
  },
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {MainBundleDir: '/App/NovelMaster.app'},
    },
  },
}));

Object.defineProperty(Platform, 'OS', {
  configurable: true,
  get: () => 'android',
});

// 现代 dist 的能力全集（流式投影协议：streamBlockCommit + streamProjection；
// 与 web 入口 ready 同源常量）。
const MODERN_CAPABILITIES = [...TRANSCRIPT_CAPABILITIES];

function sampleMessage(id: string, seq: number): ChatMessageData {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'user',
    content: {blocks: [{type: 'text', text: `msg-${id}`}]},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

type SentMessage = {v?: number; type: string; payload: Record<string, unknown>};

function sentMessages(since = 0): SentMessage[] {
  return mockWebViewPostMessages
    .slice(since)
    .map(raw => JSON.parse(raw) as SentMessage);
}

function sentTypes(since = 0): string[] {
  return sentMessages(since).map(m => m.type);
}

/** 某一 type 的全部下行载荷（init / 快照断言面）。 */
function sentOfType(type: string, since = 0): Array<Record<string, unknown>> {
  return sentMessages(since)
    .filter(m => m.type === type)
    .map(m => m.payload);
}

function webViewOf(root: TestRenderer.ReactTestInstance) {
  return root.findByType(
    require('react-native-webview').default as React.ComponentType<{
      onMessage?: (event: {nativeEvent: {data: string}}) => void;
      onLoad?: () => void;
      onCustomMenuSelection?: (event: {
        nativeEvent: {key?: string; selectedText?: string};
      }) => void;
      menuItems?: ReadonlyArray<{label: string; key: string}>;
    }>,
  );
}

/** 模拟 web 上行（v 号由调用方决定——ready 用 2，其余照 v:1 单例）。 */
function simulateUpstream(
  root: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
  v = 1,
): void {
  const webView = webViewOf(root);
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {data: JSON.stringify({v, type, payload})},
    });
  });
}

function simulateReadyV2(
  root: TestRenderer.ReactTestInstance,
  capabilities: readonly string[] = MODERN_CAPABILITIES,
): void {
  simulateUpstream(
    root,
    'ready',
    {
      version: TRANSCRIPT_READY_VERSION,
      capabilities: [...capabilities],
      readyState: 'complete',
    },
    CONVERSATION_BRIDGE_V,
  );
}

function simulateLoad(root: TestRenderer.ReactTestInstance): void {
  const webView = webViewOf(root);
  act(() => {
    webView.props.onLoad?.();
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushTimers(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

async function flushAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** 冲净分片序列（片间让步为 setTimeout(0)，逐轮推进直到消息序列稳定）。 */
async function flushSnapshotChunks(rounds = 16): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    const before = mockWebViewPostMessages.length;
    await flushTimers();
    await flushAnimationFrame();
    if (mockWebViewPostMessages.length === before) {
      break;
    }
  }
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionKey: 'p1:s1',
    messages: [sampleMessage('m1', 1)],
    ...overrides,
  };
}

const ClipboardMock = require('@react-native-clipboard/clipboard').default as {
  setString: jest.Mock;
  getString: jest.Mock;
};

/** 遥测 mock：本文件已整体 mock 掉 chat-transcript-telemetry（见顶部 jest.mock）。 */
const telemetryMock = require('@/services/chat-transcript-telemetry')
  .emitChatTranscriptTelemetry as jest.Mock;

/**
 * 挂载登记册：每个用例结束后卸载。
 *
 * 不卸载会留下未收的 8s ready 兜底定时器（T-CU15 用的就是它），Jest 退出时
 * 报 "did not exit one second after the test run" 并在环境拆除后再跑一次
 * 渲染——噪音大且会掩盖真实失败。
 */
const mounted: TestRenderer.ReactTestRenderer[] = [];

function track(
  tree: TestRenderer.ReactTestRenderer,
): TestRenderer.ReactTestRenderer {
  mounted.push(tree);
  return tree;
}

async function unmountAll(): Promise<void> {
  while (mounted.length > 0) {
    const tree = mounted.pop()!;
    await act(async () => {
      tree.unmount();
    });
  }
}

describe('ChatConversationWebView · ready 握手与兜底', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
    ClipboardMock.setString.mockClear();
    ClipboardMock.getString.mockClear();
    ClipboardMock.getString.mockResolvedValue('clipboard-text');
  });

  afterEach(async () => {
    jest.useRealTimers();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  it('ready v:2 才置位 webReady 并开始下行；v:1 ready 被拒不置位', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    simulateLoad(tree!.root);

    // ready 之前零下行（webReady 门控）
    expect(mockWebViewPostMessages).toHaveLength(0);

    // v:1 ready（旧 dist）——必须被拒：置位了就会把 v2 协议灌进不认得的页面
    simulateUpstream(tree!.root, 'ready', {version: 'm4'}, 1);
    await flushMicrotasks();
    expect(mockWebViewPostMessages).toHaveLength(0);

    // v:2 ready —— 置位
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    expect(sentTypes()).toContain('init');
  });

  it('T-CU8a: ready → 恢复链两步固定顺序 init → 快照直发', async () => {
    // D4b 剥离后恢复链缩为两步：composerState / 草稿 setText 两步随 composer
    // 域退役（草稿链落点移步原生 composer，Step 5 接线）。
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    simulateLoad(tree!.root);
    simulateReadyV2(tree!.root);
    await flushMicrotasks();

    const types = sentTypes();
    const initIdx = types.indexOf('init');
    const snapshotIdx = types.indexOf('sessionSnapshot');

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeGreaterThan(initIdx);
    // composer 域消息一律不在下行序列里
    for (const retired of [
      'composerState',
      'setText',
      'setSelection',
      'setDisabled',
      'blur',
      'composerPaste',
      'selectAll',
    ]) {
      expect(types).not.toContain(retired);
    }
  });

  it('恢复链载荷：init 聚合 theme+flags；不再带 composer 段与 transcriptOnly 键（缺省）', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();

    const sent = sentMessages();
    const init = sent.find(m => m.type === 'init');
    expect(init?.payload.theme).toMatchObject({
      background: '#000',
      primaryMuted: '#08f22',
      selection: '#08f55',
    });
    // 主题 9 键（transcript 7 ∪ composer 6 去重，键面沿用以免主题下发漏键）
    expect(Object.keys(init!.payload.theme as object)).toHaveLength(9);
    expect(init?.payload.flags).toMatchObject({menuDisabled: false});
    // T-SP22：init.labels 与 core catalog 的 4 个 transcript key 逐字段 parity。
    expect(init?.payload.labels).toEqual(buildTranscriptLabels(coreT));
    // 再直比 zh-CN catalog 字面值：避免宿主与断言共用同一个装配函数造成自证。
    const zh = CORE_CATALOGS['zh-CN']!;
    expect(init?.payload.labels).toEqual({
      generating: zh['label.transcript.generating'],
      thinking: zh['label.transcript.thinking_header'],
      empty: zh['label.transcript.empty'],
      loadOlder: zh['label.transcript.load_older'],
    });
    // D4c 收口：init.composer 段删除（web 侧 dispatcher 对缺失段有兜底）
    expect(init?.payload).not.toHaveProperty('composer');
  });

  it('T-CU15: onLoad 后 8s 未收到 v2 ready → 错误态 + 重载提示（假时钟）', async () => {
    jest.useFakeTimers();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    act(() => {
      simulateLoad(tree!.root);
    });

    await act(async () => {
      jest.advanceTimersByTime(7999);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}),
    ).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(2);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'})
        .length,
    ).toBeGreaterThan(0);
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-retry'})
        .length,
    ).toBeGreaterThan(0);
  });

  it('T-CU15: 收到 v2 ready 取消超时；每次 onLoad 重新计时', async () => {
    jest.useFakeTimers();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    act(() => {
      simulateLoad(tree!.root);
      simulateReadyV2(tree!.root);
    });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}),
    ).toHaveLength(0);

    // 重挂（repaintEpoch）后重新计时：8s 内不报错
    await act(async () => {
      jest.advanceTimersByTime(7999);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}),
    ).toHaveLength(0);
  });

  it('切会话（key 重挂）→ WebView 整棵重挂、onReady 第二次握手（key 归零口径）', async () => {
    // 回滚 SPA 化后切会话靠 `key={chatScrollKey}` 销毁重建，宿主侧不再有
    // sessionKey 清场 effect / needsResume 补铺。观测面就两条：
    // ① key 变 → onReady 第二次被调（新实例重新握手）；
    // ② 新实例按新 sessionKey 重发 init + 快照（文档全新，不存在补铺语义）。
    const onReady = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView key="p1:s1" {...baseProps({onReady})} />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(sentTypes().filter(t => t === 'init')).toHaveLength(1);

    // key 变 = 销毁重建：组件内部没有任何「换会话」effect，握手重来一遍
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          key="p1:s2"
          {...baseProps({
            onReady,
            sessionKey: 'p1:s2',
            messages: [sampleMessage('m2', 1)],
          })}
        />,
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();

    expect(onReady).toHaveBeenCalledTimes(2);
    expect(sentTypes().filter(t => t === 'init')).toHaveLength(2);
    const snapshots = sentMessages().filter(m => m.type === 'sessionSnapshot');
    expect(snapshots.at(-1)!.payload.sessionKey).toBe('p1:s2');
    // 列表域协议整体退役：不再有 viewState / sessionList 下行
    expect(sentTypes()).not.toContain('viewState');
    expect(sentTypes()).not.toContain('sessionList');
  });

  it('同 key 重渲染不重挂：onReady 不再来第二次', async () => {
    const onReady = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView key="p1:s1" {...baseProps({onReady})} />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(onReady).toHaveBeenCalledTimes(1);

    // 只改 messages 不改 key：实例恒等，ready 不重来（8s 窗口也不被续命）
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          key="p1:s1"
          {...baseProps({
            onReady,
            messages: [sampleMessage('m1', 1), sampleMessage('m2', 2)],
          })}
        />,
      );
    });
    await flushMicrotasks();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

/**
 * webview-background-ready-fail：后台冷启动 + 渲染进程被系统回收。
 *
 * 聊天页是 WebView（RN 宿主 + Chromium 渲染进程双进程协作）。长时间后台时系统杀
 * 整个 app 进程，回前台冷启动若 Activity/屏幕不可见，Chromium 冻结 web JS，
 * ready 发不出来——而 RN 侧 8s 握手兜底计时器照常到期，会把这个「冻着」误判成
 * 「装配失败」，落进「对话页加载失败」错误页（early-return 把 WebView 卸载了，
 * 用户只能杀 app 重来）。
 *
 * AppState mock 基建（@react-native/jest-preset 的 AppState mock：`currentState` 是
 * jest.fn() 返回 undefined、`addEventListener` 返回 {remove}），手法照
 * agent-finished-notification.test.ts：`Object.defineProperty` 换 currentState 的
 * getter，再手动取出组件注册的 change 回调 act 触发。
 */
describe('ChatConversationWebView · 前后台感知自愈（webview-background-ready-fail）', () => {
  const ORIGINAL_APP_STATE_DESCRIPTOR = Object.getOwnPropertyDescriptor(
    AppState,
    'currentState',
  );

  function setAppState(state: string): void {
    Object.defineProperty(AppState, 'currentState', {
      get: () => state,
      configurable: true,
    });
  }

  /** 取组件最近一次注册的 change 回调（mock 调用跨用例累积，取最后一个）。 */
  function appStateChangeListener(): (state: string) => void {
    const calls = (AppState.addEventListener as unknown as jest.Mock).mock
      .calls;
    const listener = [...calls]
      .reverse()
      .find(([event]) => event === 'change')?.[1];
    if (listener == null) {
      throw new Error('AppState change 回调未注册');
    }
    return listener as (state: string) => void;
  }

  function emitAppState(state: string): void {
    act(() => {
      appStateChangeListener()(state);
    });
  }

  function errorCount(tree: TestRenderer.ReactTestRenderer): number {
    return tree.root.findAllByProps({testID: 'chat-conversation-ready-error'})
      .length;
  }

  beforeEach(() => {
    clearMockWebViewPostMessages();
    telemetryMock.mockClear();
    // 默认按前台——与真机常态一致（组件对 undefined/null 也按前台处理）
    setAppState('active');
  });

  afterEach(async () => {
    jest.useRealTimers();
    await unmountAll();
    clearMockWebViewPostMessages();
    // 还原 mock 本体，别让本套件的状态漏给后面的 describe（T-CU15 等按前台判死）
    if (ORIGINAL_APP_STATE_DESCRIPTOR != null) {
      Object.defineProperty(
        AppState,
        'currentState',
        ORIGINAL_APP_STATE_DESCRIPTOR,
      );
    }
  });

  async function mount(): Promise<TestRenderer.ReactTestRenderer> {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    return tree;
  }

  it('后台期间 8s 到期不判死；回前台重新计时，仍收不到 ready 才落错误态', async () => {
    jest.useFakeTimers();
    const tree = await mount();
    setAppState('background');
    simulateLoad(tree.root);

    // 冻着 9s：握手计时器到期，但此刻在前台之外 → 不判死（变异点：去掉前后台
    // 判定，这一步就会弹错误态）
    await act(async () => {
      jest.advanceTimersByTime(9_000);
    });
    expect(errorCount(tree)).toBe(0);

    // 回前台：重新计时——「冻结期」不算进 8s 窗口
    setAppState('active');
    emitAppState('active');
    await act(async () => {
      jest.advanceTimersByTime(7_999);
    });
    expect(errorCount(tree)).toBe(0);

    // 前台再熬满 8s 仍没 ready：这次是真·装配失败，判死（证明不是无限挂起）
    await act(async () => {
      jest.advanceTimersByTime(2);
    });
    expect(errorCount(tree)).toBeGreaterThan(0);
  });

  it('错误态下回前台自动重载：early-return 卸载的 WebView 自己回来并重新握手', async () => {
    jest.useFakeTimers();
    const tree = await mount();
    simulateLoad(tree.root);
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(errorCount(tree)).toBeGreaterThan(0);

    // 回前台 → 走 handleReload：重置失败态 + 换 key 重挂 + 重新计时
    emitAppState('active');
    expect(errorCount(tree)).toBe(0);

    // 重挂后的新实例重新握手，恢复正常态（下行重新开始）
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(errorCount(tree)).toBe(0);
    expect(sentTypes()).toContain('init');
  });

  it('onRenderProcessGone（渲染进程被系统回收）→ 换 key 重挂恢复，不弹错误态', async () => {
    jest.useFakeTimers();
    const tree = await mount();
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();

    const webViewProps = webViewOf(tree.root).props as Record<string, unknown>;
    expect(typeof webViewProps.onRenderProcessGone).toBe('function');
    // iOS 对应物防御性同接
    expect(typeof webViewProps.onContentProcessDidTerminate).toBe('function');

    act(() => {
      (webViewProps.onRenderProcessGone as (event: unknown) => void)({
        nativeEvent: {didCrash: false},
      });
    });
    // 换了 key 重挂：重挂后的 8s 窗口内不得报错
    await act(async () => {
      jest.advanceTimersByTime(7_999);
    });
    expect(errorCount(tree)).toBe(0);
    expect(
      telemetryMock.mock.calls
        .map(call => (call as [{name?: string}][])[0])
        .filter(event => event?.name === 'render_process_gone'),
    ).toHaveLength(1);

    // 重挂后的实例重新握手，一切照常
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(errorCount(tree)).toBe(0);
    expect(sentTypes()).toContain('init');
  });

  it('T-SP18: 栈内被盖（hidden 时 app 仍前台）→ 恢复可见不重挂，补一次普通 preserve 快照', async () => {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    const streamingRow: TranscriptStreamingMessage = {
      streamId: 'st-vis',
      status: 'streaming',
      text: '',
      thinking: '',
      tools: [],
      messageId: null,
    };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView
            ref={ref}
            {...baseProps({streamingRows: [streamingRow]})}
          />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    const initCount = sentOfType('init').length;

    // push 子会话屏的形态：native-stack 把主屏 view 摘出窗口，web 报
    // hidden——但 app 仍前台（beforeEach 已 setAppState('active')），web JS
    // 活着、文档不脏。
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: true});
    });

    // 被盖期间主会话后台流式推送照发（streamDelta 在
    // STATE_PAINTING_HOST_MESSAGES 清单内，statePushSinceResumeRef 计数 > 0
    // ——旧判据会把它当脏、恢复可见即重挂）。
    ref.current?.pushStream({
      streamId: 'st-vis',
      segments: [{kind: 'text', delta: '被盖期间的后台流式推送'}],
    });
    await flushAnimationFrame();

    // 恢复可见：不得重挂（重挂会清 webReady、后续一切下行被 postToWeb 早退，
    // dev 包下还要重跑 8s 握手赛跑落「对话页加载失败」错误页——2026-10-05
    // 真机实锤）。
    // 有流式行时一次逻辑快照是「DB 片 + 流式片」多片，按首片计轮次。
    const snapshotRounds = () =>
      sentOfType('sessionSnapshot').filter(payload => payload.chunkIndex === 0)
        .length;
    const snapshotBaseline = snapshotRounds();
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: false});
    });
    await flushMicrotasks();
    expect(sentOfType('init')).toHaveLength(initCount);

    // 但被盖期间确实有改画推送：不重挂的同时补一次**普通**全量快照校正 DOM。
    // 快照即唯一真源——不带 restore 清流语义，也不发 streamReset；流式行与其
    // status 随快照到达（finished 的 run 自然不再显示「生成中」）。
    expect(snapshotRounds()).toBe(snapshotBaseline + 1);
    const snapshotsAfterResume = sentOfType('sessionSnapshot');
    const resumeSnapshot = snapshotsAfterResume.at(-1)!;
    expect(resumeSnapshot).toMatchObject({
      scrollIntent: 'preserve',
      stream: {id: 'st-vis', seq: 1, status: 'streaming'},
    });
    expect(resumeSnapshot).not.toHaveProperty('restoreScroll');
    expect(resumeSnapshot).not.toHaveProperty('generating');
    const resumeRows = resumeSnapshot.rows as Array<Record<string, unknown>>;
    expect(resumeRows.at(-1)).toMatchObject({
      id: 'st-vis',
      kind: 'message',
      status: 'streaming',
      text: '被盖期间的后台流式推送',
    });
    expect(sentTypes()).not.toContain('streamReset');

    // webReady 未被清：恢复可见后的新推送必须照常发出（若被误重挂，
    // postToWeb 早退、基线不增——以「增量 = 1」为牙口，被盖期间已发的那条
    // 不计入）。
    const deltaBaseline = sentOfType('streamDelta').length;
    ref.current?.pushStream({
      streamId: 'st-vis',
      segments: [{kind: 'text', delta: '恢复后的推送'}],
    });
    await flushAnimationFrame();
    expect(sentOfType('streamDelta').length).toBe(deltaBaseline + 1);
    // streamDelta 载荷是 {streamId, seq, segments}（不带 sessionKey——会话身份靠
    // key 重挂归零，delta 本身只管增量正文）
    expect(sentOfType('streamDelta').at(-1)).toMatchObject({
      streamId: 'st-vis',
      segments: [{kind: 'text', delta: '恢复后的推送'}],
    });
  });

  it('T-SP18: 栈内被盖期间 run 收尾（uiRunning true→false）→ 恢复可见补发 preserve 快照，不带 generating', async () => {
    // 依赖新鲜度牙口：handleVisibility 若把 sendSessionSnapshotNow / uiRunning 冻在
    // 首帧，这段「被盖期间 run 收尾」后的补发快照会仍带 generating（或重建旧转录）。
    const ref = React.createRef<ChatConversationWebViewHandle>();
    const messages = [sampleMessage('m1', 1)];
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView
            ref={ref}
            {...baseProps({messages, agentRunning: true, uiRunning: true})}
          />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();

    // 被盖（app 仍前台）：期间有一次改画推送
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: true});
    });
    ref.current?.pushStream({
      streamId: 'st-vis',
      segments: [{kind: 'text', delta: '被盖期间的推送'}],
    });
    await flushAnimationFrame();

    // run 收尾：uiRunning true → false（messages 引用不变，不触发增量判路）
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages, agentRunning: false, uiRunning: false})}
        />,
      );
    });
    await flushMicrotasks();
    const initCount = sentOfType('init').length;
    const snapshotBaseline = sentOfType('sessionSnapshot').length;

    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: false});
    });
    await flushMicrotasks();

    // 不重挂：补发一次 preserve 快照，且必须用收尾后的 uiRunning=false
    expect(sentOfType('init')).toHaveLength(initCount);
    const snapshots = sentOfType('sessionSnapshot');
    expect(snapshots).toHaveLength(snapshotBaseline + 1);
    expect(snapshots.at(-1)).toMatchObject({scrollIntent: 'preserve'});
    expect(snapshots.at(-1)).not.toHaveProperty('generating');
  });

  it('T-SP18: 前台 hidden 但 hidden 期间零推送 → 恢复可见无任何动作（可见期推送已被 hidden 清零）', async () => {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView ref={ref} {...baseProps()} />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();

    // 可见期间先来一次推送（计入旧的「上次恢复以来」口径）——hidden:true 必须
    // 把它清零，否则下面的零推送判定会被这拍污染（P2-14）。
    ref.current?.pushStream({
      streamId: 'st-vis',
      segments: [{kind: 'text', delta: '可见期间的推送'}],
    });
    await flushAnimationFrame();
    expect(sentOfType('streamDelta')).toHaveLength(1);

    const snapshotBaseline = sentOfType('sessionSnapshot').length;
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: true});
    });
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: false});
    });
    await flushMicrotasks();

    // 四象限：active + 0 → 无动作（不发快照、不重挂、不发 reset）。
    expect(sentOfType('sessionSnapshot')).toHaveLength(snapshotBaseline);
    expect(sentTypes()).not.toContain('streamReset');

    // 没重挂：恢复后的推送照常发。
    ref.current?.pushStream({
      streamId: 'st-vis',
      segments: [{kind: 'text', delta: '恢复后的推送'}],
    });
    await flushAnimationFrame();
    expect(sentOfType('streamDelta')).toHaveLength(2);
  });

  it('T-SP18: 前台 hidden 且 hidden 期间零推送 → 恢复可见无动作（quadrant active + 0）', async () => {
    const tree = await mount();
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    const snapshotBaseline = sentOfType('sessionSnapshot').length;

    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: true});
    });
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: false});
    });
    await flushMicrotasks();

    expect(sentOfType('sessionSnapshot')).toHaveLength(snapshotBaseline);
  });

  it('T-SP18: 后台 hidden（非 active）且有推送 → 恢复可见仍脏重挂，重新握手后照常下行', async () => {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView ref={ref} {...baseProps()} />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    const initCount = sentOfType('init').length;

    setAppState('background');
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: true});
    });
    ref.current?.pushStream({
      streamId: 'st-bg',
      segments: [{kind: 'text', delta: '后台期间的推送'}],
    });
    await flushAnimationFrame();
    const snapshotBaseline = sentOfType('sessionSnapshot').length;

    setAppState('active');
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: false});
    });
    await flushMicrotasks();

    // 脏重挂：恢复可见本身不补快照（不假装修复旧文档），webReady 已清 →
    // 新推送被 postToWeb 早退。
    expect(sentOfType('sessionSnapshot')).toHaveLength(snapshotBaseline);
    const deltaBaseline = sentOfType('streamDelta').length;
    ref.current?.pushStream({
      streamId: 'st-bg',
      segments: [{kind: 'text', delta: '重挂期间的推送不会过桥'}],
    });
    await flushAnimationFrame();
    expect(sentOfType('streamDelta')).toHaveLength(deltaBaseline);

    // 重挂后的新文档重新握手：init 再来一次；ready 会按当前消息面补快照。
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('init')).toHaveLength(initCount + 1);
    expect(sentOfType('sessionSnapshot').length).toBeGreaterThan(
      snapshotBaseline,
    );

    // 下行恢复。
    ref.current?.pushStream({
      streamId: 'st-bg',
      segments: [{kind: 'text', delta: '重挂后的推送'}],
    });
    await flushAnimationFrame();
    expect(sentOfType('streamDelta')).toHaveLength(deltaBaseline + 1);
  });

  it('错误页文案指向「点重载恢复」（旧文案只谈重启，用户不知有重载入口）', async () => {
    jest.useFakeTimers();
    const tree = await mount();
    simulateLoad(tree.root);
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });

    const errorView = tree.root.findAllByProps({
      testID: 'chat-conversation-ready-error',
    });
    expect(errorView.length).toBeGreaterThan(0);
    // 错误态整棵树里的文案：Text 节点的 children 就是那两行提示
    const hints = errorView[0]!
      .findAllByType(Text)
      .map(node => String(node.props.children))
      .join('|');
    expect(hints).toContain('点重载恢复');
    // 降级横幅（真·版本过旧场景）的文案一字不动，错误页不得复用它
    expect(hints).not.toContain('输入组件版本可能过低');
  });
});

describe('ChatConversationWebView · 划词菜单（D4b 剥离后仅复制）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
    ClipboardMock.setString.mockClear();
    ClipboardMock.getString.mockClear();
    ClipboardMock.getString.mockResolvedValue('clipboard-text');
  });

  afterEach(async () => {
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  async function mountReady(overrides: Record<string, unknown> = {}) {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView {...baseProps(overrides)} />,
        ),
      );
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    return tree!;
  }

  it('menuItems 恒为仅复制（1 项）：全选/粘贴的跨桥落点已随 composer/dock 域退役', async () => {
    const tree = await mountReady();
    expect(webViewOf(tree.root).props.menuItems).toEqual([
      ...CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS,
    ]);
    // 变体与否不再分叉：主链形态同样是 1 项（死按钮不回流）
    const variant = await mountReady({transcriptOnly: true});
    expect(webViewOf(variant.root).props.menuItems).toHaveLength(1);
  });

  it('复制走现行清洗链：nbsp→空格 + trim', async () => {
    const tree = await mountReady();
    act(() => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'copy', selectedText: '  a b  '},
      });
    });
    expect(ClipboardMock.setString).toHaveBeenCalledWith('a b');
  });

  it('全选/粘贴 key 触发无任何下行与剪贴板读取（菜单项已移除，事件面防御）', async () => {
    const tree = await mountReady();
    const baseline = mockWebViewPostMessages.length;
    act(() => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'selectAll', selectedText: 'x'},
      });
    });
    await act(async () => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'paste', selectedText: 'x'},
      });
    });
    expect(ClipboardMock.getString).not.toHaveBeenCalled();
    expect(sentMessages(baseline)).toHaveLength(0);
  });

  it('运行中（uiRunning）禁复制——已知外溢，行为照旧', async () => {
    const tree = await mountReady({uiRunning: true, agentRunning: true});
    act(() => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'copy', selectedText: 'x'},
      });
    });
    expect(ClipboardMock.setString).not.toHaveBeenCalled();
  });
});

describe('ChatConversationWebView · 安全守卫与加载源', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  it('安全守卫：只放行新包目录内的 file:// 加载', async () => {
    // Linking.openURL 在 RN Jest 环境返回 undefined（无 Promise），补一个可链式 stub
    const openUrl = jest
      .spyOn(Linking, 'openURL')
      .mockImplementation(async () => true as never);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    const guard = webViewOf(tree.root).props
      .onShouldStartLoadWithRequest as (req: {url: string}) => boolean;
    // 宿主加载源已是 chat-transcript 独立包（composer-native-2026-10 Step 5），
    // 放行面随之切换；旧合成包目录不再放行（Step 6 随包退役）。
    expect(
      guard({url: 'file:///android_asset/webview/chat-transcript/index.html'}),
    ).toBe(true);
    expect(
      guard({
        url: 'file:///android_asset/webview/chat-conversation/index.html',
      }),
    ).toBe(false);
    expect(guard({url: 'https://evil.example.com'})).toBe(false);
    // http/https 外跳系统浏览器、绝不回退页内导航
    expect(openUrl).toHaveBeenCalledWith('https://evil.example.com');
    expect(guard({url: 'javascript:alert(1)'})).toBe(false);
    openUrl.mockRestore();
  });

  it('加载源为 chat-transcript 包 URI + C′ #bg 参数（fix-D 白闪修正轮）', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView {...baseProps()} />),
      );
    });
    // fix-D：source 追加 `#bg=` hash 参数（file:// + query 会被部分 WebView 丢弃），
    // 供 index.html head 内联 bootstrap 首绘前同步写 --bg；B 注入同时保留作兜底。
    expect(webViewOf(tree.root).props.source).toEqual({
      uri:
        'file:///android_asset/webview/chat-transcript/index.html#bg=' +
        encodeURIComponent('#000'),
    });
    expect(
      String(
        webViewOf(tree.root).props.injectedJavaScriptBeforeContentLoaded ?? '',
      ),
    ).toContain(`'--bg'`);
  });
});

/* ================================================================== *
 * 列表域（第二阶段 wave-2）
 * ================================================================== */

/* ================================================================== *
 * transcriptOnly 变体（子会话屏，transcript-converge）
 *
 * 变体面此前五处零断言（init 载荷 / memo 比较器 / menuItems / 降级横幅豁免 /
 * 宿主是否真传）。memo 漏字段是本文件**已发生过**的静默 bug（:349-352 自认），
 * 而 transcriptOnly 恰好加在比较器末尾——漏比就是「子会话屏静默退化成主对话形态」。
 * ================================================================== */

describe('ChatConversationWebView · transcriptOnly 变体（子会话屏）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  async function mountReady(
    overrides: Record<string, unknown> = {},
    capabilities: readonly string[] = MODERN_CAPABILITIES,
  ) {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView {...baseProps(overrides)} />,
        ),
      );
    });
    simulateReadyV2(tree!.root, capabilities);
    await flushMicrotasks();
    return tree!;
  }

  it('init 载荷带 transcriptOnly===true；缺省时连键都不发', async () => {
    await mountReady({transcriptOnly: true});
    expect(sentOfType('init')[0]!.transcriptOnly).toBe(true);

    clearMockWebViewPostMessages();
    await mountReady();
    // 条件展开语义：缺省不是「发个 false」，而是**根本不带这个键**——
    // web 侧按 `'transcriptOnly' in route` 之外的形态判也会分叉，故钉死。
    expect(sentOfType('init')[0]).not.toHaveProperty('transcriptOnly');
  });

  it('memo 比较器：只翻转 transcriptOnly 也必须重渲并重发 init', async () => {
    // 回归点：比较器末尾漏掉 `transcriptOnly` 时，整个子树连同恢复链一起被吞，
    // 症状是「子会话屏切主对话形态后 init 不重发、dock 类摘不掉」，零报错。
    // 写法照 :996 的 sessionList 回归点：只改一个字段，其余 props 引用全等。
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView
            {...baseProps({messages, transcriptOnly: true})}
          />,
        ),
      );
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    expect(sentOfType('init')).toHaveLength(1);
    expect(sentOfType('init')[0]!.transcriptOnly).toBe(true);

    // 同一份 messages 引用（避免「顺带被 messages 变更放行」掩盖 memo 漏比）
    await act(async () => {
      tree!.update(
        <ChatConversationWebView
          {...baseProps({messages, transcriptOnly: false})}
        />,
      );
    });
    expect(sentOfType('init')).toHaveLength(2);
    expect(sentOfType('init').at(-1)).not.toHaveProperty('transcriptOnly');
  });

  it('menuItems 退回仅复制（1 项）；变体与否不再分叉', async () => {
    const variant = await mountReady({transcriptOnly: true});
    const variantItems = webViewOf(variant.root).props.menuItems;
    expect(variantItems).toHaveLength(1);
    expect(variantItems).toEqual([...CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS]);

    clearMockWebViewPostMessages();
    const full = await mountReady();
    expect(webViewOf(full.root).props.menuItems).toHaveLength(1);
  });
});

describe('ChatConversationWebView · 快照在途时切会话（key 重挂归零）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    jest.useRealTimers();
    releaseChunkGate();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  /** 120 条 → 3 片（50/片）：closeChunkGate 后首片已过桥、余片挂在让步上。 */
  function bigMessages(): ChatMessageData[] {
    return Array.from({length: 120}, (_, i) => sampleMessage(`m${i}`, i + 1));
  }

  it('切会话（key 重挂）：在途余片随旧实例销毁不再过桥，新实例只发自己那一轮全量', async () => {
    // 回滚后切会话 = key 变化 = 旧 WebView 整棵销毁：分片循环连同让步闸一起
    // 消失，余片醒来时宿主已不在——「中止」不再需要显式的代次顶替逻辑。
    const msgs = bigMessages();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView
            key="p1:s1"
            {...baseProps({messages: msgs})}
          />,
        ),
      );
    });
    simulateLoad(tree.root);
    closeChunkGate();
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    // ready 后两轮快照竞发（开屏 gen1 + pendingSubagent force gen2），首片都
    // 赶在让步前过桥，余片全挂在闸上
    const inFlight = sentOfType('sessionSnapshot');
    expect(inFlight).toHaveLength(2);
    expect(inFlight[0]).toMatchObject({chunkIndex: 0, chunkTotal: 3});

    // 切会话 → key 变 → 旧实例卸载。放闸：旧循环的余片不会补发。
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          key="p1:s2"
          {...baseProps({
            sessionKey: 'p1:s2',
            messages: [sampleMessage('m2', 1)],
          })}
        />,
      );
    });
    releaseChunkGate();
    await flushSnapshotChunks();
    // 仍停在两轮首片：余片一条都没补
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    // 新实例自己重新握手 + 开屏：文档全新，onReady 第二次握手、快照按新
    // sessionKey 重发（无 needsResume 补铺——新文档本来就是空的）
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushSnapshotChunks();
    const after = sentOfType('sessionSnapshot');
    expect(after.at(-1)).toMatchObject({sessionKey: 'p1:s2'});
  });
});

/* ================================================================== *
 * 流式 wire（chat-streaming-projection Step 4：T-SP4 / T-SP5 / T-SP6 / T-SP27）
 *
 * 宿主是 wire 序号的唯一分配者：unit 的 stream-batch 经 pushStream 进入 rAF
 * 合流，最终以一条 streamDelta{streamId, seq, segments, ...} 发出；status
 * 翻转由 streamingRows prop 的 effect 驱动（finishStream 不进出口句柄）。
 * ================================================================== */

describe('ChatConversationWebView · 流式 wire（T-SP4 / T-SP5 / T-SP6 / T-SP27）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    releaseChunkGate();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  function streamingMessage(
    streamId: string,
    overrides: Partial<TranscriptStreamingMessage> = {},
  ): TranscriptStreamingMessage {
    return {
      streamId,
      status: 'streaming',
      text: '',
      thinking: '',
      tools: [],
      messageId: null,
      ...overrides,
    };
  }

  function assistantMessage(
    id: string,
    seq: number,
    text: string,
  ): ChatMessageData {
    return {
      ...sampleMessage(id, seq),
      role: 'assistant',
      content: {blocks: [{type: 'text', text}]},
    };
  }

  /** richText + ready 就绪；返回 ref 与可更新的 tree。 */
  async function mountStreaming(overrides: Record<string, unknown> = {}) {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView
            ref={ref}
            {...baseProps({flags: {richText: true}, ...overrides})}
          />,
        ),
      );
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    return {ref, tree};
  }

  it('T-SP4: 同一 streamId、seq 连续；rAF 合流不制造空洞；块提交 seq 等于所属 delta seq', async () => {
    const {ref} = await mountStreaming({
      streamingRows: [streamingMessage('st-4')],
    });
    const baseline = mockWebViewPostMessages.length;

    ref.current!.pushStream({
      streamId: 'st-4',
      segments: [{kind: 'text', delta: 'a'}],
    });
    await flushAnimationFrame();
    ref.current!.pushStream({
      streamId: 'st-4',
      segments: [{kind: 'text', delta: 'b'}],
    });
    await flushAnimationFrame();
    // 同一 rAF 内两段合流成一条 delta：seq 只前进一格（不制造空洞）
    ref.current!.pushStream({
      streamId: 'st-4',
      segments: [{kind: 'text', delta: 'c'}],
    });
    ref.current!.pushStream({
      streamId: 'st-4',
      segments: [{kind: 'text', delta: 'd'}],
    });
    await flushAnimationFrame();
    // 块切分：完成块 'abcd' 触发 streamBlockCommit，seq 与同拍 delta 相同
    ref.current!.pushStream({
      streamId: 'st-4',
      segments: [{kind: 'text', delta: '\n\npara two'}],
    });
    await flushAnimationFrame();

    const deltas = sentOfType('streamDelta', baseline);
    expect(deltas.map(payload => payload.streamId)).toEqual([
      'st-4',
      'st-4',
      'st-4',
      'st-4',
    ]);
    expect(deltas.map(payload => payload.seq)).toEqual([1, 2, 3, 4]);
    expect(
      (deltas[2]!.segments as Array<{kind: string; delta: string}>).map(
        segment => segment.delta,
      ),
    ).toEqual(['cd']);
    const commits = sentOfType('streamBlockCommit', baseline);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    const lastCommit = commits.at(-1)!;
    expect(lastCommit).toMatchObject({streamId: 'st-4', seq: 4});
    expect(String(lastCommit.blockKey)).toContain('st-4:text:');
  });

  it('T-SP5: status 翻 finished 只发带全量 row 的 streamStatus（不发 reset/快照/toolInvoking）', async () => {
    const text = '第一段\n\n第二段';
    const messages = [sampleMessage('m1', 1)];
    const {tree, ref} = await mountStreaming({
      messages,
      streamingRows: [streamingMessage('st-5', {text})],
    });
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages,
            streamingRows: [
              streamingMessage('st-5', {status: 'finished', text}),
            ],
          })}
        />,
      );
    });
    await flushMicrotasks();

    const sent = sentMessages(baseline);
    const statuses = sent.filter(message => message.type === 'streamStatus');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.payload).toMatchObject({
      streamId: 'st-5',
      status: 'finished',
    });
    const row = statuses[0]!.payload.row as Record<string, unknown>;
    expect(row.text).toBe(text);
    expect(String(row.textHtml)).toContain('第一段');
    expect(String(row.textHtml)).toContain('第二段');
    expect(sent.filter(message => message.type === 'streamReset')).toHaveLength(
      0,
    );
    expect(
      sent.filter(message => message.type === 'sessionSnapshot'),
    ).toHaveLength(0);
    expect(
      sent.filter(message => message.type === 'streamToolInvoking'),
    ).toHaveLength(0);
  });

  it('T-SP6: DB 接管 → 不发 append/snapshot，发 streamStatus{row+messageId}', async () => {
    const user = sampleMessage('u1', 1);
    const {tree, ref} = await mountStreaming({
      messages: [user],
      streamingRows: [streamingMessage('st-a', {text: 'answer'})],
    });
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages: [user, assistantMessage('a1', 2, 'answer')],
            streamingRows: [streamingMessage('st-a', {text: 'answer'})],
            streamRowIds: new Map([['a1', 'st-a']]),
          })}
        />,
      );
    });
    await flushMicrotasks();

    const sent = sentMessages(baseline);
    expect(
      sent.filter(message => message.type === 'appendTailRows'),
    ).toHaveLength(0);
    expect(
      sent.filter(message => message.type === 'sessionSnapshot'),
    ).toHaveLength(0);
    const statuses = sent.filter(message => message.type === 'streamStatus');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.payload).toMatchObject({
      streamId: 'st-a',
      status: 'finished',
      messageId: 'a1',
    });
    expect(statuses[0]!.payload.row as Record<string, unknown>).toMatchObject({
      id: 'st-a',
      messageId: 'a1',
      status: 'finished',
    });
  });

  it('T-SP6: 一次更新命中 2 条 adopted → 两条 streamStatus 都带 row/messageId', async () => {
    const user = sampleMessage('u1', 1);
    const {tree, ref} = await mountStreaming({
      messages: [user],
      streamingRows: [streamingMessage('st-a', {text: 'one'})],
    });
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages: [
              user,
              assistantMessage('a1', 2, 'one'),
              assistantMessage('a2', 3, 'two'),
            ],
            streamingRows: [streamingMessage('st-a', {text: 'one'})],
            streamRowIds: new Map([
              ['a1', 'st-a'],
              ['a2', 'st-b'],
            ]),
          })}
        />,
      );
    });
    await flushMicrotasks();

    const statuses = sentOfType('streamStatus', baseline);
    expect(statuses).toHaveLength(2);
    expect(statuses.map(payload => payload.messageId)).toEqual(['a1', 'a2']);
    expect(statuses.map(payload => payload.streamId)).toEqual(['st-a', 'st-b']);
    for (const payload of statuses) {
      expect(payload.row as Record<string, unknown>).toMatchObject({
        status: 'finished',
        messageId: payload.messageId,
      });
    }
  });

  it('T-SP6: streamingRows 先清空（已接管）→ 不 reset；messages 后到补终态行', async () => {
    const user = sampleMessage('u1', 1);
    const messages = [user];
    const streamRowIds = new Map([['a1', 'st-a']]);
    const {tree, ref} = await mountStreaming({
      messages,
      streamingRows: [streamingMessage('st-a', {text: 'answer'})],
      streamRowIds,
    });

    const baseline = mockWebViewPostMessages.length;
    // 顺序 A：投影先剔除已接管行 → 不 reset、不发快照
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages,
            streamingRows: [],
            streamRowIds,
          })}
        />,
      );
    });
    await flushMicrotasks();
    let sent = sentMessages(baseline);
    expect(sent.filter(message => message.type === 'streamReset')).toHaveLength(
      0,
    );
    expect(
      sent.filter(message => message.type === 'sessionSnapshot'),
    ).toHaveLength(0);

    // messages 后到 → 恰好一条终态行
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages: [user, assistantMessage('a1', 2, 'answer')],
            streamingRows: [],
            streamRowIds,
          })}
        />,
      );
    });
    await flushMicrotasks();
    sent = sentMessages(baseline);
    const statuses = sent.filter(message => message.type === 'streamStatus');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.payload).toMatchObject({
      streamId: 'st-a',
      messageId: 'a1',
    });
  });

  it('T-SP6: messages 先到（行仍在）→ 终态行；随后投影剔除不 reset（两种顺序都不丢）', async () => {
    const user = sampleMessage('u1', 1);
    const streamRowIds = new Map([['a1', 'st-a']]);
    const {tree, ref} = await mountStreaming({
      messages: [user],
      streamingRows: [streamingMessage('st-a', {text: 'answer'})],
      streamRowIds,
    });
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages: [user, assistantMessage('a1', 2, 'answer')],
            streamingRows: [streamingMessage('st-a', {text: 'answer'})],
            streamRowIds,
          })}
        />,
      );
    });
    await flushMicrotasks();
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            messages: [user, assistantMessage('a1', 2, 'answer')],
            streamingRows: [],
            streamRowIds,
          })}
        />,
      );
    });
    await flushMicrotasks();

    const sent = sentMessages(baseline);
    expect(
      sent.filter(message => message.type === 'streamStatus'),
    ).toHaveLength(1);
    expect(sent.filter(message => message.type === 'streamReset')).toHaveLength(
      0,
    );
  });

  it('T-SP27: 同拍「旧 id finish + 新 id begin」→ 旧行全量终态、新行快照，文本不丢不重', async () => {
    const {tree, ref} = await mountStreaming({
      streamingRows: [streamingMessage('st-old', {text: '旧正文'})],
    });
    ref.current!.pushStream({
      streamId: 'st-old',
      segments: [{kind: 'text', delta: '追加'}],
    });
    await flushAnimationFrame();
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            streamingRows: [
              streamingMessage('st-old', {
                status: 'finished',
                text: '旧正文追加',
              }),
              streamingMessage('st-new'),
            ],
          })}
        />,
      );
    });
    await flushMicrotasks();
    await flushSnapshotChunks();

    const sent = sentMessages(baseline);
    const status = sent.find(
      message =>
        message.type === 'streamStatus' &&
        message.payload.streamId === 'st-old',
    );
    expect(status).toBeDefined();
    expect((status!.payload.row as Record<string, unknown>).text).toBe(
      '旧正文追加',
    );
    // 新 id 开屏快照带空 streaming 行；旧 finished 行仍在投影里（未接管），
    // 但正文只出现一次（不重复）
    const snapshots = sent.filter(
      message => message.type === 'sessionSnapshot',
    );
    const last = snapshots.at(-1)!;
    const rows = last.payload.rows as Array<{id: string; text: string}>;
    expect(rows.map(row => row.id)).toContain('st-new');
    const oldRows = rows.filter(row => row.id === 'st-old');
    expect(oldRows).toHaveLength(1);
    expect(oldRows[0]!.text).toBe('旧正文追加');
    expect(sent.filter(message => message.type === 'streamReset')).toHaveLength(
      0,
    );
  });

  it('T-SP27: delta 先到（新 id）→ 旧 id finish 不丢文本，新流 seq 从 1 连续', async () => {
    const {tree, ref} = await mountStreaming({
      streamingRows: [streamingMessage('st-old', {text: '旧正文'})],
    });
    const baseline = mockWebViewPostMessages.length;
    // 新 id 的 delta 先于 prop 更新到达：pushStream 自动 beginStream(st-new)
    ref.current!.pushStream({
      streamId: 'st-new',
      segments: [{kind: 'text', delta: '新正文'}],
    });
    await flushAnimationFrame();

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            streamingRows: [
              streamingMessage('st-old', {
                status: 'finished',
                text: '旧正文',
              }),
              streamingMessage('st-new', {text: '新正文'}),
            ],
          })}
        />,
      );
    });
    await flushMicrotasks();
    await flushSnapshotChunks();

    const status = sentMessages(baseline).find(
      message =>
        message.type === 'streamStatus' &&
        message.payload.streamId === 'st-old',
    );
    expect(status).toBeDefined();
    expect((status!.payload.row as Record<string, unknown>).text).toBe(
      '旧正文',
    );

    // 新流继续：seq 从 1 连续（beginStream 已把新流 seq 归零）
    ref.current!.pushStream({
      streamId: 'st-new',
      segments: [{kind: 'text', delta: '续写'}],
    });
    await flushAnimationFrame();
    const newDeltas = sentOfType('streamDelta', baseline).filter(
      payload => payload.streamId === 'st-new',
    );
    expect(newDeltas.map(payload => payload.seq)).toEqual([1, 2]);
    expect(sentOfType('streamReset', baseline)).toHaveLength(0);
  });

  it('T-SP27: 旧 id 直接从投影消失（未带 finished）→ 仍用累加器补全量终态行', async () => {
    const {tree, ref} = await mountStreaming({
      streamingRows: [streamingMessage('st-gone', {text: '正文'})],
    });
    ref.current!.pushStream({
      streamId: 'st-gone',
      segments: [{kind: 'text', delta: '尾'}],
    });
    await flushAnimationFrame();
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            flags: {richText: true},
            streamingRows: [streamingMessage('st-next')],
          })}
        />,
      );
    });
    await flushMicrotasks();

    const status = sentMessages(baseline).find(
      message =>
        message.type === 'streamStatus' &&
        message.payload.streamId === 'st-gone',
    );
    expect(status).toBeDefined();
    // 行已不在投影里，但当前流的文本在宿主累加器（seed + delta）→ 全量终态行
    expect((status!.payload.row as Record<string, unknown>).text).toBe(
      '正文尾',
    );
    expect((status!.payload.row as Record<string, unknown>).status).toBe(
      'finished',
    );
  });

  it('T-SP29: streamResync 同 streamId 100ms 限流，超窗再补一次快照', async () => {
    const {tree} = await mountStreaming();
    const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      const baseline = sentOfType('sessionSnapshot').length;
      simulateUpstream(tree.root, 'streamResync', {
        streamId: 'st-1',
        expectedSeq: 2,
      });
      await flushMicrotasks();
      simulateUpstream(tree.root, 'streamResync', {
        streamId: 'st-1',
        expectedSeq: 2,
      });
      await flushMicrotasks();
      expect(sentOfType('sessionSnapshot')).toHaveLength(baseline + 1);

      nowSpy.mockReturnValue(1101);
      simulateUpstream(tree.root, 'streamResync', {
        streamId: 'st-1',
        expectedSeq: 2,
      });
      await flushMicrotasks();
      expect(sentOfType('sessionSnapshot')).toHaveLength(baseline + 2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('ChatConversationWebView · 上行分发', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
    ClipboardMock.setString.mockClear();
    telemetryMock.mockClear();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  async function mountReady(overrides: Record<string, unknown> = {}) {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView {...baseProps(overrides)} />,
        ),
      );
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    return tree;
  }

  it('ready：onReady 一次；关掉可能残留的 mermaid 全屏', async () => {
    const onReady = jest.fn();
    const onWebMermaidViewerOpenChange = jest.fn();
    await mountReady({onReady, onWebMermaidViewerOpenChange});
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onWebMermaidViewerOpenChange).toHaveBeenCalledTimes(1);
    expect(onWebMermaidViewerOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('copyCode：非空写剪贴板；空串不写', async () => {
    const tree = await mountReady();
    simulateUpstream(tree.root, 'copyCode', {code: 'x'});
    expect(ClipboardMock.setString).toHaveBeenCalledWith('x');

    ClipboardMock.setString.mockClear();
    simulateUpstream(tree.root, 'copyCode', {code: ''});
    expect(ClipboardMock.setString).not.toHaveBeenCalled();
  });

  it('scrollSnapshot：schema 匹配时回传快照', async () => {
    const onScrollSnapshot = jest.fn();
    const tree = await mountReady({onScrollSnapshot});
    simulateUpstream(tree.root, 'scrollSnapshot', {
      schemaVersion: 2,
      offsetY: 42,
      nearBottom: false,
    });
    expect(onScrollSnapshot).toHaveBeenCalledWith({
      schemaVersion: 2,
      offsetY: 42,
      nearBottom: false,
    });
  });

  it('loadOlder / openToolFile / linkClick / openSubagentSession 逐域直传', async () => {
    const onLoadOlder = jest.fn();
    const onOpenToolFile = jest.fn();
    const onLinkClick = jest.fn();
    const onOpenSubagentSession = jest.fn();
    const tree = await mountReady({
      onLoadOlder,
      onOpenToolFile,
      onLinkClick,
      onOpenSubagentSession,
    });
    simulateUpstream(tree.root, 'loadOlder');
    simulateUpstream(tree.root, 'openToolFile', {path: 'a.ts'});
    simulateUpstream(tree.root, 'linkClick', {href: 'https://x'});
    simulateUpstream(tree.root, 'openSubagentSession', {sessionId: 's2'});
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(onOpenToolFile).toHaveBeenCalledWith('a.ts');
    expect(onLinkClick).toHaveBeenCalledWith('https://x');
    expect(onOpenSubagentSession).toHaveBeenCalledWith('s2');
  });

  it('openSkillDetail：projectId 缺省时对象不带该键', async () => {
    const onOpenSkillDetail = jest.fn();
    const tree = await mountReady({onOpenSkillDetail});
    simulateUpstream(tree.root, 'openSkillDetail', {
      domain: 'skill',
      name: 'n',
      projectId: 'p',
    });
    simulateUpstream(tree.root, 'openSkillDetail', {
      domain: 'project',
      name: 'm',
    });

    const [withProject, withoutProject] = onOpenSkillDetail.mock.calls;
    expect(withProject![0]).toEqual({
      domain: 'skill',
      name: 'n',
      projectId: 'p',
    });
    expect(withoutProject![0]).toEqual({domain: 'project', name: 'm'});
    expect(withoutProject![0]).not.toHaveProperty('projectId');
  });

  it('openToolResult：inputJson 仅字符串时带出（空串照带）', async () => {
    const onOpenToolResult = jest.fn();
    const tree = await mountReady({onOpenToolResult});
    simulateUpstream(tree.root, 'openToolResult', {
      title: 't',
      content: 'c',
      inputJson: '{}',
    });
    simulateUpstream(tree.root, 'openToolResult', {title: 't2', content: 'c2'});
    simulateUpstream(tree.root, 'openToolResult', {
      title: 't3',
      content: 'c3',
      inputJson: '',
    });

    const [withJson, withoutJson, emptyJson] = onOpenToolResult.mock.calls;
    expect(withJson![0]).toMatchObject({inputJson: '{}'});
    expect(withoutJson![0]).not.toHaveProperty('inputJson');
    expect(emptyJson![0]).toHaveProperty('inputJson', '');
  });

  it('openMessageMenu：空闲态先遥测再回调', async () => {
    const onOpenMessageMenu = jest.fn();
    const tree = await mountReady({onOpenMessageMenu});
    simulateUpstream(tree.root, 'openMessageMenu', {
      messageId: 'm1',
      pageX: 10,
      pageY: 20,
    });
    expect(telemetryMock).toHaveBeenCalledWith({name: 'menu_open'});
    expect(onOpenMessageMenu).toHaveBeenCalledWith('m1', 10, 20);
  });

  it('openMessageMenu：uiRunning 守卫拦住遥测与回调', async () => {
    const onOpenMessageMenu = jest.fn();
    const tree = await mountReady({
      onOpenMessageMenu,
      agentRunning: true,
      uiRunning: true,
    });
    simulateUpstream(tree.root, 'openMessageMenu', {
      messageId: 'm1',
      pageX: 10,
      pageY: 20,
    });
    expect(onOpenMessageMenu).not.toHaveBeenCalled();
    expect(telemetryMock).not.toHaveBeenCalledWith({name: 'menu_open'});
  });

  it('messageMenuAction / menuOpened / menuClosed 逐域直传', async () => {
    const onMessageMenuAction = jest.fn();
    const onWebMenuOpenChange = jest.fn();
    const tree = await mountReady({
      onMessageMenuAction,
      onWebMenuOpenChange,
    });
    simulateUpstream(tree.root, 'messageMenuAction', {
      messageId: 'm1',
      action: 'rollback',
    });
    simulateUpstream(tree.root, 'menuOpened');
    simulateUpstream(tree.root, 'menuClosed');
    expect(onMessageMenuAction).toHaveBeenCalledWith('m1', 'rollback');
    expect(onWebMenuOpenChange).toHaveBeenNthCalledWith(1, true);
    expect(onWebMenuOpenChange).toHaveBeenNthCalledWith(2, false);
  });

  it('mermaidViewerOpened / Closed：先清掉 ready 时的 (false) 再断言', async () => {
    const onWebMermaidViewerOpenChange = jest.fn();
    const tree = await mountReady({onWebMermaidViewerOpenChange});
    // handleReady 在握手时已发过一次 (false)，不清就是假绿
    onWebMermaidViewerOpenChange.mockClear();

    simulateUpstream(tree.root, 'mermaidViewerOpened');
    expect(onWebMermaidViewerOpenChange).toHaveBeenCalledTimes(1);
    expect(onWebMermaidViewerOpenChange).toHaveBeenLastCalledWith(true);

    onWebMermaidViewerOpenChange.mockClear();
    simulateUpstream(tree.root, 'mermaidViewerClosed');
    expect(onWebMermaidViewerOpenChange).toHaveBeenCalledTimes(1);
    expect(onWebMermaidViewerOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('未知 type（__nmGhostProbe）静默丢弃：零下行、零遥测、不抛错', async () => {
    const tree = await mountReady();
    const downlinkBaseline = mockWebViewPostMessages.length;
    const telemetryBaseline = telemetryMock.mock.calls.length;

    expect(() => {
      simulateUpstream(tree.root, '__nmGhostProbe', {probe: true});
    }).not.toThrow();
    expect(mockWebViewPostMessages.length).toBe(downlinkBaseline);
    expect(telemetryMock.mock.calls.length).toBe(telemetryBaseline);
  });
});

describe('ChatConversationWebView · 开屏快照与增量判路', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
    telemetryMock.mockClear();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  async function mountReady(overrides: Record<string, unknown> = {}) {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView {...baseProps(overrides)} />,
        ),
      );
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    return tree;
  }

  function telemetryEvents(name: string): Array<Record<string, unknown>> {
    return telemetryMock.mock.calls
      .map(call => call[0] as Record<string, unknown>)
      .filter(event => event?.name === name);
  }

  it('C: 开屏 restore → 末条快照带 restoreScroll，遥测 offset', async () => {
    await mountReady({
      initialScroll: {schemaVersion: 2, offsetY: 120, nearBottom: false},
      defaultScrollToBottom: false,
    });
    // pendingSubagentSessions effect 先发一轮 preserve，开屏分支后发——取末条
    const last = sentOfType('sessionSnapshot').at(-1)!;
    expect(last).toMatchObject({
      scrollIntent: 'restore',
      restoreScroll: {offsetY: 120, nearBottom: false},
    });
    expect(telemetryEvents('scroll_restore')).toContainEqual({
      name: 'scroll_restore',
      mode: 'offset',
      offsetY: 120,
      nearBottom: false,
    });
  });

  it('D: 开屏 stick → 遥测只带 stick，快照载荷没有 restoreScroll 键', async () => {
    await mountReady({
      initialScroll: {schemaVersion: 2, offsetY: 120, nearBottom: false},
    });
    expect(telemetryEvents('scroll_restore')).toEqual([
      {name: 'scroll_restore', mode: 'stick'},
    ]);
    const last = sentOfType('sessionSnapshot').at(-1)!;
    expect(last.scrollIntent).toBe('stick');
    expect(last).not.toHaveProperty('restoreScroll');
  });

  it('E: scrollSnapshot 更新的 lastScroll → prepend 遥测与 prependPage 载荷同源', async () => {
    const messages = [sampleMessage('m1', 1), sampleMessage('m2', 2)];
    const tree = await mountReady({messages});
    simulateUpstream(tree.root, 'scrollSnapshot', {
      schemaVersion: 2,
      offsetY: 77,
      nearBottom: false,
    });

    const pagesBaseline = sentOfType('prependPage').length;
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({
            messages: [sampleMessage('m0', 0), messages[0]!, messages[1]!],
          })}
        />,
      );
    });
    await flushMicrotasks();

    expect(telemetryEvents('prepend_detected')).toContainEqual({
      name: 'prepend_detected',
      prependedCount: 1,
      wasNearBottom: false,
      offsetYBefore: 77,
    });
    const pages = sentOfType('prependPage');
    expect(pages).toHaveLength(pagesBaseline + 1);
    const page = pages.at(-1)!;
    expect(page.prependedCount).toBe(1);
    const rows = page.rows as Array<{id?: string}>;
    expect(rows.map(row => row.id)).toContain('m0');
  });

  it('G: 开屏 wait-empty 守卫——空列表不发 transcript_ready，首条消息到达后恰好一次', async () => {
    const tree = await mountReady({messages: []});
    expect(telemetryEvents('transcript_ready')).toHaveLength(0);
    // ready 时 pendingSubagentSessions effect 会先发一条 0 行 preserve 快照，
    // 故这里用相对计数，不断言「零快照」
    const snapshotBaseline = sentOfType('sessionSnapshot').length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: [sampleMessage('m1', 1)]})}
        />,
      );
    });
    await flushMicrotasks();

    expect(telemetryEvents('transcript_ready')).toHaveLength(1);
    expect(sentOfType('sessionSnapshot').length).toBeGreaterThan(
      snapshotBaseline,
    );
  });

  it('H hidden-changed: 等长同首条、仅 hidden 翻转 → 新增 preserve 快照', async () => {
    const messages = [sampleMessage('m1', 1), sampleMessage('m2', 2)];
    const tree = await mountReady({messages});
    const baseline = sentOfType('sessionSnapshot').length;

    const hiddenSecond = {...messages[1]!, hidden: true};
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: [messages[0]!, hiddenSecond]})}
        />,
      );
    });
    await flushMicrotasks();

    const snapshots = sentOfType('sessionSnapshot');
    expect(snapshots).toHaveLength(baseline + 1);
    expect(snapshots.at(-1)).toMatchObject({scrollIntent: 'preserve'});
  });

  it('H append: uiRunning 追加普通消息 → appendTailRows，不发快照', async () => {
    const messages = [sampleMessage('m1', 1)];
    const tree = await mountReady({
      messages,
      agentRunning: true,
      uiRunning: true,
    });
    // uiRunning 时 ready 那轮 preserve 会先挂在 0ms 定时器上，先冲净再取基线
    await flushSnapshotChunks();
    const snapshotBaseline = sentOfType('sessionSnapshot').length;
    const appendBaseline = sentOfType('appendTailRows').length;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({
            messages: [messages[0]!, sampleMessage('m2', 2)],
            agentRunning: true,
            uiRunning: true,
          })}
        />,
      );
    });
    await flushMicrotasks();

    expect(sentOfType('sessionSnapshot')).toHaveLength(snapshotBaseline);
    const appends = sentOfType('appendTailRows');
    expect(appends).toHaveLength(appendBaseline + 1);
    const rows = appends.at(-1)!.rows as Array<{id?: string}>;
    expect(rows.map(row => row.id)).toContain('m2');
  });

  it('H force-snapshot: uiRunning 追加 tool_results-only → 全量 preserve 快照，不 append', async () => {
    const messages = [sampleMessage('m1', 1)];
    const tree = await mountReady({
      messages,
      agentRunning: true,
      uiRunning: true,
    });
    await flushSnapshotChunks();
    const snapshotBaseline = sentOfType('sessionSnapshot').length;
    const appendBaseline = sentOfType('appendTailRows').length;

    const toolResultOnly = {
      id: 'tr1',
      sessionId: 's1',
      seq: 2,
      role: 'user',
      content: {
        blocks: [{type: 'tool_result', toolUseId: 'call-1', content: 'ok'}],
      },
      provider: null,
      raw: null,
      createdAtMs: 2,
      hidden: false,
    } as unknown as ChatMessageData;

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({
            messages: [messages[0]!, toolResultOnly],
            agentRunning: true,
            uiRunning: true,
          })}
        />,
      );
    });
    await flushMicrotasks();

    expect(sentOfType('appendTailRows')).toHaveLength(appendBaseline);
    const snapshots = sentOfType('sessionSnapshot');
    expect(snapshots).toHaveLength(snapshotBaseline + 1);
    expect(snapshots.at(-1)).toMatchObject({scrollIntent: 'preserve'});
  });
});

describe('ChatConversationWebView · 快照流式片（T-SP2 / T-SP3）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
    telemetryMock.mockClear();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  function streamingMessage(
    overrides: Partial<TranscriptStreamingMessage> = {},
  ): TranscriptStreamingMessage {
    return {
      streamId: 'st:s:1:0',
      status: 'streaming',
      text: '',
      thinking: '',
      tools: [],
      messageId: null,
      ...overrides,
    };
  }

  async function mountReady(overrides: Record<string, unknown> = {}) {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView {...baseProps(overrides)} />,
        ),
      );
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    return tree;
  }

  /** 某代次的全部快照片（末片 = chunkIndex === chunkTotal - 1 的那条）。 */
  function chunksOfLastGeneration(): Array<Record<string, unknown>> {
    const snapshots = sentOfType('sessionSnapshot');
    const last = snapshots.at(-1);
    if (last == null) {
      return [];
    }
    return snapshots.filter(
      snapshot => snapshot.generation === last.generation,
    );
  }

  it('T-SP2: 有流式行时 chunkTotal=DB片+流式片，流式片只在末片、带 stream 检查点', async () => {
    const messages = [sampleMessage('m1', 1)];
    const streamingRows = [
      streamingMessage({
        streamId: 'st-s-finished',
        status: 'finished',
        text: '上一轮未接管',
      }),
      streamingMessage({
        streamId: 'st-s-current',
        status: 'streaming',
        text: '当前正文',
        thinking: '当前思考',
      }),
    ];
    await mountReady({messages, streamingRows});

    const chunks = chunksOfLastGeneration();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const last = chunks.at(-1)!;
    expect(last.chunkTotal).toBe(2);
    expect(last.chunkIndex).toBe(1);
    expect(last.stream).toEqual({
      id: 'st-s-current',
      seq: 0,
      status: 'streaming',
    });

    // DB 片只装 DB 行；流式片只装流式行（1~N 条）
    const dbChunk = chunks.find(chunk => chunk.chunkIndex === 0)!;
    expect((dbChunk.rows as Array<{id: string}>).map(row => row.id)).toEqual([
      'm1',
    ]);
    const streamRows = last.rows as Array<Record<string, unknown>>;
    expect(streamRows.map(row => row.id)).toEqual([
      'st-s-finished',
      'st-s-current',
    ]);
    expect(streamRows[0]).toMatchObject({
      kind: 'message',
      role: 'assistant',
      status: 'finished',
      text: '上一轮未接管',
      hidden: false,
    });
    expect(streamRows[0]).not.toHaveProperty('messageId');
    expect(streamRows[1]).toMatchObject({
      status: 'streaming',
      text: '当前正文',
      thinking: '当前思考',
    });
  });

  it('T-SP2: 空会话 run 也发快照——只有流式片，没有空 DB 片', async () => {
    await mountReady({
      messages: [],
      streamingRows: [streamingMessage({streamId: 'st-empty'})],
    });

    const chunks = chunksOfLastGeneration();
    expect(chunks).toHaveLength(1);
    const last = chunks[0]!;
    expect(last.chunkTotal).toBe(1);
    expect(last.chunkIndex).toBe(0);
    expect(last.scrollIntent).toBe('stick');
    expect(last.stream).toEqual({
      id: 'st-empty',
      seq: 0,
      status: 'streaming',
    });
    const rows = last.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id: 'st-empty', status: 'streaming'});
  });

  it('T-SP2: 无流式行时不发空流式片（退回原分片语义、无 stream 字段）', async () => {
    await mountReady({messages: [sampleMessage('m1', 1)]});

    const chunks = chunksOfLastGeneration();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkTotal).toBe(1);
    expect(chunks[0]).not.toHaveProperty('stream');
    expect((chunks[0]!.rows as Array<{id: string}>).map(row => row.id)).toEqual(
      ['m1'],
    );
  });

  it('T-SP2: 流式行按 256KB 预算单独分桶（超预算拆多片，DB 行不进该片）', async () => {
    const big = 'x'.repeat(200 * 1024);
    await mountReady({
      messages: [],
      streamingRows: [
        streamingMessage({streamId: 'st-big-1', status: 'finished', text: big}),
        streamingMessage({streamId: 'st-big-2', text: big}),
      ],
    });

    const chunks = chunksOfLastGeneration();
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.chunkTotal).toBe(2);
    expect((chunks[0]!.rows as Array<{id: string}>).map(row => row.id)).toEqual(
      ['st-big-1'],
    );
    expect((chunks[1]!.rows as Array<{id: string}>).map(row => row.id)).toEqual(
      ['st-big-2'],
    );
    expect(chunks[1]!.stream).toEqual({
      id: 'st-big-2',
      seq: 0,
      status: 'streaming',
    });
  });

  it('T-SP3: richText 下流式行 text/thinking/tools 完整、html 为全量文本', async () => {
    await mountReady({
      flags: {richText: true},
      messages: [],
      streamingRows: [
        streamingMessage({
          streamId: 'st-rich',
          text: '第一段\n\n第二段',
          thinking: '思考段落',
          tools: [
            {
              toolUseId: 't1',
              name: 'read',
              input: {path: 'a.md'},
              status: 'pending',
            },
          ],
        }),
      ],
    });

    const last = chunksOfLastGeneration().at(-1)!;
    const row = (last.rows as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({
      id: 'st-rich',
      status: 'streaming',
      text: '第一段\n\n第二段',
      thinking: '思考段落',
    });
    expect(String(row.textHtml)).toContain('第一段');
    expect(String(row.textHtml)).toContain('第二段');
    expect(String(row.thinkingHtml)).toContain('思考段落');
    expect(row.tools).toEqual([
      {
        toolUseId: 't1',
        name: 'read',
        input: {path: 'a.md'},
        status: 'pending',
      },
    ]);
  });

  it('T-SP3/接管映射: DB 快照行 id 改写为 streamId 并补 messageId/status', async () => {
    const assistant = {
      ...sampleMessage('db-a1', 1),
      role: 'assistant',
      content: {blocks: [{type: 'text', text: '落库正文'}]},
    } as ChatMessageData;
    await mountReady({
      messages: [assistant],
      streamRowIds: new Map([['db-a1', 'st-s-adopted']]),
    });

    const chunks = chunksOfLastGeneration();
    expect(chunks).toHaveLength(1);
    const rows = chunks[0]!.rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      kind: 'message',
      id: 'st-s-adopted',
      messageId: 'db-a1',
      status: 'finished',
      text: '落库正文',
    });
  });
});

/* ================================================================== *
 * 中断 partial（chat-streaming-projection Step 8 · T-SP19）
 *
 * interrupted 水合单元的 partial 由单元 `streamRows` 投影为一条 finished
 * 流式行（spec §2.1.2 规则 3），宿主只把它随普通快照/streamStatus 下发。
 * 旧的 `commitSyntheticAssistantRow` 合成提交通道已随 C7 删除——这里同时
 * 钉住句柄面只剩三命令，以及 rollback reset 的代次作废语义。
 * ================================================================== */

describe('ChatConversationWebView · 中断 partial 流式行（T-SP19）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    jest.useRealTimers();
    releaseChunkGate();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  const INTERRUPTED_STREAM_ID = 'st:s1:interrupted:4000';

  function interruptedRow(
    overrides: Partial<TranscriptStreamingMessage> = {},
  ): TranscriptStreamingMessage {
    return {
      streamId: INTERRUPTED_STREAM_ID,
      status: 'finished',
      text: '中断正文',
      thinking: '中断思考',
      tools: [],
      messageId: null,
      ...overrides,
    };
  }

  async function mountReadyWithRef(
    ref: React.RefObject<ChatConversationWebViewHandle | null>,
    overrides: Record<string, unknown> = {},
  ): Promise<TestRenderer.ReactTestRenderer> {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView ref={ref} {...baseProps(overrides)} />,
        ),
      );
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    return tree;
  }

  /** 末代次的全部快照片。 */
  function lastGenerationChunks(): Array<Record<string, unknown>> {
    const snapshots = sentOfType('sessionSnapshot');
    const last = snapshots.at(-1);
    if (last == null) {
      return [];
    }
    return snapshots.filter(
      snapshot => snapshot.generation === last.generation,
    );
  }

  function lastGenerationRowIds(): string[] {
    return lastGenerationChunks().flatMap(chunk =>
      (chunk.rows as Array<{id: string}>).map(row => row.id),
    );
  }

  it('T-SP19: interrupted partial → 快照含 finished 流式行；句柄无合成提交通道', async () => {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    await mountReadyWithRef(ref, {
      messages: [sampleMessage('m1', 1)],
      streamingRows: [interruptedRow()],
    });

    const chunks = lastGenerationChunks();
    const streamChunk = chunks.find(chunk =>
      (chunk.rows as Array<{id: string}>).some(
        row => row.id === INTERRUPTED_STREAM_ID,
      ),
    );
    expect(streamChunk).toBeDefined();
    const row = (streamChunk!.rows as Array<Record<string, unknown>>).find(
      candidate => candidate.id === INTERRUPTED_STREAM_ID,
    );
    expect(row).toMatchObject({
      kind: 'message',
      role: 'assistant',
      status: 'finished',
      text: '中断正文',
      thinking: '中断思考',
      hidden: false,
    });
    expect(row).not.toHaveProperty('messageId');
    expect(streamChunk!.stream).toEqual({
      id: INTERRUPTED_STREAM_ID,
      seq: 0,
      status: 'finished',
    });

    // 终态只由快照承载（不发 streamStatus）；句柄面 = 三命令，合成提交已删除。
    expect(sentOfType('streamStatus')).toHaveLength(0);
    expect(ref.current).not.toHaveProperty('commitSyntheticAssistantRow');
    expect(ref.current).not.toHaveProperty('commitAbortOverlaySnapshot');
    expect(ref.current).not.toHaveProperty('tryCommitStreamTail');
    expect(Object.keys(ref.current!).sort()).toEqual([
      'forceSnapshot',
      'pushStream',
      'resetStream',
    ]);
  });

  it('T-SP19: 新基线（webview 重挂）→ interrupted 行随快照重新出现', async () => {
    const props = {
      messages: [sampleMessage('m1', 1)],
      streamingRows: [interruptedRow()],
    };
    const firstRef = React.createRef<ChatConversationWebViewHandle>();
    let first!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      first = TestRenderer.create(
        <ChatConversationWebView ref={firstRef} {...baseProps(props)} />,
      );
    });
    simulateReadyV2(first.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    expect(lastGenerationRowIds()).toContain(INTERRUPTED_STREAM_ID);
    await act(async () => {
      first.unmount();
    });

    // 新基线（同 props 的全新实例）：不需要任何命令式补交，快照本身就带行。
    clearMockWebViewPostMessages();
    const secondRef = React.createRef<ChatConversationWebViewHandle>();
    await mountReadyWithRef(secondRef, props);
    expect(lastGenerationRowIds()).toContain(INTERRUPTED_STREAM_ID);
  });

  it('T-SP19: rollback reset 与分片快照同拍 → 在途旧代次作废、新基线不含 partial 行', async () => {
    const messages = Array.from({length: 120}, (_, index) =>
      sampleMessage(`m${index}`, index + 1),
    );
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(
          <ChatConversationWebView
            ref={ref}
            {...baseProps({messages, streamingRows: [interruptedRow()]})}
          />,
        ),
      );
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();
    expect(lastGenerationRowIds()).toContain(INTERRUPTED_STREAM_ID);

    // 关闸起一轮在途快照：首片过桥，余片（含带 partial 行的流式末片）挂起。
    closeChunkGate();
    await act(async () => {
      ref.current!.forceSnapshot();
    });
    const gatedGeneration = sentOfType('sessionSnapshot').at(-1)!
      .generation as number;
    const gatedChunks = sentOfType('sessionSnapshot').filter(
      payload => (payload.generation as number) === gatedGeneration,
    );
    expect(gatedChunks).toHaveLength(1);
    expect(gatedChunks[0]!.chunkTotal).toBe(4); // 3 个 DB 片 + 1 个流式片

    // rollback/fork：manager 先 clearStreamProjection → adapter 调 resetStream；
    // Provider 下一拍把 streamingRows 换成空数组。
    await act(async () => {
      ref.current!.resetStream([INTERRUPTED_STREAM_ID]);
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages, streamingRows: []})}
        />,
      );
    });
    const resetPayload = sentOfType('streamReset').at(-1)!;
    expect(resetPayload.streamIds).toEqual([INTERRUPTED_STREAM_ID]);
    // reset 的代次必须高于在途快照：Web 据此丢弃旧代次余片（含末片）。
    expect(resetPayload.generation as number).toBeGreaterThan(gatedGeneration);

    releaseChunkGate();
    await flushSnapshotChunks();
    // 旧代次补发的片仍带旧 generation——宿主不重编号，作废由 Web 的 applied
    // generation 完成（旧末片不会整体替换 rows）。
    const staleChunks = sentOfType('sessionSnapshot').filter(
      payload => (payload.generation as number) === gatedGeneration,
    );
    expect(staleChunks.length).toBeGreaterThan(gatedChunks.length);

    // reset 之后的应用基线：新代次、不含 partial 行、也没有流式检查点。
    ref.current!.forceSnapshot();
    await flushSnapshotChunks();
    const applied = sentOfType('sessionSnapshot').filter(
      payload =>
        (payload.generation as number) > (resetPayload.generation as number),
    );
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.at(-1)!.stream).toBeUndefined();
    for (const payload of applied) {
      expect(
        (payload.rows as Array<{id: string}>).map(row => row.id),
      ).not.toContain(INTERRUPTED_STREAM_ID);
    }
  });
});
