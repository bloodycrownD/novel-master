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
  type VfsScope,
} from "@novel-master/core/vfs";
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/feature-flags";
import { app, nativeImage, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
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
        { versionCheck: false },
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

export type ExportStageResult = {
  readonly stagingRoot: string;
  readonly filePaths: readonly string[];
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

/** 删除 export staging 临时目录；dragEnd / 取消 / 失败 / TTL 到期时调用。 */
export async function clearVfsBatchExportStaging(
  stagingRoot: string,
): Promise<void> {
  if (stagingRoot.trim() === "") {
    return;
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

  const stagingRoot = join(
    app.getPath("userData"),
    "vfs-batch-export",
    randomUUID(),
  );
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
    return { stagingRoot, filePaths };
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
