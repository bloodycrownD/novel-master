/**
 * 超长提示词折叠包装（R3，阈值改行数）：
 * - 内容实测高度超过 5 行（或未测量前初判超长）且未聚焦时，渲染 3 行省略预览，
 *   点击跳转全屏编辑（openEditor）；
 * - 其余情况渲染 renderInline 注入的内联编辑器（宏能力保留）。
 * RN 焦点事件不冒泡、高度只能由输入框自身上报，因此以 render-prop 把
 * onFocus/onBlur/onContentSizeChange 注入内联编辑器，由本组件统一判定
 * 「失焦才折叠」，聚焦中不抢走编辑器。
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {
  PROMPT_PREVIEW_LINES,
  isPromptContentCollapsed,
  isPromptInitiallyCollapsed,
} from './prompt-collapse';

export type ExpandablePromptInputEvents = {
  onFocus: () => void;
  onBlur: () => void;
  onContentSizeChange: (
    event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
  ) => void;
};

type Props = {
  value: string;
  /** 对称 API：折叠态不编辑，内容回填走 openEditor 打开的全屏编辑页。 */
  onChangeText: (next: string) => void;
  /** 渲染内联编辑器（须把 events 的焦点/尺寸事件接到输入框上）。 */
  renderInline: (events: ExpandablePromptInputEvents) => ReactNode;
  /** 打开全屏编辑页（保存才回填，取消不动）。 */
  openEditor: () => void;
  testID?: string;
};

export function ExpandablePromptInput({
  value,
  renderInline,
  openEditor,
  testID,
}: Props) {
  const {tokens} = useTheme();
  // 聚焦保持：内联编辑器聚焦期间即使超高也不折叠（失焦才折叠）。
  const [forceInline, setForceInline] = useState(false);
  // 内联输入框上报的内容高度；null 表示尚未测量，此时走换行数初判启发。
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // 防 blur 折叠竞态：点击展开前置位；紧随其后的 blur 不折叠，避免闪烁。
  const pendingOpenRef = useRef(false);

  // value 变化后旧测量作废（全屏编辑保存回填等场景），重置待重新上报；
  // 避免残留旧高度导致回填后的矮内容仍被判为超高。
  useEffect(() => {
    setContentHeight(null);
  }, [value]);

  const handleFocus = useCallback(() => {
    setForceInline(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (pendingOpenRef.current) {
      pendingOpenRef.current = false;
      return;
    }
    setForceInline(false);
  }, []);

  const handleContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      setContentHeight(event.nativeEvent.contentSize.height);
    },
    [],
  );

  const handleOpenPress = useCallback(() => {
    pendingOpenRef.current = true;
    openEditor();
  }, [openEditor]);

  // 超长判据：实测高度优先；未测量时用换行数初判，避免长文首帧把表单撑开。
  const overThreshold =
    contentHeight !== null
      ? isPromptContentCollapsed(contentHeight)
      : isPromptInitiallyCollapsed(value);
  const collapsed = overThreshold && !forceInline;

  if (!collapsed) {
    return (
      <View testID={testID}>
        {renderInline({
          onFocus: handleFocus,
          onBlur: handleBlur,
          onContentSizeChange: handleContentSizeChange,
        })}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={handleOpenPress}
      style={[styles.previewCard, {backgroundColor: tokens.bgSecondary, borderColor: tokens.borderLight}]}
      accessibilityLabel="展开编辑提示词">
      <Text style={[styles.previewText, {color: tokens.text}]} numberOfLines={PROMPT_PREVIEW_LINES}>
        {value}
      </Text>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        点击展开编辑
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  previewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  previewText: {fontSize: 16, lineHeight: 22},
  hint: {fontSize: 12},
});
