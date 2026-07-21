/**
 * Mobile VFS 单文件导入/导出（系统选择器对多文件/目录支持不稳定，故不做批量）。
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
  type VfsService,
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

function basename(logicalPath: string): string {
  const parts = logicalPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'file';
}

function resolveScopedVfs(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
): VfsService {
  if (scope.kind === 'global') {
    return runtime.globalVfs();
  }
  if (scope.kind === 'project') {
    return runtime.projectVfs(scope.projectId);
  }
  return runtime.sessionVfs(scope.projectId, scope.sessionId);
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

export type FileIngestOutcome =
  | {readonly status: 'cancelled'}
  | {
      readonly status: 'needs_confirm';
      readonly entry: BatchIngestRawEntry;
      readonly conflictPath: string;
    }
  | {
      readonly status: 'applied';
      readonly report: BatchApplyReport;
      readonly skippedBinary: readonly string[];
    };

async function readPickedFileAsEntry(file: {
  uri: string;
  name: string | null;
}): Promise<BatchIngestRawEntry> {
  const name = (file.name ?? 'unnamed').replace(/^\/+/, '');
  const [copyResult] = await keepLocalCopy({
    files: [{uri: file.uri, fileName: name}],
    destination: 'cachesDirectory',
  });
  if (copyResult.status !== 'success') {
    throw new Error(copyResult.copyError ?? '无法读取所选文件');
  }
  const fsPath = localUriToFsPath(copyResult.localUri);
  let base64: string;
  try {
    base64 = await blobFs().readFile(fsPath, 'base64');
  } catch (error) {
    const detail = error instanceof Error ? error.message : '读取文件内容失败';
    throw new Error(detail);
  }
  return {
    relativePath: name,
    kind: 'file',
    bytes: base64ToBytes(base64),
  };
}

/**
 * 单文件导入：系统选一个文件 → 写入当前目录。
 */
export async function importVfsFile(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: {
    readonly targetDir: string;
    readonly overwriteConfirmed?: boolean;
    /** 冲突确认后再次调用时传入上次选中的 entry */
    readonly preparedEntry?: BatchIngestRawEntry;
  },
): Promise<FileIngestOutcome> {
  const targetDir = resolveTargetDir(options.targetDir);
  let entry = options.preparedEntry;

  if (entry == null) {
    let picked: ReadonlyArray<{uri: string; name: string | null}>;
    try {
      picked = await pick({
        allowMultiSelection: false,
        type: [types.allFiles],
      });
    } catch (error) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
        return {status: 'cancelled'};
      }
      throw error;
    }
    const file = picked[0];
    if (file == null) {
      return {status: 'cancelled'};
    }
    entry = await readPickedFileAsEntry(file);
  }

  const batch = createVfsBatchIoService(runtime.conn);
  const plan = await batch.planBatchIngest(scope, targetDir, [entry]);

  if (plan.conflicts.length > 0 && options.overwriteConfirmed !== true) {
    return {
      status: 'needs_confirm',
      entry,
      conflictPath: plan.conflicts[0]!.logicalPath,
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

/**
 * 单文件导出：VFS 读文件 → saveDocuments 另存。
 */
export async function exportVfsFile(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  logicalPath: string,
): Promise<'saved' | 'cancelled'> {
  const vfs = resolveScopedVfs(runtime, scope);
  const read = await vfs.read(logicalPath);
  const fileName = basename(logicalPath);
  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/vfs-export-${Date.now()}-${fileName}`;

  try {
    await fs.writeFile(tmpPath, read.content, 'utf8');
    const [result] = await saveDocuments({
      sourceUris: [toFileUri(tmpPath)],
      mimeType: 'text/plain',
      fileName,
      copy: true,
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    return 'saved';
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
      return 'cancelled';
    }
    throw error;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export function formatFileIngestToast(
  report: BatchApplyReport,
  skippedBinary: readonly string[],
): string {
  if (skippedBinary.length > 0) {
    return '已跳过二进制文件';
  }
  if (report.written.length > 0) {
    return '文件已导入';
  }
  if (report.failed.length > 0) {
    return `导入失败：${report.failed[0]?.message ?? '未知错误'}`;
  }
  if (report.skipped.length > 0) {
    return '已跳过同名文件';
  }
  return '导入完成';
}
