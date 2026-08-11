/**
 * Label + optional hint + field control.
 * 默认纵向（label 上、控件下）；传 row 走横向（左标签右控件）。
 */
import React, {type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  label: string;
  tokens: ThemeTokens;
  hint?: string;
  row?: boolean;
  children: ReactNode;
};

export function FormField({label, tokens, hint, row, children}: Props) {
  if (row) {
    // 横向模式：标签在左、控件在右。hint 在横向下不展示，避免把行撑高。
    return (
      <View style={styles.rowWrap}>
        <Text style={[styles.rowLabel, {color: tokens.text}]}>{label}</Text>
        <View style={styles.rowControl}>{children}</View>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, {color: tokens.textSecondary}]}>{label}</Text>
      {hint != null ? (
        <Text style={[styles.hint, {color: tokens.textTertiary}]}>{hint}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 6},
  label: {fontSize: 13, fontWeight: '500'},
  hint: {fontSize: 12, lineHeight: 16},
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  rowLabel: {fontSize: 16, fontWeight: '500', flex: 1},
  rowControl: {flexShrink: 0},
});
