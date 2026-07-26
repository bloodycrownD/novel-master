/**
 * Mobile VFS character-card import via Core service + system file UI.
 * Flow: confirmed Alert (caller) → picker png/json → importFromBytes.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  CharacterCardError,
  createCharacterCardImportService,
  type CharacterCardImportOptions,
  type VfsScope,
} from '@novel-master/core/vfs';
import {keepLocalCopy, pick} from '@react-native-documents/picker';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {
  assertCharacterCardFileName,
  characterCardImportPickTypes,
} from './character-card-document-pick';

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** blob-util on Android mishandles `file://` + encoded paths; use absolute fs path. */
function localUriToFsPath(localUri: string): string {
  const withoutScheme = localUri.startsWith('file://')
    ? localUri.slice('file://'.length)
    : localUri;
  return decodeURIComponent(withoutScheme);
}

async function readFileUriAsBytes(localUri: string): Promise<Uint8Array> {
  const fsPath = localUriToFsPath(localUri);
  const exists = await ReactNativeBlobUtil.fs.exists(fsPath);
  if (!exists) {
    throw new CharacterCardError(
      'NOT_CHARACTER_CARD',
      `角色卡文件不存在：${fsPath}`,
    );
  }
  const base64 = await ReactNativeBlobUtil.fs.readFile(fsPath, 'base64');
  return base64ToBytes(base64);
}

async function readPickedCardAsBytes(
  uri: string,
  fileName: string,
): Promise<Uint8Array> {
  const [copyResult] = await keepLocalCopy({
    files: [{uri, fileName}],
    destination: 'cachesDirectory',
  });

  if (copyResult.status !== 'success') {
    throw new CharacterCardError(
      'NOT_CHARACTER_CARD',
      copyResult.copyError ?? '无法读取所选角色卡文件',
    );
  }

  return readFileUriAsBytes(copyResult.localUri);
}

export async function importCharacterCard(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  options: Pick<CharacterCardImportOptions, 'confirmed'> & {
    readonly directoryPath?: string;
  },
): Promise<void> {
  const [file] = await pick({
    type: characterCardImportPickTypes(),
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }

  assertCharacterCardFileName(file.name);

  const directoryPath =
    options.directoryPath == null || options.directoryPath.trim() === ''
      ? '/'
      : options.directoryPath;
  const bytes = await readPickedCardAsBytes(
    file.uri,
    file.name ?? 'character-card.json',
  );
  const svc = createCharacterCardImportService(runtime.conn);
  await svc.importFromBytes(scope, bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
}
