/**
 * 文档导入/导出的统一编排层（services/C-2 收编）。
 *
 * 导出侧：CacheDir 临时文件 → saveDocuments → isUserCancelledPick →
 * 返回 'saved'/'cancelled' → finally unlink，保证取消/失败都不留脏文件。
 * 导入侧：pick → keepLocalCopy 落 caches → localUriToFsPath → 读文件。
 * 各业务域的错误类型（VfsZipError / CharacterCardError 等）通过
 * build*Error 回调注入，避免这层反向依赖具体业务。
 */
import {
  isKnownType,
  keepLocalCopy,
  saveDocuments,
} from '@react-native-documents/picker';
import {isUserCancelledPick, pickSingleDocument} from './document-pick';
import {base64ToBytes, blobFs, localUriToFsPath, toFileUri} from './rn-file-io';

/**
 * 所选项既无自带名、又无兜底名时的最终占位名。
 *
 * WHY 必须是常量：单文件导入把 fileName 直接当 VFS 的 relativePath，
 * 空名会让落点退化成目录级路径，必须保证非空。
 */
const DEFAULT_PICKED_FILE_NAME = 'import.bin';

/** 已知扩展名 → MIME 列表（无法识别时返回空数组；services/C-4 收编）。 */
export function knownTypesForExtension(ext: string): string[] {
  try {
    const info = isKnownType({kind: 'extension', value: ext});
    return [info.mimeType].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  } catch {
    return [];
  }
}

export interface ExportViaPickerOptions {
  readonly fileName: string;
  readonly mimeType: string;
  /** 把内容写入临时文件（分块 ascii / base64 / utf8 由调用方决定）。 */
  readonly write: (tmpPath: string) => Promise<void>;
  /** saveDocuments 的 copy 参数，默认 true；备份大文件走 Platform 判定。 */
  readonly copy?: boolean;
}

/**
 * 把内容经系统「另存为」对话框导出：先写 CacheDir 临时文件，再弹保存 UI；
 * 无论成功、取消还是失败，都在 finally 里清理临时文件，避免污染缓存。
 */
export async function exportBytesViaDocumentPicker(
  options: ExportViaPickerOptions,
): Promise<'saved' | 'cancelled'> {
  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/${options.fileName}`;
  await options.write(tmpPath);
  try {
    const [result] =
      (await saveDocuments({
        sourceUris: [toFileUri(tmpPath)],
        mimeType: options.mimeType,
        fileName: options.fileName,
        copy: options.copy ?? true,
      })) ?? [];
    if (result?.error) {
      throw new Error(result.error);
    }
    return 'saved';
  } catch (error) {
    if (isUserCancelledPick(error)) {
      return 'cancelled';
    }
    throw error;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export interface PickLocalFileOptions {
  /** 选择器的 MIME / UTType 过滤。 */
  readonly mimeTypes: readonly string[];
  /** keepLocalCopy 的固定落盘文件名（设置后忽略所选项自带名）。 */
  readonly localFileName?: string;
  /** 所选项无自带文件名时的兜底名。 */
  readonly fallbackLocalFileName?: string;
  /** keepLocalCopy 前的文件名校验（后缀断言等），抛错即中止导入。 */
  readonly assertFileName?: (name: string | null | undefined) => void;
  /** keepLocalCopy 失败时的错误构造（各业务域错误类型不同）。 */
  readonly buildCopyError?: (copyError: string | undefined) => Error;
}

export interface PickedLocalFile {
  readonly fsPath: string;
  /**
   * **原件名**（所选项自带名；为空时退到 `fallbackLocalFileName`，再无则 undefined）。
   *
   * ⚠️ 与本地落盘名（`localFileName`）刻意分开：后者只是缓存目录里的临时名，
   * 会覆盖原件名；需要拿真实文件名决定业务落点的调用方（如单文件导入把它当
   * VFS 的 relativePath）必须读这个字段。
   */
  readonly fileName?: string;
}

/** 选一个文档并拷入 caches 目录，返回本地 fs 路径；用户取消返回 null。 */
export async function pickToLocalPath(
  options: PickLocalFileOptions,
): Promise<PickedLocalFile | null> {
  const file = await pickSingleDocument({type: [...options.mimeTypes]});
  if (file == null) {
    return null;
  }
  options.assertFileName?.(file.name);
  const originalName =
    typeof file.name === 'string' && file.name.trim() !== ''
      ? file.name
      : options.fallbackLocalFileName;
  const fileName =
    options.localFileName ??
    originalName ??
    DEFAULT_PICKED_FILE_NAME;
  const [copyResult] = await keepLocalCopy({
    files: [{uri: file.uri, fileName}],
    destination: 'cachesDirectory',
  });
  if (copyResult.status !== 'success') {
    throw (
      options.buildCopyError?.(copyResult.copyError) ??
      new Error(copyResult.copyError ?? '无法读取所选文件')
    );
  }
  return {
    fsPath: localUriToFsPath(copyResult.localUri),
    fileName: originalName,
  };
}

export interface PickAndReadOptions extends PickLocalFileOptions {
  /** 拷入后的本地文件不存在时的错误构造（各业务域错误类型不同）。 */
  readonly buildMissingError?: (fsPath: string) => Error;
  /** 读取前的体积预检上限（字节）；stat 超过该值时不读字节直接抛错。 */
  readonly maxBytes?: number;
  /** 体积超过 maxBytes 时的错误构造（与 buildMissingError 一样由业务域注入）。 */
  readonly buildTooLargeError?: (sizeBytes: number) => Error;
}

/** 选一个文档并整包读为字节；用户取消返回 null。
 *
 * 传入 `maxBytes` + `buildTooLargeError` 时，拿到本地拷贝路径后先 stat 预检
 * 体积，超限不进读取（避免整读巨型文件触发原生 OOM）；stat 失败容错放行，
 * 由 core 层的 bytes.length 闸门兜底。
 */
export async function pickAndReadBytes(
  options: PickAndReadOptions,
): Promise<Uint8Array | null> {
  const picked = await pickToLocalPath(options);
  if (picked == null) {
    return null;
  }
  await assertLocalFileSizeWithin(picked.fsPath, options);
  return readLocalFileBytes(picked.fsPath, options.buildMissingError);
}

/** `pickAndReadFileWithMeta` 的返回值：字节 + 原件名（fileName 非空保证）。 */
export interface PickedFileWithMeta {
  readonly bytes: Uint8Array;
  /** 原件名；无自带名时退 `fallbackLocalFileName`，再无则 `import.bin`。 */
  readonly fileName: string;
}

/**
 * 选一个文档并整包读为字节，**连同原件名一起返回**；用户取消返回 null。
 *
 * 与 `pickAndReadBytes` 同一条链路（pick → keepLocalCopy → stat 预检 → 读字节），
 * 差别只在多透出 fileName：单文件导入要用它当 VFS 的 relativePath，而
 * `pickAndReadBytes` 的裸字节形态不能改——现有两个调用方整体把它当 bytes 用。
 *
 * `maxBytes` 预检约定与 `pickAndReadBytes` 完全一致：两者必须成对传或都不传，
 * 只传其一则预检整体不生效。
 */
export async function pickAndReadFileWithMeta(
  options: PickAndReadOptions,
): Promise<PickedFileWithMeta | null> {
  const picked = await pickToLocalPath(options);
  if (picked == null) {
    return null;
  }
  await assertLocalFileSizeWithin(picked.fsPath, options);
  const bytes = await readLocalFileBytes(picked.fsPath, options.buildMissingError);
  return {
    bytes,
    fileName: picked.fileName ?? DEFAULT_PICKED_FILE_NAME,
  };
}

/** stat 预检：超过 maxBytes 抛业务错误；stat 失败（权限/时序等）放行走原流程。 */
async function assertLocalFileSizeWithin(
  fsPath: string,
  options: PickAndReadOptions,
): Promise<void> {
  if (options.maxBytes == null || options.buildTooLargeError == null) {
    return;
  }
  let stat: {size?: number} | null;
  try {
    // blobFs() 返回的即 fs 对象（与同文件既有用法一致）
    stat = await blobFs().stat(fsPath);
  } catch {
    return;
  }
  if (
    stat != null &&
    typeof stat.size === 'number' &&
    stat.size > options.maxBytes
  ) {
    throw options.buildTooLargeError(stat.size);
  }
}

/** 选一个文档并以 UTF-8 文本读出；用户取消返回 null。 */
export async function pickAndReadText(
  options: PickLocalFileOptions,
): Promise<string | null> {
  const picked = await pickToLocalPath(options);
  if (picked == null) {
    return null;
  }
  return blobFs().readFile(picked.fsPath, 'utf8');
}

async function readLocalFileBytes(
  fsPath: string,
  buildMissingError?: (fsPath: string) => Error,
): Promise<Uint8Array> {
  const fs = blobFs();
  const exists = await fs.exists(fsPath);
  if (!exists) {
    throw buildMissingError?.(fsPath) ?? new Error(`文件不存在: ${fsPath}`);
  }
  const base64 = await fs.readFile(fsPath, 'base64');
  return base64ToBytes(base64);
}
