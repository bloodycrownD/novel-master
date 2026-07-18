/**
 * Composer 状态 chip（不可叉）：workplace + user_ops。
 * 文件引用不再使用 attach chip（认正文 `@路径`）。
 */
import {
  scanAtPathAttachments,
  tryNormalizePromptSeenPath,
} from '@novel-master/core/chat';
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachmentDto[];
  /** false = 状态条（无叉）；true = 附件条（有叉，已废止）。 */
  showRemove?: boolean;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  'aria-label'?: string;
  /** 状态条：透明行底。 */
  transparentRow?: boolean;
};

/** 是否为状态条附件（workplace / user_ops）。 */
export function isComposerStatusAttachment(a: MessageAttachmentDto): boolean {
  return a.source === 'workplace' || a.source === 'user_ops';
}

/** 拆成状态 / attach（attach 仅兼容旧数据过滤，UI 不再渲染）。 */
export function partitionComposerChipAttachments(
  attachments: readonly MessageAttachmentDto[],
): {
  readonly status: MessageAttachmentDto[];
  readonly attach: MessageAttachmentDto[];
} {
  const status: MessageAttachmentDto[] = [];
  const attach: MessageAttachmentDto[] = [];
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
  statusAttachments: readonly MessageAttachmentDto[],
  composerText: string,
): MessageAttachmentDto[] {
  const atSeen = new Set<string>();
  for (const scanned of scanAtPathAttachments(composerText)) {
    if (scanned.path == null || scanned.path === '') continue;
    const key = tryNormalizePromptSeenPath(scanned.path);
    if (key != null) atSeen.add(key);
  }
  if (atSeen.size === 0) {
    return [...statusAttachments];
  }
  return statusAttachments.filter((a) => {
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
export function formatAttachmentChipLabel(a: MessageAttachmentDto): string {
  if (a.source === "user_ops") {
    return `改稿 · ${a.name}`;
  }
  const path = a.path ?? a.name;
  if (a.type === "dir") {
    const dirPath = path.endsWith("/") ? path : `${path}/`;
    return `规则 · ${dirPath}`;
  }
  return `规则 · ${path}`;
}

/** chip 根 class（T-UI2：目录不再带 warning 色类）。 */
export function attachmentChipClassName(): string {
  return 'chat-composer__chip';
}

export function AttachmentDraftChips({
  attachments,
  showRemove = true,
  onRemove,
  disabled,
  'aria-label': ariaLabel,
  transparentRow = false,
}: AttachmentDraftChipsProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div
      className={
        transparentRow
          ? 'chat-composer__chips chat-composer__chips--status'
          : 'chat-composer__chips'
      }
      role="list"
      aria-label={ariaLabel ?? (showRemove ? '待发送附件' : '状态附件')}
    >
      {attachments.map((a, index) => {
        const label = formatAttachmentChipLabel(a);
        return (
          <div
            key={`${a.source}:${a.path ?? a.name}:${index}`}
            className={attachmentChipClassName()}
            role="listitem"
          >
            <span className="chat-composer__chip-label" title={label}>
              {label}
            </span>
            {showRemove ? (
              <button
                type="button"
                className="chat-composer__chip-remove"
                aria-label={`移除 ${label}`}
                disabled={disabled}
                onClick={() => onRemove?.(index)}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** 状态 chip（无叉）：放在输入框内顶部。 */
export function ComposerStatusChips({
  attachments,
  disabled,
  composerText = '',
}: {
  attachments: readonly MessageAttachmentDto[];
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
      aria-label="状态附件"
    />
  );
}
