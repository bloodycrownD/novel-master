/**
 * T-FS1..4：chat 全屏编辑链（⛶ 入口 / 全屏屏 / 接线与保存回填）。
 *
 * 两块断言面：
 * 1) 入口与接线（真实 ChatTabScreen → ChatConversationPanel → ChatComposer 全链，
 *    照 `chat-tab-screen.integration.test.tsx` 的 mock 底座；输入驱动照
 *    `composer-input-webview.test.tsx` 的 mock WebView 协议范式）——
 *    T-FS1 ⛶ 存在与 testID；T-FS2 进入携带当前文本（callback take + 跳转）；
 *    T-FS3 保存回填（会话草稿文本更新 + ChatComposer 经 setText 桥消息回填）。
 * 2) 全屏屏（`ChatComposerEditorScreen`，真实 EditorScreenShell + 真实
 *    ComposerInputWebView）—— T-FS2 初值下发（init.mode/metrics 全高 + setText）、
 *    T-FS3 保存走 onSaved 并返回、T-FS4 系统返回被 useUnsavedGuard 拦截。
 *
 * 说明：进入全屏的导航事件用 mock 的 `navigation.navigate` 断言（jest 无真实
 * 导航栈），系统返回用 guard 注册的 `beforeRemove` 事件等价构造（与
 * `prompt-editor-screen.test.tsx` 同口径）。
 */
import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {Alert} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeHostToComposerInput,
  type ComposerInputMetrics,
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

jest.mock('@/services/session-messages-loader', () => ({
  loadSessionMessagesTail: jest.fn(async () => []),
  loadSessionMessagesPage: jest.fn(async () => []),
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
import {ChatComposerEditorScreen} from '@/screens/stack/ChatComposerEditorScreen';
import {
  readChatComposerDraftState,
  clearChatComposerDraft,
} from '@/storage/chat-composer-draft';
import {
  setComposerEditorCallback,
  takeComposerEditorCallback,
} from '@/components/chat/composer-editor-callback';

const alertSpy = jest.spyOn(Alert, 'alert');

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

/** 全屏屏的「保存」动作（EditorScreenShell 左上动作位）。 */
function pressScreenSave(tree: TestRenderer.ReactTestRenderer): void {
  act(() => {
    findPressableByTestId(tree.root, 'composer-editor-save').props.onPress();
  });
}

/** 模拟导航 beforeRemove 事件（guard 拦截/放行的入口）。 */
function emitBeforeRemove(): jest.Mock {
  const preventDefault = jest.fn();
  mockBeforeRemoveHandlers[0]!({
    preventDefault,
    data: {action: {type: 'GO_BACK'}},
  });
  return preventDefault;
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
    takeComposerEditorCallback();
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

  it('T-FS1: 工具栏 ⛶ 入口存在且带 testID（与 @/$ 同排、可按压）', async () => {
    const tree = await mountConversation();

    const matches = tree.root.findAllByProps({
      testID: 'chat-composer-fullscreen',
    });
    expect(matches.length).toBeGreaterThan(0);
    const button = findPressableByTestId(
      tree.root,
      'chat-composer-fullscreen',
    );
    expect(button.props.accessibilityLabel).toBe('全屏编辑');
    expect(button.props.disabled).toBe(false);
  });

  it('T-FS2: 点 ⛶ 携带当前输入文本（跳转 + callback take 值正确）', async () => {
    const tree = await mountConversation();
    const webView = findComposerWebView(tree.root);
    simulateWebMessage(webView, 'ready');
    await flush();

    // web 自持真源：打字经 change 上报进 ChatComposer 文本态。
    simulateWebMessage(webView, 'change', {text: '当前的草稿文本'});
    await flush();

    act(() => {
      findPressableByTestId(tree.root, 'chat-composer-fullscreen').props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('ChatComposerEditor');
    // 路由参数只传纯数据：初始文本与回调走模块级存取（take 即清空）。
    const pending = takeComposerEditorCallback();
    expect(pending?.initialText).toBe('当前的草稿文本');
    expect(typeof pending?.onSaved).toBe('function');
    // take 即清空：再取为 null（防串台）。
    expect(takeComposerEditorCallback()).toBeNull();
  });

  it('T-FS3: 保存回填 —— 写会话草稿并 bump 令牌，ChatComposer 重读后经 setText 回填', async () => {
    const tree = await mountConversation();
    const webView = findComposerWebView(tree.root);
    simulateWebMessage(webView, 'ready');
    await flush();
    simulateWebMessage(webView, 'change', {text: '全屏前文本'});
    await flush();

    act(() => {
      findPressableByTestId(tree.root, 'chat-composer-fullscreen').props.onPress();
    });
    const pending = takeComposerEditorCallback();
    expect(pending?.initialText).toBe('全屏前文本');

    // 全屏屏保存 → 父层注入的回填：草稿 store 更新 + 令牌 bump。
    await act(async () => {
      pending!.onSaved('全屏保存后的文本');
    });
    await flush();

    expect(readChatComposerDraftState('s1').text).toBe('全屏保存后的文本');
    // ChatComposer 从草稿重读 → 外部 value 变化 → 宿主下发 setText（回填落地）。
    expect(hostPayloadsOfType('setText')).toContainEqual({
      text: '全屏保存后的文本',
    });
  });
});

describe('T-FS2/T-FS3/T-FS4 全屏屏（ChatComposerEditorScreen）', () => {
  const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

  function renderScreen(): TestRenderer.ReactTestRenderer {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ChatComposerEditorScreen />);
    });
    mountedTrees.push(tree);
    return tree;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusInvoked = false;
    mockBeforeRemoveHandlers.length = 0;
    clearMockWebViewPostMessages();
    takeComposerEditorCallback();
  });

  afterEach(async () => {
    for (const tree of mountedTrees.splice(0)) {
      await act(async () => {
        tree.unmount();
      });
    }
  });

  it('T-FS2: 挂载即以 callback 的初始文本起步，init 下发 composer-token 全高 metrics', async () => {
    setComposerEditorCallback({initialText: '初稿文本', onSaved: jest.fn()});
    const tree = renderScreen();

    // 未 ready 不下发任何下行消息；ready 后 init + 初始文本一次落地。
    expect(hostMessages()).toHaveLength(0);
    simulateWebMessage(findComposerWebView(tree.root), 'ready');
    await flush();

    const expectedMetrics: ComposerInputMetrics = {
      fontSize: 16,
      lineHeight: 22,
      paddingH: 4,
      paddingV: 6,
      minHeight: 56,
      maxHeight: null,
    };
    expect(hostPayloadsOfType('init')).toEqual([
      expect.objectContaining({
        mode: 'composer-token',
        disabled: false,
        metrics: expectedMetrics,
      }),
    ]);
    // 全屏口径：解除限高（容器 flex 全高、web 侧内滚）。
    expect(hostPayloadsOfType('setText')).toEqual([{text: '初稿文本'}]);
  });

  it('T-FS3: 保存以草稿调 onSaved 并返回；未改稿时保存禁用', async () => {
    const onSaved = jest.fn();
    setComposerEditorCallback({initialText: '初稿', onSaved});
    const tree = renderScreen();
    const webView = findComposerWebView(tree.root);
    simulateWebMessage(webView, 'ready');
    await flush();

    // 干净态：保存禁用（与 PromptEditorScreen 同口径）。
    expect(
      findPressableByTestId(tree.root, 'composer-editor-save').props.disabled,
    ).toBe(true);

    simulateWebMessage(webView, 'change', {text: '改后的草稿'});
    await flush();
    expect(
      findPressableByTestId(tree.root, 'composer-editor-save').props.disabled,
    ).toBe(false);

    pressScreenSave(tree);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('改后的草稿');
    // 保存即返回（与宏链全屏「保存后停留」不同：这里回填后离开）。
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    // 基线推进：保存后回到干净态。
    expect(
      findPressableByTestId(tree.root, 'composer-editor-save').props.disabled,
    ).toBe(true);
  });

  it('T-FS4: 未保存改动被 useUnsavedGuard 拦截（干净态放行、保存后放行）', async () => {
    const onSaved = jest.fn();
    setComposerEditorCallback({initialText: '初稿', onSaved});
    const tree = renderScreen();
    const webView = findComposerWebView(tree.root);
    simulateWebMessage(webView, 'ready');
    await flush();

    // 干净态：beforeRemove 直接放行，不弹确认。
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    // 改稿（dirty）：拦截 + 弹「未保存」确认，回调不发（取消即丢弃）。
    simulateWebMessage(webView, 'change', {text: '不落盘的改动'});
    await flush();
    expect(emitBeforeRemove()).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      '未保存',
      '有未保存的更改，确定离开？',
      expect.anything(),
    );
    expect(onSaved).not.toHaveBeenCalled();

    // 保存后（干净态）：再次退出直接放行，不弹确认。
    pressScreenSave(tree);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
