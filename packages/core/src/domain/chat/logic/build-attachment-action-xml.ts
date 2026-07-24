/**
 * 构造消息增量 `<action name="…">` + JSON（userAttach / workplaceChange / annotate）。
 *
 * @module domain/chat/logic/build-attachment-action-xml
 */

import { buildUserVfsActionXml } from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import type { MessageAttachmentAction } from "../model/message-attachment.schema.js";
import {
  isMessageAnnotatePath,
  type AnnotateDraft,
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

/** 读 optional 正整数参数（缺字段 / 非法 → undefined，旧附件兼容）。 */
function asParamPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}

/** 读 optional 非负整数（offset；0 合法；旧附件缺字段 → undefined）。 */
function asParamNonNegInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) {
      return n;
    }
  }
  return undefined;
}

/** 新 mint 批注草稿 id（Undo 解析恢复用；与发送原 id 解耦）。 */
function mintAnnotateDraftId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 由文件形批注草稿构造落库附件（`source:user_ops` + `action:annotate`）。
 * 真 VFS path；可走既有 path 口径（本函数不对伪 path 调用破坏性 normalize）。
 * 有半开 offset / 宽松行列时**显式**写入 XML JSON；缺字段不写键。
 */
export function buildFileAnnotateAttachmentFromDraft(
  draft: AnnotateDraft,
): MessageAttachment {
  const path = draft.path;
  const params: Record<string, unknown> = {
    path,
    originalText: draft.originalText,
    userAnnotation: draft.userAnnotation,
  };
  if (draft.startOffset != null) {
    params.startOffset = draft.startOffset;
  }
  if (draft.endOffset != null) {
    params.endOffset = draft.endOffset;
  }
  if (draft.startLine != null) {
    params.startLine = draft.startLine;
  }
  if (draft.endLine != null) {
    params.endLine = draft.endLine;
  }
  if (draft.startCol != null) {
    params.startCol = draft.startCol;
  }
  if (draft.endCol != null) {
    params.endCol = draft.endCol;
  }
  const xml = buildAttachmentActionXml("annotate", params);
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
 * 仅文件形 `AnnotateDraft`（消息批注发送管线已移除）。
 */
export function buildAnnotateAttachmentFromDraft(
  draft: AnnotateDraft,
): MessageAttachment {
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
    let startOffset: number | undefined;
    let endOffset: number | undefined;
    let startLine: number | undefined;
    let endLine: number | undefined;
    let startCol: number | undefined;
    let endCol: number | undefined;
    if (typeof att.content === "string" && att.content.includes("<action")) {
      const actions = parseAllUserVfsActionsFromText(att.content);
      const annotate = actions.find((a) => a.name === "annotate");
      if (annotate != null) {
        if (path == null || path === "") {
          path = asParamString(annotate.params.path) || annotate.path;
        }
        originalText = asParamString(annotate.params.originalText);
        userAnnotation = asParamString(annotate.params.userAnnotation);
        startOffset = asParamNonNegInt(annotate.params.startOffset);
        endOffset = asParamNonNegInt(annotate.params.endOffset);
        startLine = asParamPositiveInt(annotate.params.startLine);
        endLine = asParamPositiveInt(annotate.params.endLine);
        startCol = asParamPositiveInt(annotate.params.startCol);
        endCol = asParamPositiveInt(annotate.params.endCol);
      }
    }
    if (path == null || path === "") {
      continue;
    }
    // 消息批注伪 path（含 `/__message__:`）→ 跳过 Undo 恢复
    if (isMessageAnnotatePath(path)) {
      continue;
    }
    // offset 成对且半开合法才写回；残缺/非法旧数据丢 offset，保留其余
    const offsetsOk =
      startOffset != null &&
      endOffset != null &&
      startOffset < endOffset;
    out.push({
      id: mintAnnotateDraftId(),
      path,
      originalText,
      userAnnotation,
      ...(offsetsOk ? { startOffset, endOffset } : {}),
      ...(startLine != null ? { startLine } : {}),
      ...(endLine != null ? { endLine } : {}),
      ...(startCol != null ? { startCol } : {}),
      ...(endCol != null ? { endCol } : {}),
    });
  }
  return out;
}
