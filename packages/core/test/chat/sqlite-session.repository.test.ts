import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  parseComposerDraftJson,
  serializeComposerDraftJson,
} from "../../src/domain/chat/model/composer-draft.schema.js";
import { projectComposerStatusAttachments } from "../../src/domain/chat/logic/project-composer-status-attachments.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  USER_VFS_PENDING_QUEUE_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { execLegacyV107ChatDdl } from "../bootstrap/helpers/legacy-db-fixtures.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("SqliteSessionRepository", () => {
  it("insert → findById / listByProject 读回会话行", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "session-crud");

    const loaded = await repo.findById(session.id);
    assert.ok(loaded);
    assert.equal(loaded.id, session.id);
    assert.equal(loaded.title, "session-crud");
    assert.equal(loaded.projectId, project.id);

    const listed = await repo.listByProject(project.id);
    assert.equal(listed.some((s) => s.id === session.id), true);
  });

  it("updateTitle 更新标题", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "before");
    const now = Date.now();

    assert.equal(await repo.updateTitle(session.id, "after", now), true);
    const loaded = await repo.findById(session.id);
    assert.ok(loaded);
    assert.equal(loaded.title, "after");
    assert.equal(loaded.updatedAtMs, now);
  });

  it("T-LF1：写 composer_draft_json → 读回 text+attach", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "draft-lf1");

    assert.equal(await repo.getComposerDraftJson(session.id), null);

    const draft = {
      text: "杀进程应仍在",
      attachments: [
        {
          name: "/chapter.md",
          source: "attach" as const,
          type: "text" as const,
          content: null,
          path: "/chapter.md",
        },
      ],
    };
    const draftJson = serializeComposerDraftJson(draft);
    assert.ok(draftJson != null);
    assert.equal(await repo.setComposerDraftJson(session.id, draftJson), true);

    const raw = await repo.getComposerDraftJson(session.id);
    assert.equal(raw, draftJson);
    assert.deepEqual(parseComposerDraftJson(raw), draft);

    // 模拟「重启」：新 repo 实例读同一连接
    const repoAfterRestart = new SqliteSessionRepository(ctx.conn);
    const again = await repoAfterRestart.getComposerDraftJson(session.id);
    assert.deepEqual(parseComposerDraftJson(again), draft);
  });

  it("T-LF1：clearSession 后 composer_draft 仍保留；状态投影空", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "draft-lf1-clear");

    const draft = {
      text: "置位后正文仍在",
      attachments: [
        {
          name: "/keep.md",
          source: "attach" as const,
          type: "text" as const,
          content: null,
          path: "/keep.md",
        },
      ],
    };
    assert.equal(
      await repo.setComposerDraftJson(
        session.id,
        serializeComposerDraftJson(draft),
      ),
      true,
    );

    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/stale.md",
      JSON.stringify({ body: "x", mtimeMs: 1 }),
    );
    await ctx.sessionKkv.set(
      session.id,
      SESSION_KKV_DOMAIN_USER_VFS_PENDING,
      USER_VFS_PENDING_QUEUE_KEY,
      "[]",
    );

    await ctx.sessionKkv.clearSession(session.id);

    assert.deepEqual(
      parseComposerDraftJson(await repo.getComposerDraftJson(session.id)),
      draft,
    );
    assert.equal(
      await ctx.sessionKkv.get(
        session.id,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        "full:/stale.md",
      ),
      null,
    );
    assert.equal(
      await ctx.sessionKkv.get(
        session.id,
        SESSION_KKV_DOMAIN_USER_VFS_PENDING,
        USER_VFS_PENDING_QUEUE_KEY,
      ),
      null,
    );

    const status = await projectComposerStatusAttachments(session.id, {
      sessionKkv: ctx.sessionKkv,
      loadLiveWorkplacePaths: async () => [],
      previewUserOpsChangedPaths: async () => [],
    });
    assert.deepEqual(status, []);
  });
});

describe("SqliteSessionRepository legacy 库 bootstrap", () => {
  it("v1.0.7 风格缺列库 bootstrap 后无 user_vfs_pending_json 且可读会话", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    const sessionId = randomUUID();
    const projectId = randomUUID();
    const now = Date.now();

    await execLegacyV107ChatDdl(conn);
    await conn.execute(
      `INSERT INTO chat_session (id, project_id, title, created_at_ms, updated_at_ms)
       VALUES ('${sessionId}', '${projectId}', 'legacy-bootstrap', ${now}, ${now})`,
    );
    await bootstrapNovelMaster(conn);

    const columns = await conn.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('chat_session')`,
    );
    assert.equal(
      columns.some((c) => c.name === "user_vfs_pending_json"),
      false,
    );

    const repo = new SqliteSessionRepository(conn);
    const sessions = await repo.listByProject(projectId);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.id, sessionId);
    assert.equal(sessions[0]!.title, "legacy-bootstrap");

    await conn.close();
  });
});
