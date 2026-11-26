/**
 * Agent YAML import/export via document picker.
 *
 * 文本编解码单源在 core（`@novel-master/core/agent` 的 `AgentYamlCodec.decode` /
 * `AgentYamlCodec.encode`）；本模块只保留选择器编排与 registry 落库。
 */
import {BuiltinTools, ToolRegistry} from '@novel-master/core';
import {AgentDefinitionValidator, AgentYamlCodec} from '@novel-master/core/agent';
import {Errors} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';

import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {YamlShared} from './yaml-shared';

export namespace AgentYamlService {
    // nm-style: keep-public — agent-yaml.service.test.ts / agent-editor-form 两测试直接 import 与 mock 该模块接缝，测试锁名
    export async function exportYaml(runtime: MobileNovelMasterRuntime, agentId: string): Promise<'saved' | 'cancelled'> {
        const def = await runtime.agentRegistry.get(agentId);
        if (!def.ok) {
            // 导出调用方只有 throw 通道：registry 已知失败转 throw 交调用方 catch 收口。
            const failure = def.error;
            throw failure;
        }
        const yaml = AgentYamlCodec.encode(def.value);
        return YamlShared.exportWithDialog(yaml, `${agentId}.agent.yaml`);
    }

    /** 校验失败套「YAML 无效」前缀沿 Result 接力；decode/upsert 的平台异常归一后同走 Result.err。 */
    // nm-style: keep-public — agent-yaml.service.test.ts 多用例直接 import 断言校验管线；agent-editor-form 测试 mock 接缝，测试锁名
    export async function importYaml(runtime: MobileNovelMasterRuntime, agentId: string): Promise<Result<void, Error>> {
        return YamlShared.importWithDialog(async yaml => {
            try {
                const decoded = AgentYamlCodec.decode(yaml);
                if (!decoded.ok) {
                    return Result.err(Errors.normalizeYaml(decoded.error, 'Agent YAML 无效'));
                }
                const def = decoded.value;
                const probe = new ToolRegistry();
                BuiltinTools.register(probe);
                const validation = await AgentDefinitionValidator.validate(def, {registeredToolNames: probe.list()});
                if (!validation.ok) {
                    return Result.err(Errors.normalizeYaml(validation.error, 'Agent YAML 无效'));
                }
                const saved = await runtime.agentRegistry.upsert(agentId, def, {registeredToolNames: probe.list()});
                if (!saved.ok) {
                    return Result.err(Errors.normalizeYaml(saved.error, 'Agent YAML 无效'));
                }
                return Result.ok(undefined);
            } catch (error) {
                return Result.err(Errors.normalizeYaml(error, 'Agent YAML 无效'));
            }
        });
    }
}
