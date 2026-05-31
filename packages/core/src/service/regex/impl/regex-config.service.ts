/**
 * Default regex group/rule configuration service.
 *
 * @module service/regex/impl/regex-config.service
 */

import { RegexError } from "@/errors/regex-errors.js";
import { compileRegexRule } from "@/domain/regex/logic/compile-regex-rule.js";
import type { CompiledRegexRule } from "@/domain/regex/logic/compile-regex-rule.js";
import type { RegexGroup } from "@/domain/regex/model/regex-group.js";
import type { RegexRule } from "@/domain/regex/model/regex-rule.js";
import type { RegexGroupRepository } from "@/domain/regex/repositories/regex-group.port.js";
import type { RegexRuleRepository } from "@/domain/regex/repositories/regex-rule.port.js";
import {
  createRegexGroupSchema,
  createRegexRuleSchema,
  updateRegexGroupSchema,
  updateRegexRuleSchema,
  type CreateRegexGroupInput,
  type CreateRegexRuleInput,
  type UpdateRegexGroupInput,
  type UpdateRegexRuleInput,
} from "@/domain/regex/model/regex-rule.schema.js";
import { validateRegexRule } from "@/domain/regex/logic/validate-regex-rule.js";
import type { PersistentState } from "@/service/persistent-state/persistent-state.port.js";
import type { RegexConfigService } from "../regex-config.port.js";

export interface DefaultRegexConfigServiceDeps {
  readonly groups: RegexGroupRepository;
  readonly rules: RegexRuleRepository;
  /** When set, deleting the current group clears the workspace pointer. */
  readonly state?: PersistentState;
}

/** Regex configuration service backed by SQLite repositories. */
export class DefaultRegexConfigService implements RegexConfigService {
  constructor(private readonly deps: DefaultRegexConfigServiceDeps) {}

  async createGroup(input: CreateRegexGroupInput): Promise<RegexGroup> {
    const parsed = createRegexGroupSchema.parse(input);
    const existing = await this.deps.groups.findById(parsed.groupId);
    if (existing) {
      throw new RegexError("CONFLICT", `Regex group already exists: ${parsed.groupId}`, {
        groupId: parsed.groupId,
      });
    }
    const now = Date.now();
    const group: RegexGroup = {
      groupId: parsed.groupId,
      displayName: parsed.displayName ?? null,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.groups.insert(group);
    return group;
  }

  async listGroups(): Promise<RegexGroup[]> {
    return this.deps.groups.list();
  }

  async getGroup(groupId: string): Promise<RegexGroup> {
    const g = await this.deps.groups.findById(groupId);
    if (!g) {
      throw new RegexError("NOT_FOUND", `Regex group not found: ${groupId}`, {
        groupId,
      });
    }
    return g;
  }

  async updateGroup(
    groupId: string,
    patch: UpdateRegexGroupInput,
  ): Promise<RegexGroup> {
    const parsed = updateRegexGroupSchema.parse(patch);
    const group = await this.getGroup(groupId);
    const updated: RegexGroup = {
      ...group,
      displayName:
        parsed.displayName !== undefined ? parsed.displayName : group.displayName,
      updatedAtMs: Date.now(),
    };
    await this.deps.groups.update(updated);
    return updated;
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.getGroup(groupId);
    await this.deps.groups.delete(groupId);
    if (this.deps.state) {
      const current = await this.deps.state.getCurrentRegexGroupId();
      if (current === groupId) {
        await this.deps.state.resetCurrentRegexGroupId();
      }
    }
  }

  async createRule(input: CreateRegexRuleInput): Promise<RegexRule> {
    const parsed = createRegexRuleSchema.parse(input);
    await this.getGroup(parsed.groupId);
    const existing = await this.deps.rules.find(parsed.groupId, parsed.ruleId);
    if (existing) {
      throw new RegexError(
        "CONFLICT",
        `Regex rule already exists: ${parsed.groupId}/${parsed.ruleId}`,
        { groupId: parsed.groupId, ruleId: parsed.ruleId },
      );
    }
    const fields = {
      pattern: parsed.pattern,
      flags: parsed.flags ?? "",
      llmReplace: parsed.llmReplace ?? null,
      displayReplace: parsed.displayReplace ?? null,
      minDepth: parsed.minDepth,
      maxDepth: parsed.maxDepth,
      scopeUser: parsed.scopeUser ?? false,
      scopeAssistant: parsed.scopeAssistant ?? false,
    };
    validateRegexRule(fields, {
      groupId: parsed.groupId,
      ruleId: parsed.ruleId,
    });
    const now = Date.now();
    const sortOrder = await this.deps.rules.nextSortOrder(parsed.groupId);
    const rule: RegexRule = {
      groupId: parsed.groupId,
      ruleId: parsed.ruleId,
      sortOrder,
      name: parsed.name,
      pattern: fields.pattern,
      flags: fields.flags,
      enabled: parsed.enabled ?? true,
      llmReplace: fields.llmReplace,
      displayReplace: fields.displayReplace,
      minDepth: fields.minDepth,
      maxDepth: fields.maxDepth,
      scopeUser: fields.scopeUser,
      scopeAssistant: fields.scopeAssistant,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.rules.insert(rule);
    return rule;
  }

  async listRules(groupId: string): Promise<RegexRule[]> {
    await this.getGroup(groupId);
    return this.deps.rules.listByGroupOrdered(groupId);
  }

  async getRule(groupId: string, ruleId: string): Promise<RegexRule> {
    const rule = await this.deps.rules.find(groupId, ruleId);
    if (!rule) {
      throw new RegexError(
        "NOT_FOUND",
        `Regex rule not found: ${groupId}/${ruleId}`,
        { groupId, ruleId },
      );
    }
    return rule;
  }

  async updateRule(
    groupId: string,
    ruleId: string,
    patch: UpdateRegexRuleInput,
  ): Promise<RegexRule> {
    const parsed = updateRegexRuleSchema.parse(patch);
    const existing = await this.getRule(groupId, ruleId);
    const merged = {
      pattern: parsed.pattern ?? existing.pattern,
      flags: parsed.flags ?? existing.flags,
      llmReplace:
        parsed.llmReplace !== undefined ? parsed.llmReplace : existing.llmReplace,
      displayReplace:
        parsed.displayReplace !== undefined
          ? parsed.displayReplace
          : existing.displayReplace,
      minDepth: parsed.minDepth ?? existing.minDepth,
      maxDepth: parsed.maxDepth ?? existing.maxDepth,
      scopeUser: parsed.scopeUser ?? existing.scopeUser,
      scopeAssistant: parsed.scopeAssistant ?? existing.scopeAssistant,
    };
    validateRegexRule(merged, { groupId, ruleId });
    const updated: RegexRule = {
      ...existing,
      name: parsed.name ?? existing.name,
      pattern: merged.pattern,
      flags: merged.flags,
      enabled: parsed.enabled ?? existing.enabled,
      llmReplace: merged.llmReplace,
      displayReplace: merged.displayReplace,
      minDepth: merged.minDepth,
      maxDepth: merged.maxDepth,
      scopeUser: merged.scopeUser,
      scopeAssistant: merged.scopeAssistant,
      updatedAtMs: Date.now(),
    };
    await this.deps.rules.update(updated);
    return updated;
  }

  async deleteRule(groupId: string, ruleId: string): Promise<void> {
    await this.getRule(groupId, ruleId);
    await this.deps.rules.delete(groupId, ruleId);
  }

  async setRuleEnabled(
    groupId: string,
    ruleId: string,
    enabled: boolean,
  ): Promise<RegexRule> {
    const existing = await this.getRule(groupId, ruleId);
    const updated: RegexRule = {
      ...existing,
      enabled,
      updatedAtMs: Date.now(),
    };
    await this.deps.rules.update(updated);
    return updated;
  }

  async listCompiledRulesForGroup(groupId: string): Promise<CompiledRegexRule[]> {
    const rules = await this.deps.rules.listByGroupOrdered(groupId);
    const out: CompiledRegexRule[] = [];
    for (const rule of rules) {
      if (!rule.enabled) {
        continue;
      }
      out.push(compileRegexRule(rule));
    }
    return out;
  }
}
