/** Join parent VFS path with a child name; normalizes duplicate slashes. */
export function joinVfsPath(parentPath: string, name: string): string {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return parentPath || "/";
  }
  const base = parentPath === "/" || parentPath === "" ? "" : parentPath.replace(/\/+$/, "");
  const joined = `${base}/${trimmed}`.replace(/\/+/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}
