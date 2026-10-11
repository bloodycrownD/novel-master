/**
 * T-FS2/T-FS3：chat 全屏编辑链的 **RN 侧**（⛶ 入口的宿主处置 / 退出回填）。
 *
 * ## 形态变迁
 *
 * T-FS1（⛶ 与同排 @/$ 同款圆钮的展平样式）随 legacy 转录引擎退役迁到
 * `chat-conversation-boot-script.test.ts` 的 T-CU10 段；composer-native-2026-10
 * 后 ⛶ 回到 RN——`NativeChatComposer` toolbar 的 fullscreen Pressable（其样式
 * 数值由 `native-composer-dock.test.tsx` 的 T-NC10 ⇄ dock-style.ts 断言面接管，
 * 按钮三态由同文件 T-NC7 锁）。
 *
 * 留下的 T-FS2/T-FS3 断的仍是 RN **全链路**，入口从 web 上行换成组件直连
 * （composer-native-2026-10 Step 5 起）：⛶ 点击 → 组件 emitDockAction('fullscreen')
 * → 面板转 controller.handleDockAction → openFullscreen → onOpenComposerFullscreen
 * → ChatTabScreen 路由 PromptEditor（composer 变体）。输入驱动经
 * `onComposerChangeText` 直连 controller（打字真源在输入组件内部，RN 侧落草稿 +
 * text 镜像）。**panel.integration 锁不到这段**：它 mock 掉 ChatTabProvider ctx
 * 与 NativeChatComposer，路由落点（navigate 参数）与退出回填只有本文件能断。
 *
 * 退出即回填（无保存按钮、无未保存拦截）：onExit → 写草稿 + bump
 * draftRestoreToken → controller 水化链重读 → **M7 命令式通道 ref.setText** →
 * 输入组件 setValue（断言面 = enriched-markdown-mock 的 `mockCalls.setValue`；
 * 旧「宿主下行 setText」桥消息已随 D4b 退役）。转录 webview（chat-transcript
 * 独立包）与 composer 链并行零依赖（D8），本文件不再做 ready 握手。
 *
 * 输入基座（EnrichedMarkdownTextInput）经 jest moduleNameMapper 落到
 * `test-utils/enriched-markdown-mock`——真实 `NativeChatComposer` 可渲染，断言
 * 视角是「全链路对 mock 输入组件的驱动行为」。
 *
 * 编辑器本体（markdown 预览/编辑互切）的屏内断言在
 * `prompt-editor-screen.test.tsx` 的 composer 变体用例里。
 */
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {SimpleEventBus} from '@novel-master/core/events';
import {SessionStreamUnitManager} from '../src/services/session-stream-unit-manager.service';
import {NativeChatComposer} from '@/components/chat/NativeChatComposer';
import {
  mockCalls,
  resetMockCalls,
} from '../test-utils/enriched-markdown-mock';

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
  cancelPreciseUpgrade: jest.fn(),
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
 * 树里的原生 dock 组件实例（props 即面板 → composer 的全量接线面）。
 *
 * 用 `type` 判等而非 testID：`native-composer-dock` 在根 View 与组件元素上
 * 双双可见（findByProps 会先命中组件 fiber，拿不到 props 消费面）。
 */
function findComposerDock(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  const dock = root.findAll(n => n.type === NativeChatComposer);
  if (dock.length === 0) {
    throw new Error('NativeChatComposer 未渲染');
  }
  return dock[0]!;
}

/** 打字：面板 `onComposerChangeText` 直连 controller（落草稿 + text 镜像）。 */
function typeComposerText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): void {
  act(() => {
    findComposerDock(root).props.onComposerChangeText(text);
  });
}

/**
 * ⛶ 点击：toolbar 的 fullscreen Pressable（D5/K 组）。
 *
 * 按钮可用性（`fullscreenEnabled` = ChatTabScreen 注入了 ⛶ 回调）是既有通路，
 * 这里同时锁「按钮触发 → onDockAction('fullscreen') → controller 转发」整段。
 */
function pressFullscreen(root: TestRenderer.ReactTestInstance): void {
  const button = root.findAll(n => n.props?.testID === 'composer-fullscreen');
  if (button.length === 0) {
    throw new Error('⛶ 全屏按钮（composer-fullscreen）未渲染');
  }
  act(() => {
    button[0]!.props.onPress();
  });
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
 * 进会话（回滚 SPA 化后：会话列表回到 RN 侧）。
 *
 * 断的还是同一条链——RN 会话行点击 → onOpenConversation → 宿主状态机 →
 * 切到对话子视图（对话面板随之条件挂载）。
 */
async function enterConversation(
  tree: TestRenderer.ReactTestRenderer,
): Promise<void> {
  const sessionCard = tree.root
    .findAll(n => typeof n.props?.onPress === 'function')
    .find(n => {
      const selfText =
        typeof n.props?.children === 'string' &&
        n.props.children.includes('S1');
      if (selfText) {
        return true;
      }
      return (
        n.findAll(
          d =>
            typeof d.props?.children === 'string' &&
            d.props.children.includes('S1'),
        ).length > 0
      );
    });
  if (sessionCard == null) {
    throw new Error('会话行（S1）未渲染');
  }
  await act(async () => {
    sessionCard.props.onPress();
  });
  await flush();
}

/** 同排工具按钮（@ / $ / ⛶）的展平样式，用于断言「风格一致」。 */
function flattenedStyle(node: TestRenderer.ReactTestInstance): ViewStyle {
  return StyleSheet.flatten(node.props.style) as ViewStyle;
}

describe('T-FS2/T-FS3 全屏编辑链（ChatTabScreen → 面板 → NativeChatComposer）', () => {
  const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

  /** 挂载 ChatTabScreen 并进入会话子视图（真实面板 + 真实原生 composer）。 */
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
    resetMockCalls();
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

  it('T-FS2: ⛶ 点击经 onDockAction.fullscreen 带当前文本跳全屏编辑页（composer 变体）', async () => {
    const tree = await mountConversation();

    // 打字经组件 onComposerChangeText 直连 controller 文本态（落草稿）。
    typeComposerText(tree.root, '当前的草稿文本');
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

  it('T-FS3: 退出即回填 —— 写会话草稿并 bump 令牌，水化链经 M7 ref.setText 回填输入框', async () => {
    const tree = await mountConversation();
    typeComposerText(tree.root, '全屏前文本');
    await flush();

    // 只看进全屏之后输入组件收到的写入（打字路径不产生 setValue，M6）。
    resetMockCalls();
    pressFullscreen(tree.root);
    const onExit = takePromptEditorOnSaved();
    expect(onExit).not.toBeNull();

    // 全屏屏卸载（返回/手势）时把当拍草稿交回：草稿 store 更新 + 令牌 bump。
    await act(async () => {
      onExit!('全屏改完的文本');
    });
    await flush();

    expect(readChatComposerDraftState('s1').text).toBe('全屏改完的文本');
    // controller 从草稿重读（draftRestoreToken bump → 水化链）→ 外部文本真变 →
    // M7 命令式通道 ref.setText → 输入组件 setValue（合成 markdown；无 token 时
    // 与明文同形）。旧「宿主下行 setText」桥消息已随 D4b 退役，断言面换到
    // mock 输入组件的调用记录。
    expect(mockCalls.setValue).toContain('全屏改完的文本');
  });
});
