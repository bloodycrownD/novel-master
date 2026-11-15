import {decode, encode, parseText, stringifyText} from '@novel-master/core';
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {
  agentDefinitionSchema,
  validateAgentDefinition,
  type AgentDefinition,
} from '@novel-master/core/agent';
import {Result} from '@novel-master/core/errors';

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

/** 校验失败套「YAML 无效」前缀沿 Result 接力（错误通道迁移四期）；decode/upsert 的平台异常仍走 reject。 */
export async function importAgentYaml(
  runtime: MobileNovelMasterRuntime,
  agentId: string,
): Promise<Result<void, Error>> {
  return importYamlFile(async yaml => {
    try {
      const def = decodeAgentYamlText(yaml);
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      const validation = await validateAgentDefinition(def, {registeredToolNames: probe.list()});
      if (!validation.ok) {
        return Result.err(normalizeYamlError(validation.error, 'Agent YAML 无效'));
      }
      const saved = await runtime.agentRegistry.upsert(agentId, def, {
        registeredToolNames: probe.list(),
      });
      if (!saved.ok) {
        return Result.err(normalizeYamlError(saved.error, 'Agent YAML 无效'));
      }
      return Result.ok(undefined);
    } catch (error) {
      throw normalizeYamlError(error, 'Agent YAML 无效');
    }
  });
}
