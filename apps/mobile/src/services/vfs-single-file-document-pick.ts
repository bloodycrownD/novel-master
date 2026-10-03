/**
 * Mobile VFS 单文件导入的选择器 MIME 白名单（形态照 yaml-document-pick）。
 *
 * 口径说明：白名单只是「尽量把选择器过滤得准一点」，**不是安全边界**——
 * Downloads / 各家文件管理器经常把任意文件打成 application/octet-stream，
 * 白名单挡不住，最终把关在 core 的 UTF-8 校验（plan 阶段判非 UTF-8 进
 * skippedBinary，由 UI 明示跳过），不做静默解码写库。
 */
import {types} from '@react-native-documents/picker';

import {knownTypesForExtension} from './document-io';

/** VFS 里常见的文本类扩展名（把系统已知的 MIME 也一并放进白名单）。 */
const TEXTUAL_EXTENSIONS = [
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'csv',
  'html',
  'log',
];

/** MIME / UTType filters for single-file VFS import（文本类白名单 + octet-stream 兜底）。 */
export function vfsSingleFileImportPickTypes(): string[] {
  const fromExtensions = TEXTUAL_EXTENSIONS.flatMap(knownTypesForExtension);
  return [
    types.plainText,
    types.json,
    'text/markdown',
    'text/html',
    'text/csv',
    'application/xml',
    'text/xml',
    ...fromExtensions,
    // WHY: Downloads / file managers often tag any file as octet-stream, so the
    // whitelist alone would block legitimate picks; the real gate is core's
    // UTF-8 check (skippedBinary), not this list.
    'application/octet-stream',
  ];
}