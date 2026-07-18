/**
 * Composer 状态 chip（不可叉）：workplace + user_ops。
 * 文件引用不再使用 attach chip（认正文 `@路径`）。
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  scanAtPathAttachments,
  tryNormalizePromptSeenPath,
  type MessageAttachment,
} from '@novel-master/core/chat';
import { useTheme } from '@/theme/ThemeProvider';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachment[];
  /** false = 状态条（无叉）；true = 附件条（有叉，已废止）。 */
  showRemove?: boolean;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** 行容器透明。 */
  transparentRow?: boolean;
};

/** 是否为状态条附件（workplace / user_ops）。 */
export function isComposerStatusAttachment(a: MessageAttachment): boolean {
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
 * 正文已有 `@path` 时隐藏同 path 的 workplace 状态 chip，避免与蓝色 @tag 叠显。
 * `user_ops` 改稿语义不同，一律保留。
 */
export function filterStatusAttachmentsHiddenByComposerAtPaths(
  statusAttachments: readonly MessageAttachment[],
  composerText: string,
): MessageAttachment[] {
  const atSeen = new Set<string>();
  for (const scanned of scanAtPathAttachments(composerText)) {
    if (scanned.path == null || scanned.path === '') continue;
    const key = tryNormalizePromptSeenPath(scanned.path);
    if (key != null) atSeen.add(key);
  }
  if (atSeen.size === 0) {
    return [...statusAttachments];
  }
  return statusAttachments.filter(a => {
    if (a.source !== 'workplace') return true;
    const raw = a.path ?? a.name;
    const key = tryNormalizePromptSeenPath(raw);
    if (key == null) return true;
    return !atSeen.has(key);
  });
}

/**
 * Chip 文案：与文件引用 `@路径` 区分。
 * - workplace → `规则 · /path`（目录保留尾 `/`）
 * - user_ops → `改稿 ·` + name（多为 `action:path`）
 */
export function formatAttachmentChipLabel(a: MessageAttachment): string {
  if (a.source === 'user_ops') {
    return `改稿 · ${a.name}`;
  }
  const path = a.path ?? a.name;
  if (a.type === 'dir') {
    const dirPath = path.endsWith('/') ? path : `${path}/`;
    return `规则 · ${dirPath}`;
  }
  return `规则 · ${path}`;
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
  composerText = '',
}: {
  attachments: readonly MessageAttachment[];
  disabled?: boolean;
  /** 当前正文；用于 workplace 与 `@path` 叠显去重。 */
  composerText?: string;
}) {
  const { status } = partitionComposerChipAttachments(attachments);
  const visible = filterStatusAttachmentsHiddenByComposerAtPaths(
    status,
    composerText,
  );
  return (
    <AttachmentDraftChips
      attachments={visible}
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
