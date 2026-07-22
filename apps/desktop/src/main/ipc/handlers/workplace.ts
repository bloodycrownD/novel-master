/**
 * Workplace IPC handlers — buildListRows, directory/file rules.
 *
 * @module ipc/handlers/workplace
 */
import type {
  IpcResult,
  WorkplaceBuildListRowsRequest,
  WorkplaceCaptureSessionBlockRequest,
  WorkplaceGetDirRuleRequest,
  WorkplaceListRowDto,
  WorkplaceSetDirRuleRequest,
  WorkplaceSetFileRuleRequest,
} from "../../../../shared/ipc-types.js";
import { refreshRuleSnapshot } from "@novel-master/core/workplace";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  getWorkplaceForScope,
  resolveVfsScopeFromRequest,
} from "../resolve-vfs-scope.js";
import {
  notifyWorkspaceMutatedToRenderer,
  workspaceMutatedPayloadFromRequest,
} from "../forward-workspace-mutated.js";
import { formatIpcError } from "../format-ipc-error.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { notifyComposerStatusAfterSessionKkvCleared } from "../../services/notify-composer-status-after-kkv-clear.js";

function toIpcFillPolicy(
  fillPolicy: string | undefined,
): WorkplaceSetDirRuleRequest["fillPolicy"] {
  if (fillPolicy === "full") {
    return "hidden";
  }
  if (
    fillPolicy === "hidden" ||
    fillPolicy === "filename" ||
    fillPolicy === "header"
  ) {
    return fillPolicy;
  }
  return undefined;
}

async function loadWorkplaceRows(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  req: WorkplaceBuildListRowsRequest,
): Promise<WorkplaceListRowDto[]> {
  const scope = resolveVfsScopeFromRequest(req);
  if (scope.kind === "session") {
    const wt = getWorkplaceForScope(rt, scope);
    return wt.buildListRows();
  }
  const wt = getWorkplaceForScope(rt, scope);
  return wt.buildListRows();
}

/**
 * 规则保存后：evaluate→写 rule_snapshot canon→clear file_cache。
 * workplace 差集 suggest 已废止。
 */
async function refreshRuleSnapshotAfterRuleChange(
  rt: DesktopNovelMasterRuntime,
  req: { projectId?: string; sessionId?: string },
): Promise<void> {
  if (
    req.sessionId == null ||
    req.sessionId === "" ||
    req.projectId == null ||
    req.projectId === ""
  ) {
    return;
  }
  await refreshRuleSnapshot(req.sessionId, {
    sessionKkv: rt.sessionKkv,
    workplace: rt.workplace({
      kind: "session",
      projectId: req.projectId,
      sessionId: req.sessionId,
    }),
  });
}

export async function handleWorkplaceBuildListRows(
  req: WorkplaceBuildListRowsRequest,
): Promise<IpcResult<WorkplaceListRowDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rows = await loadWorkplaceRows(rt, req);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleWorkplaceSetDirRule(
  req: WorkplaceSetDirRuleRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const wt = getWorkplaceForScope(rt, scope);
    await wt.setDirRule({
      logicalPath: req.logicalPath,
      ruleEnabled: req.ruleEnabled,
      sortField: req.sortField,
      sortOrder: req.sortOrder,
      headCount: req.headCount,
      tailCount: req.tailCount,
      fillPolicy: req.fillPolicy,
    });
    notifyWorkspaceMutatedToRenderer(workspaceMutatedPayloadFromRequest(req));
    await refreshRuleSnapshotAfterRuleChange(rt, req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleWorkplaceSetFileRule(
  req: WorkplaceSetFileRuleRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const wt = getWorkplaceForScope(rt, scope);
    await wt.setFileRule({
      logicalPath: req.logicalPath,
      inclusionMode: req.inclusionMode,
    });
    notifyWorkspaceMutatedToRenderer(workspaceMutatedPayloadFromRequest(req));
    await refreshRuleSnapshotAfterRuleChange(rt, req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 已退役的「常驻工作区快照」IPC：改清空 session kkv，下次拼装重建常驻前缀。
 * UI 入口将在 Step 9 删除。
 */
export async function handleWorkplaceCaptureSessionBlock(
  req: WorkplaceCaptureSessionBlockRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.clearSession(req.sessionId);
    // 手动「重置常驻缓存」同清上条状态 chip
    await notifyComposerStatusAfterSessionKkvCleared(rt, req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleWorkplaceGetDirRule(
  req: WorkplaceGetDirRuleRequest,
): Promise<IpcResult<WorkplaceSetDirRuleRequest | null>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = resolveVfsScopeFromRequest(req);
    const wt = getWorkplaceForScope(rt, scope);
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
        fillPolicy: toIpcFillPolicy(rule.fillPolicy),
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
