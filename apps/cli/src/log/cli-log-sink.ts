/**
 * CLI 日志 sink：stderr + 可选 `--log-file`。
 *
 * CLI 的 stdout 是数据通道（`nm agent create` 只出 id 等），所以这里用
 * `setDefaultLogSink` 顶掉 core 内置的 console sink：core 日志一律不进 stdout。
 * - stderr 只收 `warn` / `error`——`info` / `debug` 会把每次执行刷屏；
 * - `--log-file` 时额外落盘，收全部级别；轮转与保留交给 core 的纯策略
 *   `planLogFileWrite`（2MB / 留 5 份），用户点名的文件名就是第一段。
 *
 * @module log/cli-log-sink
 */

import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createLogger, planLogFileWrite, setDefaultLogSink, type LogFileEntry, type LogRecord } from "@novel-master/core/log";

interface FileTarget {
  append(line: string, now: Date): void;
}

/**
 * 建文件目标：安装时校准各段已写字节，每次 append 后累加。
 *
 * 失败只提示一次并停用文件通道——sink 自己不能再调 logger（会递归），
 * 所以直接写 stderr；stderr 通道与业务都不受影响。
 */
// nm-style: keep-local — 文件 sink 的共享可变状态（existing 字节/mtime 账本 + disabled 生命周期）必须跨 append 保留，内联进 installCliLogSink 会把状态机与参数装配混在一起。
function createFileTarget(logFile: string): FileTarget {
  const dir = dirname(logFile);
  const baseName = basename(logFile).replace(/\.log$/i, "");
  const family = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.\\d+)?\\.log$`);
  let existing: LogFileEntry[] = [];
  let disabled = false;
  const disable = (error: unknown): void => {
    if (disabled) return;
    disabled = true;
    process.stderr.write(`[nm-log] ${dir} 日志文件不可用，后续仅输出到 stderr：${error instanceof Error ? error.message : String(error)}\n`);
  };
  try {
    mkdirSync(dir, { recursive: true });
    existing = readdirSync(dir)
      .filter((name) => family.test(name))
      .map((name) => {
        const { mtimeMs, size } = statSync(join(dir, name));
        return { name, mtimeMs, bytes: size };
      });
  } catch (error) {
    disable(error);
  }
  return {
    append(line, now) {
      if (disabled) return;
      try {
        const appendBytes = Buffer.byteLength(line);
        const plan = planLogFileWrite({ now, existing, appendBytes, baseName });
        for (const name of plan.deleteNames) {
          try {
            unlinkSync(join(dir, name));
          } catch {
            /* 删旧文件失败不阻塞本次写入，下次轮转再试 */
          }
          existing = existing.filter((entry) => entry.name !== name);
        }
        appendFileSync(join(dir, plan.targetName), line);
        const previousBytes = existing.find((entry) => entry.name === plan.targetName)?.bytes ?? 0;
        existing = [...existing.filter((entry) => entry.name !== plan.targetName), { name: plan.targetName, mtimeMs: now.getTime(), bytes: previousBytes + appendBytes }];
      } catch (error) {
        disable(error);
      }
    },
  };
}

/**
 * 安装 CLI sink（顶掉内置 console sink），并立刻写一行安装记录。
 *
 * 用 `setDefaultLogSink` 而不是 `addLogSink`：内置 console sink 若还在，
 * core 里原先的 `console.log` 收口后照样写 stdout，stdout 就不再是纯数据通道。
 */
// nm-style: keep-public — CLI 的日志边界（spec T8 指定的注入点）；main 只调一次但不把 sink 装配与轮转状态搬进分发入口。
export function installCliLogSink(options: { readonly logFile?: string } = {}): void {
  const fileTarget = options.logFile === undefined ? undefined : createFileTarget(options.logFile);
  setDefaultLogSink({
    write(record: LogRecord) {
      const line = `${new Date(record.ts).toISOString()}\t${record.level}\t${record.scope}\t${record.message}\t${JSON.stringify(record.detail) ?? ""}\n`;
      if (record.level === "warn" || record.level === "error") process.stderr.write(line);
      fileTarget?.append(line, new Date(record.ts));
    },
  });
  createLogger("cli").info("log sink installed");
}
