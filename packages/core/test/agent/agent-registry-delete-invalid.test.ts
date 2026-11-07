import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentRegistryService, isAppError } from "@novel-master/core/agent";
import { SqliteAgentDefinitionRepository } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import { tCore } from "../helpers/core-i18n.js";

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

    await assert.rejects(
      () => repo.get(agentId),
      (err: unknown) =>
        err instanceof Error && /prompts\.blocks/.test(err.message),
    );

    await registry.delete(agentId);

    assert.equal(await repo.exists(agentId), false);
    assert.equal(await repo.get(agentId), null);
    await assert.rejects(
      () => registry.get(agentId),
      (err: unknown) =>
        isAppError(err, "AGENT_NOT_FOUND"),
    );
  });

  it("不存在的 agent 删除仍抛 AGENT_NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const missingId = `missing-${testIsolationSuffix()}`;

    await assert.rejects(
      () => registry.delete(missingId),
      (err: unknown) =>
        isAppError(err, "AGENT_NOT_FOUND"),
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
