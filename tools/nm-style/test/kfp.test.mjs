// T-KF1~3 + 加载器：KFP 匹配三态（symbol 精确 / null 整文件 / .symbol 后缀）、suppressPrefixes、
// signatures 的 detail 包含匹配修正、真实 33 条文件加载零警告。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSuppressed, loadKfp, matchEntry } from "../dist/lib/kfp.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function captureErrors(fn) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    return { result: fn(), errors };
  } finally {
    console.error = original;
  }
}

test("加载包根真实 KFP：33 条零警告，rule 分布 32 hygiene + 1 signatures", () => {
  const { result: manifest, errors } = captureErrors(() => loadKfp());
  assert.equal(errors.length, 0);
  assert.equal(manifest.entries.length, 33);
  assert.deepEqual(manifest.suppressPrefixes, ["apps/cli/"]);
  assert.equal(manifest.entries.filter((entry) => entry.rule === "hygiene").length, 32);
  assert.equal(manifest.entries.filter((entry) => entry.rule === "signatures").length, 1);
  for (const entry of manifest.entries) {
    assert.equal(typeof entry.file, "string");
    assert.ok(entry.file.length > 0);
    assert.equal(typeof entry.reason, "string");
    assert.ok(entry.symbol === null || (typeof entry.symbol === "string" && entry.symbol.length > 0));
  }
  // 抽查两条代表性条目确认逐字迁移
  assert.ok(manifest.entries.some((entry) => entry.rule === "signatures" && entry.symbol === "raceWithCancel" && entry.file === "packages/core/src/domain/abort/logic/create-abort-scope.ts"));
  assert.ok(manifest.entries.some((entry) => entry.rule === "hygiene" && entry.symbol === null && entry.file === "packages/core/src/errors/either.ts"));
});

const FIXTURE = {
  entries: [
    { rule: "hygiene", file: "packages/core/src/errors/guards.ts", symbol: "isVfsError", reason: "r" },
    { rule: "hygiene", file: "packages/core/src/errors/either.ts", symbol: null, reason: "r" },
    { rule: "hygiene", file: "packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts", symbol: "deleteAfterSeq", reason: "r" },
    { rule: "signatures", file: "packages/core/src/domain/abort/logic/create-abort-scope.ts", symbol: "raceWithCancel", reason: "r" },
    { rule: "hygiene", file: "packages/core/src/domain/abort/logic/create-abort-scope.ts", symbol: "race", line: 202, reason: "r" },
  ],
  suppressPrefixes: ["apps/cli/"],
};

test("T-KF1 symbol 精确匹配；file 或 rule 不一致不命中", () => {
  assert.ok(matchEntry({ rule: "hygiene", file: "packages/core/src/errors/guards.ts", line: 82, symbol: "isVfsError" }, FIXTURE) != null);
  assert.equal(matchEntry({ rule: "hygiene", file: "packages/core/src/errors/guards.ts", line: 82, symbol: "isSessionFsError" }, FIXTURE), null);
  assert.equal(matchEntry({ rule: "hygiene", file: "packages/core/src/errors/other.ts", line: 82, symbol: "isVfsError" }, FIXTURE), null);
  assert.equal(matchEntry({ rule: "signatures", file: "packages/core/src/errors/guards.ts", line: 82, symbol: "isVfsError" }, FIXTURE), null);
});

test("T-KF2 symbol:null 整文件命中；Class.member 后缀匹配；entry.line 有值时行号必须一致", () => {
  assert.ok(matchEntry({ rule: "hygiene", file: "packages/core/src/errors/either.ts", line: 44, symbol: "Ok.mapErr" }, FIXTURE) != null);
  assert.ok(matchEntry({ rule: "hygiene", file: "packages/core/src/errors/either.ts", line: 113, symbol: "Err.orElse" }, FIXTURE) != null);
  assert.ok(matchEntry({ rule: "hygiene", file: "packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts", line: 375, symbol: "SqliteMessageRepository.deleteAfterSeq" }, FIXTURE) != null);
  // 中段包含不算后缀命中
  assert.equal(matchEntry({ rule: "hygiene", file: "packages/core/src/domain/chat/repositories/impl/sqlite-message.repository.ts", line: 375, symbol: "deleteAfterSeqImpl" }, FIXTURE), null);
  assert.ok(matchEntry({ rule: "hygiene", file: "packages/core/src/domain/abort/logic/create-abort-scope.ts", line: 202, symbol: "race" }, FIXTURE) != null);
  assert.equal(matchEntry({ rule: "hygiene", file: "packages/core/src/domain/abort/logic/create-abort-scope.ts", line: 203, symbol: "race" }, FIXTURE), null);
});

test("T-KF3 suppressPrefixes：前缀与目录本身命中，其他路径不命中", () => {
  assert.equal(isSuppressed("apps/cli/src/main.ts", FIXTURE), true);
  assert.equal(isSuppressed("apps/cli", FIXTURE), true);
  assert.equal(isSuppressed("apps/cli2/src/main.ts", FIXTURE), false);
  assert.equal(isSuppressed("packages/core/src/errors/guards.ts", FIXTURE), false);
});

test("signatures 匹配修正：detail 包含 entry.symbol 即命中（includes 是旧后缀匹配的严格超集；旧后缀对 .raceWithCancel 本就命中，见 cr-func-signatures P2-1）", () => {
  const detail = "scope.raceWithCancel(signal, work, rejectWith)";
  assert.ok(matchEntry({ rule: "signatures", file: "packages/core/src/domain/abort/logic/create-abort-scope.ts", line: 206, symbol: detail, detail }, FIXTURE) != null);
  assert.equal(matchEntry({ rule: "signatures", file: "packages/core/src/domain/abort/logic/create-abort-scope.ts", line: 206, symbol: detail, detail: "scope.fork(signal)" }, FIXTURE), null);
});

test("加载器：显式路径 + 值域外条目告警剔除 + line 0 不比行 + suppressPrefixes 归一", () => {
  const file = path.join(os.tmpdir(), `nm-style-kfp-test-${process.pid}-${Date.now()}.json`);
  const raw = {
    note: "test",
    entries: [
      { rule: "bare-exports", file: "a.ts", symbol: null, reason: "值域外" },
      { rule: "hygiene", file: "a.ts", symbol: "fn", line: 0, reason: "line 0 → 不比行" },
      { file: "b.ts", symbol: "x", reason: "缺 rule" },
    ],
    suppressPrefixes: ["apps/cli/"],
  };
  fs.writeFileSync(file, JSON.stringify(raw));
  try {
    const { result: manifest, errors } = captureErrors(() => loadKfp(file));
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0].symbol, "fn");
    assert.equal(manifest.entries[0].line, 0);
    assert.equal(errors.length, 2); // 值域外 + 缺 rule 各告警一条
    assert.equal(isSuppressed("apps/cli/src/main.ts", manifest), true);
    assert.ok(matchEntry({ rule: "hygiene", file: "a.ts", line: 999, symbol: "fn" }, manifest) != null);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
