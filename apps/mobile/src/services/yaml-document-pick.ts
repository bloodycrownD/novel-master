import {isKnownType, types} from '@react-native-documents/picker';

const YAML_NAME_RE = /\.ya?ml$/i;

function knownTypesForExtension(ext: string): string[] {
  try {
    const info = isKnownType({kind: 'ext', value: ext});
    return [info.mimeType, info.uti].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  } catch {
    return [];
  }
}

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
  if (name == null || !YAML_NAME_RE.test(name)) {
    throw new Error('请选择 .yaml 或 .yml 文件');
  }
}
