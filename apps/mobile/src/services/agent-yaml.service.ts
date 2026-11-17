import {decode, encode, parseText, stringifyText} from '@novel-master/core';
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {agentDefinitionSchema, validateAgentDefinition, type AgentDefinition} from '@novel-master/core/agent';
import {Errors} from '@novel-master/core/common';
import {Result, type AppError} from '@novel-master/core/errors';

import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {exportYamlFile, importYamlFile} from './yaml-shared';

export function decodeAgentYamlText(yaml: string): Result<AgentDefinition, AppError> {
  // 错误通道迁移四期：parseText / decode 的已知失败沿 Result 接力；导入侧
  // 由唯一调用方 importAgentYaml 统一走 Errors.normalizeYaml 贴标签。
  const parsed = parseText(yaml, 'yaml');
  if (!parsed.ok) return Result.err(parsed.error);
  const decoded = decode(parsed.value, agentDefinitionSchema);
  if (!decoded.ok) return Result.err(decoded.error);
  return Result.ok(decoded.value);
}

export function encodeAgentYamlText(def: AgentDefinition): string {
  const doc = encode(def, agentDefinitionSchema);
  return stringifyText(doc, 'yaml');
}

export async function exportAgentYaml(runtime: MobileNovelMasterRuntime, agentId: string): Promise<'saved' | 'cancelled'> {
  const def = await runtime.agentRegistry.get(agentId);
  if (!def.ok) {
    // 导出调用方只有 throw 通道：registry 已知失败转 throw 交调用方 catch 收口。
    const failure = def.error;
    throw failure;
  }
  const yaml = encodeAgentYamlText(def.value);
  return exportYamlFile(yaml, `${agentId}.agent.yaml`);
}

/** 校验失败套「YAML 无效」前缀沿 Result 接力（错误通道迁移四期）；decode/upsert 的平台异常仍走 reject。 */
export async function importAgentYaml(runtime: MobileNovelMasterRuntime, agentId: string): Promise<Result<void, Error>> {
  return importYamlFile(async yaml => {
    try {
      const decoded = decodeAgentYamlText(yaml);
      if (!decoded.ok) {
        return Result.err(Errors.normalizeYaml(decoded.error, 'Agent YAML 无效'));
      }
      const def = decoded.value;
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      const validation = await validateAgentDefinition(def, {registeredToolNames: probe.list()});
      if (!validation.ok) {
        return Result.err(Errors.normalizeYaml(validation.error, 'Agent YAML 无效'));
      }
      const saved = await runtime.agentRegistry.upsert(agentId, def, {registeredToolNames: probe.list()});
      if (!saved.ok) {
        return Result.err(Errors.normalizeYaml(saved.error, 'Agent YAML 无效'));
      }
      return Result.ok(undefined);
    } catch (error) {
      throw Errors.normalizeYaml(error, 'Agent YAML 无效');
    }
  });
}
