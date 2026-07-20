/**
 * Composer 状态 chip 判定与拆分（T-X2-1 / T-ATD1 / T-AT1）。
 * 仅认 workplace | user_ops；排除 userAttach 与 source===attach。
 *
 * @module domain/chat/logic/composer-chip-attachment
 */

/** 判定只读 `source` / 可选 `action`；与 MessageAttachment / DTO 结构兼容。 */
export type ComposerChipAttachment = {
  readonly source: string;
  readonly action?: string;
};

/** 是否为状态条附件（workplace / user_ops；不含 attach/userAttach）。 */
export function isComposerStatusAttachment(
  a: ComposerChipAttachment,
): boolean {
  if (a.action === "userAttach" || a.source === "attach") {
    return false;
  }
  return a.source === "workplace" || a.source === "user_ops";
}

/**
 * 拆成状态 / attach（attach 仅兼容旧数据过滤，UI 不再渲染）。
 * 泛型保留调用方附件类型（DTO / domain）。
 */
export function partitionComposerChipAttachments<
  T extends ComposerChipAttachment,
>(
  attachments: readonly T[],
): {
  readonly status: T[];
  readonly attach: T[];
} {
  const status: T[] = [];
  const attach: T[] = [];
  for (const a of attachments) {
    if (isComposerStatusAttachment(a)) {
      status.push(a);
    } else if (a.source === "attach") {
      attach.push(a);
    }
  }
  return { status, attach };
}
