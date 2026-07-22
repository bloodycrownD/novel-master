/**
 * 构造消息增量 `<action name="…">` + JSON（userAttach / workplaceChange / annotate）。
 *
 * @module domain/chat/logic/build-attachment-action-xml
 */

import { buildUserVfsActionXml } from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import type { MessageAttachmentAction } from "../model/message-attachment.schema.js";
import {
  buildMessageAnnotatePseudoPath,
  isMessageAnnotateDraft,
  isMessageAnnotatePath,
  type AnnotateDraft,
  type MessageAnnotateDraft,
  type SendAnnotateDraft,
} from "../model/annotate-draft.schema.js";
import {
  attachmentStorageName,
  type MessageAttachment,
} from "../model/message-attachment.schema.js";
import { parseAllUserVfsActionsFromText } from "./user-vfs-turn-view.js";

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

function asParamString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** 新 mint 批注草稿 id（Undo 解析恢复用；与发送原 id 解耦）。 */
function mintAnnotateDraftId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 由文件形批注草稿构造落库附件（`source:user_ops` + `action:annotate`）。
 * 真 VFS path；可走既有 path 口径（本函数不对伪 path 调用破坏性 normalize）。
 */
export function buildFileAnnotateAttachmentFromDraft(
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

/**
 * 由消息形批注草稿构造落库附件。
 * `path`=`name`=`__message__:<messageId>:<draftId>`；**不对**伪 path 做破坏性
 * `normalizePromptStorePath`；XML JSON 含 messageId / originalText / userAnnotation。
 */
export function buildMessageAnnotateAttachmentFromDraft(
  draft: MessageAnnotateDraft,
): MessageAttachment {
  // 伪 path：保持 `__message__:` 子串语义，禁止 normalizePromptStorePath
  const path = buildMessageAnnotatePseudoPath(draft.messageId, draft.id);
  const xml = buildAttachmentActionXml("annotate", {
    path,
    messageId: draft.messageId,
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

/**
 * 由批注草稿构造落库附件（`source:user_ops` + `action:annotate`）。
 * 接受 `SendAnnotateDraft` 联合并分派；Desktop 仅传文件形 `AnnotateDraft` 仍编译通过。
 */
export function buildAnnotateAttachmentFromDraft(
  draft: SendAnnotateDraft,
): MessageAttachment {
  if (isMessageAnnotateDraft(draft)) {
    return buildMessageAnnotateAttachmentFromDraft(draft);
  }
  return buildFileAnnotateAttachmentFromDraft(draft);
}

/**
 * 从消息 attachments 解析可 Undo 恢复的工作区批注草稿。
 * 仅 `action===annotate` 且真 VFS path（`!path.includes('__message__:')`）；
 * 每条 **新 mint id**（不复用落库伪 id）。
 */
export function parseAnnotateDraftsFromAttachments(
  attachments: readonly MessageAttachment[] | null | undefined,
): AnnotateDraft[] {
  if (attachments == null || attachments.length === 0) {
    return [];
  }
  const out: AnnotateDraft[] = [];
  for (const att of attachments) {
    if (att.action !== "annotate") {
      continue;
    }
    const pathFromAtt =
      typeof att.path === "string" && att.path !== "" ? att.path : undefined;
    // 优先附件 path；缺省时从 XML JSON 取 path
    let path = pathFromAtt;
    let originalText = "";
    let userAnnotation = "";
    if (typeof att.content === "string" && att.content.includes("<action")) {
      const actions = parseAllUserVfsActionsFromText(att.content);
      const annotate = actions.find((a) => a.name === "annotate");
      if (annotate != null) {
        if (path == null || path === "") {
          path = asParamString(annotate.params.path) || annotate.path;
        }
        originalText = asParamString(annotate.params.originalText);
        userAnnotation = asParamString(annotate.params.userAnnotation);
      }
    }
    if (path == null || path === "") {
      continue;
    }
    // 消息批注伪 path（含 `/__message__:`）→ 跳过 Undo 恢复
    if (isMessageAnnotatePath(path)) {
      continue;
    }
    out.push({
      id: mintAnnotateDraftId(),
      path,
      originalText,
      userAnnotation,
    });
  }
  return out;
}
