/**
 * 智能排序规则编辑屏行为测试（dtcli/B-1 mobile 侧 + mobile/G-2 渲染链路）：
 * 1. 测试结果区语义「结果只属于上次点击『测试』时的输入快照」——改正则
 *    （applyPatternInput）或换捕获数字档位（PickerListModal onPick）后，
 *    旧结果清空、结果区回 idle 占位文案（与 changeTestText 同范式）。
 * 2. 高亮渲染走 core 单源 splitSmartSortHighlightSegments：匹配段以 primary
 *    色嵌套 Text 渲染（切分算法本身由 core 单测覆盖，此处只锁渲染链路）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockListRules = jest.fn();
const mockCreateRule = jest.fn();
const mockUpdateRule = jest.fn();
const mockGoBack = jest.fn();

const mockRuntime = {
  smartSortRule: {
    listRules: mockListRules,
    createRule: mockCreateRule,
    updateRule: mockUpdateRule,
  },
};

const mockRouteParams: {ruleId?: string} = {};

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      bgSecondary: '#f5f5f5',
      border: '#ddd',
      borderLight: '#eee',
      primary: '#007aff',
      danger: '#ff3b30',
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

// navigation 身份须稳定（生产中为同一 navigation prop）：load 以它为依赖，
// 若每次渲染新建对象会让加载 effect 无限重跑。
const mockNavigation = {
  goBack: mockGoBack,
  addListener: jest.fn(() => () => undefined),
  removeListener: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: mockRouteParams}),
  // 头部 override 的聚焦副作用与表单行为无关，测试内不触发。
  useFocusEffect: () => undefined,
}));

jest.mock('@/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: jest.fn()}),
  useStackOverrideSetter: () => jest.fn(),
}));

jest.mock('@/components/icons/TabIcons', () => ({
  HelpIcon: () => null,
}));

jest.mock('@/components/form/FormOverlayHost', () => ({
  useFormOverlay: () => ({openOverlay: jest.fn()}),
}));

jest.mock('@/components/form/FormField', () => {
  const mockReact = require('react');
  return {
    FormField: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('@/components/form/FormSwitchRow', () => ({
  FormSwitchRow: () => null,
}));

jest.mock('@/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  return {
    FormSectionCard: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

// FormTextInput 直透为 host TextInput：按 placeholder 定位、驱动 onChangeText。
jest.mock('@/components/form/FormTextInput', () => {
  const mockReact = require('react');
  return {
    FormTextInput: (props: Record<string, unknown>) =>
      mockReact.createElement('TextInput', props),
  };
});

jest.mock('@/components/form/ScreenFormLayout', () => {
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

jest.mock('@/components/form/StickyFormFooter', () => {
  const mockReact = require('react');
  return {
    StickyFormFooter: ({onPress}: {onPress: () => void}) =>
      mockReact.createElement('View', {onPress, testID: 'form-save'}),
  };
});

jest.mock('@/components/ui/Buttons', () => {
  const mockReact = require('react');
  return {
    PrimaryButton: () => null,
    SecondaryButton: ({onPress}: {onPress: () => void}) =>
      mockReact.createElement('View', {onPress, testID: 'match-test-run'}),
  };
});

// PickerListModal 只记 props：测试经 onPick 直接模拟选中档位。
const pickerProps: {
  onPick: (item: {value: string; label: string}) => void;
}[] = [];

jest.mock('@/components/ui/PickerListModal', () => ({
  PickerListModal: (props: {onPick: (item: unknown) => void}) => {
    pickerProps[0] = props as {onPick: (item: never) => void};
    return null;
  },
}));

jest.mock('@/components/ui/ModalShell', () => ({
  ModalShell: () => null,
}));

import {SmartSortRuleEditorScreen} from '@/screens/stack/SmartSortRuleEditorScreen';

const PATTERN_PLACEHOLDER = '如 /第([0-9〇零一二两三四五六七八九十百千]+)章/i';
const TEST_TEXT_PLACEHOLDER = '输入测试文本';
const IDLE_HINT = '点击「测试」查看匹配结果';

function textContents(root: TestRenderer.ReactTestInstance): string[] {
  return root
    .findAll(node => node.type === 'Text')
    .map(node =>
      (node.children ?? [])
        .filter(child => typeof child === 'string')
        .join(''),
    )
    .filter(text => text.length > 0);
}

function hasText(root: TestRenderer.ReactTestInstance, substring: string) {
  return textContents(root).some(text => text.includes(substring));
}

function inputByPlaceholder(
  root: TestRenderer.ReactTestInstance,
  placeholder: string,
) {
  const input = root.findByProps({placeholder});
  expect(typeof input.props.onChangeText).toBe('function');
  return input;
}

async function renderEditor() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SmartSortRuleEditorScreen />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree!;
}

/** 填正则 + 测试文本并点「测试」，返回结果已出的树。 */
async function renderWithMatchResult() {
  const tree = await renderEditor();
  await act(async () => {
    inputByPlaceholder(tree.root, PATTERN_PLACEHOLDER).props.onChangeText(
      '第(\\d+)章',
    );
  });
  await act(async () => {
    inputByPlaceholder(tree.root, TEST_TEXT_PLACEHOLDER).props.onChangeText(
      '第1章 起点 第2章',
    );
  });
  await act(async () => {
    tree.root.findByProps({testID: 'match-test-run'}).props.onPress();
  });
  expect(hasText(tree.root, '共 2 处匹配')).toBe(true);
  return tree!;
}

describe('SmartSortRuleEditorScreen 测试结果区（dtcli/B-1 mobile 侧）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pickerProps.length = 0;
    mockRouteParams.ruleId = undefined;
    mockListRules.mockResolvedValue([]);
  });

  it('改正则后旧结果清空，结果区回 idle 占位文案', async () => {
    const tree = await renderWithMatchResult();

    await act(async () => {
      inputByPlaceholder(tree.root, PATTERN_PLACEHOLDER).props.onChangeText(
        '第(\\d+)卷',
      );
    });
    expect(hasText(tree.root, IDLE_HINT)).toBe(true);
    expect(hasText(tree.root, '共 2 处匹配')).toBe(false);
  });

  it('换捕获数字档位后旧结果清空，结果区回 idle 占位文案', async () => {
    const tree = await renderWithMatchResult();

    expect(pickerProps[0]).toBeDefined();
    await act(async () => {
      pickerProps[0]!.onPick({value: 'fixed_min', label: '固定最小'});
    });
    expect(hasText(tree.root, IDLE_HINT)).toBe(true);
    expect(hasText(tree.root, '共 2 处匹配')).toBe(false);
  });

  it('匹配段高亮经 core 单源切分渲染（primary 色嵌套 Text）', async () => {
    const tree = await renderWithMatchResult();

    // 匹配段「第1章」「第2章」以 primary 色渲染，普通段「 起点 」保持默认色。
    for (const matched of ['第1章', '第2章']) {
      const seg = tree.root
        .findAll(
          node =>
            node.type === 'Text' &&
            (node.children ?? []).includes(matched),
        )
        .find(node => node.props.style?.color === '#007aff');
      expect(seg).toBeDefined();
    }
    expect(hasText(tree.root, '起点')).toBe(true);
  });
});

describe('SmartSortRuleEditorScreen 加载失败 dirty 链路（mobile/B-1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pickerProps.length = 0;
    mockRouteParams.ruleId = 'rule-1';
    mockListRules.mockRejectedValue(new Error('boom'));
  });

  it('listRules reject 时只 toast，无「未保存的更改」伪标记；再编辑才计 dirty', async () => {
    const tree = await renderEditor();

    expect(mockListRules).toHaveBeenCalledTimes(1);
    // toastMessage mock 为 String(err)：「加载失败」标题拼错误串。
    expect(mockShowToast).toHaveBeenCalledWith('Error: boom');
    // 加载失败停 DEFAULT_DRAFT，baseline 已对齐：不产生伪 dirty。
    expect(hasText(tree.root, '未保存的更改')).toBe(false);

    // 失败后用户真改了字段，dirty 正常出现（基线对齐不能吞掉真实编辑）。
    await act(async () => {
      inputByPlaceholder(tree.root, '如 中文序号章节').props.onChangeText(
        '新规则',
      );
    });
    expect(hasText(tree.root, '未保存的更改')).toBe(true);
  });
});
