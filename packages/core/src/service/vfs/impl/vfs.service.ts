/**
 * Default VFS application service implementation.
 *
 * @module service/vfs/impl/vfs.service
 */

import type { VfsEntryRepository } from "../../../domain/vfs/repositories/vfs-entry.port.js";
import {
  VfsError,
  vfsNotFound,
  vfsReplaceNotFound,
} from "../../../errors/vfs-errors.js";
import { matchGlob } from "../glob-match.js";
import type {
  VfsGrepMatch,
  VfsReadResult,
  VfsService,
  WriteOptions,
} from "../vfs.port.js";

/**
 * VFS service delegating persistence to {@link VfsEntryRepository}.
 */
export class DefaultVfsService implements VfsService {
  constructor(private readonly repo: VfsEntryRepository) {}

  list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<string[]> {
    return this.repo.list(dir, options);
  }

  async read(path: string): Promise<VfsReadResult> {
    const entry = await this.repo.findByPath(path);
    if (entry == null) {
      throw vfsNotFound(path);
    }
    return {
      path: entry.path,
      content: entry.content,
      version: entry.version,
      mtimeMs: entry.mtimeMs,
    };
  }

  async write(
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }> {
    const existing = await this.repo.findByPath(path);
    if (existing == null) {
      return this.repo.insert(path, content);
    }

    const versionCheck = options?.versionCheck !== false;
    if (versionCheck && options?.expectedVersion == null) {
      throw new VfsError(
        "CONFLICT",
        `expectedVersion required when updating ${path}`,
        { path },
      );
    }
    return this.repo.update(path, content, {
      expectedVersion: options?.expectedVersion,
      versionCheck,
    });
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    const current = await this.read(path);
    let replacements = 0;
    let nextContent = current.content;

    if (options?.replaceAll) {
      if (!current.content.includes(oldString)) {
        throw vfsReplaceNotFound(path);
      }
      const parts = current.content.split(oldString);
      replacements = parts.length - 1;
      nextContent = parts.join(newString);
    } else {
      const index = current.content.indexOf(oldString);
      if (index === -1) {
        throw vfsReplaceNotFound(path);
      }
      replacements = 1;
      nextContent =
        current.content.slice(0, index) +
        newString +
        current.content.slice(index + oldString.length);
    }

    const result = await this.repo.update(path, nextContent, {
      expectedVersion: current.version,
      versionCheck: true,
    });
    return { version: result.version, replacements };
  }

  async glob(
    pattern: string,
    options?: { cwd?: string },
  ): Promise<string[]> {
    const paths = await this.repo.listAllPaths();
    const cwd = options?.cwd;

    const matched = paths.filter((entryPath) => {
      if (cwd != null && !pathUnderDir(entryPath, cwd)) {
        return false;
      }
      return matchGlob(pattern, entryPath);
    });

    matched.sort();
    return matched;
  }

  async grep(
    pattern: string,
    options?: { pathPrefix?: string },
  ): Promise<VfsGrepMatch[]> {
    const rows = await this.repo.scanContents(options?.pathPrefix);
    const matches: VfsGrepMatch[] = [];

    for (const row of rows) {
      const lines = row.content.split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex]!;
        let searchFrom = 0;
        while (searchFrom < line.length) {
          const columnIndex = line.indexOf(pattern, searchFrom);
          if (columnIndex === -1) {
            break;
          }
          matches.push({
            path: row.path,
            line: lineIndex + 1,
            column: columnIndex + 1,
            excerpt: line,
          });
          searchFrom = columnIndex + Math.max(pattern.length, 1);
        }
      }
    }

    return matches;
  }

  delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.repo.delete(path, { recursive: options?.recursive === true });
  }
}

function pathUnderDir(entryPath: string, dir: string): boolean {
  if (dir === "/") {
    return true;
  }
  return entryPath === dir || entryPath.startsWith(`${dir}/`);
}
