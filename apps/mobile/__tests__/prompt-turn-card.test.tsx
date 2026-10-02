/**
 * T-MP1/T-MP4：轮摘要卡三态渲染 + 单行限行；整轮/叶子全屏 callback 载荷
 * （title/body/leafId）与「navigate 只带短标题」。
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
  id: 'turn-12',
  kind: 'assistant' as const,
  items: [
    {id: 'seg-12', role: 'assistant', title: 'assistant', body: '好的，我来看看。'},
  ],
  summary: '好的，我来看看。 · 工具调用 0 次 · 6 字',
  body: '[assistant]\n好的，我来看看。',
  summaryText: '好的，我来看看。',
  metaText: '#12 · 工具调用 0 次 · 6 字',
  cards: [],
};

function renderCard(
  overrides: Partial<typeof TURN> = {},
  expanded = false,
): TestRenderer.ReactTestRenderer {
  const turn = {...TURN, ...overrides};
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PromptTurnCard
        turn={turn}
        expanded={expanded}
        onToggle={() => undefined}
      />,
    );
  });
  return tree;
}

function pressByTestID(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): void {
  const node = tree.root.findByProps({testID});
  act(() => {
    (node.props as {onPress: (e?: unknown) => void}).onPress();
  });
}

describe('PromptTurnCard（T-MP1/T-MP4 mobile）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 模块级单例复位：残留正文会让下一条用例读到上一轮的数据。
    takePromptTurnDetail();
  });

  it('T-MP1-1 三态 role 徽标渲染（user/assistant/template，无「轮」字后缀）', () => {
    expect(textsOf(renderCard().toJSON())).toContain('assistant');
    expect(textsOf(renderCard({kind: 'user'}).toJSON())).toContain('user');
    expect(textsOf(renderCard({kind: 'template'}).toJSON())).toContain(
      'template',
    );
  });

  it('T-MP1-2 摘要与计数行各限 1 行（numberOfLines=1）', () => {
    const tree = renderCard();
    const summary = tree.root.findByProps({testID: 'prompt-turn-summary'});
    const meta = tree.root.findByProps({testID: 'prompt-turn-meta'});
    expect(summary.props.numberOfLines).toBe(1);
    expect(meta.props.numberOfLines).toBe(1);
    // 读的是新字段 summaryText/metaText，不是旧 summary 拼接串。
    expect(textsOf(summary.props.children)).toEqual([TURN.summaryText]);
    expect(textsOf(meta.props.children)).toEqual([TURN.metaText]);
    expect(textsOf(summary.props.children)).not.toContain(TURN.summary);
  });

  it('T-MP1-3 默认收起不挂载展开区，展开时挂载 children', () => {
    expect(() =>
      renderCard().root.findByProps({testID: 'prompt-turn-body'}),
    ).toThrow();
    const tree = renderCard({}, true);
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();
  });

  it('T-MP1-4 头部点按走 onToggle(turnId)，⤢ 不触发 toggle', () => {
    const onToggle = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PromptTurnCard
          turn={TURN}
          expanded={false}
          onToggle={onToggle as (id: string) => void}
        />,
      );
    });
    pressByTestID(tree, 'prompt-turn-head');
    expect(onToggle).toHaveBeenCalledWith(TURN.id);
    const stopPropagation = jest.fn();
    act(() => {
      (tree.root.findByProps({testID: 'prompt-turn-fullscreen'}).props as {
        onPress: (e?: unknown) => void;
      }).onPress({stopPropagation});
    });
    // 嵌套 Pressable 阻止冒泡：点 ⤢ 不会顺带把轮展开。
    expect(stopPropagation).toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('T-MP4-1 整轮全屏：正文经 callback 交付、路由只带短标题', () => {
    pressByTestID(renderCard(), 'prompt-turn-fullscreen');
    expect(mockNavigate).toHaveBeenCalledWith('PromptTurnDetail', {
      title: TURN.summaryText,
      turnId: TURN.id,
    });
    expect(takePromptTurnDetail()).toEqual({
      title: TURN.summaryText,
      body: TURN.body,
    });
  });

  it('T-MP4-2 callback take 读后即清（防串台）', () => {
    setPromptTurnDetail({title: 'A', body: '轮 A'});
    expect(takePromptTurnDetail()).toEqual({title: 'A', body: '轮 A'});
    expect(takePromptTurnDetail()).toBeNull();
  });

  it('T-MP4-3 叶子全屏载荷带 leafId、路由标题截到 24 字', () => {
    const longSummary = 'x'.repeat(80);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PromptTurnCard
          turn={{...TURN, summaryText: longSummary}}
          expanded={false}
          onToggle={() => undefined}
        />,
      );
    });
    pressByTestID(tree, 'prompt-turn-fullscreen');
    const params = mockNavigate.mock.calls[0]?.[1] as {title: string};
    expect(params.title.length).toBe(24);
    expect(params.title.endsWith('…')).toBe(true);
  });
});