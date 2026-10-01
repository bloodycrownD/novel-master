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
import {Linking, Platform} from 'react-native';
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

/** 某一 type 的全部下行载荷（列表域断言面：viewState / sessionList / setText）。 */
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

describe('ChatConversationWebView · 列表域下行', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    jest.useRealTimers();
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
    simulateLoad(tree!.root);
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    return tree!;
  }

  it('view 变化即下发 viewState（web 据此切 data-view）', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({view: 'list'})} />,
      ));
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('viewState').at(-1)).toEqual({view: 'list'});

    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({view: 'conversation'})} />,
      );
    });
    expect(sentOfType('viewState').at(-1)).toEqual({view: 'conversation'});
  });

  it('sessionList=null 时绝不下发（对话态攒着，不跨桥）', async () => {
    await mountReady({view: 'conversation', sessionList: null});
    expect(sentTypes()).not.toContain('sessionList');
  });

  it('只改 sessionList（视图不动）也必须推——memo 漏字段的回归点', async () => {
    // 踩坑史：`pendingSubagentSessions` 漏进 memo 比较器过一次，症状是
    // 「改了没生效」且零报错。这里只改载荷、不改 view：漏 `sessionList` 字段
    // 时整个子树会被 memo 吞掉，本条立刻红。
    const first = {sessions: []};
    const second = {
      sessions: [
        {
          id: 's9',
          updatedAtMs: 9,
          active: false,
          interrupted: false,
          current: false,
        },
      ],
    };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({view: 'list', sessionList: first})}
        />,
      ));
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('sessionList')).toHaveLength(1);

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({view: 'list', sessionList: second})}
        />,
      );
    });
    expect(sentOfType('sessionList')).toHaveLength(2);
    expect(sentOfType('sessionList').at(-1)).toEqual(second);
  });

  it('sessionList 载荷下发；切回列表（null→对象）补推一次最新快照', async () => {
    const first = {
      sessions: [
        {
          id: 's1',
          title: 'S1',
          updatedAtMs: 1,
          active: false,
          interrupted: false,
          current: true,
        },
      ],
    };
    const second = {...first, sessions: [...first.sessions, {
      id: 's2',
      updatedAtMs: 2,
      active: false,
      interrupted: false,
      current: false,
    }]};
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({view: 'list', sessionList: first})} />,
      ));
    });
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('sessionList').at(-1)).toEqual(first);

    // 进对话：宿主把载荷置 null（这就是「对话期间不跨桥」的实现点）→ 不再推
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({view: 'conversation', sessionList: null})}
        />,
      );
    });
    expect(sentOfType('sessionList')).toHaveLength(1);

    // 回列表：null → 对象 ⇒ 一次性补推**最新**快照（顺带治「回列表不刷新」）
    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({view: 'list', sessionList: second})} />,
      );
    });
    expect(sentOfType('sessionList')).toHaveLength(2);
    expect(sentOfType('sessionList').at(-1)).toEqual(second);
  });
});

describe('ChatConversationWebView · listAction 上行', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  it('九项枚举白名单逐项透传；枚举外静默丢弃（不掉进任何既有分支）', async () => {
    const onListAction = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({onListAction})} />,
      ));
    });
    const kinds = [
      'open',
      'create',
      'menuOpen',
      'rename',
      'copy',
      'delete',
      'stopRun',
      'longPress',
      'batchToggle',
    ];
    for (const kind of kinds) {
      simulateUpstream(
        tree!.root,
        'listAction',
        {kind, sessionId: 's1'},
        CONVERSATION_BRIDGE_V,
      );
    }
    expect(onListAction.mock.calls.map(call => call[0].kind)).toEqual(kinds);

    // 白名单外：静默丢弃（若写成「未知 kind 当 open」，用户点一下就跳进别的会话）
    simulateUpstream(
      tree!.root,
      'listAction',
      {kind: '__evil__', sessionId: 's1'},
      CONVERSATION_BRIDGE_V,
    );
    expect(onListAction).toHaveBeenCalledTimes(kinds.length);
  });

  it('create 不带 sessionId；其余项缺 sessionId 时只带 kind（宿主侧判空丢弃）', async () => {
    const onListAction = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({onListAction})} />,
      ));
    });
    simulateUpstream(
      tree!.root,
      'listAction',
      {kind: 'create'},
      CONVERSATION_BRIDGE_V,
    );
    expect(onListAction).toHaveBeenCalledWith({kind: 'create'});
    simulateUpstream(
      tree!.root,
      'listAction',
      {kind: 'open'},
      CONVERSATION_BRIDGE_V,
    );
    expect(onListAction).toHaveBeenLastCalledWith({kind: 'open'});
  });
});

/* ================================================================== *
 * 会话切换重置链（第二阶段：去 `key={sessionKey}` 之后由 sessionKey 驱动）
 *
 * 去 key 之前，切会话 = 组件重挂 = 全部 ref 归零 + 走一遍 ready 握手；
 * 去 key 之后文档不换、ready 不重来，于是「换文档式的清场」必须显式改成
 * `[sessionKey]` effect 驱动。这组用例逐条钉住那几段。
 * ================================================================== */

describe('ChatConversationWebView · sessionKey 变化重置链', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await unmountAll();
    clearMockWebViewPostMessages();
  });

  /** 切到另一个会话：只换 sessionKey，文档/ready 都不动。 */
  async function switchSession(
    tree: TestRenderer.ReactTestRenderer,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({
            sessionKey: 'p1:s2',
            messages: [sampleMessage('m2', 1)],
            ...overrides,
          })}
        />,
      );
    });
    await flushMicrotasks();
    await flushSnapshotChunks();
  }

  it('切会话重发 init（幂等）并按新 sessionKey 开屏', async () => {
    const tree = await (async () => {
      let t!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        t = track(TestRenderer.create(
          <ChatConversationWebView {...baseProps({composerText: ''})} />,
        ));
      });
      simulateLoad(t.root);
      simulateReadyV2(t.root);
      await flushMicrotasks();
      return t;
    })();
    expect(sentTypes().filter(t => t === 'init')).toHaveLength(1);

    await switchSession(tree);
    // init 重发：切会话后 web 侧的 flags/theme/metrics 要重新对齐（幂等，值可同）
    expect(sentTypes().filter(t => t === 'init')).toHaveLength(2);
    // 快照开屏：新 sessionKey 整替换 rows
    const snapshots = sentMessages().filter(m => m.type === 'sessionSnapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.at(-1)!.payload.sessionKey).toBe('p1:s2');
  });

  it('切会话必重发一次 setText（草稿重新落位，判据不是「文本变没变」）', async () => {
    // web 文档没换 → 切会话后 textarea 里还留着上个会话的草稿。恢复的判据
    // **不能**是 M1 的「composerText !== webTextRef」：两个会话草稿恰好相同（或
    // controller 尚未水化、prop 暂还是旧值）时，那条判据会整条早退，草稿就留在
    // 旧会话的份上。所以 `[sessionKey]` 清场把基线打成 null，让 ③ 必然走真外部
    // 写入分支，重新落位一次（值同也无妨——幂等）。
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({composerText: '同一个草稿'})} />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    const before = sentOfType('setText').length;
    expect(before).toBeGreaterThan(0);

    // 切会话；composerText 文本**不变**（模拟两个会话草稿相同 / 水化未回）
    await switchSession(tree, {composerText: '同一个草稿'});
    const after = sentOfType('setText');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({text: '同一个草稿'});
  });

  it('切会话到空草稿：下发 setText(空) 清掉上个会话的草稿', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({composerText: '上个会话的草稿'})} />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('setText').at(-1)).toMatchObject({text: '上个会话的草稿'});

    // 新会话没有草稿：文本真变，③ 靠自身依赖即可覆盖（这一条是回归护栏，
    // 「两遍草稿」类问题会在这里现形）
    await switchSession(tree, {composerText: ''});
    expect(sentOfType('setText').at(-1)).toMatchObject({text: ''});
  });

  it('切会话不重启 8s ready 兜底（web 不重挂，ready 不重来）', async () => {
    // 8s 窗口量的是「这一份文档的握手耗时」，锚点固定在 onLoad。切会话既没有
    // 换文档、也没有让 ready 重来，就不该给这个窗口续命——否则用户每切一次会话
    // 都能把「加载失败」的判定往后推 8 秒。
    jest.useFakeTimers();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });
    simulateLoad(tree.root);

    // ready 之前切会话（冷启动立刻点一行是常态）：兜底窗口不得被续命
    await act(async () => {
      jest.advanceTimersByTime(7500);
    });
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({sessionKey: 'p1:s2', messages: [sampleMessage('m2', 1)]})}
        />,
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}).length,
    ).toBeGreaterThan(0);
  });

  it('切会话（已 ready）不弹 8s 错误态：ready 早已到达，计时器判超时的前提不成立', async () => {
    jest.useFakeTimers();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(<ChatConversationWebView {...baseProps()} />));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({sessionKey: 'p1:s2', messages: [sampleMessage('m2', 1)]})}
        />,
      );
    });
    // 推进远超 8s：切会话不是「新文档」，不该有任何 ready 超时错误态
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}),
    ).toHaveLength(0);
  });

  it('切会话不重发 ready（onReady 只调一次，句柄只 attach 一次）', async () => {
    const onReady = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({onReady})} />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(onReady).toHaveBeenCalledTimes(1);

    await switchSession(tree);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
