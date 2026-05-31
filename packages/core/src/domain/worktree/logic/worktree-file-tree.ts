/**
 * ASCII file-tree rendering for worktree VFS structure.
 *
 * @module domain/worktree/worktree-file-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorktreeDirRule, WorktreeScope } from "../model/worktree-types.js";
import {
  sortDirPaths,
  sortFilesForDir,
  type WorktreeFileSortMeta,
} from "./worktree-eval.js";
import { worktreeRootLogicalPath } from "./worktree-scope.js";
import { directChildDirs, directChildFiles } from "./worktree-tree.js";

export interface RenderWorktreeFileTreeParams {
  readonly scope: WorktreeScope;
  readonly allDirs: ReadonlySet<string>;
  readonly fileSet: ReadonlySet<string>;
  readonly dirRuleMap: ReadonlyMap<string, WorktreeDirRule>;
  readonly mtimeByPath: ReadonlyMap<string, number>;
}

type TreeEntry = { readonly kind: "dir" | "file"; readonly path: string };

function entryName(entry: TreeEntry): string {
  const normalized = normalizePath(entry.path);
  if (entry.kind === "dir") {
    if (normalized === "/") {
      return "/";
    }
    const idx = normalized.lastIndexOf("/");
    const base = idx >= 0 ? normalized.slice(idx + 1) : normalized;
    return `${base}/`;
  }
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/** Human-readable root label for the tree header line. */
export function worktreeFileTreeRootLabel(scope: WorktreeScope): string {
  const root = worktreeRootLogicalPath(scope);
  if (root === "/") {
    return "workspace";
  }
  const idx = root.lastIndexOf("/");
  const base = idx >= 0 ? root.slice(idx + 1) : root;
  return base.length > 0 ? base : "root";
}

function sortedChildren(
  dirPath: string,
  params: RenderWorktreeFileTreeParams,
): TreeEntry[] {
  const dirRule = params.dirRuleMap.get(dirPath) ?? null;
  const subdirs = sortDirPaths(
    directChildDirs(dirPath, params.allDirs),
    dirRule,
  ).map((path) => ({ kind: "dir" as const, path }));

  const files = sortFilesForDir(
    directChildFiles(dirPath, params.fileSet).map(
      (logicalPath): WorktreeFileSortMeta => ({
        logicalPath,
        mtimeMs: params.mtimeByPath.get(logicalPath) ?? 0,
      }),
    ),
    dirRule,
  ).map((file) => ({ kind: "file" as const, path: file.logicalPath }));

  return [...subdirs, ...files];
}

function appendDirLines(
  lines: string[],
  dirPath: string,
  prefix: string,
  params: RenderWorktreeFileTreeParams,
): void {
  const children = sortedChildren(dirPath, params);
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const child = children[i]!;
    lines.push(`${prefix}${branch}${entryName(child)}`);
    if (child.kind === "dir") {
      appendDirLines(
        lines,
        child.path,
        prefix + (isLast ? "    " : "│   "),
        params,
      );
    }
  }
}

/**
 * Renders a UTF-8 directory tree (dirs before files, same sort as worktree list).
 */
export function renderWorktreeFileTree(
  params: RenderWorktreeFileTreeParams,
): string {
  const rootPath = worktreeRootLogicalPath(params.scope);
  const rootLabel = worktreeFileTreeRootLabel(params.scope);
  const lines: string[] = [`${rootLabel}/`];
  appendDirLines(lines, rootPath, "", params);
  return lines.join("\n");
}
