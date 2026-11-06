/**
 * 日志端口的数据契约：级别、记录、sink。
 *
 * core 只出「记什么、怎么脱敏」；「写到哪里」由各端注入 sink 决定
 * （mobile 落 files 目录、desktop 落 app logs 目录、CLI 落 stderr/文件）。
 *
 * @module infra/log/log-record
 */

/** 日志级别（序列化到落盘文件时按此字面量写）。 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** 已脱敏的结构化 detail：只含 JSON 安全值。 */
export type LogDetail = Readonly<Record<string, unknown>>;

/** 一条日志记录（emit 出口的统一形态）。 */
export interface LogRecord {
  /** epoch ms。 */
  readonly ts: number;
  readonly level: LogLevel;
  /** `"agent.runner"` / `"vfs.zip-io"` 这类点分段标识。 */
  readonly scope: string;
  /** 已截断（500 字符）。 */
  readonly message: string;
  /** 已脱敏（key 黑名单 + 正文摘要 + 三重截断）。 */
  readonly detail?: LogDetail;
}

/** 落盘/转发端口的唯一约定：write 不得抛。 */
export interface LogSink {
  write(record: LogRecord): void;
}
