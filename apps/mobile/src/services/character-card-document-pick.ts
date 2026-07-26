import {isKnownType, types} from '@react-native-documents/picker';

const CHARACTER_CARD_NAME_RE = /\.(png|json)$/i;

function knownTypesForExtension(ext: string): string[] {
  try {
    const info = isKnownType({kind: 'extension', value: ext});
    return [info.mimeType].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  } catch {
    return [];
  }
}

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
    throw new Error('请选择 .png 或 .json 文件');
  }
}
