/**
 * T-S4：`checkpoint()` 的两态与错误通道纪律。
 *
 * 未中断严格返回 `null`；中断后返回 `{ kind: "cancelled", reason }`。
 * 全程不 throw、不产生 Error 实例——中断不是错误，不该占 `Result` 的失败通道。
 */
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import {  AbortScopeFactory  } from "@/domain/abort/logic/create-abort-scope.js";

describe("checkpoint：两态与不抛错（T-S4）", () => {
    it("未 abort 时严格返回 null（不是 undefined）", () => {
        const scope = AbortScopeFactory.create();
        const hit = scope.checkpoint();
        assert.equal(hit, null);
    });

    it("abort 后返回 cancelled Interrupt，reason 与首因一致", () => {
        const scope = AbortScopeFactory.create();
        scope.abort("timeout");
        scope.abort("shutdown");
        const hit = scope.checkpoint();
        assert.ok(hit != null);
        assert.equal(hit.kind, "cancelled");
        assert.equal(hit.reason, "timeout");
    });

    it("全程不抛、返回纯数据对象而非 Error 实例", () => {
        const scope = AbortScopeFactory.create();
        assert.doesNotThrow(() => scope.checkpoint());
        assert.doesNotThrow(() => scope.abort("user-stop"));
        assert.doesNotThrow(() => scope.checkpoint());
        const hit = scope.checkpoint();
        assert.ok(hit != null);
        assert.equal(hit instanceof Error, false, "中断不是错误，不能是 Error 实例");
        assert.equal(hit instanceof DOMException, false, "也不能是 DOMException/AbortError");
        assert.equal(Object.getPrototypeOf(hit), Object.prototype);
        assert.equal("message" in hit, false);
        assert.equal("stack" in hit, false);
    });

    it("重复读取稳定：每次都是同一语义的 cancelled 快照", () => {
        const scope = AbortScopeFactory.create();
        scope.abort("shutdown");
        const first = scope.checkpoint();
        const second = scope.checkpoint();
        assert.deepEqual(first, second);
        assert.deepEqual(first, { kind: "cancelled", reason: "shutdown" });
    });
});
