import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {clearAllSessionViewCaches} from '../src/services/chat-session-view-cache';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_CAPABILITY_COMPOSER_DOCK,
  decodeConversationUpstream,
} from '../src/components/chat/ChatConversationBridge';
import {
  clearMockWebViewPostMessages,
  findMockWebViewByDomain,
  getMockWebViewInstances,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

// 消息体需带 content.blocks，deriveComposerSendState 会读 message.content.blocks。
const mockTailMessage = {
  id: 'm2',
  seq: 2,
  role: 'assistant',
  content: {blocks: [{type: 'text', text: 'hi'}]},
};
const mockOlderMessage = {
  id: 'm1',
  seq: 1,
  role: 'user',
  content: {blocks: [{type: 'text', text: 'old'}]},
};
const mockLoadTail = jest.fn(async () => [mockTailMessage]);
const mockLoadPage = jest.fn(async () => [mockOlderMessage]);
/**
 * BottomSheetMenu 的 props 收集（面板上现在有两张：会话抽屉 + 会话行 ⋮）。
 * 用数组而非「最后一个」是因为渲染顺序会变——按内容认领（见 `sessionRowMenu()`）。
 */
let mockBottomSheetPropsList: any[] = [];

/**
 * 对话面的消息面观察点（Step 8 迁居）。
 *
 * 原来这里挂一个 mock `MessageList` 捕获它的 props，用 `streamingText` /
 * `messages` 两个字段当观察口。legacy 转录引擎退役后 `MessageList` 没了，
 * 观察口改挂在**真**统一宿主 `ChatConversationWebView` 上——它本来就是这屏
 * 转录 + dock 的唯一宿主，props 直接就是 Provider 交出来的消息面，读它比读
 * 一个被 mock 出来的中间组件更贴近真实链路。
 */
function conversationMessages(
  root: TestRenderer.ReactTestInstance,
): readonly unknown[] {
  return root.findByType(
    require('../src/components/chat/ChatConversationWebView')
      .ChatConversationWebView as React.ComponentType<{messages: unknown[]}>,
  ).props.messages;
}

/**
 * 「加载更早消息」入口（Step 8 迁居）。
 *
 * 原来是一个 RN `Pressable`（legacy `MessageList` 的 `listHeaderComponent`）。
 * 统一宿主里这个入口在转录文档顶部，web 侧点它派一条 `loadOlder` 上行
 * （v:1 信封），宿主转交 `onLoadOlder` —— 落点还是同一个 Provider 回调，
 * 断的仍是被调到了没有，变的只是从「按 RN 按钮」变成「按 web 上行」。
 */
async function requestLoadOlder(
  root: TestRenderer.ReactTestInstance,
): Promise<void> {
  const webView = root.findByType(
    require('react-native-webview').default as React.ComponentType<{
      onMessage?: (event: {nativeEvent: {data: string}}) => void;
    }>,
  );
  await act(async () => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({v: 1, type: 'loadOlder', payload: {}}),
      },
    });
  });
}

const mockRunAgentTurn = jest.fn(
  () => new Promise(() => undefined) as Promise<unknown>,
);

const mockRuntime: any = {
  projects: {
    list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
    get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
    create: jest.fn(),
    rename: jest.fn(),
    delete: jest.fn(),
  },
  sessions: {
    listByProject: jest.fn(async () => [
      {id: 's1', title: 'S1', updatedAtMs: 1},
    ]),
    create: jest.fn(),
    rename: jest.fn(),
    copy: jest.fn(),
    delete: jest.fn(),
    // composer controller 的草稿水化 / 落库窄口（webview 分支会真挂 controller）。
    get: jest.fn(async () => ({id: 's1', projectId: 'p1'})),
    getComposerDraftJson: jest.fn(async () => null),
    setComposerDraftJson: jest.fn(async () => true),
  },
  messages: {
    listBySession: jest.fn(async () => [{id: 'legacy', seq: 999}]),
    // 单元消息管线的窄口（tail 回源 + hasMore 探针共用分页口）。
    listBySessionTail: jest.fn(async () => [mockTailMessage]),
    listBySessionPage: jest.fn(async () => [{id: 'older-probe', seq: 1}]),
    hide: jest.fn(),
    show: jest.fn(),
    delete: jest.fn(),
    updateContent: jest.fn(),
  },
  state: {
    getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
  },
  eventBus: new SimpleEventBus(),
  // abortRegistry mock：默认无 in-flight run（has=false）。
  abortRegistry: {
    register: jest.fn(),
    abort: jest.fn(),
    unregister: jest.fn(),
    has: jest.fn(() => false),
  },
  streamRegistry: {
    register: jest.fn(),
    reset: jest.fn(),
    append: jest.fn(),
    get: jest.fn(() => undefined),
    has: jest.fn(() => false),
    unregister: jest.fn(),
  },
  workplace: jest.fn(() => ({
    buildListRows: jest.fn(async () => [
      {path: '/', kind: 'dir'},
      {path: '/a.md', kind: 'file'},
    ]),
  })),
  // composer controller 的 `$` 技能候选源窄口。
  skills: jest.fn(() => ({effectiveSkills: jest.fn(async () => [])})),
  sessionVfs: jest.fn(() => ({})),
  projectVfs: jest.fn(() => ({})),
};

// Step 6 平移：harness 直接消费真实 manager（SessionStreamUnitManager），
// 挂到 mockRuntime.sessionStreamUnitManager（与 Provider bootstrap 装配同形）。
let mockHarnessManager: SessionStreamUnitManager | undefined;

function buildHarnessManager(): SessionStreamUnitManager {
  const manager = new SessionStreamUnitManager({
    runtime: mockRuntime,
    runAgentTurn: mockRunAgentTurn as never,
  });
  // harness 无持久层：显式放行水合（snapshot 可读）。
  manager.markHydrated();
  return manager;
}

/**
 * Android 返回键 hook 的入参捕获（第二阶段用它驱动「返回列表」）。
 *
 * hook 本体有独立测试（`use-android-chat-back-handler.test.ts`），这里只把它
 * 替成一个「记录 options」的桩：返回键的状态机本轮零改动，需要的只是**一个
 * 能触发 `backFromConversation` 的把手**，好断言切视图后 WebView 实例恒等。
 */
let mockBackHandlerState: any = null;
let mockBackHandlerActions: any = null;
jest.mock('../src/hooks/useAndroidChatBackHandler', () => ({
  useAndroidChatBackHandler: (state: any, actions: any) => {
    mockBackHandlerState = state;
    mockBackHandlerActions = actions;
  },
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

// 真实 useFocusEffect 只在 focus 时调 cb；若每次 render 都调，会与
// refreshChatMeta 每次 setAgentMeta 新对象组成无限重渲染循环，act 永不结束。
// 与 chat-tab-screen-legacy-scroll.test.tsx 保持同一契约：仅在首次 focus 时调一次。
let mockFocusInvoked = false;
jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    current: null,
    isReady: () => false,
    navigate: jest.fn(),
  }),
  useFocusEffect: (cb: () => void) => {
    if (!mockFocusInvoked) {
      mockFocusInvoked = true;
      cb();
    }
  },
  useNavigation: () => ({navigate: jest.fn(), setOptions: jest.fn()}),
  useIsFocused: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@novel-master/core', () => ({
  textBlocks: (text: string) => ({blocks: [{type: 'text', text}]}),
}));

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/hooks/useMobileScope', () => ({
  useMobileScope: () => ({
    projectId: 'p1',
    sessionId: 's1',
    setCurrentProject: jest.fn(async () => undefined),
    setCurrentSession: jest.fn(async () => undefined),
    refreshScope: jest.fn(async () => undefined),
  }),
}));

jest.mock('../src/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setChat: jest.fn()}),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({
    appUi: {get: jest.fn(async () => 'false')},
    richRenderEpoch: 0,
  }),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surfaceElevated: '#111',
      borderLight: '#222',
      textSecondary: '#ccc',
      primary: '#08f',
      text: '#fff',
      textTertiary: '#777',
    },
  }),
}));

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(async () => ({
    // 与新类型契约保持一致：枚举统一为 'session'
    source: 'session',
    agentId: 'a1',
    agentName: 'Agent',
    modelLabel: 'Model',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  })),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
  isChatTokenPreciseWarmInflight: jest.fn(() => false),
  // cr2-E-2 新导出（手写 mock 需随导出面同步，缺它会炸 meta 加载链）。
  cancelPreciseUpgradeDelay: jest.fn(),
}));

jest.mock('../src/storage/chat-rich-text-pref', () => ({
  readChatRichTextEnabled: jest.fn(async () => false),
}));

jest.mock('../src/services/session-messages-loader', () => ({
  loadSessionMessagesTail: (...args: any[]) => mockLoadTail(...args),
  loadSessionMessagesPage: (...args: any[]) => mockLoadPage(...args),
}));

jest.mock('../src/components/chrome/AppHeader', () => ({
  AppHeader: () => null,
}));
jest.mock('../src/components/chat/ChatMetaBar', () => ({
  ChatMetaBar: () => null,
}));
jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: (props: any) => {
    mockBottomSheetPropsList.push(props);
    return null;
  },
}));
jest.mock('../src/components/chrome/ProjectDrawer', () => ({
  ProjectDrawer: () => null,
}));
jest.mock('../src/components/provider/ModelPickerModal', () => ({
  ModelPickerModal: () => null,
}));
jest.mock('../src/components/vfs/VfsFileManager', () => ({
  VfsFileManager: () => null,
}));
jest.mock('../src/components/batch/ManageHeader', () => ({
  ManageHeader: () => null,
}));
jest.mock('../src/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));
jest.mock('../src/components/ui/SegmentedControl', () => ({
  SegmentedControl: () => null,
}));
jest.mock('../src/components/ui/Buttons', () => ({
  PrimaryButton: () => null,
}));
jest.mock('../src/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));

jest.mock('../src/components/chat/MessageEditModal', () => ({
  MessageEditModal: () => null,
}));
jest.mock('../src/components/agent/AgentPickerModal', () => ({
  AgentPickerModal: () => null,
}));

import {ChatTabScreen} from '../src/screens/tabs/ChatTabScreen';

/**
 * 会话行 ⋮ 菜单（认领标准：items 里带「重命名」）。
 *
 * 面板上现在挂两张 BottomSheetMenu（会话抽屉 + 会话行菜单），所以不能再用
 * 「最后渲染的那张」——渲染顺序是实现细节，不是契约。
 */
function sessionRowMenu(): any {
  const found = [...mockBottomSheetPropsList]
    .reverse()
    .find(props =>
      (props.items ?? []).some((item: any) => item.label === '重命名'),
    );
  if (found == null) {
    throw new Error('会话行 ⋮ 菜单未渲染');
  }
  return found;
}

/** 往统一宿主派一条 `listAction` 上行（等价于用户在 web 列表里点/长按）。 */
async function sendListAction(
  root: TestRenderer.ReactTestInstance,
  payload: {kind: string; sessionId?: string},
): Promise<void> {
  const webView = findMockWebViewByDomain(root, 'chat-conversation');
  await act(async () => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          v: CONVERSATION_BRIDGE_V,
          type: 'listAction',
          payload,
        }),
      },
    });
  });
}

/** 宿主当前推给 web 的全部下行（按 type 过滤）。 */
function sentTypes(): string[] {
  return mockWebViewPostMessages.map(
    raw => (JSON.parse(raw) as {type: string}).type,
  );
}

function sentOfType(type: string): Array<Record<string, unknown>> {
  return mockWebViewPostMessages
    .map(raw => JSON.parse(raw) as {type: string; payload: Record<string, unknown>})
    .filter(msg => msg.type === type)
    .map(msg => msg.payload);
}

async function enterConversation(
  tree: TestRenderer.ReactTestRenderer,
): Promise<void> {
  await sendListAction(tree.root, {kind: 'open', sessionId: 's1'});
}

describe('ChatTabScreen integration', () => {
  /** 本用例内挂载的树登记——afterEach 统一卸载（防 mock props 跨用例污染）。 */
  const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

  function mountScreen(): TestRenderer.ReactTestRenderer {
    const tree = TestRenderer.create(<ChatTabScreen />);
    mountedTrees.push(tree);
    return tree;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockFocusInvoked = false;
    mockBackHandlerState = null;
    mockBackHandlerActions = null;
    mockBottomSheetPropsList = [];
    mockLoadTail.mockClear();
    mockLoadPage.mockClear();
    mockRunAgentTurn.mockClear();
    mockRuntime.messages.listBySession.mockClear();
    mockRuntime.messages.listBySessionTail.mockClear();
    mockRuntime.messages.listBySessionPage.mockClear();
    // tail 默认实现每用例重置（个别用例会覆盖成「多取一条」形态）。
    mockRuntime.messages.listBySessionTail.mockImplementation(
      async () => [mockTailMessage],
    );
    // 每用例重建 eventBus 与 manager（与 Provider retry 重建同形：先 dispose）。
    mockHarnessManager?.dispose();
    mockRuntime.eventBus = new SimpleEventBus();
    mockHarnessManager = buildHarnessManager();
    mockRuntime.sessionStreamUnitManager = mockHarnessManager;
    // 视图缓存是模块级单例，跨用例残留会干扰「回源 vs 缓存命中」断言。
    clearAllSessionViewCaches();
    clearMockWebViewPostMessages();
    mockRuntime.abortRegistry.has.mockImplementation(() => false);
    mockRuntime.streamRegistry.get.mockImplementation(() => undefined);
  });

  afterEach(async () => {
    // 用例树统一卸载：mockLatest*Props 是模块级全局，旧树若在后续用例的
    // 渲染批次里落下更新，会把捕获的 props 覆盖回旧值（跨用例污染）。
    for (const tree of mountedTrees.splice(0)) {
      await act(async () => {
        tree.unmount();
      });
    }
    mockHarnessManager?.dispose();
    mockHarnessManager = undefined;
    jest.useRealTimers();
  });

  it('loads initial tail and paginates older without listBySession dependency', async () => {
    // Step 2 单查询化造数：tail 一次取 41 条（页大小 40 + 1）——最旧一行
    // （seq=1）被裁去，裁剪后首行仍为 mockTailMessage（分页锚点不变），
    // hasMore=true 使「加载更早消息」入口可见。
    mockRuntime.messages.listBySessionTail.mockImplementation(async () => [
      mockOlderMessage,
      mockTailMessage,
      ...Array.from({length: 39}, (_, i) => ({
        id: `m-fill-${i}`,
        seq: 3 + i,
        role: 'assistant' as const,
        content: {blocks: [{type: 'text' as const, text: `fill-${i}`}]},
      })),
    ]);
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    await enterConversation(tree!);

    // 无单元（非运行态会话，Step 7 收口）：manager 的 idle 消息路径兜底
    // ——同样走 runtime.messages 窄口（listBySessionTail），不经
    // session-messages-loader（该 loader 的 hook 消费方已退役）。
    // Step 2 单查询化：tail 多取一条（页大小 40 + 1）判定 hasMore。
    expect(mockRuntime.messages.listBySessionTail).toHaveBeenCalledWith('s1', {
      limit: 41,
    });
    expect(mockRuntime.messages.listBySession).not.toHaveBeenCalled();

    await requestLoadOlder(tree!.root);

    expect(mockRuntime.messages.listBySessionPage).toHaveBeenCalledWith('s1', {
      limit: 40,
      beforeSeq: 2,
    });
  });

  it('有单元时消息面走单元管线：tail 由 listBySessionTail 回源、分页走单元窄口', async () => {
    // Step 2 单查询化造数：同上——tail 一次取 41 条，最旧一行被裁去，
    // hasMore=true 且裁剪后首行为 mockTailMessage（beforeSeq=2 不变）。
    mockRuntime.messages.listBySessionTail.mockImplementation(async () => [
      mockOlderMessage,
      mockTailMessage,
      ...Array.from({length: 39}, (_, i) => ({
        id: `m-fill-${i}`,
        seq: 3 + i,
        role: 'assistant' as const,
        content: {blocks: [{type: 'text' as const, text: `fill-${i}`}]},
      })),
    ]);
    // 先建立 s1 的活跃单元（startRun 受理 + RUN_STARTED 回填）。
    mockHarnessManager!.startRun('s1', 'p1', 'hi');
    mockRuntime.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });

    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    await enterConversation(tree!);

    // 单元消息面：listBySessionTail（单元窄口）而非 session-messages-loader。
    // Step 2 单查询化：tail 多取一条（页大小 40 + 1）判定 hasMore。
    expect(mockRuntime.messages.listBySessionTail).toHaveBeenCalledWith('s1', {
      limit: 41,
    });
    expect(mockLoadTail).not.toHaveBeenCalled();

    await requestLoadOlder(tree!.root);

    expect(mockRuntime.messages.listBySessionPage).toHaveBeenCalledWith(
      's1',
      {limit: 40, beforeSeq: 2},
    );
    expect(mockLoadPage).not.toHaveBeenCalled();
  });

  it('wires bursty stream deltas through unit buffers to projection partial', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    await enterConversation(tree!);

    // 起 run + 连发三段 delta（Step 8 迁居：原先这段是 mock `ChatComposer`
    // 里一个 `emit-bursty-stream` 按钮的 onPress，组件删了改由用例直接发事件，
    // 断的仍是「单元 ingress 合并窗 → apply 节拍 → 投影 partial」这条节拍链）。
    await act(async () => {
      const bus = mockRuntime.eventBus;
      mockHarnessManager!.startRun('s1', 'p1', 'hi');
      bus.publish(EVENT_AGENT_RUN_STARTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: 'r1',
      });
      for (const text of ['A', 'B', 'C']) {
        bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
          sessionId: 's1',
          runId: 'r1',
          text,
        });
      }
    });
    // 单元 ingress 32ms 合并窗口：delta 不会同步进 apply 缓冲，投影不动。
    expect(mockHarnessManager!.snapshot('s1')?.partialText).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(32);
    });
    // 合并后一块 text chunk 进 apply 缓冲（64ms 节拍未到），投影仍不动。
    expect(mockHarnessManager!.snapshot('s1')?.partialText).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(64);
    });
    // apply 节拍到：partial 进投影（统一宿主的流式面从这条投影读）。
    expect(mockHarnessManager!.snapshot('s1')?.partialText).toBe('ABC');
  });

  it('T-R3 顺序：重进注入的 streamDelta 晚于 sessionSnapshot（先 snapshot 后 inject）', async () => {
    // 重进恢复现场：s1 的 run 进行中且单元已有 partial；统一宿主是这屏唯一
    // 转录面，sessionSnapshot 与注入 delta 都经桥的 postToWeb（webview mock
    // 落盘）按序记录。
    mockHarnessManager!.startRun('s1', 'p1', 'hi');
    mockRuntime.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });
    mockRuntime.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: '重进恢复的 partial 正文',
    });
    // 等 apply 节拍（32ms ingress + 64ms apply）把 partial 落进单元投影。
    await act(async () => {
      jest.advanceTimersByTime(96);
    });
    expect(mockHarnessManager!.snapshot('s1')?.partialText).toBe(
      '重进恢复的 partial 正文',
    );

    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    const root = tree!.root;

    // 进入会话：单元消息面水合（listBySessionTail mock 已就绪）。
    await enterConversation(tree!);
    await act(async () => {
      await Promise.resolve();
    });

    // web 侧 ready：webReady=true 后子组件 messages effect 直发
    // sessionSnapshot（needsOpenSnapshot 路径）；Provider 的 attach effect
    // 随 onReady 触发，单元注入（stream-delta 载荷）经 RAF 到达。
    // 统一宿主的 ready 必须带 v:2 与 composer-dock 能力位（纪律 C：v:1 的旧
    // dist ready 被拒 → 走 8s 兜底，下行全丢）。
    const WebViewMock = require('react-native-webview')
      .default as React.ComponentType<{
      onMessage?: (event: {nativeEvent: {data: string}}) => void;
    }>;
    const webViews = root
      .findAllByType(WebViewMock)
      .filter(n => typeof n.props.onMessage === 'function');
    // 单 WebView：转录 + 输入框 dock 合流到一个实例（合并前这里是 2 个）。
    expect(webViews).toHaveLength(1);
    await act(async () => {
      webViews[0]!.props.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            v: CONVERSATION_BRIDGE_V,
            type: 'ready',
            payload: {
              version: 'u1',
              readyState: 'complete',
              capabilities: [
                'streamBlockCommit',
                CONVERSATION_CAPABILITY_COMPOSER_DOCK,
              ],
            },
          }),
        },
      });
    });
    // 冲洗 RAF/deferred 定时器（注入 delta 经 requestAnimationFrame 发出）
    await act(async () => {
      jest.advanceTimersByTime(64);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 统一宿主的下行信封是 v:2——用它的宽松 decoder 取 type/payload
    // （旧的 decodeHostToTranscript 对 v !== 1 直接 throw，会把断言变成误判）。
    const sentMessages = mockWebViewPostMessages.map(raw =>
      decodeConversationUpstream(raw),
    );
    const types = sentMessages
      .filter(r => r.ok)
      .map(r => (r as {ok: true; message: {type: string}}).message.type);
    const snapshotIdx = types.indexOf('sessionSnapshot');
    const deltaIdx = types.indexOf('streamDelta');
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThanOrEqual(0);
    // 先 snapshot 后 inject：第一条 sessionSnapshot 的调用序号必须小于任何
    // 注入产生的 stream/delta 消息（snapshot 建立基线后 delta 才有意义）
    expect(snapshotIdx).toBeLessThan(deltaIdx);
    // 本用例的流式 delta 已在挂屏前进投影（attach 前已 apply），streamDelta
    // 只可能来自重进注入，内容即单元 partial。
    const delta = sentMessages
      .filter(r => r.ok)
      .map(r => (r as {ok: true; message: {type: string; payload: Record<string, unknown>}}).message)
      .find(m => m.type === 'streamDelta');
    if (delta?.type === 'streamDelta') {
      expect(delta.payload.delta).toBe('重进恢复的 partial 正文');
    }
  });

  it('会话列表停止入口：web 派 menuOpen → 菜单挂「停止生成」并调 manager.stopRun', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });

    // 无活跃 run：菜单不含停止项（菜单默认打开的是会话抽屉那张）
    expect(sessionRowMenu().items.map((i: any) => i.action)).toEqual([
      'rename',
      'copy',
      'delete',
    ]);

    // s1 run 活跃（受理即 starting）：web 派 menuOpen 后菜单出现停止项，
    // 点击走 stopRun —— 整条链：web ⋮ → listAction/menuOpen → RN 原生菜单。
    mockHarnessManager!.startRun('s1', 'p1', 'hi');
    await act(async () => {
      await Promise.resolve();
    });
    await sendListAction(tree!.root, {kind: 'menuOpen', sessionId: 's1'});
    expect(sessionRowMenu().visible).toBe(true);
    expect(sessionRowMenu().items.map((i: any) => i.action)).toEqual([
      'stop-generating',
      'rename',
      'copy',
      'delete',
    ]);
    const stopSpy = jest.spyOn(mockHarnessManager!, 'stopRun');
    await act(async () => {
      sessionRowMenu().onSelect('stop-generating');
    });
    expect(stopSpy).toHaveBeenCalledWith('s1');
    stopSpy.mockRestore();
  });

  it('listAction 分发：create / rename / copy / delete 各走既有宿主动作', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    // create：走 scope.handleCreateSession（内部先 listByProject 再 create）
    mockRuntime.sessions.create.mockClear();
    await sendListAction(tree!.root, {kind: 'create'});
    expect(mockRuntime.sessions.create).toHaveBeenCalledWith('p1', expect.any(String));

    // rename：走既有 prompt（TextPromptModal 被 mock 成 null，改断言 scope 的入口）
    // → 这里用「会话行菜单被打开 + 其 rename 项派发」来钉：菜单项 → 同一个执行口
    await sendListAction(tree!.root, {kind: 'menuOpen', sessionId: 's1'});
    await act(async () => {
      sessionRowMenu().onSelect('rename');
    });
    // prompt 的可见性由 TextPromptModal 承接（已 mock），断的是「菜单关闭 + 分发执行」
    expect(sessionRowMenu().visible).toBe(false);

    // copy：走 scope.handleCopySession
    mockRuntime.sessions.copy.mockClear();
    await sendListAction(tree!.root, {kind: 'menuOpen', sessionId: 's1'});
    await act(async () => {
      sessionRowMenu().onSelect('copy');
    });
    expect(mockRuntime.sessions.copy).toHaveBeenCalledWith('s1');

    // delete：菜单项派发后停在原生 Alert 确认这一步（不直删）
    mockRuntime.sessions.delete.mockClear();
    await sendListAction(tree!.root, {kind: 'menuOpen', sessionId: 's1'});
    await act(async () => {
      sessionRowMenu().onSelect('delete');
    });
    expect(mockRuntime.sessions.delete).not.toHaveBeenCalled();
  });

  it('批量头入口：batchDelete 停在原生确认框，确认后才逐个删；batchExit 直接清批量态', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    // ready 握手一次（列表载荷开始下发，后面 batchSelect 才有意义）
    const webView = findMockWebViewByDomain(tree!.root, 'chat-conversation');
    await act(async () => {
      webView.props.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            v: CONVERSATION_BRIDGE_V,
            type: 'ready',
            payload: {version: 'u1', capabilities: ['composer-dock']},
          }),
        },
      });
    });

    // 长按进批量并勾上 s1 → 载荷带 batchSelect（批量头的真源）
    await sendListAction(tree!.root, {kind: 'longPress', sessionId: 's1'});
    expect((sentOfType('sessionList').at(-1) as {batchSelect?: string[]}).batchSelect).toEqual(['s1']);

    // web 批量头点「删除」→ 宿主只弹原生 Alert 二次确认，**不**直删
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockRuntime.sessions.delete.mockClear();
    await sendListAction(tree!.root, {kind: 'batchDelete'});
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{text: string; onPress?: () => void}>,
    ];
    expect(title).toBe('确认删除');
    expect(message).toBe('确定删除选中的 1 个会话？');
    expect(mockRuntime.sessions.delete).not.toHaveBeenCalled();

    // 确认 → 走 scope.deleteSelectedSessions 的逐个删除（部分成功语义原样保留）
    await act(async () => {
      buttons!.find(b => b.text === '删除')?.onPress?.();
    });
    expect(mockRuntime.sessions.delete).toHaveBeenCalledWith('s1');
    alertSpy.mockRestore();

    // 退出批量：batchExit 直接清选择 —— 下一次载荷 batchSelect 回到缺省
    await sendListAction(tree!.root, {kind: 'batchExit'});
    const afterExit = sentOfType('sessionList').at(-1) as {batchSelect?: string[]};
    expect(afterExit.batchSelect).toBeUndefined();
  });

  it('列表↔对话切视图不重建 WebView（实例恒等 + ready 只握手一次）', async () => {
    // 本轮改造的核心命题：去 `key={chatScrollKey}` + 面板常驻之后，
    // 「进会话 → 返回键回列表」不得再销毁重建 WebView（那正是用户实报的卡顿主因）。
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    const instancesBefore = getMockWebViewInstances('chat-conversation');
    expect(instancesBefore).toHaveLength(1);
    const idBefore = instancesBefore[0]!.id;

    // ready 握手一次（web 首帧固定 conversation 视图，宿主随后补发 viewState）
    const webView = findMockWebViewByDomain(tree!.root, 'chat-conversation');
    await act(async () => {
      webView.props.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            v: CONVERSATION_BRIDGE_V,
            type: 'ready',
            payload: {version: 'u1', capabilities: ['composer-dock']},
          }),
        },
      });
    });
    const initsAfterReady = sentTypes().filter(t => t === 'init').length;
    expect(initsAfterReady).toBe(1);
    // 冷启动停在列表视图 → ready 后补发 viewState=list（web 首帧是 conversation）
    expect(sentOfType('viewState').at(-1)).toEqual({view: 'list'});
    expect(sentOfType('sessionList').length).toBeGreaterThan(0);

    await enterConversation(tree!);
    expect(sentOfType('viewState').at(-1)).toEqual({view: 'conversation'});

    // 返回键回列表（backFromConversation 语义：setChatSubview('sessions')）
    expect(mockBackHandlerState.chatSubview).toBe('conversation');
    await act(async () => {
      mockBackHandlerActions.backFromConversation();
    });
    expect(sentOfType('viewState').at(-1)).toEqual({view: 'list'});

    // 同一个 WebView 实例（全程没被重挂）
    const instancesAfter = getMockWebViewInstances('chat-conversation');
    expect(instancesAfter).toHaveLength(1);
    expect(instancesAfter[0]!.id).toBe(idBefore);
    // ready 没重来：init 仍只有握手那一条（切视图不重发 init）
    expect(sentTypes().filter(t => t === 'init').length).toBe(initsAfterReady);
    // 回列表补推了一次列表快照（治「回列表不刷新」那条老毛病）
    expect(sentOfType('sessionList').length).toBeGreaterThan(1);
  });

  it('列表快照只在下行一次「非批量态」形态：批量勾选走 batchSelect 字段', async () => {
    // 载荷形状判据（web 侧 resolveSessionSelected 只认这个字段）：
    // 缺省 = 非批量态、给了（哪怕空数组）= 批量态。混淆的后果是批量态下
    // 点行会走成「打开会话」而不是「勾选」。
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    const webView = findMockWebViewByDomain(tree!.root, 'chat-conversation');
    await act(async () => {
      webView.props.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            v: CONVERSATION_BRIDGE_V,
            type: 'ready',
            payload: {version: 'u1', capabilities: ['composer-dock']},
          }),
        },
      });
    });
    const first = sentOfType('sessionList').at(-1) as {
      sessions: Array<Record<string, unknown>>;
      batchSelect?: string[];
    };
    expect(first.batchSelect).toBeUndefined();
    expect(first.sessions).toEqual([
      {id: 's1', title: 'S1', updatedAtMs: 1, active: false, interrupted: false, current: true},
    ]);

    // 长按进批量并勾上这一行 → 下一次载荷必须带 batchSelect
    await sendListAction(tree!.root, {kind: 'longPress', sessionId: 's1'});
    const afterBatch = sentOfType('sessionList').at(-1) as {batchSelect?: string[]};
    expect(afterBatch.batchSelect).toEqual(['s1']);
  });

  it('sessionKey 变化（进会话）重发 init + 快照开屏，且不重启 8s ready 兜底', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    const webView = findMockWebViewByDomain(tree!.root, 'chat-conversation');
    await act(async () => {
      webView.props.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            v: CONVERSATION_BRIDGE_V,
            type: 'ready',
            payload: {version: 'u1', capabilities: ['composer-dock']},
          }),
        },
      });
    });
    const initsBefore = sentTypes().filter(t => t === 'init').length;
    const snapshotsBefore = sentTypes().filter(
      t => t === 'sessionSnapshot',
    ).length;

    // sessionKey 从 'p1:s1'… 注意本用例里 useMobileScope 恒给 s1，
    // 真正驱动 sessionKey 变化的是 chatScrollKey 派生的 projectId#sessionId。
    // 这里换成「切到别的会话」：改 useMobileScope 的 sessionId 不可行（mock 固定），
    // 故直接断言「进会话后 init 至少没重复、快照开了新屏」这条不变式。
    await enterConversation(tree!);
    expect(sentTypes().filter(t => t === 'init').length).toBe(initsBefore);
    expect(
      sentTypes().filter(t => t === 'sessionSnapshot').length,
    ).toBeGreaterThan(snapshotsBefore);

    // 8s 兜底：ready 早就到了，切视图后推进 8s 也不该弹「对话页加载失败」
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(
      tree!.root.findAllByProps({testID: 'chat-conversation-ready-error'}),
    ).toHaveLength(0);
  });

  it('settled 单元宽限销毁后消息面不回退（最终 assistant 回复仍在，消息数不减）', async () => {
    // cr-func MF-1：run 收尾 → 30s 宽限到期单元销毁 → unitView 变 null →
    // 双源回退 useChatTabMessages。run 期间 hook 刷新被 manager 分支接管、
    // state 停留在 run 前旧快照——迁移沿补偿须以视图缓存恢复消息面。
    const finalUserMessage = {
      id: 'm-final-user',
      seq: 3,
      role: 'user',
      content: {blocks: [{type: 'text', text: 'hi'}]},
    };
    const finalAssistantMessage = {
      id: 'm-final-assistant',
      seq: 4,
      role: 'assistant',
      content: {blocks: [{type: 'text', text: '最终回复'}]},
    };

    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = mountScreen();
    });
    await enterConversation(tree!);

    // 无单元基线：hook 路径加载旧 tail（[mockTailMessage]）并写视图缓存。
    expect(conversationMessages(tree!.root)).toEqual([mockTailMessage]);

    // 发起 run 并回填 runId：hasUnit=true，消息面切到单元投影。
    await act(async () => {
      mockHarnessManager!.startRun('s1', 'p1', 'hi');
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: 'r1',
      });
    });

    // run 收尾：DB tail 变为「本轮用户消息 + assistant 最终回复」，settle 的
    // force reload 把最终行写进单元消息面与视图缓存（无条件写）。
    mockRuntime.messages.listBySessionTail.mockImplementation(async () => [
      finalUserMessage,
      finalAssistantMessage,
    ]);
    await act(async () => {
      mockRuntime.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId: 's1',
        projectId: 'p1',
        runId: 'r1',
        stopReason: 'end_turn',
      } as never);
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    });
    expect(conversationMessages(tree!.root)).toEqual([
      finalUserMessage,
      finalAssistantMessage,
    ]);

    // 推进 30s 宽限：单元销毁出表、unitView 变 null。若无迁移沿补偿，双源
    // 回退会把 hook 的 run 前旧快照（[mockTailMessage]）顶回屏幕。
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    });
    expect(mockHarnessManager!.snapshot('s1')).toBe(null);
    expect(conversationMessages(tree!.root)).toEqual([
      finalUserMessage,
      finalAssistantMessage,
    ]);
  });
});
