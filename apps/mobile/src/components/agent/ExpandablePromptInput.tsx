/**
 * 超长提示词折叠包装（R3）：
 * - 未超阈（或聚焦保持中）渲染 renderInline 注入的内联编辑器（宏能力保留）；
 * - 超阈且失焦时渲染 3 行省略预览，点击跳转全屏编辑（openEditor）。
 * RN 焦点事件不冒泡，因此以 render-prop 把 onFocus/onBlur 注入内联编辑器，
 * 由本组件统一判定「失焦才折叠」，聚焦中不抢走编辑器。
 */
import React, {useCallback, useRef, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {isPromptCollapsed} from './prompt-collapse';

export type ExpandablePromptInputEvents = {
  onFocus: () => void;
  onBlur: () => void;
};

type Props = {
  value: string;
  /** 对称 API：折叠态不编辑，内容回填走 openEditor 打开的全屏编辑页。 */
  onChangeText: (next: string) => void;
  /** 渲染内联编辑器（须把 events.onFocus/onBlur 接到输入框上）。 */
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
  // 聚焦保持：内联编辑器聚焦期间即使超阈也不折叠（失焦才折叠）。
  const [forceInline, setForceInline] = useState(false);
  // 防 blur 折叠竞态：点击展开前置位；紧随其后的 blur 不折叠，避免闪烁。
  const pendingOpenRef = useRef(false);

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

  const handleOpenPress = useCallback(() => {
    pendingOpenRef.current = true;
    openEditor();
  }, [openEditor]);

  const collapsed = isPromptCollapsed(value) && !forceInline;

  if (!collapsed) {
    return <View testID={testID}>{renderInline({onFocus: handleFocus, onBlur: handleBlur})}</View>;
  }

  return (
    <Pressable
      testID={testID}
      onPress={handleOpenPress}
      style={[styles.previewCard, {backgroundColor: tokens.bgSecondary, borderColor: tokens.borderLight}]}
      accessibilityLabel="展开编辑提示词">
      <Text style={[styles.previewText, {color: tokens.text}]} numberOfLines={3}>
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
