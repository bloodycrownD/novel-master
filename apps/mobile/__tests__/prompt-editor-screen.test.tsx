/**
 * T-PE3：PromptEditorScreen 保存以草稿回填 onSaved 并 goBack；取消不回填。
 * 顶栏 follow FileEditorScreen：左右两角——左取消右保存；键盘顶起双分支适配。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import React from 'react';
import {Platform} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

const mockGoBack = jest.fn();
const mockRoute = {
  params: {initialText: '初稿'} as {
    title?: string;
    initialText: string;
    onSaved?: (text: string) => void;
  },
};
// 捕获 CodeEditorWebView stub 的 props，模拟编辑器回传 onChange（jest.mock 工厂仅可引用 mock 前缀变量）。
const mockEditorProps: {
  value: string;
  path: string;
  onChange: (text: string) => void;
}[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: mockGoBack}),
  useRoute: () => mockRoute,
}));

jest.mock('../src/components/vfs/CodeEditorWebView', () => ({
  CodeEditorWebView: (props: {
    value: string;
    path: string;
    onChange: (text: string) => void;
  }) => {
    mockEditorProps[0] = props;
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

function renderScreen() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PromptEditorScreen />);
  });
  return tree!;
}

describe('PromptEditorScreen (T-PE3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorProps.length = 0;
  });

  afterEach(() => {
    mockRoute.params = {initialText: '初稿'} as {
      title?: string;
      initialText: string;
      onSaved?: (text: string) => void;
    };
  });

  it('挂载即以 initialText 为草稿，编辑器走纯文本伪路径', () => {
    mockRoute.params = {initialText: '初稿'};
    renderScreen();
    expect(mockEditorProps[0]!.value).toBe('初稿');
    expect(mockEditorProps[0]!.path).toBe('prompt.txt');
  });

  it('保存：以草稿调用 onSaved 并 goBack', () => {
    const onSaved = jest.fn();
    mockRoute.params = {initialText: '初稿', onSaved};
    const tree = renderScreen();

    // 模拟编辑器改稿后再保存
    act(() => {
      mockEditorProps[0]!.onChange('改后的草稿');
    });
    act(() => {
      tree.root.findByProps({testID: 'prompt-editor-save'}).props.onPress();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('改后的草稿');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('未提供 onSaved 时保存仅 goBack，不抛错', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      tree.root.findByProps({testID: 'prompt-editor-save'}).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('取消：直接 goBack，不调用 onSaved', () => {
    const onSaved = jest.fn();
    mockRoute.params = {initialText: '初稿', onSaved};
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

  it('顶栏左右两角：取消居左、保存居右，中间标题随路由 title', () => {
    mockRoute.params = {initialText: '初稿', title: '系统提示词'};
    const tree = renderScreen();
    const save = tree.root.findByProps({testID: 'prompt-editor-save'});
    const cancel = tree.root.findByProps({testID: 'prompt-editor-cancel'});
    // 顶栏（toolbar）子节点顺序：取消 → 标题（flex:1）→ 保存
    const toolbar = cancel.parent!;
    const children = toolbar.children.filter(
      (c): c is TestRenderer.ReactTestInstance =>
        typeof c === 'object' && c !== null,
    );
    expect(children[0]).toBe(cancel);
    expect(children[children.length - 1]).toBe(save);
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
      mockRoute.params = {initialText: '初稿', onSaved};
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
