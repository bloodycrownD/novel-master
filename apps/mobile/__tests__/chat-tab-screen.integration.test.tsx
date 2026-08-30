import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
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
const mockStreamBufferPush = jest.fn();
let mockLatestMessageListProps: any;
let mockStreamFlushTimer: ReturnType<typeof setTimeout> | null = null;
let mockTextBuffer = '';
// transcript 引擎按用例切换：默认 legacy-rn（既有用例），webview 用例
// （T-R3 顺序断言）切到 'webview' 挂真 ChatTranscriptWebView。
let mockTranscriptEngine: 'legacy-rn' | 'webview' = 'legacy-rn';

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
    listBySessionPage: jest.fn(async () => [{id: 'older-probe', seq: 1}]),
    hide: jest.fn(),
    show: jest.fn(),
    delete: jest.fn(),
    updateContent: jest.fn(),
  },
  state: {
    getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
    getCurrentRegexGroupId: jest.fn(async () => undefined),
  },
  eventBus: new SimpleEventBus(),
  // 重进恢复相关 registry mock：默认无 in-flight run（has=false、get=undefined）。
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

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

// 真实 useFocusEffect 只在 focus 时调 cb；若每次 render 都调，会与
// refreshChatMeta 每次 setAgentMeta 新对象组成无限重渲染循环，act 永不结束。
// 与 chat-tab-screen-legacy-scroll.test.tsx 保持同一契约：仅在首次 focus 时调一次。
let mockFocusInvoked = false;
jest.mock('@react-navigation/native', () => ({
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

jest.mock('../src/services/regex-apply-channel', () => ({
  loadSessionMessagesTailForDisplay: (...args: any[]) => mockLoadTail(...args),
  loadSessionMessagesPageForDisplay: (...args: any[]) => mockLoadPage(...args),
}));

jest.mock('../src/services/stream-apply-buffer', () => ({
  createStreamApplyBuffer: (
    onFlush: (segments: {kind: string; delta: string}[]) => void,
  ) => ({
    push: (chunk: {kind: string; delta: string}) => {
      mockStreamBufferPush(chunk.kind, chunk.delta);
      if (chunk.kind !== 'text') {
        return;
      }
      mockTextBuffer += chunk.delta;
      if (mockStreamFlushTimer == null) {
        mockStreamFlushTimer = setTimeout(() => {
          onFlush([{kind: 'text', delta: mockTextBuffer}]);
          mockTextBuffer = '';
          mockStreamFlushTimer = null;
        }, 40);
      }
    },
    pushAll: (chunks: {kind: string; delta: string}[]) => {
      for (const chunk of chunks) {
        mockStreamBufferPush(chunk.kind, chunk.delta);
      }
      if (mockStreamFlushTimer == null) {
        mockStreamFlushTimer = setTimeout(() => {
          onFlush(chunks);
          mockStreamFlushTimer = null;
        }, 40);
      }
    },
    flush: () => undefined,
    reset: () => {
      mockTextBuffer = '';
      if (mockStreamFlushTimer != null) {
        clearTimeout(mockStreamFlushTimer);
        mockStreamFlushTimer = null;
      }
    },
    dispose: () => undefined,
  }),
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
  BottomSheetMenu: () => null,
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

jest.mock('../src/storage/chat-stream-batch-pref', () => ({
  readChatStreamBatchEnabled: jest.fn(async () => true),
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
            // 真实契约：UI 先 beginUiRun 置位 uiRunning，RUN_STARTED 才不会被
            // stale 守卫丢弃；delta 再带同一 runId 才能过 acceptRunEvent 守卫。
            props.beginUiRun?.();
            bus.publish(EVENT_AGENT_RUN_STARTED, {
              sessionId: 's1',
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

describe('ChatTabScreen integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFocusInvoked = false;
    mockLatestMessageListProps = undefined;
    mockLoadTail.mockClear();
    mockLoadPage.mockClear();
    mockStreamBufferPush.mockClear();
    mockRuntime.messages.listBySession.mockClear();
    mockRuntime.messages.listBySessionPage.mockClear();
    mockTextBuffer = '';
    // 重进恢复相关 mock 复位（个别用例会覆盖实现）
    mockTranscriptEngine = 'legacy-rn';
    clearMockWebViewPostMessages();
    mockRuntime.abortRegistry.has.mockImplementation(() => false);
    mockRuntime.streamRegistry.get.mockImplementation(() => undefined);
    if (mockStreamFlushTimer != null) {
      clearTimeout(mockStreamFlushTimer);
      mockStreamFlushTimer = null;
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads initial tail and paginates older without listBySession dependency', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });

    const sessionCard = findPressableByText(
      (tree as TestRenderer.ReactTestRenderer).root,
      'S1',
    );
    await act(async () => {
      sessionCard.props.onPress();
    });

    expect(mockLoadTail).toHaveBeenCalledWith(mockRuntime, 's1', 40);
    expect(mockRuntime.messages.listBySession).not.toHaveBeenCalled();

    const loadMore = findPressableByText(
      (tree as TestRenderer.ReactTestRenderer).root,
      '加载更早消息',
    );
    await act(async () => {
      loadMore.props.onPress();
    });

    expect(mockLoadPage).toHaveBeenCalledWith(mockRuntime, 's1', {
      limit: 40,
      beforeSeq: 2,
    });
  });

  it('wires bursty stream deltas through throttled flush to UI state', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });

    const sessionCard = findPressableByText(
      (tree as TestRenderer.ReactTestRenderer).root,
      'S1',
    );
    await act(async () => {
      sessionCard.props.onPress();
    });

    const emit = (tree as TestRenderer.ReactTestRenderer).root.find(
      node => node.props?.accessibilityLabel === 'emit-bursty-stream',
    );
    await act(async () => {
      emit.props.onPress();
    });
    // useSessionBatch 先过 32ms ingress 合并 queue，delta 不会同步进 apply buffer。
    expect(mockStreamBufferPush).not.toHaveBeenCalled();
    expect(mockLatestMessageListProps.streamingText).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(32);
    });
    // 合并后仅一块 text chunk 进 apply buffer。
    expect(mockStreamBufferPush).toHaveBeenCalledTimes(1);
    expect(mockStreamBufferPush).toHaveBeenCalledWith('text', 'ABC');
    expect(mockLatestMessageListProps.streamingText).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(41);
    });
    expect(mockLatestMessageListProps.streamingText).toBe('ABC');
  });

  it('T-R3 顺序：重进恢复注入的 streamDelta 晚于 sessionSnapshot（先 snapshot 后 inject）', async () => {
    // 重进恢复现场：s1 仍有 in-flight run（has=true）且 streamRegistry 已有
    // partial；webview 引擎下挂真 ChatTranscriptWebView，sessionSnapshot 与注入
    // delta 都经 bridge 的 postToWeb（webview mock 落盘）按序记录。
    mockTranscriptEngine = 'webview';
    mockRuntime.abortRegistry.has.mockImplementation(() => true);
    mockRuntime.streamRegistry.get.mockImplementation(() => ({
      text: '重进恢复的 partial 正文',
      thinking: '',
    }));
    clearMockWebViewPostMessages();

    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    const root = (tree as TestRenderer.ReactTestRenderer).root;

    // 进入会话：探针恢复方向合成 markRunStarted（uiRunning=true），
    // messages 经 mockLoadTail 加载非空（先于 webview ready）
    const sessionCard = findPressableByText(root, 'S1');
    await act(async () => {
      sessionCard.props.onPress();
    });

    // web 侧 ready：webReady=true 后子组件 messages effect 直发
    // sessionSnapshot（needsOpenSnapshot 路径），注入 effect 随后把
    // registry partial 经 pushStreamDelta（RAF 冲洗）注入。
    const WebViewMock = require('react-native-webview').default as React.ComponentType<{
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
    // 本用例未发布任何流式事件，streamDelta 只可能来自重进注入，内容即 partial
    const delta = sentMessages.find(m => m.type === 'streamDelta');
    if (delta?.type === 'streamDelta') {
      expect(delta.payload.delta).toBe('重进恢复的 partial 正文');
    }
  });
});
