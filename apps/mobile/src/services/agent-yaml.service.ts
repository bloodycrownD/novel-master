import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  agentDefinitionSchema,
  decode,
  parseText,
  registerVfsTools,
  stringifyText,
  ToolRegistry,
  validateAgentDefinition,
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

function normalizeYamlError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(`${fallback}：${error.message}`);
  }
  return new Error(fallback);
}

export function decodeAgentYamlText(yaml: string) {
  const raw = parseText(yaml, 'yaml');
  return decode(raw, agentDefinitionSchema);
}

export async function exportAgentYaml(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<'saved' | 'cancelled'> {
  const def = await runtime.agentRegistry.get(agentId);
  const doc = agentDefinitionSchema.encode(def);
  const yaml = stringifyText(doc, 'yaml');
  const fileName = `${agentId}.agent.yaml`;
  const tmpPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;
  await ReactNativeBlobUtil.fs.writeFile(tmpPath, yaml, 'utf8');
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
    await ReactNativeBlobUtil.fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function importAgentYaml(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<void> {
  const [file] = await pick({
    type: [types.plainText, 'text/yaml', 'application/x-yaml'],
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }
  const [local] = await keepLocalCopy({
    files: [{uri: file.uri, fileName: file.name ?? `${agentId}.agent.yaml`}],
    destination: 'cachesDirectory',
  });
  if (local.status !== 'success') {
    throw new Error(local.copyError ?? '无法读取 YAML 文件');
  }
  const fsPath = local.localUri.startsWith('file://')
    ? local.localUri.slice('file://'.length)
    : local.localUri;
  const yaml = await ReactNativeBlobUtil.fs.readFile(decodeURIComponent(fsPath), 'utf8');
  try {
    const def = decodeAgentYamlText(yaml);
    const probe = new ToolRegistry();
    registerVfsTools(probe);
    await validateAgentDefinition(def, {registeredToolNames: probe.list()});
    await runtime.agentRegistry.upsert(agentId, def, {
      registeredToolNames: probe.list(),
    });
  } catch (error) {
    throw normalizeYamlError(error, 'Agent YAML 无效');
  }
}
