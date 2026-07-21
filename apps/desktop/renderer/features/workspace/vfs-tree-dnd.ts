/**
 * Workspace 树 DnD 纯逻辑：自定义 MIME 移动、目标路径解析、自/后代检测。
 */

/** 树内 VFS 路径拖动 MIME（与 spec 钉死一致）。 */
export const NM_VFS_PATHS_MIME = "application/x-nm-vfs-paths";

export type VfsDragPayload = {
  readonly paths: readonly string[];
};

export function encodeVfsDragPayload(paths: readonly string[]): string {
  return JSON.stringify({ paths: [...paths] } satisfies VfsDragPayload);
}

export function decodeVfsDragPayload(raw: string): VfsDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as VfsDragPayload).paths)
    ) {
      return null;
    }
    const paths = (parsed as VfsDragPayload).paths.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    return paths.length > 0 ? { paths } : null;
  } catch {
    return null;
  }
}

/** source 是否为 target 自身或祖先（禁止拖到自身/后代）。 */
export function isSelfOrAncestorPath(
  sourcePath: string,
  targetDir: string,
): boolean {
  if (sourcePath === targetDir) {
    return true;
  }
  if (sourcePath === "/") {
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
    sourcePath === "/"
      ? ""
      : sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  if (!name) {
    return targetDir;
  }
  if (targetDir === "/") {
    return `/${name}`;
  }
  return `${targetDir.replace(/\/+$/, "")}/${name}`;
}

/**
 * drop 落点目录：目录行 → 该目录；文件行 → 其父目录；空白 → `/`。
 */
export function dropTargetDir(
  rowPath: string | null,
  rowKind: "dir" | "file" | null,
): string {
  if (rowPath == null || rowKind == null) {
    return "/";
  }
  if (rowKind === "dir") {
    return rowPath;
  }
  const idx = rowPath.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return rowPath.slice(0, idx) || "/";
}

export function hasNmVfsMime(types: DOMStringList | readonly string[]): boolean {
  const list = Array.from(types as ArrayLike<string>);
  return list.includes(NM_VFS_PATHS_MIME);
}

export function hasFileDrag(types: DOMStringList | readonly string[]): boolean {
  const list = Array.from(types as ArrayLike<string>);
  return list.includes("Files");
}
