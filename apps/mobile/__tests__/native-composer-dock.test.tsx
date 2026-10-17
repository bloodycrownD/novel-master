/**
 * NativeChatComposer dock 外围件测试（composer-native-2026-10 Step 4 · T-NC7~T-NC10）。
 *
 * mock 面：`react-native-enriched-markdown` 经 jest moduleNameMapper 映射到
 * `test-utils/enriched-markdown-mock`（Instance 全命令记录 + props 原样透传），
 * `react-native-svg` 局部 mock 成转发 props 的 View，`@react-native-clipboard/clipboard`
 * 走全局 stub（test-utils/react-native-clipboard-mock）。
 *
 * 断言视角：「组件对 mock 面/样式常量的驱动行为」——发送钮三分支（T-NC7）、
 * hintRow/error/chips 显隐判据（T-NC7）、粘贴门控三闸（T-NC9）、样式逐项对齐
 * dock-style.ts 参照常量（T-NC10）、联想浮层已移除（T-TR1，`composer-typeahead`
 * 不再渲染；typeahead 浮层链 2026-10 迭代整体删除，原 T-NC8 段随之退役）。
 */
import React from 'react';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import TestRenderer, {act} from 'react-test-renderer';
import type {ReactTestInstance, ReactTestRenderer} from 'react-test-renderer';
import type {ConversationTheme} from '../src/components/chat/ChatConversationBridge';
import {
  NativeChatComposer,
  COMPOSER_PASTE_MAX_CHARS,
  COMPOSER_PASTE_MENU_LABEL,
  type NativeChatComposerInstance,
  type NativeChatComposerProps,
} from '../src/components/chat/NativeChatComposer';
import {
  attachmentDraftChipsStyles,
  composerDockStyles,
  composerTokenCapsule,
  composerToolBtnStyle,
  DOCK_PADDING_BASE,
  resolveDockBottomPadding,
} from '../src/components/chat/native-composer/dock-style';
import {resolveSendButtonState} from '../src/components/chat/native-composer/send-button';
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
  uiRunning: false,
  inputDisabled: false,
  keyboardUp: false,
  safeAreaBottom: 0,
  fullscreenEnabled: true,
  onDockAction: jest.fn(),
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
  // findAll[0]（首个命中）而非 findByProps/find（要求唯一）：同一 testID 可能在
  // 「复合元素 → 内层复合 → host View」多层命中，取首个命中的最外层复合元素即
  // 「我传给组件的那份 props」。
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

describe('NativeChatComposer dock（T-TR1 联想浮层已移除）', () => {
  it('T-TR1 打 @ / $ 与命令式插入后均不渲染 composer-typeahead', () => {
    const ref = React.createRef<NativeChatComposerInstance>();
    const props = baseProps({});
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<NativeChatComposer ref={ref} {...props} />);
    });
    const input = () => tree.root.findByType(EnrichedMarkdownTextInput);

    // 打字触发记号：旧版此时展开候选浮层（T-NC8），移除后不应出现任何浮层
    act(() => {
      input().props.onChangeText('@src');
    });
    expect(allByTestId(tree, 'composer-typeahead')).toHaveLength(0);
    act(() => {
      input().props.onChangeText('$skill');
    });
    expect(allByTestId(tree, 'composer-typeahead')).toHaveLength(0);

    // 命令式插入（Picker 落文路径）确实走了 M7 通道落文，同样不出现浮层/候选行
    act(() => {
      ref.current!.setText('@src/1.ts 看这个 ', 15);
    });
    expect(mockCalls.setValue).toHaveLength(1);
    expect(allByTestId(tree, 'composer-typeahead')).toHaveLength(0);
    expect(allByTestId(tree, 'typeahead-row')).toHaveLength(0);
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

  it('T-NC9 自定义「粘贴」菜单项存在，且选区菜单关掉库自带项（含内置粘贴）', () => {
    const rendered = renderDock();
    findPasteItem(rendered);
    const config = rendered.input().props.selectionMenuConfig as {
      format: {enabled: boolean};
      copyAsMarkdown: {enabled: boolean};
      paste: boolean;
    };
    expect(config.format.enabled).toBe(false);
    expect(config.copyAsMarkdown.enabled).toBe(false);
    // deviation ① 闭合：内置粘贴经补丁的 paste 键关闭（菜单层移除 +
    // onTextContextMenuItem 事件层消费），粘贴统一走自定义项的单一闸门
    expect(config.paste).toBe(false);
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

  it('T-NC10 胶囊（token span）几何与配色 ⇄ composerTokenCapsule + 主题', () => {
    const rendered = renderDock();

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
      // 2026-10-07 真机轮 4→8（圆角不明显，半高强圆角药丸观感）
      expect(capsule.borderRadius).toBe(8);
      expect(capsule.paddingHorizontal).toBe(
        composerTokenCapsule.paddingHorizontal,
      );
      expect(capsule.paddingHorizontal).toBe(4);
      expect(capsule.paddingTop).toBe(composerTokenCapsule.paddingTop);
      expect(capsule.paddingBottom).toBe(composerTokenCapsule.paddingBottom);
    }
  });
});

/* ================================================================== *
 * dock-style 参照真源消费方守卫（T-CC-CSS-15 迁居）
 *
 * 原长在 chat-conversation-boot-script.test.ts（chat-webview-unify cr1-P1-5
 * 防快照纪律），composer-native-2026-10 Step 6 随合成包退役整体删除该文件后，
 * 这条不依赖合成包的活断言迁到 dock-style.ts 的家测——它锁的是「参照真源
 * 每个导出都有消费方」，与 T-NC10 的家语义同源。
 * ================================================================== */

describe('dock-style 参照真源消费方守卫（T-CC-CSS-15）', () => {
  /** 从 `{ a, b as c }` 的一段里取**原标识符**（`b as c` → `b`）。 */
  function originalName(raw: string): string {
    const alias = raw.search(/\s+as\s+/);
    return (alias === -1 ? raw : raw.slice(0, alias)).trim();
  }

  /** 递归收集目录下的 `.ts` / `.tsx` 文件绝对路径。 */
  function tsFilesIn(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        tsFilesIn(full, acc);
      } else if (/\.tsx?$/.test(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it('dock-style.ts 参照真源每个导出都有消费方（RN 真源死了就不许再抄一份快照）', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../src/components/chat/native-composer/dock-style.ts',
      ),
      'utf8',
    );
    const exported = new Set<string>();
    for (const m of source.matchAll(
      /^export\s+(?:const|function|class)\s+([A-Za-z0-9_$]+)/gm,
    )) {
      exported.add(m[1]);
    }
    for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) {
        const name = originalName(part);
        if (name) {
          exported.add(name);
        }
      }
    }
    // 解析器本身也要有牙齿：全空说明上面的匹配写坏了，断言会假绿
    expect(exported.size).toBeGreaterThan(0);

    // 消费面 = 全仓 import 了本模块的文件里实际引入的标识符
    const consumed = new Set<string>();
    const files = [
      ...tsFilesIn(join(__dirname, '../src')),
      ...tsFilesIn(__dirname),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('dock-style')) {
        continue;
      }
      for (const m of text.matchAll(
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'[^']*dock-style'/g,
      )) {
        for (const part of m[1].split(',')) {
          const name = originalName(part);
          if (name) {
            consumed.add(name);
          }
        }
      }
    }
    // 零消费导出 = 又一份没人对照的数值快照；当初手抄 8 份的教训就是它们全在等文件删除。
    expect([...exported].filter(name => !consumed.has(name))).toEqual([]);
  });
});
