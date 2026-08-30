import {decode, encode, parseText, stringifyText} from '@novel-master/core';
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {
  agentDefinitionSchema,
  validateAgentDefinition,
  type AgentDefinition,
} from '@novel-master/core/agent';

import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {
  exportYamlFile,
  importYamlFile,
  normalizeYamlError,
} from './yaml-shared';

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
  return exportYamlFile(yaml, `${agentId}.agent.yaml`);
}

export async function importAgentYaml(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<void> {
  await importYamlFile(async yaml => {
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
  });
}
