/**
 * 完整性修复统一抽象（S-8）：repair / rename / backfill 三类兜底合一。
 *
 * ## 为什么需要它
 * 项目里原本散落三套「不一致兜底」逻辑，签名和调用时机各不相同：
 *   1. **repair** —— vfs 的 `repairRefCounts`，重算 checkpoint 指针 + live head，
 *      把偏低的 `vfs_revision.ref_count` 上调（保守纠偏，只增不减）；
 *   2. **backfill** —— chat-message 的 `backfillBaselineCheckpoints`，给空窗消息
 *      补一条 baseline checkpoint；
 *   3. **rename** —— provider migration 的双身份键重写（id → uuid 时同步搬运
 *      sksp 密钥 ref、kkv 建议 key、current provider 指针）。
 *
 * 它们抽象层面都是同一件事：**检测一致性 → 必要时修复**。这里把这套流程收拢成一个
 * 统一接口，让上层（bootstrap、importer、migration）能用同一种方式注册和触发，
 * 具体修法仍由各模块自己提供，抽象层只负责「detect → repair」的编排与报告。
 *
 * ## 双引用计数器裁决（T-SC5）
 * vfs 里有两套 `ref_count`，用途完全不同，**并存不矛盾，绝不强行合一**：
 *   - `vfs_revision.ref_count`：应用层维护（`repairRefCounts` / `adjustRef`），
 *     表示「有几条 checkpoint 或 live head 指向这条 revision」，用于 revision 可达性 GC。
 *   - `vfs_content_blob.ref_count`：SQLite 触发器维护（revision INSERT/DELETE/UPDATE
 *     OF content_hash 时 ±1），表示「有几条 revision 行引用这个 blob」，用于 blob 回收。
 *
 * 关键不变量：`repairRefCounts` 只走 `repairRefCountFloor`，而后者只更新 `ref_count` 列、
 * 不碰 `content_hash`，所以 `AFTER UPDATE OF content_hash` 触发器**不会 fire**——
 * 应用层修复 revision 可达性计数时，绝不会顺带 bump blob 侧的计数器，两条路径不重复计数。
 *
 * @module service/integrity-repair
 */

/** 兜底种类：修复 / 重命名引用迁移 / 补缺。 */
export type IntegrityRepairKind = "repair" | "rename" | "backfill";

/** detect 阶段的检测结果。 */
export interface IntegrityRepairDetection {
  /** 是否需要执行 repair。 */
  readonly needsRepair: boolean;
  /** 人类可读的细节，用于报告和日志，不参与调度逻辑。 */
  readonly details?: string;
}

/**
 * 单个完整性修复操作。
 *
 * `detect` 只读不写，用于判断是否需要修复；`repair` 执行实际修复，应当尽量幂等
 * （重复执行不产生副作用）。两者都是 `async`，因为底下要读 DB / 文件系统。
 */
export interface IntegrityRepairOperation {
  /** 操作名，仅用于报告可读性，需在单个 registry 内唯一。 */
  readonly name: string;
  /** 兜底种类，用于按种类过滤调度。 */
  readonly kind: IntegrityRepairKind;
  /** 只读检测：当前是否处于不一致状态、需要修复。 */
  detect(): Promise<IntegrityRepairDetection>;
  /** 执行修复；应当幂等。 */
  repair(): Promise<void>;
}

/** 单次操作跑完后的报告条目。 */
export interface IntegrityRepairReport {
  readonly name: string;
  readonly kind: IntegrityRepairKind;
  readonly detection: IntegrityRepairDetection;
  /** 是否真的执行了 repair（detect 返回 true 时才跑 repair）。 */
  readonly repaired: boolean;
  /** repair 阶段抛错时挂在 这里，runAll 不会因为单步失败而中断后续操作。 */
  readonly error?: unknown;
}

/**
 * 完整性修复注册表：统一登记 + 检测 + 调度。
 *
 * 典型用法：
 *
 * ```ts
 * const registry = new IntegrityRepairRegistry();
 * registry.register(createRevisionRefCountRepairOperation({ ... }));
 * registry.register(createBaselineCheckpointBackfillOperation({ ... }));
 * const reports = await registry.runAll();
 * for (const r of reports) {
 *   if (r.error) logger.warn({ name: r.name }, "integrity repair failed");
 * }
 * ```
 *
 * 设计取舍：
 * - `runAll` / `runOnly` 对每个操作独立 try-catch，单步抛错只记到报告的 `error` 字段，
 *   不会中断其他操作——完整性修复本身是「尽力而为」的安全网，一个模块挂了不该拖累别的；
 * - detect 返回 `needsRepair=false` 的操作跳过 repair，避免无谓写入；
 * - registry 本身无状态，可按需 new 一个临时实例跑一批，也可以长期持有。
 */
export class IntegrityRepairRegistry {
  private readonly operations = new Map<string, IntegrityRepairOperation>();

  /** 登记一个操作；同名重复登记直接抛错，防止悄悄覆盖。 */
  register(op: IntegrityRepairOperation): this {
    if (!op || typeof op.detect !== "function" || typeof op.repair !== "function") {
      throw new TypeError(
        `IntegrityRepairRegistry.register: 操作 ${op?.name ?? "<匿名>"} 缺少 detect/repair`,
      );
    }
    if (this.operations.has(op.name)) {
      throw new Error(
        `IntegrityRepairRegistry.register: 操作 ${op.name} 已登记，不允许覆盖`,
      );
    }
    this.operations.set(op.name, op);
    return this;
  }

  /** 已登记操作的只读快照（按登记顺序）。 */
  list(): readonly IntegrityRepairOperation[] {
    return [...this.operations.values()];
  }

  /** 对所有操作跑 detect，返回需要修复的列表。 */
  async detectAll(): Promise<ReadonlyArray<IntegrityRepairOperation>> {
    const pending: IntegrityRepairOperation[] = [];
    for (const op of this.operations.values()) {
      try {
        const detection = await op.detect();
        if (detection.needsRepair) {
          pending.push(op);
        }
      } catch {
        // detect 抛错时保守地加入待修复队列，让 runAll 的 repair 阶段再尝试并记录错误。
        pending.push(op);
      }
    }
    return pending;
  }

  /**
   * 跑全部操作：先 detect，needsRepair=true 的才跑 repair，每步独立 try-catch。
   *
   * 任何操作的 detect / repair 抛错都不会中断其他操作，错误挂在返回报告的 `error` 字段。
   */
  async runAll(): Promise<IntegrityRepairReport[]> {
    return this.runByFilter(() => true);
  }

  /** 只跑指定种类的操作。 */
  async runOnly(kind: IntegrityRepairKind): Promise<IntegrityRepairReport[]> {
    return this.runByFilter((op) => op.kind === kind);
  }

  private async runByFilter(
    predicate: (op: IntegrityRepairOperation) => boolean,
  ): Promise<IntegrityRepairReport[]> {
    const reports: IntegrityRepairReport[] = [];
    for (const op of this.operations.values()) {
      if (!predicate(op)) continue;
      reports.push(await runIntegrityRepair(op));
    }
    return reports;
  }
}

/**
 * 跑单个操作的 detect → repair 流程，返回报告。
 *
 * detect 抛错时保守地视为 needsRepair=true（让 repair 阶段再尝试）；
 * repair 抛错时挂到报告的 `error` 字段，不向上传播。
 */
export async function runIntegrityRepair(
  op: IntegrityRepairOperation,
): Promise<IntegrityRepairReport> {
  let detection: IntegrityRepairDetection;
  try {
    detection = await op.detect();
  } catch (err) {
    // detect 本身炸了，保守地尝试 repair，并在报告里挂上 detect 阶段的错误。
    detection = {
      needsRepair: true,
      details: `detect 阶段抛错：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!detection.needsRepair) {
    return { name: op.name, kind: op.kind, detection, repaired: false };
  }

  try {
    await op.repair();
    return { name: op.name, kind: op.kind, detection, repaired: true };
  } catch (err) {
    return { name: op.name, kind: op.kind, detection, repaired: false, error: err };
  }
}
