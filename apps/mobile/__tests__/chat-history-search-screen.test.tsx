/**
 * 聊天记录查询页 mobile 组件测试（T-MO2 / T-MO3）。
 *
 * - T-MO2：点击查询触发 runtime.messages.searchMessages，结果渲染到自渲染列表；
 *          空结果时显示「未找到匹配的聊天记录」。
 * - T-MO3：返回按钮触发 navigation.goBack，回到详情页。
 *
 * DateTimePicker 是原生组件，jest 环境无 bridge，统一 mock 成简单 View。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {ChatMessage} from '@novel-master/core/chat';

// ── ChatHistorySearchScreen 依赖 mock ──────────────────────────────────────
const mockSearchMessages = jest.fn();
const mockRuntime = {
  messages: {searchMessages: mockSearchMessages},
};

let mockRouteParams: {projectId: string; sessionId: string} = {
  projectId: 'p1',
  sessionId: 's1',
};
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/theme/ThemeProvider', () => ({
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
  useNavigation: () => ({goBack: mockGoBack, navigate: mockNavigate}),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const Picker = (props: {
    testID?: string;
    value?: unknown;
    mode?: string;
  }) =>
    React.createElement('View', {
      testID: props.testID ?? 'datetime-picker',
      mode: props.mode,
    });
  return {
    __esModule: true,
    default: Picker,
  };
});

jest.mock('../src/components/form/FormTextInput', () => {
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

jest.mock('../src/components/form/FormSwitchRow', () => {
  const React = require('react');
  const FormSwitchRow = (props: {
    testID?: string;
    value?: boolean;
    onValueChange?: (v: boolean) => void;
    label?: string;
  }) =>
    React.createElement('View', {
      testID: props.testID,
      value: String(props.value ?? false),
    });
  return {FormSwitchRow};
});

jest.mock('../src/components/ui/SegmentedControl', () => {
  const React = require('react');
  const SegmentedControl = <T extends string>(props: {
    testID?: string;
    value?: T;
    onChange?: (v: T) => void;
    options?: readonly {value: T; label: string; testID?: string}[];
  }) =>
    React.createElement(
      'View',
      {testID: 'segmented-control', value: props.value},
      (props.options ?? []).map(opt =>
        React.createElement('View', {
          key: opt.value,
          testID: opt.testID,
          label: opt.label,
          onPress: () => props.onChange?.(opt.value),
        }),
      ),
    );
  return {SegmentedControl};
});

jest.mock('react-native', () => {
  const RnReact = require('react');
  return {
    ScrollView: (props: {
      children?: React.ReactNode;
      testID?: string;
      onScroll?: (e: unknown) => void;
    }) =>
      RnReact.createElement('ScrollView', {
        testID: props.testID,
        onScroll: props.onScroll,
      }, props.children),
    FlatList: (props: {
      data?: readonly unknown[];
      renderItem?: (info: {item: unknown}) => React.ReactNode;
      keyExtractor?: (item: unknown) => string;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      testID?: string;
    }) => {
      const items = props.data ?? [];
      const body = items.map((item, index) =>
        props.renderItem
          ? RnReact.createElement(
              'View',
              {key: props.keyExtractor ? props.keyExtractor(item) : String(index)},
              props.renderItem({item}),
            )
          : null,
      );
      return RnReact.createElement(
        'FlatList',
        {testID: props.testID},
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
      testID?: string;
    }) =>
      RnReact.createElement(
        'View',
        {
          testID: props.testID ?? props.accessibilityLabel,
          onPress: props.onPress,
          disabled: String(props.disabled ?? false),
        },
        props.children,
      ),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      RnReact.createElement('Text', {testID}, children),
    View: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      RnReact.createElement('View', {testID}, children),
  };
});

import {ChatHistorySearchScreen} from '../src/screens/stack/ChatHistorySearchScreen';

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
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
      tree.root.findByProps({testID: 'chat-history-search-submit'}).props.onPress();
      await flushPromises();
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
    // 透传给 core 的入参形状
    expect(mockSearchMessages).toHaveBeenCalledWith('s1', expect.objectContaining({
      mode: 'literal',
      caseSensitive: false,
      limit: 50,
    }));
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
      tree.root.findByProps({testID: 'chat-history-search-submit'}).props.onPress();
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
      tree.root.findByProps({testID: 'chat-history-search-submit'}).props.onPress();
      await flushPromises();
    });

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('隐藏消息');
    expect(json).toContain('已隐藏');
  });
});

describe('T-MO3 ChatHistorySearchScreen 返回', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
    mockSearchMessages.mockResolvedValue([]);
  });

  it('点击返回按钮触发 navigation.goBack', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ChatHistorySearchScreen />);
    });
    await act(async () => {
      tree.root.findByProps({testID: 'chat-history-search-back'}).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
