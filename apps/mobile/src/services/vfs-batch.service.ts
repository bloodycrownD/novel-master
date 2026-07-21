/**
 * Mobile VFS 批量导入/导出：多选 pick → Core plan/apply；导出 saveDocuments 降级。
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
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
} from '@novel-master/core/vfs';
import {isUserVfsUnifiedToolTurnEnabled} from '@novel-master/core/feature-flags';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments,
  types,
} from '@react-native-documents/picker';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {executeSessionUserVfsOp} from './user-vfs-turn-execute.service';

function blobFs(): typeof ReactNativeBlobUtil.fs {
  const anyMod = ReactNativeBlobUtil as unknown as {
    fs?: typeof ReactNativeBlobUtil.fs;
    default?: {fs?: typeof ReactNativeBlobUtil.fs};
  };
  const fs = anyMod.fs ?? anyMod.default?.fs;
  if (fs == null) {
    throw new Error('react-native-blob-util.fs unavailable');
  }
  return fs;
}

function localUriToFsPath(localUri: string): string {
  const withoutScheme = localUri.startsWith('file://')
    ? localUri.slice('file://'.length)
    : localUri;
  return decodeURIComponent(withoutScheme);
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function resolveTargetDir(targetDir?: string): string {
  if (targetDir == null || targetDir.trim() === '') {
    return '/';
  }
  return targetDir;
}

function createSessionBatchWriter(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  scope: Extract<VfsScope, {kind: 'session'}>,
): BatchIngestWriter {
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
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
      const op = buildUserVfsSaveOp(baseline, content, logicalPath, content, {
        versionCheck: false,
      });
      if (op != null) {
        await executeSessionUserVfsOp(runtime, sessionId, op);
      }
    },
  };
}

export type BatchIngestPickPlan = {
  readonly targetDir: string;
  readonly entries: readonly BatchIngestRawEntry[];
  readonly conflicts: ReadonlyArray<{readonly logicalPath: string; readonly reason: 'exists'}>;
  readonly skippedBinary: readonly string[];
  readonly writesCount: number;
};

export type BatchIngestOutcome =
  | {readonly status: 'cancelled'}
  | {
      readonly status: 'needs_confirm';
      readonly plan: BatchIngestPickPlan;
    }
  | {
      readonly status: 'applied';
      readonly report: BatchApplyReport;
      readonly skippedBinary: readonly string[];
    };

async function readPickedFilesAsEntries(
  files: ReadonlyArray<{uri: string; name: string | null}>,
): Promise<BatchIngestRawEntry[]> {
  const entries: BatchIngestRawEntry[] = [];
  for (const file of files) {
    const name = (file.name ?? 'unnamed').replace(/^\/+/, '');
    const [copyResult] = await keepLocalCopy({
      files: [{uri: file.uri, fileName: name}],
      destination: 'cachesDirectory',
    });
    if (copyResult.status !== 'success') {
      continue;
    }
    const fsPath = localUriToFsPath(copyResult.localUri);
    const base64 = await blobFs().readFile(fsPath, 'base64');
    entries.push({
      relativePath: name,
      kind: 'file',
      bytes: base64ToBytes(base64),
    });
  }
  return entries;
}

/**
 * 批量导入：多选文件 → plan；有冲突且未确认则返回 needs_confirm。
 * 当前无选文件夹能力时仅多选文件（不假装导入目录）。
 */
export async function importVfsBatch(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: {
    readonly targetDir: string;
    readonly overwriteConfirmed?: boolean;
    /** 冲突确认后再次调用时传入上次 plan 的 entries */
    readonly preparedEntries?: readonly BatchIngestRawEntry[];
  },
): Promise<BatchIngestOutcome> {
  const targetDir = resolveTargetDir(options.targetDir);
  let entries = options.preparedEntries;

  if (entries == null) {
    let picked: ReadonlyArray<{uri: string; name: string | null}>;
    try {
      picked = await pick({
        allowMultiSelection: true,
        type: [types.allFiles],
      });
    } catch (error) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
        return {status: 'cancelled'};
      }
      throw error;
    }
    if (picked.length === 0) {
      return {status: 'cancelled'};
    }
    entries = await readPickedFilesAsEntries(picked);
    if (entries.length === 0) {
      return {
        status: 'applied',
        report: {written: [], skipped: [], failed: []},
        skippedBinary: [],
      };
    }
  }

  const batch = createVfsBatchIoService(runtime.conn);
  const plan = await batch.planBatchIngest(scope, targetDir, entries);

  if (plan.conflicts.length > 0 && options.overwriteConfirmed !== true) {
    return {
      status: 'needs_confirm',
      plan: {
        targetDir,
        entries,
        conflicts: plan.conflicts.map(c => ({
          logicalPath: c.logicalPath,
          reason: c.reason,
        })),
        skippedBinary: [...plan.skippedBinary],
        writesCount: plan.writes.length,
      },
    };
  }

  const applyOptions = {overwriteConfirmed: options.overwriteConfirmed === true};
  let report: BatchApplyReport;
  if (scope.kind === 'session' && isUserVfsUnifiedToolTurnEnabled()) {
    const writer = createSessionBatchWriter(runtime, scope.sessionId, scope);
    report = await batch.applyBatchIngestWithWriter(
      targetDir,
      plan,
      applyOptions,
      writer,
    );
  } else {
    report = await batch.applyBatchIngest(scope, targetDir, plan, applyOptions);
  }

  return {
    status: 'applied',
    report,
    skippedBinary: [...plan.skippedBinary],
  };
}

export type BatchExportResult =
  | {readonly status: 'saved'; readonly savedCount: number}
  | {readonly status: 'cancelled'; readonly savedCount: number};

/**
 * 批量导出：planBatchExport → cache 物化 → saveDocuments（多文件优先，失败则逐文件）。
 * logicalPaths 为空时由调用方负责传入当前目录。
 */
export async function exportVfsBatch(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: {readonly logicalPaths: readonly string[]},
): Promise<BatchExportResult> {
  if (options.logicalPaths.length === 0) {
    throw new Error('没有可导出的路径');
  }

  const batch = createVfsBatchIoService(runtime.conn);
  const plan = await batch.planBatchExport(scope, options.logicalPaths);
  if (plan.files.length === 0) {
    throw new Error('导出内容为空');
  }

  const fs = blobFs();
  const stamp = Date.now();
  const cacheRoot = `${fs.dirs.CacheDir}/vfs-batch-export-${stamp}`;
  await fs.mkdir(cacheRoot);

  const writtenAbs: {abs: string; fileName: string; relativePath: string}[] =
    [];
  try {
    for (const file of plan.files) {
      const parts = file.relativePath.split('/');
      const fileName = parts[parts.length - 1] ?? 'file';
      let dir = cacheRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = `${dir}/${parts[i]}`;
        const exists = await fs.exists(dir);
        if (!exists) {
          await fs.mkdir(dir);
        }
      }
      // 扁平文件名保留相对路径可辨：用 -- 连接
      const flatName = file.relativePath.replace(/\//g, '--');
      const abs = `${cacheRoot}/${flatName}`;
      await fs.writeFile(abs, file.content, 'utf8');
      writtenAbs.push({abs, fileName: flatName, relativePath: file.relativePath});
    }

    // 优先一次多文件 saveDocuments
    try {
      const results = await saveDocuments({
        sourceUris: writtenAbs.map(w => toFileUri(w.abs)),
        mimeType: 'text/plain',
        fileName: writtenAbs[0]!.fileName,
        copy: true,
      });
      const firstError = results.find(r => r?.error)?.error;
      if (firstError) {
        throw new Error(firstError);
      }
      return {status: 'saved', savedCount: writtenAbs.length};
    } catch (multiErr) {
      if (
        isErrorWithCode(multiErr) &&
        multiErr.code === errorCodes.OPERATION_CANCELED
      ) {
        return {status: 'cancelled', savedCount: 0};
      }
      // 降级：逐文件 saveDocuments
      let savedCount = 0;
      for (const item of writtenAbs) {
        try {
          const [result] = await saveDocuments({
            sourceUris: [toFileUri(item.abs)],
            mimeType: 'text/plain',
            fileName: item.fileName,
            copy: true,
          });
          if (result?.error) {
            throw new Error(result.error);
          }
          savedCount += 1;
        } catch (oneErr) {
          if (
            isErrorWithCode(oneErr) &&
            oneErr.code === errorCodes.OPERATION_CANCELED
          ) {
            return {status: 'cancelled', savedCount};
          }
          throw oneErr;
        }
      }
      return {status: 'saved', savedCount};
    }
  } finally {
    await fs.unlink(cacheRoot).catch(() => undefined);
  }
}

export function formatBatchReportToast(
  report: BatchApplyReport,
  skippedBinary: readonly string[],
): string {
  const parts: string[] = [];
  if (report.written.length > 0) {
    parts.push(`已写入 ${report.written.length}`);
  }
  if (report.skipped.length > 0 || skippedBinary.length > 0) {
    parts.push(
      `跳过 ${report.skipped.length + skippedBinary.length}`,
    );
  }
  if (report.failed.length > 0) {
    parts.push(`失败 ${report.failed.length}`);
  }
  return parts.length > 0 ? `导入完成：${parts.join('，')}` : '导入完成';
}
