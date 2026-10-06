/**
 * NativeChatComposer dock 外围件测试（composer-native-2026-10 Step 4 · T-NC7~T-NC10）。
 *
 * mock 面：`react-native-enriched-markdown` 经 jest moduleNameMapper 映射到
 * `test-utils/enriched-markdown-mock`（Instance 全命令记录 + props 原样透传），
 * `react-native-svg` 局部 mock 成转发 props 的 View，`@react-native-clipboard/clipboard`
 * 走全局 stub（test-utils/react-native-clipboard-mock）。
 *
 * 断言视角：「组件对 mock 面/样式常量的驱动行为」——发送钮三分支（T-NC7）、
 * hintRow/error/chips 显隐判据（T-NC7）、typeahead 浮层开合与点选上抛（T-NC8，
 * 纯函数半见 typeahead-view.test.ts）、粘贴门控三闸（T-NC9）、样式逐项对齐
 * dock-style.ts 参照常量（T-NC10）。
 */
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import type {ReactTestInstance, ReactTestRenderer} from 'react-test-renderer';
import type {ConversationTheme} from '../src/components/chat/ChatConversationBridge';
import type {AtPathRef} from '../src/components/chat/composer-at-path';
import {
  NativeChatComposer,
  COMPOSER_PASTE_MAX_CHARS,
  COMPOSER_PASTE_MENU_LABEL,
  type NativeChatComposerProps,
} from '../src/components/chat/NativeChatComposer';
import {
  attachmentDraftChipsStyles,
  composerDockStyles,
  composerTokenCapsule,
  composerToolBtnStyle,
  composerTypeaheadStyles,
  DOCK_PADDING_BASE,
  resolveDockBottomPadding,
} from '../src/components/chat/native-composer/dock-style';
import {resolveSendButtonState} from '../src/components/chat/native-composer/send-button';
import {TYPEAHEAD_LIMIT} from '../src/components/chat/native-composer/typeahead-view';
import {
  EnrichedMarkdownTextInput,
  mockCalls,
  resetMockCalls,
} from '../test-utils/enriched-markdown-mock';
import {getString as clipboardGetString} from '../test-utils/react-native-clipboard-mock';

// react-native-svg 在 Jest 环境依赖原生视图管理器，渲染会抛错；mock 成转发
// props（testID）的普通 View，发送/终止图标可查（与 token-usage-stats 套件同款）。
jest.mock('react-native-svg', () => {
  const mockReact = require('react');
  const passthrough = (props: Record<string, unknown>) =>
    mockReact.createElement('View', props);
  return {
    __esModule: true,
    default: passthrough,
    Path: passthrough,
    Rect: passthrough,
  };
});

const THEME: ConversationTheme = {
  background: '#000000',
  text: '#ffffff',
  textSecondary: '#999999',
  primary: '#5865f2',
  primaryMuted: '#5865f222',
  selection: '#333333',
  danger: '#ff0000',
  surface: '#111111',
  borderLight: '#222222',
};

const PASTE_EVENT = {
  text: '',
  selection: {start: 0, end: 0},
  styleState: {},
};

type DockOverrides = Partial<NativeChatComposerProps>;

const baseProps = (overrides: DockOverrides): NativeChatComposerProps => ({
  testID: 'native-composer-input',
  value: '',
  hasModel: true,
  disabled: false,
  theme: THEME,
  onComposerChangeText: jest.fn(),
  onComposerSelectionChange: jest.fn(),
  running: false,
  canSend: true,
  error: undefined,
  chipLabels: [],
  typeaheadSource: {files: [], skills: []},
  uiRunning: false,
  inputDisabled: false,
  keyboardUp: false,
  safeAreaBottom: 0,
  fullscreenEnabled: true,
  onDockAction: jest.fn(),
  onTypeaheadSelect: jest.fn(),
  ...overrides,
});

type RenderedDock = {
  tree: ReactTestRenderer;
  props: NativeChatComposerProps;
  input: () => ReactTestInstance;
};

const renderDock = (overrides: DockOverrides = {}): RenderedDock => {
  const props = baseProps(overrides);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<NativeChatComposer {...props} />);
  });
  return {
    tree,
    props,
    // Step 3 同款：findByType 直接锁 mock 组件元素，其 props 即组件 → 库的
    // 全部透传 props（selectionMenuConfig/contextMenuItems/markdownStyle/...）。
    input: () => tree.root.findByType(EnrichedMarkdownTextInput),
  };
};

const byTestId = (tree: ReactTestRenderer, testID: string): ReactTestInstance =>
  // findAll[0]（首个命中）而非 findByProps/find（要求唯一）：typeahead-row
  // 一类 testID 一行一个，取首个命中的最外层复合元素即「我传给 Pressable 的
  // 那份 props」。
  tree.root.findAll(node => node.props.testID === testID)[0]!;

/**
 * 只数 host 层节点：Pressable / View / mock 组件会让 testID 在「复合元素 →
 * 内层复合 → host View」多层同时命中，计数必须落到 host 层才是一个视觉节点。
 */
const countHostByTestId = (tree: ReactTestRenderer, testID: string): number =>
  tree.root.findAll(
    node => node.props.testID === testID && typeof node.type === 'string',
  ).length;

const allByTestId = (
  tree: ReactTestRenderer,
  testID: string,
): ReactTestInstance[] =>
  tree.root.findAll(node => node.props.testID === testID);

const FILE_REFS: AtPathRef[] = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
  path: `src/${n}.ts`,
  kind: 'file' as const,
}));

beforeEach(() => {
  resetMockCalls();
  clipboardGetString.mockClear();
  // 默认给非空剪贴板：否则「空串早退」会掩盖缺失的闸门，变异不红
  clipboardGetString.mockResolvedValue('剪贴板内容');
});

describe('NativeChatComposer dock（T-NC7 发送钮与 dock 显隐）', () => {
  it('T-NC7 发送钮三分支：正常 send / running 终止 / disabled 置灰', () => {
    // 正常：primary 底 + 发送图标 + 点击上抛 send
    const normal = renderDock();
    const sendBtn = () => byTestId(normal.tree, 'composer-send');
    expect(sendBtn().props.accessibilityLabel).toBe('发送');
    expect(sendBtn().props.style[1].backgroundColor).toBe(THEME.primary);
    expect(sendBtn().props.disabled).toBe(false);
    expect(countHostByTestId(normal.tree, 'composer-send-icon-send')).toBe(1);
    expect(countHostByTestId(normal.tree, 'composer-send-icon-terminate')).toBe(
      0,
    );
    act(() => {
      sendBtn().props.onPress();
    });
    expect(normal.props.onDockAction).toHaveBeenCalledTimes(1);
    expect(normal.props.onDockAction).toHaveBeenCalledWith('send');

    // running：danger 底 + 终止图标 + 点击上抛 terminate
    const running = renderDock({running: true});
    const terminateBtn = () => byTestId(running.tree, 'composer-send');
    expect(terminateBtn().props.accessibilityLabel).toBe('终止');
    expect(terminateBtn().props.style[1].backgroundColor).toBe(THEME.danger);
    expect(
      countHostByTestId(running.tree, 'composer-send-icon-terminate'),
    ).toBe(1);
    expect(countHostByTestId(running.tree, 'composer-send-icon-send')).toBe(0);
    act(() => {
      terminateBtn().props.onPress();
    });
    expect(running.props.onDockAction).toHaveBeenCalledWith('terminate');

    // disabled：border（borderLight）底 + 置灰（disabled prop），不上抛动作
    const disabled = renderDock({canSend: false});
    const disabledBtn = () => byTestId(disabled.tree, 'composer-send');
    expect(disabledBtn().props.style[1].backgroundColor).toBe(
      THEME.borderLight,
    );
    expect(disabledBtn().props.disabled).toBe(true);
    expect(disabledBtn().props.accessibilityLabel).toBe('发送');

    // 变异红线（分支优先级）：canSend=false 且 running=true 时仍是 disabled 形态
    // （web resolveSendButtonState 的 disabled 优先），图标随 running 显示终止
    const mixed = renderDock({canSend: false, running: true});
    const mixedBtn = () => byTestId(mixed.tree, 'composer-send');
    expect(mixedBtn().props.style[1].backgroundColor).toBe(THEME.borderLight);
    expect(mixedBtn().props.disabled).toBe(true);
    expect(mixedBtn().props.accessibilityLabel).toBe('终止');

    // 状态机纯函数本身：四组合逐一锁定（换分支顺序必红）
    expect(resolveSendButtonState({canSend: true, running: false})).toEqual({
      disabled: false,
      running: false,
      variant: 'primary',
      action: 'send',
    });
    expect(resolveSendButtonState({canSend: true, running: true})).toEqual({
      disabled: false,
      running: true,
      variant: 'danger',
      action: 'terminate',
    });
    expect(resolveSendButtonState({canSend: false, running: false})).toEqual({
      disabled: true,
      running: false,
      variant: 'disabled',
      action: 'send',
    });
    expect(resolveSendButtonState({canSend: false, running: true})).toEqual({
      disabled: true,
      running: true,
      variant: 'disabled',
      action: 'terminate',
    });
  });

  it('T-NC7 hintRow 显隐：判据是 !hasModel（不是 inputDisabled），可点 → needModel', () => {
    // 无模型：显示，点击上抛 needModel
    const noModel = renderDock({hasModel: false});
    const hintRow = () => byTestId(noModel.tree, 'composer-hint-row');
    expect(hintRow().props.children.props.children).toBe('请先选择工作区模型');
    act(() => {
      hintRow().props.onPress();
    });
    expect(noModel.props.onDockAction).toHaveBeenCalledTimes(1);
    expect(noModel.props.onDockAction).toHaveBeenCalledWith('needModel');

    // 有模型但 inputDisabled（运行态/末条纯文本）：hintRow **不**误显
    const withModel = renderDock({hasModel: true, inputDisabled: true});
    expect(allByTestId(withModel.tree, 'composer-hint-row')).toHaveLength(0);

    // 有模型常态：不显示
    const normal = renderDock();
    expect(allByTestId(normal.tree, 'composer-hint-row')).toHaveLength(0);
  });

  it('T-NC7 error 行显隐：error 非空才渲染且吃 danger 色', () => {
    const withError = renderDock({error: '运行时尚未就绪'});
    const errorRow = byTestId(withError.tree, 'composer-error');
    expect(errorRow.props.children).toBe('运行时尚未就绪');
    expect(errorRow.props.style[1].color).toBe(THEME.danger);

    const noError = renderDock();
    expect(allByTestId(noError.tree, 'composer-error')).toHaveLength(0);

    // 空串按无 error 处理（与 controller 的 error 派生口径一致）
    const emptyError = renderDock({error: ''});
    expect(allByTestId(emptyError.tree, 'composer-error')).toHaveLength(0);
  });

  it('T-NC7 chips 行显隐：labels 非空才渲染、纯展示、不随 inputDisabled 置灰', () => {
    const withChips = renderDock({chipLabels: ['工作区:/a', '操作:标注']});
    const chipsRow = byTestId(withChips.tree, 'composer-chips');
    // 两个 chip，label 透传
    expect(chipsRow.props.children).toHaveLength(2);
    expect(chipsRow.props.children[0].props.children.props.children).toBe(
      '工作区:/a',
    );

    const noChips = renderDock({chipLabels: []});
    expect(allByTestId(noChips.tree, 'composer-chips')).toHaveLength(0);

    // 不随 inputDisabled 置灰：开启 inputDisabled 后 chip 样式与常态逐字相同
    const disabledCase = renderDock({
      chipLabels: ['工作区:/a'],
      inputDisabled: true,
    });
    const normalChip = byTestId(withChips.tree, 'composer-chips').props
      .children[0] as ReactTestInstance;
    const disabledChip = byTestId(disabledCase.tree, 'composer-chips').props
      .children[0] as ReactTestInstance;
    expect(disabledChip.props.style).toEqual(normalChip.props.style);
    const flat = JSON.stringify(disabledChip.props.style);
    expect(flat).not.toContain('opacity');
  });

  it('T-NC7 toolbar 三引用钮点击上抛对应动作、禁用判据分流', () => {
    const {tree, props} = renderDock({
      fullscreenEnabled: false,
      inputDisabled: true,
    });
    // ⛶ 看 fullscreenEnabled：不可用
    expect(byTestId(tree, 'composer-fullscreen').props.disabled).toBe(true);
    // @ / $ 看 inputDisabled：不可用
    expect(byTestId(tree, 'composer-at-picker').props.disabled).toBe(true);
    expect(byTestId(tree, 'composer-skill-picker').props.disabled).toBe(true);
    // disabled 时不产生动作（Pressable disabled 语义）
    expect(props.onDockAction).not.toHaveBeenCalled();

    const enabled = renderDock();
    act(() => {
      byTestId(enabled.tree, 'composer-fullscreen').props.onPress();
    });
    act(() => {
      byTestId(enabled.tree, 'composer-at-picker').props.onPress();
    });
    act(() => {
      byTestId(enabled.tree, 'composer-skill-picker').props.onPress();
    });
    expect(enabled.props.onDockAction).toHaveBeenNthCalledWith(1, 'fullscreen');
    expect(enabled.props.onDockAction).toHaveBeenNthCalledWith(2, 'atPicker');
    expect(enabled.props.onDockAction).toHaveBeenNthCalledWith(
      3,
      'skillPicker',
    );
  });
});

describe('NativeChatComposer dock（T-NC8 typeahead 浮层）', () => {
  it('T-NC8 光标处 @x 触发 → 候选 ≤5；点选上抛载荷（token 归一化）', () => {
    const {tree, input, props} = renderDock({
      typeaheadSource: {files: FILE_REFS, skills: []},
    });
    // 初始无浮层
    expect(allByTestId(tree, 'typeahead-row')).toHaveLength(0);

    // 打字触发（光标乐观塌缩到文末 = 查询位）
    act(() => {
      input().props.onChangeText('@src');
    });
    // 计数取 host 层（一行一个 host 节点）
    expect(countHostByTestId(tree, 'typeahead-row')).toBe(TYPEAHEAD_LIMIT);
    expect(countHostByTestId(tree, 'typeahead-row')).toBeLessThanOrEqual(5);

    // 浮层锚定形态：absolute + 锚在输入区上缘（bottom: 100%）
    const overlay = byTestId(tree, 'composer-typeahead');
    expect(overlay.props.style[0].position).toBe('absolute');
    expect(overlay.props.style[0].bottom).toBe('100%');

    // 点选：上抛 item（label + 归一化 token，插入语义由上层完成）
    act(() => {
      byTestId(tree, 'typeahead-row').props.onPress();
    });
    expect(props.onTypeaheadSelect).toHaveBeenCalledTimes(1);
    expect(props.onTypeaheadSelect).toHaveBeenCalledWith({
      label: '📄src/1.ts',
      token: '@/src/1.ts',
      tag: '',
    });
  });

  it('T-NC8 无候选 / inputDisabled 不渲染浮层', () => {
    const {tree, input} = renderDock({
      typeaheadSource: {files: FILE_REFS, skills: []},
    });
    // 查询无命中 → 无浮层
    act(() => {
      input().props.onChangeText('@zzz');
    });
    expect(allByTestId(tree, 'typeahead-row')).toHaveLength(0);

    // 禁用（inputDisabled）时即使有活跃查询也不展开（E5 判据）
    const disabled = renderDock({
      inputDisabled: true,
      typeaheadSource: {files: FILE_REFS, skills: []},
    });
    act(() => {
      disabled.input().props.onChangeText('@src');
    });
    expect(allByTestId(disabled.tree, 'typeahead-row')).toHaveLength(0);
  });
});

describe('NativeChatComposer dock（T-NC9 粘贴门控）', () => {
  const findPasteItem = (rendered: RenderedDock) => {
    const items = rendered.input().props.contextMenuItems as Array<{
      text: string;
      onPress: (event: typeof PASTE_EVENT) => void;
    }>;
    const item = items.find(entry => entry.text === COMPOSER_PASTE_MENU_LABEL);
    expect(item).toBeDefined();
    expect(typeof item!.onPress).toBe('function');
    return item!;
  };

  it('T-NC9 自定义「粘贴」菜单项存在，且选区菜单关掉库自带项', () => {
    const rendered = renderDock();
    findPasteItem(rendered);
    const config = rendered.input().props.selectionMenuConfig as {
      format: {enabled: boolean};
      copyAsMarkdown: {enabled: boolean};
    };
    expect(config.format.enabled).toBe(false);
    expect(config.copyAsMarkdown.enabled).toBe(false);
  });

  it('T-NC9 uiRunning 拒：不读剪贴板、不上屏、不补 change', async () => {
    const rendered = renderDock({uiRunning: true});
    const item = findPasteItem(rendered);
    await act(async () => {
      item.onPress(PASTE_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clipboardGetString).not.toHaveBeenCalled();
    expect(mockCalls.setValue).toHaveLength(0);
    expect(rendered.props.onComposerChangeText).not.toHaveBeenCalled();
  });

  it('T-NC9 inputDisabled 拒：不读剪贴板、不上屏、不补 change', async () => {
    const rendered = renderDock({inputDisabled: true});
    const item = findPasteItem(rendered);
    await act(async () => {
      item.onPress(PASTE_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clipboardGetString).not.toHaveBeenCalled();
    expect(mockCalls.setValue).toHaveLength(0);
    expect(rendered.props.onComposerChangeText).not.toHaveBeenCalled();
  });

  it('T-NC9 通过后：光标处插入 + 256KB 截断 + 命令式落文并补发 change', async () => {
    // 各子场景独立渲染：粘贴经 M7 通道推进基线，共用一个实例会让后段断言
    // 叠上前段文本（基线污染）。

    // 常规粘贴：M7 通道落文（合成 markdown 进 setValue）+ change 补发 + 光标落位
    const inserted = renderDock();
    const insertedItem = findPasteItem(inserted);
    clipboardGetString.mockResolvedValueOnce('pasted 文本');
    await act(async () => {
      insertedItem.onPress(PASTE_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCalls.setValue).toEqual(['pasted 文本']);
    expect(inserted.props.onComposerChangeText).toHaveBeenCalledWith(
      'pasted 文本',
    );
    expect(mockCalls.setSelection).toEqual([
      {start: 'pasted 文本'.length, end: 'pasted 文本'.length},
    ]);

    // 超长截断：只上屏前 256×1024 字符（setValue 是套件级累积记录，按末条断言）
    const long = 'x'.repeat(COMPOSER_PASTE_MAX_CHARS + 10);
    const truncated = renderDock();
    const truncatedItem = findPasteItem(truncated);
    clipboardGetString.mockResolvedValueOnce(long);
    await act(async () => {
      truncatedItem.onPress(PASTE_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });
    const lastSetValue = mockCalls.setValue[mockCalls.setValue.length - 1];
    expect(lastSetValue).toHaveLength(COMPOSER_PASTE_MAX_CHARS);
    expect(truncated.props.onComposerChangeText).toHaveBeenLastCalledWith(
      lastSetValue,
    );

    // 选区替换：value 基线 'hello world'，菜单事件带 {5,11} 选区 → 替换为 'helloX'
    clipboardGetString.mockResolvedValueOnce('X');
    const replaced = renderDock({value: 'hello world'});
    const replaceItem = findPasteItem(replaced);
    await act(async () => {
      replaceItem.onPress({
        ...PASTE_EVENT,
        selection: {start: 5, end: 11},
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCalls.setValue[mockCalls.setValue.length - 1]).toBe('helloX');
    expect(replaced.props.onComposerChangeText).toHaveBeenLastCalledWith(
      'helloX',
    );
    expect(mockCalls.setSelection[mockCalls.setSelection.length - 1]).toEqual({
      start: 6,
      end: 6,
    });

    // 空剪贴板：不落文
    const empty = renderDock();
    const emptyItem = findPasteItem(empty);
    const setValueCount = mockCalls.setValue.length;
    clipboardGetString.mockResolvedValueOnce('');
    await act(async () => {
      emptyItem.onPress(PASTE_EVENT);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCalls.setValue).toHaveLength(setValueCount);
    expect(empty.props.onComposerChangeText).not.toHaveBeenCalled();
  });
});

describe('NativeChatComposer dock（T-NC10 样式 ⇄ dock-style.ts 单源）', () => {
  it('T-NC10 dock 底 padding：DOCK_PADDING_BASE 语义（keyboardUp 归零 / max(8, safeArea)）', () => {
    expect(DOCK_PADDING_BASE).toBe(8);
    expect(resolveDockBottomPadding(true, 34)).toBe(0);
    expect(resolveDockBottomPadding(false, 0)).toBe(8);
    expect(resolveDockBottomPadding(false, 34)).toBe(34);

    const rendered = renderDock({safeAreaBottom: 34});
    const dockStyle = byTestId(rendered.tree, 'native-composer-dock').props
      .style as Array<Record<string, unknown>>;
    expect(dockStyle[0].paddingHorizontal).toBe(
      composerDockStyles.dock.paddingHorizontal,
    );
    expect(dockStyle[0].paddingHorizontal).toBe(12);
    expect(dockStyle[0].paddingTop).toBe(4);
    expect(dockStyle[1].backgroundColor).toBe(THEME.background);
    expect(dockStyle[1].paddingBottom).toBe(
      resolveDockBottomPadding(false, 34),
    );
    expect(dockStyle[1].paddingBottom).toBe(34);

    // 键盘顶起：归零（白条防线）
    const keyboardUp = renderDock({keyboardUp: true, safeAreaBottom: 34});
    const kbStyle = byTestId(keyboardUp.tree, 'native-composer-dock').props
      .style as Array<Record<string, unknown>>;
    expect(kbStyle[1].paddingBottom).toBe(0);
  });

  it('T-NC10 box / hint / error 数值逐项对齐 composerDockStyles', () => {
    const rendered = renderDock({hasModel: false, error: '出错了'});
    const boxStyle = byTestId(rendered.tree, 'composer-box').props
      .style as Array<Record<string, unknown>>;
    expect(boxStyle[0]).toEqual(composerDockStyles.box);
    expect(boxStyle[1].backgroundColor).toBe(THEME.surface);
    expect(boxStyle[1].borderColor).toBe(THEME.borderLight);
    expect(composerDockStyles.box.borderRadius).toBe(12);

    // hintRow：可点行 + 文字样式（primary 色、14 号）
    const hintRow = byTestId(rendered.tree, 'composer-hint-row');
    expect(hintRow.props.style).toEqual(composerDockStyles.hintRow);
    const hintText = hintRow.props.children.props;
    expect(hintText.style[0]).toEqual(composerDockStyles.hintText);
    expect(hintText.style[1].color).toBe(THEME.primary);
    expect(composerDockStyles.hintText.fontSize).toBe(14);

    // error：danger 色、13 号
    const errorRow = byTestId(rendered.tree, 'composer-error');
    expect(errorRow.props.style[0]).toEqual(composerDockStyles.error);
    expect(errorRow.props.style[1].color).toBe(THEME.danger);
    expect(composerDockStyles.error.fontSize).toBe(13);
  });

  it('T-NC10 chips 数值对齐 attachmentDraftChipsStyles（maxHeight36 / radius14 / padding 6×10）', () => {
    const rendered = renderDock({chipLabels: ['工作区:/a']});
    const chipsRow = byTestId(rendered.tree, 'composer-chips');
    // 行样式与透明变体按引用复用参照常量
    expect(chipsRow.props.style[0]).toBe(attachmentDraftChipsStyles.row);
    expect(chipsRow.props.style[1]).toBe(
      attachmentDraftChipsStyles.rowTransparent,
    );
    expect(attachmentDraftChipsStyles.row.maxHeight).toBe(36);

    const chip = chipsRow.props.children[0] as ReactTestInstance;
    expect(chip.props.style[0]).toBe(attachmentDraftChipsStyles.chip);
    expect(chip.props.style[1].backgroundColor).toBe(THEME.surface);
    expect(chip.props.style[1].borderColor).toBe(THEME.borderLight);
    expect(attachmentDraftChipsStyles.chip.borderRadius).toBe(14);
    expect(attachmentDraftChipsStyles.chip.paddingVertical).toBe(6);
    expect(attachmentDraftChipsStyles.chip.paddingLeft).toBe(10);
    expect(attachmentDraftChipsStyles.chip.paddingRight).toBe(10);
    expect(attachmentDraftChipsStyles.chip.borderWidth).toBe(
      composerDockStyles.box.borderWidth,
    );

    const labelText = chip.props.children.props;
    expect(labelText.style[0]).toBe(attachmentDraftChipsStyles.label);
    expect(labelText.style[1].color).toBe(THEME.text);
    expect(attachmentDraftChipsStyles.label.fontSize).toBe(12);
  });

  it('T-NC10 toolbar 36 圆钮 ⇄ composerToolBtnStyle、发送钮 40 ⇄ sendBtn 常量', () => {
    const rendered = renderDock();
    // 三引用钮：36 见方 + radius18 + hairline，参照常量按引用复用
    for (const testID of [
      'composer-fullscreen',
      'composer-at-picker',
      'composer-skill-picker',
    ]) {
      const btn = byTestId(rendered.tree, testID);
      expect(btn.props.style[0]).toBe(composerToolBtnStyle);
      expect(btn.props.style[1].borderColor).toBe(THEME.borderLight);
    }
    expect(composerToolBtnStyle.width).toBe(36);
    expect(composerToolBtnStyle.height).toBe(36);
    expect(composerToolBtnStyle.borderRadius).toBe(18);

    // 发送钮：40 见方 + radius20
    const sendBtn = byTestId(rendered.tree, 'composer-send');
    expect(sendBtn.props.style[0]).toEqual(composerDockStyles.sendBtn);
    expect(sendBtn.props.style[1].backgroundColor).toBe(THEME.primary);
    expect(composerDockStyles.sendBtn.width).toBe(40);
    expect(composerDockStyles.sendBtn.height).toBe(40);
    expect(composerDockStyles.sendBtn.borderRadius).toBe(20);
  });

  it('T-NC10 typeahead 浮层壳/行样式 ⇄ composerTypeaheadStyles、胶囊 ⇄ composerTokenCapsule', () => {
    const rendered = renderDock({
      typeaheadSource: {files: FILE_REFS, skills: []},
    });
    act(() => {
      rendered.input().props.onChangeText('@src');
    });

    const overlay = byTestId(rendered.tree, 'composer-typeahead');
    expect(overlay.props.style[0]).toEqual(composerTypeaheadStyles.list);
    expect(overlay.props.style[1].backgroundColor).toBe(THEME.surface);
    expect(overlay.props.style[1].borderColor).toBe(THEME.borderLight);
    expect(composerTypeaheadStyles.list.borderRadius).toBe(10);
    expect(composerTypeaheadStyles.list.position).toBe('absolute');

    const row = byTestId(rendered.tree, 'typeahead-row');
    // '@' 行样式是单对象（'$' 行才是 [row, rowSkill] 数组）
    expect(row.props.style).toBe(composerTypeaheadStyles.row);
    expect(composerTypeaheadStyles.row.paddingHorizontal).toBe(10);
    expect(composerTypeaheadStyles.row.paddingVertical).toBe(8);
    expect(composerTypeaheadStyles.rowLabel.fontSize).toBe(14);
    expect(composerTypeaheadStyles.rowTag.fontSize).toBe(11);

    // 胶囊（token span）几何与配色 ⇄ composerTokenCapsule + 主题
    const markdownStyle = rendered.input().props.markdownStyle as {
      link: Record<string, unknown>;
      linkVariants: Record<string, Record<string, unknown>>;
    };
    for (const capsule of [
      markdownStyle.link,
      markdownStyle.linkVariants['^nmtoken:'],
      markdownStyle.linkVariants['^nmskill:'],
    ]) {
      expect(capsule.color).toBe(THEME.primary);
      expect(capsule.backgroundColor).toBe(THEME.primaryMuted);
      expect(capsule.borderRadius).toBe(composerTokenCapsule.borderRadius);
      expect(capsule.borderRadius).toBe(4);
      expect(capsule.paddingHorizontal).toBe(
        composerTokenCapsule.paddingHorizontal,
      );
      expect(capsule.paddingHorizontal).toBe(4);
      expect(capsule.paddingTop).toBe(composerTokenCapsule.paddingTop);
      expect(capsule.paddingBottom).toBe(composerTokenCapsule.paddingBottom);
    }
  });
});
