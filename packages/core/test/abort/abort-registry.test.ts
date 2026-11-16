/**
 * T-S8：泛化 `AbortRegistry` 的登记/中断/释放语义。
 *
 * 与 `signal-view.test.ts` 区分：那一份测的是裸 `AbortSignal` 的只读适配，
 * 本文件才锁 registry 自身——abort(key) 只取消该 key、abortAll 取消全部、
 * unregister 所有权比对、register 覆盖 vs tryRegister 冲突。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAbortRegistry } from "@/domain/abort/logic/create-abort-registry.js";
import { createAbortScope } from "@/domain/abort/logic/create-abort-scope.js";
import { ABORT_KEY } from "@/domain/abort/model/abort-key.js";

describe("AbortRegistry 泛化语义（T-S8）", () => {
  it("abort(key) 只取消该 key；其余登记项保持未中断", () => {
    const registry = createAbortRegistry();
    const backup = createAbortScope();
    const sync = createAbortScope();
    registry.register(ABORT_KEY.backup("r1"), backup);
    registry.register(ABORT_KEY.cloudSync("local"), sync);

    registry.abort(ABORT_KEY.backup("r1"));

    assert.equal(backup.reason, "user-stop");
    assert.equal(backup.signal.aborted, true);
    assert.equal(sync.reason, null);
    assert.equal(sync.signal.aborted, false);
    // abort 不删登记：删除交给 finally 的 unregister。
    assert.equal(registry.has(ABORT_KEY.backup("r1")), true);
  });

  it("abort(key, reason) 保留显式原因；未登记 key 静默 no-op", () => {
    const registry = createAbortRegistry();
    const scope = createAbortScope();
    registry.register(ABORT_KEY.usageStats("u1"), scope);

    registry.abort("not-registered");
    assert.equal(scope.reason, null);

    registry.abort(ABORT_KEY.usageStats("u1"), "timeout");
    assert.equal(scope.reason, "timeout");
    assert.equal(scope.checkpoint()?.kind, "cancelled");
  });

  it("abortAll(reason) 取消全部登记项，且不改变登记表", () => {
    const registry = createAbortRegistry();
    const first = createAbortScope();
    const second = createAbortScope();
    registry.register(ABORT_KEY.backup("r1"), first);
    registry.register(ABORT_KEY.dbMaintenance("m1"), second);

    registry.abortAll("shutdown");

    assert.equal(first.reason, "shutdown");
    assert.equal(second.reason, "shutdown");
    assert.equal(registry.has(ABORT_KEY.backup("r1")), true);
    assert.equal(registry.has(ABORT_KEY.dbMaintenance("m1")), true);
  });

  it("unregister 所有权比对：旧 scope 的反注册不误删覆盖后的新 scope", () => {
    const registry = createAbortRegistry();
    const oldScope = createAbortScope();
    const newScope = createAbortScope();
    registry.register(ABORT_KEY.compaction("s1"), oldScope);
    registry.register(ABORT_KEY.compaction("s1"), newScope);

    registry.unregister(ABORT_KEY.compaction("s1"), oldScope);
    assert.equal(registry.has(ABORT_KEY.compaction("s1")), true);
    assert.equal(registry.get(ABORT_KEY.compaction("s1")), newScope);

    registry.unregister(ABORT_KEY.compaction("s1"), newScope);
    assert.equal(registry.has(ABORT_KEY.compaction("s1")), false);
  });

  it("register 覆盖语义：同 key 后写生效，abort 只命中新 scope", () => {
    const registry = createAbortRegistry();
    const first = createAbortScope();
    const second = createAbortScope();
    registry.register("same-key", first);
    registry.register("same-key", second);

    registry.abort("same-key");
    assert.equal(first.reason, null);
    assert.equal(second.reason, "user-stop");

    registry.unregister("same-key", first);
    assert.equal(registry.has("same-key"), true);
    registry.unregister("same-key", second);
    assert.equal(registry.has("same-key"), false);
  });

  it("tryRegister / registerIfAbsent 冲突返回 false 且不覆盖既有 scope", () => {
    const registry = createAbortRegistry();
    const winner = createAbortScope();
    const loser = createAbortScope();

    assert.equal(registry.tryRegister("k", winner), true);
    assert.equal(registry.tryRegister("k", loser), false);
    assert.equal(registry.registerIfAbsent("k", loser), false);
    assert.equal(registry.get("k"), winner);

    // 败方照常走 finally：所有权比对不删赢家。
    registry.unregister("k", loser);
    assert.equal(registry.has("k"), true);
    registry.unregister("k", winner);
    assert.equal(registry.has("k"), false);
    // 释放后可重新 claim。
    assert.equal(registry.tryRegister("k", loser), true);
  });

  it("entries() 暴露当前登记项（应用退出侧 abortAll 的遍历底表）", () => {
    const registry = createAbortRegistry();
    const scope = createAbortScope();
    registry.register(ABORT_KEY.agent("s1"), scope);
    const entries = [...registry.entries()];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]![0], ABORT_KEY.agent("s1"));
    assert.equal(entries[0]![1], scope);
  });
});
