/**
 * Inline manage header: normal actions vs batch cancel / count / delete.
 */
import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useTheme} from '@/theme/ThemeProvider';

/** 批量模式次操作（如 VFS 的「移动」）：主操作（删除）右侧依次渲染。 */
export type ManageHeaderBatchAction = {
  label: string;
  onPress: () => void;
  tone?: 'danger' | 'primary';
  /** 不传则跟随 selectedCount === 0 的统一禁用规则。 */
  disabled?: boolean;
};

type Props = {
  /** 批量专用场景（batchMode 恒真）可不传。 */
  title?: string;
  batchMode: boolean;
  selectedCount: number;
  /** 批量专用场景（batchMode 恒真）可不传。 */
  onEnterBatch?: () => void;
  onCancelBatch: () => void;
  onDelete?: () => void;
  /** 批量模式全选/全不选回调；不传则不渲染全选按钮（其它调用方零影响）。 */
  onSelectAll?: () => void;
  /** 当前是否已全选，控制按钮文案「全不选」/「全选」。 */
  allSelected?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  primaryActionTone?: 'danger' | 'primary';
  /** 批量模式次操作数组；每项在主操作右侧渲染。 */
  actions?: ManageHeaderBatchAction[];
  normalActions?: ReactNode;
  hint?: string;
  /** 吸收各调用方的布局差异（如 VFS 批量栏 padding 12 vs 默认 5）。 */
  style?: StyleProp<ViewStyle>;
};

export function ManageHeader({
  title,
  batchMode,
  selectedCount,
  onEnterBatch,
  onCancelBatch,
  onDelete,
  onSelectAll,
  allSelected,
  primaryActionLabel = '删除',
  onPrimaryAction,
  primaryActionTone = 'danger',
  actions,
  normalActions,
  hint,
  style,
}: Props) {
  const {tokens} = useTheme();
  const runPrimary = onPrimaryAction ?? onDelete;
  const primaryEnabledColor =
    primaryActionTone === 'danger' ? tokens.danger : tokens.primary;
  const batchActionsDisabled = selectedCount === 0;

  return (
    <View style={[styles.wrap, {borderBottomColor: tokens.border}, style]}>
      {batchMode ? (
        <View style={styles.batchRow}>
          <Pressable onPress={onCancelBatch}>
            <Text style={{color: tokens.text}}>取消</Text>
          </Pressable>
          <View style={styles.batchCenter}>
            {onSelectAll ? (
              <Pressable onPress={onSelectAll} hitSlop={8}>
                <Text style={{color: tokens.primary, fontWeight: '600'}}>
                  {allSelected ? '全不选' : '全选'}
                </Text>
              </Pressable>
            ) : null}
            <Text style={{color: tokens.textSecondary}}>
              已选 {selectedCount} 项
            </Text>
          </View>
          <View style={styles.batchActions}>
            <Pressable onPress={runPrimary} disabled={batchActionsDisabled}>
              <Text
                style={{
                  color:
                    selectedCount > 0
                      ? primaryEnabledColor
                      : tokens.textTertiary,
                }}
              >
                {primaryActionLabel}
              </Text>
            </Pressable>
            {(actions ?? []).map(action => {
              const disabled = action.disabled ?? batchActionsDisabled;
              const enabledColor =
                action.tone === 'danger' ? tokens.danger : tokens.primary;
              return (
                <Pressable
                  key={action.label}
                  onPress={action.onPress}
                  disabled={disabled}>
                  <Text
                    style={[
                      styles.actionLabel,
                      {
                        color: disabled
                          ? tokens.textTertiary
                          : enabledColor,
                      },
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.normalRow}>
          <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
          <View style={styles.actions}>
            {onEnterBatch ? (
              <SecondaryButton
                label="管理"
                tokens={tokens}
                onPress={onEnterBatch}
              />
            ) : null}
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
  batchCenter: {flexDirection: 'row', alignItems: 'center', gap: 12},
  batchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  actionLabel: {fontSize: 13, fontWeight: '500'},
  hint: {fontSize: 12, lineHeight: 16},
});
