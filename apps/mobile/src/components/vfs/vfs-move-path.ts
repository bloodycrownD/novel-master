/**
 * VFS 批量移动用的纯路径工具（从 desktop vfs-tree-dnd 拷贝，暂不抽 core）。
 */

/** source 是否为 target 自身或祖先（禁止移到自身/子树）。 */
export function isSelfOrAncestorPath(
  sourcePath: string,
  targetDir: string,
): boolean {
  if (sourcePath === targetDir) {
    return true;
  }
  if (sourcePath === '/') {
    return true;
  }
  return targetDir === sourcePath || targetDir.startsWith(`${sourcePath}/`);
}

/**
 * 将 `sourcePath` 移动到 `targetDir` 下，保留 basename。
 * 例：/a/b.txt → /c  ⇒ /c/b.txt；/a → /  ⇒ /a
 */
export function resolveMoveDestination(
  sourcePath: string,
  targetDir: string,
): string {
  const name =
    sourcePath === '/'
      ? ''
      : sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  if (!name) {
    return targetDir;
  }
  if (targetDir === '/') {
    return `/${name}`;
  }
  return `${targetDir.replace(/\/+$/, '')}/${name}`;
}

/** 目标目录是否落在任一源路径自身或其子树上（不可用作移动目标）。 */
export function isBlockedMoveTarget(
  targetDir: string,
  sourcePaths: readonly string[],
): boolean {
  return sourcePaths.some(src => isSelfOrAncestorPath(src, targetDir));
}
