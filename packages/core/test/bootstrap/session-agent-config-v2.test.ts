/**
 * session-agent-config-v2 migration 行为测试（T-S4）。
 *
 * 直接调用 `sessionAgentConfigV2Up`，覆盖 spec 列出的 7 个场景：
 *  1. NULL + workspace 有 agentId/modelId → 回填；
 *  2. NULL + workspace agentId 空 + registry 有 agent → 回落 registry 首项；
 *  3. NULL + workspace 与 registry 均空 → 保留 NULL；
 *  4. `{mode:"bind", agentId, modelId?}` → 剥掉 mode，保留 agentId/modelId；
 *  5. `{mode:"follow"}` → 与 NULL 同策略回填（C-2 显式分支）；
 *  6. 已是 v2 形态 → 跳过（幂等）；
 *  7. 二次执行 → 数据不变。
 *
 * @module test/bootstrap/session-agent-config-v2.test
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { sessionAgentConfigV2Up } from "../../src/bootstrap/schema-migrations/session-agent-config-v2.js";
import {
  KEY_CURRENT_AGENT_ID,
  KEY_CURRENT_MODEL_ID,
  WORKSPACE_STATE_MODULE,
} from "../../src/service/persistent-state/impl/workspace-state-keys.js";

const NOW_MS = 1_700_000_000_000;
const WS_AGENT_ID = "ws-agent-001";
const WS_MODEL_ID = "ws-model-001";
const REGISTRY_AGENT_ID = "registry-agent-001";

/** 打开内存库并跑全量 DDL，得到具备 chat_session / agent_definition / kkv_entry 的环境。 */
async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
    await conn.execute(sql);
  }
  return conn;
}

/** 写一条 workspace 指针（module=nm-workspace-state）。 */
async function setWorkspaceKey(
  conn: TdbcConnection,
  key: string,
  value: string,
): Promise<void> {
  await conn.execute(
    `INSERT OR REPLACE INTO kkv_entry (module, key, value) VALUES (?, ?, ?)`,
    [WORKSPACE_STATE_MODULE, key, value],
  );
}

/** 写一条 agent_definition 种子行。 */
async function seedAgent(conn: TdbcConnection, agentId: string): Promise<void> {
  await conn.execute(
    `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
    [agentId, JSON.stringify({ schemaVersion: 1, name: agentId }), NOW_MS, NOW_MS],
  );
}

/** 写一条 chat_session 种子行；agentConfigJson 传 null 表示 NULL。 */
async function seedSession(
  conn: TdbcConnection,
  sessionId: string,
  agentConfigJson: string | null,
): Promise<void> {
  await conn.execute(
    `INSERT INTO chat_session (id, project_id, title, agent_config_json, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, "proj-1", "t", agentConfigJson, NOW_MS, NOW_MS],
  );
}

/** 读某条 chat_session 的 agent_config_json（保留 NULL）。 */
async function readSessionConfig(
  conn: TdbcConnection,
  sessionId: string,
): Promise<string | null> {
  const rows = await conn.query<{ agent_config_json: string | null }>(
    `SELECT agent_config_json FROM chat_session WHERE id = ?`,
    [sessionId],
  );
  return rows[0]?.agent_config_json ?? null;
}

describe("session-agent-config-v2 migration（T-S4）", () => {
  it("场景1：NULL + workspace 有 agentId/modelId → 回填", async () => {
    const conn = await openMemoryConn();
    try {
      await setWorkspaceKey(conn, KEY_CURRENT_AGENT_ID, WS_AGENT_ID);
      await setWorkspaceKey(conn, KEY_CURRENT_MODEL_ID, WS_MODEL_ID);
      const sessionId = randomUUID();
      await seedSession(conn, sessionId, null);

      await sessionAgentConfigV2Up(conn);

      const raw = await readSessionConfig(conn, sessionId);
      assert.notEqual(raw, null);
      const parsed = JSON.parse(raw!) as Record<string, unknown>;
      assert.equal(parsed.agentId, WS_AGENT_ID);
      assert.equal(parsed.modelId, WS_MODEL_ID);
      assert.equal("mode" in parsed, false);
    } finally {
      await conn.close();
    }
  });

  it("场景2：NULL + workspace agentId 空 + registry 有 agent → 回落 registry 首项", async () => {
    const conn = await openMemoryConn();
    try {
      // 不写 workspace currentAgentId；registry 写两条，首项按 agent_id ASC。
      await seedAgent(conn, "zzz-tail");
      await seedAgent(conn, REGISTRY_AGENT_ID);
      const sessionId = randomUUID();
      await seedSession(conn, sessionId, null);

      await sessionAgentConfigV2Up(conn);

      const raw = await readSessionConfig(conn, sessionId);
      assert.notEqual(raw, null);
      const parsed = JSON.parse(raw!) as Record<string, unknown>;
      // agent_id ASC 首项即 REGISTRY_AGENT_ID。
      assert.equal(parsed.agentId, REGISTRY_AGENT_ID);
      // workspace 未提供 currentModelId，modelId 应缺省。
      assert.equal("modelId" in parsed, false);
      assert.equal("mode" in parsed, false);
    } finally {
      await conn.close();
    }
  });

  it("场景3：NULL + workspace 与 registry 均空 → 保留 NULL", async () => {
    const conn = await openMemoryConn();
    try {
      // 不写 workspace 指针，也不写 agent_definition。
      const sessionId = randomUUID();
      await seedSession(conn, sessionId, null);

      await sessionAgentConfigV2Up(conn);

      const raw = await readSessionConfig(conn, sessionId);
      assert.equal(raw, null);
    } finally {
      await conn.close();
    }
  });

  it("场景4：{mode:'bind', agentId, modelId?} → 剥掉 mode，保留 agentId/modelId", async () => {
    const conn = await openMemoryConn();
    try {
      await setWorkspaceKey(conn, KEY_CURRENT_AGENT_ID, WS_AGENT_ID);
      await setWorkspaceKey(conn, KEY_CURRENT_MODEL_ID, WS_MODEL_ID);

      // 有 modelId 子场景。
      const withModel = randomUUID();
      await seedSession(
        conn,
        withModel,
        JSON.stringify({ mode: "bind", agentId: "bound-1", modelId: "model-1" }),
      );
      // 无 modelId 子场景。
      const withoutModel = randomUUID();
      await seedSession(
        conn,
        withoutModel,
        JSON.stringify({ mode: "bind", agentId: "bound-2" }),
      );

      await sessionAgentConfigV2Up(conn);

      const a = JSON.parse((await readSessionConfig(conn, withModel))!) as Record<
        string,
        unknown
      >;
      assert.equal(a.agentId, "bound-1");
      assert.equal(a.modelId, "model-1");
      assert.equal("mode" in a, false);

      const b = JSON.parse(
        (await readSessionConfig(conn, withoutModel))!,
      ) as Record<string, unknown>;
      assert.equal(b.agentId, "bound-2");
      assert.equal("modelId" in b, false);
      assert.equal("mode" in b, false);
    } finally {
      await conn.close();
    }
  });

  it("场景5：{mode:'follow'} → 与 NULL 同策略回填（C-2 显式分支）", async () => {
    const conn = await openMemoryConn();
    try {
      await setWorkspaceKey(conn, KEY_CURRENT_AGENT_ID, WS_AGENT_ID);
      await setWorkspaceKey(conn, KEY_CURRENT_MODEL_ID, WS_MODEL_ID);

      // workspace 有指针：回填。
      const withWs = randomUUID();
      await seedSession(conn, withWs, JSON.stringify({ mode: "follow" }));

      // workspace 无指针（独立库验证）：保留原 JSON 不动。
      // 这里再开一个空指针场景需另起一条 session，但同一连接 workspace 已写满，
      // 所以另起一个 conn 验证「workspace 均空」分支。
      await sessionAgentConfigV2Up(conn);

      const parsed = JSON.parse((await readSessionConfig(conn, withWs))!) as Record<
        string,
        unknown
      >;
      assert.equal(parsed.agentId, WS_AGENT_ID);
      assert.equal(parsed.modelId, WS_MODEL_ID);
      assert.equal("mode" in parsed, false);
    } finally {
      await conn.close();
    }

    // 配合：workspace 与 registry 均空时，mode=follow 应保留原值不动（与 NULL 同策略）。
    const conn2 = await openMemoryConn();
    try {
      const sessionId = randomUUID();
      await seedSession(conn2, sessionId, JSON.stringify({ mode: "follow" }));

      await sessionAgentConfigV2Up(conn2);

      const raw = await readSessionConfig(conn2, sessionId);
      // workspace 无指针：原 mode=follow JSON 保持不变（未回填）。
      assert.equal(raw, JSON.stringify({ mode: "follow" }));
    } finally {
      await conn2.close();
    }
  });

  it("场景6：已是 v2 形态 → 跳过（幂等）", async () => {
    const conn = await openMemoryConn();
    try {
      await setWorkspaceKey(conn, KEY_CURRENT_AGENT_ID, WS_AGENT_ID);
      await setWorkspaceKey(conn, KEY_CURRENT_MODEL_ID, WS_MODEL_ID);

      const v2WithModel = JSON.stringify({ agentId: "kept-1", modelId: "kept-m" });
      const v2NoModel = JSON.stringify({ agentId: "kept-2" });
      const id1 = randomUUID();
      const id2 = randomUUID();
      await seedSession(conn, id1, v2WithModel);
      await seedSession(conn, id2, v2NoModel);

      await sessionAgentConfigV2Up(conn);

      // 数据应原样不变。
      assert.equal(await readSessionConfig(conn, id1), v2WithModel);
      assert.equal(await readSessionConfig(conn, id2), v2NoModel);
    } finally {
      await conn.close();
    }
  });

  it("场景7：二次执行 → 数据不变", async () => {
    const conn = await openMemoryConn();
    try {
      await setWorkspaceKey(conn, KEY_CURRENT_AGENT_ID, WS_AGENT_ID);
      await setWorkspaceKey(conn, KEY_CURRENT_MODEL_ID, WS_MODEL_ID);

      const nullId = randomUUID();
      const bindId = randomUUID();
      const followId = randomUUID();
      await seedSession(conn, nullId, null);
      await seedSession(
        conn,
        bindId,
        JSON.stringify({ mode: "bind", agentId: "bound-1", modelId: "model-1" }),
      );
      await seedSession(conn, followId, JSON.stringify({ mode: "follow" }));

      await sessionAgentConfigV2Up(conn);
      const afterFirst = {
        nullId: await readSessionConfig(conn, nullId),
        bindId: await readSessionConfig(conn, bindId),
        followId: await readSessionConfig(conn, followId),
      };

      // 二次执行。
      await sessionAgentConfigV2Up(conn);
      const afterSecond = {
        nullId: await readSessionConfig(conn, nullId),
        bindId: await readSessionConfig(conn, bindId),
        followId: await readSessionConfig(conn, followId),
      };

      assert.deepEqual(afterFirst, afterSecond);
    } finally {
      await conn.close();
    }
  });
});
