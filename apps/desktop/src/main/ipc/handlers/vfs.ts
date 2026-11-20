/**
 * VFS IPC handlers — list/read/write/mkdir/delete/rename for global/project/session scopes.
 *
 * @module ipc/handlers/vfs
 */
import type {
  IpcResult,
  VfsBatchClearStagingRequest,
  VfsBatchExportStageRequest,
  VfsBatchExportStageResult,
  VfsBatchIngestFromPathsRequest,
  VfsBatchIngestFromPathsResult,
  VfsDeleteRequest,
  VfsMkdirRequest,
  VfsReadRequest,
  VfsReadResultDto,
  VfsRenameRequest,
  VfsScopeRequest,
  VfsWriteRequest,
  VfsCharacterCardImportRequest,
  VfsCharacterCardImportResult,
  VfsFileExportRequest,
  VfsFileExportResult,
  VfsFilePickResult,
  VfsZipExportResult,
  VfsZipImportResult,
  VfsZipPickResult,
  VfsZipBytesImportRequest,
  VfsZipRequest,
} from "../../../../shared/ipc-types.js";
import { userVfsUnifiedToolTurnFlag } from "@novel-master/core/feature-flags";
import { AppError, AppErrorOps, Result } from "@novel-master/core/errors";

import {
  VfsServiceFactory,
  VfsZipArchive,
  VfsZipPath,
  UserVfsSaveBaseline,
  UserVfsTurnOps,
  type BatchApplyReport,
  type BatchIngestRawEntry,
  type BatchIngestWriter,
} from "@novel-master/core/vfs";
import { BrowserWindow, dialog } from "electron";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { VfsEntryOps, VfsMove } from "../../services/vfs-operations.service.js";
import {
  UserVfsTurnExecuteService,
  LogicalPath,
} from "../../services/user-vfs-turn-execute.service.js";
import { VfsBatchService } from "../../services/vfs-batch.service.js";
import { VfsCharacterCardService } from "../../services/vfs-character-card.service.js";
import { VfsZipService } from "../../services/vfs-zip.service.js";
import { ResolveVfsScope } from "../resolve-vfs-scope.js";
import { WorkspaceMutatedForwarder } from "../forward-workspace-mutated.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { LogFactory } from "@novel-master/core/log";
import { coreT } from "../../../../shared/logic/core-i18n.js";

const log = LogFactory.create("desktop.ipc.vfs");

/** 根目录导出的备用名：项目已删除或域无 projectId 时使用（原 vfs-zip.service 内联携带）。 */
const WORKSPACE_FALLBACK_ZIP_NAME = "workspace.zip";

/** 批量导入（两段式 plan/apply + needs_confirm 协议）的结果形态（原 vfs-batch.service 内联携带）。 */
type BatchIngestFromPathsOutcome =
  | {
      readonly status: "needs_confirm";
      readonly conflicts: ReadonlyArray<{
        readonly logicalPath: string;
        readonly reason: "exists";
      }>;
      readonly skippedBinary: readonly string[];
    }
  | {
      readonly status: "applied";
      readonly report: BatchApplyReport;
      readonly skippedBinary: readonly string[];
    };

export namespace Vfs {
  /**
   * `executeSessionUserVfsOp` 的错误侧是 `unknown`（user-vfs-turn port 的异构
   * 形态），writer 端口契约是 `Result<void, AppError>`——在此归一：AppError 原样
   * 透传，其余包 INFRA_UNEXPECTED_ERROR（与 formatIpcError 的未知分支同款）。
   */
  function toWriterResult(r: Result<void, unknown>): Result<void, AppError> {
    if (r.ok) return Result.ok(undefined);
    return Result.err(AppErrorOps.is(r.error) ? r.error : new AppError("INFRA_UNEXPECTED_ERROR", { detail: r.error instanceof Error ? r.error.message : String(r.error) }, { cause: r.error }));
  }

  function focusedWindow(): BrowserWindow | undefined {
    return BrowserWindow.getFocusedWindow() ?? undefined;
  }

  /** VFS 变更成功后通知 renderer 刷新 Explorer（消费方 ①）。 */
  function pushWorkspaceMutated(req: VfsScopeRequest): void {
    WorkspaceMutatedForwarder.notify(WorkspaceMutatedForwarder.payloadFromRequest(req));
  }

  /**
   * rename 前探测旧路径条目类型：目录重命名后要同步迁移 workplace 规则，
   * 而规则迁移与否取决于旧路径是目录还是文件，必须在 rename 真正执行前判定
   * （执行后旧路径条目已消失，parent list 里查不到）。
   */
  async function findEntryKindBeforeRename(vfs: Awaited<ReturnType<typeof ResolveVfsScope.getVfsForScope>>, oldPath: string): Promise<Result<"directory" | "file" | undefined, AppError>> {
    // 逻辑路径的父目录（顶层条目归一返回 `/`）。
    const idx = oldPath.lastIndexOf("/");
    const parentPath = idx > 0 ? oldPath.slice(0, idx) : "/";
    const siblings = await vfs.list(parentPath);
    // 已知失败沿 Result 上行（错误通道迁移四期），调用方 Vfs.rename 转码。
    if (!siblings.ok) return Result.err(siblings.error);
    return Result.ok(siblings.value.find((e) => e.path === oldPath)?.kind);
  }

  export async function read(req: VfsReadRequest): Promise<IpcResult<VfsReadResultDto>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      const vfs = ResolveVfsScope.getVfsForScope(rt, scope);
      const result = await vfs.read(req.path);
      if (!result.ok) return IpcResults.err(FormatIpcError.format(result.error));
      return {
        ok: true,
        data: {
          content: result.value.content,
          version: result.value.version,
          mtimeMs: result.value.mtimeMs,
        },
      };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function write(req: VfsWriteRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      const vfs = ResolveVfsScope.getVfsForScope(rt, scope);

      if (
        LogicalPath.isSessionVfsScope(scope) &&
        userVfsUnifiedToolTurnFlag.isEnabled()
      ) {
        const baselineRes = await UserVfsSaveBaseline.read(vfs, req.path);
        if (!baselineRes.ok) return IpcResults.err(FormatIpcError.format(baselineRes.error));
        const baseline = baselineRes.value;
        if (
          req.lastKnownContent != null &&
          baseline != null &&
          req.lastKnownContent !== baseline
        ) {
          log.info("user-vfs-turn external_drift_detected", { path: req.path });
        }
        const op = UserVfsTurnOps.buildSave(baseline, req.content, req.path, req.content);
        if (op != null) {
          const exec = await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, op);
          if (!exec.ok) return IpcResults.err(FormatIpcError.format(exec.error));
        }
        pushWorkspaceMutated(req);
        return { ok: true, data: undefined };
      }

      await vfs.write(req.path, req.content);
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function mkdir(req: VfsMkdirRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;

      if (
        LogicalPath.isSessionVfsScope(scope) &&
        userVfsUnifiedToolTurnFlag.isEnabled()
      ) {
        const exec = await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, UserVfsTurnOps.buildMkdir(req.path));
        if (!exec.ok) return IpcResults.err(FormatIpcError.format(exec.error));
        pushWorkspaceMutated(req);
        return { ok: true, data: undefined };
      }

      const vfs = ResolveVfsScope.getVfsForScope(rt, scope);
      await vfs.mkdir(req.path);
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function remove(req: VfsDeleteRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      const recursive = req.recursive ?? true;

      if (
        LogicalPath.isSessionVfsScope(scope) &&
        userVfsUnifiedToolTurnFlag.isEnabled()
      ) {
        const exec = await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, UserVfsTurnOps.buildDelete(req.path, recursive));
        if (!exec.ok) return IpcResults.err(FormatIpcError.format(exec.error));
      } else {
        const vfs = ResolveVfsScope.getVfsForScope(rt, scope);
        await VfsEntryOps.deleteEntry(vfs, req.path, { recursive });
      }

      const wt = ResolveVfsScope.getWorkplaceForScope(rt, scope);
      await wt.deleteRulesUnderLogicalPrefix(req.path);

      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function rename(req: VfsRenameRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;

      if (
        LogicalPath.isSessionVfsScope(scope) &&
        userVfsUnifiedToolTurnFlag.isEnabled()
      ) {
        // kind 必须在 execute 之前判定：execute 后旧路径已消失，parent list 查不到。
        const kindRes = await findEntryKindBeforeRename(ResolveVfsScope.getVfsForScope(rt, scope), req.oldPath);
        if (!kindRes.ok) return IpcResults.err(FormatIpcError.format(kindRes.error));
        const exec = await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, UserVfsTurnOps.buildRename(req.oldPath, req.newPath));
        if (!exec.ok) return IpcResults.err(FormatIpcError.format(exec.error));
        // 目录 rename 后迁移 workplace 规则（对齐 mobile 的 migrateWorkplaceDirRename
        // 口径）；文件不迁移规则，与 mobile 一致。
        if (kindRes.value === "directory") {
          await ResolveVfsScope.getWorkplaceForScope(rt, scope).renameRulesUnderLogicalPrefix(req.oldPath, req.newPath);
        }
        pushWorkspaceMutated(req);
        return { ok: true, data: undefined };
      }

      const vfs = ResolveVfsScope.getVfsForScope(rt, scope);
      const kindRes = await findEntryKindBeforeRename(vfs, req.oldPath);
      if (!kindRes.ok) return IpcResults.err(FormatIpcError.format(kindRes.error));
      const kind = kindRes.value;
      if (kind === "directory") {
        const movedDir = await VfsMove.move(vfs, req.oldPath, req.newPath);
        if (!movedDir.ok) return IpcResults.err(FormatIpcError.format(movedDir.error));
        // 目录 rename 后迁移 workplace 规则（排布对齐 Vfs.remove 的规则
        // 清理）：不迁移的话残留规则会把旧路径整链渲染成幽灵目录，对它再操作
        // 报 NOT_FOUND。
        await ResolveVfsScope.getWorkplaceForScope(rt, scope).renameRulesUnderLogicalPrefix(req.oldPath, req.newPath);
      } else {
        const movedFile = await VfsMove.move(vfs, req.oldPath, req.newPath);
        if (!movedFile.ok) return IpcResults.err(FormatIpcError.format(movedFile.error));
      }
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function exportZip(req: VfsZipRequest): Promise<IpcResult<VfsZipExportResult>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      // 原 exportVfsZipWithDialog 内联：导出 VFS 子树为 ZIP，默认名 = 覆盖名（fileName）
      // > 子目录末段 > 根目录项目名 > 备用名；仅作保存框默认值，用户可改。
      const directoryPathResult = VfsZipPath.resolveDirectoryPath(req.directoryPath);
      if (!directoryPathResult.ok)
        return IpcResults.err(FormatIpcError.format(directoryPathResult.error));
      const directoryPath = directoryPathResult.value;
      const zipSvc = VfsServiceFactory.createZipIo(rt.conn);
      const exported = await zipSvc.export(scope, { directoryPath });
      if (!exported.ok) return IpcResults.err(FormatIpcError.format(exported.error));
      const bytes = exported.value;
      const archiveCheck = VfsZipArchive.assert(bytes, "magic");
      if (!archiveCheck.ok) return IpcResults.err(FormatIpcError.format(archiveCheck.error));

      const base = VfsZipPath.baseNameFromPath(directoryPath);
      let defaultPath: string;
      if (req.fileName != null) {
        defaultPath = req.fileName;
      } else if (base != null) {
        defaultPath = `${base}.zip`;
      } else {
        // 根目录导出时以项目名命名；解析失败回退备用名，不阻断导出。
        const projectId = (scope as { projectId?: string }).projectId;
        const project = projectId == null ? null : await rt.projects.get(projectId);
        defaultPath = project?.ok === true ? `${project.value.name}.zip` : WORKSPACE_FALLBACK_ZIP_NAME;
      }

      const win = focusedWindow();
      const saveDialogOptions: Electron.SaveDialogOptions = {
        defaultPath,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      };
      const saved = win ? await dialog.showSaveDialog(win, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
      if (saved.canceled || saved.filePath == null) {
        return IpcResults.ok("cancelled");
      }
      await writeFile(saved.filePath, bytes);
      return IpcResults.ok("saved");
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function importZip(req: VfsZipRequest): Promise<IpcResult<VfsZipImportResult>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      // 原 importVfsZipWithDialog 内联：弹框选 zip → 字节直写导入（选文件与确认已在 Renderer 前置）。
      const picked = await VfsZipService.pickBytesWithDialog(focusedWindow());
      if (!picked.ok) return { ok: false, error: FormatIpcError.format(picked.error) };
      if (picked.value == null) {
        return { ok: true, data: "cancelled" };
      }
      const importOptions = {
        bytes: picked.value,
        confirmed: req.confirmed === true,
        directoryPath: req.directoryPath,
      };
      const imported = await VfsZipService.importBytes(rt, scope, importOptions);
      if (!imported.ok)
        return { ok: false, error: FormatIpcError.format(imported.error) };
      return { ok: true, data: "imported" };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  /** 弹框选 zip 读字节：技能新建弹窗预检用，预检（previewSkillZip）在 Renderer。 */
  export async function pickZip(): Promise<IpcResult<VfsZipPickResult>> {
    try {
      const picked = await VfsZipService.pickBytesWithDialog(focusedWindow());
      if (!picked.ok) return { ok: false, error: FormatIpcError.format(picked.error) };
      return { ok: true, data: picked.value };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  /** 字节直写导入（不弹框）：新建弹窗创建时整包落入技能目录。 */
  export async function importZipBytes(req: VfsZipBytesImportRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      const imported = await VfsZipService.importBytes(rt, scope, { bytes: req.bytes, confirmed: req.confirmed === true, directoryPath: req.directoryPath });
      if (!imported.ok)
        return { ok: false, error: FormatIpcError.format(imported.error) };
      pushWorkspaceMutated(req);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function characterCardImport(req: VfsCharacterCardImportRequest): Promise<IpcResult<VfsCharacterCardImportResult>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      const result = await VfsCharacterCardService.importWithDialog(rt, scope, { confirmed: req.confirmed === true, directoryPath: req.directoryPath }, focusedWindow());
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  /**
   * 弹框选单个本机文件，只回路径：菜单侧单文件导入的入口。
   *
   * 与 {@link Vfs.pickZip} 同为 noArg，但**不读字节**——真正的导入走既有
   * `VFS_BATCH_INGEST_FROM_PATHS`（两段式 + needs_confirm 协议）。这里不做 scope
   * 解析也无写库动作，故不推 workspaceMutated。
   */
  export async function filePick(): Promise<IpcResult<VfsFilePickResult>> {
    try {
      // 原 pickHostFileWithDialog 内联：弹框选单个本机文件，只回路径。⚠️ 刻意不传
      // filters——VFS 内容既不限扩展名也不限格式，白名单只会把无扩展名文件挡在门外；
      // 非 UTF-8 的把关在 core 的 planBatchIngest（skippedBinary）。取消/未选返回 null。
      const win = focusedWindow();
      const dialogOpts = { properties: ["openFile" as const] };
      const picked = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts);
      const path = picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0] ?? null;
      return { ok: true, data: path };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  /** 单文件另存导出：无库变更，故不推 workspaceMutated。 */
  export async function fileExport(req: VfsFileExportRequest): Promise<IpcResult<VfsFileExportResult>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      // 原 exportVfsFileWithDialog 内联：单文件「另存为」导出（plan 单条目 → 校验恰好
      // 一条 → 保存框 → utf8 写盘）。⚠️ files.length === 1 是安全闸：planBatchExport 收到
      // 目录会递归整棵子树且不报错，多文件目录只取 files[0] 会静默降级成「导出目录里的
      // 某个文件」；不变量靠调用方保证只传文件行路径（目录行走 ZIP 分支）。
      const batch = VfsServiceFactory.createBatchIo(rt.conn);
      const planned = await batch.planBatchExport(scope, [req.logicalPath]);
      if (!planned.ok) return IpcResults.err(FormatIpcError.format(planned.error));
      const plan = planned.value;
      if (plan.files.length !== 1) {
        return IpcResults.err(FormatIpcError.format(new AppError("CLI_INVALID_ARGUMENT", { detail: `只能导出单个文件（收到 ${plan.files.length} 个条目）：${req.logicalPath}` })));
      }
      const file = plan.files[0]!;
      // 逻辑路径 → 末段文件名（`/a/b.md` → `b.md`；根路径返回 null）。与 VfsZipPath
      // .baseNameFromPath 同款语义，刻意平移而非 import（避免 handler ↔ service 的
      // 平级依赖边；几行纯字符串逻辑，测试锁住行为）。
      const normalizedExportPath = req.logicalPath.replace(/\/+$/, "");
      const base = normalizedExportPath === "" || normalizedExportPath === "/" ? null : normalizedExportPath.slice(normalizedExportPath.lastIndexOf("/") + 1) || null;
      if (base == null) {
        return IpcResults.err(FormatIpcError.format(new AppError("CLI_INVALID_ARGUMENT", { detail: `无法解析导出文件名：${req.logicalPath}` })));
      }

      const win = focusedWindow();
      const saved = win ? await dialog.showSaveDialog(win, { defaultPath: base }) : await dialog.showSaveDialog({ defaultPath: base });
      if (saved.canceled || saved.filePath == null) {
        return IpcResults.ok("cancelled");
      }
      await writeFile(saved.filePath, file.content, "utf8");
      return IpcResults.ok("saved");
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function batchIngestFromPaths(req: VfsBatchIngestFromPathsRequest): Promise<IpcResult<VfsBatchIngestFromPathsResult>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      // 原 ingestVfsFromHostPaths + collectHostPathEntries 内联：本机路径树展开 →
      // core plan（两段式 needs_confirm 协议）→ apply（session 域统一 tool turn 时走
      // writer 适配器）。顶层文件 → basename；顶层目录 → 以目录名为根保留相对结构；
      // 空目录显式 directory。
      type IngestOptions = {
        targetDir: string;
        hostPaths: readonly string[];
        overwriteConfirmed: boolean;
      };
      type IngestResult = Result<BatchIngestFromPathsOutcome, AppError>;
      // nm-style: keep-local — IIFE 拆具名函数是收 const RHS 拆行（VARDECL）与长类型注解行（PARAMS）的唯一出路；内联回调用点让 100+ 行批量摄取体直接塞进 await 表达式，规则互斥。
      async function ingestBatch(options: IngestOptions): Promise<IngestResult> {
        const targetDir = options.targetDir == null || options.targetDir.trim() === "" ? "/" : options.targetDir;
        if (options.hostPaths.length === 0) {
          return Result.ok({
            status: "applied",
            report: { written: [], skipped: [], failed: [] },
            skippedBinary: [],
          });
        }

        const entries: BatchIngestRawEntry[] = [];

        /** nm-style: keep-local — entries 是整棵树遍历共享的累积状态；自递归调用是必需的第二调用点，内联消除不掉递归结构。 */
        async function walkDir(absDir: string, relativePrefix: string): Promise<void> {
          const children = await readdir(absDir, { withFileTypes: true });
          if (children.length === 0) {
            entries.push({ relativePath: relativePrefix, kind: "directory" });
            return;
          }
          let hasFileOrNonEmpty = false;
          for (const child of children) {
            const childAbs = join(absDir, child.name);
            const childRel = relativePrefix ? `${relativePrefix}/${child.name}` : child.name;
            if (child.isDirectory()) {
              await walkDir(childAbs, childRel);
              hasFileOrNonEmpty = true;
            } else if (child.isFile()) {
              const bytes = new Uint8Array(await readFile(childAbs));
              entries.push({ relativePath: childRel, kind: "file", bytes });
              hasFileOrNonEmpty = true;
            }
          }
          if (!hasFileOrNonEmpty) {
            entries.push({ relativePath: relativePrefix, kind: "directory" });
          }
        }

        for (const hostPath of options.hostPaths) {
          const info = await stat(hostPath);
          const topName = basename(hostPath);
          if (info.isDirectory()) {
            await walkDir(hostPath, topName);
          } else if (info.isFile()) {
            const bytes = new Uint8Array(await readFile(hostPath));
            entries.push({ relativePath: topName, kind: "file", bytes });
          }
        }

        const rawEntries = entries;
        const batch = VfsServiceFactory.createBatchIo(rt.conn);
        const planned = await batch.planBatchIngest(scope, targetDir, rawEntries);
        // 失败沿 Result 返回，由本 handler 就地转码。
        if (!planned.ok) return Result.err(planned.error);
        const plan = planned.value;

        if (plan.conflicts.length > 0 && !options.overwriteConfirmed) {
          return Result.ok({
            status: "needs_confirm",
            conflicts: plan.conflicts.map((c) => ({
              logicalPath: c.logicalPath,
              reason: c.reason,
            })),
            skippedBinary: [...plan.skippedBinary],
          });
        }

        const applyOptions = { overwriteConfirmed: options.overwriteConfirmed };
        let report: BatchApplyReport;

        if (
          LogicalPath.isSessionVfsScope(scope) &&
          userVfsUnifiedToolTurnFlag.isEnabled()
        ) {
          const vfs = rt.sessionVfs(scope.projectId, scope.sessionId);
          // BatchIngestWriter 适配器（core port，`domain/vfs/ports/vfs-batch-io.port.ts`）：
          // writer 端口已知失败沿 `Result.err` 回传，由 `applyBatchIngestWithWriter` 逐项聚合进
          // `Report.failed`（Result 契约之外的未知异常仍按 catch 落表，不整批 err）。
          const writer: BatchIngestWriter = {
            async mkdir(logicalPath: string): Promise<Result<void, AppError>> {
              return toWriterResult(await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, UserVfsTurnOps.buildMkdir(logicalPath)));
            },
            async writeFile(logicalPath: string, content: string): Promise<Result<void, AppError>> {
              const baselineResult = await UserVfsSaveBaseline.read(vfs, logicalPath);
              if (!baselineResult.ok) return Result.err(baselineResult.error);
              const baseline = baselineResult.value;
              if (baseline == null)
                return toWriterResult(await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, UserVfsTurnOps.buildCreateFile(logicalPath, content)));
              const op = UserVfsTurnOps.buildSave(baseline, content, logicalPath, content);
              if (op == null) return Result.ok(undefined);
              return toWriterResult(await UserVfsTurnExecuteService.executeSessionOp(rt, scope.sessionId, op));
            },
          };
          const appliedWithWriter = await batch.applyBatchIngestWithWriter(scope, targetDir, plan, applyOptions, writer);
          if (!appliedWithWriter.ok) return Result.err(appliedWithWriter.error);
          report = appliedWithWriter.value;
        } else {
          const applied = await batch.applyBatchIngest(scope, targetDir, plan, applyOptions);
          if (!applied.ok) return Result.err(applied.error);
          report = applied.value;
        }

        return Result.ok({
          status: "applied",
          report,
          skippedBinary: [...plan.skippedBinary],
        });
      }
      const ingestOptions = {
        targetDir: req.targetDir,
        hostPaths: req.hostPaths,
        overwriteConfirmed: req.overwriteConfirmed === true,
      };
      const ingested = await ingestBatch(ingestOptions);
      // plan/apply 的已知失败沿 Result 到达，就地转码（错误通道迁移四期）；
      // writer 协议内的部分失败不落 err（core 聚合进 report.failed）。
      if (!ingested.ok) return IpcResults.err(FormatIpcError.format(ingested.error));
      const outcome = ingested.value;
      if (outcome.status === "applied") {
        pushWorkspaceMutated(req);
      }
      // failed[].message 可能是 descriptor（error.vfs.batch_ingest_partial）：main 翻译后写 string DTO
      const data: VfsBatchIngestFromPathsResult = outcome.status === "applied" ? { ...outcome, report: { ...outcome.report, failed: outcome.report.failed.map((f) => ({ ...f, message: coreT(f.message) })) } } : outcome;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function batchExportStage(req: VfsBatchExportStageRequest): Promise<IpcResult<VfsBatchExportStageResult>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const scopeRes = ResolveVfsScope.fromRequest(req);
      if (!scopeRes.ok) return scopeRes;
      const scope = scopeRes.data;
      return IpcResults.from(await VfsBatchService.stage(rt, scope, req.logicalPaths));
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function batchClearStaging(req: VfsBatchClearStagingRequest): Promise<IpcResult<void>> {
    try {
      await VfsBatchService.clearStaging(req.stagingRoot);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }
}
