import { DEFAULT_WORKPLACE_DIR_RULE } from "@shared/logic/workplace";
import {
  formatVfsErrorForUser,
  validateVfsEntryName,
} from "@shared/logic/vfs";
import type {
  VfsBatchApplyReportDto,
  VfsScopeRequest,
  WorkplaceSetDirRuleRequest,
} from "@shared/ipc-types";
import {
  ipcVfsBatchIngestFromPaths,
  ipcVfsDelete,
  ipcVfsFileExport,
  ipcVfsFilePick,
  ipcVfsMkdir,
  ipcVfsRename,
  ipcVfsWrite,
  ipcVfsZipExport,
  ipcWorkplaceGetDirRule,
  ipcWorkplaceSetDirRule,
  ipcWorkplaceSetFileRule,
  vfsScope,
} from "@/ipc/client";
import { joinVfsPath } from "@/utils/vfs-path";
import { entryName } from "./vfs-tree-utils";
import type { WorkspaceContextTarget } from "./workspace-context";
import {
  exportFilePathForTarget,
  parentPathForTarget,
  zipDirectoryPathForTarget,
} from "./workspace-context";

/**
 * VFS 动作失败时把 IPC payload（{code,message}）转成终端用户可见的中文文案；
 * main 侧只透传 VfsError 原文（英文），直接弹给用户看不懂。
 * 文案映射（含 ALREADY_EXISTS「名称不能重复」）统一由 core
 * formatVfsErrorForUser 的 code 文案表提供。
 */
function vfsActionErrorMessage(error: {
  readonly code: string;
  readonly message: string;
}): string {
  return formatVfsErrorForUser(error);
}

export function scopeRequestFromTarget(
  target: WorkspaceContextTarget,
  projectId?: string,
  sessionId?: string,
): VfsScopeRequest {
  return vfsScope(target.panelScope, projectId, sessionId);
}

export async function saveFileInclusion(
  target: WorkspaceContextTarget,
  inclusionMode: "auto" | "show" | "hide",
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (target.kind !== "row" || target.row.kind !== "file") {
    return { ok: false, message: "无效操作" };
  }
  const result = await ipcWorkplaceSetFileRule({
    ...scopeRequestFromTarget(target, projectId, sessionId),
    logicalPath: target.row.path,
    inclusionMode,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

export async function createWorkspaceEntry(
  target: WorkspaceContextTarget,
  kind: "file" | "folder",
  name: string,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // 与 core 服务层同规则的前置校验（控制字符/纯空白/首尾空格/./..），
  // 不合法时直接返回中文 reason，不发 IPC；main 进程侧仍会兕底拦。
  const nameCheck = validateVfsEntryName(name);
  if (!nameCheck.ok) {
    return { ok: false, message: nameCheck.reason };
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const path = joinVfsPath(parentPathForTarget(target), name);
  if (kind === "file") {
    const result = await ipcVfsWrite({ ...req, path, content: "" });
    return result.ok
      ? { ok: true }
      : { ok: false, message: vfsActionErrorMessage(result.error) };
  }
  const mkdirResult = await ipcVfsMkdir({ ...req, path });
  if (!mkdirResult.ok) {
    return { ok: false, message: vfsActionErrorMessage(mkdirResult.error) };
  }
  // 规则写入是 workplace 动作而非 VFS 动作，失败文案保持原文透出
  const ruleResult = await ipcWorkplaceSetDirRule(defaultDirRuleRequest(path, req));
  return ruleResult.ok
    ? { ok: true }
    : { ok: false, message: ruleResult.error.message };
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
  const nameCheck = validateVfsEntryName(newName);
  if (!nameCheck.ok) {
    return { ok: false, message: nameCheck.reason };
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const row = target.row;
  const parent =
    row.path === "/"
      ? ""
      : row.path.slice(0, row.path.lastIndexOf("/")) || "";
  const newPath = `${parent}/${newName.trim()}`.replace(/\/+/g, "/");
  const result = await ipcVfsRename({ ...req, oldPath: row.path, newPath });
  return result.ok
    ? { ok: true }
    : { ok: false, message: vfsActionErrorMessage(result.error) };
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
  return result.ok
    ? { ok: true }
    : { ok: false, message: vfsActionErrorMessage(result.error) };
}

/** 新建目录时持久化的默认规则（规则启用）。 */
export function defaultDirRuleRequest(
  logicalPath: string,
  scope: VfsScopeRequest,
): WorkplaceSetDirRuleRequest {
  return {
    ...scope,
    logicalPath,
    sortField: DEFAULT_WORKPLACE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKPLACE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKPLACE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    ruleEnabled: true,
  };
}

/**
 * 无持久化规则记录时弹窗展示的表单初值（规则关闭，其余字段同 Core 默认）。
 */
export function emptyDirRuleForm(
  logicalPath: string,
  scope: VfsScopeRequest,
): WorkplaceSetDirRuleRequest {
  return {
    ...scope,
    logicalPath,
    sortField: DEFAULT_WORKPLACE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKPLACE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKPLACE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    ruleEnabled: false,
  };
}

export async function loadDirRuleForm(
  target: WorkspaceContextTarget,
  projectId: string | undefined,
  sessionId: string | undefined,
): Promise<WorkplaceSetDirRuleRequest | null> {
  if (target.kind !== "row" || target.row.kind !== "dir") {
    return null;
  }
  const req = scopeRequestFromTarget(target, projectId, sessionId);
  const result = await ipcWorkplaceGetDirRule({
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
  return emptyDirRuleForm(target.row.path, req);
}

export async function saveDirRule(
  input: WorkplaceSetDirRuleRequest,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await ipcWorkplaceSetDirRule(input);
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
  const result = await ipcWorkplaceSetDirRule({
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

/**
 * 单文件导入的「已应用」结果。
 *
 * 在 spec 钉死的 `{status:'applied'; report}` 之外**多带一个** `skippedBinary`：
 * D6 要求非 UTF-8 被跳过的数量必须明示给用户，而跳过信息只在这一层能看到
 * （main 侧把非 UTF-8 判掉后不会写库，回不上 VFS）。多带字段对只读
 * `status`/`report` 的消费方无影响，Step 3 的 App 接线直接拿它出 toast。
 */
export type SingleFileImportApplied = {
  readonly status: "applied";
  readonly report: VfsBatchApplyReportDto;
  readonly skippedBinary: readonly string[];
};

/**
 * 单文件导入首段：弹框选文件 → 走既有批量 ingest 通道（**未**确认覆盖）。
 *
 * 刻意复用 `VFS_BATCH_INGEST_FROM_PATHS` 而非新开一条端到端通道：覆盖确认必须能
 * 在**不重弹文件选择框**的前提下再提交一次，这是两段式协议的全部价值（needs_confirm
 * DTO / apply report / skippedBinary toast / pushWorkspaceMutated 全部零改动复用）。
 *
 * IPC 失败一律抛出（错误文案由 main 侧给出）：本模块是纯编排，toast 归 Step 3 的
 * App 接线，不在这里做 UI。
 */
export async function startSingleFileImport(
  scope: VfsScopeRequest,
  targetDir: string,
): Promise<
  | { readonly status: "cancelled" }
  | {
      readonly status: "needs-confirm";
      readonly hostPaths: string[];
      readonly conflictCount: number;
    }
  | SingleFileImportApplied
> {
  const picked = await ipcVfsFilePick();
  if (!picked.ok) {
    throw new Error(picked.error.message || "选择文件失败");
  }
  const hostPath = picked.data;
  if (hostPath == null) {
    return { status: "cancelled" };
  }

  const result = await ipcVfsBatchIngestFromPaths({
    ...scope,
    targetDir,
    hostPaths: [hostPath],
    overwriteConfirmed: false,
  });
  if (!result.ok) {
    throw new Error(result.error.message || "导入失败");
  }
  if (result.data.status === "needs_confirm") {
    return {
      status: "needs-confirm",
      hostPaths: [hostPath],
      conflictCount: result.data.conflicts.length,
    };
  }
  return {
    status: "applied",
    report: result.data.report,
    skippedBinary: result.data.skippedBinary,
  };
}

/** 单文件导入次段：同一通道二次提交（`overwriteConfirmed: true`）。 */
export async function confirmSingleFileImport(
  scope: VfsScopeRequest,
  targetDir: string,
  hostPaths: string[],
): Promise<SingleFileImportApplied> {
  const result = await ipcVfsBatchIngestFromPaths({
    ...scope,
    targetDir,
    hostPaths,
    overwriteConfirmed: true,
  });
  if (!result.ok) {
    throw new Error(result.error.message || "导入失败");
  }
  if (result.data.status !== "applied") {
    // 已确认覆盖后 core 仍报 needs_confirm 属协议破损；宁可显式失败也不静默当成功。
    throw new Error("导入未完成");
  }
  return {
    status: "applied",
    report: result.data.report,
    skippedBinary: result.data.skippedBinary,
  };
}

/**
 * 菜单侧「导出」分派：文件行走单文件另存（无确认，类型直达），目录 / 空白行走既有
 * ZIP 导出（子树语义）。
 *
 * 分流直接复用 `exportFilePathForTarget`（非 null 即文件行）——两个 helper 互为镜像
 * 各管一半（`zipDirectoryPathForTarget` 管 ZIP 侧），不再在本函数里重写一遍
 * row/file 判定，否则两处各写一遍迟早漂移。ZIP 侧的目录取法仍复用
 * `zipDirectoryPathForTarget`（blank → `/`、dir → 其 path），该 helper 对文件行返回
 * null 而文件行已在上面分流，故 `?? "/"` 只是防御。
 */
export async function exportWorkspaceTarget(
  scope: VfsScopeRequest,
  target: WorkspaceContextTarget,
): Promise<"saved" | "cancelled"> {
  const logicalPath = exportFilePathForTarget(target);
  if (logicalPath != null) {
    const single = await ipcVfsFileExport({
      ...scope,
      logicalPath,
    });
    if (!single.ok) {
      throw new Error(single.error.message || "导出失败");
    }
    return single.data;
  }

  const directoryPath = zipDirectoryPathForTarget(target) ?? "/";
  const zip = await ipcVfsZipExport({ ...scope, directoryPath });
  if (!zip.ok) {
    throw new Error(zip.error.message || "导出失败");
  }
  return zip.data;
}
