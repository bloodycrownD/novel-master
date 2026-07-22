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
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  getWorkplaceForScope,
  resolveVfsScopeFromRequest,
} from "../resolve-vfs-scope.js";
import {
  notifyWorkspaceMutatedToRenderer,
  workspaceMutatedPayloadFromRequest,
} from "../forward-workspace-mutated.js";
import { notifyComposerAttachmentsSuggestToRenderer } from "../forward-composer-attachments-suggest.js";
import { formatIpcError } from "../format-ipc-error.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { notifyComposerStatusAfterSessionKkvCleared } from "../../services/notify-composer-status-after-kkv-clear.js";
import { projectComposerStatusForSession } from "../../services/project-composer-status.service.js";

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
 * 规则保存后：投影 Composer 状态条（仅 user_ops）整表替换。
 * 不刷新规则快照、不 capture。
 * （workplace 差集 chip 已废止；Step 3 再改 refreshRuleSnapshot / 删 suggest。）
 */
async function suggestWorkplaceAttachmentsAfterRuleChange(
  rt: DesktopNovelMasterRuntime,
  sessionId: string | undefined,
): Promise<void> {
  if (sessionId == null || sessionId === "") {
    return;
  }
  const attachments = await projectComposerStatusForSession(rt, sessionId);
  notifyComposerAttachmentsSuggestToRenderer({ sessionId, attachments });
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
    // 规则变更不写 capture；不刷新规则快照；workplace 草稿见 composerAttachmentsSuggest
    notifyWorkspaceMutatedToRenderer(workspaceMutatedPayloadFromRequest(req));
    await suggestWorkplaceAttachmentsAfterRuleChange(rt, req.sessionId);
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
    await suggestWorkplaceAttachmentsAfterRuleChange(rt, req.sessionId);
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
