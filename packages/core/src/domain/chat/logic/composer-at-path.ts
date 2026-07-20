/**
 * Composer `@路径` 插入与 typeahead 候选（与 scan / seen 规范化同形）。
 * 不含 Mobile mention / controlled-mentions 专属逻辑。
 *
 * @module domain/chat/logic/composer-at-path
 */

import { normalizePromptStorePath } from "./prompt-path-seen.js";
import { scanAtPathAttachments } from "./scan-at-path-attachments.js";

export type AtPathRef = {
  readonly path: string;
  readonly kind: "file" | "dir";
};

/** 插入正文的 `@path`（目录带尾 `/`，落库扫描后带前导 `/`）。 */
export function formatComposerAtPathToken(
  path: string,
  isDir: boolean,
): string {
  if (isDir) {
    // 选择器 path 通常无尾 `/`；先补尾再规范化，保证正文 token 与 scan 目录判定一致
    const withSlash = path.endsWith("/") || path === "/" ? path : `${path}/`;
    const store = normalizePromptStorePath(withSlash, {
      keepDirTrailingSlash: true,
    });
    return `@${store}`;
  }
  const store = normalizePromptStorePath(path);
  return `@${store}`;
}

/** 选择器多选 → 正文 token 列表（先 dir 后 file）。 */
export function atPathTokensFromPickerSelection(
  selectedDirs: Iterable<string>,
  selectedFiles: Iterable<string>,
): string[] {
  return [
    ...[...selectedDirs].map((p) => formatComposerAtPathToken(p, true)),
    ...[...selectedFiles].map((p) => formatComposerAtPathToken(p, false)),
  ];
}

/**
 * 光标处未完成的 `@…` 查询；无活跃 token 时返回 null。
 * `query` 不含 `@`；`start` 为 `@` 下标。
 */
export function findActiveAtQuery(
  text: string,
  cursor: number,
): { readonly start: number; readonly query: string } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const at = before.lastIndexOf("@");
  if (at < 0) {
    return null;
  }
  if (at > 0) {
    const prev = before[at - 1]!;
    if (prev !== " " && prev !== "\n" && prev !== "\t") {
      return null;
    }
  }
  const query = before.slice(at + 1);
  if (query.includes(" ") || query.includes("\n") || query.includes("\t")) {
    return null;
  }
  return { start: at, query };
}

/** 用完整 token 替换 `[start, cursor)`，并在末尾补空格（若尚无）。 */
export function replaceActiveAtWithToken(
  text: string,
  cursor: number,
  start: number,
  token: string,
): { readonly text: string; readonly cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(cursor);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = needsSpace ? `${token} ` : token;
  const next = `${before}${inserted}${after}`;
  return { text: next, cursor: before.length + inserted.length };
}

/** 模糊匹配 path / basename，最多 `limit` 条（默认 5）。 */
export function filterAtPathTypeaheadCandidates(
  refs: readonly AtPathRef[],
  query: string,
  limit = 5,
): AtPathRef[] {
  const q = query.trim().toLowerCase();
  const out: AtPathRef[] = [];
  for (const ref of refs) {
    if (ref.path === "/") {
      continue;
    }
    const pathLower = ref.path.toLowerCase();
    const base = basename(ref.path).toLowerCase();
    if (q === "" || pathLower.includes(q) || base.includes(q)) {
      out.push(ref);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}

/** 发送门闩：正文 `@` 扫描条数（不再认 draft attach chip）。 */
export function countScannedAtPathAttachments(text: string): number {
  return scanAtPathAttachments(text).length;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
