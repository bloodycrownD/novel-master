/**
 * Workplace IPC handlers — buildListRows, directory/file rules.
 *
 * @module ipc/handlers/workplace
 */
import type {
  IpcResult,
  WorkplaceBuildListRowsRequest,
  WorkplaceGetDirRuleRequest,
  WorkplaceListRowDto,
  WorkplaceSetDirRuleRequest,
  WorkplaceSetFileRuleRequest,
} from "../../../../shared/ipc-types.js";
import { refreshRuleSnapshot } from "@novel-master/core/workplace";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { getWorkplaceForScope, resolveVfsScopeFromRequest } from "../resolve-vfs-scope.js";
import { WorkspaceMutatedForwarder } from "../forward-workspace-mutated.js";
import { formatIpcError } from "../format-ipc-error.js";
import { ipcErr } from "../ipc-result.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";

/**
 * 规则保存后：evaluate→写 rule_snapshot canon→clear file_cache。
 * workplace 差集 suggest 已废止。
 */
async function refreshRuleSnapshotAfterRuleChange(rt: DesktopNovelMasterRuntime, req: { projectId?: string; sessionId?: string }): Promise<void> {
  if (req.sessionId == null || req.sessionId === "" || req.projectId == null || req.projectId === "") {
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

export async function handleWorkplaceBuildListRows(req: WorkplaceBuildListRowsRequest): Promise<IpcResult<WorkplaceListRowDto[]>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const scopeRes = resolveVfsScopeFromRequest(req);
    if (!scopeRes.ok) return scopeRes;
    const wt = getWorkplaceForScope(rt, scopeRes.data);
    const rows = await wt.buildListRows();
    if (!rows.ok) return ipcErr(formatIpcError(rows.error));
    return { ok: true, data: rows.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleWorkplaceSetDirRule(req: WorkplaceSetDirRuleRequest): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const scopeRes = resolveVfsScopeFromRequest(req);
    if (!scopeRes.ok) return scopeRes;
    const scope = scopeRes.data;
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
    WorkspaceMutatedForwarder.notify(WorkspaceMutatedForwarder.payloadFromRequest(req));
    await refreshRuleSnapshotAfterRuleChange(rt, req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleWorkplaceSetFileRule(req: WorkplaceSetFileRuleRequest): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const scopeRes = resolveVfsScopeFromRequest(req);
    if (!scopeRes.ok) return scopeRes;
    const scope = scopeRes.data;
    const wt = getWorkplaceForScope(rt, scope);
    await wt.setFileRule({
      logicalPath: req.logicalPath,
      inclusionMode: req.inclusionMode,
    });
    WorkspaceMutatedForwarder.notify(WorkspaceMutatedForwarder.payloadFromRequest(req));
    await refreshRuleSnapshotAfterRuleChange(rt, req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleWorkplaceGetDirRule(req: WorkplaceGetDirRuleRequest): Promise<IpcResult<WorkplaceSetDirRuleRequest | null>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const scopeRes = resolveVfsScopeFromRequest(req);
    if (!scopeRes.ok) return scopeRes;
    const scope = scopeRes.data;
    const wt = getWorkplaceForScope(rt, scope);
    const rule = await wt.getDirRule(req.logicalPath);
    if (!rule.ok) return ipcErr(formatIpcError(rule.error));
    if (rule.value == null) {
      return { ok: true, data: null };
    }
    const rawFillPolicy = rule.value.fillPolicy;
    let fillPolicy: WorkplaceSetDirRuleRequest["fillPolicy"];
    if (rawFillPolicy === "full") {
      fillPolicy = "hidden";
    } else if (rawFillPolicy === "hidden" || rawFillPolicy === "filename" || rawFillPolicy === "header") {
      fillPolicy = rawFillPolicy;
    }
    return {
      ok: true,
      data: {
        workspaceScope: req.workspaceScope,
        projectId: req.projectId,
        sessionId: req.sessionId,
        logicalPath: rule.value.logicalPath,
        ruleEnabled: rule.value.ruleEnabled,
        sortField: rule.value.sortField,
        sortOrder: rule.value.sortOrder,
        headCount: rule.value.headCount,
        tailCount: rule.value.tailCount,
        fillPolicy,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
