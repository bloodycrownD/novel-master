/**
 * 统一宿主 `ChatConversationWebView` 行为测试（chat-webview-unify Step 6）。
 *
 * mock 手法照 `chat-transcript-webview.test.tsx`（同一套 webview mock / yield-quantum
 * mock / sanitize-html mock），断言面按 spec 的 T-CU 族挑与**本组件新引入**的部分：
 * - ready 的 v 判定（v:2 才置 webReady；v:1 ready 被拒 → 走 8s 超时兜底错误态）；
 * - ready → 下行四消息恢复链固定顺序（init → composerState → 草稿 setText → 快照直发）；
 * - 划词三项菜单回调（复制 nbsp 清洗 / 全选下行 / 粘贴读剪贴板后下行）；
 * - composer 域**直发不进 deferred**（分片在途时仍即时生效，T-CU7）；
 * - IME 防线 M1（打字回声不触发外部写入）与 M6（change 只上抛不回写）；
 * - 8s 超时兜底（假时钟；每次 onLoad / 重挂重新计时）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AppState, Linking, Platform, Text} from 'react-native';
import {type ChatMessage} from '@novel-master/core/chat';
import {CONVERSATION_BRIDGE_V} from '@/components/chat/ChatConversationBridge';
import {
  ChatConversationWebView,
  type ChatConversationWebViewHandle,
} from '@/components/chat/ChatConversationWebView';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';
import {CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS} from '@/components/chat/chat-transcript-selection-menu';

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

// 现代 dist 的能力全集（transcript 共享常量 + composer-dock）。
const MODERN_CAPABILITIES = ['streamBlockCommit', 'composer-dock'];

function sampleMessage(id: string, seq: number): ChatMessage {
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

function firstIndexOfType(type: string, since = 0): number {
  return sentMessages(since).findIndex(m => m.type === type);
}

/** 某一 type 的全部下行载荷（init / composerState / setText / 快照断言面）。 */
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
    {version: 'u1', capabilities: [...capabilities], readyState: 'complete'},
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
    streamingText: '',
    streamingThinking: '',
    composerText: '',
    composerHasModel: true,
    composerPlaceholder: '输入消息…',
    ...overrides,
  };
}

const ClipboardMock = require('@react-native-clipboard/clipboard').default as {
  setString: jest.Mock;
  getString: jest.Mock;
};

/** 遥测 mock：本文件已整体 mock 掉 chat-transcript-telemetry（见顶部 jest.mock）。 */
const telemetryMock =
  require('@/services/chat-transcript-telemetry')
    .emitChatTranscriptTelemetry as jest.Mock;

/** 取出全部 `composer_dock_degraded` 事件（r6-I-1 断言用）。 */
function degradedEvents(): unknown[] {
  return telemetryMock.mock.calls
    .map(call => (call as [{name?: string}][])[0])
    .filter(event => event?.name === 'composer_dock_degraded');
}

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
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
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

  it('T-CU8a: ready → 下行四消息恢复链固定顺序 init → composerState → setText → 快照', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({composerText: '草稿文本'})}
        />,
      ));
    });
    simulateLoad(tree!.root);
    simulateReadyV2(tree!.root);
    await flushMicrotasks();

    const types = sentTypes();
    const initIdx = types.indexOf('init');
    const stateIdx = types.indexOf('composerState');
    const setTextIdx = firstIndexOfType('setText');
    const snapshotIdx = types.indexOf('sessionSnapshot');

    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(stateIdx).toBeGreaterThan(initIdx);
    expect(setTextIdx).toBeGreaterThan(stateIdx);
    expect(snapshotIdx).toBeGreaterThan(setTextIdx);
  });

  it('恢复链载荷：init 聚合 theme+flags+composer 三段；草稿 setText 带原文', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({composerText: '水化草稿'})}
          safeAreaBottom={24}
        />,
      ));
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
    // 主题 9 键（transcript 7 ∪ composer 6 去重）
    expect(Object.keys(init!.payload.theme as object)).toHaveLength(9);
    expect(init?.payload.flags).toMatchObject({menuDisabled: false});
    expect(init?.payload.composer).toMatchObject({
      mode: 'composer-token',
      safeAreaBottom: 24,
      metrics: {fontSize: 16, lineHeight: 22, minHeight: 56, maxHeight: 122},
    });

    const setText = sent.find(m => m.type === 'setText');
    expect(setText?.payload.text).toBe('水化草稿');
  });

  it('composerState 全字段下发，typeahead 必达（定案 ①：不下 undefined）', async () => {
    const typeahead = {files: [], skills: []};
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({
            composerInputDisabled: true,
            composerHasModel: false,
            composerSendDisabled: true,
            composerRunning: true,
            composerError: 'boom',
            composerFullscreenEnabled: true,
            composerPlaceholder: '占位',
            composerKeyboardUp: true,
            composerTypeahead: typeahead,
          })}
        />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();

    const state = sentMessages().find(m => m.type === 'composerState');
    expect(state?.payload).toEqual({
      inputDisabled: true,
      hasModel: false,
      sendDisabled: true,
      running: true,
      error: 'boom',
      fullscreenEnabled: true,
      placeholder: '占位',
      chips: [],
      keyboardUp: true,
      typeahead,
    });
  });

  it('T-CU7: 快照分片在途期间 composer 域仍直发（不进 deferred 队列）', async () => {
    // 120 条 → 3 片；关闸后余片永远挂着，「在途」这个前提由测试自己掌控
    const initialMessages = Array.from({length: 120}, (_, i) =>
      sampleMessage(`u-${i + 1}`, i + 1),
    );
    closeChunkGate();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({messages: initialMessages, composerText: ''})}
        />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    const posted = sentTypes().filter(t => t === 'sessionSnapshot').length;
    expect(posted).toBeGreaterThanOrEqual(1);
    expect(posted).toBeLessThan(3);
    const baseline = mockWebViewPostMessages.length;

    // 窗口内草稿变化：setText 必须**立刻**到达，不等末片
    await act(async () => {
      tree!.update(
        <ChatConversationWebView
          {...baseProps({
            messages: initialMessages,
            composerText: '正在打字',
          })}
        />,
      );
    });
    expect(sentTypes(baseline)).toContain('setText');

    // 余片随后补齐，且排在 setText 之后 —— 证明 setText 走的是直发而非队列
    await act(async () => {
      releaseChunkGate();
      await Promise.resolve();
    });
    await flushSnapshotChunks();
    const after = sentMessages(baseline);
    const setTextIdx = after.findIndex(m => m.type === 'setText');
    const snapshotIdx = after.findIndex(m => m.type === 'sessionSnapshot');
    expect(setTextIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeGreaterThan(setTextIdx);
    releaseChunkGate();
  });

  it('dockAction 上行按枚举白名单处置；枚举外静默丢弃', async () => {
    const onDockAction = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({onDockAction})}
        />,
      ));
    });
    simulateReadyV2(tree!.root);

    simulateUpstream(
      tree!.root,
      'dockAction',
      {action: 'needModel'},
      CONVERSATION_BRIDGE_V,
    );
    expect(onDockAction).toHaveBeenCalledWith('needModel');

    simulateUpstream(
      tree!.root,
      'dockAction',
      {action: '__evil__'},
      CONVERSATION_BRIDGE_V,
    );
    expect(onDockAction).toHaveBeenCalledTimes(1);
  });

  it('未声明 composer-dock → 输入区降级提示（非静默不可点）', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });
    simulateReadyV2(tree!.root, ['streamBlockCommit']);
    await flushMicrotasks();

    expect(tree!.root.findAllByProps({testID: 'chat-conversation-dock-degraded'}).length)
      .toBeGreaterThan(0);
    // 未声明即降级：dock 域消息不下发
    expect(sentTypes()).not.toContain('composerState');
  });

  it('r6-I-1: ready 不带 composer-dock 能力位 → 上报一次 composer_dock_degraded', async () => {
    telemetryMock.mockClear();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });

    // 带全能力位：降级事件**一次都不许打**（变异点：去掉 !composerDockCapable 判空
    // 条件会在这里变红）
    simulateReadyV2(tree!.root, MODERN_CAPABILITIES);
    await flushMicrotasks();
    expect(degradedEvents()).toHaveLength(0);

    // 只带 transcript 能力位、缺 dock：报一次，带能力位条数
    telemetryMock.mockClear();
    simulateReadyV2(tree!.root, ['streamBlockCommit']);
    await flushMicrotasks();
    const events = degradedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({name: 'composer_dock_degraded'});
    expect((events[0] as {capabilityCount?: number}).capabilityCount).toBe(1);
  });

  it('T-CU15: onLoad 后 8s 未收到 v2 ready → 错误态 + 重载提示（假时钟）', async () => {
    jest.useFakeTimers();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
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
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}).length,
    ).toBeGreaterThan(0);
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-retry'}).length,
    ).toBeGreaterThan(0);
  });

  it('T-CU15: 收到 v2 ready 取消超时；每次 onLoad 重新计时', async () => {
    jest.useFakeTimers();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
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
      tree = track(TestRenderer.create(
        <ChatConversationWebView key="p1:s1" {...baseProps({onReady})} />,
      ));
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
      tree = track(TestRenderer.create(
        <ChatConversationWebView key="p1:s1" {...baseProps({onReady})} />,
      ));
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
    const calls = (AppState.addEventListener as unknown as jest.Mock).mock.calls;
    const listener = [...calls].reverse().find(([event]) => event === 'change')?.[1];
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
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
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

  it('栈内被盖（hidden 时 app 仍前台）→ 恢复可见不重挂：被盖期间的改画推送不算脏', async () => {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(
        TestRenderer.create(<ChatConversationWebView ref={ref} {...baseProps()} />),
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
    ref.current?.pushStreamDelta('text', '被盖期间的后台流式推送');
    await flushAnimationFrame();

    // 恢复可见：不得重挂（重挂会清 webReady、后续一切下行被 postToWeb 早退，
    // dev 包下还要重跑 8s 握手赛跑落「对话页加载失败」错误页——2026-10-05
    // 真机实锤）。
    await act(async () => {
      simulateUpstream(tree.root, 'visibility', {hidden: false});
    });
    await flushMicrotasks();
    expect(sentOfType('init')).toHaveLength(initCount);

    // webReady 未被清：恢复可见后的新推送必须照常发出（若被误重挂，
    // postToWeb 早退、基线不增——以「增量 = 1」为牙口，被盖期间已发的那条
    // 不计入）。
    const deltaBaseline = sentOfType('streamDelta').length;
    ref.current?.pushStreamDelta('text', '恢复后的推送');
    await flushAnimationFrame();
    expect(sentOfType('streamDelta').length).toBe(deltaBaseline + 1);
    // streamDelta 载荷是 {kind, delta, html}（不带 sessionKey——会话身份靠
    // key 重挂归零，delta 本身只管增量正文）
    expect(sentOfType('streamDelta').at(-1)).toMatchObject({
      kind: 'text',
      delta: '恢复后的推送',
    });
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

describe('ChatConversationWebView · 划词三项菜单', () => {
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
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps(overrides)} />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    return tree!;
  }

  it('menuItems 为三项（复制/全选/粘贴）', async () => {
    const tree = await mountReady();
    expect(webViewOf(tree.root).props.menuItems).toEqual([
      {label: '复制', key: 'copy'},
      {label: '全选', key: 'selectAll'},
      {label: '粘贴', key: 'paste'},
    ]);
  });

  it('复制走现行清洗链：nbsp→空格 + trim', async () => {
    const tree = await mountReady();
    act(() => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'copy', selectedText: '  a b  '},
      });
    });
    expect(ClipboardMock.setString).toHaveBeenCalledWith('a b');
  });

  it('全选：下行 dock 域 selectAll（直发）', async () => {
    const tree = await mountReady();
    const baseline = mockWebViewPostMessages.length;
    act(() => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'selectAll', selectedText: 'x'},
      });
    });
    const sent = sentMessages(baseline);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('selectAll');
    expect(sent[0]!.v).toBe(CONVERSATION_BRIDGE_V);
  });

  it('粘贴：RN 读剪贴板 → 下行 composerPaste（web 侧不读剪贴板）', async () => {
    const tree = await mountReady();
    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'paste', selectedText: 'ignored'},
      });
    });
    expect(ClipboardMock.getString).toHaveBeenCalled();
    const paste = sentMessages(baseline).find(m => m.type === 'composerPaste');
    expect(paste?.payload.text).toBe('clipboard-text');
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

  it('r6-D-1: 运行中禁粘贴——连剪贴板都不读，且不下行 composerPaste', async () => {
    const tree = await mountReady({uiRunning: true, agentRunning: true});
    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      webViewOf(tree.root).props.onCustomMenuSelection?.({
        nativeEvent: {key: 'paste', selectedText: 'ignored'},
      });
    });
    // 闸门在读剪贴板之前：不读，就不会把禁用输入框的文本灌进去
    expect(ClipboardMock.getString).not.toHaveBeenCalled();
    expect(sentTypes(baseline)).not.toContain('composerPaste');
  });

  it('r6-I-2: 剪贴板读失败 → 打 warn 且绝不下行 composerPaste', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    ClipboardMock.getString.mockRejectedValueOnce(new Error('denied'));
    const tree = await mountReady();
    const baseline = mockWebViewPostMessages.length;
    try {
      await act(async () => {
        webViewOf(tree.root).props.onCustomMenuSelection?.({
          nativeEvent: {key: 'paste', selectedText: 'ignored'},
        });
      });
      expect(warnSpy).toHaveBeenCalledWith(
        '[chat] composerPaste clipboard read failed',
      );
      // 失败与「剪贴板确实是空的」用户侧表现相同，日志不打内容
      expect(
        warnSpy.mock.calls.some(call =>
          String(call[0] ?? '').includes('denied'),
        ),
      ).toBe(false);
      expect(sentTypes(baseline)).not.toContain('composerPaste');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('r6-I-2: 剪贴板空串 → 打 warn 且不下行', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    ClipboardMock.getString.mockResolvedValueOnce('');
    const tree = await mountReady();
    const baseline = mockWebViewPostMessages.length;
    try {
      await act(async () => {
        webViewOf(tree.root).props.onCustomMenuSelection?.({
          nativeEvent: {key: 'paste', selectedText: 'ignored'},
        });
      });
      expect(warnSpy).toHaveBeenCalledWith(
        '[chat] composerPaste clipboard empty',
      );
      expect(sentTypes(baseline)).not.toContain('composerPaste');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('r6-I-2: 剪贴板超 256KB → 截断下行 + 打点（不全量跨桥）', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const huge = 'a'.repeat(300 * 1024);
    ClipboardMock.getString.mockResolvedValueOnce(huge);
    const tree = await mountReady();
    const baseline = mockWebViewPostMessages.length;
    try {
      await act(async () => {
        webViewOf(tree.root).props.onCustomMenuSelection?.({
          nativeEvent: {key: 'paste', selectedText: 'ignored'},
        });
      });
      const paste = sentMessages(baseline).find(m => m.type === 'composerPaste');
      expect((paste?.payload.text as string).length).toBe(256 * 1024);
      expect(warnSpy).toHaveBeenCalledWith(
        `[chat] composerPaste truncated ${huge.length} -> ${256 * 1024}`,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('ChatConversationWebView · IME 防线', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  it('M1/M6: web change 先推进基线再上抛，父层原样回写不触发 setText 回声', async () => {
    const onChange = jest.fn();
    const typeaheadRef = {files: [], skills: []};
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({onComposerChangeText: onChange})}
        />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    const baseline = mockWebViewPostMessages.length;

    // web 侧打字：change 上行
    simulateUpstream(tree!.root, 'change', {text: '你'});
    expect(onChange).toHaveBeenCalledWith('你');
    // M6：change 只上抛，绝不回写 setText
    expect(sentMessages(baseline).map(m => m.type)).not.toContain('setText');

    // 父层把同一文本原样写回 composerText —— M1 早退，不发 setText、不摆选区
    await act(async () => {
      tree!.update(
        <ChatConversationWebView
          {...baseProps({
            composerText: '你',
            onComposerChangeText: onChange,
            composerTypeahead: typeaheadRef,
          })}
        />,
      );
    });
    expect(sentTypes(baseline)).not.toContain('setText');
  });

  it('M2: 外部文本真变 → 下发 setText 且作废选区基线（随后必然放行一次 setSelection）', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({composerCursor: 0})} />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatConversationWebView
          {...baseProps({composerText: '外部水化', composerCursor: 0})}
        />,
      );
    });

    const sent = sentMessages(baseline);
    const setTextIdx = sent.findIndex(m => m.type === 'setText');
    const selectionIdx = sent.findIndex(m => m.type === 'setSelection');
    expect(setTextIdx).toBeGreaterThanOrEqual(0);
    expect(selectionIdx).toBeGreaterThan(setTextIdx);
    expect(sent[selectionIdx]!.payload).toEqual({start: 0, end: 0});
  });

  it('M4: setSelection 回声抑制——web 刚上报的同值不再下发', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();

    const baseline = mockWebViewPostMessages.length;
    simulateUpstream(tree!.root, 'selectionChange', {start: 3, end: 3});
    await flushMicrotasks();
    expect(sentTypes(baseline)).not.toContain('setSelection');
  });

  it('M5: 外部写入的短暂受控光标，web 上报用户选区即解除', async () => {
    const onSelection = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({onComposerSelectionChange: onSelection})}
        />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();

    await act(async () => {
      tree!.update(
        <ChatConversationWebView
          {...baseProps({
            composerText: '插入 token',
            composerCursor: 4,
            onComposerSelectionChange: onSelection,
          })}
        />,
      );
    });
    expect(onSelection).toHaveBeenCalledWith({start: 4, end: 4});

    // 用户手动改选区 → 短暂受控解除
    const baseline = mockWebViewPostMessages.length;
    simulateUpstream(tree!.root, 'selectionChange', {start: 9, end: 9});
    await flushMicrotasks();
    expect(sentTypes(baseline)).not.toContain('setSelection');
  });

  it('M7: 命令式 setComposerText 带选区、不再补发同值 setSelection（与 M2 相反）', async () => {
    const onChange = jest.fn();
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({onComposerChangeText: onChange})}
        />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      ref.current?.setComposerText('@src/a.ts ', 9);
    });

    const sent = sentMessages(baseline);
    const setText = sent.find(m => m.type === 'setText');
    expect(setText?.payload).toEqual({
      text: '@src/a.ts ',
      selectionStart: 9,
      selectionEnd: 9,
    });
    // 选区已由 setText 一次落位：不补发同值 setSelection
    expect(sent.filter(m => m.type === 'setSelection')).toHaveLength(0);
    expect(onChange).toHaveBeenCalledWith('@src/a.ts ');
  });

  it('安全守卫：只放行新包目录内的 file:// 加载', async () => {
    // Linking.openURL 在 RN Jest 环境返回 undefined（无 Promise），补一个可链式 stub
    const openUrl = jest
      .spyOn(Linking, 'openURL')
      .mockImplementation(async () => true as never);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });
    const guard = webViewOf(tree.root).props
      .onShouldStartLoadWithRequest as (req: {url: string}) => boolean;
    expect(guard({url: 'file:///android_asset/webview/chat-conversation/index.html'})).toBe(
      true,
    );
    expect(guard({url: 'file:///android_asset/webview/chat-transcript/index.html'})).toBe(
      false,
    );
    expect(guard({url: 'https://evil.example.com'})).toBe(false);
    // http/https 外跳系统浏览器、绝不回退页内导航
    expect(openUrl).toHaveBeenCalledWith('https://evil.example.com');
    expect(guard({url: 'javascript:alert(1)'})).toBe(false);
    openUrl.mockRestore();
  });

  it('加载源为 chat-conversation 包 URI', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });
    expect(webViewOf(tree.root).props.source).toEqual({
      uri: 'file:///android_asset/webview/chat-conversation/index.html',
    });
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
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps(overrides)} />,
      ));
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
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({messages, transcriptOnly: true})}
        />,
      ));
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

  it('menuItems 退回仅复制（1 项）；完整形态仍是 3 项', async () => {
    const variant = await mountReady({transcriptOnly: true});
    const variantItems = webViewOf(variant.root).props.menuItems;
    expect(variantItems).toHaveLength(1);
    expect(variantItems).toEqual([...CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS]);

    clearMockWebViewPostMessages();
    const full = await mountReady();
    expect(webViewOf(full.root).props.menuItems).toHaveLength(3);
  });

  it('降级横幅豁免：变体永不判降级（本就无 dock）；缺省形态照旧判', async () => {
    // 走「ready 不带 composer-dock 能力位」路径（同 r6-I-1 用例的 mock 手法）：
    // 该变体本就无 dock，能力位缺失是预期形态，不该报「输入组件版本过低」。
    const noDock: readonly string[] = ['streamBlockCommit'];
    const variant = await mountReady({transcriptOnly: true}, noDock);
    expect(
      variant.root.findAllByProps({testID: 'chat-conversation-dock-degraded'}),
    ).toHaveLength(0);

    clearMockWebViewPostMessages();
    const full = await mountReady({}, noDock);
    expect(
      full.root.findAllByProps({testID: 'chat-conversation-dock-degraded'}).length,
    ).toBeGreaterThan(0);
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
  function bigMessages(): ChatMessage[] {
    return Array.from({length: 120}, (_, i) => sampleMessage(`m${i}`, i + 1));
  }

  it('切会话（key 重挂）：在途余片随旧实例销毁不再过桥，新实例只发自己那一轮全量', async () => {
    // 回滚后切会话 = key 变化 = 旧 WebView 整棵销毁：分片循环连同让步闸一起
    // 消失，余片醒来时宿主已不在——「中止」不再需要显式的代次顶替逻辑。
    const msgs = bigMessages();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView key="p1:s1" {...baseProps({messages: msgs})} />,
      ));
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
 * 流式命令式 API（transcript-converge 收尾补入）
 *
 * 旧 `ChatTranscriptWebView` 套件随宿主退役而删除，但它 40 条用例里的
 * **流式半**（pushStreamDelta / pushStreamBatch / streamBlockCommit /
 * appendTailRows vs sessionSnapshot 的判路）在统一宿主套件里没有等价面——
 * 上面几组只覆盖 ready/IME/列表域/切会话。这里把其中判路价值最高的几条
 * 语义按统一宿主的形态补进来，其余随旧组件消亡（详见交付报告）。
 * ================================================================== */

describe('ChatConversationWebView · 流式命令式 API 与块提交判路', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    releaseChunkGate();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  /** richText 开启 + ready 就绪，返回一个可命令式推流的 ref。 */
  async function mountStreaming(overrides: Record<string, unknown> = {}) {
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({flags: {richText: true}, ...overrides})}
        />,
      ));
    });
    simulateLoad(tree!.root);
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    return {ref, tree: tree!};
  }

  it('C1: 流式 props 变化只发 streamDelta，不发 sessionSnapshot', async () => {
    const msgs = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentTypes()).toContain('sessionSnapshot');

    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: msgs, streamingText: 'hello'})}
        />,
      );
    });
    await flushAnimationFrame();
    const after = sentTypes(baseline);
    expect(after).not.toContain('sessionSnapshot');
    expect(after).toContain('streamDelta');
  });

  it('T-N6/B-2: ready 声明 streamBlockCommit → 空行分段触发块提交（delta 只含尾块）', async () => {
    // 块级渲染开启（ready 带 streamBlockCommit 能力位）：`para one\n\npara two`
    // 切出完成块「para one」，delta 的 html 只剩活跃尾块「para two」。
    const {ref} = await mountStreaming();
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      ref.current?.pushStreamDelta('text', 'para one\n\npara two');
    });
    await flushAnimationFrame();

    const sent = sentMessages(baseline);
    const commit = sent.find(m => m.type === 'streamBlockCommit');
    expect(commit).toBeDefined();
    expect(commit!.payload.text).toContain('para one');
    const delta = sent.find(
      m => m.type === 'streamDelta' && m.payload.kind === 'text',
    );
    const deltaHtml = String(delta?.payload.html ?? '');
    // 已提交块不得再出现在 delta 的累积 html 里（否则 web 侧重复渲染）
    expect(deltaHtml).not.toContain('para one');
    expect(deltaHtml).toContain('para two');
  });

  it('B-2 反面: ready 未声明 streamBlockCommit → 不发块提交，delta html 退回全量累积', async () => {
    // 旧 dist 场景：ready 不带能力位。修复前 RN 按硬编码开关照发
    // streamBlockCommit，旧 dist 静默丢弃 → 流中只剩尾块；修复后整体退回
    // 全量路径（html 为全量累积渲染，webview 整段替换语义）。
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({flags: {richText: true}})}
        />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root, []);
    await flushMicrotasks();

    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      ref.current?.pushStreamDelta('text', 'para one\n\npara two');
    });
    await flushAnimationFrame();

    const sent = sentMessages(baseline);
    expect(sent.filter(m => m.type === 'streamBlockCommit')).toHaveLength(0);
    const delta = sent.find(
      m => m.type === 'streamDelta' && m.payload.kind === 'text',
    );
    const deltaHtml = String(delta?.payload.html ?? '');
    expect(deltaHtml).toContain('para one');
    expect(deltaHtml).toContain('para two');
  });

  it('B-3: 同一 RAF 内先 batch 后 delta——块切分与尾块按线上到达序累积', async () => {
    // batch 只在 RAF 内累加、delta 入队即累加：若不按到达序 flush，同一 RAF 内
    // 先 batch 后 delta 会把累积顺序倒置成「delta + batch」，块边界随之错位。
    const {ref} = await mountStreaming();
    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      ref.current?.pushStreamBatch({
        segments: [{kind: 'text', delta: '块一\n\n'}],
      });
      ref.current?.pushStreamDelta('text', '尾二');
    });
    await flushAnimationFrame();

    const sent = sentMessages(baseline);
    const commit = sent.find(m => m.type === 'streamBlockCommit');
    expect(commit).toBeDefined();
    // batch 先到：「块一」是完成块；delta 后到：「尾二」留在活跃尾块
    expect(commit!.payload.text).toContain('块一');
    expect(commit!.payload.tailText).toContain('尾二');
  });

  it('T-W1: tool_use 存在时新落库的行走全量 sessionSnapshot（配对上下文不能靠追加）', async () => {
    // 已有 tool_use 行的会话里再落一条 user 行：web 侧需要把它与 tool 行的
    // 配对上下文一起重渲，追加增量做不到 → 主快照 effect 走全量。
    const toolUse = {
      id: 'tu1',
      sessionId: 's1',
      seq: 1,
      role: 'assistant',
      content: {
        blocks: [
          {type: 'tool_use', id: 'call-1', name: 'read', input: {path: 'a.ts'}},
        ],
      },
      provider: null,
      raw: null,
      createdAtMs: 1,
      hidden: false,
    } as unknown as ChatMessage;

    const msgs = [toolUse];
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    const baseline = mockWebViewPostMessages.length;

    // 追加一条新消息（数组引用变化）→ 必须重发全量快照
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: [...msgs, sampleMessage('u1', 2)]})}
        />,
      );
    });
    await flushMicrotasks();
    expect(sentTypes(baseline)).toContain('sessionSnapshot');
  });

  it('T-W3: streamCommit 后 messages 更新不再重复 sessionSnapshot', async () => {
    // streamCommit 已把行同步给 web 侧，随后的 messages 落库不该再发一份
    // 全量快照（否则整屏重渲一次流式增量白做）。
    // 关键前提是「流式活跃」：uiRunning/agentRunning 在推流期间为真，
    // 落库更新撞上 needsFullSnapshot 分流时被 streamActive 拦下走 deferred。
    const initialMessages = [sampleMessage('u1', 1)];
    const assistant = {
      ...sampleMessage('a1', 2),
      role: 'assistant',
      content: {blocks: [{type: 'text', text: 'stream done'}]},
    } as ChatMessage;
    let tree: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<ChatConversationWebViewHandle>();
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages: initialMessages, agentRunning: true, uiRunning: true})}
        />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    await flushSnapshotChunks();

    await act(async () => {
      ref.current?.pushStreamDelta('text', 'stream done');
    });
    await flushAnimationFrame();

    const baseline = mockWebViewPostMessages.length;
    const committed = ref.current?.tryCommitStreamTail(
      [...initialMessages, assistant],
      initialMessages.length,
    );
    expect(committed).toBe(true);
    // 提交走 streamCommit 增量通道，不是全量快照
    const afterCommit = sentTypes(baseline);
    expect(afterCommit).toContain('streamCommit');
    expect(afterCommit).not.toContain('streamReset');

    const baseline2 = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            messages: [...initialMessages, assistant],
            agentRunning: false,
            uiRunning: false,
          })}
        />,
      );
    });
    await flushSnapshotChunks();

    // 已提交的行 id 命中 lastStreamCommitIdsRef → 既不发全量、也不发 appendTailRows
    const afterReload = sentTypes(baseline2);
    expect(afterReload).not.toContain('sessionSnapshot');
    expect(afterReload).not.toContain('appendTailRows');
  });
});
