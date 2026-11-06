/**
 * CLI 日志 sink：`--log-file` 摘参、stderr 级别过滤、安装行、文件轮转。
 *
 * 行为契约见 `docs/Iterations/logger-normalization/spec.md` §4.7 / §5.G：
 * stdout 保持纯数据通道，core 日志只走 stderr（warn/error）与可选的日志文件。
 *
 * @module cli-log-sink.test
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createLogger, restoreDefaultLogSink } from "@novel-master/core/log";
import { installCliLogSink } from "../src/log/cli-log-sink.js";
import { extractLogFilePath } from "../src/log/parse-log-file-arg.js";
import { runNm } from "./helpers.js";

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

/** 接管 console：内置 console sink 若还在，调用会落进 `calls`。 */
function captureConsole(): { calls: string[]; restore(): void } {
  const calls: string[] = [];
  const originals = new Map(CONSOLE_METHODS.map((name) => [name, console[name]]));
  for (const name of CONSOLE_METHODS) {
    console[name] = (...args: unknown[]) => {
      calls.push(`${name}:${args.map((arg) => String(arg)).join(" ")}`);
    };
  }
  return { calls, restore: () => { for (const name of CONSOLE_METHODS) console[name] = originals.get(name)!; } };
}

/** 接管 process.stderr.write（sink 的 stderr 通道就是它）。 */
function captureStderr(): { text(): string; restore(): void } {
  const original = process.stderr.write;
  let text = "";
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as unknown as typeof process.stderr.write;
  return { text: () => text, restore: () => { process.stderr.write = original; } };
}

afterEach(() => restoreDefaultLogSink());

describe("extractLogFilePath", () => {
  it("摘掉任意位置的 --log-file 及其值，返回剩余参数", () => {
    assert.deepEqual(extractLogFilePath(["vfs", "list", "--log-file", "a.log", "--db", "x"]), {
      logFile: "a.log",
      rest: ["vfs", "list", "--db", "x"],
    });
  });

  it("未出现或缺少值时原样返回", () => {
    assert.deepEqual(extractLogFilePath(["vfs", "list"]), { rest: ["vfs", "list"] });
    assert.deepEqual(extractLogFilePath(["--log-file"]), { rest: ["--log-file"] });
  });
});

describe("installCliLogSink", () => {
  it("G1: 安装时立刻写一行 info/cli 安装记录（目录不存在会自建）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-cli-log-"));
    const logFile = join(dir, "nested", "nm-test.log");
    try {
      installCliLogSink({ logFile });
      const first = (await readFile(logFile, "utf8")).split(/\r?\n/)[0]!;
      assert.match(first, /^\d{4}-\d{2}-\d{2}T[^\t]+\tinfo\tcli\tlog sink installed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("G2: 顶掉内置 console sink，stderr 只收 warn/error", () => {
    const stderr = captureStderr();
    const consoleCalls = captureConsole();
    try {
      installCliLogSink();
      const log = createLogger("unit.scope");
      log.debug("debug-line");
      log.info("info-line");
      log.warn("warn-line", { code: 7 });
      log.error("error-line");
    } finally {
      consoleCalls.restore();
      stderr.restore();
    }
    assert.deepEqual(consoleCalls.calls, [], "内置 console sink 应已被替换");
    assert.doesNotMatch(stderr.text(), /\t(info|debug)\t/);
    assert.match(stderr.text(), /\twarn\tunit\.scope\twarn-line\t\{"code":7\}/);
    assert.match(stderr.text(), /\terror\tunit\.scope\terror-line\t/);
  });

  it("超 2MB 切到 .1 段，基础文件不再增长", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-cli-log-seg-"));
    const logFile = join(dir, "nm-seg.log");
    const fullSize = 2 * 1024 * 1024 + 1;
    try {
      await writeFile(logFile, Buffer.alloc(fullSize));
      installCliLogSink({ logFile });
      assert.equal((await stat(logFile)).size, fullSize);
      assert.match(await readFile(join(dir, "nm-seg.1.log"), "utf8"), /\tinfo\tcli\tlog sink installed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("保留 5 份按 mtime 删最旧：基础文件最新时不被误删（字典序反例）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-cli-log-keep-"));
    const names = ["nm-keep.log", "nm-keep.1.log", "nm-keep.2.log", "nm-keep.3.log", "nm-keep.4.log", "nm-keep.5.log"];
    try {
      const now = Date.now();
      for (const [index, name] of names.entries()) {
        await writeFile(join(dir, name), "x");
        const mtime = new Date(now - index * 60_000);
        await utimes(join(dir, name), mtime, mtime);
      }
      installCliLogSink({ logFile: join(dir, "nm-keep.log") });
      assert.deepEqual((await readdir(dir)).sort(), ["nm-keep.1.log", "nm-keep.2.log", "nm-keep.3.log", "nm-keep.4.log", "nm-keep.log"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("nm --log-file 端到端", () => {
  it("G1/G2/G3: 文件首行是安装记录，core 日志落 stderr/文件而非 stdout；不传则不建文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-cli-log-e2e-"));
    const noLogDir = await mkdtemp(join(tmpdir(), "nm-cli-log-none-"));
    const logFile = join(dir, "logs", "run.log");
    try {
      const withLog = runNm(["vfs", "list", "--db", join(dir, "novel.db"), "--log-file", logFile]);
      assert.equal(withLog.status, 0, withLog.stderr);
      assert.doesNotMatch(withLog.stdout, /\[(nm|bootstrap|llm|agent|vfs|tokenizer)[.\]]/);
      const content = await readFile(logFile, "utf8");
      assert.match(content.split(/\r?\n/)[0]!, /^\d{4}-\d{2}-\d{2}T[^\t]+\tinfo\tcli\tlog sink installed/);

      const withoutLog = runNm(["vfs", "list", "--db", join(noLogDir, "novel.db")]);
      assert.equal(withoutLog.status, 0, withoutLog.stderr);
      assert.deepEqual((await readdir(noLogDir)).filter((name) => name.endsWith(".log")), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(noLogDir, { recursive: true, force: true });
    }
  });
});
