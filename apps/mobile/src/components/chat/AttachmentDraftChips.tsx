/**
 * Composer 附件草稿 chip 横滑行。
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MessageAttachment } from '@novel-master/core/chat';
import { useTheme } from '@/theme/ThemeProvider';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachment[];
  onRemove: (index: number) => void;
  disabled?: boolean;
};

function chipLabel(a: MessageAttachment): string {
  if (a.source === 'user_ops') {
    return a.name || '用户操作';
  }
  const prefix =
    a.source === 'workplace' ? '工作区' : a.type === 'dir' ? '目录' : '@';
  return `${prefix} ${a.path ?? a.name}`;
}

export function AttachmentDraftChips({
  attachments,
  onRemove,
  disabled,
}: AttachmentDraftChipsProps) {
  const { tokens } = useTheme();
  if (attachments.length === 0) {
    return null;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.content}
    >
      {attachments.map((a, index) => (
        <View
          key={`${a.source}:${a.path ?? a.name}:${index}`}
          style={[
            styles.chip,
            { backgroundColor: tokens.surface, borderColor: tokens.border },
          ]}
        >
          <Text
            style={[styles.label, { color: tokens.text }]}
            numberOfLines={1}
          >
            {chipLabel(a)}
          </Text>
          <Pressable
            accessibilityLabel={`移除 ${chipLabel(a)}`}
            disabled={disabled}
            onPress={() => onRemove(index)}
            hitSlop={8}
          >
            <Text style={{ color: tokens.textSecondary }}>×</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { maxHeight: 36, marginBottom: 6 },
  content: { gap: 6, paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 12, flexShrink: 1 },
});
