/**
 * 技能合并视图（纯函数）：global ∪ project、同名覆盖、负清单过滤。
 *
 * 供索引预算 / `$` 候选 / 面板共用；不做任何 IO。
 *
 * @module domain/skills/logic/effective-skills
 */

import type { SkillDomain, SkillSummary } from "../model/skill.schema.js";

/** 合并输入：两域清单 + 当前项目的禁用名单。 */
export interface EffectiveSkillsInput {
  readonly global: readonly SkillSummary[];
  readonly project: readonly SkillSummary[];
  /**
   * 当前项目的禁用技能名（`skill_disabled_rule` 的 project 行）。
   *
   * 禁用判定 project 行优先：本期负清单只有 project 域写入路径
   * （全局域行预留、无 UI 写入），故直接以 project 行为准。
   */
  readonly disabledNames?: ReadonlySet<string> | readonly string[];
}

/** 合并视图条目。 */
export interface EffectiveSkill {
  readonly name: string;
  readonly description: string | null;
  readonly domain: SkillDomain;
  /** project 副本覆盖同名 global 技能时为 true（仅 project 条目会标）。 */
  readonly overridden: boolean;
  /** 命中当前项目负清单时为 true。 */
  readonly disabled: boolean;
  readonly valid: boolean;
  readonly invalidReason?: string;
  /**
   * `valid && !disabled`——是否计入生效（提示词索引 / `$` 候选 / 启用统计）。
   * 无效技能保留在清单（管理界面展示原因），但不计入生效。
   */
  readonly effective: boolean;
}

function normalizeDisabled(
  disabled: ReadonlySet<string> | readonly string[] | undefined,
): Set<string> {
  if (disabled == null) {
    return new Set();
  }
  return disabled instanceof Set ? new Set(disabled) : new Set(disabled);
}

/**
 * 计算当前项目可见的技能合并视图。
 *
 * 规则：global ∪ project；同名时 project 副本覆盖 global 版（标
 * `overridden`，global 原件不出现在结果里）；命中负清单的标 `disabled`；
 * 无效技能保留但 `effective=false`。结果按名称排序，输出稳定。
 */
export function computeEffectiveSkills(
  input: EffectiveSkillsInput,
): EffectiveSkill[] {
  const disabled = normalizeDisabled(input.disabledNames);

  const projectNames = new Set(input.project.map((s) => s.name));
  const merged: SkillSummary[] = [
    ...input.global.filter((s) => !projectNames.has(s.name)),
    ...input.project,
  ];

  return merged
    .map((s): EffectiveSkill => {
      const isDisabled = disabled.has(s.name);
      const overridden =
        s.domain === "project" && input.global.some((g) => g.name === s.name);
      return {
        name: s.name,
        description: s.description,
        domain: s.domain,
        overridden,
        disabled: isDisabled,
        valid: s.valid,
        ...(s.invalidReason != null ? { invalidReason: s.invalidReason } : {}),
        effective: s.valid && !isDisabled,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
