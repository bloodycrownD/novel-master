/**
 * Mobile YAML 导入导出的公共编排。
 *
 * 这里集中处理 RN BlobUtil 的 CJS/ESM 双形态适配、文档选择器
 * （`@react-native-documents/picker`）的 save/pick/keepLocalCopy 流程，
 * 以及统一的错误归一。具体每个 schema 的 decode/encode 和落库逻辑
 * 交给调用方以回调注入，避免把业务知识塞进这层。
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments,
} from '@react-native-documents/picker';

import {assertYamlFileName, yamlImportPickTypes} from './yaml-document-pick';

/**
 * 取 `react-native-blob-util` 的 fs 模块。
 *
 * WHY: RN native modules 在测试环境或不同 bundler 下可能以 CJS
 * 或 ESM 包裹形态出现，这里同时兼容两种形状，省得每个调用方都写一遍。
 */
export function blobFs(): typeof ReactNativeBlobUtil.fs {
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

/** 把任意错误归一成 `Error`，并在前面拼上业务 fallback 文案。 */
export function normalizeYamlError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(`${fallback}：${error.message}`);
  }
  return new Error(fallback);
}

/**
 * 把 YAML 文本通过文档选择器保存到用户指定位置。
 *
 * 内部先写入 CacheDir 的临时文件，再走 `saveDocuments` 弹出系统保存 UI；
 * 不管保存成功还是取消，都会在 finally 里清理临时文件，避免污染缓存。
 */
export async function exportYamlFile(
  yaml: string,
  fileName: string,
): Promise<'saved' | 'cancelled'> {
  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/${fileName}`;
  await fs.writeFile(tmpPath, yaml, 'utf8');
  try {
    await saveDocuments({
      sourceUris: [`file://${tmpPath}`],
      mimeType: 'application/yaml',
      fileName,
      copy: true,
    });
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

/**
 * 通过文档选择器挑选一个 YAML 文件，把内容读出来交给 `consume` 回调。
 *
 * 流程是：pick → 校验文件名 → keepLocalCopy 落到 caches 目录 →
 * 通过 blobUtil 读出 UTF-8 文本。decode/validate/persist 的逻辑
 * 全部由调用方在 `consume` 里完成，方便按各 schema 自己处理。
 */
export async function importYamlFile(
  consume: (yamlText: string) => Promise<void>,
): Promise<void> {
  const [file] = await pick({
    type: yamlImportPickTypes(),
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }
  assertYamlFileName(file.name);
  const [local] = await keepLocalCopy({
    files: [{uri: file.uri, fileName: file.name ?? 'yaml-import.yaml'}],
    destination: 'cachesDirectory',
  });
  if (local.status !== 'success') {
    throw new Error(local.copyError ?? '无法读取 YAML 文件');
  }
  const fsPath = local.localUri.startsWith('file://')
    ? local.localUri.slice('file://'.length)
    : local.localUri;
  const fs = blobFs();
  const yaml = await fs.readFile(decodeURIComponent(fsPath), 'utf8');
  await consume(yaml);
}
