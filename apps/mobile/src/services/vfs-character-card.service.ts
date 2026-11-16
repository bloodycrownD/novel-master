/**
 * Mobile VFS character-card import via Core service + system file UI.
 * Flow: confirmed Alert (caller) → picker png/json → importFromBytes.
 */
import {AppError, createCharacterCardImportService, CHARACTER_CARD_MAX_INPUT_BYTES, type CharacterCardImportOptions, type VfsScope} from '@novel-master/core/vfs';
import {pickAndReadBytes, type PickAndReadOptions} from './document-io';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {assertCharacterCardFileName, characterCardImportPickTypes} from './character-card-document-pick';

type CharacterCardImportRequest = Pick<CharacterCardImportOptions, 'confirmed'> & {
  readonly directoryPath?: string;
};

export async function importCharacterCard(runtime: MobileNovelMasterRuntime, scope: VfsScope, options: CharacterCardImportRequest): Promise<void> {
  const pickOptions: PickAndReadOptions = {
    mimeTypes: characterCardImportPickTypes(),
    fallbackLocalFileName: 'character-card.json',
    // assertFileName 槽位只认 throw：校验失败从 Result 原样解包成 throw 中止导入。
    assertFileName: name => {
      const check = assertCharacterCardFileName(name);
      if (!check.ok) {
        throw check.error;
      }
    },
    // 读取前 stat 预检：巨型卡片不进整读/解析链，避免原生 OOM；
    // 与 core 层 importFromBytes 的 bytes.length 闸门同阈值双保险。
    maxBytes: CHARACTER_CARD_MAX_INPUT_BYTES,
    buildTooLargeError: sizeBytes =>
      new AppError('VFS_CHARACTER_CARD_TOO_LARGE', {detail: `角色卡文件过大：${sizeBytes} 字节，超过输入上限 ${CHARACTER_CARD_MAX_INPUT_BYTES} 字节（约 48MB），已拒绝导入`}),
    buildCopyError: copyError => new AppError('VFS_CHARACTER_CARD_UNRECOGNIZED', {detail: copyError ?? '无法读取所选角色卡文件'}),
    buildMissingError: fsPath => new AppError('VFS_CHARACTER_CARD_UNRECOGNIZED', {detail: `角色卡文件不存在：${fsPath}`}),
  };
  const bytes = await pickAndReadBytes(pickOptions);
  if (bytes == null) {
    return;
  }

  const directoryPath = options.directoryPath == null || options.directoryPath.trim() === '' ? '/' : options.directoryPath;
  const svc = createCharacterCardImportService(runtime.conn);
  await svc.importFromBytes(scope, bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}
