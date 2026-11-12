/**
 * ToolRunner 取消竞速（通用兜底）：回合 signal abort 时 call 立即 reject，
 * 不依赖工具自身监听 signal——否则 waiting 中的回合会被慢工具（curl / search
 * 等长请求）占住线程、停止按钮点不动。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolError } from "../../src/errors/tool-errors.js";

describe("ToolRunner：回合取消竞速（A-24）", () => {
  it("工具永不返回时，abort 让 call 立即 reject（不等工具）", async () => {
    const registry = new ToolRegistry<{ readonly signal?: AbortSignal }>();
    registry.register({
      name: "hang",
      description: () => "hang",
      inputSchema: z.object({}),
      run: async () => {
        await new Promise<void>(() => undefined); // 永不 resolve
        return "unreachable";
      },
    });
    const runner = new ToolRunner(registry);
    const controller = new AbortController();
    const pending = runner.call("hang", {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof ToolError);
      assert.match(String((err as { cause?: unknown }).cause), /工具调用已取消/);
      return true;
    });
  });

  it("signal 缺省时行为不变（旧装配点 / 测试 mock 兼容）", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: () => "echo",
      inputSchema: z.object({ text: z.string() }),
      run: async (input: { text: string }) => input.text,
    });
    const runner = new ToolRunner(registry);
    assert.equal(await runner.call("echo", { text: "ok" }, {}), "ok");
  });
});
