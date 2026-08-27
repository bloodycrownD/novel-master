/**
 * T-PE3 + R5：PromptEditorScreen 保存以草稿回填回调并 goBack；取消不回填。
 * 回调不走路由参数（不可序列化）：先 setPromptEditorOnSaved 再渲染 Screen，
 * 保存时回调被调；未 set 时保存仅 goBack 不抛错。
 * R5 对齐工作区 FileEditorScreen：顶栏右侧「预览/编辑」切换，预览走
 * FileMarkdownPreview（内存草稿，无 VFS），编辑器伪路径 prompt.md（md 高亮）。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import React from 'react';
import {Platform} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

const mockGoBack = jest.fn();
const mockRoute = {
  params: {initialText: '初稿'} as {title?: string; initialText: string},
};
// 捕获 CodeEditorWebView stub 的 props，模拟编辑器回传 onChange（jest.mock 工厂仅可引用 mock 前缀变量）。
const mockEditorProps: {
  value: string;
  path: string;
  onChange: (text: string) => void;
}[] = [];
// 捕获 FileMarkdownPreview stub 的 props，断言预览吃到内存草稿。
const mockPreviewProps: {
  path: string;
  content: string;
  renderKind: string;
  previewFill?: boolean;
}[] = [];
// 捕获 SegmentedControl stub 的 props，驱动 Markdown/文本切换。
const mockSegmentedProps: {
  value: string;
  onChange: (value: string) => void;
}[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: mockGoBack}),
  useRoute: () => mockRoute,
}));

jest.mock('../src/components/vfs/CodeEditorWebView', () => {
  // forwardRef 包装：真组件接 codeEditorRef，stub 不接会报 function component ref 警告。
  const mockReact = require('react');
  return {
    CodeEditorWebView: mockReact.forwardRef(function CodeEditorWebViewStub(
      props: {
        value: string;
        path: string;
        onChange: (text: string) => void;
      },
      _ref: unknown,
    ) {
      mockEditorProps[0] = props;
      return null;
    }),
  };
});

jest.mock('../src/components/vfs/FileMarkdownPreview', () => ({
  FileMarkdownPreview: (props: {
    path: string;
    content: string;
    renderKind: string;
    previewFill?: boolean;
  }) => {
    mockPreviewProps[0] = props;
    return null;
  },
}));

jest.mock('../src/components/ui/SegmentedControl', () => ({
  SegmentedControl: (props: {value: string; onChange: (v: string) => void}) => {
    mockSegmentedProps[0] = props;
    return null;
  },
}));

jest.mock('../src/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: jest.fn()}),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      surface: '#fff',
      bgSecondary: '#f5f5f5',
      borderLight: '#ddd',
      primary: '#007aff',
    },
  }),
}));

import {PromptEditorScreen} from '../src/screens/stack/PromptEditorScreen';
import {
  setPromptEditorOnSaved,
  takePromptEditorOnSaved,
} from '../src/components/agent/prompt-editor-callback';

function renderScreen() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PromptEditorScreen />);
  });
  return tree!;
}

function pressToggle(tree: TestRenderer.ReactTestRenderer) {
  act(() => {
    tree.root.findByProps({testID: 'prompt-editor-toggle'}).props.onPress();
  });
}

describe('PromptEditorScreen (T-PE3 + R5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorProps.length = 0;
    mockPreviewProps.length = 0;
    mockSegmentedProps.length = 0;
    // 清空模块级回调残留，各用例自行决定是否 set。
    takePromptEditorOnSaved();
  });

  afterEach(() => {
    mockRoute.params = {initialText: '初稿'} as {
      title?: string;
      initialText: string;
    };
  });

  it('挂载即以 initialText 为草稿，默认编辑态走 md 伪路径', () => {
    mockRoute.params = {initialText: '初稿'};
    renderScreen();
    expect(mockEditorProps[0]!.value).toBe('初稿');
    // 提示词当作 markdown：编辑高亮走 md（伪路径 .md 结尾）。
    expect(mockEditorProps[0]!.path).toBe('prompt.md');
    // 默认编辑态：预览组件尚未挂载。
    expect(mockPreviewProps[0]).toBeUndefined();
  });

  it('编辑/预览切换：预览吃到内存草稿 + SegmentedControl，切回编辑草稿不丢', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('# 改后的草稿');
    });
    pressToggle(tree);
    // 预览渲染当前草稿（内存文本，无 VFS）。
    expect(mockPreviewProps[0]!.content).toBe('# 改后的草稿');
    expect(mockPreviewProps[0]!.path).toBe('prompt.md');
    expect(mockPreviewProps[0]!.previewFill).toBe(true);
    expect(mockPreviewProps[0]!.renderKind).toBe('markdown');
    expect(mockSegmentedProps[0]!.value).toBe('markdown');
    // 切回编辑：编辑器仍在场且草稿保留。
    pressToggle(tree);
    expect(mockEditorProps[0]!.value).toBe('# 改后的草稿');
  });

  it('预览态 SegmentedControl 可切「文本」渲染', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    pressToggle(tree);
    act(() => {
      mockSegmentedProps[0]!.onChange('txt');
    });
    expect(mockPreviewProps[0]!.renderKind).toBe('txt');
    // 预览内容不受 tab 切换影响。
    expect(mockPreviewProps[0]!.content).toBe('初稿');
    void tree;
  });

  it('保存：以草稿调用模块级回调并 goBack（预览态保存也不丢草稿）', () => {
    const onSaved = jest.fn();
    setPromptEditorOnSaved(onSaved);
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();

    // 模拟编辑器改稿后切到预览再保存
    act(() => {
      mockEditorProps[0]!.onChange('改后的草稿');
    });
    pressToggle(tree);
    act(() => {
      tree.root.findByProps({testID: 'prompt-editor-save'}).props.onPress();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('改后的草稿');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('未 set 回调时保存仅 goBack，不抛错', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      tree.root.findByProps({testID: 'prompt-editor-save'}).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('取消：直接 goBack，不调用回调', () => {
    const onSaved = jest.fn();
    setPromptEditorOnSaved(onSaved);
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('不落盘的改动');
    });
    act(() => {
      tree.root.findByProps({testID: 'prompt-editor-cancel'}).props.onPress();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('顶栏左右两角：取消居左、保存居右（切换按钮在保存右侧前不移占两角）', () => {
    mockRoute.params = {initialText: '初稿', title: '系统提示词'};
    const tree = renderScreen();
    const save = tree.root.findByProps({testID: 'prompt-editor-save'});
    const cancel = tree.root.findByProps({testID: 'prompt-editor-cancel'});
    // 顶栏（toolbar）子节点顺序：取消 → 标题（flex:1）→ 保存 → 编辑/预览切换
    const toolbar = cancel.parent!;
    const children = toolbar.children.filter(
      (c): c is TestRenderer.ReactTestInstance =>
        typeof c === 'object' && c !== null,
    );
    expect(children[0]).toBe(cancel);
    // 两角按钮保留：取消最左、保存在切换按钮左侧（倒数第二）。
    expect(children[children.length - 2]).toBe(save);
    const texts = tree.root
      .findAll(node => typeof node.children?.[0] === 'string')
      .map(node => String(node.children[0]));
    expect(texts).toContain('系统提示词');
  });

  it('Android 分支：键盘抬升包裹下保存/取消仍可触达', () => {
    const originalOS = Platform.OS;
    (Platform as {OS: string}).OS = 'android';
    try {
      const onSaved = jest.fn();
      setPromptEditorOnSaved(onSaved);
      mockRoute.params = {initialText: '初稿'};
      const tree = renderScreen();
      act(() => {
        mockEditorProps[0]!.onChange('安卓键盘下改稿');
      });
      act(() => {
        tree.root
          .findByProps({testID: 'prompt-editor-save'})
          .props.onPress();
      });
      expect(onSaved).toHaveBeenCalledWith('安卓键盘下改稿');
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    } finally {
      (Platform as {OS: string}).OS = originalOS;
    }
  });
});
