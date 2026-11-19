/**
 * AppError 结构守卫统一入口（错误通道迁移「guards 统一」）。
 *
 * 「isAppError + 域判定 + cause 链回溯」统一走 {@link ErrorGuards.inDomain}，域守卫
 * {@link isVfsError} / {@link isSessionFsError} 是本文件里它的一行组合（原 VFS 域与
 * session-fs 域守卫模块已并入，域判定只有一个实现入口）；{@link ErrorGuards.domainOf} 段判定也
 * 在这里（spec-3 §3.7 的唯一实现，public/errors 从这里转发），段表
 * {@link DOMAIN_RANGES} 仍在 errors/domain.ts 全仓唯一一份。
 *
 * @module errors/guards
 */

import { AppErrorOps, type AppError } from "@/errors/app-error.js";
import { DOMAIN_RANGES, type ErrorDomain } from "@/errors/domain.js";

/** 域守卫签名：收窄到 AppError，不收窄 key。 */
type AppErrorGuard = (e: unknown) => e is AppError;

/**
 * 域判定与域守卫操作族。
 */
export const ErrorGuards = {
  /** 域判定唯一实现：按段表返回 code 归属的域。未登记的码只能来自编程错误（AppError 的 code 恒经码表产生），按不变量破坏 throw。 */
  domainOf(code: number): ErrorDomain {
    const matched = (Object.entries(DOMAIN_RANGES) as readonly [ErrorDomain, readonly [number, number]][]).find(([, [lo, hi]]) => code >= lo && code <= hi);
    if (matched == null) {
      // nm-throw: keep — 码表外 code 属不变量破坏，返回 undefined 会让错误格式化静默走兜底
      throw new Error(`domainOf: 未登记的错误码 ${code}（码表外的 code 是不变量破坏）`);
    }
    return matched[0];
  },

  /**
   * 域守卫唯一组合：e 自身或 cause 链上任一环是 AppError 且 `code` 落在给定域段
   * 之一。域判定按段号而非 key 命名约定——语义属某域、前缀不同的 key 不会静默漏判。
   */
  inDomain(e: unknown, ...domains: ErrorDomain[]): e is AppError {
    // 沿 cause 链逐环判中（自引用与环由 visited 拦住），任一环命中即 true。
    const visited = new Set<unknown>();
    let cur: unknown = e;
    while (typeof cur === "object" && cur !== null && !visited.has(cur)) {
      visited.add(cur);
      if (AppErrorOps.is(cur) && domains.includes(ErrorGuards.domainOf(cur.code))) {
        return true;
      }
      cur = (cur as {cause?: unknown}).cause;
    }
    return false;
  },
} as const;

/**
 * 结构守卫：AppError 且 `code` 落在 VFS 域段（102000-103999），沿 cause 链回溯。
 *
 * nm-style: keep-public — VFS 域策略入口（ErrorGuards.inDomain 的 VFS 段位组合），service 多处
 * 生产调用 + 域测试直接引用；内联会把段位策略散到各调用点，不能撤导出。
 */
export const isVfsError: AppErrorGuard = (e) => ErrorGuards.inDomain(e, "VFS", "VFS_CHARACTER_CARD");

/**
 * 结构守卫：AppError 且 `code` 落在 SESSION_FS 域段（116000-116999），沿 cause 链回溯。
 *
 * nm-style: keep-public — SESSION_FS 域策略入口（{@link ErrorGuards.inDomain} 的 SESSION_FS
 * 段组合），与 {@link isVfsError} 同构的域守卫家族成员：message-rollback.service 一处生产
 * 调用（与 isVfsError 并排）+ rollback 系列测试 13 处直引。内联到唯一生产调用点会把
 * `"SESSION_FS"` 段位策略散出 guards 统一入口，破坏本文件「域守卫唯一组合」的收口设计（见模块头）。
 */
export const isSessionFsError: AppErrorGuard = (e) => ErrorGuards.inDomain(e, "SESSION_FS");
