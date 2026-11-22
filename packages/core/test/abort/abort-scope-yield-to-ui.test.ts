/**
 * T-S5：`yieldToUi()` 的让路与两态。
 *
 * 未中断时必须先让出一个宏任务再返回 `null`（用 `setTimeout` 探测宏任务顺序）；
 * 已中断时立即返回 `Interrupt`，不再白等一个事件循环回合。
 */
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import {  AbortScopeFactory  } from "@/domain/abort/logic/create-abort-scope.js";

describe("yieldToUi：让出事件循环与两态（T-S5）", () => {
    it("未中断：先让出宏任务，随后返回 null", async () => {
        const scope = AbortScopeFactory.create();
        const order: string[] = [];
        const pending = scope.yieldToUi().then((hit) => {
            order.push("yield");
            return hit;
        });
        assert.equal(order.length, 0, "不能同步完成，必须让出事件循环");
        const macrotask = new Promise<void>((resolve) => {
            setTimeout(() => {
                order.push("macrotask");
                resolve();
            }, 0);
        });
        assert.equal(await pending, null);
        await macrotask;
        assert.deepEqual(order, ["yield", "macrotask"], "yieldToUi 的续体应排在后续宏任务之前");
    });

    it("abort 后：立即返回 cancelled Interrupt，不再等待宏任务", async () => {
        const scope = AbortScopeFactory.create();
        scope.abort("shutdown");
        let macrotaskRan = false;
        const macrotask = new Promise<void>((resolve) => {
            setTimeout(() => {
                macrotaskRan = true;
                resolve();
            }, 0);
        });
        const hit = await scope.yieldToUi();
        assert.ok(hit != null);
        assert.equal(hit.kind, "cancelled");
        assert.equal(hit.reason, "shutdown");
        assert.equal(macrotaskRan, false, "已中断路径不应先让出事件循环");
        await macrotask;
        assert.equal(macrotaskRan, true);
    });

    it("中断后返回的同样是纯数据对象，不是 Error 实例", async () => {
        const scope = AbortScopeFactory.create();
        scope.abort("user-stop");
        const hit = await scope.yieldToUi();
        assert.ok(hit != null);
        assert.equal(hit instanceof Error, false);
        assert.deepEqual(hit, { kind: "cancelled", reason: "user-stop" });
    });
});
