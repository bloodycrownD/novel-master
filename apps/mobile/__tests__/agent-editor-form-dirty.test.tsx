/**
 * T-AD1（dirty 链路回归）：全屏提示词编辑保存回填后「有未保存的更改」标记
 * 随 snapshot 同帧出现；表单保存后随 savedBaseline 同帧消失。
 * 背景是真机验收反馈：跨组件 effect 通知的标记在转场下刷新时机不可靠，
 * 修复为 AgentEditorForm 渲染期同步派生（banner 下放表单内）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockGetRawWire = jest.fn();
const mockGoBack = jest.fn();
const mockPush = jest.fn();

const longSystem = '一\n二\n三\n四\n五\n六\n七';
const validWire = {
  schemaVersion: 1,
  name: '写作助手',
  prompts: {system: longSystem, persist: {}, dynamic: {}},
};

const mockRuntime = {
  agentRegistry: {
    getRawWire: mockGetRawWire,
    listAgentIds: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn().mockResolvedValue(undefined),
  },
  providers: {list: jest.fn().mockResolvedValue([])},
  providerModels: {
    savedList: jest.fn().mockResolvedValue([]),
    getSavedById: jest.fn().mockResolvedValue(null),
  },
  state: {getCurrentModelId: jest.fn().mockResolvedValue(null)},
};

jest.mock('@novel-master/core', () => ({
  registerBuiltinTools: jest.fn(),
  ToolRegistry: class {
    list() {
      return ['read'];
    }
  },
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      surface: '#fff',
      bgSecondary: '#f5f5f5',
      border: '#ddd',
      borderLight: '#ddd',
      primary: '#007aff',
      danger: '#ff3b30',
    },
  }),
}));

const mockShowToast = jest.fn();

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

const mockRouteParams: {
  agentId?: string;
  title?: string;
  initialText?: string;
  onSaved?: (text: string) => void;
} = {agentId: 'agent-a'};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    push: mockPush,
    addListener: jest.fn(() => () => undefined),
    removeListener: jest.fn(),
  }),
  useRoute: () => ({params: mockRouteParams}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('../src/components/form/FormOverlayHost', () => ({
  useFormOverlay: () => ({openOverlay: jest.fn()}),
}));

jest.mock('../src/components/form/FormField', () => {
  const mockReact = require('react');
  return {
    FormField: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('../src/components/form/FormSwitchRow', () => ({
  FormSwitchRow: () => null,
}));

jest.mock('../src/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  return {
    FormSectionCard: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('../src/components/form/FormSelectField', () => ({
  FormSelectField: () => null,
}));

jest.mock('../src/components/form/ScreenFormLayout', () => {
  const mockReact = require('react');
  return {
    ScreenFormLayout: ({
      children,
      footer,
    }: {
      children?: React.ReactNode;
      footer?: React.ReactNode;
    }) => mockReact.createElement('View', null, children, footer),
  };
});

jest.mock('../src/components/form/StickyFormFooter', () => {
  const mockReact = require('react');
  return {
    StickyFormFooter: ({onPress}: {onPress: () => void}) =>
      mockReact.createElement('Pressable', {onPress, testID: 'form-save'}),
  };
});

jest.mock('../src/components/agent/ToolPolicyPicker', () => ({
  ToolPolicyPicker: () => null,
}));

jest.mock('../src/services/agent-yaml.service', () => ({
  exportAgentYaml: jest.fn(),
  importAgentYaml: jest.fn(),
}));

// PromptEditor 的编辑器 stub：记录 onChange 供测试驱动。
const mockEditorProps: {
  value: string;
  onChange: (text: string) => void;
}[] = [];

jest.mock('../src/components/vfs/CodeEditorWebView', () => ({
  CodeEditorWebView: (props: {value: string; onChange: (t: string) => void}) => {
    mockEditorProps[0] = props;
    return null;
  },
}));

jest.mock('../src/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: jest.fn()}),
}));

import {AgentEditorScreen} from '../src/screens/stack/AgentEditorScreen';
import {AgentEditorForm} from '../src/components/agent/AgentEditorForm';
import {PromptEditorScreen} from '../src/screens/stack/PromptEditorScreen';

function findBanner(root: TestRenderer.ReactTestInstance) {
  return root
    .findAll(node => typeof node.children?.[0] === 'string')
    .filter(node => String(node.children[0]).includes('有未保存的更改'));
}

function pressFullscreenButton(root: TestRenderer.ReactTestInstance) {
  // accessibilityLabel 在 RN preset 会传播到多层节点，取带 onPress 的那层。
  const buttons = root.findAllByProps({accessibilityLabel: '全屏编辑'});
  const button = buttons.find(node => typeof node.props.onPress === 'function');
  expect(button).toBeDefined();
  act(() => {
    button!.props.onPress();
  });
}

async function renderAgentEditor() {
  mockGetRawWire.mockResolvedValue(validWire);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AgentEditorScreen />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree!;
}

describe('AgentEditor dirty 链路（T-AD1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorProps.length = 0;
    mockRouteParams.agentId = 'agent-a';
    mockRouteParams.title = undefined;
    mockRouteParams.initialText = undefined;
    mockRouteParams.onSaved = undefined;
  });

  it('初始无标记；全屏保存回填后标记出现；表单保存后标记消失', async () => {
    const editorTree = await renderAgentEditor();

    // 初始：与已保存基线一致，无「有未保存的更改」
    expect(findBanner(editorTree.root)).toHaveLength(0);

    // 常驻「全屏编辑」按钮 → push 全屏页
    pressFullscreenButton(editorTree.root);
    expect(mockPush).toHaveBeenCalledWith(
      'PromptEditor',
      expect.objectContaining({initialText: longSystem}),
    );
    const route = mockPush.mock.calls[0]![1] as {
      initialText: string;
      onSaved: (text: string) => void;
    };

    // 全屏页（栈顶）：改稿并保存 → 回填栈底表单
    mockRouteParams.initialText = route.initialText;
    mockRouteParams.onSaved = route.onSaved;
    let promptTree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      promptTree = TestRenderer.create(<PromptEditorScreen />);
    });
    const edited = '改后的长内容\n2\n3\n4\n5\n6';
    await act(async () => {
      mockEditorProps[0]!.onChange(edited);
    });
    await act(async () => {
      promptTree.root
        .findByProps({testID: 'prompt-editor-save'})
        .props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    // 回填后：标记与内容同帧出现
    expect(findBanner(editorTree.root)).toHaveLength(1);

    // 表单保存成功后：标记随 savedBaseline 同帧消失
    await act(async () => {
      editorTree.root.findByProps({testID: 'form-save'}).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockRuntime.agentRegistry.upsert).toHaveBeenCalledTimes(1);
    expect(findBanner(editorTree.root)).toHaveLength(0);
  });

  it('全屏取消（不保存）不回填，标记不出现', async () => {
    const editorTree = await renderAgentEditor();
    pressFullscreenButton(editorTree.root);
    const route = mockPush.mock.calls[0]![1] as {
      initialText: string;
      onSaved: (text: string) => void;
    };

    mockRouteParams.initialText = route.initialText;
    mockRouteParams.onSaved = route.onSaved;
    let promptTree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      promptTree = TestRenderer.create(<PromptEditorScreen />);
    });
    await act(async () => {
      mockEditorProps[0]!.onChange('不会落盘的改动');
    });
    await act(async () => {
      promptTree.root
        .findByProps({testID: 'prompt-editor-cancel'})
        .props.onPress();
    });
    expect(findBanner(editorTree.root)).toHaveLength(0);
  });

  it('onDirtyChange 通知外层（useUnsavedGuard 数据源）：内联修改后 true、保存后 false', async () => {
    mockGetRawWire.mockResolvedValue(validWire);
    const onDirtyChange = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <AgentEditorForm agentId="agent-a" onDirtyChange={onDirtyChange} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    // 驱动系统区内联输入（表单里第一个 multiline TextInput 即 systemContent）
    const multilineInputs = tree.root.findAllByProps({multiline: true});
    expect(multilineInputs.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      multilineInputs[0]!.props.onChangeText('内联改了一笔');
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // 表单保存后回 false
    await act(async () => {
      tree.root.findByProps({testID: 'form-save'}).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
