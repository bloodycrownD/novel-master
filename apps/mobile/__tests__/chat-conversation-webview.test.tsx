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

  it('G-3: 切回列表同 commit 内 viewState 必须先于首条 sessionList（声明序护栏）', async () => {
    // 隐含依赖：两条 effect 在同一次 commit 里先后跑，顺序只由**声明序**决定。
    // 先切视图再推列表 → 用户先看到列表框、后看到行（中间空态按行数现算，不闪）。
    // 把两个 useEffect 的声明序对调，本条立刻红——故别用「都发了」这种弱断言。
    const list = {
      sessions: [
        {
          id: 's2',
          title: 'S2',
          updatedAtMs: 2,
          active: false,
          interrupted: false,
          current: false,
        },
      ],
    };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({view: 'conversation', sessionList: null})} />,
      ));
    });
    simulateReadyV2(tree!.root);
    await flushMicrotasks();
    expect(sentTypes()).not.toContain('sessionList');

    // 切回列表：view 与 sessionList 同一拍变，两个 effect 一起跑
    await act(async () => {
      tree!.update(
        <ChatConversationWebView {...baseProps({view: 'list', sessionList: list})} />,
      );
    });
    const sent = sentMessages();
    const viewIdx = sent.findIndex(
      m => m.type === 'viewState' && m.payload.view === 'list',
    );
    const listIdx = sent.findIndex(m => m.type === 'sessionList');
    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeLessThan(listIdx);
  });
});

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

describe('ChatConversationWebView · 快照在途时切视图（中止与补铺）', () => {
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

  it('退出到列表：在途余片中止不再过桥；重进补铺全量（末片 preserve）', async () => {
    const msgs = bigMessages();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      ));
    });
    simulateLoad(tree.root);
    closeChunkGate();
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    // ready 后有两轮快照竞发（开屏 gen1 + pendingSubagent force gen2 顶替），
    // 两轮的首片都赶在让步前过桥，余片全挂在闸上
    const inFlight = sentOfType('sessionSnapshot');
    expect(inFlight).toHaveLength(2);
    expect(inFlight[0]).toMatchObject({chunkIndex: 0, chunkTotal: 3});
    expect(inFlight[1]).toMatchObject({chunkIndex: 0, chunkTotal: 3});
    expect(inFlight[1]!.generation).toBeGreaterThan(inFlight[0]!.generation as number);

    // 退出：同一 commit 里 viewState 先行、在途代次被顶掉
    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({view: 'list', messages: msgs})} />,
      );
    });
    expect(sentOfType('viewState').at(-1)).toEqual({view: 'list'});

    releaseChunkGate();
    await flushSnapshotChunks();
    // 余片醒来发现代次被顶 → 中止：总数停在两轮首片，不再增长
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    // 重进同一会话：needsResume 补铺一次全量（messages 引用未变，
    // 主快照 effect 不跑，这里发的必然是补铺路径）
    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      );
    });
    await flushSnapshotChunks();
    const snapshots = sentOfType('sessionSnapshot');
    expect(snapshots).toHaveLength(5);
    expect(snapshots.at(-1)).toMatchObject({
      chunkIndex: 2,
      chunkTotal: 3,
      scrollIntent: 'preserve',
    });
  });

  it('快照不在途时正常进出：不补铺（SPA 零成本重进不退化）', async () => {
    const msgs = bigMessages();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushSnapshotChunks();
    // 双轮竞发收敛后落盘形态：两轮首片 + 胜出代次的后两片
    expect(sentOfType('sessionSnapshot')).toHaveLength(4);

    // 进出各一次：无在途可中止 → 重进零补铺，转录 DOM 原样保留
    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({view: 'list', messages: msgs})} />,
      );
    });
    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      );
    });
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(4);
  });

  /* ------------------------------------------------------------------ *
   * cr2-C-2/C-3/C-4：中止 effect 的挂起档、补铺标记的空面/换会话守卫。
   * ------------------------------------------------------------------ */

  it('中止 effect 清挂起档：uiRunning 挂起中的快照在退出列表后不再起跑', async () => {
    // uiRunning 期间的非 force 快照先落进 pendingSnapshotRef + 0ms 定时器等流式
    // 间歇；退出列表必须把这档无条件掐掉——否则那一次宏任务照样 fire，把整份
    // 浏览史分片灌进列表视图下的 WebView（此时窗口最窄，正是要消除的堵塞）。
    const msgs = bigMessages();
    const running = {uiRunning: true, agentRunning: true};
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({...running, messages: msgs, flags: {richText: false}})}
        />,
      ));
    });
    simulateLoad(tree.root);
    simulateReadyV2(tree.root);
    await flushSnapshotChunks();
    const baseline = sentOfType('sessionSnapshot').length;
    expect(baseline).toBeGreaterThan(0);

    // richText 翻转 → 走挂起档（此刻还没起跑）
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({...running, messages: msgs, flags: {richText: true}})}
        />,
      );
    });
    expect(sentOfType('sessionSnapshot')).toHaveLength(baseline);

    // 定时器 fire 之前退到列表 → 挂起档被清
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({
            ...running,
            messages: msgs,
            flags: {richText: true},
            view: 'list',
          })}
        />,
      );
    });
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(baseline);
  });

  it('deferred 统一 flush：在途分片期间排队的流式增量压到补铺末片之后才过桥', async () => {
    const msgs = bigMessages();
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages: msgs, flags: {richText: true}})}
        />,
      ));
    });
    simulateLoad(tree.root);
    closeChunkGate();
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    // 在途窗口里推一次 delta：RAF 醒来发现有分片在途 → 只入 deferred 队列
    await act(async () => {
      ref.current?.pushStreamDelta('text', '流式半句');
    });
    await flushAnimationFrame();
    expect(sentTypes()).not.toContain('streamDelta');

    // 退到列表 → 中止；deferred 队列整队留着，等补铺完成时统一 flush
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages: msgs, flags: {richText: true}, view: 'list'})}
        />,
      );
    });
    const mark = mockWebViewPostMessages.length;
    releaseChunkGate();
    await flushSnapshotChunks();

    // 中止后、补铺前：既没有余片补发，也没有流式增量插队
    const beforeResume = sentTypes(mark);
    expect(beforeResume).not.toContain('sessionSnapshot');
    expect(beforeResume).not.toContain('streamDelta');
    expect(beforeResume).not.toContain('streamBatch');

    // 重进 → 补铺全量；末片 post 完才 flush deferred
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages: msgs, flags: {richText: true}})}
        />,
      );
    });
    await flushSnapshotChunks();
    await flushAnimationFrame();

    const tail = sentTypes(mark);
    expect(tail.filter(t => t === 'sessionSnapshot')).toHaveLength(3);
    const lastSnapshot = tail.lastIndexOf('sessionSnapshot');
    const deltaIdx = tail.indexOf('streamDelta');
    expect(deltaIdx).toBeGreaterThan(lastSnapshot);
  });

  it('粘性标记：中止后在列表态跑成的完整快照清掉标记，重进不再白发一次全量', async () => {
    // 「零补铺」不变量此前只在补铺 effect 里清标记 → 中止后在列表视图里因
    // richText 变化跑成的完整快照不清它，下次重进白发一次全量（+3 而非 +0）。
    const msgs = bigMessages();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({messages: msgs, flags: {richText: false}})}
        />,
      ));
    });
    simulateLoad(tree.root);
    closeChunkGate();
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: msgs, flags: {richText: false}, view: 'list'})}
        />,
      );
    });
    const mark = mockWebViewPostMessages.length;
    releaseChunkGate();
    await flushSnapshotChunks();
    expect(sentTypes(mark)).not.toContain('sessionSnapshot');

    // 列表态改一次 richText → 一轮完整快照（3 片）跑完，DOM 已完整
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: msgs, flags: {richText: true}, view: 'list'})}
        />,
      );
    });
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(5);

    // 重进：标记已清 → 零补铺（不带 fix 时这里会是 8）
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: msgs, flags: {richText: true}})}
        />,
      );
    });
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(5);
  });

  it('空面守卫：中止置位后重进但消息面为空 → 不补铺也不消费标记，消息到位才恰好补铺一次', async () => {
    // 空面补铺等于发一份空快照把转录清掉，且标记被消费后真消息到位也不会再补。
    // 这里让空面重进时流式处于活跃（uiRunning + 已推 delta）：④ 自己那条收缩
    // 快照会挂在 pending 上不 fire，于是「补铺没跑、标记还在」是可观测的。
    const msgs = bigMessages();
    const running = {uiRunning: true, agentRunning: true};
    const ref = React.createRef<ChatConversationWebViewHandle>();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView ref={ref} {...baseProps({messages: msgs})} />,
      ));
    });
    simulateLoad(tree.root);
    closeChunkGate();
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages: msgs, view: 'list'})}
        />,
      );
    });
    const mark = mockWebViewPostMessages.length;
    releaseChunkGate();
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    // 重进但消息面为空 + 流式活跃：补铺守卫早退，④ 的收缩快照挂 pending
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({...running, messages: []})}
        />,
      );
      ref.current?.pushStreamDelta('text', '推流中');
    });
    await flushSnapshotChunks();
    await flushAnimationFrame();
    expect(sentTypes(mark)).not.toContain('sessionSnapshot');

    // 消息到位：补铺标记仍在 → 恰好一轮全量（3 片），不多不少
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({...running, messages: msgs})}
        />,
      );
    });
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(5);
    expect(sentOfType('sessionSnapshot').at(-1)).toMatchObject({
      chunkIndex: 2,
      chunkTotal: 3,
    });
  });

  it('换会话互斥：中止置位后重进同时换 sessionKey → 恰好一轮全量（generation 连号）', async () => {
    const msgs = bigMessages();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = track(TestRenderer.create(
        <ChatConversationWebView {...baseProps({messages: msgs})} />,
      ));
    });
    simulateLoad(tree.root);
    closeChunkGate();
    simulateReadyV2(tree.root);
    await flushMicrotasks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    await act(async () => {
      tree.update(
        <ChatConversationWebView {...baseProps({messages: msgs, view: 'list'})} />,
      );
    });
    const mark = mockWebViewPostMessages.length;
    releaseChunkGate();
    await flushSnapshotChunks();
    expect(sentOfType('sessionSnapshot')).toHaveLength(2);

    // 重进 + 换会话：补铺让位给 ④ 的开屏轮（两条互斥，否则同 commit 双发）
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: msgs, sessionKey: 'p1:s2'})}
        />,
      );
    });
    await flushSnapshotChunks();

    const snaps = sentOfType('sessionSnapshot');
    expect(snaps).toHaveLength(5);
    const round = snaps.slice(2);
    expect(round.map(p => p.chunkIndex)).toEqual([0, 1, 2]);
    expect(new Set(round.map(p => p.generation)).size).toBe(1);
    expect(round[0]!.generation).toBeGreaterThan(snaps[1]!.generation as number);
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
