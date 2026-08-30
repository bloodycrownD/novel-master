/**
 * 聊天记录查询页 mobile 组件测试（T-MO2、T-MO3）。
 *
 * - T-MO2：点击查询触发 runtime.messages.searchMessages，结果渲染到自渲染列表；
 *          空结果时显示「未找到匹配的聊天记录」。
 * - T-MO3：编号区间输入归一后进入 searchMessages 入参；倒挂区间提示且不调用；
 *          修改区间后「加载更早」翻页仍携带新区间。
 *
 * 返回由导航 header 的 showBack 处理，组件内不再单独放返回按钮，因此不再需要
 * 单独的返回测试。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {ChatMessage} from '@novel-master/core/chat';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';

// ── ChatHistorySearchScreen 依赖 mock ──────────────────────────────────────
const mockSearchMessages = jest.fn();
const mockRuntime = {
  messages: {searchMessages: mockSearchMessages},
};

let mockRouteParams: {projectId: string; sessionId: string} = {
  projectId: 'p1',
  sessionId: 's1',
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      surfaceElevated: '#f0f0f0',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#e0e0e0',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: mockRouteParams}),
}));

jest.mock('@/components/form/FormTextInput', () => {
  const React = require('react');
  const FormTextInput = (props: {
    testID?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    placeholder?: string;
  }) =>
    React.createElement('TextInput', {
      testID: props.testID,
      value: props.value,
      onChangeText: props.onChangeText,
      placeholder: props.placeholder,
    });
  return {FormTextInput};
});

jest.mock('react-native', () => {
  const RnReact = require('react');
  return {
    ScrollView: (props: {
      children?: React.ReactNode;
      testID?: string;
      onScroll?: (e: unknown) => void;
    }) =>
      RnReact.createElement(
        'ScrollView',
        {
          testID: props.testID,
          onScroll: props.onScroll,
        },
        props.children,
      ),
    FlatList: (props: {
      data?: readonly unknown[];
      renderItem?: (info: {item: unknown}) => React.ReactNode;
      keyExtractor?: (item: unknown) => string;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      onEndReached?: () => void;
      testID?: string;
    }) => {
      const items = props.data ?? [];
      const body = items.map((item, index) =>
        props.renderItem
          ? RnReact.createElement(
              'View',
              {
                key: props.keyExtractor
                  ? props.keyExtractor(item)
                  : String(index),
              },
              props.renderItem({item}),
            )
          : null,
      );
      return RnReact.createElement(
        'FlatList',
        {
          testID: props.testID,
          onEndReached: props.onEndReached,
        },
        items.length === 0 && props.ListEmptyComponent
          ? props.ListEmptyComponent
          : [...body, props.ListFooterComponent ?? null],
      );
    },
    TextInput: (props: {
      testID?: string;
      value?: string;
      onChangeText?: (v: string) => void;
      placeholder?: string;
    }) =>
      RnReact.createElement('TextInput', {
        testID: props.testID,
        value: props.value,
        onChangeText: props.onChangeText,
        placeholder: props.placeholder,
      }),
    Switch: (props: {
      testID?: string;
      value?: boolean;
      onValueChange?: (v: boolean) => void;
    }) =>
      RnReact.createElement('View', {
        testID: props.testID,
        value: String(props.value ?? false),
      }),
    ActivityIndicator: (props: {testID?: string; color?: string}) =>
      RnReact.createElement('View', {
        testID: props.testID ?? 'activity-indicator',
        color: props.color,
      }),
    Pressable: (props: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      accessibilityState?: {expanded?: boolean};
      testID?: string;
    }) =>
      RnReact.createElement(
        'View',
        {
          testID: props.testID ?? props.accessibilityLabel,
          onPress: props.onPress,
          disabled: String(props.disabled ?? false),
          accessibilityRole: props.accessibilityRole,
          accessibilityState: props.accessibilityState,
        },
        props.children,
      ),
    Keyboard: {dismiss: jest.fn()},
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Platform: {OS: 'ios'},
    Text: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      RnReact.createElement('Text', {testID}, children),
    View: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      RnReact.createElement('View', {testID}, children),
  };
});

import {ChatHistorySearchScreen} from '@/screens/stack/ChatHistorySearchScreen';

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** testID 由 ui/CollapsibleCard 转发到内部 Pressable；findByProps 会先命中外层
 *  组件元素自身的同名 prop，这里取带无障碍状态的那个（真正可按的节点）。 */
function findCardPressable(
  root: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance {
  const node = root
    .findAllByProps({testID})
    .find(n => n.props.accessibilityState != null);
  if (node == null) {
    throw new Error(`collapsible pressable not found: ${testID}`);
  }
  return node;
}

/** 构造最小可用 ChatMessage（content 只放一个 TextBlock，足够列表渲染）。 */
function makeMessage(
  overrides: Partial<ChatMessage> & {seq: number; text: string},
): ChatMessage {
  return {
    id: `m-${overrides.seq}`,
    sessionId: 's1',
    seq: overrides.seq,
    role: 'user',
    content: {blocks: [{type: 'text', text: overrides.text}]},
    provider: null,
    raw: null,
    createdAtMs: 1000 * overrides.seq,
    hidden: false,
    ...overrides,
  } as ChatMessage;
}

describe('T-MO2 ChatHistorySearchScreen 查询与结果渲染', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
  });

  it('点击查询触发 searchMessages，结果渲染到自渲染列表', async () => {
    mockSearchMessages.mockResolvedValue([
      makeMessage({seq: 3, text: '魔法设定'}),
      makeMessage({seq: 1, text: '你好世界', role: 'assistant'}),
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
    // 透传给 core 的入参形状（仅关键词 + limit + 翻页游标）
    expect(mockSearchMessages).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        limit: 50,
      }),
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('魔法设定');
    expect(json).toContain('你好世界');
  });

  it('空结果时显示「未找到匹配的聊天记录」', async () => {
    mockSearchMessages.mockResolvedValue([]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    expect(mockSearchMessages).toHaveBeenCalled();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('未找到匹配的聊天记录');
    // 空态专用 testID 确实渲染出来了
    expect(json).toContain('chat-history-search-empty');
  });

  it('hidden 消息也会被渲染（仅整体降透明度）', async () => {
    mockSearchMessages.mockResolvedValue([
      makeMessage({seq: 2, text: '隐藏消息', hidden: true}),
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('隐藏消息');
    expect(json).toContain('已隐藏');
  });

  it('长消息点击卡片展开后显示完整文本', async () => {
    const longText = '这是一段很长的文本'.repeat(30);
    mockSearchMessages.mockResolvedValue([
      makeMessage({seq: 5, text: longText}),
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    // 收起态：截断 + 「展开全文」提示
    let json = JSON.stringify(tree.toJSON());
    expect(json).toContain('展开全文');

    // 点击卡片展开
    await act(async () => {
      findCardPressable(
        tree.root,
        'chat-history-search-result-card',
      ).props.onPress();
    });

    // 展开态：显示完整文本 + 「收起」提示
    json = JSON.stringify(tree.toJSON());
    expect(json).toContain(longText);
    expect(json).toContain('收起');
  });
});

// ── T-MO3 编号区间输入与翻页贯通 ──────────────────────────────────────
describe('T-MO3 ChatHistorySearchScreen 编号区间', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
  });

  it('填入区间后查询，searchMessages 入参含 fromSeq/toSeq', async () => {
    mockSearchMessages.mockResolvedValue([]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText(' 10 ');
      tree.root
        .findByProps({testID: 'chat-history-search-to-seq'})
        .props.onChangeText('50');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    // 两端输入均归一为数字后进入入参（含前后空宗归一）。
    expect(mockSearchMessages).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({fromSeq: 10, toSeq: 50}),
    );
  });

  it('倒挂区间提示且不调用 searchMessages', async () => {
    mockSearchMessages.mockResolvedValue([]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText('60');
      tree.root
        .findByProps({testID: 'chat-history-search-to-seq'})
        .props.onChangeText('40');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    expect(mockSearchMessages).not.toHaveBeenCalled();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('编号区间无效');
  });

  it('修改区间后「加载更早」翻页仍携带新区间', async () => {
    // 两批都返回 50 条（命中 SEARCH_LIMIT → hasMore=true），最小 seq 为 51。
    const makeBatch = () =>
      Array.from({length: 50}, (_, i) =>
        makeMessage({seq: 100 - i, text: `m-${100 - i}`}),
      );
    mockSearchMessages
      .mockResolvedValueOnce(makeBatch())
      .mockResolvedValueOnce(makeBatch())
      .mockResolvedValueOnce([]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });

    // 第一次查询：区间 1-100。
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText('1');
      tree.root
        .findByProps({testID: 'chat-history-search-to-seq'})
        .props.onChangeText('100');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });
    expect(mockSearchMessages).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({fromSeq: 1, toSeq: 100}),
    );

    // 首次查询命中后表单卡片自动收起（卸载输入框），改输入前先点卡片头展开。
    await act(async () => {
      findCardPressable(
        tree.root,
        'chat-history-search-form-toggle',
      ).props.onPress();
    });

    // 修改起始编号为 50 后重新查询：入参应携带新区间。
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText('50');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });
    expect(mockSearchMessages).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({fromSeq: 50, toSeq: 100}),
    );

    // 触发 FlatList 翻页：应携带新区间 + 当前最小 seq 作为 beforeSeq。
    await act(async () => {
      tree.root.findByType('FlatList').props.onEndReached();
      await flushPromises();
    });
    expect(mockSearchMessages).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({fromSeq: 50, toSeq: 100, beforeSeq: 51}),
    );
  });
});

// ── T-CF 筛选表单折叠卡片（卡片化重设计） ──────────────────────────
describe('T-CF ChatHistorySearchScreen 筛选表单折叠卡片', () => {
  const RN = require('react-native');

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
  });

  /** 查卡片头当前的 expanded 无障碍状态。 */
  function formToggleState(tree: TestRenderer.ReactTestRenderer): {
    expanded?: boolean;
  } {
    return findCardPressable(tree.root, 'chat-history-search-form-toggle').props
      .accessibilityState;
  }

  it('T-CF1：进入页面表单卡片默认展开，各输入 testID 可直查', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });

    expect(formToggleState(tree).expanded).toBe(true);
    // 输入框与提交按钮均未卸载，可直接查到。
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-keyword'}),
    ).not.toThrow();
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-from-seq'}),
    ).not.toThrow();
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-to-seq'}),
    ).not.toThrow();
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-submit'}),
    ).not.toThrow();
  });

  it('T-CF2：查询命中后表单自动收起，摘要正确且 Keyboard.dismiss 被调用', async () => {
    mockSearchMessages.mockResolvedValue([
      makeMessage({seq: 12, text: '命中结果'}),
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-keyword'})
        .props.onChangeText('魔法');
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText('10');
      tree.root
        .findByProps({testID: 'chat-history-search-to-seq'})
        .props.onChangeText('50');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });

    // 自动收起：卡片头 expanded=false，输入框被卸载。
    expect(formToggleState(tree).expanded).toBe(false);
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-keyword'}),
    ).toThrow();
    // 收起态摘要从筛选 state 派生：关键词 + 编号区间（JSON 序列化后引号带转义）。
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('关键词 \\"魔法\\"');
    expect(json).toContain('#10–50');
    // 收起时顺带收起键盘。
    expect(RN.Keyboard.dismiss).toHaveBeenCalled();
  });

  it('T-CF3：空结果与区间倒挂时表单不收起、输入框仍可用', async () => {
    // 空结果：不算命中，不收起。
    mockSearchMessages.mockResolvedValue([]);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });
    expect(formToggleState(tree).expanded).toBe(true);
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-keyword'}),
    ).not.toThrow();

    // 区间倒挂：提前 return，不收起（先清掉上段的调用记录）。
    tree.unmount();
    mockSearchMessages.mockClear();
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText('60');
      tree.root
        .findByProps({testID: 'chat-history-search-to-seq'})
        .props.onChangeText('40');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });
    expect(mockSearchMessages).not.toHaveBeenCalled();
    expect(formToggleState(tree).expanded).toBe(true);
    expect(() =>
      tree.root.findByProps({testID: 'chat-history-search-from-seq'}),
    ).not.toThrow();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('编号区间无效');
  });

  it('T-CF4：收起后再点卡片头展开，输入值保留上次内容', async () => {
    mockSearchMessages.mockResolvedValue([
      makeMessage({seq: 7, text: '命中结果'}),
    ]);

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-keyword'})
        .props.onChangeText('保留关键词');
      tree.root
        .findByProps({testID: 'chat-history-search-from-seq'})
        .props.onChangeText('7');
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'chat-history-search-submit'})
        .props.onPress();
      await flushPromises();
    });
    expect(formToggleState(tree).expanded).toBe(false);

    // 点卡片头重新展开：输入值应从 screen 级 state 回填。
    await act(async () => {
      findCardPressable(
        tree.root,
        'chat-history-search-form-toggle',
      ).props.onPress();
    });
    expect(formToggleState(tree).expanded).toBe(true);
    expect(
      tree.root.findByProps({testID: 'chat-history-search-keyword'}).props
        .value,
    ).toBe('保留关键词');
    expect(
      tree.root.findByProps({testID: 'chat-history-search-from-seq'}).props
        .value,
    ).toBe('7');
  });
});

// ── T-KB4 Android 键盘避让（范式 A：marginBottom 裁切窗口） ────────────────
describe('T-KB4 ChatHistorySearchScreen Android 键盘避让', () => {
  // 这个 describe 复用上面的 mock（react-native 被 mock，Platform 可直接改）。
  const RN = require('react-native');

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
    mockSearchMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    RN.Platform.OS = 'ios';
  });

  it('Android 分支：用 marginBottom 裁切窗口，不走 KeyboardAvoidingView', async () => {
    RN.Platform.OS = 'android';
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
      await new Promise(resolve => setImmediate(resolve));
    });

    // clipStyle 产出 {marginBottom: -0}（键盘收起时 height=0），找我 marginBottom 样式的节点。
    const nodesWithMarginBottom = tree.root.findAll(node => {
      const style = node.props?.style;
      if (style == null) {
        return false;
      }
      const styles = Array.isArray(style) ? style : [style];
      return styles.some(
        s =>
          s != null &&
          typeof s === 'object' &&
          typeof (s as {marginBottom?: unknown}).marginBottom === 'number',
      );
    });
    expect(nodesWithMarginBottom.length).toBeGreaterThanOrEqual(1);

    // Android 分支不再走 KeyboardAvoidingView
    const kabvNodes = tree.root.findAllByType(KeyboardAvoidingView as never);
    expect(kabvNodes.length).toBe(0);
  });

  it('iOS 分支：仍走 KeyboardAvoidingView（回归保护）', async () => {
    RN.Platform.OS = 'ios';
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
      await new Promise(resolve => setImmediate(resolve));
    });
    const kabvNodes = tree.root.findAllByType(KeyboardAvoidingView as never);
    expect(kabvNodes.length).toBeGreaterThanOrEqual(1);
  });
});
