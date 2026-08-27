/**
 * T-PM1 / T-PE1 / T-PE2：
 * PromptMacroTextInput 焦点事件透传；ExpandablePromptInput 超长折叠/聚焦保持/失焦折叠。
 */
import {describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import {Text, TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {
  ExpandablePromptInput,
  type ExpandablePromptInputEvents,
} from '../src/components/agent/ExpandablePromptInput';
import {PromptMacroTextInput} from '../src/components/agent/PromptMacroTextInput';
import {
  PROMPT_COLLAPSE_THRESHOLD,
  isPromptCollapsed,
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

describe('PromptMacroTextInput 焦点透传 (T-PM1)', () => {
  it('onFocus/onBlur 由内部 TextInput 触发', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PromptMacroTextInput
          tokens={lightTheme}
          value="支持 $time 宏"
          onChangeText={jest.fn()}
          onFocus={onFocus}
          onBlur={onBlur}
        />,
      );
    });
    const input = tree!.root.findByType(TextInput);
    expect(input.props.onFocus).toBe(onFocus);
    expect(input.props.onBlur).toBe(onBlur);

    act(() => {
      input.props.onFocus();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);

    act(() => {
      input.props.onBlur();
    });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe('ExpandablePromptInput 折叠行为 (T-PE1 / T-PE2)', () => {
  it('阈值判定：600 不折叠、601 折叠', () => {
    expect(isPromptCollapsed('a'.repeat(PROMPT_COLLAPSE_THRESHOLD))).toBe(false);
    expect(isPromptCollapsed('a'.repeat(PROMPT_COLLAPSE_THRESHOLD + 1))).toBe(
      true,
    );
  });

  it('T-PE1: 未超阈渲染 inline；超阈渲染 3 行省略折叠态，点击触发 openEditor', () => {
    const openEditor = jest.fn();
    let events: ExpandablePromptInputEvents | null = null;
    const renderInline = (e: ExpandablePromptInputEvents) => {
      events = e;
      return <InlineMarker />;
    };

    // 短文本：inline 编辑器在场，无折叠态 Pressable
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          value="短提示词"
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
    expect(
      tree!.root.findAllByProps({accessibilityLabel: '展开编辑提示词'}),
    ).toHaveLength(0);

    // 超阈：折叠态 = Pressable + 3 行省略 Text + 展开提示
    act(() => {
      tree!.update(
        <ExpandablePromptInput
          value={'长'.repeat(PROMPT_COLLAPSE_THRESHOLD + 1)}
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);
    // RN preset 里 Pressable 是 forwardRef 包装，findByType 匹配不到，按无障碍标签找
    const preview = tree!.root.findByProps({
      accessibilityLabel: '展开编辑提示词',
    });
    const previewText = preview
      .findAllByType(Text)
      .find(t => t.props.numberOfLines === 3);
    expect(previewText).toBeDefined();
    expect(String(previewText.props.children)).toHaveLength(
      PROMPT_COLLAPSE_THRESHOLD + 1,
    );

    act(() => {
      preview.props.onPress();
    });
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('T-PE2: 聚焦中超阈不折叠；失焦折叠；回落阈值下自动回 inline', () => {
    const openEditor = jest.fn();
    let events: ExpandablePromptInputEvents | null = null;
    const renderInline = (e: ExpandablePromptInputEvents) => {
      events = e;
      return <InlineMarker />;
    };
    const longValue = '长'.repeat(PROMPT_COLLAPSE_THRESHOLD + 1);

    // 先以短文本渲染拿到注入的焦点事件
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          value="短"
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    const captured = events!;

    // 聚焦中增长超过阈值：保持 inline 不折叠
    act(() => {
      captured.onFocus();
    });
    act(() => {
      tree!.update(
        <ExpandablePromptInput
          value={longValue}
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);

    // 失焦：折叠
    act(() => {
      captured.onBlur();
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);

    // value 回落到阈值下：自动回 inline
    act(() => {
      tree!.update(
        <ExpandablePromptInput
          value="回落"
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
  });

  it('点击展开前置 pendingOpen：紧随的 blur 不折叠（防闪烁）', () => {
    const openEditor = jest.fn();
    let events: ExpandablePromptInputEvents | null = null;
    const renderInline = (e: ExpandablePromptInputEvents) => {
      events = e;
      return <InlineMarker />;
    };
    const longValue = '长'.repeat(PROMPT_COLLAPSE_THRESHOLD + 1);

    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          value="短"
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    const captured = events!;

    // 聚焦 → 超阈 → 失焦：进入折叠态
    act(() => {
      captured.onFocus();
    });
    act(() => {
      tree!.update(
        <ExpandablePromptInput
          value={longValue}
          onChangeText={jest.fn()}
          renderInline={renderInline}
          openEditor={openEditor}
        />,
      );
    });
    act(() => {
      captured.onBlur();
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);

    // 折叠态点击展开 → 紧随的 blur 不折叠；再 blur（无 pending）才折叠
    act(() => {
      tree!.root
        .findByProps({accessibilityLabel: '展开编辑提示词'})
        .props.onPress();
    });
    expect(openEditor).toHaveBeenCalledTimes(1);
    act(() => {
      captured.onFocus();
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
    act(() => {
      captured.onBlur();
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
    act(() => {
      captured.onBlur();
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);
  });
});
