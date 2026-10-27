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
  params: {initialText: '初稿'} as {
    title?: string;
    initialText: string;
    variant?: 'form' | 'composer';
    projectId?: string;
    sessionId?: string;
    /** D10 全屏守卫：进屏前草稿的确认胶囊区间（随路由带入）。 */
    tokenRanges?: readonly {start: number; end: number}[];
  },
};
// 捕获 useUnsavedGuard 注册的 beforeRemove handler（effect 随 isDirty 重跑，槽位始终存最新）。
const mockBeforeRemoveHandlers: ((event: {
  preventDefault: () => void;
  data: {action: unknown};
}) => void)[] = [];
// 捕获 CodeEditorWebView stub 的 props，模拟编辑器回传 onChange / 选区上报
// （jest.mock 工厂仅可引用 mock 前缀变量）。
const mockEditorProps: {
  value: string;
  path: string;
  onChange: (text: string) => void;
  onSelectionChange?: (selection: {start: number; end: number}) => void;
}[] = [];
// 编辑器 handle 桩：token 插入链（commitDraft → setText）的断言面。
const mockEditorSetText = jest.fn();
const mockEditorBlur = jest.fn();
// composer 变体的选择器 mock 底座：runtime 非空即满足「Picker 可用」判据
// （按钮 disabled / 挂载判据），capsule/B-2 用例置 null 模拟未就绪。
const mockRuntime = {};
const mockFilePickerProps: {
  visible: boolean;
  projectId: string;
  sessionId: string;
  onConfirm: (atPathTokens: string[]) => void;
}[] = [];
const mockSkillPickerProps: {
  visible: boolean;
  projectId: string;
  onConfirm: (skillName: string) => void;
}[] = [];
/** jest.fn 组件桩：调用次数也是断言面（缺 scope 用例断言本用例内零渲染）。 */
const mockFilePickerComponent = jest.fn((props: {
  visible: boolean;
  projectId: string;
  sessionId: string;
  onConfirm: (atPathTokens: string[]) => void;
}) => {
  mockFilePickerProps[0] = props;
  return null;
});
const mockSkillPickerComponent = jest.fn((props: {
  visible: boolean;
  projectId: string;
  onConfirm: (skillName: string) => void;
}) => {
  mockSkillPickerProps[0] = props;
  return null;
});
/** runtime 可变持有（capsule/B-2 用例置 null 模拟未就绪；beforeEach 复位）。 */
const mockRuntimeHolder: {runtime: typeof mockRuntime | null} = {
  runtime: null,
};
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
  // forwardRef 包装：真组件接 codeEditorRef，stub 不接会报 function component ref 警告。
  const mockReact = require('react');
  return {
    CodeEditorWebView: mockReact.forwardRef(function CodeEditorWebViewStub(
      props: {
        value: string;
        path: string;
        onChange: (text: string) => void;
        onSelectionChange?: (selection: {start: number; end: number}) => void;
      },
      ref: unknown,
    ) {
      mockEditorProps[0] = props;
      mockReact.useImperativeHandle(ref, () => ({
        blur: mockEditorBlur,
        setText: mockEditorSetText,
      }));
      return null;
    }),
  };
});

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({
    status: mockRuntimeHolder.runtime == null ? 'loading' : 'ready',
    runtime: mockRuntimeHolder.runtime,
  }),
}));

// 工厂在 import 期执行，jest.fn 常量那时还未初始化（TDZ）——包一层函数把
// 引用延迟到渲染期，mockFilePickerComponent 才拿得到真值。
jest.mock('@/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: (props: {
    visible: boolean;
    projectId: string;
    sessionId: string;
    onConfirm: (atPathTokens: string[]) => void;
  }) => mockFilePickerComponent(props),
}));
jest.mock('@/components/skills/SkillPicker', () => ({
  SkillPicker: (props: {
    visible: boolean;
    projectId: string;
    onConfirm: (skillName: string) => void;
  }) => mockSkillPickerComponent(props),
}));

jest.mock('@/components/vfs/FileMarkdownPreview', () => ({
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

jest.mock('@/components/ui/SegmentedControl', () => ({
  SegmentedControl: (props: {value: string; onChange: (v: string) => void}) => {
    mockSegmentedProps[0] = props;
    return null;
  },
}));

jest.mock('@/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: jest.fn()}),
  useStackOverrideSetter: () => jest.fn(),
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

import {PromptEditorScreen} from '@/screens/stack/PromptEditorScreen';
import {
  setPromptEditorOnSaved,
  takePromptEditorOnSaved,
} from '@/components/agent/prompt-editor-callback';

function renderScreen() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PromptEditorScreen />);
  });
  return tree!;
}

/**
 * 联想浮层残留探针：typeahead 组件已整体移除，任何残留都会被抓——
 * ① 含 `typeahead` 的 testID；② 「…建议」结尾的 accessibilityLabel
 * （历史 @ 支路浮层 AtPathTypeahead 无 testID，只有 a11y 标签「文件路径建议/
 * 技能建议」，仅靠 ① 兜不住 @ 侧）。「建议」a11y 标签当前树上零误报源（cr 已核）。
 */
function findTypeaheadNodes(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    node =>
      (typeof node.props.testID === 'string' &&
        node.props.testID.includes('typeahead')) ||
      (typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.endsWith('建议')),
  );
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
    mockFilePickerProps.length = 0;
    mockSkillPickerProps.length = 0;
    mockEditorSetText.mockClear();
    mockEditorBlur.mockClear();
    mockRuntimeHolder.runtime = mockRuntime;
    // 清空模块级回调残留，各用例自行决定是否 set。
    takePromptEditorOnSaved();
  });

  afterEach(() => {
    mockRoute.params = {initialText: '初稿'} as {
      title?: string;
      initialText: string;
      variant?: 'form' | 'composer';
      tokenRanges?: readonly {start: number; end: number}[];
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

/**
 * composer 变体（chat 输入框 ⛶）：与提示词字段同一个编辑屏、同一套编辑/预览，
 * 差别只在保存语义——那块文本就是输入框内容本身，**没有保存、退出即回填**。
 */
describe('PromptEditorScreen composer 变体（chat 输入框全屏）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorProps.length = 0;
    mockPreviewProps.length = 0;
    mockSegmentedProps.length = 0;
    mockBeforeRemoveHandlers.length = 0;
    mockFilePickerProps.length = 0;
    mockSkillPickerProps.length = 0;
    mockRuntimeHolder.runtime = mockRuntime;
    takePromptEditorOnSaved();
  });

  afterEach(() => {
    mockRoute.params = {initialText: '初稿'} as {
      title?: string;
      initialText: string;
      variant?: 'form' | 'composer';
      tokenRanges?: readonly {start: number; end: number}[];
    };
  });

  it('无保存按钮、标题不显「未保存」，退出（卸载）以当拍草稿回填', () => {
    const onSaved = jest.fn();
    setPromptEditorOnSaved(onSaved);
    mockRoute.params = {
      initialText: '初稿',
      title: '编辑消息',
      variant: 'composer',
    };
    const tree = renderScreen();

    // 输入框全屏没有「保存」概念：左位动作位整体不渲染。
    expect(
      tree.root.findAllByProps({testID: 'prompt-editor-save'}),
    ).toHaveLength(0);

    // 页内 toolbar 不渲染（标题只在导航栏；页内再叠一个就是「两个 编辑消息」）。
    const texts = tree.root
      .findAll(node => typeof node.children?.[0] === 'string')
      .map(node => String(node.children[0]));
    expect(texts).not.toContain('编辑消息');
    expect(texts).not.toContain('未保存');

    // 改稿（不进「未保存」态：没有 toolbar 标题可切）。
    act(() => {
      mockEditorProps[0]!.onChange('全屏里改的文本');
    });

    // 也不拦退出（无改动可丢）：beforeRemove 直接放行、不弹确认。
    expect(emitBeforeRemove()).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    // 改动前还没回填。
    expect(onSaved).not.toHaveBeenCalled();

    // 退出（返回/手势）＝卸载：当拍草稿交回调用方，文本落回输入框。
    act(() => {
      tree.unmount();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('全屏里改的文本');
  });

  it('纯编辑态：无预览切换、无档位条、不挂预览组件，编辑器恒在场', () => {
    mockRoute.params = {initialText: '初稿', variant: 'composer'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('# 全屏草稿');
    });

    // 用户定案「输入框全屏只要编辑」：右侧切换、Markdown/文本 档位条、预览都不渲染。
    expect(
      tree.root.findAllByProps({testID: 'prompt-editor-toggle'}),
    ).toHaveLength(0);
    expect(mockSegmentedProps[0]).toBeUndefined();
    expect(mockPreviewProps[0]).toBeUndefined();
    // 编辑器恒在场且草稿保留（没有切换态，也就没有切回来的问题）。
    expect(mockEditorProps[0]!.value).toBe('# 全屏草稿');
    // composer 伪路径：web 侧按此挂 @/$ 胶囊扩展（高亮 + 原子删）。
    expect(mockEditorProps[0]!.path).toBe('composer.md');
    // toolbar 整行不渲染（fullscreen/G-2）：不只是「没有标题文字」，
    // 连空 bar 都没有——守卫被拆掉时这条会红。
    expect(
      tree.root.findAllByProps({testID: 'editor-screen-toolbar'}),
    ).toHaveLength(0);
  });

  it('composer 变体：`$`/`@` 打字不再渲染联想浮层（T-TR3，浮层已整体移除）', () => {
    mockRoute.params = {
      initialText: '',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    };
    const tree = renderScreen();

    // 历史行为：打字后 web 上报选区即弹候选浮层；现在两步都做一遍，
    // 树里不允许再出现任何含 typeahead 的 testID（旧 skill-typeahead-* 行）。
    act(() => {
      mockEditorProps[0]!.onChange('$');
    });
    act(() => {
      mockEditorProps[0]!.onSelectionChange!({start: 1, end: 1});
    });
    expect(mockEditorProps[0]!.value).toBe('$');
    expect(findTypeaheadNodes(tree)).toHaveLength(0);

    act(() => {
      mockEditorProps[0]!.onChange('@');
    });
    act(() => {
      mockEditorProps[0]!.onSelectionChange!({start: 1, end: 1});
    });
    expect(findTypeaheadNodes(tree)).toHaveLength(0);

    // 收尾卸载（照本组惯例：防止跨用例污染断言面）。
    act(() => {
      tree.unmount();
    });
  });

  it('composer 变体：`@` 选择器确认多 token 插入（空文档、光标落插入段末尾）', () => {
    mockRoute.params = {
      initialText: '',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    };
    const tree = renderScreen();
    expect(mockEditorProps[0]!.path).toBe('composer.md');

    act(() => {
      tree.root.findByProps({testID: 'composer-editor-at-btn'}).props.onPress();
    });
    expect(mockFilePickerProps[0]!.visible).toBe(true);
    act(() => {
      mockFilePickerProps[0]!.onConfirm(['@docs/', '@notes.md']);
    });

    // chip 口径：多 token 零分隔空格直接拼接。新明文每颗自带尾终止符，拼起来是
    // `@docs/@@notes.md@`（前一颗的终止符与后一颗的触发符相邻），光标落插入段
    // 末尾（17 = 两个 token 长度之和）。
    expect(mockEditorSetText).toHaveBeenCalledWith('@docs/@@notes.md@', {
      start: 17,
      end: 17,
    });
    expect(mockEditorProps[0]!.value).toBe('@docs/@@notes.md@');
    // 收尾卸载（同上：防止跨用例的捕获污染）。
    act(() => {
      tree.unmount();
    });
  });

  it('composer 变体：路由缺 scope 时按钮降级禁用、选择器不挂载（tag 高亮不受影响）', () => {
    mockRoute.params = {initialText: '', variant: 'composer'};
    const tree = renderScreen();
    // 旧调用方缺参：胶囊高亮（web 侧按 path 判定）仍在，插入链静默降级。
    expect(mockEditorProps[0]!.path).toBe('composer.md');
    expect(
      tree.root.findByProps({testID: 'composer-editor-at-btn'}).props.disabled,
    ).toBe(true);
    expect(
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props
        .disabled,
    ).toBe(true);
    // 选择器不挂载：本用例内零渲染（jest.fn 次数经 beforeEach 清零）。
    expect(mockFilePickerComponent).not.toHaveBeenCalled();
    expect(mockSkillPickerComponent).not.toHaveBeenCalled();
  });

  it('composer 变体：runtime 未就绪同样降级——按钮禁用、选择器不挂载', () => {
    mockRuntimeHolder.runtime = null;
    mockRoute.params = {
      initialText: '',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    };
    const tree = renderScreen();
    // capsule/B-2：选择器内部走 useRuntime 会抛，canOpenPicker 必须看 runtime。
    expect(
      tree.root.findByProps({testID: 'composer-editor-at-btn'}).props.disabled,
    ).toBe(true);
    expect(
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props
        .disabled,
    ).toBe(true);
    expect(mockFilePickerComponent).not.toHaveBeenCalled();
    expect(mockSkillPickerComponent).not.toHaveBeenCalled();
  });

  it('capsule/B-4：进全屏不点编辑器直接插 token——RN 侧 cursor 初值在文末', () => {
    mockRoute.params = {
      initialText: '已有文本',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    };
    const tree = renderScreen();
    // 不触发 onSelectionChange（模拟没点编辑器）：插入链只能吃 cursor 初值。
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props.onPress();
    });
    expect(mockSkillPickerComponent).toHaveBeenCalled();
    act(() => {
      mockSkillPickerProps[0]!.onConfirm('写作');
    });
    // buildTokenInsertion('已有文本', 4, 4, '$写作$')：chip 零分隔空格直插，
    // 光标落插入段末尾（8 = 4 + 4）——cursor 若停在 0 会插到整篇开头（该回归的本体）。
    expect(mockEditorSetText).toHaveBeenCalledWith('已有文本$写作$', {
      start: 8,
      end: 8,
    });
    expect(mockEditorProps[0]!.value).toBe('已有文本$写作$');
    act(() => {
      tree.unmount();
    });
  });

  it('capsule/G-3：$ 选择器确认（活跃查询时替换半截）与空数组早退', () => {
    mockRoute.params = {
      initialText: '',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    };
    const tree = renderScreen();
    // 手输孤立 `$`（光标 1）：SkillPicker 确认时 replaceStart 取活跃查询起点。
    act(() => {
      mockEditorProps[0]!.onChange('$');
    });
    act(() => {
      mockEditorProps[0]!.onSelectionChange!({start: 1, end: 1});
    });
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props.onPress();
    });
    act(() => {
      mockSkillPickerProps[0]!.onConfirm('写作');
    });
    // 活跃 $ 查询 [0,1) 被整段替换（不残留半截查询）；chip 零分隔空格，
    // 明文带尾终止符 `$写作$`，光标落 token 末尾（4）。
    expect(mockEditorSetText).toHaveBeenCalledWith('$写作$', {
      start: 4,
      end: 4,
    });
    // FileReferencePicker 空选早退：零写入。
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-at-btn'}).props.onPress();
    });
    expect(mockFilePickerComponent).toHaveBeenCalled();
    act(() => {
      mockFilePickerProps[0]!.onConfirm([]);
    });
    expect(mockEditorSetText).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
  });

  it('D10 全屏守卫：连续插两颗技能 → `$A$$B$` 贴邻，不互替换', () => {
    mockRoute.params = {
      initialText: '',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
    };
    const tree = renderScreen();

    // 第一颗：空文档，光标初值 0。
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props.onPress();
    });
    act(() => {
      mockSkillPickerProps[0]!.onConfirm('A');
    });
    expect(mockEditorSetText).toHaveBeenLastCalledWith('$A$', {
      start: 3,
      end: 3,
    });

    // 第二颗：光标贴第一颗右缘（3）。旧明文 `$A` 在尾部会被当成活跃查询；
    // 新明文带尾终止符 `$A$`，终止符前一个字符是名字本身，尾部不再是活跃查询
    // → 走纯插入。断言锁住「两颗贴邻拼接、第二颗不替换第一颗」。
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props.onPress();
    });
    act(() => {
      mockSkillPickerProps[0]!.onConfirm('B');
    });
    expect(mockEditorSetText).toHaveBeenLastCalledWith('$A$$B$', {
      start: 6,
      end: 6,
    });
    expect(mockEditorProps[0]!.value).toBe('$A$$B$');
    act(() => {
      tree.unmount();
    });
  });

  it('D10 全屏守卫：路由带入的既有胶囊区间同样受保护（进屏前已有 `$A$`）', () => {
    mockRoute.params = {
      initialText: '$A$',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
      // ChatTabScreen 透传的进屏前草稿确认区间（含尾终止符）。
      tokenRanges: [{start: 0, end: 3}],
    };
    const tree = renderScreen();
    // 不点编辑器：cursor 初值在文末（3），直接插第二颗。
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props.onPress();
    });
    act(() => {
      mockSkillPickerProps[0]!.onConfirm('B');
    });
    expect(mockEditorSetText).toHaveBeenLastCalledWith('$A$$B$', {
      start: 6,
      end: 6,
    });
    expect(mockEditorProps[0]!.value).toBe('$A$$B$');
    act(() => {
      tree.unmount();
    });
  });

  it('D11 删除锚：全屏内 $A$$B$ 删左颗 → 幸存右颗的区间保留', () => {
    mockRoute.params = {
      initialText: '$A$$B$',
      variant: 'composer',
      projectId: 'p1',
      sessionId: 's1',
      tokenRanges: [
        {start: 0, end: 3},
        {start: 3, end: 6},
      ],
    };
    const tree = renderScreen();

    // 用户把光标放在两颗胶囊之间（编辑前光标 = 3）。
    act(() => {
      mockEditorProps[0]!.onSelectionChange!({start: 3, end: 3});
    });
    // 原子删 A：CM 的删除事务先上报变更后的选区（0），rAF 合帧后才上发新
    // 正文——全屏侧据此把上一拍选区（3）留作删除锚。
    act(() => {
      mockEditorProps[0]!.onSelectionChange!({start: 0, end: 0});
    });
    act(() => {
      mockEditorProps[0]!.onChange('$B$');
    });
    expect(mockEditorProps[0]!.value).toBe('$B$');

    // 读回幸存区间：光标移到文末再插一颗。新明文下 token 尾部不再是活跃 `$`
    // 查询（终止符前一个字符属于名字），插入恒为贴邻追加 → `$B$$C$`；断言锁住
    // 「删左颗后幸存右颗明文不被吞、新颗直接追加」。
    act(() => {
      mockEditorProps[0]!.onSelectionChange!({start: 3, end: 3});
    });
    act(() => {
      tree.root.findByProps({testID: 'composer-editor-skill-btn'}).props.onPress();
    });
    act(() => {
      mockSkillPickerProps[0]!.onConfirm('C');
    });
    expect(mockEditorSetText).toHaveBeenLastCalledWith('$B$$C$', {
      start: 6,
      end: 6,
    });
    expect(mockEditorProps[0]!.value).toBe('$B$$C$');
    act(() => {
      tree.unmount();
    });
  });

  it('form 变体不受影响：右侧「预览」切换仍在（对照断言）', () => {
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    expect(
      tree.root.findAllByProps({testID: 'prompt-editor-toggle'}).length,
    ).toBeGreaterThan(0);
    pressToggle(tree);
    expect(mockPreviewProps[0]!.content).toBe('初稿');
    // form 对照（fullscreen/G-2）：toolbar 行存在（不数精确值——测试环境里
    // 键盘包装层下会出现一个无内容的同名镜像实例；真正的牙齿在 composer 侧
    // 的 toHaveLength(0)，守卫被拆时那条必红）。
    expect(
      tree.root.findAllByProps({testID: 'editor-screen-toolbar'}).length,
    ).toBeGreaterThan(0);
  });

  it('form 变体对照：卸载（未保存退出）不回填——锁死回填 cleanup 的 isComposer 守卫', () => {
    const onSaved = jest.fn();
    setPromptEditorOnSaved(onSaved);
    mockRoute.params = {initialText: '初稿'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('改了但没保存');
    });
    act(() => {
      tree.unmount();
    });
    // form 的退出语义是「确认离开即丢弃」（useUnsavedGuard 管），不走 onSaved；
    // 若 isComposer 守卫被拆，提示词字段的退出会变成静默回填调用方表单。
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('未 set 回调时退出不抛错（回调缺失＝原文本不动）', () => {
    mockRoute.params = {initialText: '初稿', variant: 'composer'};
    const tree = renderScreen();
    act(() => {
      mockEditorProps[0]!.onChange('改了但没人接');
    });
    expect(() => {
      act(() => {
        tree.unmount();
      });
    }).not.toThrow();
  });
});
