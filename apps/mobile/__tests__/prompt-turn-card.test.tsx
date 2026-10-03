/**
 * T-MP1：轮摘要卡三态渲染 + 单行限行 + role 徽标 pill 两态样式；轮卡不再出
 * ⤢（全屏入口只在二级卡，见 expand-control / tool-group-card 两套测试）。
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
      surfaceElevated: '#fff',
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

/** 展平 StyleSheet 数组样式（RN mock 的 StyleSheet.create 是恒等函数）。 */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return (style ?? {}) as Record<string, unknown>;
}

const TURN = {
  id: 'turn-12',
  kind: 'assistant' as const,
  items: [
    {id: 'seg-12', role: 'assistant', title: 'assistant', body: '好的，我来看看。'},
  ],
  summary: '好的，我来看看。 · 工具调用 0 次 · 6 字',
  // main/A-2 后 UI 不再读 body，字段仅为满足 core 类型（`body` 是必填）。
  body: '',
  summaryText: '好的，我来看看。',
  metaText: '#12 · 工具调用 0 次 · 6 字',
  cards: [
    {type: 'text' as const, id: 'card-12-0', role: 'assistant', body: '好的，我来看看。'},
  ],
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

  it('T-MP1-1 三类 role 徽标渲染（user/assistant/system，无「轮」字后缀）', () => {
    expect(textsOf(renderCard().toJSON())).toContain('assistant');
    expect(textsOf(renderCard({kind: 'user'}).toJSON())).toContain('user');
    expect(textsOf(renderCard({kind: 'system'}).toJSON())).toContain(
      'system',
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
    // 展开区不画左竖线（智能体配置体系：子卡自带 3px 左条表达嵌套）。
    const body = flattenStyle(
      tree.root.findByProps({testID: 'prompt-turn-body'}).props.style,
    );
    expect(body.borderLeftWidth).toBeUndefined();
    // 外层轮卡 = FormSectionCard 形态：surfaceElevated 底 + 16 圆角浮起。
    const card = flattenStyle(
      tree.root.findByProps({testID: 'prompt-turn-card'}).props.style,
    );
    expect(card.backgroundColor).toBe('#fff');
    expect(card.borderRadius).toBe(16);
  });

  it('T-MP1-5 role 徽标 pill 两态（user 主蓝底白字 / assistant 与 system 中性灰底）', () => {
    const roleStyle = (kind: 'user' | 'assistant' | 'system') =>
      flattenStyle(
        renderCard({kind}).root.findByProps({testID: 'prompt-turn-role'})
          .props.style,
      );
    // mock token：primary=#06c、bgSecondary=#f4f4f5、text=#111。
    expect(roleStyle('user').backgroundColor).toBe('#06c');
    expect(roleStyle('user').color).toBe('#fff');
    // assistant 与 system 共用中性灰底正文色（轮 kind = 消息 role，无特殊分类）。
    expect(roleStyle('assistant').backgroundColor).toBe('#f4f4f5');
    expect(roleStyle('assistant').color).toBe('#111');
    expect(roleStyle('system').backgroundColor).toBe('#f4f4f5');
    expect(roleStyle('system').color).toBe('#111');
    expect(roleStyle('system').borderWidth).toBeUndefined();
  });

  it('T-MP1-4 头部点按走 onToggle(turnId)；轮卡不再出 ⤢（全屏入口只在二级卡）', () => {
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
    expect(onToggle).toHaveBeenCalledTimes(1);
    // 轮卡无整轮全屏入口（用户拍板：一级卡片下有二级卡片，二级能进全屏就够）。
    expect(() =>
      tree.root.findByProps({testID: 'prompt-turn-fullscreen'}),
    ).toThrow();
  });

  it('T-J1-1 轮头无障碍标签带角色与摘要、头部带 expanded 态', () => {
    const tree = renderCard({}, false);
    expect(
      tree.root.findByProps({testID: 'prompt-turn-head'}).props
        .accessibilityLabel,
    ).toBe('展开assistant轮，好的，我来看看。');
    expect(
      tree.root.findByProps({testID: 'prompt-turn-head'}).props
        .accessibilityState,
    ).toEqual({expanded: false});
    expect(
      renderCard({}, true).root.findByProps({testID: 'prompt-turn-head'}).props
        .accessibilityLabel,
    ).toBe('收起assistant轮，好的，我来看看。');
  });

  it('T-MP4-2 callback take 读后即清（防串台）', () => {
    setPromptTurnDetail({title: 'A', body: '轮 A'});
    expect(takePromptTurnDetail()).toEqual({title: 'A', body: '轮 A'});
    expect(takePromptTurnDetail()).toBeNull();
  });
});