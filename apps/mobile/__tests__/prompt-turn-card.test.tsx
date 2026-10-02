/**
 * T-R7（mobile 侧之一）：assistant 轮卡片渲染摘要 + 点按经模块级 callback
 * 把正文交给详情屏 + 路由只带短标题。
 *
 * 另外覆盖 `prompt-turn-callback` 的 take 语义（读后即清）——正文可达数百 KB，
 * 走路由参数不可行，残留就会让下一次进详情显示上一轮的内容。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {PromptTurnCard} from '@/components/prompt/PromptTurnCard';
import {
  setPromptTurnDetail,
  takePromptTurnDetail,
} from '@/components/prompt/prompt-turn-callback';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surface: '#fff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
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
      onPress?: () => void;
    }) => mockReact.createElement('Pressable', {...rest, onPress}, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

/** 递归收集渲染树里的文本片段（Text 桩把 children 铺平，故按字符串叶节点取）。 */
function textsOf(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(textsOf);
  }
  if (node != null && typeof node === 'object') {
    const children = (node as {children?: unknown}).children;
    return children == null ? [] : textsOf(children);
  }
  return [];
}

const TURN = {
  id: 'seg-12',
  kind: 'assistant' as const,
  items: [
    {id: 'seg-12', role: 'assistant', title: 'assistant', body: '好的，我来看看。'},
  ],
  summary: '好的，我来看看。',
  body: '[assistant]\n好的，我来看看。',
};

function renderCard(turn: typeof TURN = TURN): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PromptTurnCard turn={turn} />);
  });
  return tree;
}

function pressCard(tree: TestRenderer.ReactTestRenderer): void {
  const pressable = tree.root.findByType('Pressable' as never);
  act(() => {
    (pressable.props as {onPress: () => void}).onPress();
  });
}

describe('PromptTurnCard（T-R7 mobile）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 模块级单例复位：残留正文会让下一条用例读到上一轮的数据。
    takePromptTurnDetail();
  });

  it('T-R7-1 渲染 role 标与轮摘要', () => {
    const texts = textsOf(renderCard().toJSON());
    expect(texts).toContain('助手轮');
    expect(texts).toContain(TURN.summary);
  });

  it('T-R7-2 点按：正文经 callback 交付、路由只带短标题', () => {
    pressCard(renderCard());
    expect(mockNavigate).toHaveBeenCalledWith('PromptTurnDetail', {
      title: TURN.summary,
    });
    expect(takePromptTurnDetail()).toEqual({
      title: TURN.summary,
      body: TURN.body,
    });
  });

  it('T-R7-3 callback take 读后即清（防串台）', () => {
    setPromptTurnDetail({title: 'A', body: '轮 A'});
    expect(takePromptTurnDetail()).toEqual({title: 'A', body: '轮 A'});
    expect(takePromptTurnDetail()).toBeNull();
  });

  it('T-R7-4 长摘要截断后才进路由标题（顶栏不被塞满）', () => {
    const longSummary = 'x'.repeat(80);
    pressCard(renderCard({...TURN, summary: longSummary}));
    const params = mockNavigate.mock.calls[0]?.[1] as {title: string};
    expect(params.title.length).toBe(24);
    expect(params.title.endsWith('…')).toBe(true);
  });
});