/**
 * 发送时扫描正文手输 `@path` → `source:attach` 附件（正文 token 保留）。
 *
 * @module domain/chat/logic/scan-at-path-attachments
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import {
  isBinaryAttachPath,
  isImageAttachPath,
} from "./attach-binary-heuristic.js";

/**
 * 合法 `@path`：`@` 后至空白/行尾（允许中文路径）。
 * 与选择器 path 语义对齐。
 */
const AT_PATH_TOKEN_RE = /@([^\s@]+)/g;

/** 从正文扫描 `@path` token，生成 `source:attach` 附件（按 path 去重）。 */
export function scanAtPathAttachments(text: string): MessageAttachment[] {
  if (text === "") {
    return [];
  }
  const seen = new Set<string>();
  const out: MessageAttachment[] = [];
  AT_PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AT_PATH_TOKEN_RE.exec(text)) != null) {
    const path = match[1]!;
    if (path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(attachFromPath(path));
  }
  return out;
}

/**
 * 合并已有 chips / 选项附件与扫描结果；按 path 去重（先保留已有）。
 * user_ops（无 path）按出现顺序保留，不与 path 键冲突。
 */
export function mergeAttachmentsWithScannedAtPaths(
  text: string,
  existing: readonly MessageAttachment[],
): MessageAttachment[] {
  return mergeAttachmentsByPath(existing, scanAtPathAttachments(text));
}

/** 按 path（或 user_ops name）去重合并；已有优先。 */
export function mergeAttachmentsByPath(
  existing: readonly MessageAttachment[],
  incoming: readonly MessageAttachment[],
): MessageAttachment[] {
  const out = [...existing];
  const seen = new Set(
    existing
      .map((a) => attachmentDedupeKey(a))
      .filter((k): k is string => k != null),
  );
  for (const item of incoming) {
    const key = attachmentDedupeKey(item);
    if (key != null && seen.has(key)) {
      continue;
    }
    if (key != null) {
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

function attachmentDedupeKey(a: MessageAttachment): string | null {
  if (a.path != null && a.path !== "") {
    return `path:${a.path}`;
  }
  if (a.source === "user_ops") {
    return `user_ops:${a.name}`;
  }
  return null;
}

function attachFromPath(path: string): MessageAttachment {
  const basename = path.split("/").filter(Boolean).pop() ?? path;
  if (isImageAttachPath(path)) {
    return {
      name: basename,
      source: "attach",
      type: "image",
      content: null,
      path,
    };
  }
  if (path.endsWith("/") || path.endsWith("\\")) {
    return {
      name: basename || path,
      source: "attach",
      type: "dir",
      content: null,
      path,
    };
  }
  if (isBinaryAttachPath(path)) {
    return {
      name: basename,
      source: "attach",
      type: "text",
      content: null,
      path,
    };
  }
  return {
    name: basename,
    source: "attach",
    type: "text",
    content: null,
    path,
  };
}
