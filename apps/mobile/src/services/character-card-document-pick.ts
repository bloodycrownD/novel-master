import {types} from '@react-native-documents/picker';

import {AppError, Result} from '@novel-master/core/errors';

import {knownTypesForExtension} from './document-io';

const CHARACTER_CARD_NAME_RE = /\.(png|json)$/i;

/** MIME / UTType filters for character-card import (PNG + JSON). */
export function characterCardImportPickTypes(): string[] {
  const fromExtensions = ['png', 'json'].flatMap(knownTypesForExtension);
  return [
    types.images,
    types.json,
    types.plainText,
    'image/png',
    'application/json',
    ...fromExtensions,
    // WHY: Downloads / file managers often tag cards as octet-stream.
    'application/octet-stream',
  ];
}

/**
 * 校验角色卡文件名；失败沿 `Result.err` 返回（纯校验，不可能被中断）。
 *
 * document-io 的 `PickLocalFileOptions.assertFileName` 是 `=> void` 的
 * throw-only 槽位（「抛错即中止导入」），签名表达不了 Result 位；注入点
 * （vfs-character-card.service）把 Err 原样解包为 throw，错误对象与文案不变。
 */
export function assertCharacterCardFileName(name: string | null | undefined): Result<void, AppError> {
  if (name == null || !CHARACTER_CARD_NAME_RE.test(name)) {
    return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '请选择 .png 或 .json 文件'}));
  }
  return Result.ok(undefined);
}
