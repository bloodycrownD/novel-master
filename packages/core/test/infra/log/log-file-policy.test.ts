import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planLogFileWrite } from "@novel-master/core/log";
import type { LogFileEntry } from "@novel-master/core/log";

const MB = 1024 * 1024;
const NOW = new Date(2026, 10, 7, 9, 8, 7); // 本地时间 2026-11-07 09:08:07

function entry(name: string, mtimeMs: number, bytes = 0): LogFileEntry {
  return { name, mtimeMs, bytes };
}

describe("planLogFileWrite D1: 跨天换名", () => {
  it("默认 baseName 取本地日期（nm-YYYYMMDD）", () => {
    const plan = planLogFileWrite({ now: NOW, existing: [entry("nm-20261106.log", 1_000, 100)], appendBytes: 10 });
    assert.equal(plan.targetName, "nm-20261107.log");
    assert.deepEqual(plan.deleteNames, []);
  });

  it("自定义 baseName 不受默认命名影响", () => {
    const plan = planLogFileWrite({ now: NOW, existing: [], appendBytes: 10, baseName: "nm-crash-20261107" });
    assert.equal(plan.targetName, "nm-crash-20261107.log");
  });

  it("不同 baseName 家族互不干扰（调用方按 baseName 预过滤）", () => {
    const plan = planLogFileWrite({
      now: NOW,
      existing: [entry("nm-crash-20261107.log", 1_000, 10)],
      appendBytes: 10,
      baseName: "nm-20261107",
    });
    assert.equal(plan.targetName, "nm-20261107.log");
    assert.deepEqual(plan.deleteNames, [], "别的家族的文件不进删除列表");
  });
});

describe("planLogFileWrite D1: 超 2MB 切段", () => {
  it("段 0 将超限 → 切到 .1", () => {
    const plan = planLogFileWrite({
      now: NOW,
      existing: [entry("nm-20261107.log", 1_000, 2 * MB - 5)],
      appendBytes: 10,
    });
    assert.equal(plan.targetName, "nm-20261107.1.log");
  });

  it("段 0 / .1 都满 → 切到 .2", () => {
    const plan = planLogFileWrite({
      now: NOW,
      existing: [entry("nm-20261107.log", 1_000, 2 * MB), entry("nm-20261107.1.log", 2_000, 2 * MB)],
      appendBytes: 1,
    });
    assert.equal(plan.targetName, "nm-20261107.2.log");
  });
});

describe("planLogFileWrite D1: 保留按 mtime", () => {
  it("保留最新 keep 份，其余按 mtime 从旧到新进 deleteNames", () => {
    const existing: LogFileEntry[] = [];
    for (let i = 0; i < 7; i += 1) {
      existing.push(entry(i === 0 ? "nm-20261107.log" : `nm-20261107.${i}.log`, i * 1000, 1));
    }
    const plan = planLogFileWrite({ now: NOW, existing, appendBytes: 1 });
    // keep 默认 5：删掉 mtime 最旧的两份（index 0、1）。
    assert.deepEqual(plan.deleteNames, ["nm-20261107.log", "nm-20261107.1.log"]);
  });

  it("自定义 keep", () => {
    const existing = [entry("nm-20261107.log", 1_000, 1), entry("nm-20261107.1.log", 2_000, 1), entry("nm-20261107.2.log", 3_000, 1)];
    const plan = planLogFileWrite({ now: NOW, existing, appendBytes: 1, keep: 2 });
    assert.deepEqual(plan.deleteNames, ["nm-20261107.log"]);
  });
});

describe("planLogFileWrite D2: 边界", () => {
  it("appendBytes 恰好等于剩余空间时不切段", () => {
    const plan = planLogFileWrite({
      now: NOW,
      existing: [entry("nm-20261107.log", 1_000, 2 * MB - 10)],
      appendBytes: 10,
    });
    assert.equal(plan.targetName, "nm-20261107.log");
  });

  it("超 1 字节时切段", () => {
    const plan = planLogFileWrite({
      now: NOW,
      existing: [entry("nm-20261107.log", 1_000, 2 * MB - 10)],
      appendBytes: 11,
    });
    assert.equal(plan.targetName, "nm-20261107.1.log");
  });

  it("k=99 之后退到 <baseName>.<hhmmss>.log", () => {
    const existing: LogFileEntry[] = [];
    for (let segment = 0; segment <= 99; segment += 1) {
      existing.push(entry(segment === 0 ? "nm-20261107.log" : `nm-20261107.${segment}.log`, segment * 1000, 2 * MB));
    }
    const plan = planLogFileWrite({ now: NOW, existing, appendBytes: 1, keep: 200 });
    assert.equal(plan.targetName, "nm-20261107.090807.log");
  });
});

describe("planLogFileWrite D3: mtime 排序反例（不能按文件名字典序）", () => {
  it("基础文件 mtime 更旧、.1 更新：keep=1 时留下 .1", () => {
    const existing = [entry("nm-20261107.log", 1_000, 10), entry("nm-20261107.1.log", 2_000, 10)];
    const plan = planLogFileWrite({ now: NOW, existing, appendBytes: 1, keep: 1 });
    assert.deepEqual(plan.deleteNames, ["nm-20261107.log"]);
  });
});
