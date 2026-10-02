/**
 * T-FS2/T-FS3：chat 全屏编辑链的 **RN 侧**（⛶ 入口的宿主处置 / 退出回填）。
 *
 * ## Step 8 迁居说明
 *
 * 本文件原先还有 T-FS1（⛶ 与同排 @/$ 同款圆钮，量的是 RN `ChatComposer` 工具栏
 * 三个 Pressable 的展平 style）。legacy 转录引擎退役后 `ChatComposer.tsx` 整个
 * 删除、⛶ 变成 web 文档里的 `<button class="toolbar__btn toolbar__fullscreen">`，
 * RN 树里已经没有这个元素——T-FS1 因此迁到 `chat-conversation-boot-script.test.ts`
 * 的 T-CU10 段（改比「web CSS 规则 ⇄ RN 参照常量 `composerToolBtnStyle`」，
 * 参照真源是 Step 6 手抄进 `dock-style-reference.ts` 的那份）。
 *
 * 留下的 T-FS2/T-FS3 断的仍是 RN 链，入口改从 web 上行走：
 * ⛶ 点击在 web 侧派 `dockAction: 'fullscreen'`（v:2 信封）→ 宿主转交
 * composer controller → `onOpenComposerFullscreen` → 路由到 PromptEditor。
 * 输入驱动同样从 web 侧模拟：统一宿主的 ready 必须带 `v:2` + `composer-dock`
 * 能力位（缺任一项就走 8s 兜底错误态 / 输入区降级，用例会变成假绿）。
 *
 * 退出即回填（无保存按钮、无未保存拦截）与编辑器本体（markdown 预览/编辑互切）
 * 的屏内断言在 `prompt-editor-screen.test.tsx` 的 composer 变体用例里。
 */
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {
  CONVERSATION_BRIDGE_V,
  CONVERSATION_CAPABILITY_COMPOSER_DOCK,
} from '@/components/chat/ChatConversationBridge';
import {
  clearMockWebViewPostMessages,
  findMockWebViewByDomain,
  getMockWebViewPosts,
  type MockWebViewDomain,
} from '../test-utils/react-native-webview-mock';

/** 统一宿主所在的合成包域（`source.uri` 里的包名）。 */
const CONVERSATION_DOMAIN: MockWebViewDomain = 'chat-conversation';

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
  // cr2-E-2 新导出（手写 mock 需随导出面同步，缺它会炸 meta 加载链）。
  cancelPreciseUpgradeDelay: jest.fn(),
}));

jest.mock('@/storage/chat-rich-text-pref', () => ({
  readChatRichTextEnabled: jest.fn(async () => false),
}));

jest.mock('@/storage/chat-transcript-engine', () => ({
  defaultChatTranscriptEngine: () => 'webview',
  readChatTranscriptEngine: jest.fn(async () => 'webview'),
}));

jest.mock('@/services/project-composer-status.service', () => ({
  projectComposerStatusForSession: jest.fn(async () => []),
}));

jest.mock('@/errors/format-error', () => ({
  formatError: (err: unknown) => String(err),
}));

jest.mock('@/components/chrome/AppHeader', () => ({AppHeader: () => null}));
jest.mock('@/components/chat/ChatMetaBar', () => ({ChatMetaBar: () => null}));
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

/**
 * 合成包宿主 WebView 的 onMessage 入口（按域取，不靠位置）。
 *
 * 纪律：ready 必须带 `v:2` 与 `composer-dock` 能力位——旧 dist 的 v:1 ready 被
 * 拒、缺能力位则输入区走降级提示，两种情况下行全丢，用例会静默变成假绿。
 */
function findComposerWebView(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  return findMockWebViewByDomain(root, CONVERSATION_DOMAIN);
}

/** 模拟 web → host 上报（v 号由调用方给：ready / dockAction 走 2，其余 1）。 */
function simulateWebMessage(
  webView: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
  v = 1,
): void {
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {data: JSON.stringify({v, type, payload})},
    });
  });
}

/** 合成包 ready 握手（v:2 + composer-dock 能力位）。 */
function simulateConversationReady(
  root: TestRenderer.ReactTestInstance,
): void {
  simulateWebMessage(
    findComposerWebView(root),
    'ready',
    {
      version: 'u1',
      readyState: 'complete',
      capabilities: [CONVERSATION_CAPABILITY_COMPOSER_DOCK],
    },
    CONVERSATION_BRIDGE_V,
  );
}

/** ⛶ 点击：web 侧派 dockAction.fullscreen（v:2 通道）。 */
function pressFullscreen(root: TestRenderer.ReactTestInstance): void {
  simulateWebMessage(
    findComposerWebView(root),
    'dockAction',
    {action: 'fullscreen'},
    CONVERSATION_BRIDGE_V,
  );
}

/** 只看合成包域的下行（域分流：新 mock 的按域取面）。 */
function conversationPosts(): unknown[] {
  return getMockWebViewPosts(CONVERSATION_DOMAIN).map(raw => JSON.parse(raw));
}

/** 冲净 effect 与异步批（real timers）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * 进会话（第二阶段：列表已搬进 WebView 文档，RN 侧没有会话行了）。
 *
 * 断的还是同一条链——web 列表行点击 → `listAction/open` → 宿主 openConversation
 * 状态机 → 切到对话子视图；变的只是入口从「按 RN 会话卡」换成「往桥派一条上行」。
 */
async function enterConversation(
  tree: TestRenderer.ReactTestRenderer,
): Promise<void> {
  const webView = findMockWebViewByDomain(tree.root, CONVERSATION_DOMAIN);
  await act(async () => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          v: CONVERSATION_BRIDGE_V,
          type: 'listAction',
          payload: {kind: 'open', sessionId: 's1'},
        }),
      },
    });
  });
  await flush();
}

/** 同排工具按钮（@ / $ / ⛶）的展平样式，用于断言「风格一致」。 */
function flattenedStyle(node: TestRenderer.ReactTestInstance): ViewStyle {
  return StyleSheet.flatten(node.props.style) as ViewStyle;
}

describe('T-FS2/T-FS3 全屏编辑链（ChatTabScreen → 面板 → 统一宿主）', () => {
  const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

  /** 挂载 ChatTabScreen 并进入会话子视图（真实面板 + 真实统一宿主）。 */
  async function mountConversation(): Promise<TestRenderer.ReactTestRenderer> {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatTabScreen />);
    });
    mountedTrees.push(tree);
    await enterConversation(tree);
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

  it('T-FS2: ⛶ 派 dockAction.fullscreen 后带当前文本跳全屏编辑页（composer 变体）', async () => {
    const tree = await mountConversation();
    const webView = findComposerWebView(tree.root);
    simulateConversationReady(tree.root);
    await flush();

    // web 自持真源：打字经 change 上报进 composer controller 文本态。
    simulateWebMessage(webView, 'change', {text: '当前的草稿文本'});
    await flush();

    pressFullscreen(tree.root);

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

  it('T-FS3: 退出即回填 —— 写会话草稿并 bump 令牌，宿主重读后经 setText 回填', async () => {
    const tree = await mountConversation();
    const webView = findComposerWebView(tree.root);
    simulateConversationReady(tree.root);
    await flush();
    simulateWebMessage(webView, 'change', {text: '全屏前文本'});
    await flush();

    const beforeFullscreen = conversationPosts().length;
    pressFullscreen(tree.root);
    const onExit = takePromptEditorOnSaved();
    expect(onExit).not.toBeNull();

    // 全屏屏卸载（返回/手势）时把当拍草稿交回：草稿 store 更新 + 令牌 bump。
    await act(async () => {
      onExit!('全屏改完的文本');
    });
    await flush();

    expect(readChatComposerDraftState('s1').text).toBe('全屏改完的文本');
    // controller 从草稿重读 → 外部文本真变 → 宿主下发 setText（回填落地）。
    // 只看进全屏之后的下行，免得把 ready 恢复链里的草稿 setText 算进来。
    const after = conversationPosts().slice(beforeFullscreen);
    const setTexts = after.filter(
      (m): m is {type: string; payload: {text: string}} =>
        typeof m === 'object' &&
        m != null &&
        (m as {type?: string}).type === 'setText',
    );
    expect(setTexts.map(m => m.payload.text)).toContain('全屏改完的文本');
  });
});
