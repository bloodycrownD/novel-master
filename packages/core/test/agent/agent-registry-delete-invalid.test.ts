import assert from "node:assert/strict";
import { describe, it } from "node:test";
// isAppError 与 service 同源（@novel-master/core/errors）：src/dist 双模块
// 实例下跨 instanceof 会漏判（见 tool-runner normalizeToolFailure 同款注释）。
import { createAgentRegistryService } from "@novel-master/core/agent";
import { isAppError } from "@novel-master/core/errors";
import { SqliteAgentDefinitionRepository } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import { tCore } from "../helpers/core-i18n.js";
import { rejectsErr } from "../helpers/result-unwrap.js";

novelMasterTestFixture();

/** 含 prompts.blocks 的非法 wire，decode 会失败但行仍存在于 SQLite。 */
function brokenPromptsJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "broken",
    prompts: { blocks: {} },
  });
}

describe("AgentRegistryService.delete 不解码", () => {
  it("非法 prompts_json 行可删除，get 仍因 decode 失败", async () => {
    const ctx = getNovelMasterTestContext();
    const agentId = `broken-${testIsolationSuffix()}`;
    const repo = new SqliteAgentDefinitionRepository(ctx.conn);
    const registry = createAgentRegistryService(ctx.conn);
    const now = Date.now();

    await ctx.conn.execute(
      `INSERT INTO agent_definition (
        agent_id, prompts_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?)`,
      [agentId, brokenPromptsJson(), now, now],
    );

    assert.equal(await repo.exists(agentId), true);

    // 错误通道迁移五期：repo.get 走 Result 通道，毒行 decode 失败沿返回值上递。
    const poisoned = await repo.get(agentId);
    assert.ok(!poisoned.ok, "毒行 get 应走 Err 通道");
    if (!poisoned.ok) {
      assert.match(poisoned.error.message, /prompts\.blocks/);
    }

    await registry.delete(agentId);

    assert.equal(await repo.exists(agentId), false);
    const gone = await repo.get(agentId);
    assert.ok(gone.ok && gone.value === null, "删除后 get 返回 Ok(null)");
    await rejectsErr(
      registry.get(agentId),
      (err: unknown) =>
        assert.ok(isAppError(err, "AGENT_NOT_FOUND")),
    );
  });

  it("不存在的 agent 删除仍抛 AGENT_NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const missingId = `missing-${testIsolationSuffix()}`;

    await rejectsErr(
      registry.delete(missingId),
      (err: unknown) =>
        assert.ok(isAppError(err, "AGENT_NOT_FOUND")),
    );
  });
});

/** 错误用户可见文案：带 messageKey 时经 tCore 渲染（G1-G3 descriptor 契约），否则回退 message。 */
function renderError(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>};
  return textOf(error);
}

/** 含 cause 链（ToolError 包装 AppError 时 messageKey 在 cause 上）。 */
function textOf(error: unknown): string {
  const e = error as {message: string; messageKey?: string; messageParams?: Record<string, unknown>; cause?: unknown};
  if (e.messageKey != null) return tCore({key: e.messageKey as never, params: e.messageParams as never});
  if (e.cause != null && typeof e.cause === "object") return textOf(e.cause);
  return e.message;
}
