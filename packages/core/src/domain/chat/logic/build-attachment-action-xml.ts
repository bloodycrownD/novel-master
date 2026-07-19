/**
 * 构造消息增量 `<action name="…">` + JSON（userAttach / workplaceChange / annotate）。
 *
 * @module domain/chat/logic/build-attachment-action-xml
 */

import { buildUserVfsActionXml } from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import type { MessageAttachmentAction } from "../model/message-attachment.schema.js";
import type { AnnotateDraft } from "../model/annotate-draft.schema.js";
import {
  attachmentStorageName,
  type MessageAttachment,
} from "../model/message-attachment.schema.js";

/** 文件展示档（与常驻前缀 / renderFileBlock 同口径）。 */
export type AttachmentDisplayKind = "full" | "filename" | "header";

/**
 * 通用 action XML（JSON pretty-print，与 user_ops 手改同源）。
 */
export function buildAttachmentActionXml(
  action: MessageAttachmentAction,
  params: Record<string, unknown>,
): string {
  return buildUserVfsActionXml(action, params);
}

/** `userAttach` / `workplaceChange`：全文 / filename / header（行号正文）。 */
export function buildFileRefActionXml(params: {
  readonly action: "userAttach" | "workplaceChange";
  readonly path: string;
  readonly content: string;
  readonly display: AttachmentDisplayKind;
}): string {
  return buildAttachmentActionXml(params.action, {
    path: params.path,
    content: params.content,
    display: params.display,
  });
}

/** 短提示：`alreadyReferenced: true`，无 content。 */
export function buildAlreadyReferencedActionXml(path: string): string {
  return buildAttachmentActionXml("userAttach", {
    path,
    alreadyReferenced: true,
  });
}

/** 目录树：`kind: "dirTree"`，content = ASCII 树（无外层 `<dir>`）。 */
export function buildDirTreeActionXml(
  path: string,
  treeBody: string,
): string {
  return buildAttachmentActionXml("userAttach", {
    path,
    content: treeBody,
    kind: "dirTree",
  });
}

/** 由批注草稿构造落库附件（`source:user_ops` + `action:annotate`）。 */
export function buildAnnotateAttachmentFromDraft(
  draft: AnnotateDraft,
): MessageAttachment {
  const path = draft.path;
  const xml = buildAttachmentActionXml("annotate", {
    path,
    originalText: draft.originalText,
    userAnnotation: draft.userAnnotation,
  });
  return {
    name: attachmentStorageName(path),
    source: "user_ops",
    type: "text",
    content: xml,
    path,
    action: "annotate",
  };
}
