import ReactNativeBlobUtil from 'react-native-blob-util';
import { decode, encode, parseText, registerBuiltinTools, stringifyText, ToolRegistry } from "@novel-master/core";

import { agentDefinitionSchema, validateAgentDefinition, type AgentDefinition } from "@novel-master/core/agent";
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  saveDocuments,
} from '@react-native-documents/picker';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {assertYamlFileName, yamlImportPickTypes} from './yaml-document-pick';

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

export function decodeAgentYamlText(yaml: string) {
  const raw = parseText(yaml, 'yaml');
  return decode(raw, agentDefinitionSchema);
}

export function encodeAgentYamlText(def: AgentDefinition): string {
  const doc = encode(def, agentDefinitionSchema);
  return stringifyText(doc, 'yaml');
}

export async function exportAgentYaml(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<'saved' | 'cancelled'> {
  const def = await runtime.agentRegistry.get(agentId);
  const yaml = encodeAgentYamlText(def);
  const fileName = `${agentId}.agent.yaml`;
  const fs = blobFs();
  const tmpPath = `${fs.dirs.CacheDir}/${fileName}`;
  await fs.writeFile(tmpPath, yaml, 'utf8');
  try {
    await saveDocuments({
      sourceUris: [`file://${tmpPath}`],
      mimeType: 'application/yaml',
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

export async function importAgentYaml(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<void> {
  const [file] = await pick({
    type: yamlImportPickTypes(),
    allowMultiSelection: false,
  });
  if (file == null) {
    return;
  }
  assertYamlFileName(file.name);
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
  const fs = blobFs();
  const yaml = await fs.readFile(decodeURIComponent(fsPath), 'utf8');
  try {
    const def = decodeAgentYamlText(yaml);
    const probe = new ToolRegistry();
    registerBuiltinTools(probe);
    await validateAgentDefinition(def, {registeredToolNames: probe.list()});
    await runtime.agentRegistry.upsert(agentId, def, {
      registeredToolNames: probe.list(),
    });
  } catch (error) {
    throw normalizeYamlError(error, 'Agent YAML 无效');
  }
}
