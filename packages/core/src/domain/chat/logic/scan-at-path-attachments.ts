/**
 * 发送时扫描正文手输 `@path` → `source:attach` 附件（正文 token 保留）。
 *
 * 落库 path 与提示词 seen key / 短提示 XML 同形：补前导 `/`；目录先按尾 `/` 判 type，
 * 计入去重时去尾（seen key 无尾斜杠），落库目录可保留尾 `/`。
 *
 * 另对外提供 {@link attachmentsFromPaths}：把「显式路径列表」（task 工具
 * `fileAttachment`）物化成同一链路的合规新写入附件。
 *
 * @module domain/chat/logic/scan-at-path-attachments
 */

import { isVfsError } from "@/errors/vfs-errors.js";
import {
  attachmentStorageName,
  type MessageAttachment,
} from "../model/message-attachment.schema.js";
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
 * user_ops 现有 path，与 workplace/attach 同走 path 键；仅缺 path 时回退 name 键。
 */
export function mergeAttachmentsWithScannedAtPaths(
  text: string,
  existing: readonly MessageAttachment[]
): MessageAttachment[] {
  return mergeAttachmentsByPath(existing, scanAtPathAttachments(text));
}

/** 按 path（或 user_ops name）去重合并；已有优先。 */
export function mergeAttachmentsByPath(
  existing: readonly MessageAttachment[],
  incoming: readonly MessageAttachment[]
): MessageAttachment[] {
  const out = [...existing];
  const seen = new Set(
    existing
      .map((a) => attachmentDedupeKey(a))
      .filter((k): k is string => k != null)
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

/** 空串 / 纯空白路径元素：参数非法，调用方（如 task 工具）转 ToolError 回给模型。 */
export class AttachmentPathArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPathArgumentError";
  }
}

/**
 * 显式路径列表 → `source:"attach"` 合规新写入附件（task 工具 `fileAttachment` 用）。
 *
 * 与 {@link scanAtPathAttachments} 的 `@path` 扫描共用同一条物化路径——逐条走
 * {@link attachFromPath} 的规范化（`isPromptDirTokenPath` / `normalizePromptStorePath`
 * / `tryNormalizePromptSeenPath` / image·binary 启发式 / type 分派），落库 path 形态
 * 与正文扫描完全一致（补前导 `/`，目录保留尾 `/`）；随后经
 * {@link mergeAttachmentsByPath} 按 seen key 去重（先物化、后去重，与正文扫描同序）。
 *
 * 两处与 {@link attachFromPath} 的差异（**合规新写入形态**，spec D9/D10）：
 * 1. `name` 一律覆写为 {@link attachmentStorageName}（= 落库 path）——带 `action` 的
 *    zod refine 硬要求 `name === attachmentStorageName(path)`，照抄 basename 会直接抛错
 *    （`messages.append` 走 `parse` 而非 `safeParse`，子会话首条 user 消息会落库炸掉）；
 * 2. 显式补 `action: "userAttach"`——hydrate 阶段不需要再补，落库形态即新写入口径。
 *
 * `content` 保持 `null`（首次全文由 `prepareUserMessagesForPrompt` 的 hydrate 按
 * seen 判定注入）；`type` 保留启发式分派结果（text / image / dir）。
 *
 * @param paths 原始路径列表（允许相对写法与目录尾 `/`，均按 attachFromPath 口径规范化）
 * @throws {AttachmentPathArgumentError} 元素为空串或纯空白，或路径无法被 VFS 规范化
 */
export function attachmentsFromPaths(
  paths: readonly string[]
): MessageAttachment[] {
  const materialized: MessageAttachment[] = [];
  for (const raw of paths) {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new AttachmentPathArgumentError(
        "附件路径不能为空串或纯空白",
      );
    }
    let base: MessageAttachment;
    try {
      base = attachFromPath(raw);
    } catch (error) {
      // 路径穿越等非法写法（`/../evil`）会在 attachFromPath 的规范化里抛 VfsError
      // （同 `normalizePromptSeenPath` → `resolveLogicalPath`）。但本函数的对外契约是
      // 「入参非法一律 AttachmentPathArgumentError」——调用方（task 工具）只认这一种
      // 错误类型来转成带 `fileAttachment` 引导的 ToolError；若让裸 VfsError 逃逸，
      // 模型拿到的是一句没有字段名的路径报错，只能盲猜改参数。message 保留原文。
      if (isVfsError(error)) {
        throw new AttachmentPathArgumentError(error.message);
      }
      throw error;
    }
    materialized.push({
      ...base,
      name: attachmentStorageName(base.path),
      action: "userAttach",
    });
  }
  // 去重键取的是落库 path 的规范化 seen key，与正文扫描共用一套去重口径。
  return mergeAttachmentsByPath([], materialized);
}

function attachmentDedupeKey(a: MessageAttachment): string | null {
  // skillAttach：无 path，判重唯一键 = skillName（`skill:{name}`，与
  // scan-skill-attachments 的 skillSeenKey / 提示词 seen key 同形）
  if (a.action === "skillAttach") {
    return typeof a.skillName === "string" && a.skillName !== ""
      ? `skill:${a.skillName}`
      : null;
  }
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
