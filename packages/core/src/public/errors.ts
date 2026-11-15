/**
 * 错误通道公开入口（错误通道迁移三期 spec-3 §3.4）：`Result` / `Outcome` /
 * `AppError` 与码表首次进 public 面。
 *
 * 分工见总纲 §3.4/§3.5：`Result` 给纯计算（解析、校验、编译，不可能被中断），
 * `Outcome` 给「可能失败、也可能被中断」的操作（长循环、service、handler 的
 * doWork）；`AppError` 是唯一错误类，码表承载 message 模板；域判定走
 * `domainOf(code)`（spec-3 §3.7），apps 不再感知任何 per-domain
 * Error 子类。
 *
 * @module public/errors
 */

export { Result, Ok, Err, type ResultWire } from "../errors/either.js";
export { type AbortReason, type Interrupt, type Outcome, mapOutcome, andThenOutcome, matchOutcome, interruptOf } from "../errors/outcome.js";
export { AppError, isAppError, type AppErrorWire } from "../errors/app-error.js";
// domainOf 是域判定唯一入口（spec-3 §3.7）；DOMAIN_RANGES 段表留在 errors/domain.ts，
// 供 core 内部守卫与 test 引用，不进 public 面。
export { domainOf, type ErrorDomain } from "../errors/domain.js";
// ErrorKey / ErrorNumber 两个类型定义在 error-codes.ts，不在 app-error.ts（spec-3 §3.4）。
export { ErrorCodes, type ErrorKey, type ErrorNumber } from "../errors/error-codes.js";
