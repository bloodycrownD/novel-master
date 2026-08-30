/**
 * 跨资源写编排抽象（S-1 / S-8 共建）。
 *
 * ## 为什么需要它
 * 项目里有三处典型的「无事务跨资源写」：
 *   1. `run-agent-turn` 里 append → capture → append 这条链；
 *   2. provider.service 的 create/edit/delete 跨 secretStore 多步顺序写；
 *   3. transcript-effects 的多步裸写。
 *
 * 这些路径底下并没有真正的数据库事务可用（secretStore / kkv / messages 各自独立），
 * 所以一旦中间步骤失败，前面的副作用就悬在那儿了。`CoordinatedWrite` 提供的是一套
 * 轻量的「补偿式回滚」约定：调用方按业务顺序注册 `execute` + `rollback`，
 * 由协调器在失败时按注册逆序触发回滚，把已经落地的副作用尽量收回去。
 *
 * 注意哦，这不是真正的 ACID 事务——回滚本身也可能失败。回滚失败时我们会把原始错误
 * 透传出去，同时把回滚阶段的错误聚合到 `errors` 字段里挂上去，方便上层日志/告警。
 *
 * @module service/coordinated-write
 */

/**
 * 单个写步骤。
 *
 * `execute` 是正向动作；`rollback` 是它的补偿动作，由协调器在失败时按注册逆序调用。
 * 名字 `name` 只用于错误信息可读性，不参与调度逻辑。
 */
export interface WriteStep {
  /** 步骤名，仅用于错误上下文，便于排查。 */
  name: string;
  /** 正向执行。任一 `execute` 抛错即视为整组失败。 */
  execute: () => Promise<void>;
  /** 补偿动作。失败时由协调器逆序调用，应当尽量幂等。 */
  rollback: () => Promise<void>;
}

/**
 * 回滚阶段本身抛错时抛出的聚合错误。
 *
 * 原始失败原因放在 `cause`；回滚阶段收集到的错误通过 `rollbackErrors` 暴露给上层，
 * 这样既不掩盖第一次的根因，又不会把回滚失败悄悄吃掉。
 */
export class CoordinatedWriteRollbackError extends Error {
  /** 回滚阶段（按逆序）收集到的错误，可能与 `cause` 一一对应，也可能为空。 */
  readonly rollbackErrors: ReadonlyArray<{ step: string; error: unknown }>;

  constructor(
    cause: unknown,
    rollbackErrors: ReadonlyArray<{ step: string; error: unknown }>
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const rolledBackNames = rollbackErrors
      .map((entry) => entry.step)
      .join(", ");
    super(
      `CoordinatedWrite 在回滚阶段再次失败（原始原因：${causeMessage}；回滚失败步骤：${
        rolledBackNames || "<无>"
      }）`
    );
    this.name = "CoordinatedWriteRollbackError";
    this.cause = cause;
    this.rollbackErrors = rollbackErrors;
  }
}

/**
 * 协调式写：注册步骤 + 失败时按逆序回滚。
 *
 * 典型用法：
 *
 * ```ts
 * await new CoordinatedWrite()
 *   .register({
 *     name: "append-user-message",
 *     execute: async () => { msgId = await append(...); },
 *     rollback: async () => { await deleteMessage(msgId); },
 *   })
 *   .register({
 *     name: "capture-checkpoint",
 *     execute: async () => { await capture(...); },
 *     rollback: async () => { await releaseCapture(...); },
 *   })
 *   .run();
 * ```
 *
 * 设计取舍：
 * - `execute` 与 `rollback` 是成对的，不提供「只执行不回滚」的便捷入口，避免调用方
 *   习惯性漏写补偿逻辑；
 * - 回滚阶段是「尽力而为」，单个步骤回滚失败不会中断后续步骤的回滚——尽量把已落
 *   地的副作用都收回来，比中途停下更安全；
 * - 回滚整体失败时，会抛 `CoordinatedWriteRollbackError`，原始根因挂在 `cause` 上。
 */
export class CoordinatedWrite {
  private readonly steps: WriteStep[] = [];

  /** 注册一个步骤，返回 `this` 以便链式调用。 */
  register(step: WriteStep): this {
    if (!step || typeof step.execute !== "function") {
      throw new TypeError(
        `CoordinatedWrite.register: 步骤 ${step?.name ?? "<匿名>"} 缺少 execute`
      );
    }
    if (typeof step.rollback !== "function") {
      throw new TypeError(
        `CoordinatedWrite.register: 步骤 ${step.name} 缺少 rollback`
      );
    }
    this.steps.push(step);
    return this;
  }

  /**
   * 按注册顺序执行所有步骤。
   *
   * 任一 `execute` 抛错时，协调器会：
   *   1. 记下原始错误作为根因；
   *   2. 对「已经成功执行过」的步骤按注册逆序调用 `rollback`；
   *   3. 回滚阶段的错误会被聚合，不会中断后续步骤的回滚；
   *   4. 若回滚阶段出现任何错误，抛 `CoordinatedWriteRollbackError`（根因挂在
   *      `cause`）；否则直接透传原始错误。
   */
  async run(): Promise<void> {
    const executed: WriteStep[] = [];
    try {
      for (const step of this.steps) {
        await step.execute();
        executed.push(step);
      }
    } catch (rootCause) {
      const rollbackErrors: { step: string; error: unknown }[] = [];
      // 按注册逆序回滚已经成功执行的步骤。
      for (let i = executed.length - 1; i >= 0; i--) {
        const step = executed[i];
        if (!step) continue;
        try {
          await step.rollback();
        } catch (err) {
          // 单步回滚失败不中断后续回滚，聚合起来统一上报。
          rollbackErrors.push({ step: step.name, error: err });
        }
      }
      if (rollbackErrors.length > 0) {
        throw new CoordinatedWriteRollbackError(rootCause, rollbackErrors);
      }
      throw rootCause;
    }
  }
}

/**
 * 把一组「执行 + 回滚」对快速拼成 `CoordinatedWrite` 并立刻运行。
 *
 * 适合一次性、不需要外部继续注册的场景。需要分批注册或链式拼装时，
 * 直接用 `new CoordinatedWrite()` 即可。
 */
export async function runCoordinatedWrite(steps: WriteStep[]): Promise<void> {
  const write = new CoordinatedWrite();
  for (const step of steps) write.register(step);
  await write.run();
}
