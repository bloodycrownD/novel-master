/**
 * T-PE1 / T-PE2（R5：label 行按钮 + 视口置顶；R6：icon 化）：
 * ExpandablePromptInput 渲染完整字段结构——label 行（label 居左、「全屏编辑」
 * icon 按钮居右，⛶ 字形与 desktop 一致）+ 内联编辑器；点击按钮触发
 * openEditor；ctx.style 给内联输入 maxHeight 限 8 行（无 paddingRight 让位）。
 * 初始视口置顶：挂载一拍后 ctx.selection 短暂置 {0,0}，selectionChange 后解除。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import React from 'react';
import {StyleSheet, Text, TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {ExpandablePromptInput} from '../src/components/agent/ExpandablePromptInput';
import {
  PROMPT_INLINE_MAX_HEIGHT,
  PROMPT_INLINE_MAX_LINES,
} from '../src/components/agent/prompt-collapse';
import {lightTheme} from '../src/theme/tokens';

jest.mock('../src/theme/ThemeProvider', () => {
  const {lightTheme: theme} =
    require('../src/theme/tokens') as typeof import('../src/theme/tokens');
  return {
    useTheme: () => ({
      mode: 'light' as const,
      tokens: theme,
      loaded: true,
      setMode: async () => undefined,
      toggleMode: async () => undefined,
    }),
  };
});

/** 内联编辑器占位组件：断言 inline 形态是否渲染。 */
function InlineMarker() {
  return null;
}

describe('ExpandablePromptInput 内联 + 全屏按钮（R5 + R6）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('限高常量：8 行 × lineHeight 22 = 176', () => {
    expect(PROMPT_INLINE_MAX_LINES).toBe(8);
    expect(PROMPT_INLINE_MAX_HEIGHT).toBe(176);
  });

  it('T-PE1: 渲染 label 行 + 内联编辑器 + 右侧常驻全屏按钮，无折叠预览', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
          label="系统提示词"
          renderInline={() => <InlineMarker />}
          openEditor={openEditor}
        />,
      );
    });
    // label 文本在场（由本组件统一渲染）
    const texts = tree!
      .root.findAll(node => typeof node.children?.[0] === 'string')
      .map(node => String(node.children[0]));
    expect(texts).toContain('系统提示词');
    // inline 在场
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
    // 常驻全屏按钮在场（label 行右侧）
    const openButtons = tree!.root.findAllByProps({
      testID: 'prompt-input-fullscreen',
    });
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
    expect(
      openButtons.filter(n => typeof n.props.onPress === 'function'),
    ).toHaveLength(1);
    // R6：icon 化——只留 ⛶ 字形（与 desktop 一致），不带「全屏」文字。
    expect(texts).toContain('⛶');
    expect(texts.filter(t => t.includes('全屏'))).toHaveLength(0);
    // accessibilityLabel 保留（无障碍仍可读出「全屏编辑」）。
    expect(
      openButtons.some(n => n.props.accessibilityLabel === '全屏编辑'),
    ).toBe(true);
    // 旧的折叠预览不存在（label 单行截断不算折叠预览）
    expect(
      tree!
        .root.findAllByType(Text)
        .filter(t => (t.props.numberOfLines ?? 1) > 1),
    ).toHaveLength(0);
  });

  it('R6: icon 尺寸 18-20、触达区 ≥28（icon-only 后仍好点）', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
          label="系统提示词"
          renderInline={() => <InlineMarker />}
          openEditor={openEditor}
        />,
      );
    });
    const button = tree!
      .root.findAllByProps({testID: 'prompt-input-fullscreen'})
      .find(n => typeof n.props.onPress === 'function')!;
    const buttonStyle = flattenStyle(button.props.style);
    // 触达区至少 28×28（另有 hitSlop 8 外扩）。
    expect(buttonStyle.minWidth).toBeGreaterThanOrEqual(28);
    expect(buttonStyle.minHeight).toBeGreaterThanOrEqual(28);
    // 字形放大到 18-20 区间（取 20）。
    const glyph = button.findAllByType(Text)[0]!;
    const glyphStyle = flattenStyle(glyph.props.style);
    expect(glyphStyle.fontSize).toBeGreaterThanOrEqual(18);
    expect(glyphStyle.fontSize).toBeLessThanOrEqual(20);
  });

  it('T-PE2: 点击全屏按钮触发 openEditor', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
          label="系统提示词"
          renderInline={() => <InlineMarker />}
          openEditor={openEditor}
        />,
      );
    });
    act(() => {
      const openButtons = tree!.root.findAllByProps({
        testID: 'prompt-input-fullscreen',
      });
      openButtons
        .find(n => typeof n.props.onPress === 'function')!
        .props.onPress();
    });
    expect(openEditor).toHaveBeenCalledTimes(1);
    // 点击后 inline 不被替换（无折叠切换）
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
  });

  it('全屏按钮在 label 行内右侧：无 overlay 定位（不再 absolute）', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
          label="系统提示词"
          renderInline={ctx => <TextInput multiline style={ctx.style} />}
          openEditor={openEditor}
        />,
      );
    });
    const button = tree!.root.findAllByProps({
      testID: 'prompt-input-fullscreen',
    })[0]!;
    const buttonStyle = flattenStyle(button.props.style);
    // R5：按钮进 label 行（标准表单动作位），彻底放弃 overlay/独立列
    expect(buttonStyle.position).not.toBe('absolute');
  });

  it('ctx.style 给内联输入透传 maxHeight 限高，无 paddingRight 让位', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          label="系统提示词"
          renderInline={ctx => <TextInput multiline style={ctx.style} />}
          openEditor={openEditor}
        />,
      );
    });
    const input = tree!.root.findByType(TextInput);
    const style = flattenStyle(input.props.style);
    expect(style.maxHeight).toBe(PROMPT_INLINE_MAX_HEIGHT);
    expect(style.paddingRight).toBeUndefined();
  });

  it('初始视口置顶：挂载一拍后 selection 置 {0,0}，selectionChange 后解除', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          label="系统提示词"
          renderInline={ctx => (
            <TextInput
              multiline
              style={ctx.style}
              selection={ctx.selection}
              onSelectionChange={ctx.onSelectionChange}
            />
          )}
          openEditor={openEditor}
        />,
      );
    });
    const input = tree!.root.findByType(TextInput);
    // 挂载当拍：尚未置位（先让原生完成初始定位）
    expect(input.props.selection).toBeUndefined();
    // 一拍后：短暂受控置 0，把初始视口拉回顶部
    act(() => {
      jest.runAllTimers();
    });
    expect(input.props.selection).toEqual({start: 0, end: 0});
    // 原生回报 selectionChange 后解除受控，用户交互不再被干预
    act(() => {
      input.props.onSelectionChange({
        nativeEvent: {selection: {start: 3, end: 3}},
      });
    });
    expect(tree!.root.findByType(TextInput).props.selection).toBeUndefined();
  });
});

/** 展平 RN style（含 StyleSheet 注册 id / 数组）为单对象，方便断言。 */
function flattenStyle(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}
