/**
 * Inline manage header: normal actions vs batch cancel / count / delete.
 */
import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  title: string;
  batchMode: boolean;
  selectedCount: number;
  onEnterBatch: () => void;
  onCancelBatch: () => void;
  onDelete: () => void;
  normalActions?: ReactNode;
  hint?: string;
};

export function ManageHeader({
  title,
  batchMode,
  selectedCount,
  onEnterBatch,
  onCancelBatch,
  onDelete,
  normalActions,
  hint,
}: Props) {
  const {tokens} = useTheme();

  return (
    <View style={[styles.wrap, {borderBottomColor: tokens.border}]}>
      {batchMode ? (
        <View style={styles.batchRow}>
          <Pressable onPress={onCancelBatch}>
            <Text style={{color: tokens.text}}>取消</Text>
          </Pressable>
          <Text style={{color: tokens.textSecondary}}>
            已选 {selectedCount} 项
          </Text>
          <Pressable onPress={onDelete} disabled={selectedCount === 0}>
            <Text
              style={{
                color:
                  selectedCount > 0 ? tokens.danger : tokens.textTertiary,
              }}>
              删除
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.normalRow}>
          <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
          <View style={styles.actions}>
            <Pressable onPress={onEnterBatch}>
              <Text style={{color: tokens.text}}>管理</Text>
            </Pressable>
            {normalActions}
          </View>
        </View>
      )}
      {batchMode && hint ? (
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  normalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {fontSize: 18, fontWeight: '600'},
  actions: {flexDirection: 'row', alignItems: 'center', gap: 12},
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: {fontSize: 12, lineHeight: 16},
});
