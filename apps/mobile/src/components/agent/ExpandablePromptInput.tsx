/**
 * 提示词内联输入包装（UX 简化）：内联编辑器经 ctx.style 限高 5 行
 * （超出部分输入框内部滚动，仍可正常输入），右上角浮一枚常驻「全屏编辑」
 * 小按钮（trailing overlay，标准做法）跳转 PromptEditor 全屏页
 * （保存才回填，取消不动）。按钮叠加在输入区内，内联输入以 paddingRight
 * 让出按钮下方空间，避免文字钻到图标下面。
 */
import React, {useCallback} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {PROMPT_INLINE_MAX_HEIGHT} from './prompt-collapse';

/** 内联输入右侧让位宽度（≈ 按钮宽 + 右边距），文字不钻到图标下面。 */
export const PROMPT_INLINE_PADDING_RIGHT = 32;

type InlineRenderContext = {
  /** 内联输入补充样式：maxHeight 限 5 行 + paddingRight 让位右上角按钮。 */
  style: StyleProp<TextStyle>;
};

type Props = {
  /** 渲染内联编辑器（宏能力保留；限高/让位样式经 ctx.style 传给输入框）。 */
  renderInline: (ctx: InlineRenderContext) => React.ReactNode;
  /** 打开全屏编辑页（保存才回填，取消不动）。 */
  openEditor: () => void;
  testID?: string;
};

export function ExpandablePromptInput({renderInline, openEditor, testID}: Props) {
  const {tokens} = useTheme();

  const handleOpenPress = useCallback(() => {
    openEditor();
  }, [openEditor]);

  return (
    <View testID={testID} style={styles.root}>
      {renderInline({style: styles.inlineInput})}
      <Pressable
        testID={testID ? `${testID}-fullscreen` : undefined}
        onPress={handleOpenPress}
        accessibilityLabel="全屏编辑"
        style={[
          styles.openBtn,
          {
            backgroundColor: tokens.bgSecondary,
            borderColor: tokens.borderLight,
          },
        ]}
        hitSlop={8}>
        <Text style={[styles.openGlyph, {color: tokens.textSecondary}]}>
          ⤢
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 相对定位容器：按钮以 absolute 浮在输入区右上角（不再单独占一列）。
  root: {position: 'relative'},
  // 集中管理内联限高（5 行）与右侧让位，调用点统一吃这份补充样式。
  inlineInput: {
    maxHeight: PROMPT_INLINE_MAX_HEIGHT,
    paddingRight: PROMPT_INLINE_PADDING_RIGHT,
  },
  // 小尺寸浮层按钮：恒定轻透明度，不抢输入视线（RN 简化，不做 hover/focus 态）。
  openBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 28,
    height: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  openGlyph: {fontSize: 14, lineHeight: 18},
});
