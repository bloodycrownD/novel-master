/**
 * VFS 复制链排除前缀（隔离豁免）判定工具。
 *
 * `replaceVfsSubtree` / `copyVfsTree` / sweep / seed 各侧共用同一口径：
 * 排除前缀可带或不带前导 `/`（`meta/skills` 与 `/meta/skills` 等价），
 * 命中前缀本身或其子路径都算排除。默认空数组 = 现行为完全不变。
 *
 * @module domain/vfs/logic/vfs-exclude-prefixes
 */

import { normalizePrefix } from "../repositories/impl/scope-prefix-helpers.js";

/** 把调用方传入的排除前缀规范化为带前导 `/` 的无尾斜杠形态。 */
export function normalizeExcludePrefix(raw: string): string {
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return normalizePrefix(withLeadingSlash);
}

/**
 * 判断完整逻辑路径是否落在任一排除前缀下（含前缀本身）。
 *
 * @remarks 排除 `/` 等于排除整棵树——正常调用方不会这样传，此处按
 * 「全部命中」处理，保证语义自洽而非静默忽略。
 */
export function isVfsPathExcluded(
  path: string,
  excludePrefixes: readonly string[]
): boolean {
  for (const raw of excludePrefixes) {
    const base = normalizeExcludePrefix(raw);
    if (base === "/" || base === "") {
      return true;
    }
    if (path === base || path.startsWith(`${base}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * 判断路径是否为任一排除前缀的祖先目录（严格前缀，不含前缀本身）。
 *
 * @remarks 删除侧需要连带保留祖先目录：排除子树里的 entry 不删，
 * 那么承载它们的目录层级也不能删，否则会因「目录非空」失败。
 */
export function isVfsPathAncestorOfExcluded(
  path: string,
  excludePrefixes: readonly string[]
): boolean {
  for (const raw of excludePrefixes) {
    const base = normalizeExcludePrefix(raw);
    if (base === "/" || base === "") {
      return true;
    }
    if (base.startsWith(`${path}/`)) {
      return true;
    }
  }
  return false;
}
