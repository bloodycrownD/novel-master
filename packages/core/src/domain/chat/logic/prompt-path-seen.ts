/**
 * 提示词路径「已出现」集合：规范化与短提示工具。
 *
 * 插入正文 / scan 落库 / 首次读盘 / 短提示 XML / seen key 同形（绝对 POSIX，带前导 `/`）。
 * 目录可先按尾 `/` 判 type，计入 seen 时去尾。
 *
 * @module domain/chat/logic/prompt-path-seen
 */

import { resolveLogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 文本文件非首次附件的短提示正文。 */
export const PROMPT_FILE_SEEN_SHORT_TIP = "该文件前文已引用，无需读取或加载";

/** 目录 token：规范化前看尾部 `/` 或 `\`。 */
export function isPromptDirTokenPath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.endsWith("/") || trimmed.endsWith("\\");
}

/**
 * seen key：补前导 `/`、去尾 `/`、对齐 VFS {@link resolveLogicalPath}。
 *
 * @throws 空路径等非法输入时抛出 VfsError（与 VFS 一致）
 */
export function normalizePromptSeenPath(path: string): string {
  return resolveLogicalPath(path.trim());
}

/**
 * 落库 / 短提示 XML 用 path：一律带前导 `/`；目录可选保留尾 `/` 供 type 判定。
 */
export function normalizePromptStorePath(
  path: string,
  options?: { readonly keepDirTrailingSlash?: boolean },
): string {
  const keepSlash = options?.keepDirTrailingSlash === true;
  const isDir = isPromptDirTokenPath(path);
  const seen = normalizePromptSeenPath(path);
  if (keepSlash && isDir && seen !== "/") {
    return `${seen}/`;
  }
  return seen;
}

/** 尝试规范化；非法 path 返回 `null`（不抛）。 */
export function tryNormalizePromptSeenPath(path: string): string | null {
  if (typeof path !== "string" || path.trim() === "") {
    return null;
  }
  try {
    return normalizePromptSeenPath(path);
  } catch {
    return null;
  }
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * 文本文件非首次专用最小 XML（不经 `renderFileBlock`，无行号 / createdAt 等）。
 */
export function renderPromptFileSeenShortTip(logicalPath: string): string {
  const path = normalizePromptSeenPath(logicalPath);
  return `<file path="${escapeXmlAttr(path)}">${PROMPT_FILE_SEEN_SHORT_TIP}</file>`;
}

/** 由初始前缀 path 列表构造可变 seen 集合（写入前均规范化）。 */
export function createPromptPathSeenSet(
  initialPaths?: readonly string[],
): Set<string> {
  const set = new Set<string>();
  if (initialPaths == null) {
    return set;
  }
  for (const p of initialPaths) {
    const key = tryNormalizePromptSeenPath(p);
    if (key != null) {
      set.add(key);
    }
  }
  return set;
}
