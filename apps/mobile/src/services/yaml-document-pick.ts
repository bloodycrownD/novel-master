import {types} from '@react-native-documents/picker';

import {AppError} from '@novel-master/core/agent';

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

export function assertYamlFileName(name: string | null | undefined): void {
  // 平台例外（错误通道迁移五期裁决保留）：assertFileName 是 document-io
  // `PickLocalFileOptions.assertFileName`（`=> void`）的 throw-only 回调协议位
  // （「抛错即中止导入」），签名定义不了 Result 位，按总纲 §2.1-Q3 保留 throw。
  if (name == null || !YAML_NAME_RE.test(name)) {
    throw new AppError('INFRA_VALIDATION_FAILED', {detail: '请选择 .yaml 或 .yml 文件'});
  }
}
