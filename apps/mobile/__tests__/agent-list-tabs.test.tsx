/**
 * AgentList 双 tab（主智能体 / 子智能体）行为测试（T-M1/T-M2/T-M3）。
 *
 * 骨架照 agent-list-delete-confirm.test.tsx：mock useRuntime +
 * react-native FlatList 渲染 `agent-row-<id>`；SegmentedControl 用真实
 * 组件（仅依赖 react-native 与 tokens，tab 经 testID 点击切换）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockListAgentIds = jest.fn();
const mockGetRawWire = jest.fn();
const mockNavigate = jest.fn();
const mockBatchExit = jest.fn();
let capturedCreatePress: (() => void) | undefined;

// mode 三档 + 缺省 + invalid 各一条：invalid 行无 def → 双边显示。
const wireById: Record<string, unknown> = {
  'agent-primary': {
    schemaVersion: 1,
    name: '主用体',
    mode: 'primary',
    prompts: {system: 'hi', persist: {}, dynamic: {}},
    runtime: {maxSteps: 5},
  },
  'agent-sub': {
    schemaVersion: 1,
    name: '子委派',
    mode: 'subagent',
    prompts: {system: 'hi', persist: {}, dynamic: {}},
    runtime: {maxSteps: 5},
  },
  'agent-all': {
    schemaVersion: 1,
    name: '全可用',
    mode: 'all',
    prompts: {system: 'hi', persist: {}, dynamic: {}},
    runtime: {maxSteps: 5},
  },
  'agent-omit': {
    schemaVersion: 1,
    name: '缺省档',
    prompts: {system: 'hi', persist: {}, dynamic: {}},
    runtime: {maxSteps: 5},
  },
  // assess 判 invalid 的形态（无 name / 无合法 prompts 布局）。
  'agent-bad': {
    schemaVersion: 1,
    name: '   ',
    prompts: {blocks: {}},
  },
};
const allIds = Object.keys(wireById);

// 批量态可变 mock：active 由用例直接改写（切 tab 退批量断言用）。
const mockBatchState = {
  active: false,
  selectedCount: 0,
  selectedIds: new Set<string>(),
  enter: jest.fn(),
  exit: mockBatchExit,
  toggle: jest.fn(),
  isSelected: (_id: string) => false,
};

const mockRuntime = {
  agentRegistry: {
    listAgentIds: mockListAgentIds,
    getRawWire: mockGetRawWire,
  },
  state: {getCurrentModelId: jest.fn().mockResolvedValue(null)},
};

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surfaceElevated: '#f5f5f5',
      borderLight: '#eee',
      primary: '#007aff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      bgSecondary: '#eee',
      warningMuted: '#fff3cd',
      warning: '#856404',
    },
  }),
}));

const mockShowToast = jest.fn();

jest.mock('@/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@/services/model-display-label', () => ({
  resolveModelDisplayLabel: jest.fn().mockResolvedValue('gpt-4'),
}));

jest.mock('@/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: () => undefined,
}));

jest.mock('@/hooks/useBatchSelection', () => ({
  useBatchSelection: () => mockBatchState,
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useNavigation: () => ({navigate: mockNavigate}),
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(() => cb(), []);
    },
  };
});

// 渲染 normalActions 让「新建」按钮（PrimaryButton mock）出现在树里，
// 否则 onCreate 链路无法触达。
jest.mock('@/components/batch/ManageHeader', () => {
  const mockReact = require('react');
  return {
    ManageHeader: ({normalActions}: {normalActions?: React.ReactNode}) =>
      mockReact.createElement(
        'View',
        {testID: 'manage-header'},
        normalActions,
      ),
  };
});

jest.mock('@/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));

jest.mock('@/components/ui/Buttons', () => ({
  PrimaryButton: ({onPress}: {onPress?: () => void; label: string}) => {
    capturedCreatePress = onPress;
    return null;
  },
}));

jest.mock('@/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));

jest.mock('@/components/sheet/BottomSheetMenu', () => {
  const mockReact = require('react');
  return {
    BottomSheetMenu: ({visible}: {visible: boolean}) =>
      visible
        ? mockReact.createElement('View', {testID: 'bottom-sheet-menu'})
        : null,
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Alert: {alert: jest.fn()},
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
    }: {
      data: Array<{id: string}>;
      renderItem: (info: {
        item: {id: string};
        index: number;
      }) => React.ReactNode;
      keyExtractor: (item: {id: string}) => string;
    }) =>
      mockReact.createElement(
        'View',
        {testID: 'agent-flat-list'},
        data?.map((item, index) =>
          mockReact.createElement(
            'View',
            {key: keyExtractor(item), testID: `agent-row-${item.id}`},
            renderItem({item, index}),
          ),
        ),
      ),
    Pressable: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: (e?: {stopPropagation?: () => void}) => void;
      testID?: string;
    }) => mockReact.createElement('Pressable', {testID, onPress}, children),
    RefreshControl: () => null,
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      mockReact.createElement('Text', {testID}, children),
    View: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      mockReact.createElement('View', {testID}, children),
  };
});

import {AgentList} from '@/components/agent/AgentList';
import {createBlankAgent} from '@/services/agent-create';

async function renderAgentList(onCreate?: (tab: 'primary' | 'subagent') => void) {
  mockListAgentIds.mockResolvedValue(allIds);
  mockGetRawWire.mockImplementation((id: string) =>
    Promise.resolve(wireById[id] ?? null),
  );

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AgentList onCreate={onCreate} />);
  });
  // 等 reload 的异步链路（listAgentIds → 逐 id getRawWire）落地。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

function pressTab(tree: TestRenderer.ReactTestRenderer, testID: string) {
  act(() => {
    tree.root.findByProps({testID}).props.onPress();
  });
}

/** 收集行内全部 Text 文本（字符串 children 拼接），用于整行文本断言。 */
function collectRowText(row: TestRenderer.ReactTestInstance): string {
  return row
    .findAll(node => node.type === 'Text')
    .flatMap(node => node.children ?? [])
    .filter((child): child is string => typeof child === 'string')
    .join('');
}

describe('AgentList tabs (T-M1/T-M2/T-M3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedCreatePress = undefined;
    mockBatchState.active = false;
  });

  it('T-M1 默认主 tab 只见 primary/all/缺省行；切子 tab 只见 subagent/all/缺省行；general 仅子 tab 可见', async () => {
    const tree = await renderAgentList();
    const root = tree.root;

    // 主 tab：primary + all + 缺省 + invalid（invalid 无 def → 双边）。
    for (const id of ['agent-primary', 'agent-all', 'agent-omit', 'agent-bad']) {
      expect(root.findByProps({testID: `agent-row-${id}`})).toBeDefined();
    }
    // C-001 防回归：invalid 行读不到作用域（无 def），按「全部」挂徽标，
    // 与 desktop `row.mode == null || row.mode === "all"` 口径一致。
    expect(
      collectRowText(root.findByProps({testID: 'agent-row-agent-bad'})),
    ).toContain('全部');
    expect(root.findAllByProps({testID: 'agent-row-agent-sub'})).toHaveLength(
      0,
    );
    expect(root.findAllByProps({testID: 'agent-row-general'})).toHaveLength(0);

    // 切子 tab：subagent + all + 缺省 + invalid + 合成 general。
    pressTab(tree, 'agents-tab-subagent');
    for (const id of ['agent-sub', 'agent-all', 'agent-omit', 'agent-bad']) {
      expect(root.findByProps({testID: `agent-row-${id}`})).toBeDefined();
    }
    expect(root.findByProps({testID: 'agent-row-general'})).toBeDefined();
    expect(
      root.findAllByProps({testID: 'agent-row-agent-primary'}),
    ).toHaveLength(0);

    // 回主 tab 复核。
    pressTab(tree, 'agents-tab-primary');
    expect(root.findAllByProps({testID: 'agent-row-agent-sub'})).toHaveLength(
      0,
    );
    expect(root.findAllByProps({testID: 'agent-row-general'})).toHaveLength(0);
  });

  it('T-M1 批量模式中切 tab 自动退出批量', async () => {
    mockBatchState.active = true;
    const tree = await renderAgentList();

    expect(mockBatchExit).not.toHaveBeenCalled();
    pressTab(tree, 'agents-tab-subagent');
    expect(mockBatchExit).toHaveBeenCalled();
  });

  it('T-M2 onCreate 按当前 tab 透传（主 tab → primary，子 tab → subagent）', async () => {
    const onCreate = jest.fn();
    const tree = await renderAgentList(onCreate);

    expect(capturedCreatePress).toBeDefined();
    await act(async () => {
      capturedCreatePress!();
    });
    expect(onCreate).toHaveBeenCalledWith('primary');

    pressTab(tree, 'agents-tab-subagent');
    await act(async () => {
      capturedCreatePress!();
    });
    expect(onCreate).toHaveBeenCalledWith('subagent');
  });

  it('T-M3 general 合成行仅子 tab 可见、无删除菜单项，点击进只读编辑器详情', async () => {
    const tree = await renderAgentList();

    // 主 tab 无 general 行。
    expect(
      tree.root.findAllByProps({testID: 'agent-row-general'}),
    ).toHaveLength(0);

    pressTab(tree, 'agents-tab-subagent');
    const generalRow = tree.root.findByProps({testID: 'agent-row-general'});

    // A-003 防回归：行内 meta 用短文案（双端对齐），不落完整
    // description 长文案（长文案只出现在编辑器详情页）。
    const generalRowText = collectRowText(generalRow);
    expect(generalRowText).toContain('通用助手 · 不可编辑');
    expect(generalRowText).not.toContain('读写文件');

    // 行内没有 ⋮ 菜单按钮（无删除/重命名/复制入口），菜单弹层未出现。
    const dots = generalRow
      .findAll(node => node.type === 'Text')
      .filter(node => node.children?.includes('⋮'));
    expect(dots).toHaveLength(0);
    expect(
      tree.root.findAllByProps({testID: 'bottom-sheet-menu'}),
    ).toHaveLength(0);

    // 行点击 → AgentEditor 的 general sentinel（进入全禁用只读编辑器详情，
    // AgentEditorScreen 以出厂定义直填 AgentEditorForm readOnly 渲染）。
    mockNavigate.mockClear();
    const rowPressable = generalRow.findAll(
      node => node.type === 'Pressable',
    )[0]!;
    await act(async () => {
      rowPressable.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('AgentEditor', {
      agentId: 'general',
    });
  });
});

describe('createBlankAgent mode 落库（T-M2）', () => {
  it('mode 传入时写进 upsert 定义；不传维持现行为（无 mode 字段）', async () => {
    const upsert = jest.fn();
    const runtime = {
      agentRegistry: {
        listAgentIds: jest.fn().mockResolvedValue([]),
        get: jest.fn(),
        upsert,
      },
    } as unknown as Parameters<typeof createBlankAgent>[0];

    await createBlankAgent(runtime, 'agent-x', 'subagent');
    expect(upsert).toHaveBeenCalledWith(
      'agent-x',
      expect.objectContaining({mode: 'subagent'}),
    );

    await createBlankAgent(runtime, 'agent-y');
    const defWithoutMode = upsert.mock.calls[1]![1] as {mode?: unknown};
    expect(defWithoutMode.mode).toBeUndefined();
  });
});
