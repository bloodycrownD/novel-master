/**
 * ASCII file-tree rendering for workplace VFS structure.
 *
 * @module domain/workplace/workplace-file-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { DisplayState, WorkplaceDirRule, WorkplaceScope } from "../model/workplace-types.js";
import { sortDirPaths, sortFilesForDir, type WorkplaceFileSortMeta } from "./workplace-eval.js";
import type { CompiledSmartSortRule } from "./smart-sort.js";
import { filetreeMacroLoadStateLabel } from "./workplace-labels.js";
import { workplaceRootLogicalPath } from "./workplace-scope.js";
import { directChildDirs } from "./workplace-tree.js";

/** nm-style: keep-public — 导出函数签名类型；declaration 构建要求导出，脚本不统计签名内类型引用。 */
export interface RenderWorkplaceFileTreeParams {
  readonly scope: WorkplaceScope;
  readonly allDirs: ReadonlySet<string>;
  readonly fileSet: ReadonlySet<string>;
  readonly dirRuleMap: ReadonlyMap<string, WorkplaceDirRule>;
  readonly mtimeByPath: ReadonlyMap<string, number>;
  /** 预编译智能排序规则（spec D4）；缺省时 smart 退化为自然排序。 */
  readonly smartRules?: readonly CompiledSmartSortRule[];
  /** 目录 path → mtime（spec D7）；缺省时目录 created/updated 退化为 name 字典序。 */
  readonly dirMtimeByPath?: ReadonlyMap<string, number>;
}

/**
 * 宏树渲染参数：在基础树参数上附带各文件 display 状态。
 *
 * nm-style: keep-public — 导出函数签名类型；declaration 构建要求导出，脚本不统计签名内类型引用。
 */
export interface RenderWorkplaceFileTreeForMacroParams extends RenderWorkplaceFileTreeParams {
  readonly displayByPath: ReadonlyMap<string, DisplayState>;
}

type TreeEntry = { readonly kind: "dir" | "file"; readonly path: string };

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

function appendDirLines(lines: string[], dirPath: string, prefix: string, params: RenderWorkplaceFileTreeParams, displayByPath?: ReadonlyMap<string, DisplayState>): Result<void, AppError> {
  const dirRule = params.dirRuleMap.get(dirPath) ?? null;
  const childDirs = directChildDirs(dirPath, params.allDirs);
  if (!childDirs.ok) return Result.err(childDirs.error);
  const subdirs = sortDirPaths(childDirs.value, dirRule, { smartRules: params.smartRules, dirMtimeByPath: params.dirMtimeByPath }).map((path) => ({ kind: "dir" as const, path }));

  const resolvedDir = normalizePath(dirPath);
  if (!resolvedDir.ok) return Result.err(resolvedDir.error);
  const dirPrefix = resolvedDir.value === "/" ? "/" : `${resolvedDir.value}/`;
  const childFiles: string[] = [];
  for (const logicalPath of params.fileSet) {
    if (!logicalPath.startsWith(dirPrefix)) continue;
    const rel = resolvedDir.value === "/" ? logicalPath.slice(1) : logicalPath.slice(dirPrefix.length);
    if (rel.length === 0 || rel.includes("/")) continue;
    childFiles.push(logicalPath);
  }
  const fileMetas = childFiles.map((logicalPath): WorkplaceFileSortMeta => ({ logicalPath, mtimeMs: params.mtimeByPath.get(logicalPath) ?? 0 }));
  const files = sortFilesForDir(fileMetas, dirRule, { smartRules: params.smartRules }).map((file) => ({ kind: "file" as const, path: file.logicalPath }));

  const children: TreeEntry[] = [...subdirs, ...files];
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const child = children[i]!;
    // entryName 内联：normalizePath 失败沿返回值通道原样上交（决定权交给调用方）。
    const resolved = normalizePath(child.path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    let lineName: string;
    if (child.kind === "dir") {
      if (normalized === "/") lineName = "/";
      else {
        const idx = normalized.lastIndexOf("/");
        lineName = `${idx >= 0 ? normalized.slice(idx + 1) : normalized}/`;
      }
    } else {
      const idx = normalized.lastIndexOf("/");
      lineName = idx >= 0 ? normalized.slice(idx + 1) : normalized;
    }
    if (child.kind === "file" && displayByPath != null) {
      const state = displayByPath.get(child.path) ?? "filename";
      lineName += ` ${filetreeMacroLoadStateLabel(state)}`;
    }
    lines.push(`${prefix}${branch}${lineName}`);
    if (child.kind === "dir") {
      const nested = appendDirLines(lines, child.path, prefix + (isLast ? "    " : "│   "), params, displayByPath);
      if (!nested.ok) return Result.err(nested.error);
    }
  }
  return Result.ok(undefined);
}

/**
 * Renders a UTF-8 directory tree (dirs before files, same sort as workplace list).
 *
 * nm-style: keep-public — 仍在 public/workplace.ts 的包公开面；生产零调用（仅测试经 public 入口使用），
 * 撤销须同步 barrel/allowlist 快照/测试，跨文件死链清理不在本文件范围内。
 */
export function renderWorkplaceFileTree(params: RenderWorkplaceFileTreeParams): Result<string, AppError> {
  const rootPath = workplaceRootLogicalPath(params.scope);
  const rootLabel = workplaceFileTreeRootLabel(params.scope);
  const headerLine = rootLabel === "/" ? "/" : `${rootLabel}/`;
  const lines: string[] = [headerLine];
  const rendered = appendDirLines(lines, rootPath, "", params);
  if (!rendered.ok) return Result.err(rendered.error);
  return Result.ok(lines.join("\n"));
}

/**
 * 渲染带加载状态后缀的 workplace ASCII 树（`{{$filetree}}` 与工作区宏树）。
 *
 * nm-style: keep-local — 宏树 ASCII 渲染的 domain 入口；workplace.service 装配单点 + 3 处宏树测试直调，
 * 内联会把 header/appendDirLines/join 的树格式化摊进 service。
 */
export function renderWorkplaceFileTreeForMacro(params: RenderWorkplaceFileTreeForMacroParams): Result<string, AppError> {
  const rootPath = workplaceRootLogicalPath(params.scope);
  const rootLabel = workplaceFileTreeRootLabel(params.scope);
  const headerLine = rootLabel === "/" ? "/" : `${rootLabel}/`;
  const lines: string[] = [headerLine];
  const rendered = appendDirLines(lines, rootPath, "", params, params.displayByPath);
  if (!rendered.ok) return Result.err(rendered.error);
  return Result.ok(lines.join("\n"));
}
