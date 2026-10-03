/**
 * T-WP1：workplace 组卡（常驻工作区段的文件级二级卡）。
 *
 * 覆盖：组头「workplace · N 文件」收起/展开（受控）、文件小卡（路径 +
 * 展示档 pill + 预览限行）、点文件卡进全屏（载荷带 path 标题与块内正文）。
 * 数据源形态对齐 core `PromptWorkplaceCardData`（kkv 规则快照源头直通）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {PromptWorkplaceCardData} from '@novel-master/core/prompt';
import {PromptWorkplaceCard} from '@/components/prompt/PromptWorkplaceCard';
import {takePromptTurnDetail} from '@/components/prompt/prompt-turn-callback';

const mockNavigate = jest.fn();
const mockOnToggle = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#F2F2F7',
      bgSecondary: '#f4f4f5',
      surface: '#fff',
      surfaceElevated: '#fff',
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
      onPress?: () => void;
    }) => mockReact.createElement('Pressable', {...rest, onPress}, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children, ...rest}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', rest, children),
    View: ({children, ...rest}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', rest, children),
  };
});

const CARD: PromptWorkplaceCardData = {
  type: 'workplace',
  id: 'prompt-workplace',
  files: [
    {path: 'outline/大纲.md', display: 'full', body: '1|第一行\n2|第二行'},
    {path: 'notes/草稿.txt', display: 'filename', body: '1|草稿.txt'},
    {path: 'meta/info.md', display: 'header', body: '---\ntitle: x\n---'},
  ],
};

function renderCard(
  expanded: boolean,
): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PromptWorkplaceCard
        card={CARD}
        turnId="turn-wt"
        expanded={expanded}
        onToggle={mockOnToggle as (id: string) => void}
      />,
    );
  });
  return tree;
}

describe('PromptWorkplaceCard（T-WP1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    takePromptTurnDetail();
  });

  it('T-WP1-1 默认收起：组头带文件计数，不挂载文件小卡', () => {
    const tree = renderCard(false);
    // mock Text 把 `{n} 文件` 摊成 [3, ' 文件']，join 回来再比。
    expect(
      tree.root.findByProps({testID: 'prompt-workplace-count'}).props.children
        .join(''),
    ).toBe('3 文件');
    expect(() =>
      tree.root.findByProps({testID: 'prompt-workplace-body'}),
    ).toThrow();
    expect(
      tree.root.findByProps({testID: 'prompt-workplace-head'}).props
        .accessibilityState,
    ).toEqual({expanded: false});
  });

  it('T-WP1-2 组头点按走 onToggle(cardId)', () => {
    const tree = renderCard(false);
    act(() => {
      tree.root.findByProps({testID: 'prompt-workplace-head'}).props.onPress();
    });
    expect(mockOnToggle).toHaveBeenCalledWith('prompt-workplace');
  });

  it('T-WP1-3 展开出文件小卡：路径 + 展示档文案 + 预览限 6 行', () => {
    const tree = renderCard(true);
    // mock 下复合节点与宿主节点带同一份 props，findAllByProps 双计数——滤宿主层。
    const hostsOf = (testID: string) =>
      tree.root.findAllByProps({testID}).filter(n => typeof n.type === 'string');
    const paths = hostsOf('prompt-workplace-file-path').map(
      n => n.props.children,
    );
    expect(paths).toEqual([
      'outline/大纲.md',
      'notes/草稿.txt',
      'meta/info.md',
    ]);
    // 展示档文案（快照原值直译，不做推断）。
    const displays = hostsOf('prompt-workplace-file-display').map(
      n => n.props.children,
    );
    expect(displays).toEqual(['全文', '仅文件名', '头信息']);
    expect(
      hostsOf('prompt-workplace-file-preview')[0]!.props.numberOfLines,
    ).toBe(6);
  });

  it('T-WP1-4 点文件卡进全屏：标题=路径、正文=块内正文、leafId 带路径', () => {
    const tree = renderCard(true);
    act(() => {
      tree.root.findAllByProps({testID: 'prompt-workplace-file'})[0]!.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('PromptTurnDetail', {
      title: 'outline/大纲.md',
      turnId: 'turn-wt',
    });
    expect(takePromptTurnDetail()).toEqual({
      title: 'outline/大纲.md',
      body: '1|第一行\n2|第二行',
      leafId: 'prompt-workplace:outline/大纲.md',
    });
  });

  it('T-WP1-5 智能体配置卡片体系：灰底 + 左 3px primary 粗条、文件卡白底浮起', () => {
    const tree = renderCard(true);
    const flatten = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(flatten))
        : (style ?? {});
    const group = flatten(
      tree.root.findByProps({testID: 'prompt-workplace-card'}).props.style,
    );
    expect(group.borderLeftWidth).toBe(3);
    expect(group.borderLeftColor).toBe('#06c');
    expect(group.backgroundColor).toBe('#f4f4f5');
    const file = flatten(
      tree.root.findAllByProps({testID: 'prompt-workplace-file'})[0]!.props
        .style,
    );
    expect(file.backgroundColor).toBe('#fff');
    expect(file.borderLeftWidth).toBe(3);
  });
});
