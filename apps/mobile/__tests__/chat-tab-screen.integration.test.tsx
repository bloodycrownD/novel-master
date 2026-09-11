import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {clearAllSessionViewCaches} from '../src/services/chat-session-view-cache';
import {
  CHAT_TRANSCRIPT_BRIDGE_VERSION,
  decodeHostToTranscript,
} from '../src/components/chat/ChatTranscriptBridge';
import {
  clearMockWebViewPostMessages,
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
let mockLatestMessageListProps: any;
let mockLatestBottomSheetProps: any;
// transcript 引擎按用例切换：默认 legacy-rn（既有用例），webview 用例
// （T-R3 顺序断言）切到 'webview' 挂真 ChatTranscriptWebView。
let mockTranscriptEngine: 'legacy-rn' | 'webview' = 'legacy-rn';

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
  workplace: jest.fn(() => ({})),
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
jest.mock('../src/components/chat/MessageActionMenu', () => ({
  MessageActionMenu: () => null,
}));
jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: (props: any) => {
    mockLatestBottomSheetProps = props;
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

jest.mock('../src/storage/chat-transcript-engine', () => ({
  defaultChatTranscriptEngine: () => mockTranscriptEngine,
  readChatTranscriptEngine: jest.fn(async () => mockTranscriptEngine),
}));

jest.mock('../src/components/chat/MessageList', () => {
  const ReactNative = require('react-native');
  return {
    MessageList: (props: any) => {
      mockLatestMessageListProps = props;
      return props.listHeaderComponent ?? null;
    },
  };
});

jest.mock('../src/components/chat/ChatComposer', () => {
  const ReactNative = require('react-native');
  const {
    EVENT_AGENT_RUN_STARTED,
    EVENT_AGENT_STREAM_TEXT_DELTA,
  } = require('@novel-master/core/events');
  return {
    ChatComposer: (props: any) => (
      <ReactNative.View>
        <ReactNative.Pressable
          accessibilityLabel="emit-bursty-stream"
          onPress={() => {
            const bus = mockRuntime.eventBus;
            mockHarnessManager?.startRun('s1', 'p1', 'hi');
            bus.publish(EVENT_AGENT_RUN_STARTED, {
              sessionId: 's1',
              projectId: 'p1',
              runId: 'r1',
            });
            bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
              sessionId: 's1',
              runId: 'r1',
              text: 'A',
            });
            bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
              sessionId: 's1',
              runId: 'r1',
              text: 'B',
            });
            bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
              sessionId: 's1',
              runId: 'r1',
              text: 'C',
            });
          }}
        />
      </ReactNative.View>
    ),
  };
});

import {ChatTabScreen} from '../src/screens/tabs/ChatTabScreen';

function findPressableByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance {
  const node = root
    .findAll(n => typeof n.props?.onPress === 'function')
    .find(n => {
      const selfText =
        typeof n.props?.children === 'string' &&
        n.props.children.includes(text);
      if (selfText) {
        return true;
      }
      const descendants = n.findAll(
        d =>
          typeof d.props?.children === 'string' &&
          d.props.children.includes(text),
      );
      return descendants.length > 0;
    });
  if (!node) {
    throw new Error(`pressable not found: ${text}`);
  }
  return node;
}

async function enterConversation(
  tree: TestRenderer.ReactTestRenderer,
): Promise<void> {
  const sessionCard = findPressableByText(tree.root, 'S1');
  await act(async () => {
    sessionCard.props.onPress();
  });
}

describe('ChatTabScreen integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFocusInvoked = false;
    mockLatestMessageListProps = undefined;
    mockLatestBottomSheetProps = undefined;
    mockLoadTail.mockClear();
    mockLoadPage.mockClear();
    mockRunAgentTurn.mockClear();
    mockRuntime.messages.listBySession.mockClear();
    mockRuntime.messages.listBySessionTail.mockClear();
    mockRuntime.messages.listBySessionPage.mockClear();
    // 每用例重建 eventBus 与 manager（与 Provider retry 重建同形：先 dispose）。
    mockHarnessManager?.dispose();
    mockRuntime.eventBus = new SimpleEventBus();
    mockHarnessManager = buildHarnessManager();
    mockRuntime.sessionStreamUnitManager = mockHarnessManager;
    // 视图缓存是模块级单例，跨用例残留会干扰「回源 vs 缓存命中」断言。
    clearAllSessionViewCaches();
    // 重进恢复相关 mock 复位（个别用例会覆盖实现）
    mockTranscriptEngine = 'legacy-rn';
    clearMockWebViewPostMessages();
    mockRuntime.abortRegistry.has.mockImplementation(() => false);
    mockRuntime.streamRegistry.get.mockImplementation(() => undefined);
  });

  afterEach(() => {
    mockHarnessManager?.dispose();
    mockHarnessManager = undefined;
    jest.useRealTimers();
  });

  it('loads initial tail and paginates older without listBySession dependency', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    await enterConversation(tree!);

    // 无单元（非运行态会话）：useChatTabMessages 数据管线兜底。
    expect(mockLoadTail).toHaveBeenCalledWith(mockRuntime, 's1', 40);
    expect(mockRuntime.messages.listBySession).not.toHaveBeenCalled();

    const loadMore = findPressableByText(tree!.root, '加载更早消息');
    await act(async () => {
      loadMore.props.onPress();
    });

    expect(mockLoadPage).toHaveBeenCalledWith(mockRuntime, 's1', {
      limit: 40,
      beforeSeq: 2,
    });
  });

  it('有单元时消息面走单元管线：tail 由 listBySessionTail 回源、分页走单元窄口', async () => {
    // 先建立 s1 的活跃单元（startRun 受理 + RUN_STARTED 回填）。
    mockHarnessManager!.startRun('s1', 'p1', 'hi');
    mockRuntime.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });

    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    await enterConversation(tree!);

    // 单元消息面：listBySessionTail（单元窄口）而非 session-messages-loader。
    expect(mockRuntime.messages.listBySessionTail).toHaveBeenCalledWith('s1', {
      limit: 40,
    });
    expect(mockLoadTail).not.toHaveBeenCalled();

    const loadMore = findPressableByText(tree!.root, '加载更早消息');
    await act(async () => {
      loadMore.props.onPress();
    });

    expect(mockRuntime.messages.listBySessionPage).toHaveBeenCalledWith(
      's1',
      {limit: 40, beforeSeq: 2},
    );
    expect(mockLoadPage).not.toHaveBeenCalled();
  });

  it('wires bursty stream deltas through unit buffers to projection partial', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    await enterConversation(tree!);

    const emit = tree!.root.find(
      node => node.props?.accessibilityLabel === 'emit-bursty-stream',
    );
    await act(async () => {
      emit.props.onPress();
    });
    // 单元 ingress 32ms 合并窗口：delta 不会同步进 apply 缓冲，投影不动。
    expect(mockLatestMessageListProps.streamingText).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(32);
    });
    // 合并后一块 text chunk 进 apply 缓冲（64ms 节拍未到），投影仍不动。
    expect(mockLatestMessageListProps.streamingText).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(64);
    });
    // apply 节拍到：partial 进投影，legacy MessageList 的 streamingText
    // props 从投影读取。
    expect(mockLatestMessageListProps.streamingText).toBe('ABC');
  });

  it('T-R3 顺序：重进注入的 streamDelta 晚于 sessionSnapshot（先 snapshot 后 inject）', async () => {
    // 重进恢复现场：s1 的 run 进行中且单元已有 partial；webview 引擎下挂真
    // ChatTranscriptWebView，sessionSnapshot 与注入 delta 都经 bridge 的
    // postToWeb（webview mock 落盘）按序记录。
    mockTranscriptEngine = 'webview';
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
      tree = TestRenderer.create(<ChatTabScreen />);
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
    const WebViewMock = require('react-native-webview')
      .default as React.ComponentType<{
      onMessage?: (event: {nativeEvent: {data: string}}) => void;
    }>;
    const webViews = root
      .findAllByType(WebViewMock)
      .filter(n => typeof n.props.onMessage === 'function');
    expect(webViews).toHaveLength(1);
    await act(async () => {
      webViews[0]!.props.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
            type: 'ready',
            payload: {version: 'test'},
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

    const sentMessages = mockWebViewPostMessages.map(raw =>
      decodeHostToTranscript(raw),
    );
    const types = sentMessages.map(m => m.type);
    const snapshotIdx = types.indexOf('sessionSnapshot');
    const deltaIdx = types.indexOf('streamDelta');
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThanOrEqual(0);
    // 先 snapshot 后 inject：第一条 sessionSnapshot 的调用序号必须小于任何
    // 注入产生的 stream/delta 消息（snapshot 建立基线后 delta 才有意义）
    expect(snapshotIdx).toBeLessThan(deltaIdx);
    // 本用例的流式 delta 已在挂屏前进投影（attach 前已 apply），streamDelta
    // 只可能来自重进注入，内容即单元 partial。
    const delta = sentMessages.find(m => m.type === 'streamDelta');
    if (delta?.type === 'streamDelta') {
      expect(delta.payload.delta).toBe('重进恢复的 partial 正文');
    }
  });

  it('会话列表停止入口：run 活跃时菜单出现「停止生成」并调 manager.stopRun', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });

    // 无活跃 run：长按菜单不含停止项。
    await act(async () => {
      findPressableByText(tree!.root, 'S1');
    });
    const menuDots = tree!.root.findAll(
      n => typeof n.props?.onPress === 'function' && n.props?.hitSlop != null,
    )[0];
    await act(async () => {
      menuDots.props.onPress({stopPropagation: () => undefined});
    });
    expect(mockLatestBottomSheetProps.items.map((i: any) => i.action)).toEqual(
      ['rename', 'copy', 'delete'],
    );

    // s1 run 活跃（受理即 starting）：菜单出现停止项，点击调 stopRun。
    mockHarnessManager!.startRun('s1', 'p1', 'hi');
    await act(async () => {
      await Promise.resolve();
    });
    const stopSpy = jest.spyOn(mockHarnessManager!, 'stopRun');
    await act(async () => {
      mockLatestBottomSheetProps.onSelect('stop-generating');
    });
    expect(stopSpy).toHaveBeenCalledWith('s1');
    stopSpy.mockRestore();
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
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    await enterConversation(tree!);

    // 无单元基线：hook 路径加载旧 tail（[mockTailMessage]）并写视图缓存。
    expect(mockLatestMessageListProps.messages).toEqual([mockTailMessage]);

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
    expect(mockLatestMessageListProps.messages).toEqual([
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
    expect(mockLatestMessageListProps.messages).toEqual([
      finalUserMessage,
      finalAssistantMessage,
    ]);
  });
});
