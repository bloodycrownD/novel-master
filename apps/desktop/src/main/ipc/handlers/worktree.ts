/**
 * Worktree IPC handlers — buildListRows, directory/file rules.
 *
 * @module ipc/handlers/worktree
 */
import type {
  IpcResult,
  WorktreeBuildListRowsRequest,
  WorktreeGetDirRuleRequest,
  WorktreeListRowDto,
  WorktreeSetDirRuleRequest,
  WorktreeSetFileRuleRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  getWorktreeForScope,
  invalidateSessionMacroCache,
  resolveVfsScopeFromRequest,
} from "../resolve-vfs-scope.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

async function loadWorktreeRows(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  req: WorktreeBuildListRowsRequest,
): Promise<WorktreeListRowDto[]> {
  const scope = resolveVfsScopeFromRequest(req);
  if (scope.kind === "session") {
    const cached = rt.macroCache.get(scope.projectId, scope.sessionId);
    if (cached != null && Array.isArray(cached.listRows)) {
      return [...cached.listRows];
    }
    const wt = getWorktreeForScope(rt, scope);
    const snap = await rt.macroCache.refresh(
      scope.projectId,
      scope.sessionId,
      () => wt.materialize(),
    );
    return [...snap.listRows];
  }
  const wt = getWorktreeForScope(rt, scope);
  return wt.buildListRows();
}

export async function handleWorktreeBuildListRows(
  req: WorktreeBuildListRowsRequest,
): Promise<IpcResult<WorktreeListRowDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rows = await loadWorktreeRows(rt, req);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleWorktreeSetDirRule(
  req: WorktreeSetDirRuleRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const wt = getWorktreeForScope(rt, scope);
    await wt.setDirRule({
      logicalPath: req.logicalPath,
      ruleEnabled: req.ruleEnabled,
      sortField: req.sortField,
      sortOrder: req.sortOrder,
      headCount: req.headCount,
      tailCount: req.tailCount,
      fillPolicy: req.fillPolicy,
    });
    invalidateSessionMacroCache(rt, scope);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleWorktreeSetFileRule(
  req: WorktreeSetFileRuleRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const wt = getWorktreeForScope(rt, scope);
    await wt.setFileRule({
      logicalPath: req.logicalPath,
      inclusionMode: req.inclusionMode,
    });
    invalidateSessionMacroCache(rt, scope);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleWorktreeGetDirRule(
  req: WorktreeGetDirRuleRequest,
): Promise<IpcResult<WorktreeSetDirRuleRequest | null>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const wt = getWorktreeForScope(rt, scope);
    const rule = await wt.getDirRule(req.logicalPath);
    if (rule == null) {
      return { ok: true, data: null };
    }
    return {
      ok: true,
      data: {
        workspaceScope: req.workspaceScope,
        projectId: req.projectId,
        sessionId: req.sessionId,
        logicalPath: rule.logicalPath,
        ruleEnabled: rule.ruleEnabled,
        sortField: rule.sortField,
        sortOrder: rule.sortOrder,
        headCount: rule.headCount,
        tailCount: rule.tailCount,
        fillPolicy: rule.fillPolicy,
      },
    };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
