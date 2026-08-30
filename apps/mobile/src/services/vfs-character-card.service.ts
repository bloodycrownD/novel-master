/**
 * Mobile VFS character-card import via Core service + system file UI.
 * Flow: confirmed Alert (caller) → picker png/json → importFromBytes.
 */
import {
  CharacterCardError,
  createCharacterCardImportService,
  type CharacterCardImportOptions,
  type VfsScope,
} from '@novel-master/core/vfs';
import {pickAndReadBytes} from './document-io';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {
  assertCharacterCardFileName,
  characterCardImportPickTypes,
} from './character-card-document-pick';

export async function importCharacterCard(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: Pick<CharacterCardImportOptions, 'confirmed'> & {
    readonly directoryPath?: string;
  },
): Promise<void> {
  const bytes = await pickAndReadBytes({
    mimeTypes: characterCardImportPickTypes(),
    fallbackLocalFileName: 'character-card.json',
    assertFileName: assertCharacterCardFileName,
    buildCopyError: copyError =>
      new CharacterCardError(
        'NOT_CHARACTER_CARD',
        copyError ?? '无法读取所选角色卡文件',
      ),
    buildMissingError: fsPath =>
      new CharacterCardError('NOT_CHARACTER_CARD', `角色卡文件不存在：${fsPath}`),
  });
  if (bytes == null) {
    return;
  }

  const directoryPath =
    options.directoryPath == null || options.directoryPath.trim() === ''
      ? '/'
      : options.directoryPath;
  const svc = createCharacterCardImportService(runtime.conn);
  await svc.importFromBytes(scope, bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}
