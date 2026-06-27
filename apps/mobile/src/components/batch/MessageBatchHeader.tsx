/**
 * 消息批量操作顶栏：隐藏 / 恢复 / 删除。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';
import type {MessageBatchMode} from '../chat/transcript-selectable-role';

type Props = {
  tokens: ThemeTokens;
  mode: MessageBatchMode;
  selectedCount: number;
  affectedCount: number;
  rangeLabel: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function batchTitle(mode: MessageBatchMode): string {
  if (mode === 'hide') {
    return '隐藏消息';
  }
  if (mode === 'delete') {
    return '删除消息';
  }
  return '恢复消息';
}

function batchHint(mode: MessageBatchMode): string {
  if (mode === 'hide') {
    return '点击 assistant 将重置并勾选其上界以内全部 assistant';
  }
  if (mode === 'delete') {
    return '点击未隐藏的消息将重置并勾选其下界及之后全部消息（仅删聊天记录）';
  }
  return '点击已隐藏的消息将重置并勾选其下界及之后全部消息';
}

export function MessageBatchHeader({
  tokens,
  mode,
  selectedCount,
  affectedCount,
  rangeLabel,
  onCancel,
  onConfirm,
}: Props) {
  const actionsEnabled = selectedCount > 0;
  const title = batchTitle(mode);
  const summary =
    affectedCount > 0 && rangeLabel != null
      ? `${title} · 将影响 ${affectedCount} 条（${rangeLabel}）`
      : title;
  const confirmLabel = mode === 'delete' ? '删除' : '确认';

  return (
    <View style={[styles.wrap, {borderBottomColor: tokens.border}]}>
      <View style={styles.batchRow}>
        <Pressable onPress={onCancel}>
          <Text style={{color: tokens.text}}>取消</Text>
        </Pressable>
        <Text style={[styles.count, {color: tokens.text}]}>{summary}</Text>
        <Pressable onPress={onConfirm} disabled={!actionsEnabled}>
          <Text
            style={[
              styles.actionLabel,
              {
                color: actionsEnabled
                  ? mode === 'delete'
                    ? tokens.danger
                    : tokens.primary
                  : tokens.textTertiary,
              },
            ]}>
            {confirmLabel}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        {batchHint(mode)}
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
  actionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  hint: {fontSize: 12, lineHeight: 16},
});
