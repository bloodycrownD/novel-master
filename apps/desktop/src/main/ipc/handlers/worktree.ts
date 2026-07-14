/**
 * Worktree IPC handlers — buildListRows, directory/file rules.
 *
 * @module ipc/handlers/worktree
 */
import type {
  IpcResult,
  WorktreeBuildListRowsRequest,
  WorktreeCaptureSessionBlockRequest,
  WorktreeGetDirRuleRequest,
  WorktreeListRowDto,
  WorktreeSetDirRuleRequest,
  WorktreeSetFileRuleRequest,
} from "../../../../shared/ipc-types.js";
import {
  ruleViewToSnapshotEntries,
  workplaceAttachmentsFromRuleDelta,
  type WorktreeService,
} from "@novel-master/core/worktree";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "@novel-master/core/session-kkv";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  getWorktreeForScope,
  resolveVfsScopeFromRequest,
} from "../resolve-vfs-scope.js";
import {
  notifyWorkspaceMutatedToRenderer,
  workspaceMutatedPayloadFromRequest,
} from "../forward-workspace-mutated.js";
import { notifyComposerAttachmentsSuggestToRenderer } from "../forward-composer-attachments-suggest.js";
import { formatIpcError } from "../format-ipc-error.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";

function toIpcFillPolicy(
  fillPolicy: string | undefined,
): WorktreeSetDirRuleRequest["fillPolicy"] {
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

async function loadWorktreeRows(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  req: WorktreeBuildListRowsRequest,
): Promise<WorktreeListRowDto[]> {
  const scope = resolveVfsScopeFromRequest(req);
  if (scope.kind === "session") {
    const wt = getWorktreeForScope(rt, scope);
    return wt.buildListRows();
  }
  const wt = getWorktreeForScope(rt, scope);
  return wt.buildListRows();
}

/**
 * 规则保存后：实时规则 vs file_cache → Composer workplace 建议。
 * 不刷新规则快照、不 capture。
 */
async function suggestWorkplaceAttachmentsAfterRuleChange(
  rt: DesktopNovelMasterRuntime,
  wt: WorktreeService,
  sessionId: string | undefined,
): Promise<void> {
  if (sessionId == null || sessionId === "") {
    return;
  }
  const view = await wt.evaluateRuleView();
  const live = ruleViewToSnapshotEntries(view);
  const cacheKeys = await rt.sessionKkv.listKeys(
    sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
  );
  const attachments = workplaceAttachmentsFromRuleDelta(live, cacheKeys);
  notifyComposerAttachmentsSuggestToRenderer({ sessionId, attachments });
}

export async function handleWorktreeBuildListRows(
  req: WorktreeBuildListRowsRequest,
): Promise<IpcResult<WorktreeListRowDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rows = await loadWorktreeRows(rt, req);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
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
    // 规则变更不写 capture；不刷新规则快照；workplace 草稿见 composerAttachmentsSuggest
    notifyWorkspaceMutatedToRenderer(workspaceMutatedPayloadFromRequest(req));
    await suggestWorkplaceAttachmentsAfterRuleChange(rt, wt, req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
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
    notifyWorkspaceMutatedToRenderer(workspaceMutatedPayloadFromRequest(req));
    await suggestWorkplaceAttachmentsAfterRuleChange(rt, wt, req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 已退役的「工作树快照」IPC：改清空 session kkv，下次拼装重建常驻前缀。
 * UI 入口将在 Step 9 删除。
 */
export async function handleWorktreeCaptureSessionBlock(
  req: WorktreeCaptureSessionBlockRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.clearSession(req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
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
        fillPolicy: toIpcFillPolicy(rule.fillPolicy),
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
