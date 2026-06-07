import { DEFAULT_WORKTREE_DIR_RULE } from "@novel-master/core";
import type {
  VfsScopeRequest,
  WorktreeSetDirRuleRequest,
} from "../../../shared/ipc-types";
import {
  ipcVfsDelete,
  ipcVfsMkdir,
  ipcVfsRename,
  ipcVfsWrite,
  ipcWorktreeGetDirRule,
  ipcWorktreeSetDirRule,
  ipcWorktreeSetFileRule,
  vfsScope,
} from "../../ipc/client";
import { joinVfsPath } from "../../utils/vfs-path";
import { entryName } from "./vfs-tree-utils";
import type { WorkspaceContextTarget } from "./workspace-context";
import { parentPathForTarget } from "./workspace-context";

export function scopeRequestFromTarget(
  target: WorkspaceContextTarget,
  projectId?: string,
  sessionId?: string,
): VfsScopeRequest {
  return vfsScope(target.panelScope, projectId, sessionId);
}

export async function runDirectWorkspaceAction(
  target: WorkspaceContextTarget,
  action: string,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  if (target.kind !== "row") {
    return { ok: false, message: "无效操作" };
  }
  const row = target.row;

  if (action === "include-hide" && row.kind === "file") {
    const result = await ipcWorktreeSetFileRule({
      ...req,
      logicalPath: row.path,
      inclusionMode: "hide",
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  }
  if (action === "include-show" && row.kind === "file") {
    const result = await ipcWorktreeSetFileRule({
      ...req,
      logicalPath: row.path,
      inclusionMode: "show",
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  }
  if (action === "include-follow" && row.kind === "file") {
    const result = await ipcWorktreeSetFileRule({
      ...req,
      logicalPath: row.path,
      inclusionMode: "auto",
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  }
  if (action === "rule-config" && row.kind === "dir") {
    return { ok: false, message: "请使用规则配置对话框" };
  }
  return { ok: false, message: "未知操作" };
}

export async function createWorkspaceEntry(
  target: WorkspaceContextTarget,
  kind: "file" | "folder",
  name: string,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const path = joinVfsPath(parentPathForTarget(target), name);
  if (kind === "file") {
    const result = await ipcVfsWrite({ ...req, path, content: "" });
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  }
  const result = await ipcVfsMkdir({ ...req, path });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

export async function renameWorkspaceEntry(
  target: WorkspaceContextTarget,
  newName: string,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (target.kind !== "row") {
    return { ok: false, message: "无效操作" };
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const row = target.row;
  const parent =
    row.path === "/"
      ? ""
      : row.path.slice(0, row.path.lastIndexOf("/")) || "";
  const newPath = `${parent}/${newName.trim()}`.replace(/\/+/g, "/");
  const result = await ipcVfsRename({ ...req, oldPath: row.path, newPath });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

export async function deleteWorkspaceEntry(
  target: WorkspaceContextTarget,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (target.kind !== "row") {
    return { ok: false, message: "无效操作" };
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const result = await ipcVfsDelete({
    ...req,
    path: target.row.path,
    recursive: true,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

export function defaultDirRuleRequest(
  logicalPath: string,
  scope: VfsScopeRequest,
): WorktreeSetDirRuleRequest {
  return {
    ...scope,
    logicalPath,
    sortField: DEFAULT_WORKTREE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKTREE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKTREE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKTREE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKTREE_DIR_RULE.fillPolicy,
    ruleEnabled: true,
  };
}

export async function loadDirRuleForm(
  target: WorkspaceContextTarget,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<WorktreeSetDirRuleRequest | null> {
  if (target.kind !== "row" || target.row.kind !== "dir") {
    return null;
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const result = await ipcWorktreeGetDirRule({
    ...req,
    logicalPath: target.row.path,
  });
  if (result.ok && result.data) {
    return {
      ...req,
      logicalPath: target.row.path,
      ruleEnabled: result.data.ruleEnabled,
      sortField: result.data.sortField,
      sortOrder: result.data.sortOrder,
      headCount: result.data.headCount,
      tailCount: result.data.tailCount,
      fillPolicy: result.data.fillPolicy,
    };
  }
  return defaultDirRuleRequest(target.row.path, req);
}

export async function saveDirRule(
  input: WorktreeSetDirRuleRequest,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await ipcWorktreeSetDirRule(input);
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

export async function setDirRuleEnabled(
  target: WorkspaceContextTarget,
  enabled: boolean,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (target.kind !== "row" || target.row.kind !== "dir") {
    return { ok: false, message: "无效操作" };
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const result = await ipcWorktreeSetDirRule({
    ...req,
    logicalPath: target.row.path,
    ruleEnabled: enabled,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

export function entryLabelForTarget(target: WorkspaceContextTarget): string {
  if (target.kind === "blank") {
    return "条目";
  }
  return entryName(target.row.path);
}
