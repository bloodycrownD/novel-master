import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  decode,
  eventsConfigSchema,
  parseText,
  stringifyText,
} from '@novel-master/core';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments,
  types,
} from '@react-native-documents/picker';
import type {MobileNovelMasterRuntime} from '../runtime/types';

function blobFs(): typeof ReactNativeBlobUtil.fs {
  const anyMod = ReactNativeBlobUtil as unknown as {
    fs?: typeof ReactNativeBlobUtil.fs;
    default?: {fs?: typeof ReactNativeBlobUtil.fs};
  };
  // WHY: RN native modules may be CJS or ESM-wrapped; support both shapes in tests/bundlers.
  const fs = anyMod.fs ?? anyMod.default?.fs;
  if (fs == null) {
    throw new Error('react-native-blob-util.fs unavailable');
  }
  return fs;
}

function normalizeYamlError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(`${fallback}：${error.message}`);
  }
  return new Error(fallback);
}

export function decodeEventsYamlText(yaml: string) {
  const raw = parseText(yaml, 'yaml');
  return decode(raw, eventsConfigSchema);
}

export function encodeEventsYamlText(config: unknown): string {
  return stringifyText(config, 'yaml');
}

export async function exportEventsYaml(
  runtime: MobileNovelMasterRuntime,
): Promise<'saved' | 'cancelled'> {
  const config = await runtime.eventsConfig.getConfig();
  const yaml = encodeEventsYamlText(config);
  const fileName = 'events.config.yaml';
  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/${fileName}`;
  await fs.writeFile(tmpPath, yaml, 'utf8');
  try {
    await saveDocuments({
      sourceUris: [`file://${tmpPath}`],
      mimeType: 'application/x-yaml',
      fileName,
      copy: true,
    });
    return 'saved';
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
      return 'cancelled';
    }
    throw error;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function importEventsYaml(runtime: MobileNovelMasterRuntime): Promise<void> {
  const [file] = await pick({
    type: [types.plainText, 'text/yaml', 'application/x-yaml'],
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }
  const [local] = await keepLocalCopy({
    files: [{uri: file.uri, fileName: file.name ?? 'events.config.yaml'}],
    destination: 'cachesDirectory',
  });
  if (local.status !== 'success') {
    throw new Error(local.copyError ?? '无法读取 YAML 文件');
  }
  const fsPath = local.localUri.startsWith('file://')
    ? local.localUri.slice('file://'.length)
    : local.localUri;
  const fs = blobFs();
  const yaml = await fs.readFile(decodeURIComponent(fsPath), 'utf8');
  try {
    const config = decodeEventsYamlText(yaml);
    await runtime.eventsConfig.setConfig(config);
  } catch (error) {
    throw normalizeYamlError(error, 'Events YAML 无效');
  }
}
