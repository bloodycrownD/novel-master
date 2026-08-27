/**
 * T-PE3 + R5 + R6：PromptEditorScreen 顶栏完全照搬工作区 FileEditorScreen——
 * 左「保存」+ 中 标题/未保存 + 右「编辑/预览」单按钮互切，无取消按钮。
 * 保存语义同工作区：发 onSaved 回调（模块级存取，不走路由参数）后停留
 * 当前态并清除未保存标记，不 goBack；退出靠 beforeRemove，未保存时被
 * useUnsavedGuard 拦截（preventDefault + Alert 确认），干净态直接放行。
 * 预览走 FileMarkdownPreview（内存草稿，无 VFS），编辑器伪路径 prompt.md。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import React from 'react';
import {Alert, Platform} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

// guard 的确认弹窗 spy（真实 Alert 在测试环境无副作用，仅断言调用）。
const alertSpy = jest.spyOn(Alert, 'alert');

const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockRoute = {
  params: {initialText: '初稿'} as {title?: string; initialText: string},
};
// 捕获 useUnsavedGuard 注册的 beforeRemove handler（effect 随 isDirty 重跑，槽位始终存最新）。
const mockBeforeRemoveHandlers: ((event: {
  preventDefault: () => void;
  data: {action: unknown};
}) => void)[] = [];
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
const mockShowToast = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    dispatch: mockDispatch,
    addListener: (
      event: string,
      handler: (e: {preventDefault: () => void; data: {action: unknown}}) => void,
    ) => {
      if (event === 'beforeRemove') {
        mockBeforeRemoveHandlers[0] = handler;
      }
      return () => undefined;
    },
  }),
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

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
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
      danger: '#ff3b30',
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

function pressSave(tree: TestRenderer.ReactTestRenderer) {
  act(() => {
    tree.root.findByProps({testID: 'prompt-editor-save'}).props.onPress();
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

describe('PromptEditorScreen (T-PE3 + R5 + R6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorProps.length = 0;
    mockPreviewProps.length = 0;
    mockSegmentedProps.length = 0;
    mockBeforeRemoveHandlers.length = 0;
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

  it('顶栏照搬工作区：保存居左、切换居右、无取消按钮，dirty 时中间显示未保存', () => {
    mockRoute.params = {initialText: '初稿', title: '系统提示词'};
    const tree = renderScreen();
    const save = tree.root.findByProps({testID: 'prompt-editor-save'});
    const toggle = tree.root.findByProps({testID: 'prompt-editor-toggle'});
    // 工作区布局：保存（最左）→ 标题/未保存（flex:1）→ 编辑/预览切换（最右）。
    const toolbar = save.parent!;
    const children = toolbar.children.filter(
      (c): c is TestRenderer.ReactTestInstance =>
        typeof c === 'object' && c !== null,
    );
    expect(children[0]).toBe(save);
    expect(children[children.length - 1]).toBe(toggle);
    // 取消按钮已删除（照工作区：退出走返回 + 未保存拦截）。
    expect(
      tree.root.findAllByProps({testID: 'prompt-editor-cancel'}),
    ).toHaveLength(0);
    // 改稿后中间标题切到「未保存」（danger 色）。
    act(() => {
      mockEditorProps[0]!.onChange('改了一笔');
    });
    const texts = tree.root
      .findAll(node => typeof node.children?.[0] === 'string')
      .map(node => String(node.children[0]));
    expect(texts).toContain('未保存');
  });

  it('保存：以草稿调用回调、toast 提示、停留当前态不 goBack，未保存标记清除', () => {
    const onSaved = jest.fn();
    setPromptEditorOnSaved(onSaved);
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();

    // 模拟编辑器改稿后保存（工作区语义：保存后停留，不离开页面）。
    act(() => {
      mockEditorProps[0]!.onChange('改后的草稿');
    });
    pressSave(tree);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('改后的草稿');
    expect(mockShowToast).toHaveBeenCalledWith('已保存');
    expect(mockGoBack).not.toHaveBeenCalled();
    // dirty 已清除：保存按钮回到禁用态。
    expect(
      tree.root.findByProps({testID: 'prompt-editor-save'}).props.disabled,
    ).toBe(true);
    // 继续改稿可再次保存（回调再发）。
    act(() => {
      mockEditorProps[0]!.onChange('再改一笔');
    });
    pressSave(tree);
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenLastCalledWith('再改一笔');
  });

  it('预览态保存按钮禁用（工作区同款：预览态不提供保存入口）', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('改后的草稿');
    });
    const save = tree.root.findByProps({testID: 'prompt-editor-save'});
    expect(save.props.disabled).toBe(false);
    pressToggle(tree);
    expect(
      tree.root.findByProps({testID: 'prompt-editor-save'}).props.disabled,
    ).toBe(true);
    void tree;
  });

  it('未 set 回调时保存不抛错：仅清标记 + toast，不 goBack', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('改后的草稿');
    });
    pressSave(tree);
    expect(mockShowToast).toHaveBeenCalledWith('已保存');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('未保存退出被拦截：beforeRemove preventDefault + Alert 确认；保存后放行', () => {
    const onSaved = jest.fn();
    setPromptEditorOnSaved(onSaved);
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();

    // 干净态：beforeRemove 直接放行，不弹确认、不发回调。
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    // 改稿后（dirty）：拦截 + 弹「未保存」确认，回调不发。
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

    // 保存后（干净态）：再次退出直接放行，不弹确认。
    pressSave(tree);
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('Android 分支：键盘抬升包裹下保存仍可触达', () => {
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
      pressSave(tree);
      expect(onSaved).toHaveBeenCalledWith('安卓键盘下改稿');
      expect(mockShowToast).toHaveBeenCalledWith('已保存');
      expect(mockGoBack).not.toHaveBeenCalled();
    } finally {
      (Platform as {OS: string}).OS = originalOS;
    }
  });
});
