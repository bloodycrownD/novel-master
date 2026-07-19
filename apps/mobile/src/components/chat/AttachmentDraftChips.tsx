/**
 * Composer 状态 chip（不可叉）：workplace + user_ops（含 annotate 预览）。
 * 文件引用不再使用 attach chip（认正文 `@路径`）；userAttach 不进状态条。
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatStatusChipLabelFromAttachment,
  type MessageAttachment,
} from '@novel-master/core/chat';
import { useTheme } from '@/theme/ThemeProvider';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachment[];
  /**
   * 是否显示叉号。默认 `false`：Composer 唯一合法路径为无叉状态 chip
   *（workplace + user_ops）；有叉 attach 条已废止，勿再默认开启。
   */
  showRemove?: boolean;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** 行容器透明。 */
  transparentRow?: boolean;
};

/** 是否为状态条附件（workplace / user_ops；不含 attach/userAttach）。 */
export function isComposerStatusAttachment(a: MessageAttachment): boolean {
  if (a.action === 'userAttach' || a.source === 'attach') {
    return false;
  }
  return a.source === 'workplace' || a.source === 'user_ops';
}

/** 拆成状态 / attach（attach 仅兼容旧数据过滤，UI 不再渲染）。 */
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

/**
 * Chip 文案：中文二字 + `:` + path（Core `formatStatusChipLabelFromAttachment`）。
 */
export function formatAttachmentChipLabel(a: MessageAttachment): string {
  return formatStatusChipLabelFromAttachment(a);
}

export function AttachmentDraftChips({
  attachments,
  showRemove = false,
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
      style={[styles.row, transparentRow ? styles.rowTransparent : null]}
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

/** 状态 chip（无叉）：放在输入框内顶部。 */
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
