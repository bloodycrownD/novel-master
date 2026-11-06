/**
 * 桌面端文件 sink：把 core 日志落到 `app.getPath("logs")`。
 *
 * 轮转策略由 core 的 `planLogFileWrite` 决定（按天切 / 2MB / 留 5 份），本文件
 * 只负责「写到哪」与维护内存里的字节数。main 进程写入量小，用同步 appendFileSync
 * 保证退出前不丢、也不会和别的写入交错。
 *
 * 失败兜底走 `process.stderr.write`，不经 `console`（desktop 的 no-raw-console
 * 守卫白名单为空，sink 自己不能再调 logger，否则失败路径无限递归）。
 *
 * @module log/desktop-log-sink
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { addLogSink, planLogFileWrite, type LogFileEntry, type LogLevel, type LogRecord } from "@novel-master/core/log";
import { isDesktopLlmDebug } from "./llm-debug-flag.js";

/** 日志级别从低到高；`minLevel` 以下的记录在写盘前丢弃。 */
const LEVEL_ORDER: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 安装桌面文件 sink；返回摘除函数。
 *
 * `logsDir` 显式注入（测试不依赖 electron 的真实目录），缺省取 `app.getPath("logs")`。
 * 级别：`isDesktopLlmDebug() ? "debug" : "info"`。
 */
// nm-style: keep-public — spec 4.6 的桌面文件 sink 安装入口：main.ts 是唯一生产注入点，测试直接注入临时目录；这是端侧 driver 的公开面。
export function installDesktopLogSink(options: { readonly logsDir?: string } = {}): () => void {
  const logsDir = options.logsDir ?? app.getPath("logs");
  const minLevel = isDesktopLlmDebug() ? "debug" : "info";
  // 安装时 stat 校准一次：策略是纯函数，不回写 existing，字节数必须由 sink 自己维护。
  const entries = new Map<string, LogFileEntry>();
  try {
    mkdirSync(logsDir, { recursive: true });
    for (const name of readdirSync(logsDir)) {
      if (!name.startsWith("nm-") || !name.endsWith(".log")) continue;
      try {
        const stats = statSync(path.join(logsDir, name));
        entries.set(name, { name, mtimeMs: stats.mtimeMs, bytes: stats.size });
      } catch {
        /* 单文件 stat 失败不挡安装 */
      }
    }
  } catch {
    /* 目录不可用：写入时统一兜底报错 */
  }

  let warned = false;
  return addLogSink({
    write(record: LogRecord): void {
      if (LEVEL_ORDER.indexOf(record.level) < LEVEL_ORDER.indexOf(minLevel)) return;
      try {
        const now = new Date(record.ts);
        const baseName = `nm-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
        const line = `${now.toISOString()}\t${record.level}\t${record.scope}\t${record.message}\t${JSON.stringify(record.detail) ?? ""}\n`;
        const appendBytes = Buffer.byteLength(line);
        const plan = planLogFileWrite({
          now,
          existing: [...entries.values()].filter((entry) => entry.name.startsWith(`${baseName}.`)),
          appendBytes,
          baseName,
        });
        for (const name of plan.deleteNames) {
          try {
            unlinkSync(path.join(logsDir, name));
          } catch {
            /* 删除失败不影响本次写入 */
          }
          entries.delete(name);
        }
        const targetPath = path.join(logsDir, plan.targetName);
        const known = entries.get(plan.targetName);
        if (known === undefined) {
          // 安装后新出现的文件（同名家族首次写入 / 外部创建）：先校准一次再累加。
          try {
            const size = statSync(targetPath).size;
            entries.set(plan.targetName, { name: plan.targetName, mtimeMs: now.getTime(), bytes: size + appendBytes });
          } catch {
            entries.set(plan.targetName, { name: plan.targetName, mtimeMs: now.getTime(), bytes: appendBytes });
          }
        } else {
          entries.set(plan.targetName, { ...known, mtimeMs: now.getTime(), bytes: known.bytes + appendBytes });
        }
        appendFileSync(targetPath, line, "utf8");
      } catch (error) {
        if (!warned) {
          warned = true;
          process.stderr.write(`[nm-log] desktop log sink write failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    },
  });
}
