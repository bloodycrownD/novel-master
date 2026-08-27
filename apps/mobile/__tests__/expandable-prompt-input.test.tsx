/**
 * T-PM1 / T-PE1 / T-PE2（阈值改行数）：
 * PromptMacroTextInput 焦点/尺寸事件透传；
 * ExpandablePromptInput 超高折叠 / 聚焦保持 / 失焦折叠 / 初判启发 / 回填回 inline。
 * jest 无布局，高度直接以 {nativeEvent:{contentSize:{height}}} 形式驱动 onContentSizeChange。
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
  PROMPT_INLINE_LINE_HEIGHT,
  PROMPT_INLINE_MAX_LINES,
  PROMPT_PREVIEW_LINES,
  isPromptContentCollapsed,
  isPromptInitiallyCollapsed,
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

/** 构造 onContentSizeChange 的原生事件形状（测试环境无真实布局）。 */
function contentSizeEvent(height: number) {
  return {
    nativeEvent: {contentSize: {height}},
  } as unknown as Parameters<ExpandablePromptInputEvents['onContentSizeChange']>[0];
}

describe('PromptMacroTextInput 焦点/尺寸透传 (T-PM1)', () => {
  it('onFocus/onBlur/onContentSizeChange 由内部 TextInput 触发', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const onContentSizeChange = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <PromptMacroTextInput
          tokens={lightTheme}
          value="支持 $time 宏"
          onChangeText={jest.fn()}
          onFocus={onFocus}
          onBlur={onBlur}
          onContentSizeChange={onContentSizeChange}
        />,
      );
    });
    const input = tree!.root.findByType(TextInput);
    expect(input.props.onFocus).toBe(onFocus);
    expect(input.props.onBlur).toBe(onBlur);
    expect(input.props.onContentSizeChange).toBe(onContentSizeChange);

    act(() => {
      input.props.onFocus();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);

    act(() => {
      input.props.onContentSizeChange(contentSizeEvent(130));
    });
    expect(onContentSizeChange).toHaveBeenCalledTimes(1);

    act(() => {
      input.props.onBlur();
    });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe('ExpandablePromptInput 折叠行为 (T-PE1 / T-PE2，阈值改行数)', () => {
  it('高度阈值判定：5 行（110）不折叠、超过（130）折叠；初判启发：5 换行不折叠、6 换行折叠', () => {
    const maxHeight = PROMPT_INLINE_MAX_LINES * PROMPT_INLINE_LINE_HEIGHT;
    expect(isPromptContentCollapsed(maxHeight)).toBe(false);
    expect(isPromptContentCollapsed(maxHeight + 1)).toBe(true);

    const fiveLines = Array.from({length: PROMPT_INLINE_MAX_LINES}, () => '行').join('\n');
    expect(isPromptInitiallyCollapsed(fiveLines)).toBe(false);
    expect(isPromptInitiallyCollapsed(fiveLines + '\n行')).toBe(true);
  });

  it('T-PE1: 实测未超高（88 / 110）保持 inline；超高（130）且未聚焦折叠为 3 行预览，点击触发 openEditor', () => {
    const openEditor = jest.fn();
    let events: ExpandablePromptInputEvents | null = null;
    const renderInline = (e: ExpandablePromptInputEvents) => {
      events = e;
      return <InlineMarker />;
    };

    // 未测量前初判不超：inline 在场，捕获注入的尺寸事件
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
    const captured = events!;
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);

    // 实测高度 88（4 行）：未超高，仍 inline
    act(() => {
      captured.onContentSizeChange(contentSizeEvent(88));
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);

    // 实测高度 110（5 行整）：恰好达到阈值，不折叠
    act(() => {
      captured.onContentSizeChange(
        contentSizeEvent(PROMPT_INLINE_MAX_LINES * PROMPT_INLINE_LINE_HEIGHT),
      );
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);
    expect(
      tree!.root.findAllByProps({accessibilityLabel: '展开编辑提示词'}),
    ).toHaveLength(0);

    // 实测高度 130（约 6 行）且未聚焦：折叠态 = Pressable + 3 行省略 Text + 展开提示
    act(() => {
      captured.onContentSizeChange(contentSizeEvent(130));
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);
    // RN preset 里 Pressable 是 forwardRef 包装，findByType 匹配不到，按无障碍标签找
    const preview = tree!.root.findByProps({
      accessibilityLabel: '展开编辑提示词',
    });
    const previewText = preview
      .findAllByType(Text)
      .find(t => t.props.numberOfLines === PROMPT_PREVIEW_LINES);
    expect(previewText).toBeDefined();
    expect(previewText!.props.numberOfLines).toBe(3);
    expect(String(previewText!.props.children)).toBe('短提示词');

    act(() => {
      preview.props.onPress();
    });
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('T-PE2: 聚焦中测量到超高保持 inline，失焦后折叠', () => {
    const openEditor = jest.fn();
    let events: ExpandablePromptInputEvents | null = null;
    const renderInline = (e: ExpandablePromptInputEvents) => {
      events = e;
      return <InlineMarker />;
    };

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

    // 聚焦中内容长高到超过 5 行：保持 inline 不折叠
    act(() => {
      captured.onFocus();
    });
    act(() => {
      captured.onContentSizeChange(contentSizeEvent(130));
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(1);

    // 失焦：折叠
    act(() => {
      captured.onBlur();
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);
  });

  it('初判启发：value 含 6 个换行（未测量）初始即折叠，避免长文首帧撑开表单', () => {
    const openEditor = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ExpandablePromptInput
          value={'一\n二\n三\n四\n五\n六'}
          onChangeText={jest.fn()}
          renderInline={() => <InlineMarker />}
          openEditor={openEditor}
        />,
      );
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);
    // mount 即折叠态时 accessibilityLabel 会传播到 Pressable 内部多层节点，数量不稳定；
    // 以「3 行省略预览文本在场」作为折叠态断言。
    const previewText = tree!.root
      .findAllByType(Text)
      .find(t => t.props.numberOfLines === PROMPT_PREVIEW_LINES);
    expect(previewText).toBeDefined();
    expect(String(previewText!.props.children)).toBe('一\n二\n三\n四\n五\n六');
  });

  it('全屏编辑保存回填后内容变矮：测量重置，自然回 inline', () => {
    const openEditor = jest.fn();
    let events: ExpandablePromptInputEvents | null = null;
    const renderInline = (e: ExpandablePromptInputEvents) => {
      events = e;
      return <InlineMarker />;
    };

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

    // 测量到超高 → 折叠
    act(() => {
      captured.onContentSizeChange(contentSizeEvent(130));
    });
    expect(tree!.root.findAllByType(InlineMarker)).toHaveLength(0);

    // 全屏编辑保存回填矮内容：旧高度随 value 重置，初判也不超 → 回 inline
    act(() => {
      tree!.update(
        <ExpandablePromptInput
          value="回填后的矮内容"
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

    // 聚焦 → 长高超阈 → 失焦：进入折叠态
    act(() => {
      captured.onFocus();
    });
    act(() => {
      captured.onContentSizeChange(contentSizeEvent(130));
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
