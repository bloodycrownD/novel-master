/**
 * T-WP1：workplace 文件列表卡（层级：轮 → 文件列表 → 预览卡 → 全屏）。
 *
 * 无组头（用户拍板：轮摘要已标 workplace，点轮展开直接见文件列表）。
 * 覆盖：文件列表行（路径 + 展示档 pill，单行无正文）、点列表行就地展开
 * 预览卡（受控 openFilePaths）、点预览卡进全屏（载荷带 path 标题与块内正文）。
 * 数据源形态对齐 core `PromptWorkplaceCardData`（kkv 规则快照源头直通）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {PromptWorkplaceCardData} from '@novel-master/core/prompt';
import {PromptWorkplaceCard} from '@/components/prompt/PromptWorkplaceCard';
import {takePromptTurnDetail} from '@/components/prompt/prompt-turn-callback';

const mockNavigate = jest.fn();
const mockOnToggleFile = jest.fn();

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

/** 样式数组拍平成单对象（与 prompt-turn-card.test 同款）。 */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style as Record<string, unknown>;
}

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
  openGroupIds: ReadonlySet<string> = new Set<string>(),
): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PromptWorkplaceCard
        card={CARD}
        turnId="turn-wt"
        openGroupIds={openGroupIds}
        onToggleFile={mockOnToggleFile as (path: string) => void}
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

  it('T-WP1-1 无组头直出文件列表行（路径 + 展示档，单行无正文预览）', () => {
    const tree = renderCard();
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
    expect(displays).toEqual(['全内容', '文件名', '文件头']);
    // 列表行不挂正文预览（层级：列表 → 预览 → 全屏）。
    expect(() =>
      tree.root.findByProps({testID: 'prompt-workplace-file-preview'}),
    ).toThrow();
  });

  it('T-WP1-2 点列表行 toggle 该文件预览卡（受控 openFilePaths）', () => {
    const tree = renderCard();
    act(() => {
      tree.root.findAllByProps({testID: 'prompt-workplace-file'})[0]!.props.onPress();
    });
    expect(mockOnToggleFile).toHaveBeenCalledWith('outline/大纲.md');

    // openFilePaths 含该文件 → 预览卡挂载（限 6 行，块内正文）。
    const expandedTree = renderCard(new Set(['prompt-workplace:outline/大纲.md']));
    const preview =
      expandedTree.root.findByProps({testID: 'prompt-workplace-file-preview'});
    expect(preview.props.accessibilityLabel).toBe(
      '查看文件全文 outline/大纲.md',
    );
    expect(
      expandedTree.root.findByProps({testID: 'prompt-workplace-file-preview-text'})
        .props.children,
    ).toBe('1|第一行\n2|第二行');
    expect(
      expandedTree.root.findByProps({testID: 'prompt-workplace-file-preview-text'})
        .props.numberOfLines,
    ).toBe(6);
    // R3：预览正文用正常正文色（mock token text=#111），非禁用灰 #666。
    expect(
      flattenStyle(
        expandedTree.root.findByProps({testID: 'prompt-workplace-file-preview-text'})
          .props.style,
      ).color,
    ).toBe('#111');
    // 未展开的文件不出预览卡（滤宿主层防复合/宿主双计）。
    expect(
      expandedTree.root
        .findAllByProps({testID: 'prompt-workplace-file-preview'})
        .filter(n => typeof n.type === 'string').length,
    ).toBe(1);
  });

  it('T-WP1-3 点预览卡进全屏：标题=路径、正文=块内正文、leafId 带路径', () => {
    const tree = renderCard(new Set(['prompt-workplace:outline/大纲.md']));
    act(() => {
      tree.root.findByProps({testID: 'prompt-workplace-file-preview'}).props.onPress();
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

  it('T-WP1-4 智能体配置卡片体系：列表壳灰底+左 3px primary 粗条、预览卡白底浮起', () => {
    const tree = renderCard(new Set(['prompt-workplace:outline/大纲.md']));
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
    const preview = flatten(
      tree.root.findByProps({testID: 'prompt-workplace-file-preview'}).props
        .style,
    );
    expect(preview.backgroundColor).toBe('#fff');
    expect(preview.borderLeftWidth).toBe(3);
  });
});
