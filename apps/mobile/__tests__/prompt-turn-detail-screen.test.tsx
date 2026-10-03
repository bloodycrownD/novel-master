/**
 * T-R7 / T-MP5（mobile 侧之二）：轮详情屏经模块级 callback 取数渲染正文。
 *
 * 观测面：FileMarkdownPreview 桩收到的 props——纯预览态壳（无 editor 内容、
 * 无保存按钮）、「渲染 / 原文」segmented 两档可切（默认 rich：跳过
 * front-matter 与扩展名判定直接进 WebView 富文本管线，不做「伪 .md 路径」
 * 那条路；原文档纯文本铺开），path 是
 * `turn-<turnId>` / `turn-<turnId>-leaf-<leafId>` 稳定伪 key（WebView 靠它重挂载）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {PromptTurnDetailScreen} from '@/screens/stack/PromptTurnDetailScreen';
import {
  setPromptTurnDetail,
  takePromptTurnDetail,
} from '@/components/prompt/prompt-turn-callback';

const mockSetStackOverride = jest.fn();
const mockPreviewProps: {
  path: string;
  content: string;
  renderKind?: string;
  previewFill?: boolean;
}[] = [];

const mockRouteParams: {title?: string; turnId?: string} = {
  title: '好的，我来看看。',
  turnId: 'turn-12',
};

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: mockRouteParams}),
}));

jest.mock('@/navigation/HeaderContext', () => ({
  useStackOverrideSetter: () => mockSetStackOverride,
}));

jest.mock('@/components/vfs/FileMarkdownPreview', () => {
  const mockReact = require('react');
  return {
    FileMarkdownPreview: (props: {
      path: string;
      content: string;
      renderKind?: string;
      previewFill?: boolean;
    }) => {
      mockPreviewProps[0] = props;
      return mockReact.createElement('FileMarkdownPreview', {});
    },
  };
});

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#fff',
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
    Platform: {OS: 'android'},
    // 透传 onPress/testID：segmented 切换用例要真点 tab（T-MP6）。
    Pressable: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => mockReact.createElement('Pressable', {onPress, testID}, children),
    ScrollView: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('ScrollView', {}, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', {}, children),
  };
});

const BODY = '[assistant]\n好的，我来看看。\n\n[tool_call]\n{"name":"read"}';

function renderScreen(): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PromptTurnDetailScreen />);
  });
  return tree;
}

describe('PromptTurnDetailScreen（T-R7 mobile）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreviewProps.length = 0;
    mockRouteParams.title = '好的，我来看看。';
    mockRouteParams.turnId = 'turn-12';
    // 模块级单例复位。
    takePromptTurnDetail();
  });

  it('T-R7-5 经 callback 取数渲染 body（纯预览态 / rich 档 / 铺满）', () => {
    setPromptTurnDetail({title: '好的，我来看看。', body: BODY});
    const tree = renderScreen();
    expect(mockPreviewProps[0]).toMatchObject({
      path: 'turn-turn-12',
      content: BODY,
      renderKind: 'rich',
      previewFill: true,
    });
    // 纯预览态：壳内不渲染编辑区，也不渲染保存/切换 toolbar。
    expect(tree.root.findAllByType('FileMarkdownPreview' as never).length).toBe(1);
    expect(tree.root.findAllByType('CodeEditorWebView' as never).length).toBe(0);
  });

  it('T-MP5 叶子级全屏：path 带 leafId 后缀（WebView 靠 key 重挂载）', () => {
    setPromptTurnDetail({title: 'assistant', body: BODY, leafId: 'card-m2-0'});
    renderScreen();
    expect(mockPreviewProps[0]).toMatchObject({
      path: 'turn-turn-12-leaf-card-m2-0',
      renderKind: 'rich',
    });
  });

  it('T-MP5 轮 id 缺失时回落占位 key（不抛）', () => {
    mockRouteParams.turnId = undefined;
    setPromptTurnDetail({title: 'A', body: BODY});
    renderScreen();
    expect(mockPreviewProps[0]?.path).toBe('turn-unknown');
  });

  it('T-R7-6 挂载即消费（读后即清，不残留给下一次进屏）', () => {
    setPromptTurnDetail({title: 'A', body: BODY});
    renderScreen();
    expect(takePromptTurnDetail()).toBeNull();
  });

  it('T-R7-7 未写入 callback 时静默渲染空正文（不抛）', () => {
    renderScreen();
    expect(mockPreviewProps[0]?.content).toBe('');
  });

  it('T-R7-8 路由短标题走 header override', () => {
    renderScreen();
    expect(mockSetStackOverride).toHaveBeenCalledWith({title: '好的，我来看看。'});
  });

  it('T-MP6 渲染/原文 segmented：默认渲染档，点原文切 txt、点渲染切回 rich', () => {
    setPromptTurnDetail({title: 'A', body: BODY});
    const tree = renderScreen();
    // 初始渲染档（富文本管线）。
    expect(mockPreviewProps[0]?.renderKind).toBe('rich');
    // 点「原文」tab：FileMarkdownPreview 收到 txt 档（纯文本铺开）。
    act(() => {
      tree.root.findByProps({testID: 'prompt-turn-detail-tab-txt'}).props.onPress();
    });
    expect(mockPreviewProps[0]?.renderKind).toBe('txt');
    // 点「渲染」tab：切回 rich。
    act(() => {
      tree.root
        .findByProps({testID: 'prompt-turn-detail-tab-rich'})
        .props.onPress();
    });
    expect(mockPreviewProps[0]?.renderKind).toBe('rich');
  });
});