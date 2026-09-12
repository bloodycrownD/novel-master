/**
 * PatternFullscreenEditorScreen（正则字段全屏编辑）：
 * 照 agent 配置 PromptEditorScreen 先例——保存发 onSaved 回调
 * （模块级存取，不走路由参数）后停留当前态并清除未保存标记，
 * 退出靠 beforeRemove，未保存时被 useUnsavedGuard 拦截
 * （preventDefault + Alert 确认）。编辑器伪路径 pattern.txt（纯文本），
 * 无预览态。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import React from 'react';
import {Alert} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

const alertSpy = jest.spyOn(Alert, 'alert');

const mockGoBack = jest.fn();
const mockRoute = {
  params: {initialText: '/第(\\d+)章/i'} as {
    title?: string;
    initialText: string;
  },
};
const mockBeforeRemoveHandlers: ((event: {
  preventDefault: () => void;
  data: {action: unknown};
}) => void)[] = [];
const mockEditorProps: {
  value: string;
  path: string;
  onChange: (text: string) => void;
}[] = [];
const mockShowToast = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    addListener: (
      event: string,
      handler: (e: {
        preventDefault: () => void;
        data: {action: unknown};
      }) => void,
    ) => {
      if (event === 'beforeRemove') {
        mockBeforeRemoveHandlers[0] = handler;
      }
      return () => undefined;
    },
  }),
  useRoute: () => mockRoute,
}));

jest.mock('@/components/vfs/CodeEditorWebView', () => {
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

jest.mock('@/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: jest.fn()}),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      surface: '#fff',
      bgSecondary: '#f5f5f5',
      borderLight: '#ddd',
      primary: '#007aff',
      danger: '#ff3b30',
    },
  }),
}));

import {PatternFullscreenEditorScreen} from '@/screens/stack/PatternFullscreenEditorScreen';
import {
  setPatternEditorOnSaved,
  takePatternEditorOnSaved,
} from '@/components/smart-sort/pattern-editor-callback';

function renderScreen() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PatternFullscreenEditorScreen />);
  });
  return tree!;
}

function pressSave(tree: TestRenderer.ReactTestRenderer) {
  act(() => {
    tree.root.findByProps({testID: 'pattern-editor-save'}).props.onPress();
  });
}

/** 模拟导航 beforeRemove 事件（guard 拦截/放行的入口）。 */
function emitBeforeRemove() {
  const preventDefault = jest.fn();
  mockBeforeRemoveHandlers[0]!({
    preventDefault,
    data: {action: {type: 'GO_BACK'}},
  });
  return preventDefault;
}

describe('PatternFullscreenEditorScreen（照 PromptEditor 先例）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorProps.length = 0;
    mockBeforeRemoveHandlers.length = 0;
    // 清空模块级回调残留，各用例自行决定是否 set。
    takePatternEditorOnSaved();
    mockRoute.params = {initialText: '/第(\\d+)章/i'} as {
      title?: string;
      initialText: string;
    };
  });

  it('挂载即以 initialText 为草稿，伪路径 pattern.txt 纯文本', () => {
    renderScreen();
    expect(mockEditorProps[0]!.value).toBe('/第(\\d+)章/i');
    expect(mockEditorProps[0]!.path).toBe('pattern.txt');
  });

  it('无预览态：默认只有保存按钮，保存回传草稿、toast、停留不 goBack', () => {
    const onSaved = jest.fn();
    setPatternEditorOnSaved(onSaved);
    const tree = renderScreen();
    // 无预览切换按钮。
    expect(tree.root.findAllByProps({testID: 'pattern-editor-toggle'})).toHaveLength(
      0,
    );
    // 初始干净态：保存禁用。
    expect(
      tree.root.findByProps({testID: 'pattern-editor-save'}).props.disabled,
    ).toBe(true);

    act(() => {
      mockEditorProps[0]!.onChange('/第(\\d+)话/gi');
    });
    pressSave(tree);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('/第(\\d+)话/gi');
    expect(mockShowToast).toHaveBeenCalledWith('已保存');
    expect(mockGoBack).not.toHaveBeenCalled();
    // dirty 清除：保存回到禁用态。
    expect(
      tree.root.findByProps({testID: 'pattern-editor-save'}).props.disabled,
    ).toBe(true);
  });

  it('未保存退出被拦截：preventDefault + Alert 确认；保存后放行', () => {
    const onSaved = jest.fn();
    setPatternEditorOnSaved(onSaved);
    const tree = renderScreen();

    // 干净态：直接放行。
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    act(() => {
      mockEditorProps[0]!.onChange('不落盘的改动');
    });
    expect(emitBeforeRemove()).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      '未保存',
      '有未保存的更改，确定离开？',
      expect.anything(),
    );
    expect(onSaved).not.toHaveBeenCalled();

    pressSave(tree);
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('未 set 回调时保存不抛错：仅清标记 + toast', () => {
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('/x/i');
    });
    pressSave(tree);
    expect(mockShowToast).toHaveBeenCalledWith('已保存');
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
