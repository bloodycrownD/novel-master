/**
 * Composer chip 双条：上条状态（无叉）、下条附件（有叉）。
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MessageAttachment } from '@novel-master/core/chat';
import { useTheme } from '@/theme/ThemeProvider';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachment[];
  /** false = 状态条（无叉）；true = 附件条（有叉）。 */
  showRemove?: boolean;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

/** 是否为状态条附件（workplace / user_ops）。 */
export function isComposerStatusAttachment(a: MessageAttachment): boolean {
  return a.source === 'workplace' || a.source === 'user_ops';
}

/** 拆成上条（状态）/ 下条（attach）。 */
export function partitionComposerChipAttachments(
  attachments: readonly MessageAttachment[],
): {
  readonly status: MessageAttachment[];
  readonly attach: MessageAttachment[];
} {
  const status: MessageAttachment[] = [];
  const attach: MessageAttachment[] = [];
  for (const a of attachments) {
    if (isComposerStatusAttachment(a)) {
      status.push(a);
    } else if (a.source === 'attach') {
      attach.push(a);
    }
  }
  return { status, attach };
}

/** Chip 文案：`📄` / `📁` / `✏️` + path（无多余空格）。 */
export function formatAttachmentChipLabel(a: MessageAttachment): string {
  const path = a.path ?? a.name;
  if (a.source === 'user_ops') {
    return `✏️${path}`;
  }
  if (a.type === 'dir') {
    return `📁${path}`;
  }
  return `📄${path}`;
}

export function AttachmentDraftChips({
  attachments,
  showRemove = true,
  onRemove,
  disabled,
  accessibilityLabel,
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
      accessibilityLabel={accessibilityLabel}
    >
      {attachments.map((a, index) => {
        const label = formatAttachmentChipLabel(a);
        return (
          <View
            key={`${a.source}:${a.path ?? a.name}:${index}`}
            style={[
              styles.chip,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
              },
            ]}
          >
            <Text
              style={[styles.label, { color: tokens.text }]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {showRemove ? (
              <Pressable
                accessibilityLabel={`移除 ${label}`}
                disabled={disabled}
                onPress={() => onRemove?.(index)}
                hitSlop={8}
              >
                <Text style={{ color: tokens.textSecondary }}>×</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** 双条：上状态（无叉）/ 下 attach（有叉）；空行不渲染。 */
export function ComposerDualAttachmentChips({
  attachments,
  onRemoveAttach,
  disabled,
}: {
  attachments: readonly MessageAttachment[];
  onRemoveAttach: (attachIndex: number) => void;
  disabled?: boolean;
}) {
  const { status, attach } = partitionComposerChipAttachments(attachments);
  return (
    <>
      <AttachmentDraftChips
        attachments={status}
        showRemove={false}
        disabled={disabled}
        accessibilityLabel="状态附件"
      />
      <AttachmentDraftChips
        attachments={attach}
        showRemove
        disabled={disabled}
        onRemove={onRemoveAttach}
        accessibilityLabel="待发送附件"
      />
    </>
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
