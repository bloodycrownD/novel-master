/**
 * Desktop VFS 批量导入/导出：读本机路径 → Core plan/apply；export 物化临时目录；startDrag。
 *
 * @module services/vfs-batch
 */
import {
  buildUserVfsCreateFileOp,
  buildUserVfsMkdirOp,
  buildUserVfsSaveOp,
  createVfsBatchIoService,
  readUserVfsSaveBaseline,
  type BatchApplyReport,
  type BatchIngestRawEntry,
  type BatchIngestWriter,
  type BatchExportSkip,
  type VfsScope,
} from "@novel-master/core/vfs";
import { AppError, isAppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { userVfsUnifiedToolTurnFlag } from "@novel-master/core/feature-flags";
import { app, dialog, nativeImage, type BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { resolveAppIconPath } from "../runtime/resolve-app-icon.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { executeSessionUserVfsOp, isSessionVfsScope } from "./user-vfs-turn-execute.service.js";
import { createLogger } from "@novel-master/core/log";

const log = createLogger("desktop.vfs-batch");

/**
 * Windows 上 `nativeImage.createEmpty()` + `startDrag` 会硬崩主进程（try/catch 拦不住）。
 * 1×1 PNG 兜底，保证 icon 非空。
 */
const FALLBACK_DRAG_ICON_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * @internal 测试用：禁止 createEmpty。
 *
 * nm-style: keep-public — 测试直引入口（apps/desktop/test/vfs-batch-staging.test.ts）；
 * 本片改动范围只到 src，删 wrapper 需同步改测试 import，留给收口轮。
 */
export function resolveDragIconForTest(): Electron.NativeImage {
  return resolveDragIcon();
}

function resolveDragIcon(): Electron.NativeImage {
  const iconPath = resolveAppIconPath();
  if (iconPath != null) {
    const fromPath = nativeImage.createFromPath(iconPath);
    if (!fromPath.isEmpty()) {
      return fromPath.resize({ width: 32, height: 32 });
    }
  }
  const fallback = nativeImage.createFromBuffer(FALLBACK_DRAG_ICON_PNG);
  if (fallback.isEmpty()) {
    // nm-throw: keep — 固定 1×1 PNG 解码失败属平台不变量破坏（nativeImage 异常），用户无纠正路径。
    throw new Error("拖出图标无效");
  }
  return fallback;
}

/**
 * 将本机路径树展开为 ingest 原始条目。
 * 顶层文件 → basename；顶层目录 → 以目录名为根保留相对结构；空目录显式 directory。
 */
export async function collectHostPathEntries(hostPaths: readonly string[]): Promise<BatchIngestRawEntry[]> {
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

  for (const hostPath of hostPaths) {
    const info = await stat(hostPath);
    const topName = basename(hostPath);
    if (info.isDirectory()) {
      await walkDir(hostPath, topName);
    } else if (info.isFile()) {
      const bytes = new Uint8Array(await readFile(hostPath));
      entries.push({ relativePath: topName, kind: "file", bytes });
    }
  }

  return entries;
}

/**
 * `executeSessionUserVfsOp` 的错误侧是 `unknown`（user-vfs-turn port 的异构
 * 形态），writer 端口契约是 `Result<void, AppError>`——在此归一：AppError 原样
 * 透传，其余包 INFRA_UNEXPECTED_ERROR（与 formatIpcError 的未知分支同款）。
 */
function toWriterResult(r: Result<void, unknown>): Result<void, AppError> {
  if (r.ok) return Result.ok(undefined);
  return Result.err(isAppError(r.error) ? r.error : new AppError("INFRA_UNEXPECTED_ERROR", { detail: r.error instanceof Error ? r.error.message : String(r.error) }, { cause: r.error }));
}

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

type IngestFromHostPathsOptions = {
  readonly targetDir: string;
  readonly hostPaths: readonly string[];
  readonly overwriteConfirmed: boolean;
};

export async function ingestVfsFromHostPaths(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: IngestFromHostPathsOptions): Promise<Result<BatchIngestFromPathsOutcome, AppError>> {
  const targetDir = options.targetDir == null || options.targetDir.trim() === "" ? "/" : options.targetDir;
  if (options.hostPaths.length === 0) {
    return Result.ok({
      status: "applied",
      report: { written: [], skipped: [], failed: [] },
      skippedBinary: [],
    });
  }

  const rawEntries = await collectHostPathEntries(options.hostPaths);
  const batch = createVfsBatchIoService(runtime.conn);
  const planned = await batch.planBatchIngest(scope, targetDir, rawEntries);
  // 失败沿 Result 返回，由唯一调用方 handleVfsBatchIngestFromPaths 转码。
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

  if (isSessionVfsScope(scope) && userVfsUnifiedToolTurnFlag.isEnabled()) {
    const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
    // BatchIngestWriter 适配器（core port，`domain/vfs/ports/vfs-batch-io.port.ts`）：
    // writer 端口已知失败沿 `Result.err` 回传，由 `applyBatchIngestWithWriter` 逐项聚合进
    // `Report.failed`（Result 契约之外的未知异常仍按 catch 落表，不整批 err）。
    const writer: BatchIngestWriter = {
      async mkdir(logicalPath: string): Promise<Result<void, AppError>> {
        return toWriterResult(await executeSessionUserVfsOp(runtime, scope.sessionId, buildUserVfsMkdirOp(logicalPath)));
      },
      async writeFile(logicalPath: string, content: string): Promise<Result<void, AppError>> {
        const baselineResult = await readUserVfsSaveBaseline(vfs, logicalPath);
        if (!baselineResult.ok) return Result.err(baselineResult.error);
        const baseline = baselineResult.value;
        if (baseline == null) return toWriterResult(await executeSessionUserVfsOp(runtime, scope.sessionId, buildUserVfsCreateFileOp(logicalPath, content)));
        const op = buildUserVfsSaveOp(baseline, content, logicalPath, content);
        if (op == null) return Result.ok(undefined);
        return toWriterResult(await executeSessionUserVfsOp(runtime, scope.sessionId, op));
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

/**
 * 弹框选择单个本机文件，只回绝对路径（不读字节）。
 *
 * ⚠️ **刻意不传 filters**：VFS 内容既不限扩展名（`.md`/`.txt`/`.yaml`…）也不限格式，
 * 白名单只会把无扩展名文件挡在门外。非 UTF-8 的把关在 core 的
 * `planBatchIngest`（`skippedBinary`），UI 层明示「跳过 N 个非 UTF-8 文件」——
 * 选择阶段拦比事后解释更省事（用户仍可自选，错了有 toast）。
 *
 * 取消 / 未选任何文件返回 null。
 */
export async function pickHostFileWithDialog(parentWindow?: BrowserWindow | null): Promise<string | null> {
  const win = parentWindow ?? undefined;
  const dialogOpts = { properties: ["openFile" as const] };
  const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
}

/**
 * 单文件「另存为」导出：plan 单条目 → 校验恰好一条 → 保存框（默认名 = 文件名）→
 * utf8 写盘。取消保存框返回 `cancelled`。
 *
 * ⚠️ `files.length === 1` 的校验是**安全闸**不是可选加固：`planBatchExport` 收到目录
 * 路径时会递归整棵子树且不报错，**多文件目录**只取 `files[0]` 会静默把「导出一个目录」
 * 降级成「导出该目录下的某个文件」。校验放在 showSaveDialog **之前**，免得误传时先弹框
 * 再报错。
 *
 * 闸的边界说实话：**恰好只含一个文件的目录仍会过闸**并被同样静默降级（core 侧
 * planBatchExport 不区分锚点是文件还是目录，本函数也就不判 entryKind，避免扩到 core）。
 * 不变量靠调用方保证——只把**文件行**的路径传进来（见 workspace-actions 的
 * `exportWorkspaceTarget`：文件行走单文件导出、目录行走 ZIP 分支）。
 *
 * 导出无库变更，故不经 `pushWorkspaceMutated`（调用方无需刷新 Explorer）。
 */
type ExportVfsFileOptions = { readonly logicalPath: string };
type ExportFileResult = Result<"saved" | "cancelled", AppError>;

export async function exportVfsFileWithDialog(runtime: DesktopNovelMasterRuntime, scope: VfsScope, options: ExportVfsFileOptions, parentWindow?: BrowserWindow | null): Promise<ExportFileResult> {
  const batch = createVfsBatchIoService(runtime.conn);
  const planned = await batch.planBatchExport(scope, [options.logicalPath]);
  // 失败沿 Result 返回，由唯一调用方 handleVfsFileExport 转码。
  if (!planned.ok) return Result.err(planned.error);
  const plan = planned.value;
  if (plan.files.length !== 1) {
    return Result.err(new AppError("CLI_INVALID_ARGUMENT", { detail: `只能导出单个文件（收到 ${plan.files.length} 个条目）：${options.logicalPath}` }));
  }
  const file = plan.files[0]!;
  // 逻辑路径 → 末段文件名（`/a/b.md` → `b.md`；根路径返回 null）。与 `vfs-zip.service.ts`
  // 的 `zipBaseNameFromPath`（:15-22）同款语义，刻意**平移**而非 import：那条 import 会让本
  // 服务多出一条 main→main 依赖边，在 renderer tsconfig 下多出一条 TS6307 诊断（棘轮按
  // 「新增诊断必须为零」判红）。两处都是几行纯字符串逻辑，各自有测试锁住，比多一条依赖边划算。
  const normalizedExportPath = options.logicalPath.replace(/\/+$/, "");
  const base = normalizedExportPath === "" || normalizedExportPath === "/" ? null : normalizedExportPath.slice(normalizedExportPath.lastIndexOf("/") + 1) || null;
  if (base == null) {
    return Result.err(new AppError("CLI_INVALID_ARGUMENT", { detail: `无法解析导出文件名：${options.logicalPath}` }));
  }

  const win = parentWindow ?? undefined;
  const result = win ? await dialog.showSaveDialog(win, { defaultPath: base }) : await dialog.showSaveDialog({ defaultPath: base });
  if (result.canceled || result.filePath == null) {
    return Result.ok("cancelled");
  }
  await writeFile(result.filePath, file.content, "utf8");
  return Result.ok("saved");
}

type ExportStageResult = {
  readonly stagingRoot: string;
  readonly filePaths: readonly string[];
  /**
   * CS-08：因相对路径碰撞被跳过、**没有**物化进 staging 的选中项。
   * 可选字段，仅在有跳过时才出现（不出现即无跳过）。
   * ⚠️ UI 呈现面尚未做（列为债务池），但信息已到达 main 进程。
   */
  readonly skipped?: readonly BatchExportSkip[];
};

/** 未显式清理时 main 侧兜底回收 staging 目录。 */
const STAGING_TTL_MS = 5 * 60 * 1000;

const stagingTtlTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * staging 根目录的权威基准（`userData/vfs-batch-export`）。
 *
 * 抽成单一函数是给 `clearVfsBatchExportStaging` 的包含断言与 stagingRoot 构造共用，
 * 消除「两处各写一遍基准」的漂移（S-D-02）。
 */
function vfsBatchStagingBase(): string {
  return join(app.getPath("userData"), "vfs-batch-export");
}

/** 删除 export staging 临时目录；dragEnd / 取消 / 失败 / TTL 到期时调用。 */
export async function clearVfsBatchExportStaging(stagingRoot: string): Promise<void> {
  if (stagingRoot.trim() === "") {
    return;
  }
  // S-D-02 路径包含断言：IPC 通道把 renderer 传来的 stagingRoot 原样交给
  // `rm(recursive: true, force: true)`，若通道本身不校验，传 `C:\Users\<用户>` 或 `/`
  // 都会被递归删除。基准只接受 staging 根自身或其下的子目录。
  // ⚠️ 必须带分隔符再拼：`base + "-evil"` 这类前缀撞车要一并拒掉。
  const resolved = resolve(stagingRoot);
  const base = resolve(vfsBatchStagingBase());
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`拒绝清理非 staging 路径: ${stagingRoot}`);
  }
  const timer = stagingTtlTimers.get(stagingRoot);
  if (timer != null) {
    clearTimeout(timer);
    stagingTtlTimers.delete(stagingRoot);
  }
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
}

/** @internal 测试辅助：当前注册的 staging TTL 数量。 */
export function stagingTtlCountForTest(): number {
  return stagingTtlTimers.size;
}

/** 将逻辑路径导出物化到 userData 临时目录，返回 startDrag 顶层路径。 */
export async function stageVfsBatchExport(runtime: DesktopNovelMasterRuntime, scope: VfsScope, logicalPaths: readonly string[]): Promise<Result<ExportStageResult, AppError>> {
  if (logicalPaths.length === 0) {
    return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "没有可导出的路径" }));
  }

  const batch = createVfsBatchIoService(runtime.conn);
  const planned = await batch.planBatchExport(scope, logicalPaths);
  // 失败沿 Result 返回，由唯一调用方 handleVfsBatchExportStage 转码。
  if (!planned.ok) return Result.err(planned.error);
  const plan = planned.value;
  if (plan.files.length === 0 && plan.mkdirPaths.length === 0) {
    return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "导出内容为空" }));
  }

  const stagingRoot = join(vfsBatchStagingBase(), randomUUID());
  await mkdir(stagingRoot, { recursive: true });

  try {
    for (const dirRel of plan.mkdirPaths) {
      await mkdir(join(stagingRoot, ...dirRel.split("/")), { recursive: true });
    }
    for (const file of plan.files) {
      const abs = join(stagingRoot, ...file.relativePath.split("/"));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.content, "utf8");
    }

    const topNames = new Set<string>();
    for (const file of plan.files) {
      const top = file.relativePath.split("/")[0];
      if (top) {
        topNames.add(top);
      }
    }
    for (const dirRel of plan.mkdirPaths) {
      const top = dirRel.split("/")[0];
      if (top) {
        topNames.add(top);
      }
    }

    const filePaths = [...topNames].map((name) => join(stagingRoot, name));
    if (filePaths.length === 0) {
      // nm-throw: keep — 不可达分支：本函数早段已挡掉 files 与 mkdirPaths 皆空的情况，topNames 必非空，命中即不变量破坏。
      throw new Error("导出物化失败：无顶层条目");
    }

    const previousTtlTimer = stagingTtlTimers.get(stagingRoot);
    if (previousTtlTimer != null) clearTimeout(previousTtlTimer);
    const ttlTimer = setTimeout(() => {
      stagingTtlTimers.delete(stagingRoot);
      void rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }, STAGING_TTL_MS);
    stagingTtlTimers.set(stagingRoot, ttlTimer);
    // CS-08：`skipped` 是**必需通道**，不是死字段——相对路径碰撞（文件与目录
    // 同选）无法靠改锚点消除，必须让信息到达 main 进程，否则 ZIP 里会静默少文件。
    // UI 如何呈现列为债务池；此处至少留日志与计数。
    const skipped = plan.skipped ?? [];
    if (skipped.length > 0) {
      log.warn(`导出跳过 ${skipped.length} 项（相对路径碰撞）`, { skipped: skipped.map((s) => s.logicalPath) });
    }
    return Result.ok({
      stagingRoot,
      filePaths,
      ...(skipped.length > 0 ? { skipped } : {}),
    });
  } catch (err) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

/** 调用 webContents.startDrag；已知失败沿 `Result.err` 返回，由 handleVfsStartDrag 转码 toast。 */
export function startDragExport(webContents: WebContents, filePaths: readonly string[]): Result<void, AppError> {
  if (filePaths.length === 0) {
    return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "没有可拖出的文件" }));
  }
  const icon = resolveDragIcon();
  // Electron 类型要求 `file`；多文件时同时传 `files`
  webContents.startDrag({
    file: filePaths[0]!,
    files: [...filePaths],
    icon,
  });
  return Result.ok(undefined);
}
