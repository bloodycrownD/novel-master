import {types} from '@react-native-documents/picker';

import {AppError} from '@novel-master/core/agent';

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

export function assertCharacterCardFileName(
  name: string | null | undefined,
): void {
  if (name == null || !CHARACTER_CARD_NAME_RE.test(name)) {
    throw new AppError('INFRA_VALIDATION_FAILED', {detail: '请选择 .png 或 .json 文件'});
  }
}
