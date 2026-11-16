import {types} from '@react-native-documents/picker';

import {AppError, Result} from '@novel-master/core/errors';

import {knownTypesForExtension} from './document-io';

const YAML_NAME_RE = /\.ya?ml$/i;

/** MIME / UTType filters for YAML import (covers export + common Android providers). */
export function yamlImportPickTypes(): string[] {
  const fromExtensions = ['yaml', 'yml'].flatMap(knownTypesForExtension);
  return [
    types.plainText,
    'text/yaml',
    'text/x-yaml',
    'application/yaml',
    'application/x-yaml',
    ...fromExtensions,
    // WHY: Downloads / file managers often tag .yaml as octet-stream, not a YAML MIME.
    'application/octet-stream',
  ];
}

/**
 * 校验 YAML 文件名；失败沿 `Result.err` 返回（纯校验，不可能被中断）。
 *
 * document-io 的 `PickLocalFileOptions.assertFileName` 是 `=> void` 的
 * throw-only 槽位（「抛错即中止导入」），签名表达不了 Result 位；注入点
 * （yaml-shared）把 Err 原样解包为 throw，错误对象与文案不变。
 */
export function assertYamlFileName(name: string | null | undefined): Result<void, AppError> {
  if (name == null || !YAML_NAME_RE.test(name)) {
    return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '请选择 .yaml 或 .yml 文件'}));
  }
  return Result.ok(undefined);
}
