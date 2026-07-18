/**
 * 发送时扫描正文手输 `@path` → `source:attach` 附件（正文 token 保留）。
 *
 * 落库 path 与提示词 seen key / 短提示 XML 同形：补前导 `/`；目录先按尾 `/` 判 type，
 * 计入去重时去尾（seen key 无尾斜杠），落库目录可保留尾 `/`。
 *
 * @module domain/chat/logic/scan-at-path-attachments
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import {
  isBinaryAttachPath,
  isImageAttachPath,
} from "./attach-binary-heuristic.js";
import {
  isPromptDirTokenPath,
  normalizePromptStorePath,
  tryNormalizePromptSeenPath,
} from "./prompt-path-seen.js";

/**
 * 合法 `@path`：`@` 后至空白/行尾（允许中文路径）。
 * 与选择器 path 语义对齐。
 */
const AT_PATH_TOKEN_RE = /@([^\s@]+)/g;

/** 从正文扫描 `@path` token，生成 `source:attach` 附件（按规范化 seen key 去重）。 */
export function scanAtPathAttachments(text: string): MessageAttachment[] {
  if (text === "") {
    return [];
  }
  const seen = new Set<string>();
  const out: MessageAttachment[] = [];
  AT_PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AT_PATH_TOKEN_RE.exec(text)) != null) {
    const raw = match[1]!;
    if (raw === "") {
      continue;
    }
    const seenKey = tryNormalizePromptSeenPath(raw);
    if (seenKey == null || seen.has(seenKey)) {
      continue;
    }
    seen.add(seenKey);
    out.push(attachFromPath(raw));
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
    const seenKey = tryNormalizePromptSeenPath(a.path);
    return `path:${seenKey ?? a.path}`;
  }
  if (a.source === "user_ops") {
    return `user_ops:${a.name}`;
  }
  return null;
}

function attachFromPath(rawPath: string): MessageAttachment {
  const isDir = isPromptDirTokenPath(rawPath);
  const storePath = normalizePromptStorePath(rawPath, {
    keepDirTrailingSlash: isDir,
  });
  const seenKey = tryNormalizePromptSeenPath(rawPath) ?? storePath;
  const basename = seenKey.split("/").filter(Boolean).pop() ?? seenKey;
  if (isImageAttachPath(seenKey) || isImageAttachPath(rawPath)) {
    return {
      name: basename,
      source: "attach",
      type: "image",
      content: null,
      path: storePath,
    };
  }
  if (isDir) {
    return {
      name: basename || storePath,
      source: "attach",
      type: "dir",
      content: null,
      path: storePath,
    };
  }
  if (isBinaryAttachPath(seenKey) || isBinaryAttachPath(rawPath)) {
    return {
      name: basename,
      source: "attach",
      type: "text",
      content: null,
      path: storePath,
    };
  }
  return {
    name: basename,
    source: "attach",
    type: "text",
    content: null,
    path: storePath,
  };
}
