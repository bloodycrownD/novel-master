/**
 * 智能排序规则 YAML 导入导出（spec smart-filename-sort Step 13 / D10）。
 *
 * schema/encode/decode 单源在 core `smart-sort-rule-io`；这里只做选择器
 * 编排（yaml-shared）与文本 (de)serialization，模式与 agent-yaml.service 一致。
 */
import {parseText, stringifyText} from '@novel-master/core';
import {Errors} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';

import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {exportYamlWithDialog, importYamlWithDialog} from './yaml-shared';

export async function exportSmartSortRuleYaml(runtime: MobileNovelMasterRuntime): Promise<'saved' | 'cancelled'> {
  const doc = await runtime.smartSortRule.exportRules();
  const yaml = stringifyText(doc, 'yaml');
  return exportYamlWithDialog(yaml, 'smart-sort-rules.yaml');
}

/**
 * 替换式导入（spec D10）：调用方需先完成「将替换全部规则」的确认。
 *
 * 存储/事务类故障原样上抛、其余照旧套「YAML 无效」前缀——判据与前缀都在 core
 * 的 `Errors.normalizeSmartSortImport` 里（desktop 侧调同一个函数）。
 * 别在这里把三元抄回本地：两份字面量必然漂一份，而旧测试只重演不断接线。
 *
 * @returns 导入成功后的规则条数（取消选择时返回 null）。
 */
export async function importSmartSortRuleYaml(runtime: MobileNovelMasterRuntime): Promise<Result<number | null, Error>> {
  let count: number | null = null;
  const consumeYaml = async (yaml: string): Promise<Result<void, Error>> => {
    try {
      const raw = parseText(yaml, 'yaml');
      const rules = await runtime.smartSortRule.importRules(raw);
      if (!rules.ok) return Result.err(Errors.normalizeSmartSortImport(rules.error));
      count = rules.value.length;
      return Result.ok(undefined);
    } catch (error) {
      // 存储/事务类故障原样上抛、其余照旧套「YAML 无效」前缀——判据在 core。
      throw Errors.normalizeSmartSortImport(error);
    }
  };
  const result = await importYamlWithDialog(consumeYaml);
  if (!result.ok) return Result.err(result.error);
  return Result.ok(count);
}
