/**
 * 手输 typeahead 共用下拉容器（comp-chat/C-4）：列表外壳 + 行内边距统一样式，
 * AtPathTypeahead / SkillTypeahead 只保留各自的行渲染。
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';
import {useTheme} from '@/theme/ThemeProvider';

export function TypeaheadList({
  accessibilityLabel,
  children,
  style,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const {tokens} = useTheme();
  return (
    <View
      style={[
        styles.list,
        {backgroundColor: tokens.surface, borderColor: tokens.border},
        style,
      ]}
      accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

/** 建议行基础内边距（Skill 行再叠加横向排布）。 */
export const typeaheadItemStyle = {
  paddingHorizontal: 10,
  paddingVertical: 8,
} as const;

const styles = StyleSheet.create({
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
});
