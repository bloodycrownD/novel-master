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
  /** 行容器透明（状态条叠在对话区上时用）。 */
  transparentRow?: boolean;
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

/** Chip 文案：user_ops → `action:path`；其余 `📄`/`📁` + path。 */
export function formatAttachmentChipLabel(a: MessageAttachment): string {
  if (a.source === 'user_ops') {
    return a.name;
  }
  const path = a.path ?? a.name;
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
  transparentRow = false,
}: AttachmentDraftChipsProps) {
  const { tokens } = useTheme();
  if (attachments.length === 0) {
    return null;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.row,
        transparentRow ? styles.rowTransparent : null,
      ]}
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
                style={styles.removeSlot}
              >
                <Text
                  style={[styles.removeText, { color: tokens.textSecondary }]}
                >
                  ×
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** 状态条（无叉）：由 Composer 放在输入框外上方。 */
export function ComposerStatusChips({
  attachments,
  disabled,
}: {
  attachments: readonly MessageAttachment[];
  disabled?: boolean;
}) {
  const { status } = partitionComposerChipAttachments(attachments);
  return (
    <AttachmentDraftChips
      attachments={status}
      showRemove={false}
      disabled={disabled}
      transparentRow
      accessibilityLabel="状态附件"
    />
  );
}

/** 附件条（有叉）：放在输入框内部。 */
export function ComposerAttachChips({
  attachments,
  onRemoveAttach,
  disabled,
}: {
  attachments: readonly MessageAttachment[];
  onRemoveAttach: (attachIndex: number) => void;
  disabled?: boolean;
}) {
  const { attach } = partitionComposerChipAttachments(attachments);
  return (
    <AttachmentDraftChips
      attachments={attach}
      showRemove
      disabled={disabled}
      onRemove={onRemoveAttach}
      accessibilityLabel="待发送附件"
    />
  );
}

/**
 * @deprecated 布局已拆为框外状态条 + 框内附件条；保留供旧调用兼容。
 */
export function ComposerDualAttachmentChips({
  attachments,
  onRemoveAttach,
  disabled,
}: {
  attachments: readonly MessageAttachment[];
  onRemoveAttach: (attachIndex: number) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <ComposerStatusChips attachments={attachments} disabled={disabled} />
      <ComposerAttachChips
        attachments={attachments}
        onRemoveAttach={onRemoveAttach}
        disabled={disabled}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { maxHeight: 36, marginBottom: 6 },
  rowTransparent: {
    backgroundColor: 'transparent',
    marginBottom: 4,
  },
  content: { gap: 6, paddingRight: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 200,
    paddingVertical: 6,
    paddingLeft: 10,
    // 有/无叉共用右侧内边距基准；叉号挤在固定槽内，避免「整块更胖」
    paddingRight: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 12, flexShrink: 1, maxWidth: 160 },
  removeSlot: {
    width: 16,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 14, lineHeight: 16 },
});
