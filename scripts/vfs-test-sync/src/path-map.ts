import { join } from "node:path";
import { PathMapError } from "./errors.js";

/**
 * Normalizes a VFS prefix: leading `/`, no trailing slash (except root).
 */
export function normalizePrefix(prefix: string): string {
  const normalized = prefix.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    throw new PathMapError("prefix must start with /");
  }
  if (normalized.includes("..")) {
    throw new PathMapError("prefix must not contain ..");
  }
  if (normalized === "/") {
    return "/";
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * Maps a mirror-relative path to an absolute VFS path under `prefix`.
 */
export function toVfsPath(prefix: string, rel: string): string {
  const normPrefix = normalizePrefix(prefix);
  const normRel = rel.replace(/\\/g, "/");
  if (normRel.includes("..")) {
    throw new PathMapError("relative path must not contain ..");
  }
  if (normRel.startsWith("/")) {
    throw new PathMapError("relative path must not start with /");
  }
  if (normRel.length === 0) {
    throw new PathMapError("relative path must not be empty");
  }

  if (normPrefix === "/") {
    return `/${normRel}`;
  }
  return `${normPrefix}/${normRel}`;
}

/**
 * Maps a VFS path to a mirror-relative path, or `null` when outside prefix.
 */
export function toMirrorRelative(prefix: string, vfsPath: string): string | null {
  const normPrefix = normalizePrefix(prefix);
  const normVfs = vfsPath.replace(/\\/g, "/");
  if (!normVfs.startsWith("/")) {
    throw new PathMapError("vfs path must start with /");
  }
  if (normVfs.includes("..")) {
    throw new PathMapError("vfs path must not contain ..");
  }

  if (normPrefix === "/") {
    if (normVfs === "/") {
      return null;
    }
    return normVfs.slice(1);
  }

  if (normVfs === normPrefix) {
    return null;
  }
  if (!normVfs.startsWith(`${normPrefix}/`)) {
    return null;
  }
  return normVfs.slice(normPrefix.length + 1);
}

/**
 * Resolves a mirror-relative path to an absolute filesystem path.
 */
export function toMirrorFile(root: string, rel: string): string {
  const normRel = rel.replace(/\\/g, "/");
  return join(root, ...normRel.split("/"));
}
