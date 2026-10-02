/**
 * T-MP2/T-MP4：工具组卡（默认收起 / 展开两格 / 三状态色文案 / 丢失占位）
 * 与叶子卡（kind 标签 + 限 2 行预览）的渲染与全屏载荷。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {
  PromptToolGroupCardData,
  PromptTextCardData,
} from '@novel-master/core/prompt';
import {PromptToolGroupCard} from '@/components/prompt/PromptToolGroupCard';
import {PromptTurnLeafCard} from '@/components/prompt/PromptTurnLeafCard';
import {takePromptTurnDetail} from '@/components/prompt/prompt-turn-callback';

const mockNavigate = jest.fn();
const mockOnToggle = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surface: '#fff',
      bgSecondary: '#f4f4f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#ddd',
      primary: '#06c',
    },
  }),
}));

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
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

const OK_CARD: PromptToolGroupCardData = {
  type: 'toolGroup',
  id: 'group-tu-1',
  toolName: 'read',
  inputJson: '{\n  "path": "a.md"\n}',
  result: {toolUseId: 'tu-1', ok: true, body: '文件内容'},
  status: 'ok',
  parallel: false,
};

const ERROR_CARD: PromptToolGroupCardData = {
  ...OK_CARD,
  id: 'group-tu-2',
  status: 'error',
  result: {toolUseId: 'tu-2', ok: false, body: 'Error: 路径不存在'},
};

const LOST_CARD: PromptToolGroupCardData = {
  ...OK_CARD,
  id: 'group-tu-3',
  status: 'lost',
  result: null,
  parallel: true,
};

function renderGroup(
  card: PromptToolGroupCardData,
  expanded: boolean,
): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PromptToolGroupCard
        card={card}
        turnId="turn-12"
        expanded={expanded}
        onToggle={mockOnToggle as (id: string) => void}
      />,
    );
  });
  return tree;
}

function press(tree: TestRenderer.ReactTestRenderer, testID: string): void {
  act(() => {
    (tree.root.findByProps({testID}).props as {onPress: (e?: unknown) => void}).onPress();
  });
}

describe('PromptToolGroupCard（T-MP2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    takePromptTurnDetail();
  });

  it('T-MP2-1 默认收起：不挂载 use/result 两格', () => {
    const tree = renderGroup(OK_CARD, false);
    expect(() => tree.root.findByProps({testID: 'prompt-tool-group-body'})).toThrow();
    // 收起时也读得到组头工具名与状态点。
    expect(tree.root.findByProps({testID: 'prompt-tool-group-name'}).props.children).toBe('read');
    expect(tree.root.findByProps({testID: 'prompt-tool-group-dot-ok'})).toBeTruthy();
  });

  it('T-MP2-2 展开出 use/result 两格，预览限 3 行', () => {
    const tree = renderGroup(OK_CARD, true);
    const useCell = tree.root.findByProps({testID: 'prompt-tool-group-use'});
    const resultCell = tree.root.findByProps({testID: 'prompt-tool-group-result'});
    expect(useCell).toBeTruthy();
    expect(resultCell).toBeTruthy();
    expect(
      tree.root.findByProps({testID: 'prompt-tool-group-use-preview'}).props
        .numberOfLines,
    ).toBe(3);
    expect(
      tree.root.findByProps({testID: 'prompt-tool-group-result-preview'}).props
        .numberOfLines,
    ).toBe(3);
  });

  it('T-MP2-3 三状态各有独立状态点与文案', () => {
    const label = (card: PromptToolGroupCardData) =>
      renderGroup(card, true).root.findByProps({
        testID: 'prompt-tool-group-status-label',
      }).props.children;
    expect(label(OK_CARD)).toBe('成功');
    expect(label(ERROR_CARD)).toBe('失败');
    expect(label(LOST_CARD)).toBe('丢失');
    for (const [card, status] of [
      [OK_CARD, 'ok'],
      [ERROR_CARD, 'error'],
      [LOST_CARD, 'lost'],
    ] as const) {
      expect(
        renderGroup(card, true).root.findByProps({
          testID: `prompt-tool-group-dot-${status}`,
        }),
      ).toBeTruthy();
    }
  });

  it('T-MP2-4 悬挂 use 走「未返回结果」占位 + 「并行」徽标', () => {
    const tree = renderGroup(LOST_CARD, true);
    expect(
      tree.root.findByProps({testID: 'prompt-tool-group-result-preview'}).props
        .children,
    ).toBe('未返回结果');
    expect(tree.root.findByProps({testID: 'prompt-tool-group-parallel'})).toBeTruthy();
    // 非并行卡不挂徽标。
    expect(() =>
      renderGroup(OK_CARD, true).root.findByProps({
        testID: 'prompt-tool-group-parallel',
      }),
    ).toThrow();
  });

  it('T-MP2-5 组头点按走 onToggle(groupId)', () => {
    press(renderGroup(OK_CARD, false), 'prompt-tool-group-head');
    expect(mockOnToggle).toHaveBeenCalledWith('group-tu-1');
  });

  it('T-MP4-4 两格各自全屏：载荷带 leafId、body 为本格正文', () => {
    press(renderGroup(OK_CARD, true), 'prompt-tool-group-use');
    expect(mockNavigate).toHaveBeenCalledWith('PromptTurnDetail', {
      title: 'tool use · read',
      turnId: 'turn-12',
    });
    expect(takePromptTurnDetail()).toEqual({
      title: 'tool use · read',
      body: OK_CARD.inputJson,
      leafId: 'group-tu-1-use',
    });

    press(renderGroup(OK_CARD, true), 'prompt-tool-group-result');
    expect(takePromptTurnDetail()).toEqual({
      title: 'tool result · read',
      body: '文件内容',
      leafId: 'group-tu-1-result',
    });
  });
});

const LEAF_CARD: PromptTextCardData = {
  type: 'text',
  id: 'card-m2-0',
  role: 'assistant',
  body: '第一行正文\n第二行正文\n第三行正文',
};

const THINKING_CARD: PromptTextCardData = {
  type: 'thinking',
  id: 'card-m1-1',
  role: 'assistant',
  body: '思考中……',
};

describe('PromptTurnLeafCard（T-MP2/T-MP4）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    takePromptTurnDetail();
  });

  it('T-MP2-6 kind 标签 + 限 2 行预览（thinking 单独标签）', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PromptTurnLeafCard card={LEAF_CARD} turnId="turn-12" />,
      );
    });
    expect(
      tree.root.findByProps({testID: 'prompt-turn-leaf-kind'}).props.children,
    ).toBe('assistant');
    const preview = tree.root.findByProps({
      testID: 'prompt-turn-leaf-preview',
    });
    expect(preview.props.numberOfLines).toBe(2);

    let thinkingTree!: TestRenderer.ReactTestRenderer;
    act(() => {
      thinkingTree = TestRenderer.create(
        <PromptTurnLeafCard card={THINKING_CARD} turnId="turn-12" />,
      );
    });
    expect(
      thinkingTree.root.findByProps({testID: 'prompt-turn-leaf-kind'}).props
        .children,
    ).toBe('thinking');
  });

  it('T-MP4-5 整卡点按进全屏：载荷带 leafId', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PromptTurnLeafCard card={LEAF_CARD} turnId="turn-12" />,
      );
    });
    press(tree, 'prompt-turn-leaf-card');
    expect(mockNavigate).toHaveBeenCalledWith('PromptTurnDetail', {
      title: 'assistant',
      turnId: 'turn-12',
    });
    expect(takePromptTurnDetail()).toEqual({
      title: 'assistant',
      body: LEAF_CARD.body,
      leafId: 'card-m2-0',
    });
  });
});