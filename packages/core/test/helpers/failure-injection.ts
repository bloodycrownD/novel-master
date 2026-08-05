/**
 * 测试用「在第 N 步抛错」注入器（S-1 测试基建，Step 19）。
 *
 * 主要给 `CoordinatedWrite` / 跨资源写相关测试用，但设计成通用工具：它本质是一个
 * 计数器 + 注入点，调用方拿到 `step(name)` 后可以把它当 `execute` 用，并配合
 * `failAt` / `failOnRollbackAt` 灵活注入失败。
 *
 * 设计取舍：
 * - 不用 sinon / mock 这种重工具，纯函数 + 闭包就够，避免测试基建过度依赖外部库；
 * - 计数从 1 开始（按人类直觉「第几步」），0 / 负数一律不触发；
 * - 默认抛 `Error`，但允许调用方通过 `makeError` 自定义（比如想验证
 *   `CoordinatedWriteRollbackError` 的根因类型时）。
 */

export interface FailureInjectionOptions {
  /**
   * 在「第 N 次正向执行」时抛错；从 1 开始计数。
   * 不传或传非正数表示不注入。
   */
  failAt?: number;
  /**
   * 在「第 N 次回滚」时抛错；从 1 开始计数。
   * 不传或传非正数表示不注入。
   */
  failOnRollbackAt?: number;
  /**
   * 自定义抛出的错误。默认抛 `Error(\`injected failure @ <name>\`)`。
   * 接收当前步骤名 + 触发阶段（"execute" / "rollback"），方便调用方按需区分。
   */
  makeError?: (name: string, phase: "execute" | "rollback") => unknown;
}

export interface FailureInjector {
  /**
   * 创建一个可被注入失败的「步骤工厂」。
   *
   * `onExecute` / `onRollback` 是真实的副作用回调，注入器在它们外面再包一层计数
   * 与判断逻辑。两个回调默认是 no-op，方便纯回滚顺序的测试。
   */
  step(
    name: string,
    callbacks?: {
      onExecute?: () => void | Promise<void>;
      onRollback?: () => void | Promise<void>;
    },
  ): {
    name: string;
    execute: () => Promise<void>;
    rollback: () => Promise<void>;
  };
  /** 当前已触发的正向执行次数。 */
  readonly executeCount: number;
  /** 当前已触发的回滚次数。 */
  readonly rollbackCount: number;
  /** 按执行顺序记录的步骤名轨迹，方便断言。 */
  readonly executedSteps: readonly string[];
  /** 按回滚顺序记录的步骤名轨迹，方便断言。 */
  readonly rolledBackSteps: readonly string[];
}

/**
 * 创建一个失败注入器。
 *
 * 注入点是「第 N 次」而不是「某个名字」，因为 Step 18 要迁移的三处调用点都会
 * 按顺序注册步骤，验证「中间步骤失败时按逆序回滚」更关心位置而非具体名字。
 */
export function createFailureInjector(
  options: FailureInjectionOptions = {},
): FailureInjector {
  const failAt = options.failAt ?? -1;
  const failOnRollbackAt = options.failOnRollbackAt ?? -1;
  const makeError =
    options.makeError ??
    ((name, phase) => new Error(`injected failure @ ${name} (${phase})`));

  let executeCount = 0;
  let rollbackCount = 0;
  const executedSteps: string[] = [];
  const rolledBackSteps: string[] = [];

  return {
    step(name, callbacks) {
      const onExecute = callbacks?.onExecute;
      const onRollback = callbacks?.onRollback;
      return {
        name,
        async execute() {
          executeCount += 1;
          executedSteps.push(name);
          // 先记轨迹，再决定要不要抛——这样断言「失败那一步也算执行过」更直观。
          if (failAt > 0 && executeCount === failAt) {
            throw makeError(name, "execute");
          }
          await onExecute?.();
        },
        async rollback() {
          rollbackCount += 1;
          rolledBackSteps.push(name);
          if (failOnRollbackAt > 0 && rollbackCount === failOnRollbackAt) {
            throw makeError(name, "rollback");
          }
          await onRollback?.();
        },
      };
    },
    get executeCount() {
      return executeCount;
    },
    get rollbackCount() {
      return rollbackCount;
    },
    get executedSteps() {
      return executedSteps;
    },
    get rolledBackSteps() {
      return rolledBackSteps;
    },
  };
}
