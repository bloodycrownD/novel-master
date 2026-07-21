/**
 * 批量导入相对路径规范化与逻辑路径拼接。
 *
 * @module domain/vfs/logic/vfs-batch-path
 */

import { resolveLogicalPath } from "./vfs-path-mapper.js";

/**
 * 规范化 ingest 相对路径：去掉 leading `/`、反斜杠转正斜杠、拒绝 `..`。
 * @returns 规范化相对路径，或 `null`（非法）
 */
export function normalizeBatchRelativePath(relativePath: string): string | null {
  const trimmed = relativePath.trim().replace(/\\/g, "/");
  if (trimmed.length === 0 || trimmed === ".") {
    return null;
  }
  const withoutLeading = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (withoutLeading.length === 0) {
    return null;
  }
  const segments = withoutLeading.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return null;
    }
    stack.push(segment);
  }
  if (stack.length === 0) {
    return null;
  }
  return stack.join("/");
}

/**
 * 将相对路径拼到目标目录下，得到逻辑绝对路径。
 */
export function joinTargetLogicalPath(
  targetDir: string,
  relativePath: string,
): string {
  const dir = resolveLogicalPath(targetDir);
  const rel = normalizeBatchRelativePath(relativePath);
  if (rel == null) {
    throw new Error(`invalid batch relative path: ${relativePath}`);
  }
  if (dir === "/") {
    return `/${rel}`;
  }
  return `${dir}/${rel}`;
}

/**
 * 逻辑路径相对导出锚点的相对路径（无 leading `/`）。
 * 锚点自身返回空串。
 */
export function relativePathUnderAnchor(
  logical: string,
  anchor: string,
): string {
  const path = resolveLogicalPath(logical);
  const root = resolveLogicalPath(anchor);
  if (root === "/") {
    return path === "/" ? "" : path.slice(1);
  }
  if (path === root) {
    return "";
  }
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) {
    throw new Error(`path ${path} is not under ${root}`);
  }
  return path.slice(prefix.length);
}
