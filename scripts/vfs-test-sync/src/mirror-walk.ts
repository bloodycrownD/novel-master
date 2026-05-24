import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Directory names excluded from mirror walks (never synced to VFS). */
const SKIP_DIRS = new Set([".git"]);

/**
 * Recursively lists files under `root` as POSIX-style relative paths.
 * Skips `.git` directories so git metadata is never mirrored into VFS.
 */
export async function walkMirror(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if (
        err != null &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "ENOENT"
      ) {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        results.push(rel.replace(/\\/g, "/"));
      }
    }
  }

  await walk(root, "");
  results.sort();
  return results;
}
