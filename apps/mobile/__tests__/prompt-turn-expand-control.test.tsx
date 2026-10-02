/**
 * T-MP3：屏级受控展开——`RealPromptScreen` 把轮/组的展开态存在屏级 Set 里，
 * toggle 回调改的是屏级 state，而不是组件内 state。
 *
 * 为什么钉死屏级：轮卡展开区在 FlatList 里，`removeClippedSubviews` 会把滚出
 * 窗口的 item 卸载掉，组件内 state 随之丢失，用户滚回来展开态被重置。
 *
 * FlatList 桩这里**真渲染** row（与 scope 用例的空桩不同），这样才能观测到
 * 「onToggle → 屏级 Set → PromptTurnCard expanded」这条真实链路。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import type {PromptPreviewTurn} from '@novel-master/core/prompt';
import {RealPromptScreen} from '@/screens/stack/RealPromptScreen';

const mockNavigate = jest.fn();
const mockBuildTurns = jest.fn(async () => [] as unknown[]);
/** 稳定引用的 runtime 桩（见下方 useRuntime 注释）。 */
const mockRuntime = {};

jest.mock('@/hooks/useMobileScope', () => ({
  useMobileScope: () => ({projectId: 'p1', sessionId: 's1'}),
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: undefined as unknown}),
  useNavigation: () => ({navigate: mockNavigate}),
}));

// ⚠️ 必须返回**稳定引用**：runtime 一变，屏内 load 的 useCallback 依赖就变，
// useEffect 跟着重跑 → setState → 重渲染 → 又是新 runtime，死循环直到 OOM。
jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@/services/prompt-preview.service', () => ({
  buildRealPromptPreviewTurns: (...args: unknown[]) =>
    mockBuildTurns(...(args as [])),
}));

jest.mock('@/services/agent-run.service', () => ({
  AgentRunError: class AgentRunError extends Error {},
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#fff',
      bgSecondary: '#f4f4f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#ddd',
      primary: '#06c',
      danger: '#c00',
    },
  }),
}));

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
    // 真渲染 row：受控链路必须落到真实组件上才有意义。
    FlatList: ({
      data,
      keyExtractor,
      renderItem,
    }: {
      data: readonly {id: string}[];
      keyExtractor: (item: {id: string}) => string;
      renderItem: (info: {item: unknown; index: number}) => React.ReactNode;
    }) =>
      mockReact.createElement(
        'FlatList',
        {},
        data.map((item, index) =>
          mockReact.createElement(
            mockReact.Fragment,
            {key: keyExtractor(item)},
            renderItem({item, index}),
          ),
        ),
      ),
    Pressable: ({
      children,
      onPress,
      ...rest
    }: {
      children?: React.ReactNode;
      onPress?: (event?: {stopPropagation?: () => void}) => void;
    }) => mockReact.createElement('Pressable', {...rest, onPress}, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children, ...rest}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', rest, children),
    View: ({children, ...rest}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', rest, children),
  };
});

const TURN: PromptPreviewTurn = {
  id: 'turn-12',
  kind: 'assistant',
  items: [],
  summary: '好的，我来看看。 · 工具调用 1 次 · 12 字',
  body: '[assistant]\n好的，我来看看。',
  summaryText: '好的，我来看看。',
  metaText: '#12 · 工具调用 1 次 · 12 字',
  cards: [
    {
      type: 'toolGroup',
      id: 'group-tu-1',
      toolName: 'read',
      inputJson: '{}',
      result: {toolUseId: 'tu-1', ok: true, body: '文件内容'},
      status: 'ok',
      parallel: false,
    },
  ],
};

async function renderScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<RealPromptScreen />);
  });
  await Promise.resolve();
  await Promise.resolve();
  act(() => {
    tree.update(<RealPromptScreen />);
  });
  return tree;
}

function press(tree: TestRenderer.ReactTestRenderer, testID: string): void {
  act(() => {
    (tree.root.findByProps({testID}).props as {onPress: (e?: unknown) => void}).onPress();
  });
}

describe('RealPromptScreen 屏级受控展开（T-MP3）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildTurns.mockResolvedValue([TURN]);
  });

  it('T-MP3-1 toggle 改屏级 openTurnIds：展开区随之挂载/卸载', async () => {
    const tree = await renderScreen();
    expect(() => tree.root.findByProps({testID: 'prompt-turn-body'})).toThrow();

    press(tree, 'prompt-turn-head');
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();
    // 展开区里能看到该轮的卡片流（工具组卡）。
    expect(tree.root.findByProps({testID: 'prompt-tool-group-card'})).toBeTruthy();

    press(tree, 'prompt-turn-head');
    expect(() => tree.root.findByProps({testID: 'prompt-turn-body'})).toThrow();
  });

  it('T-MP3-2 组卡展开同样受控（openGroupIds 与轮展开独立）', async () => {
    const tree = await renderScreen();
    press(tree, 'prompt-turn-head');
    // 轮展开、组收起。
    expect(() => tree.root.findByProps({testID: 'prompt-tool-group-body'})).toThrow();

    press(tree, 'prompt-tool-group-head');
    expect(tree.root.findByProps({testID: 'prompt-tool-group-body'})).toBeTruthy();
    // 收起组不影响轮展开态。
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();
  });
});