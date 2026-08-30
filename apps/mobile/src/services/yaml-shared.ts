/**
 * Mobile YAML 导入导出的公共编排。
 *
 * 选择器的 save/pick/keepLocalCopy 编排统一走 `document-io`；
 * 错误归一已经抽到 core 的 `normalizeYamlError`，这里直接复用；具体
 * 每个 schema 的 decode/encode 和落库逻辑交给调用方以回调注入，避免
 * 把业务知识塞进这层。
 */
export {normalizeYamlError} from '@novel-master/core/common';

import {exportBytesViaDocumentPicker, pickAndReadText} from './document-io';
import {blobFs} from './rn-file-io';
import {assertYamlFileName, yamlImportPickTypes} from './yaml-document-pick';

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
  return exportBytesViaDocumentPicker({
    fileName,
    mimeType: 'application/yaml',
    write: tmpPath => blobFs().writeFile(tmpPath, yaml, 'utf8'),
  });
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
  const yaml = await pickAndReadText({
    mimeTypes: yamlImportPickTypes(),
    fallbackLocalFileName: 'yaml-import.yaml',
    assertFileName: assertYamlFileName,
    buildCopyError: copyError => new Error(copyError ?? '无法读取 YAML 文件'),
  });
  if (yaml == null) {
    return;
  }
  await consume(yaml);
}
