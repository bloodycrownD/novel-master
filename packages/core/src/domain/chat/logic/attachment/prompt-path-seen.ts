/**
 * 提示词路径「已出现」集合：规范化与短提示工具。
 *
 * 插入正文 / scan 落库 / 首次读盘 / 短提示 XML / seen key 同形（绝对 POSIX，带前导 `/`）。
 * 目录可先按尾 `/` 判 type，计入 seen 时去尾。
 *
 * @module domain/chat/logic/attachment/prompt-path-seen
 */

import { resolveLogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 目录 token：规范化前看尾部 `/` 或 `\`。 */
export function isPromptDirTokenPath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.endsWith("/") || trimmed.endsWith("\\");
}

/**
 * 落库 / 短提示 XML 用 path：一律带前导 `/`；目录可选保留尾 `/` 供 type 判定。
 */
export function normalizePromptStorePath(path: string, options?: { readonly keepDirTrailingSlash?: boolean }): string {
  const keepSlash = options?.keepDirTrailingSlash === true;
  const isDir = isPromptDirTokenPath(path);
  const seen = resolveLogicalPath(path);
  if (keepSlash && isDir && seen !== "/") {
    return `${seen}/`;
  }
  return seen;
}

/** 尝试规范化；非法 path 返回 `null`（不抛）。 */
export function tryNormalizePromptSeenPath(path: string): string | null {
  if (path.trim() === "") {
    return null;
  }
  try {
    return resolveLogicalPath(path);
  } catch {
    return null;
  }
}

/** 由初始前缀 path 列表构造可变 seen 集合（写入前均规范化）。 */
export function createPromptPathSeenSet(initialPaths?: readonly string[]): Set<string> {
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
