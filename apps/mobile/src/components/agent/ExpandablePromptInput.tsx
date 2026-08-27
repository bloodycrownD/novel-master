/**
 * 提示词内联输入包装（UX 简化）：完整字段结构——label 行（label 文本居左、
 * 「全屏编辑」icon 按钮居右，标准表单动作位）+ 输入区。内联编辑器经 ctx.style
 * 限高 8 行（超出部分输入框内部滚动，仍可正常输入），点按钮跳转
 * PromptEditor 全屏页（保存才回填，离开未保存即丢弃）。
 *
 * R6：按钮去文字只留 ⛶ 字形（与 desktop 一致，四角全屏框更醒目），
 * 尺寸放大到 20，触达区收紧到 28×28（含 hitSlop 更大）。
 *
 * 初始视口置顶：Android 受控 multiline TextInput 挂载带长文时，原生默认把
 * 光标放到文末，输入框内部滚动跟随光标，初始视口落在文本尾部。这里挂载后
 * 一拍短暂把 selection 置 0（仿 ComposerAtPathInput 的 pendingSelection 模式）
 * 把视口拉回顶部；原生应用后回报 selectionChange 即解除受控，用户交互不再
 * 被干预。真机行为待验收确认。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {PROMPT_INLINE_MAX_HEIGHT} from './prompt-collapse';

type PromptSelection = {start: number; end: number};

type InlineRenderContext = {
  /** 内联输入补充样式：maxHeight 限 8 行。 */
  style: StyleProp<TextStyle>;
  /** 短暂受控的初始光标位置（挂载置顶用），用户交互后回到 undefined。 */
  selection?: PromptSelection;
  /** 内联输入的 selectionChange：任何回报都解除初始受控。 */
  onSelectionChange: (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => void;
};

type Props = {
  /** 字段 label（由本组件统一渲染在 label 行左侧）。 */
  label: string;
  /** 渲染内联编辑器（宏能力保留；限高/置顶样式与事件经 ctx 传给输入框）。 */
  renderInline: (ctx: InlineRenderContext) => React.ReactNode;
  /** 打开全屏编辑页（保存才回填，取消不动）。 */
  openEditor: () => void;
  testID?: string;
};

export function ExpandablePromptInput({
  label,
  renderInline,
  openEditor,
  testID,
}: Props) {
  const {tokens} = useTheme();
  const [initialSelection, setInitialSelection] =
    useState<PromptSelection | null>(null);

  // 挂载后一拍才置 0：避开原生初始把光标放文末的定位过程，
  // 我们的 selection 生效后视口随光标回到顶部。
  useEffect(() => {
    const timer = setTimeout(() => setInitialSelection({start: 0, end: 0}), 0);
    return () => clearTimeout(timer);
  }, []);

  const handleOpenPress = useCallback(() => {
    openEditor();
  }, [openEditor]);

  const handleInlineSelectionChange = useCallback(() => {
    setInitialSelection(null);
  }, []);

  return (
    <View testID={testID} style={styles.root}>
      <View style={styles.labelRow}>
        <Text
          style={[styles.labelText, {color: tokens.textSecondary}]}
          numberOfLines={1}>
          {label}
        </Text>
        <Pressable
          testID={testID ? `${testID}-fullscreen` : undefined}
          onPress={handleOpenPress}
          accessibilityLabel="全屏编辑"
          style={styles.openBtn}
          hitSlop={8}>
          <Text style={[styles.openGlyph, {color: tokens.textSecondary}]}>
            ⛶
          </Text>
        </Pressable>
      </View>
      {renderInline({
        style: styles.inlineInput,
        selection: initialSelection ?? undefined,
        onSelectionChange: handleInlineSelectionChange,
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // 对齐 FormField 的 wrap（label 与控件间距 6）。
  root: {gap: 6},
  // label 行：label 居左、全屏按钮居右（标准表单动作位，按钮不再浮在输入区上）。
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // 对齐 FormField 的 label 样式。
  labelText: {fontSize: 13, fontWeight: '500', flexShrink: 1},
  // icon 按钮：28×28 触达区（hitSlop 再外扩 8），字形与 desktop 同款 ⛶。
  openBtn: {
    flexShrink: 0,
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openGlyph: {fontSize: 20, lineHeight: 24, fontWeight: '600'},
  // 集中管理内联限高（8 行），调用点统一吃这份补充样式。
  inlineInput: {
    maxHeight: PROMPT_INLINE_MAX_HEIGHT,
  },
});
