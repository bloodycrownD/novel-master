/**
 * Inline manage header: normal actions vs batch cancel / count / delete.
 */
import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {SecondaryButton} from '../ui/PrototypeButtons';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  title: string;
  batchMode: boolean;
  selectedCount: number;
  onEnterBatch: () => void;
  onCancelBatch: () => void;
  onDelete?: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  primaryActionTone?: 'danger' | 'primary';
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
  primaryActionLabel = '删除',
  onPrimaryAction,
  primaryActionTone = 'danger',
  normalActions,
  hint,
}: Props) {
  const {tokens} = useTheme();
  const runPrimary = onPrimaryAction ?? onDelete;
  const primaryEnabledColor =
    primaryActionTone === 'danger' ? tokens.danger : tokens.primary;

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
          <Pressable onPress={runPrimary} disabled={selectedCount === 0}>
            <Text
              style={{
                color:
                  selectedCount > 0
                    ? primaryEnabledColor
                    : tokens.textTertiary,
              }}>
              {primaryActionLabel}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.normalRow}>
          <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
          <View style={styles.actions}>
            <SecondaryButton
              label="管理"
              tokens={tokens}
              onPress={onEnterBatch}
            />
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
    paddingHorizontal: 5,
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
  actions: {flexDirection: 'row', alignItems: 'center', gap: 8},
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: {fontSize: 12, lineHeight: 16},
});
