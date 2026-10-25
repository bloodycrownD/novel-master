/**
 * Composer 状态 chip 判定与拆分（T-X2-1 / T-ATD1 / T-AT1）。
 * 现状仅投影 annotate；workplace 分支保留为历史只读兼容（历史消息气泡渲染可能命中）。
 * 排除 userAttach 与 source===attach。
 *
 * @module domain/chat/logic/composer/composer-chip-attachment
 */

/**
 * 拆成状态 / attach（attach 仅兼容旧数据过滤，UI 不再渲染）。
 * 泛型保留调用方附件类型（DTO / domain）。
 * D3：user_ops 分支须 `action === "annotate"`，不能按 source 一刀切（手改附件不再是状态 chip）。
 */
export function partitionComposerChipAttachments<T extends { readonly source: string; readonly action?: string }>(attachments: readonly T[]): { readonly status: T[]; readonly attach: T[] } {
  const status: T[] = [];
  const attach: T[] = [];
  for (const a of attachments) {
    const isStatus = a.action !== "userAttach" && a.source !== "attach" && (a.source === "workplace" || (a.source === "user_ops" && a.action === "annotate"));
    if (isStatus) {
      status.push(a);
    } else if (a.source === "attach") {
      attach.push(a);
    }
  }
  return { status, attach };
}
