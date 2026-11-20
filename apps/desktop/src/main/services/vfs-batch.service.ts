/**
 * Desktop VFS 批量导出 staging 与 startDrag（drag-icon 管线、TTL 回收、路径护栏）。
 * 批量导入/单文件选路径/单文件导出/ZIP 导入导出的编排已内联进 `ipc/handlers/vfs.ts`。
 *
 * @module services/vfs-batch
 */
import {
  VfsServiceFactory,
  type BatchExportSkip,
  type VfsScope,
} from "@novel-master/core/vfs";
import { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import { app, nativeImage, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AppIcon } from "../runtime/resolve-app-icon.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { LogFactory } from "@novel-master/core/log";

const log = LogFactory.create("desktop.vfs-batch");

/**
 * Windows 上 `nativeImage.createEmpty()` + `startDrag` 会硬崩主进程（try/catch 拦不住）。
 * 1×1 PNG 兜底，保证 icon 非空。
 */
const FALLBACK_DRAG_ICON_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * `UserVfsTurnExecuteService.executeSessionOp` 的错误侧是 `unknown`（user-vfs-turn port 的异构
 * 形态），writer 端口契约是 `Result<void, AppError>`——在此归一：AppError 原样
 * 透传，其余包 INFRA_UNEXPECTED_ERROR（与 formatIpcError 的未知分支同款）。
 * （原 ingestVfsFromHostPaths / collectHostPathEntries / pickHostFileWithDialog /
 * exportVfsFileWithDialog 已内联进 ipc/handlers/vfs.ts 的对应 handler。）
 */

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

export namespace VfsBatchService {
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
    const iconPath = AppIcon.resolvePath();
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
   * staging 根目录的权威基准（`userData/vfs-batch-export`）。
   *
   * 抽成单一函数是给 `clearStaging` 的包含断言与 stagingRoot 构造共用，
   * 消除「两处各写一遍基准」的漂移（S-D-02）。
   */
  function stagingBase(): string {
    return join(app.getPath("userData"), "vfs-batch-export");
  }

  /** 删除 export staging 临时目录；dragEnd / 取消 / 失败 / TTL 到期时调用。 */
  // nm-style: keep-local — vfs-batch-staging.test 直引断言 S-D-02 路径包含护栏与 TTL 清理（7 个调用点）；内联会破坏测试锁名。
  export async function clearStaging(stagingRoot: string): Promise<void> {
    if (stagingRoot.trim() === "") {
      return;
    }
    // S-D-02 路径包含断言：IPC 通道把 renderer 传来的 stagingRoot 原样交给
    // `rm(recursive: true, force: true)`，若通道本身不校验，传 `C:\Users\<用户>` 或 `/`
    // 都会被递归删除。基准只接受 staging 根自身或其下的子目录。
    // ⚠️ 必须带分隔符再拼：`base + "-evil"` 这类前缀撞车要一并拒掉。
    const resolved = resolve(stagingRoot);
    const base = resolve(stagingBase());
    if (resolved !== base && !resolved.startsWith(base + sep)) {
      // nm-throw: keep — 安全护栏，参数越界说明调用方写错，不能让清理继续
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
  // nm-style: keep-local — 与 clearStaging / stagingTtlCountForTest 共享模块级 stagingTtlTimers 的 TTL 生命周期（测试锁名）；内联进 handler 需跨模块外泄状态。
  export async function stage(runtime: DesktopNovelMasterRuntime, scope: VfsScope, logicalPaths: readonly string[]): Promise<Result<ExportStageResult, AppError>> {
    if (logicalPaths.length === 0) {
      return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "没有可导出的路径" }));
    }

    const batch = VfsServiceFactory.createBatchIo(runtime.conn);
    const planned = await batch.planBatchExport(scope, logicalPaths);
    // 失败沿 Result 返回，由唯一调用方 handleVfsBatchExportStage 转码。
    if (!planned.ok) return Result.err(planned.error);
    const plan = planned.value;
    if (plan.files.length === 0 && plan.mkdirPaths.length === 0) {
      return Result.err(new AppError("INFRA_VALIDATION_FAILED", { detail: "导出内容为空" }));
    }

    const stagingRoot = join(stagingBase(), randomUUID());
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

  /** 调用 webContents.startDrag；已知失败沿 `Result.err` 返回，由 handler 转码 toast。 */
  // nm-style: keep-local — 依赖同文件私有 drag-icon 管线（resolveDragIcon + FALLBACK_DRAG_ICON_PNG，测试经 resolveDragIconForTest 锁住「禁止 createEmpty」）；内联进 handler 需把 resolveDragIcon 升为导出。
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
}
