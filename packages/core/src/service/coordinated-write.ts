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
 * 注意哦，这不是真正的 ACID 事务——回滚本身也可能失败。回滚失败时 `run()` 返回
 * `INFRA_ROLLBACK_DEGRADED`（根因挂 `cause`、回滚失败清单进 details），上层据此分级告警
 * （error-matrix-final R1：异常哨兵 CoordinatedWriteRollbackError 已退役，全函数纯 Result）。
 *
 * @module service/coordinated-write
 */

import {assert} from "@/common/assert.js";
import {Result} from "@/errors/either.js";
import {AppError} from "@/errors/app-error.js";

/**
 * 单个写步骤。
 *
 * `execute` 是正向动作；`rollback` 是它的补偿动作，由协调器在失败时按注册逆序调用。
 * 名字 `name` 只用于错误信息可读性，不参与调度逻辑。
 *
 * 失败走返回值：`execute` / `rollback` 收 `Result`，Err 即失败并触发逆序补偿；
 * 未知异常也允许抛（平台漏出），由 run() 的 catch 回滚后统一转 `INFRA_UNEXPECTED_ERROR`。
 */
interface WriteStep {
    /** 步骤名，仅用于错误上下文，便于排查。 */
    name: string;
    /** 正向执行。任一 `execute` 返回 Err 即视为整组失败。 */
    execute: () => Promise<Result<void, AppError>>;
    /** 补偿动作。失败时由协调器逆序调用，应当尽量幂等。 */
    rollback: () => Promise<Result<void, AppError>>;
}

/**
 * 逆序回滚已执行步骤：单步回滚失败不中断后续回滚、错误聚合；回滚阶段有失败时
 * 返回 `INFRA_ROLLBACK_DEGRADED`（根因挂 `cause`、清单进 details）；未知根因
 * （非 AppError）返回 `INFRA_UNEXPECTED_ERROR`（cause 透传）。
 */
const rollbackExecuted = async (executed: readonly WriteStep[], from: number, rootCause: unknown): Promise<Result<void, AppError>> => {
    const rollbackErrors: { step: string; error: unknown }[] = [];
    // 按注册逆序回滚已经成功执行的步骤。
    for (let i = from; i >= 0; i--) {
        const step = executed[i];
        if (!step) continue;
        try {
            const back = await step.rollback();
            if (!back.ok) {
                // 单步回滚失败不中断后续回滚，聚合起来统一上报。
                rollbackErrors.push({step: step.name, error: back.error});
            }
        } catch (err) {
            rollbackErrors.push({step: step.name, error: err});
        }
    }
    // 回滚完成后系统状态已变（部分步骤已撤销），此时转 Result 是对现状的诚实
    // 标记而非吞并（error-matrix-final §一.2）。
    if (rollbackErrors.length > 0) {
        const causeText = rootCause instanceof Error ? rootCause.message : String(rootCause);
        const steps = rollbackErrors.map((entry) => entry.step).join(", ") || "<无>";
        return Result.err(new AppError("INFRA_ROLLBACK_DEGRADED", {causeText, steps, rollbackErrors}, {cause: rootCause}));
    }
    // 未知异常（非 AppError）：不塞业务 key，以 INFRA_UNEXPECTED_ERROR + cause 显式标记未知。
    if (!(rootCause instanceof AppError)) {
        return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", {}, {cause: rootCause}));
    }
    return Result.err(rootCause);
};

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
 * - 回滚整体失败时返回 `INFRA_ROLLBACK_DEGRADED`，原始根因挂在 `cause` 上、清单进 details。
 */
export class CoordinatedWrite {
    private readonly steps: WriteStep[] = [];

    /** 注册一个步骤，返回 `this` 以便链式调用。 */
    register(step: WriteStep): this {
        // 编程错误（API 误用）走 assert——error-matrix-final R1，TypeError 形态退役。
        assert(step && typeof step.execute === "function", `CoordinatedWrite.register: 步骤 ${step?.name ?? "<匿名>"} 缺少 execute`);
        assert(typeof step.rollback === "function", `CoordinatedWrite.register: 步骤 ${step.name} 缺少 rollback`);
        this.steps.push(step);
        return this;
    }

    /**
     * 按注册顺序执行所有步骤。
     *
     * 任一 `execute` 失败（Err 或抛错）时，协调器会：
     *   1. 记下原始失败作为根因；
     *   2. 对「已经成功执行过」的步骤按注册逆序调用 `rollback`；
     *   3. 回滚阶段的错误会被聚合，不会中断后续步骤的回滚；
     *   4. 若回滚阶段出现任何失败，返回 `INFRA_ROLLBACK_DEGRADED`（根因挂 `cause`、
     *      清单进 details）；否则已知的步骤失败沿 `Result.err` 原样返回；根因是未知
     *      异常（非 AppError）时返回 `INFRA_UNEXPECTED_ERROR`（cause 透传，不伪装成
     *      业务失败——error-matrix-final 矩阵：未知也走返回值）。
     */
    async run(): Promise<Result<void, AppError>> {
        const executed: WriteStep[] = [];
        try {
            for (const step of this.steps) {
                const outcome = await step.execute();
                if (!outcome.ok) {
                    return rollbackExecuted(executed, executed.length - 1, outcome.error);
                }
                executed.push(step);
            }
        } catch (rootCause) {
            return rollbackExecuted(executed, executed.length - 1, rootCause);
        }
        return Result.ok(undefined);
    }
}
