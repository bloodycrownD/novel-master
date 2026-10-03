/**
 * Mobile VFS 单文件导入导出：直调 core 的 batch-io 服务 + 系统文件 UI。
 *
 * 导入：文档选择器 → 读字节（带原件名）→ planBatchIngest 单条目 → 有同名冲突
 * 先返回覆盖确认请求（不落库）→ 用户确认后 applyBatchIngest。
 * 导出：planBatchExport 单元素 → 取出唯一文件 → 经「另存为」写 utf8。
 *
 * 口径（spec D6/D7）：
 * - **不走** pickAndReadText：`readFile utf8` 会把任意二进制静默解码成乱码写进
 *   VFS（比 core 跳过后更糟的静默损坏）。这里只读字节，二进制由 core 的
 *   tryDecodeUtf8 判进 skippedBinary，再由 UI 明示跳过。
 * - 导入直写 DB（与 zip 导入同口径），不走 userVfsTurn 之类的编辑链路约定；
 *   session scope 下 core 会顺带清该会话的提示词缓存（R5）。
 */
import {
  createVfsBatchIoService,
  type BatchApplyReport,
  type BatchIngestPlan,
  type VfsScope,
} from '@novel-master/core/vfs';
import {
  exportBytesViaDocumentPicker,
  knownTypesForExtension,
  pickAndReadFileWithMeta,
} from './document-io';
import {blobFs} from './rn-file-io';
import {vfsSingleFileImportPickTypes} from './vfs-single-file-document-pick';
import {VfsSingleFileError} from '../errors/vfs-single-file-error';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/**
 * 单文件导入的读取上限（32MB 量级，与 zip 解压闸同量级）。
 *
 * WHY：整包读进 JS 堆，超大文件在 Hermes 上有 OOM 风险，故读前用 stat 预检拦掉
 * （与 core 的 bytes.length 闸门双保险）。
 */
const VFS_SINGLE_FILE_MAX_INPUT_BYTES = 32 * 1024 * 1024;

/** 未知扩展名时 saveDocuments 的 MIME 兜底（knownTypesForExtension 返回 []）。 */
const FALLBACK_EXPORT_MIME_TYPE = 'text/plain';

/** 覆盖确认请求：确认前不落库；`confirm()` 复用本次已选字节完成写入。 */
export interface VfsSingleFileConfirmRequest {
  readonly status: 'needs-confirm';
  /** 同名冲突数量（= core 报的 conflicts 条数）。 */
  readonly conflictCount: number;
  /** 将要写入的逻辑路径所属的原件名，供确认文案使用。 */
  readonly fileName: string;
  /**
   * 用户确认覆盖后的落库入口。
   *
   * WHY 挂闭包而不是让调用方二次调用导入：picker 里选出来的字节必须和
   * 「用户看到的那个待覆盖文件」是同一份，二次调用会再弹一次选择器，
   * 用户可能改选另一个文件，等于用确认框给别的文件开了覆盖。
   */
  readonly confirm: () => Promise<VfsSingleFileAppliedResult>;
}

/** 已落库的结果。 */
export interface VfsSingleFileAppliedResult {
  readonly status: 'applied';
  readonly report: BatchApplyReport;
  /**
   * plan 阶段被判非 UTF-8 而跳过的相对路径（非空时 UI 应明示「跳过 N 个非
   * UTF-8 文件」）。
   */
  readonly skippedBinary: readonly string[];
}

export type VfsSingleFileImportResult =
  | {readonly status: 'cancelled'}
  | VfsSingleFileConfirmRequest
  | VfsSingleFileAppliedResult;

export interface VfsSingleFileImportOptions {
  /** 目标目录（逻辑路径）；空/缺省按根目录 `/` 处理。 */
  readonly targetDir?: string;
}

/** 归一目标目录：空值与根路径别名都收敛成 `/`（与 zip 导入同口径）。 */
function normalizeTargetDir(targetDir: string | undefined): string {
  return targetDir == null || targetDir.trim() === '' ? '/' : targetDir;
}

/**
 * 导入单个文件到 VFS。
 *
 * picker 取消（`pickSingleDocument` 内部已 toast「已取消」）→ 静默返回
 * `cancelled`，不触达 core；同名冲突 → 返回 `needs-confirm` 且**不** apply；
 * 其余（含二进制被判跳过）→ apply 并返回 `applied`。
 */
export async function importVfsSingleFile(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: VfsSingleFileImportOptions = {},
): Promise<VfsSingleFileImportResult> {
  const picked = await pickAndReadFileWithMeta({
    mimeTypes: vfsSingleFileImportPickTypes(),
    // 缓存目录里的固定临时名：原件名走 fileName 返回，不靠落盘名反推。
    localFileName: 'import.bin',
    maxBytes: VFS_SINGLE_FILE_MAX_INPUT_BYTES,
    buildTooLargeError: sizeBytes =>
      new VfsSingleFileError(
        `文件过大：${sizeBytes} 字节，超过导入上限 ${VFS_SINGLE_FILE_MAX_INPUT_BYTES} 字节（约 32MB），已拒绝导入`,
      ),
    buildCopyError: copyError =>
      new VfsSingleFileError(copyError ?? '无法读取所选文件'),
    buildMissingError: fsPath =>
      new VfsSingleFileError(`所选文件不存在：${fsPath}`),
  });
  if (picked == null) {
    return {status: 'cancelled'};
  }

  const targetDir = normalizeTargetDir(options.targetDir);
  const batchIo = createVfsBatchIoService(runtime.conn);
  const plan = await batchIo.planBatchIngest(scope, targetDir, [
    {relativePath: picked.fileName, kind: 'file', bytes: picked.bytes},
  ]);

  const apply = async (): Promise<VfsSingleFileAppliedResult> => {
    const report = await batchIo.applyBatchIngest(
      scope,
      targetDir,
      plan,
      {overwriteConfirmed: true},
    );
    return {status: 'applied', report, skippedBinary: [...plan.skippedBinary]};
  };

  if (plan.conflicts.length > 0) {
    return {
      status: 'needs-confirm',
      conflictCount: plan.conflicts.length,
      fileName: picked.fileName,
      confirm: apply,
    };
  }
  return apply();
}

/** 相对路径取末段（单文件导出的 relativePath 即 basename，这里兜住异常形态）。 */
function baseNameOf(relativePath: string): string {
  const normalized = relativePath.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** 取扩展名（不含点）；无点或点开头（`.gitignore`）返回空串。 */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1) : '';
}

/**
 * 导出单个 VFS 文件到用户指定位置。
 *
 * `logicalPath` 必须是**文件**：core 的 planBatchExport 对目录会递归整棵子树，
 * 这里按 spec D4 的口径校验 files.length === 1，误传目录直接报错不写盘。
 */
export async function exportVfsSingleFile(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  logicalPath: string,
): Promise<'saved' | 'cancelled'> {
  const batchIo = createVfsBatchIoService(runtime.conn);
  const plan = await batchIo.planBatchExport(scope, [logicalPath]);
  if (plan.files.length !== 1) {
    throw new VfsSingleFileError(`导出目标不是单个文件：${logicalPath}`);
  }

  const file = plan.files[0]!;
  const fileName = baseNameOf(file.relativePath);
  // knownTypesForExtension 依赖原生模块，未知扩展名返回 []（测试环境恒 []），
  // saveDocuments 的 mimeType 必填，故兜底不可省。
  const mimeType =
    knownTypesForExtension(extensionOf(fileName))[0] ?? FALLBACK_EXPORT_MIME_TYPE;

  return exportBytesViaDocumentPicker({
    fileName,
    mimeType,
    // VFS 内容本就是 core 解码过的 UTF-8 文本，走 utf8 直写，不绕 base64。
    write: tmpPath => blobFs().writeFile(tmpPath, file.content, 'utf8'),
  });
}
