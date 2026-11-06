/**
 * 跨端日志运行时：`createLogger(scope)` + sink 注入。
 *
 * 与 `common/i18n.ts`、`tokenizer-driver-*` 同构：core 出运行时与脱敏契约，
 * 「写到哪」由调用方注入。两个 sink 入口分工明确：
 * - {@link addLogSink} 只追加（mobile / desktop 注入文件 sink，内置 console
 *   sink 继续在，终端/logcat 通道不断流）；
 * - {@link setDefaultLogSink} 换掉内置 sink（CLI 用它把 core 日志移出 stdout）。
 *
 * sink 故障隔离：任一 sink 抛错都被吞掉，日志永远不能让业务抛错；同时用
 * `emitting` 标志防重入（sink 内部再调 logger 不会无限递归）。
 *
 * @module infra/log/logger
 */

import type { LogDetail, LogLevel, LogSink } from "./log-record.js";
import { toLogRecord } from "./sanitize-log.js";

/** 调用面：一级方法绑定 scope，`child` 拼点分后缀。 */
// nm-style: keep-public — 三端 createLogger 的返回类型契约（spec A1 公开面），core 内只经推断使用。
export interface Logger {
  readonly scope: string;
  debug(message: string, detail?: LogDetail): void;
  info(message: string, detail?: LogDetail): void;
  warn(message: string, detail?: LogDetail): void;
  error(message: string, detail?: LogDetail): void;
  child(scope: string): Logger;
}

/**
 * 内置 console sink（默认安装）。
 *
 * 不过滤级别——与今天 `console.debug` 无条件打印的现状一致；级别过滤是
 * 文件 sink 各自的事（见 spec 4.2）。
 */
const consoleSink: LogSink = {
  write(record) {
    const line = `[${record.scope}] ${record.message}`;
    const method = record.level === "debug" ? console.debug : record.level === "warn" ? console.warn : record.level === "error" ? console.error : console.log;
    if (record.detail === undefined) {
      method(line);
    } else {
      method(line, record.detail);
    }
  },
};

/** 替换内置 sink 的开关；null = 关掉内置输出（已追加的 sink 不受影响）。 */
// nm-style: keep-local — 模块级单例状态（defaultSink / extraSinks / emitting）是日志门面的标准形态
// （对标 SLF4J LoggerFactory 的静态绑定）；对象化只会包一层没有第二实例的壳，包住的是同一组模块状态。
let defaultSink: LogSink | null = consoleSink;
/** 追加 sink（文件 sink 走这条）。 */
const extraSinks = new Set<LogSink>();
/** 防重入：sink 内部再调 logger 时直接丢弃，避免无限递归。 */
let emitting = false;

function emit(level: LogLevel, scope: string, message: string, detail?: LogDetail): void {
  if (emitting) {
    return;
  }
  const record = toLogRecord(level, scope, message, detail);
  const sinks = defaultSink == null ? [...extraSinks] : [defaultSink, ...extraSinks];
  emitting = true;
  try {
    for (const sink of sinks) {
      try {
        sink.write(record);
      } catch {
        /* 日志永不外溢 */
      }
    }
  } finally {
    emitting = false;
  }
}

/** 建一个绑定 scope 的 logger；`child` 拼成 `${parent}.${child}`。 */
export function createLogger(scope: string): Logger {
  return {
    scope,
    debug: (message, detail) => emit("debug", scope, message, detail),
    info: (message, detail) => emit("info", scope, message, detail),
    warn: (message, detail) => emit("warn", scope, message, detail),
    error: (message, detail) => emit("error", scope, message, detail),
    child: (childScope) => createLogger(`${scope}.${childScope}`),
  };
}

/** 追加一个 sink，返回摘除函数（与 EventSubscription 同构）。 */
// nm-style: keep-public — mobile / desktop 注入文件 sink 的入口（core 内无消费者）。
export function addLogSink(sink: LogSink): () => void {
  extraSinks.add(sink);
  return () => {
    extraSinks.delete(sink);
  };
}

/** 替换内置 sink；传 null = 关掉内置输出（已追加的 sink 不受影响）。 */
// nm-style: keep-public — CLI 把 core 日志移出 stdout 的入口（core 内无消费者）。
export function setDefaultLogSink(sink: LogSink | null): void {
  defaultSink = sink;
}

/** 恢复初始的内置 console sink（测试 afterEach / 端上撤掉自定义 sink 时用）。 */
// nm-style: keep-public — 测试与端上的 sink 复位入口（core 内无消费者）。
export function restoreDefaultLogSink(): void {
  defaultSink = consoleSink;
}
