/**
 * 消息可见性多选顶栏：取消、计数、确认（隐藏或恢复专用）。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import type {MessageVisibilityBatchMode} from '../chat/transcript-selectable-role';

type Props = {
  mode: MessageVisibilityBatchMode;
  selectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MessageBatchHeader({
  mode,
  selectedCount,
  onCancel,
  onConfirm,
}: Props) {
  const {tokens} = useTheme();
  const actionsEnabled = selectedCount > 0;
  const title = mode === 'hide' ? '隐藏消息' : '恢复消息';
  const hint =
    mode === 'hide'
      ? '勾选 assistant 消息以确定隐藏范围'
      : '勾选 user 消息以确定恢复范围';

  return (
    <View style={[styles.wrap, {borderBottomColor: tokens.border}]}>
      <View style={styles.batchRow}>
        <Pressable onPress={onCancel}>
          <Text style={{color: tokens.text}}>取消</Text>
        </Pressable>
        <Text style={[styles.count, {color: tokens.textSecondary}]}>
          {title} · 已选 {selectedCount} 项
        </Text>
        <Pressable onPress={onConfirm} disabled={!actionsEnabled}>
          <Text
            style={[
              styles.actionLabel,
              {
                color: actionsEnabled ? tokens.primary : tokens.textTertiary,
              },
            ]}>
            确认
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 5,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  count: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  hint: {fontSize: 12, lineHeight: 16},
});
