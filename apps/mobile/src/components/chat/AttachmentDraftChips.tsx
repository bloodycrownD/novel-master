/**
 * Composer 状态 chip（不可叉）：workplace + user_ops（含 annotate 预览）。
 * 文件引用不再使用 attach chip（认正文 `@路径`）；userAttach 不进状态条。
 * 判定 / partition 单点：`@novel-master/core/chat`。
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  formatStatusChipLabelFromAttachment,
  partitionComposerChipAttachments,
  type MessageAttachment,
} from '@novel-master/core/chat';
import {useTheme} from '@/theme/ThemeProvider';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachment[];
  disabled?: boolean;
  accessibilityLabel?: string;
  /** 行容器透明。 */
  transparentRow?: boolean;
};

/**
 * Chip 文案：中文二字 + `:` + path（Core `formatStatusChipLabelFromAttachment`）。
 */
export function formatAttachmentChipLabel(a: MessageAttachment): string {
  return formatStatusChipLabelFromAttachment(a);
}

export function AttachmentDraftChips({
  attachments,
  disabled,
  accessibilityLabel,
  transparentRow = false,
}: AttachmentDraftChipsProps) {
  const {tokens} = useTheme();
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
              style={[styles.label, {color: tokens.text}]}
              numberOfLines={1}
            >
              {label}
            </Text>
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
  const {status} = partitionComposerChipAttachments(attachments);
  return (
    <AttachmentDraftChips
      attachments={status}
      disabled={disabled}
      transparentRow
      accessibilityLabel="状态附件"
    />
  );
}

const styles = StyleSheet.create({
  row: {maxHeight: 36, marginBottom: 6},
  rowTransparent: {
    backgroundColor: 'transparent',
    marginBottom: 4,
  },
  content: {gap: 6, paddingRight: 8, alignItems: 'center'},
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
  label: {fontSize: 12, flexShrink: 1, maxWidth: 160},
});
