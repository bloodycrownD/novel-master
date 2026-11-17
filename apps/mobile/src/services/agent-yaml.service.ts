/**
 * Agent YAML import/export via document picker.
 *
 * 文本编解码单源在 core（`@novel-master/core/agent` 的 `decodeAgentYamlText` /
 * `encodeAgentYamlText`）；本模块只保留选择器编排与 registry 落库。
 */
import {registerBuiltinTools, ToolRegistry} from '@novel-master/core';
import {decodeAgentYamlText, encodeAgentYamlText, validateAgentDefinition} from '@novel-master/core/agent';
import {Errors} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';

import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {exportYamlWithDialog, importYamlWithDialog} from './yaml-shared';

export async function exportAgentYaml(runtime: MobileNovelMasterRuntime, agentId: string): Promise<'saved' | 'cancelled'> {
  const def = await runtime.agentRegistry.get(agentId);
  if (!def.ok) {
    // 导出调用方只有 throw 通道：registry 已知失败转 throw 交调用方 catch 收口。
    const failure = def.error;
    throw failure;
  }
  const yaml = encodeAgentYamlText(def.value);
  return exportYamlWithDialog(yaml, `${agentId}.agent.yaml`);
}

/** 校验失败套「YAML 无效」前缀沿 Result 接力；decode/upsert 的平台异常仍走 reject。 */
export async function importAgentYaml(runtime: MobileNovelMasterRuntime, agentId: string): Promise<Result<void, Error>> {
  return importYamlWithDialog(async yaml => {
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
