/**
 * 日志端口公共入口（`@novel-master/core/log`）。
 *
 * 公开面固定（spec A1）：createLogger / addLogSink / setDefaultLogSink /
 * restoreDefaultLogSink / describeText / planLogFileWrite + 7 个类型。
 * **不提供任何 test-only 导出**——测试用同一套公开 API 注入捕获 sink。
 *
 * @module infra/log
 */

export { addLogSink, createLogger, restoreDefaultLogSink, setDefaultLogSink } from "./logger.js";
export type { Logger } from "./logger.js";
export { describeText } from "./sanitize-log.js";
export { planLogFileWrite } from "./log-file-policy.js";
export type { LogFileEntry, LogFilePlan } from "./log-file-policy.js";
export type { LogDetail, LogLevel, LogRecord, LogSink } from "./log-record.js";
