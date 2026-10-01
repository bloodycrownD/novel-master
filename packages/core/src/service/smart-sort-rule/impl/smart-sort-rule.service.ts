/**
 * Default smart sort rule service.
 *
 * @module service/smart-sort-rule/impl/smart-sort-rule.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
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
  type SmartSortCaptureKind,
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
  readonly captureKind: SmartSortCaptureKind;
  readonly description: string;
  readonly sortOrder: number;
}

export interface SmartSortRuleServiceDeps {
  /** 根连接：多语句写入口用它开事务（**单语句入口不开**）。 */
  readonly conn: TdbcConnection;
  /**
   * 按连接造仓储的工厂。
   *
   * ⚠️ **硬约束**：事务回调内只能用回调传入的 `tx` 句柄调本工厂造仓储。
   * 事务内经**根连接**写会撞驱动的 `AsyncMutex` 不可重入
   * （better-sqlite3 的 `transaction()` 在整个 async 回调期间持锁），
   * 故障形态是**永久挂起**而不是变红。全类仓储一律经 {@link rules} 取得。
   */
  readonly createRules: (conn: TdbcConnection) => SmartSortRuleRepository;
  readonly builtinSeed: readonly SmartSortBuiltinSeedRow[];
}

/** Smart sort rule service backed by the smart_sort_rule table. */
export class DefaultSmartSortRuleService implements SmartSortRuleService {
  constructor(private readonly deps: SmartSortRuleServiceDeps) {}

  /**
   * 取「当前连接上的」仓储。**全类唯一的仓储取得口**。
   *
   * 跨 ≥2 次 repo 写调用的逻辑动作必须包一条 `conn.transaction`，且事务回调内
   * 一律 `this.rules(tx)`——绝不裸调 `this.rules()`（那拿的是根连接，会死锁）。
   * 单语句入口不开事务。
   */
  private rules(conn: TdbcConnection = this.deps.conn): SmartSortRuleRepository {
    return this.deps.createRules(conn);
  }

  async listRules(): Promise<SmartSortRule[]> {
    return this.rules().listOrdered();
  }

  async createRule(input: CreateSmartSortRuleInput): Promise<SmartSortRule> {
    const fields = parseCreateSmartSortRuleInput(input);
    validateSmartSortRuleDraft(fields);
    const ruleId = await this.generateRuleId();
    const now = Date.now();
    const sortOrder = await this.rules().nextSortOrder();
    const rule: SmartSortRule = {
      ruleId,
      name: fields.name,
      pattern: fields.pattern,
      flags: fields.flags,
      captureKind: fields.captureKind,
      description: fields.description,
      enabled: fields.enabled,
      sortOrder,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.rules().insert(rule);
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
      captureKind: parsed.captureKind ?? existing.captureKind,
    };
    validateSmartSortRuleDraft(merged, { ruleId });
    const updated: SmartSortRule = {
      ...existing,
      name: merged.name,
      pattern: merged.pattern,
      flags: merged.flags,
      captureKind: merged.captureKind,
      description:
        parsed.description !== undefined ? parsed.description : existing.description,
      enabled: parsed.enabled ?? existing.enabled,
      updatedAtMs: Date.now(),
    };
    await this.rules().update(updated);
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
    await this.rules().delete(rule.ruleId);
  }

  async deleteBatch(ruleIds: readonly string[]): Promise<void> {
    // 全量校验（存在 + 非 builtin）**留在事务外**：读多写零，进事务只是多持锁。
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
    // 逐条 delete 包一条事务：中途失败不留半删状态。
    // ⚠️ 事务内一律 `this.rules(tx)`——经根连接写会撞 AsyncMutex 不可重入（挂起）。
    if (ruleIds.length === 0) {
      return;
    }
    await this.deps.conn.transaction(async (tx) => {
      const rules = this.rules(tx);
      for (const ruleId of ruleIds) {
        await rules.delete(ruleId);
      }
    });
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
    await this.rules().update(updated);
    return updated;
  }

  async setEnabledBatch(
    ruleIds: readonly string[],
    enabled: boolean
  ): Promise<void> {
    if (ruleIds.length === 0) {
      return;
    }
    // 整体包一条事务：中途失败不留「前几条已改、后几条没改」的半状态。
    //
    // ⚠️ 这里**内联** find+update 而不调 `this.setEnabled`：后者内部走
    // `this.rules()` 拿的是**根连接**，在事务回调里经根连接写会撞 AsyncMutex
    // 不可重入 ⇒ 永久挂起（死锁），不是「事务外写、等于没包」。
    await this.deps.conn.transaction(async (tx) => {
      const rules = this.rules(tx);
      for (const ruleId of ruleIds) {
        const existing = await rules.find(ruleId);
        if (existing == null) {
          throw new SmartSortRuleError("NOT_FOUND", `Rule not found: ${ruleId}`, {
            ruleId,
          });
        }
        if (existing.enabled === enabled) {
          continue;
        }
        await rules.update({
          ...existing,
          enabled,
          updatedAtMs: Date.now(),
        });
      }
    });
  }

  async moveRule(
    ruleId: string,
    to: SmartSortRuleMoveTarget
  ): Promise<SmartSortRule[]> {
    // 快照在**事务外**读：它同时是 id 序的来源与 renumber 的第②参数
    // （renumber 内部不再 listOrdered，否则事务内会多一次读）。
    const snapshot = await this.rules().listOrdered();
    const ids = snapshot.map((r) => r.ruleId);
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
      // 幂等 move 的守卫（target === from 时不发任何写）不变；事务内只做 renumber
      // + 返回值所需的 listOrdered（返回「调完 renumber 后的有序列表」语义不变式）。
      return this.deps.conn.transaction(async (tx) => {
        const rules = this.rules(tx);
        await this.renumber(rules, snapshot, ids);
        return rules.listOrdered();
      });
    }
    return this.rules().listOrdered();
  }

  async reorderRules(orderedIds: readonly string[]): Promise<SmartSortRule[]> {
    // 全部校验留在事务外（重复/全覆盖检查是纯读），顺带取 renumber 的快照。
    const snapshot = await this.rules().listOrdered();
    const existingIds = new Set(snapshot.map((r) => r.ruleId));
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
    return this.deps.conn.transaction(async (tx) => {
      const rules = this.rules(tx);
      await this.renumber(rules, snapshot, orderedIds);
      return rules.listOrdered();
    });
  }

  async exportRules(): Promise<SmartSortRuleBundleDocument> {
    return encodeSmartSortRuleBundle(await this.rules().listOrdered());
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
    // 校验段**保持在事务外**（读多写零；放进事务只会多持锁，且撞号防御的位置不变）。
    // ⚠️ 替换式语义要求原子：deleteAll + N 条 insert 必须同生共死——
    // 旧形态中途失败 ⇒ 用户**全部**规则已被抹掉且不回滚，排序静默退化为自然序。
    return this.deps.conn.transaction(async (tx) => {
      const rules = this.rules(tx);
      await rules.deleteAll();
      for (const entity of entities) {
        await rules.insert(entity);
      }
      return rules.listOrdered();
    });
  }

  async resetDefaults(): Promise<void> {
    // 快照读**留在事务外**：它同时提供 builtin 删除名单、用户规则相对序，
    // 以及 renumber 的第②参数。放进事务只会让长事务多持一段纯读。
    const snapshot = await this.rules().listOrdered();
    // 删除 builtin 前先按当前列表序快照用户规则的相对顺序（B-2）：重灌的种子
    // sortOrder 1..4 会与用户规则的存量 sort_order 撞号，若事后用 listOrdered()
    // 兜底重排，撞号会按 rule_id 隐式决胜，把用户规则交错到 builtin 中间。
    const userIds = snapshot
      .filter((rule) => !isBuiltinSmartSortRuleId(rule.ruleId))
      .map((rule) => rule.ruleId);
    // 三段（删 builtin → 重灌 seed → renumber）整体包一条事务：中途失败不留
    // 「builtin 已删但没重灌」的残局。
    // 注：service 层用的是**普通 INSERT**（不是 bootstrap 的 INSERT OR IGNORE），
    // 所以失败即回滚后不会出现「内置规则永久缺失」。
    await this.deps.conn.transaction(async (tx) => {
      const rules = this.rules(tx);
      for (const rule of snapshot) {
        if (isBuiltinSmartSortRuleId(rule.ruleId)) {
          await rules.delete(rule.ruleId);
        }
      }
      const now = Date.now();
      for (const row of this.deps.builtinSeed) {
        await rules.insert({
          ruleId: row.ruleId,
          name: row.name,
          pattern: row.pattern,
          flags: row.flags,
          captureKind: row.captureKind,
          description: row.description,
          enabled: true,
          sortOrder: row.sortOrder,
          createdAtMs: now,
          updatedAtMs: now,
        });
      }
      // 显式重编号（D2）：builtin 按种子序恒在前、用户规则按删除前相对序紧随
      // 其后，恢复 sort_order 连续 1..N；不走 listOrdered() 兜底（见上方撞号说明）。
      const finalOrder = [
        ...this.deps.builtinSeed.map((row) => row.ruleId),
        ...userIds,
      ];
      await this.renumber(rules, snapshot, finalOrder);
    });
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
          captureKind: draft.captureKind ?? "smart",
          description: null,
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
    const rules = await this.rules().listOrdered();
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
    const rule = await this.rules().find(ruleId);
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
      if ((await this.rules().find(candidate)) == null) {
        return candidate;
      }
    }
    throw new SmartSortRuleError(
      "CONFLICT",
      "Failed to generate a unique rule id"
    );
  }

  /**
   * 整表重编号（D2）：把 `orderedIds` 映射成 sortOrder 1..N，**一次批量 UPDATE** 落库
   * （时间戳不刷，沿用既有语义）。
   *
   * 三个参数缺一不可：
   * ① `rules` —— 事务回调内必须传 `tx` 造的仓储；
   * ② `current` —— 调用方在**事务外**读好的列表快照，本方法内部不再 `listOrdered()`
   *    （否则事务内会多一次读）；
   * ③ `orderedIds` —— 目标 id 序。
   *
   * 只把「顺序确实会变」的行放进 pairs（未变动的行不进），由仓储按 200 对分片。
   */
  private async renumber(
    rules: SmartSortRuleRepository,
    current: readonly SmartSortRule[],
    orderedIds: readonly string[]
  ): Promise<void> {
    const byId = new Map(current.map((r) => [r.ruleId, r]));
    const pairs = orderedIds
      .map((id, i) => {
        const rule = byId.get(id);
        return rule == null
          ? null
          : { ruleId: rule.ruleId, sortOrder: i + 1, previous: rule.sortOrder };
      })
      .filter(
        (p): p is { ruleId: string; sortOrder: number; previous: number } =>
          p != null && p.previous !== p.sortOrder
      )
      .map((p) => ({ ruleId: p.ruleId, sortOrder: p.sortOrder }));
    if (pairs.length > 0) {
      await rules.updateSortOrders(pairs);
    }
  }
}
