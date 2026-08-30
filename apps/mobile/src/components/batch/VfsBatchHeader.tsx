/**
 * VFS 文件管理器批量操作栏：删除 + 移动。
 * 由行长按进入多选后展示。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  selectedCount: number;
  onCancel: () => void;
  onDelete: () => void;
  /** 打开目标目录选择并执行批量移动 */
  onMove: () => void;
};

export function VfsBatchHeader({
  selectedCount,
  onCancel,
  onDelete,
  onMove,
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
              ]}
            >
              删除
            </Text>
          </Pressable>
          <Pressable onPress={onMove} disabled={!actionsEnabled}>
            <Text
              style={[
                styles.actionLabel,
                {
                  color: actionsEnabled ? tokens.primary : tokens.textTertiary,
                },
              ]}
            >
              移动
            </Text>
          </Pressable>
        </View>
      </View>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        选择要操作的条目
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
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
    gap: 10,
    flexShrink: 1,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  hint: {fontSize: 12, lineHeight: 16},
});
