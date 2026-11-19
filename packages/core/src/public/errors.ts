/**
 * 错误通道公开入口（错误通道迁移三期 spec-3 §3.4）：`Result` / `Outcome` /
 * `AppError` 与码表首次进 public 面。
 *
 * 分工见总纲 §3.4/§3.5：`Result` 给纯计算（解析、校验、编译，不可能被中断），
 * `Outcome` 给「可能失败、也可能被中断」的操作（长循环、service、handler 的
 * doWork）；`AppError` 是唯一错误类，码表承载 message 模板；域判定走
 * `ErrorGuards.domainOf`（spec-3 §3.7），apps 不再感知任何 per-domain
 * Error 子类。
 *
 * @module public/errors
 */

export { Result, Ok, Err, type ResultWire } from "../errors/either.js";
// AbortReason / Interrupt 与 Outcome 同源（errors/outcome.ts 唯一权威定义处），
// 是 apps 的公开消费类型，随 Outcome 一起出 public 面（public/abort.ts 注释承诺从 errors 取）。
export { Outcome, type AbortReason, type Interrupt } from "../errors/outcome.js";
export { AppError, AppErrorOps } from "../errors/app-error.js";
// ErrorGuards.domainOf 是域判定唯一入口（spec-3 §3.7，实现随 guards 统一收进 errors/guards.ts）；
// DOMAIN_RANGES 段表留在 errors/domain.ts，供 core 内部守卫与 test 引用，不进 public 面。
export { ErrorGuards } from "../errors/guards.js";
export type { ErrorDomain } from "../errors/domain.js";
// ErrorKey / ErrorNumber 两个类型定义在 error-codes.ts，不在 app-error.ts（spec-3 §3.4）。
export { ErrorCodes, type ErrorKey, type ErrorNumber } from "../errors/error-codes.js";
