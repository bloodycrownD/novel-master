/**
 * Default smart sort rule service.
 *
 * @module service/smart-sort-rule/impl/smart-sort-rule.service
 */

import { SmartSortRuleError } from "@/errors/smart-sort-rule-errors.js";
import {
  compileSmartSortRule,
  validateSmartSortRuleDraft,
} from "@/domain/smart-sort-rule/logic/compile-smart-sort-rule.js";
import {
  bundleRulesToEntities,
  decodeSmartSortRuleBundle,
  encodeSmartSortRuleBundle,
  type SmartSortRuleBundleDocument,
} from "@/domain/smart-sort-rule/model/smart-sort-rule-io.js";
import {
  isBuiltinSmartSortRuleId,
  type SmartSortRule,
} from "@/domain/smart-sort-rule/model/smart-sort-rule.js";
import {
  parseCreateSmartSortRuleInput,
  parseUpdateSmartSortRuleInput,
  type CreateSmartSortRuleInput,
  type UpdateSmartSortRuleInput,
} from "@/domain/smart-sort-rule/model/smart-sort-rule.schema.js";
import type { SmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/smart-sort-rule.port.js";
import {
  compareSmartBasenames,
  extractSortKey,
  extractSortKeyDetail,
  type CompiledSmartSortRule,
  type SmartSortKeyCache,
} from "@/domain/workplace/logic/smart-sort.js";
import type {
  SmartSortRuleMoveTarget,
  SmartSortRulePreviewDraft,
  SmartSortRulePreviewLine,
  SmartSortRulePreviewResult,
  SmartSortRuleService,
} from "../smart-sort-rule.port.js";

/** resetDefaults 重灌用的内置 seed 行（结构兼容 bootstrap 常量）。 */
export interface SmartSortBuiltinSeedRow {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly example: string;
  readonly sortOrder: number;
}

export interface SmartSortRuleServiceDeps {
  readonly rules: SmartSortRuleRepository;
  /** 恢复默认时重灌的内置规则集（工厂自 bootstrap 常量注入）。 */
  readonly builtinSeed: readonly SmartSortBuiltinSeedRow[];
}

/** Smart sort rule service backed by the smart_sort_rule table. */
export class DefaultSmartSortRuleService implements SmartSortRuleService {
  constructor(private readonly deps: SmartSortRuleServiceDeps) {}

  async listRules(): Promise<SmartSortRule[]> {
    return this.deps.rules.listOrdered();
  }

  async createRule(input: CreateSmartSortRuleInput): Promise<SmartSortRule> {
    const fields = parseCreateSmartSortRuleInput(input);
    validateSmartSortRuleDraft(fields);
    const ruleId = await this.generateRuleId();
    const now = Date.now();
    const sortOrder = await this.deps.rules.nextSortOrder();
    const rule: SmartSortRule = {
      ruleId,
      name: fields.name,
      pattern: fields.pattern,
      flags: fields.flags,
      example: fields.example,
      enabled: fields.enabled,
      sortOrder,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.rules.insert(rule);
    return rule;
  }

  async updateRule(
    ruleId: string,
    patch: UpdateSmartSortRuleInput
  ): Promise<SmartSortRule> {
    const parsed = parseUpdateSmartSortRuleInput(patch);
    const existing = await this.getRuleOrThrow(ruleId);
    const merged = {
      name: parsed.name ?? existing.name,
      pattern: parsed.pattern ?? existing.pattern,
      flags: parsed.flags ?? existing.flags,
    };
    validateSmartSortRuleDraft(merged, { ruleId });
    const updated: SmartSortRule = {
      ...existing,
      name: merged.name,
      pattern: merged.pattern,
      flags: merged.flags,
      example: parsed.example !== undefined ? parsed.example : existing.example,
      enabled: parsed.enabled ?? existing.enabled,
      updatedAtMs: Date.now(),
    };
    await this.deps.rules.update(updated);
    return updated;
  }

  async deleteRule(ruleId: string): Promise<void> {
    const rule = await this.getRuleOrThrow(ruleId);
    if (isBuiltinSmartSortRuleId(rule.ruleId)) {
      throw new SmartSortRuleError(
        "BUILTIN_PROTECTED",
        `Built-in rule cannot be deleted (disable it instead): ${ruleId}`,
        { ruleId }
      );
    }
    await this.deps.rules.delete(rule.ruleId);
  }

  async deleteBatch(ruleIds: readonly string[]): Promise<void> {
    // 先全量校验（存在 + 非 builtin）再删除，避免半删状态
    for (const ruleId of ruleIds) {
      const rule = await this.getRuleOrThrow(ruleId);
      if (isBuiltinSmartSortRuleId(rule.ruleId)) {
        throw new SmartSortRuleError(
          "BUILTIN_PROTECTED",
          `Built-in rule cannot be deleted (disable it instead): ${ruleId}`,
          { ruleId }
        );
      }
    }
    for (const ruleId of ruleIds) {
      await this.deps.rules.delete(ruleId);
    }
  }

  async setEnabled(ruleId: string, enabled: boolean): Promise<SmartSortRule> {
    const existing = await this.getRuleOrThrow(ruleId);
    if (existing.enabled === enabled) {
      return existing;
    }
    const updated: SmartSortRule = {
      ...existing,
      enabled,
      updatedAtMs: Date.now(),
    };
    await this.deps.rules.update(updated);
    return updated;
  }

  async setEnabledBatch(
    ruleIds: readonly string[],
    enabled: boolean
  ): Promise<void> {
    for (const ruleId of ruleIds) {
      await this.setEnabled(ruleId, enabled);
    }
  }

  async moveRule(
    ruleId: string,
    to: SmartSortRuleMoveTarget
  ): Promise<SmartSortRule[]> {
    const rules = await this.deps.rules.listOrdered();
    const ids = rules.map((r) => r.ruleId);
    const from = ids.indexOf(ruleId);
    if (from < 0) {
      throw new SmartSortRuleError("NOT_FOUND", `Rule not found: ${ruleId}`, {
        ruleId,
      });
    }
    let target: number;
    if (to === "top") {
      target = 0;
    } else if (to === "bottom") {
      target = ids.length - 1;
    } else if (to === "up") {
      target = Math.max(0, from - 1);
    } else if (to === "down") {
      target = Math.min(ids.length - 1, from + 1);
    } else {
      target = Math.min(Math.max(0, to.index), ids.length - 1);
    }
    if (target !== from) {
      ids.splice(from, 1);
      ids.splice(target, 0, ruleId);
      await this.renumber(ids);
    }
    return this.deps.rules.listOrdered();
  }

  async reorderRules(orderedIds: readonly string[]): Promise<SmartSortRule[]> {
    const rules = await this.deps.rules.listOrdered();
    const existingIds = new Set(rules.map((r) => r.ruleId));
    const orderedSet = new Set(orderedIds);
    if (orderedSet.size !== orderedIds.length) {
      throw new SmartSortRuleError(
        "INVALID_ARGUMENT",
        "orderedIds contains duplicates"
      );
    }
    if (
      orderedIds.length !== existingIds.size ||
      [...orderedIds].some((id) => !existingIds.has(id))
    ) {
      throw new SmartSortRuleError(
        "INVALID_ARGUMENT",
        "orderedIds must cover exactly the full rule set"
      );
    }
    await this.renumber(orderedIds);
    return this.deps.rules.listOrdered();
  }

  async exportRules(): Promise<SmartSortRuleBundleDocument> {
    return encodeSmartSortRuleBundle(await this.deps.rules.listOrdered());
  }

  async importRules(raw: unknown): Promise<SmartSortRule[]> {
    const doc = decodeSmartSortRuleBundle(raw);
    const entities = bundleRulesToEntities(doc, Date.now());
    const seen = new Set<string>();
    for (const entity of entities) {
      if (seen.has(entity.ruleId)) {
        throw new SmartSortRuleError(
          "CONFLICT",
          `Duplicate ruleId in bundle: ${entity.ruleId}`,
          { ruleId: entity.ruleId }
        );
      }
      seen.add(entity.ruleId);
      validateSmartSortRuleDraft(entity, { ruleId: entity.ruleId });
    }
    await this.deps.rules.deleteAll();
    for (const entity of entities) {
      await this.deps.rules.insert(entity);
    }
    return this.deps.rules.listOrdered();
  }

  async resetDefaults(): Promise<void> {
    const rules = await this.deps.rules.listOrdered();
    // 删除 builtin 前先按当前列表序快照用户规则的相对顺序（B-2）：重灌的种子
    // sortOrder 1..4 会与用户规则的存量 sort_order 撞号，若事后用 listOrdered()
    // 兑底重排，撞号会按 rule_id 隐式决胜，把用户规则交错到 builtin 中间。
    const userIds = rules
      .filter((rule) => !isBuiltinSmartSortRuleId(rule.ruleId))
      .map((rule) => rule.ruleId);
    for (const rule of rules) {
      if (isBuiltinSmartSortRuleId(rule.ruleId)) {
        await this.deps.rules.delete(rule.ruleId);
      }
    }
    const now = Date.now();
    for (const row of this.deps.builtinSeed) {
      await this.deps.rules.insert({
        ruleId: row.ruleId,
        name: row.name,
        pattern: row.pattern,
        flags: row.flags,
        example: row.example,
        enabled: true,
        sortOrder: row.sortOrder,
        createdAtMs: now,
        updatedAtMs: now,
      });
    }
    // 显式重编号（D2）：builtin 按种子序恒在前、用户规则按删除前相对序紧随
    // 其后，恢复 sort_order 连续 1..N；不走 listOrdered() 兑底（见上方撞号说明）。
    const finalOrder = [
      ...this.deps.builtinSeed.map((row) => row.ruleId),
      ...userIds,
    ];
    await this.renumber(finalOrder);
  }

  async previewSort(
    names: readonly string[],
    draftRules?: readonly SmartSortRulePreviewDraft[]
  ): Promise<SmartSortRulePreviewResult> {
    let compiled: readonly CompiledSmartSortRule[];
    if (draftRules !== undefined) {
      compiled = draftRules.map((draft) =>
        compileSmartSortRule({
          ruleId: draft.ruleId,
          name: draft.name,
          pattern: draft.pattern,
          flags: draft.flags,
          example: null,
          enabled: true,
          sortOrder: 0,
          createdAtMs: 0,
          updatedAtMs: 0,
        })
      );
    } else {
      compiled = await this.listCompiledRules();
    }
    const lines: SmartSortRulePreviewLine[] = names.map((name) => {
      const detail = extractSortKeyDetail(name, compiled);
      return {
        name,
        matchedRuleId: detail?.ruleId ?? null,
        nums: detail?.nums ?? null,
      };
    });
    const cache: SmartSortKeyCache = new Map();
    for (const name of names) {
      if (!cache.has(name)) {
        cache.set(name, extractSortKey(name, compiled));
      }
    }
    const sortedNames = [...names].sort((a, b) =>
      compareSmartBasenames(a, b, "asc", cache)
    );
    return { lines, sortedNames };
  }

  async listCompiledRules(): Promise<CompiledSmartSortRule[]> {
    const rules = await this.deps.rules.listOrdered();
    const out: CompiledSmartSortRule[] = [];
    for (const rule of rules) {
      if (!rule.enabled) {
        continue;
      }
      out.push(compileSmartSortRule(rule));
    }
    return out;
  }

  private async getRuleOrThrow(ruleId: string): Promise<SmartSortRule> {
    const rule = await this.deps.rules.find(ruleId);
    if (!rule) {
      throw new SmartSortRuleError("NOT_FOUND", `Rule not found: ${ruleId}`, {
        ruleId,
      });
    }
    return rule;
  }

  /** 用户规则 id 生成（时间戳 + 随机，避免与现存撞号）。 */
  private async generateRuleId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `rule-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      if ((await this.deps.rules.find(candidate)) == null) {
        return candidate;
      }
    }
    throw new SmartSortRuleError(
      "CONFLICT",
      "Failed to generate a unique rule id"
    );
  }

  /** 整表重编号（D2）：内存排序后逐条 UPDATE sort_order=1..N（时间戳不刷）。 */
  private async renumber(orderedIds: readonly string[]): Promise<void> {
    const rules = await this.deps.rules.listOrdered();
    const byId = new Map(rules.map((r) => [r.ruleId, r]));
    for (let i = 0; i < orderedIds.length; i++) {
      const rule = byId.get(orderedIds[i]!);
      if (rule == null || rule.sortOrder === i + 1) {
        continue;
      }
      await this.deps.rules.update({ ...rule, sortOrder: i + 1 });
    }
  }
}
