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
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/feature-flags";
import { app, dialog, nativeImage, type BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { resolveAppIconPath } from "../runtime/resolve-app-icon.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import {
  executeSessionUserVfsOp,
  isSessionVfsScope,
} from "./user-vfs-turn-execute.service.js";
import type { VfsService } from "@novel-master/core/vfs";

/**
 * Windows 上 `nativeImage.createEmpty()` + `startDrag` 会硬崩主进程（try/catch 拦不住）。
 * 1×1 PNG 兜底，保证 icon 非空。
 */
const FALLBACK_DRAG_ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** @internal 测试用：禁止 createEmpty。 */
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
    throw new Error("拖出图标无效");
  }
  return fallback;
}

function resolveTargetDir(targetDir?: string): string {
  if (targetDir == null || targetDir.trim() === "") {
    return "/";
  }
  return targetDir;
}

function toPosixRelative(fromRoot: string, absolutePath: string): string {
  const rel = relative(fromRoot, absolutePath);
  return rel.split(sep).join("/");
}

/**
 * 将本机路径树展开为 ingest 原始条目。
 * 顶层文件 → basename；顶层目录 → 以目录名为根保留相对结构；空目录显式 directory。
 */
export async function collectHostPathEntries(
  hostPaths: readonly string[],
): Promise<BatchIngestRawEntry[]> {
  const entries: BatchIngestRawEntry[] = [];

  async function walkDir(
    absDir: string,
    relativePrefix: string,
  ): Promise<void> {
    const children = await readdir(absDir, { withFileTypes: true });
    if (children.length === 0) {
      entries.push({ relativePath: relativePrefix, kind: "directory" });
      return;
    }
    let hasFileOrNonEmpty = false;
    for (const child of children) {
      const childAbs = join(absDir, child.name);
      const childRel = relativePrefix
        ? `${relativePrefix}/${child.name}`
        : child.name;
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

function createSessionBatchWriter(
  runtime: DesktopNovelMasterRuntime,
  sessionId: string,
  vfs: VfsService,
): BatchIngestWriter {
  return {
    async mkdir(logicalPath: string): Promise<void> {
      await executeSessionUserVfsOp(
        runtime,
        sessionId,
        buildUserVfsMkdirOp(logicalPath),
      );
    },
    async writeFile(logicalPath: string, content: string): Promise<void> {
      const baseline = await readUserVfsSaveBaseline(vfs, logicalPath);
      if (baseline == null) {
        await executeSessionUserVfsOp(
          runtime,
          sessionId,
          buildUserVfsCreateFileOp(logicalPath, content),
        );
        return;
      }
      const op = buildUserVfsSaveOp(
        baseline,
        content,
        logicalPath,
        content,
      );
      if (op != null) {
        await executeSessionUserVfsOp(runtime, sessionId, op);
      }
    },
  };
}

export type BatchIngestFromPathsOutcome =
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

export async function ingestVfsFromHostPaths(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: {
    readonly targetDir: string;
    readonly hostPaths: readonly string[];
    readonly overwriteConfirmed: boolean;
  },
): Promise<BatchIngestFromPathsOutcome> {
  const targetDir = resolveTargetDir(options.targetDir);
  if (options.hostPaths.length === 0) {
    return {
      status: "applied",
      report: { written: [], skipped: [], failed: [] },
      skippedBinary: [],
    };
  }

  const rawEntries = await collectHostPathEntries(options.hostPaths);
  const batch = createVfsBatchIoService(runtime.conn);
  const plan = await batch.planBatchIngest(scope, targetDir, rawEntries);

  if (plan.conflicts.length > 0 && !options.overwriteConfirmed) {
    return {
      status: "needs_confirm",
      conflicts: plan.conflicts.map((c) => ({
        logicalPath: c.logicalPath,
        reason: c.reason,
      })),
      skippedBinary: [...plan.skippedBinary],
    };
  }

  const applyOptions = { overwriteConfirmed: options.overwriteConfirmed };
  let report: BatchApplyReport;

  if (isSessionVfsScope(scope) && isUserVfsUnifiedToolTurnEnabled()) {
    const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
    const writer = createSessionBatchWriter(runtime, scope.sessionId, vfs);
    report = await batch.applyBatchIngestWithWriter(
      scope,
      targetDir,
      plan,
      applyOptions,
      writer,
    );
  } else {
    report = await batch.applyBatchIngest(
      scope,
      targetDir,
      plan,
      applyOptions,
    );
  }

  return {
    status: "applied",
    report,
    skippedBinary: [...plan.skippedBinary],
  };
}

/**
 * 逻辑路径 → 末段文件名（`/a/b.md` → `b.md`；根路径返回 null）。
 *
 * 与 `vfs-zip.service.ts` 的 `zipBaseNameFromPath`（:15-22）同款语义，刻意**平移**
 * 而非 import：那条 import 会让本服务多出一条 main→main 依赖边，在 renderer tsconfig
 * 下多出一条 TS6307 诊断（棘轮按「新增诊断必须为零」判红）。两处都是几行纯字符串逻辑，
 * 各自有测试锁住，比多一条依赖边划算。
 */
function logicalBaseName(logicalPath: string): string | null {
  const normalized = logicalPath.replace(/\/+$/, "");
  if (normalized === "" || normalized === "/") {
    return null;
  }
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  return lastSegment === "" ? null : lastSegment;
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
export async function pickHostFileWithDialog(
  parentWindow?: BrowserWindow | null,
): Promise<string | null> {
  const win = parentWindow ?? undefined;
  const dialogOpts = { properties: ["openFile" as const] };
  const result = win
    ? await dialog.showOpenDialog(win, dialogOpts)
    : await dialog.showOpenDialog(dialogOpts);
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
export async function exportVfsFileWithDialog(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: { readonly logicalPath: string },
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const batch = createVfsBatchIoService(runtime.conn);
  const plan = await batch.planBatchExport(scope, [options.logicalPath]);
  if (plan.files.length !== 1) {
    throw new Error(
      `只能导出单个文件（收到 ${plan.files.length} 个条目）：${options.logicalPath}`,
    );
  }
  const file = plan.files[0]!;
  const base = logicalBaseName(options.logicalPath);
  if (base == null) {
    throw new Error(`无法解析导出文件名：${options.logicalPath}`);
  }

  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showSaveDialog(win, { defaultPath: base })
    : await dialog.showSaveDialog({ defaultPath: base });
  if (result.canceled || result.filePath == null) {
    return "cancelled";
  }
  await writeFile(result.filePath, file.content, "utf8");
  return "saved";
}

export type ExportStageResult = {
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

function scheduleStagingTtl(stagingRoot: string): void {
  const existing = stagingTtlTimers.get(stagingRoot);
  if (existing != null) {
    clearTimeout(existing);
  }
  stagingTtlTimers.set(
    stagingRoot,
    setTimeout(() => {
      stagingTtlTimers.delete(stagingRoot);
      void rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }, STAGING_TTL_MS),
  );
}

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
export async function clearVfsBatchExportStaging(
  stagingRoot: string,
): Promise<void> {
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
export async function stageVfsBatchExport(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  logicalPaths: readonly string[],
): Promise<ExportStageResult> {
  if (logicalPaths.length === 0) {
    throw new Error("没有可导出的路径");
  }

  const batch = createVfsBatchIoService(runtime.conn);
  const plan = await batch.planBatchExport(scope, logicalPaths);
  if (plan.files.length === 0 && plan.mkdirPaths.length === 0) {
    throw new Error("导出内容为空");
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
      throw new Error("导出物化失败：无顶层条目");
    }

    scheduleStagingTtl(stagingRoot);
    // CS-08：`skipped` 是**必需通道**，不是死字段——相对路径碰撞（文件与目录
    // 同选）无法靠改锚点消除，必须让信息到达 main 进程，否则 ZIP 里会静默少文件。
    // UI 如何呈现列为债务池；此处至少留日志与计数。
    const skipped = plan.skipped ?? [];
    if (skipped.length > 0) {
      console.warn(
        `[vfs-batch] 导出跳过 ${skipped.length} 项（相对路径碰撞）：`,
        skipped.map((s) => s.logicalPath),
      );
    }
    return {
      stagingRoot,
      filePaths,
      ...(skipped.length > 0 ? { skipped } : {}),
    };
  } catch (err) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

/** 调用 webContents.startDrag；失败抛错由调用方 toast。 */
export function startDragExport(
  webContents: WebContents,
  filePaths: readonly string[],
): void {
  if (filePaths.length === 0) {
    throw new Error("没有可拖出的文件");
  }
  const icon = resolveDragIcon();
  // Electron 类型要求 `file`；多文件时同时传 `files`
  webContents.startDrag({
    file: filePaths[0]!,
    files: [...filePaths],
    icon,
  });
}

/** @internal 测试辅助：相对路径规范化（POSIX）。 */
export function hostRelativePathForTest(
  fromRoot: string,
  absolutePath: string,
): string {
  return toPosixRelative(fromRoot, absolutePath);
}
