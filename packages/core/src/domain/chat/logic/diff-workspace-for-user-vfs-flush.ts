/**
 * 对比 checkpoint 基准与当前工作区终态，产出 flush 净变更 diff。
 *
 * @module domain/chat/logic/diff-workspace-for-user-vfs-flush
 */

import type { WorkspaceFlushSnapshot } from "./workspace-flush-snapshot.js";

/** 单文件内容变更（baseline revision 正文 vs 当前 head 正文）。 */
export type WorkspaceFlushChangedFile = {
  readonly path: string;
  readonly baselineContent: string;
  readonly currentContent: string;
};

/** 新增文件（含当前正文，供合成 write XML）。 */
export type WorkspaceFlushAddedFile = {
  readonly path: string;
  readonly content: string;
};

/** flush 终态 diff 结果。 */
export type WorkspaceFlushDiff = {
  readonly deletedFiles: readonly string[];
  readonly addedFiles: readonly WorkspaceFlushAddedFile[];
  readonly changedFiles: readonly WorkspaceFlushChangedFile[];
  readonly addedDirs: readonly string[];
  readonly deletedDirs: readonly string[];
  readonly renames: ReadonlyArray<{ readonly from: string; readonly to: string }>;
};

/** diff 纯函数入参；正文由 service 层预先读取。 */
export type WorkspaceFlushDiffInput = {
  readonly baseline: WorkspaceFlushSnapshot;
  readonly current: WorkspaceFlushSnapshot;
  readonly baselineContentByPath: ReadonlyMap<string, string>;
  readonly currentContentByPath: ReadonlyMap<string, string>;
};

function hasFilesUnderDir(
  dir: string,
  fileTree: ReadonlyMap<string, number>,
): boolean {
  if (dir === "/") {
    return fileTree.size > 0;
  }
  const prefix = `${dir}/`;
  for (const path of fileTree.keys()) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * 删除集与新增集按正文完全相等做 1:1 rename 配对（稳定路径序）。
 */
function pairRenamesByEqualContent(
  deletedPaths: readonly string[],
  addedPaths: readonly string[],
  baselineContentByPath: ReadonlyMap<string, string>,
  currentContentByPath: ReadonlyMap<string, string>,
): {
  readonly renames: Array<{ from: string; to: string }>;
  readonly remainingDeleted: string[];
  readonly remainingAdded: string[];
} {
  const remainingDeleted = new Set(deletedPaths);
  const remainingAdded = new Set(addedPaths);
  const renames: Array<{ from: string; to: string }> = [];

  const sortedDeleted = [...deletedPaths].sort();
  for (const from of sortedDeleted) {
    if (!remainingDeleted.has(from)) {
      continue;
    }
    const content = baselineContentByPath.get(from);
    if (content == null) {
      continue;
    }
    const candidates = [...remainingAdded]
      .sort()
      .filter((to) => currentContentByPath.get(to) === content);
    if (candidates.length === 0) {
      continue;
    }
    const to = candidates[0]!;
    renames.push({ from, to });
    remainingDeleted.delete(from);
    remainingAdded.delete(to);
  }

  return {
    renames,
    remainingDeleted: [...remainingDeleted].sort(),
    remainingAdded: [...remainingAdded].sort(),
  };
}

/** 判断 diff 是否无任何净变更。 */
export function isWorkspaceFlushDiffEmpty(diff: WorkspaceFlushDiff): boolean {
  return (
    diff.deletedFiles.length === 0 &&
    diff.addedFiles.length === 0 &&
    diff.changedFiles.length === 0 &&
    diff.addedDirs.length === 0 &&
    diff.deletedDirs.length === 0 &&
    diff.renames.length === 0
  );
}

/**
 * 对比 baseline 与 current 快照，产出 flush 用净变更。
 *
 * @remarks 双方共有 path 且正文相等则跳过（含 edit 后改回）；rename 优先于 delete+write。
 */
export function diffWorkspaceForUserVfsFlush(
  input: WorkspaceFlushDiffInput,
): WorkspaceFlushDiff {
  const { baseline, current, baselineContentByPath, currentContentByPath } =
    input;

  const rawDeleted: string[] = [];
  const rawAdded: string[] = [];
  const changedFiles: WorkspaceFlushChangedFile[] = [];

  for (const path of baseline.fileTree.keys()) {
    if (!current.fileTree.has(path)) {
      rawDeleted.push(path);
    }
  }

  for (const path of current.fileTree.keys()) {
    if (!baseline.fileTree.has(path)) {
      rawAdded.push(path);
    }
  }

  for (const path of baseline.fileTree.keys()) {
    if (!current.fileTree.has(path)) {
      continue;
    }
    const baselineContent = baselineContentByPath.get(path) ?? "";
    const currentContent = currentContentByPath.get(path) ?? "";
    if (baselineContent !== currentContent) {
      changedFiles.push({
        path,
        baselineContent,
        currentContent,
      });
    }
  }

  const { renames, remainingDeleted, remainingAdded } = pairRenamesByEqualContent(
    rawDeleted,
    rawAdded,
    baselineContentByPath,
    currentContentByPath,
  );

  const addedFiles: WorkspaceFlushAddedFile[] = remainingAdded.map((path) => ({
    path,
    content: currentContentByPath.get(path) ?? "",
  }));

  const addedDirs = [...current.dirPaths]
    .filter((dir) => dir !== "/" && !baseline.dirPaths.has(dir))
    .sort();

  const deletedDirs = [...baseline.dirPaths]
    .filter((dir) => dir !== "/" && !current.dirPaths.has(dir))
    .filter((dir) => !hasFilesUnderDir(dir, current.fileTree))
    .sort();

  return {
    deletedFiles: remainingDeleted,
    addedFiles,
    changedFiles,
    addedDirs,
    deletedDirs,
    renames,
  };
}
