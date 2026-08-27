/**
 * T-PE1 / T-PE2（UX 简化 + overlay 微调）：
 * ExpandablePromptInput 渲染内联编辑器 + 常驻「全屏编辑」按钮，点击触发 openEditor；
 * 按钮以 trailing overlay 浮在输入区右上角（容器 relative / 按钮 absolute），
 * ctx.style 给内联输入 maxHeight 限 5 行 + paddingRight 让位（文字不钻到图标下面）。
 */
import {describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import {View, StyleSheet, Text, TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {
  ExpandablePromptInput,
  PROMPT_INLINE_PADDING_RIGHT,
} from '../src/components/agent/ExpandablePromptInput';
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

/** 展平 RN style（含 StyleSheet 注册 id / 数组）为单对象，方便 toMatchObject 断言。 */
function flattenStyle(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

describe('ExpandablePromptInput 内联 + 全屏按钮（UX 简化）', () => {
  it('限高常量：5 行 × lineHeight 22 = 110', () => {
    expect(PROMPT_INLINE_MAX_LINES).toBe(5);
    expect(PROMPT_INLINE_MAX_HEIGHT).toBe(110);
  });

  it('T-PE1: 渲染 inline 编辑器与常驻全屏按钮，无折叠预览', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
          renderInline={() => <InlineMarker />}
          openEditor={openEditor}
        />,
      );
    });
    // inline 在场
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
    // 常驻全屏按钮在场（无论内容长短；testID 不随无障碍语义传播）
    const openButtons = tree!.root.findAllByProps({
      testID: 'prompt-input-fullscreen',
    });
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
    expect(
      openButtons.filter(n => typeof n.props.onPress === 'function'),
    ).toHaveLength(1);
    // 旧的折叠预览不存在
    expect(
      tree!.root.findAllByType(Text).filter(t => t.props.numberOfLines != null),
    ).toHaveLength(0);
  });

  it('T-PE2: 点击全屏按钮触发 openEditor', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
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

  it('全屏按钮为输入区右上角 overlay：容器 relative、按钮 absolute 且半透明', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          testID="prompt-input"
          renderInline={ctx => <TextInput multiline style={ctx.style} />}
          openEditor={openEditor}
        />,
      );
    });
    // 容器（root）相对定位：absolute 按钮以它为定位基准
    // （findByProps 会命中组件自身节点，改按 View 实例 + testID 定位容器）
    const root = tree!.root.find(
      node => node.type === View && node.props.testID === 'prompt-input',
    );
    expect(flattenStyle(root.props.style)).toMatchObject({
      position: 'relative',
    });
    // 按钮浮在容器内右上角，且不单独占列、恒定轻透明度
    const button = tree!.root.findAllByProps({
      testID: 'prompt-input-fullscreen',
    })[0]!;
    expect(flattenStyle(button.props.style)).toMatchObject({
      position: 'absolute',
      top: expect.any(Number),
      right: expect.any(Number),
      opacity: expect.any(Number),
    });
  });

  it('ctx.style 给内联输入透传 maxHeight 限高 + paddingRight 让位', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          renderInline={ctx => <TextInput multiline style={ctx.style} />}
          openEditor={openEditor}
        />,
      );
    });
    const input = tree!.root.findByType(TextInput);
    expect(input.props.style).toMatchObject({
      maxHeight: PROMPT_INLINE_MAX_HEIGHT,
      paddingRight: PROMPT_INLINE_PADDING_RIGHT,
    });
  });
});
