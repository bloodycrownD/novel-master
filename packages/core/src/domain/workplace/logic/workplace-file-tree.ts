/**
 * ASCII file-tree rendering for workplace VFS structure.
 *
 * @module domain/workplace/workplace-file-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type {
  DisplayState,
  WorkplaceDirRule,
  WorkplaceScope,
} from "../model/workplace-types.js";
import {
  sortDirPaths,
  sortFilesForDir,
  type WorkplaceFileSortMeta,
} from "./workplace-eval.js";
import { filetreeMacroLoadStateLabel } from "./workplace-labels.js";
import { workplaceRootLogicalPath } from "./workplace-scope.js";
import { directChildDirs, directChildFiles } from "./workplace-tree.js";

export interface RenderWorkplaceFileTreeParams {
  readonly scope: WorkplaceScope;
  readonly allDirs: ReadonlySet<string>;
  readonly fileSet: ReadonlySet<string>;
  readonly dirRuleMap: ReadonlyMap<string, WorkplaceDirRule>;
  readonly mtimeByPath: ReadonlyMap<string, number>;
}

/** 宏树渲染参数：在基础树参数上附带各文件 display 状态。 */
export interface RenderWorkplaceFileTreeForMacroParams
  extends RenderWorkplaceFileTreeParams {
  readonly displayByPath: ReadonlyMap<string, DisplayState>;
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
export function workplaceFileTreeRootLabel(scope: WorkplaceScope): string {
  const root = workplaceRootLogicalPath(scope);
  if (root === "/") {
    return "/";
  }
  const idx = root.lastIndexOf("/");
  const base = idx >= 0 ? root.slice(idx + 1) : root;
  return base.length > 0 ? base : "/";
}

function sortedChildren(
  dirPath: string,
  params: RenderWorkplaceFileTreeParams,
): TreeEntry[] {
  const dirRule = params.dirRuleMap.get(dirPath) ?? null;
  const subdirs = sortDirPaths(
    directChildDirs(dirPath, params.allDirs),
    dirRule,
  ).map((path) => ({ kind: "dir" as const, path }));

  const files = sortFilesForDir(
    directChildFiles(dirPath, params.fileSet).map(
      (logicalPath): WorkplaceFileSortMeta => ({
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
  params: RenderWorkplaceFileTreeParams,
  displayByPath?: ReadonlyMap<string, DisplayState>,
): void {
  const children = sortedChildren(dirPath, params);
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const child = children[i]!;
    let lineName = entryName(child);
    if (child.kind === "file" && displayByPath != null) {
      const state = displayByPath.get(child.path) ?? "filename";
      lineName += ` ${filetreeMacroLoadStateLabel(state)}`;
    }
    lines.push(`${prefix}${branch}${lineName}`);
    if (child.kind === "dir") {
      appendDirLines(
        lines,
        child.path,
        prefix + (isLast ? "    " : "│   "),
        params,
        displayByPath,
      );
    }
  }
}

/**
 * Renders a UTF-8 directory tree (dirs before files, same sort as workplace list).
 */
export function renderWorkplaceFileTree(
  params: RenderWorkplaceFileTreeParams,
): string {
  const rootPath = workplaceRootLogicalPath(params.scope);
  const rootLabel = workplaceFileTreeRootLabel(params.scope);
  const headerLine = rootLabel === "/" ? "/" : `${rootLabel}/`;
  const lines: string[] = [headerLine];
  appendDirLines(lines, rootPath, "", params);
  return lines.join("\n");
}

/**
 * 渲染带加载状态后缀的 workplace ASCII 树（`{{$filetree}}` 与工作区宏树）。
 */
export function renderWorkplaceFileTreeForMacro(
  params: RenderWorkplaceFileTreeForMacroParams,
): string {
  const rootPath = workplaceRootLogicalPath(params.scope);
  const rootLabel = workplaceFileTreeRootLabel(params.scope);
  const headerLine = rootLabel === "/" ? "/" : `${rootLabel}/`;
  const lines: string[] = [headerLine];
  appendDirLines(lines, rootPath, "", params, params.displayByPath);
  return lines.join("\n");
}
