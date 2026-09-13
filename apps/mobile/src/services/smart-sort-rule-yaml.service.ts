/**
 * 智能排序规则 YAML 导入导出（spec smart-filename-sort Step 13 / D10）。
 *
 * schema/encode/decode 单源在 core `smart-sort-rule-io`；这里只做选择器
 * 编排（yaml-shared）与文本 (de)serialization，模式与 agent-yaml.service 一致。
 */
import {parseText, stringifyText} from '@novel-master/core';

import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {exportYamlFile, importYamlFile, normalizeYamlError} from './yaml-shared';

export async function exportSmartSortRuleYaml(
  runtime: MobileNovelMasterRuntime,
): Promise<'saved' | 'cancelled'> {
  const doc = await runtime.smartSortRule.exportRules();
  const yaml = stringifyText(doc, 'yaml');
  return exportYamlFile(yaml, 'smart-sort-rules.yaml');
}

/**
 * 替换式导入（spec D10）：调用方需先完成「将替换全部规则」的确认。
 *
 * @returns 导入成功后的规则条数（取消选择时返回 null）。
 */
export async function importSmartSortRuleYaml(
  runtime: MobileNovelMasterRuntime,
): Promise<number | null> {
  let count: number | null = null;
  await importYamlFile(async yaml => {
    try {
      const raw = parseText(yaml, 'yaml');
      const rules = await runtime.smartSortRule.importRules(raw);
      count = rules.length;
    } catch (error) {
      throw normalizeYamlError(error, '智能排序规则 YAML 无效');
    }
  });
  return count;
}
