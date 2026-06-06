/**
 * Message batch header: cancel, selection count, and delete/hide/restore actions.
 * Used only in ChatTabScreen message multi-select mode (not ManageHeader VFS batch).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  selectedCount: number;
  onCancel: () => void;
  onDelete: () => void;
  onHide: () => void;
  onRestore: () => void;
};

export function MessageBatchHeader({
  selectedCount,
  onCancel,
  onDelete,
  onHide,
  onRestore,
}: Props) {
  const {tokens} = useTheme();
  const actionsEnabled = selectedCount > 0;

  return (
    <View style={[styles.wrap, {borderBottomColor: tokens.border}]}>
      <View style={styles.batchRow}>
        <Pressable onPress={onCancel}>
          <Text style={{color: tokens.text}}>取消</Text>
        </Pressable>
        <Text style={[styles.count, {color: tokens.textSecondary}]}>
          已选 {selectedCount} 项
        </Text>
        <View style={styles.actions}>
          <Pressable onPress={onDelete} disabled={!actionsEnabled}>
            <Text
              style={[
                styles.actionLabel,
                {
                  color: actionsEnabled ? tokens.danger : tokens.textTertiary,
                },
              ]}>
              删除
            </Text>
          </Pressable>
          <Pressable onPress={onHide} disabled={!actionsEnabled}>
            <Text
              style={[
                styles.actionLabel,
                {
                  color: actionsEnabled ? tokens.primary : tokens.textTertiary,
                },
              ]}>
              隐藏
            </Text>
          </Pressable>
          <Pressable onPress={onRestore} disabled={!actionsEnabled}>
            <Text
              style={[
                styles.actionLabel,
                {
                  color: actionsEnabled ? tokens.primary : tokens.textTertiary,
                },
              ]}>
              恢复
            </Text>
          </Pressable>
        </View>
      </View>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        选择要操作的消息
      </Text>
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  hint: {fontSize: 12, lineHeight: 16},
});
