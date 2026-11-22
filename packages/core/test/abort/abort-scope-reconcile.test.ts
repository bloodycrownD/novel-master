/**
 * T-S28：`createAbortScope` 与 `scopeFromController` 的 controller memoize
 * 后向 reconcile——先取 scope、后带 parent/timeout 再建时，不得静默丢弃。
 *
 * 规则（spec §二）：memoize 命中即返回既有实例；`parent` 尽量补挂，
 * `timeoutMs`/`signal` 被忽略，dev 环境下对不一致 opts 打 `console.warn`。
 */
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import {  AbortScopeFactory  } from "@/domain/abort/logic/create-abort-scope.js";

describe("controller memoize 后向 reconcile（T-S28）", () => {
    it("AbortScopeFactory.fromController 之后 create({controller,parent}) 返回同一引用", () => {
        const controller = new AbortController();
        const parent = AbortScopeFactory.create();
        const first = AbortScopeFactory.fromController(controller);
        const second = AbortScopeFactory.create({ controller, parent });

        assert.equal(second, first);
        assert.equal(AbortScopeFactory.fromController(controller), first);
    });

    it("命中后补挂的 parent 级联不丢：parent.abort → 既有实例 reason=parent", () => {
        const controller = new AbortController();
        const parent = AbortScopeFactory.create();
        const existing = AbortScopeFactory.fromController(controller);
        AbortScopeFactory.create({ controller, parent });

        parent.abort("parent");

        assert.equal(existing.reason, "parent");
        assert.equal(controller.signal.aborted, true);
    });

    it("dev 环境下 opts 不一致（timeoutMs）触发 console.warn，且不新建实例", () => {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        const warnings: unknown[][] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
            warnings.push(args);
        };
        try {
            const controller = new AbortController();
            const existing = AbortScopeFactory.fromController(controller);
            const again = AbortScopeFactory.create({ controller, timeoutMs: 1000 });
            assert.equal(again, existing);
            assert.equal(warnings.length, 1, "不一致 opts 必须留下 dev warn");
            assert.match(String(warnings[0]![0]), /复用既有实例/);
        } finally {
            console.warn = originalWarn;
            if (previousEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = previousEnv;
            }
        }
    });
});
