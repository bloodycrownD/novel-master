/**
 * 桌面文件 sink：写入目录、行格式、2MB 切段、级别过滤。
 *
 * logsDir 全部显式注入临时目录——electron-stub 的 `getPath` 对非 userData 一律
 * 返回 `/tmp`，不能用来断言真实日志目录。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createLogger, restoreDefaultLogSink, setDefaultLogSink } from "@novel-master/core/log";
import { installDesktopLogSink } from "../src/main/log/desktop-log-sink.js";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function todayBaseName(now: Date): string {
  return `nm-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nm-desktop-log-sink-"));
  setDefaultLogSink(null);
  try {
    run(dir);
  } finally {
    restoreDefaultLogSink();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("installDesktopLogSink", () => {
  it("按 ISO\\tlevel\\tscope\\tmessage\\tdetail 写当日文件", () => {
    withTempDir((dir) => {
      const detach = installDesktopLogSink({ logsDir: dir });
      createLogger("test.scope").info("hello", { sessionId: "abc" });
      detach();

      const content = readFileSync(path.join(dir, `${todayBaseName(new Date())}.log`), "utf8");
      const fields = content.trimEnd().split("\n")[0]!.split("\t");
      assert.equal(fields.length, 5);
      assert.match(fields[0]!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(fields[1], "info");
      assert.equal(fields[2], "test.scope");
      assert.equal(fields[3], "hello");
      assert.deepEqual(JSON.parse(fields[4]!), { sessionId: "abc" });
    });
  });

  it("段 0 已满 2MB 时写到 .1 段", () => {
    withTempDir((dir) => {
      const baseName = todayBaseName(new Date());
      writeFileSync(path.join(dir, `${baseName}.log`), "x".repeat(2 * 1024 * 1024 + 1));

      const detach = installDesktopLogSink({ logsDir: dir });
      createLogger("test.rotation").warn("rotated");
      detach();

      const rotated = readFileSync(path.join(dir, `${baseName}.1.log`), "utf8");
      assert.match(rotated, /rotated/);
    });
  });

  it("production 且无 NM_DEBUG_* 时 debug 不落盘、info 落盘", () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      NM_DEBUG_DESKTOP: process.env.NM_DEBUG_DESKTOP,
      NM_DEBUG_LLM_FETCH: process.env.NM_DEBUG_LLM_FETCH,
    };
    process.env.NODE_ENV = "production";
    delete process.env.NM_DEBUG_DESKTOP;
    delete process.env.NM_DEBUG_LLM_FETCH;
    try {
      withTempDir((dir) => {
        const detach = installDesktopLogSink({ logsDir: dir });
        const log = createLogger("test.level");
        log.debug("hidden-debug");
        log.info("shown-info");
        detach();

        const content = readFileSync(path.join(dir, `${todayBaseName(new Date())}.log`), "utf8");
        assert.doesNotMatch(content, /hidden-debug/);
        assert.match(content, /shown-info/);
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
