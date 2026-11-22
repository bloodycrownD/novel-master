/**
 * 泛化取消注册表端口：按字符串 key（由 `ABORT_KEY` 工厂生成）索引 `AbortScope`。
 *
 * 实例（Map）各进程独立，字符串相同不冲突；所有查询/中断对未注册 key 静默 no-op。
 *
 * @module domain/abort/ports/abort-registry.port
 */

import type { AbortScope } from "@/domain/abort/model/abort-scope.js";
import type { AbortReason } from "@/errors/outcome.js";

/** 进程内取消注册表。 */
export interface AbortRegistry {
    /** 无条件登记；同一 key 再次 register 会覆盖前一条记录（既有 AgentAbortRegistry 语义）。 */
    register(key: string, scope: AbortScope): void;
    /** 原子 claim：key 已存在返回 false 且不覆盖。 */
    registerIfAbsent(key: string, scope: AbortScope): boolean;
    /** 与 {@link registerIfAbsent} 同一语义（spec §二沿用 `tryRegister` 命名）。 */
    tryRegister(key: string, scope: AbortScope): boolean;
    /** 默认 `"user-stop"`；key 不存在静默 no-op，记录保留到 `unregister`。 */
    abort(key: string, reason?: AbortReason): void;
    /** 只移除同一实例（引用比对），防误删新 scope。 */
    unregister(key: string, scope: AbortScope): void;
    has(key: string): boolean;
    /** 应用退出用：中断全部登记项，但不改变登记表。 */
    abortAll(reason: AbortReason): void;
    get(key: string): AbortScope | undefined;
    entries(): IterableIterator<[string, AbortScope]>;
}
