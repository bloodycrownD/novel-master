/**
 * T-FS1..3：chat 全屏编辑链（⛶ 入口 / 接线 / 退出回填）。
 *
 * 断言面（真实 ChatTabScreen → ChatConversationPanel → ChatComposer 全链，照
 * `chat-tab-screen.integration.test.tsx` 的 mock 底座；输入驱动照
 * `composer-input-webview.test.tsx` 的 mock WebView 协议范式）：
 * - T-FS1 ⛶ 存在、带 testID，且**与同排 @ / $ 同款圆钮**（尺寸/圆角/描边一致）；
 * - T-FS2 点 ⛶ 跳智能体配置那套全屏编辑页（PromptEditor 的 composer 变体），
 *   路由参数只带纯数据（初始文本 + title + variant）；
 * - T-FS3 退出回填：回写会话草稿文本 + bump 令牌，ChatComposer 经 setText 桥
 *   消息把文本落回输入框。
 *
 * 退出即回填（无保存按钮、无未保存拦截）与编辑器本体（markdown 预览/编辑互切）
 * 的屏内断言在 `prompt-editor-screen.test.tsx` 的 composer 变体用例里。
 */
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {StyleSheet, type ViewStyle} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeHostToComposerInput,
  type HostToComposerInputMessage,
} from '@/components/chat/ComposerInputBridge';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

// —— mock 前缀变量（jest.mock 工厂只能引用 mock* 前缀标识符）——

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockSetOptions = jest.fn();
/** guard 注册的 beforeRemove handler 槽位（每次 effect 重跑覆盖为最新）。 */
const mockBeforeRemoveHandlers: ((event: {
  preventDefault: () => void;
  data: {action: unknown};
}) => void)[] = [];
let mockFocusInvoked = false;
const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  dispatch: mockDispatch,
  setOptions: mockSetOptions,
  addListener: (
    event: string,
    handler: (e: {preventDefault: () => void; data: {action: unknown}}) => void,
  ) => {
    if (event === 'beforeRemove') {
      mockBeforeRemoveHandlers[0] = handler;
    }
    return () => undefined;
  },
};

/** 草稿持久层的窄口：内存 Map 保证「写后读」一致（回填链路要重读草稿）。 */
const mockDraftJsonBySession = new Map<string, string | null>();

const mockRunAgentTurn = jest.fn(
  () => new Promise(() => undefined) as Promise<unknown>,
);

const mockRuntime: Record<string, any> = {
  projects: {
    list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
    get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
  },
  sessions: {
    listByProject: jest.fn(async () => [
      {id: 's1', title: 'S1', updatedAtMs: 1},
    ]),
    get: jest.fn(async () => ({id: 's1', projectId: 'p1'})),
    getComposerDraftJson: jest.fn(async (id: string) =>
      mockDraftJsonBySession.has(id) ? mockDraftJsonBySession.get(id)! : null,
    ),
    setComposerDraftJson: jest.fn(async (id: string, json: string | null) => {
      mockDraftJsonBySession.set(id, json);
      return true;
    }),
  },
  messages: {
    listBySession: jest.fn(async () => []),
    listBySessionTail: jest.fn(async () => []),
    listBySessionPage: jest.fn(async () => []),
  },
  state: {
    getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
  },
  preferences: {
    getLlmStreamEnabled: jest.fn(async () => true),
  },
  eventBus: new SimpleEventBus(),
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

let mockHarnessManager: SessionStreamUnitManager | undefined;

function buildHarnessManager(): SessionStreamUnitManager {
  const manager = new SessionStreamUnitManager({
    runtime: mockRuntime as never,
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
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      border: '#222',
      borderLight: '#333',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      selection: '#08f55',
      danger: '#f33',
      tabBarBackground: '#000',
    },
  }),
}));

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/hooks/useMobileScope', () => ({
  useMobileScope: () => ({
    projectId: 'p1',
    sessionId: 's1',
    setCurrentProject: jest.fn(async () => undefined),
    setCurrentSession: jest.fn(async () => undefined),
    refreshScope: jest.fn(async () => undefined),
  }),
}));

jest.mock('@/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setChat: jest.fn(), setStackOverride: jest.fn()}),
  useStackOverrideSetter: () => jest.fn(),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({
    appUi: {get: jest.fn(async () => 'false')},
    richRenderEpoch: 0,
  }),
}));

jest.mock('@/services/chat-agent-meta', () => {
  const actual = jest.requireActual(
    '@/services/chat-agent-meta',
  ) as Record<string, unknown>;
  return {
    ...actual,
    loadChatAgentMeta: jest.fn(async () => ({
      source: 'session',
      agentId: 'a1',
      agentName: 'Agent',
      modelLabel: 'Model',
      tokenLabel: '',
      hasDedicatedModel: false,
      modelSource: 'session',
    })),
  };
});

jest.mock('@/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
}));

jest.mock('@/storage/chat-rich-text-pref', () => ({
  readChatRichTextEnabled: jest.fn(async () => false),
}));

jest.mock('@/storage/chat-transcript-engine', () => ({
  defaultChatTranscriptEngine: () => 'legacy-rn',
  readChatTranscriptEngine: jest.fn(async () => 'legacy-rn'),
}));

jest.mock('@/services/project-composer-status.service', () => ({
  projectComposerStatusForSession: jest.fn(async () => []),
}));

jest.mock('@/errors/format-error', () => ({
  formatError: (err: unknown) => String(err),
}));

jest.mock('@/components/chrome/AppHeader', () => ({AppHeader: () => null}));
jest.mock('@/components/chat/ChatMetaBar', () => ({ChatMetaBar: () => null}));
jest.mock('@/components/chat/MessageActionMenu', () => ({
  MessageActionMenu: () => null,
}));
jest.mock('@/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));
jest.mock('@/components/chrome/ProjectDrawer', () => ({
  ProjectDrawer: () => null,
}));
jest.mock('@/components/provider/ModelPickerModal', () => ({
  ModelPickerModal: () => null,
}));
jest.mock('@/components/vfs/VfsFileManager', () => ({
  VfsFileManager: () => null,
}));
jest.mock('@/components/batch/ManageHeader', () => ({
  ManageHeader: () => null,
}));
jest.mock('@/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));
jest.mock('@/components/ui/SegmentedControl', () => ({
  SegmentedControl: () => null,
}));
jest.mock('@/components/ui/Buttons', () => ({PrimaryButton: () => null}));
jest.mock('@/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));
jest.mock('@/components/chat/MessageList', () => {
  const actual = jest.requireActual(
    '@/components/chat/MessageList',
  ) as Record<string, unknown>;
  return {...actual, MessageList: () => null};
});
jest.mock('@/components/chat/AttachmentDraftChips', () => ({
  AttachmentDraftChips: () => null,
  ComposerStatusChips: () => null,
}));
jest.mock('@/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: () => null,
}));
jest.mock('@/components/skills/SkillPicker', () => ({
  SkillPicker: () => null,
}));

(global as any).__DEV__ = false;

import {ChatTabScreen} from '@/screens/tabs/ChatTabScreen';
import {
  readChatComposerDraftState,
  clearChatComposerDraft,
} from '@/storage/chat-composer-draft';
import {takePromptEditorOnSaved} from '@/components/agent/prompt-editor-callback';

/** mock WebView 的 onMessage 入口（composer 宿主实例）。 */
function findComposerWebView(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  const WebViewMock = require('react-native-webview')
    .default as React.ComponentType<unknown>;
  const nodes = root.findAllByType(WebViewMock);
  if (nodes.length === 0) {
    throw new Error('composer WebView 未挂载');
  }
  return nodes[0]!;
}

/** 模拟 web → host 上报（信封 v 取本包 BRIDGE_V）。 */
function simulateWebMessage(
  webView: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({v: COMPOSER_INPUT_BRIDGE_VERSION, type, payload}),
      },
    });
  });
}

function hostMessages(): HostToComposerInputMessage[] {
  return mockWebViewPostMessages.map(raw => decodeHostToComposerInput(raw));
}

function hostPayloadsOfType(type: string): unknown[] {
  return hostMessages()
    .filter(message => message.type === type)
    .map(message => message.payload);
}

/** 冲净 effect 与异步批（real timers）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

function findPressableByTestId(
  root: TestRenderer.ReactTestInstance,
  testID: string,
): TestRenderer.ReactTestInstance {
  const node = root
    .findAllByProps({testID})
    .find(n => typeof n.props.onPress === 'function');
  if (!node) {
    throw new Error(`pressable not found: ${testID}`);
  }
  return node;
}

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
      return (
        n.findAll(
          d =>
            typeof d.props?.children === 'string' &&
            d.props.children.includes(text),
        ).length > 0
      );
    });
  if (!node) {
    throw new Error(`pressable not found: ${text}`);
  }
  return node;
}

/** 同排工具按钮（@ / $ / ⛶）的展平样式，用于断言「风格一致」。 */
function flattenedStyle(node: TestRenderer.ReactTestInstance): ViewStyle {
  return StyleSheet.flatten(node.props.style) as ViewStyle;
}

describe('T-FS1/T-FS2/T-FS3 入口与接线（ChatTabScreen → 面板 → ChatComposer）', () => {
  const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

  /** 挂载 ChatTabScreen 并进入会话子视图（真实面板 + 真实 ChatComposer）。 */
  async function mountConversation(): Promise<TestRenderer.ReactTestRenderer> {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    mountedTrees.push(tree);
    const sessionCard = findPressableByText(tree.root, 'S1');
    await act(async () => {
      sessionCard.props.onPress();
    });
    await flush();
    return tree;
  }

  beforeEach(() => {
    mockFocusInvoked = false;
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockBeforeRemoveHandlers.length = 0;
    mockDraftJsonBySession.clear();
    clearChatComposerDraft('s1');
    clearMockWebViewPostMessages();
    // 模块级回调不留残留（各用例自行 set）。
    takePromptEditorOnSaved();
    mockHarnessManager?.dispose();
    mockRuntime.eventBus = new SimpleEventBus();
    mockHarnessManager = buildHarnessManager();
    mockRuntime.sessionStreamUnitManager = mockHarnessManager;
  });

  afterEach(async () => {
    for (const tree of mountedTrees.splice(0)) {
      await act(async () => {
        tree.unmount();
      });
    }
    mockHarnessManager?.dispose();
    mockHarnessManager = undefined;
  });

  it('T-FS1: ⛶ 与同排 @/$ 同款圆钮（同尺寸/圆角/描边，可按压）', async () => {
    const tree = await mountConversation();

    const matches = tree.root.findAllByProps({
      testID: 'chat-composer-fullscreen',
    });
    expect(matches.length).toBeGreaterThan(0);
    const button = findPressableByTestId(tree.root, 'chat-composer-fullscreen');
    expect(button.props.accessibilityLabel).toBe('全屏编辑');
    expect(button.props.disabled).toBe(false);

    // 同排风格一致（用户反馈：⛶ 曾是 28 无边框小触达，与 36 圆钮的 @/$ 不齐）。
    const atButton = tree.root
      .findAll(n => typeof n.props?.onPress === 'function')
      .find(n => n.props?.accessibilityLabel === '引用文件')!;
    const glyph = flattenedStyle(button);
    const at = flattenedStyle(atButton);
    expect(glyph.width).toBe(at.width);
    expect(glyph.height).toBe(at.height);
    expect(glyph.borderRadius).toBe(at.borderRadius);
    expect(glyph.borderWidth).toBe(at.borderWidth);
  });

  it('T-FS2: 点 ⛶ 带当前文本跳智能体配置那套全屏编辑页（composer 变体）', async () => {
    const tree = await mountConversation();
    const webView = findComposerWebView(tree.root);
    simulateWebMessage(webView, 'ready');
    await flush();

    // web 自持真源：打字经 change 上报进 ChatComposer 文本态。
    simulateWebMessage(webView, 'change', {text: '当前的草稿文本'});
    await flush();

    act(() => {
      findPressableByTestId(
        tree.root,
        'chat-composer-fullscreen',
      ).props.onPress();
    });

    // 复用 PromptEditor（与智能体配置同一屏同一组件），变体决定「无保存、退出回填」。
    // projectId/sessionId 是 @/$ tag typeahead/选择器的 scope（纯数据，可序列化）。
    expect(mockNavigate).toHaveBeenCalledWith('PromptEditor', {
      title: '编辑消息',
      initialText: '当前的草稿文本',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    });
    // 回调走模块级存取（不可序列化，不进路由参数），未消费前只有 set 的这一次。
    expect(typeof takePromptEditorOnSaved()).toBe('function');
  });

  it('T-FS3: 退出即回填 —— 写会话草稿并 bump 令牌，ChatComposer 重读后经 setText 回填', async () => {
    const tree = await mountConversation();
    const webView = findComposerWebView(tree.root);
    simulateWebMessage(webView, 'ready');
    await flush();
    simulateWebMessage(webView, 'change', {text: '全屏前文本'});
    await flush();

    act(() => {
      findPressableByTestId(
        tree.root,
        'chat-composer-fullscreen',
      ).props.onPress();
    });
    const onExit = takePromptEditorOnSaved();
    expect(onExit).not.toBeNull();

    // 全屏屏卸载（返回/手势）时把当拍草稿交回：草稿 store 更新 + 令牌 bump。
    await act(async () => {
      onExit!('全屏改完的文本');
    });
    await flush();

    expect(readChatComposerDraftState('s1').text).toBe('全屏改完的文本');
    // ChatComposer 从草稿重读 → 外部 value 变化 → 宿主下发 setText（回填落地）。
    expect(hostPayloadsOfType('setText')).toContainEqual({
      text: '全屏改完的文本',
    });
  });
});
