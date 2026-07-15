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

/** 目录 chip（非 workplace）文案：`@${path}`（@ 与 path 无空格）。文件保持 `@ ${path}`。 */
export function formatAttachmentChipLabel(a: MessageAttachment): string {
  if (a.source === 'user_ops') {
    return a.name || '用户操作';
  }
  if (a.source === 'workplace') {
    return `工作区 ${a.path ?? a.name}`;
  }
  if (a.type === 'dir') {
    return `@${a.path ?? a.name}`;
  }
  return `@ ${a.path ?? a.name}`;
}

function isDirAttachChip(a: MessageAttachment): boolean {
  return a.source !== 'workplace' && a.source !== 'user_ops' && a.type === 'dir';
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
      {attachments.map((a, index) => {
        const label = formatAttachmentChipLabel(a);
        const dirChip = isDirAttachChip(a);
        const labelColor = dirChip ? tokens.warning : tokens.text;
        return (
          <View
            key={`${a.source}:${a.path ?? a.name}:${index}`}
            style={[
              styles.chip,
              {
                backgroundColor: tokens.surface,
                borderColor: dirChip ? tokens.warning : tokens.border,
              },
            ]}
          >
            <Text
              style={[styles.label, { color: labelColor }]}
              numberOfLines={1}
            >
              {label}
            </Text>
            <Pressable
              accessibilityLabel={`移除 ${label}`}
              disabled={disabled}
              onPress={() => onRemove(index)}
              hitSlop={8}
            >
              <Text
                style={{
                  color: dirChip ? tokens.warning : tokens.textSecondary,
                }}
              >
                ×
              </Text>
            </Pressable>
          </View>
        );
      })}
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
