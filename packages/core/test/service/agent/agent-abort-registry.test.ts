/**
 * AgentAbortRegistry 单测。
 *
 * 覆盖：
 * - T-R1：register / abort / unregister / has 基本语义 + unregister 所有权比对
 *   （不同 controller 实例不删）；
 * - T-R3：隔离性——register 父 + 子两个 sessionId，abort 子不影响父 controller。
 *
 * @module test/service/agent/agent-abort-registry.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentAbortRegistry } from "@/service/agent/create-agent-abort-registry.js";

describe("AgentAbortRegistry", () => {
  describe("T-R1 register/abort/unregister/has + 所有权校验", () => {
    it("register 后 has===true；abort 后 controller.signal.aborted===true；unregister 后 has===false", () => {
      const registry = createAgentAbortRegistry();
      const controller = new AbortController();

      registry.register("sess-1", controller);
      assert.equal(registry.has("sess-1"), true);

      registry.abort("sess-1");
      assert.equal(controller.signal.aborted, true);

      registry.unregister("sess-1", controller);
      assert.equal(registry.has("sess-1"), false);
    });

    it("unregister 带所有权比对：不同 controller 实例不删", () => {
      const registry = createAgentAbortRegistry();
      const first = new AbortController();
      const second = new AbortController();

      registry.register("sess-1", first);
      // 新 run 覆盖了同一 sessionId 的记录。
      registry.register("sess-1", second);
      assert.equal(registry.has("sess-1"), true);

      // 旧 run 走完 finally 反注册：所有权比对不成立，应跳过删除。
      registry.unregister("sess-1", first);
      assert.equal(registry.has("sess-1"), true);

      // 新 run 反注册：所有权比对成立，删除。
      registry.unregister("sess-1", second);
      assert.equal(registry.has("sess-1"), false);
    });

    it("abort / unregister 未注册的 sessionId 静默 no-op", () => {
      const registry = createAgentAbortRegistry();
      const controller = new AbortController();

      // 不应抛错。
      registry.abort("unknown");
      registry.unregister("unknown", controller);
      assert.equal(registry.has("unknown"), false);
      // 未注册就 abort，controller 不应被改动。
      assert.equal(controller.signal.aborted, false);
    });

    it("abort 后不删记录，has 仍为 true，直到 unregister 才清", () => {
      const registry = createAgentAbortRegistry();
      const controller = new AbortController();

      registry.register("sess-1", controller);
      registry.abort("sess-1");
      // abort 故意不删——交给 finally 的 unregister 删。
      assert.equal(registry.has("sess-1"), true);

      registry.unregister("sess-1", controller);
      assert.equal(registry.has("sess-1"), false);
    });
  });

  describe("T-R3 中断隔离性", () => {
    it("register 父 + 子两个 sessionId，abort 子不影响父 controller 与父注册状态", () => {
      const registry = createAgentAbortRegistry();
      const parentController = new AbortController();
      const childController = new AbortController();

      registry.register("parent-session", parentController);
      registry.register("child-session", childController);

      registry.abort("child-session");

      assert.equal(parentController.signal.aborted, false);
      assert.equal(childController.signal.aborted, true);
      assert.equal(registry.has("parent-session"), true);
      assert.equal(registry.has("child-session"), true);
    });
  });
});
