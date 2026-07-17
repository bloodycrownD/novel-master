import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorktreeService } from "../../src/service/worktree/create-worktree-service.js";
import { assembleWorkplaceDisplay } from "../../src/service/workplace/assemble-workplace-display.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  RULE_SNAPSHOT_CANON_KEY,
  fileCacheKey,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { parseFileCachePayload } from "../../src/domain/worktree/logic/rule-snapshot-codec.js";
import { createVfsTools } from "../../src/domain/tool/builtin/vfs-tools.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function layoutWithWorktree(): Pick<AgentPromptLayout, "persist"> {
  return {
    persist: [{ type: "worktree", name: "canon", role: "user" }],
  };
}

function layoutWithoutWorktree(): Pick<AgentPromptLayout, "persist"> {
  return { persist: [{ type: "text", name: "t", role: "user", text: "hi" }] };
}

describe("assembleWorkplaceDisplay", () => {
  it("T-WP1: 无 worktree 块返回空且不写 kkv", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.md", "hello");
    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    const out = await assembleWorkplaceDisplay(
      { kind: "session", projectId: project.id, sessionId: session.id },
      {
        sessionKkv: sk,
        worktree: wt,
        vfs,
        layout: layoutWithoutWorktree(),
      },
    );
    assert.equal(out, "");
    assert.equal(
      await sk.get(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY),
      null,
    );
  });

  it("T-WP2: 空 kkv + 有 worktree 块 → 写快照与 file_cache，display 含 file", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/note.md", "hello-world");
    await createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    }).setFileRule({ logicalPath: "/note.md", inclusionMode: "show" });

    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const out = await assembleWorkplaceDisplay(
      { kind: "session", projectId: project.id, sessionId: session.id },
      {
        sessionKkv: sk,
        worktree: wt,
        vfs,
        layout: layoutWithWorktree(),
      },
    );
    assert.match(out, /<file /);
    assert.match(out, /hello-world/);
    assert.ok(
      (await sk.get(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY)) !=
        null,
    );
    assert.ok(
      (await sk.get(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full", "/note.md"))) !=
        null,
    );
  });

  // T-SR4：kkv canon=[] 后 assemble 仍能对有规则文件产出非空 display（空 [] 不粘住）
  it("T-SR4: 空 rule_snapshot 数组不粘住：重新 evaluate 后能出工作区", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/note.md", "revived");
    await createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    }).setFileRule({ logicalPath: "/note.md", inclusionMode: "show" });

    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
      "[]",
    );

    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const out = await assembleWorkplaceDisplay(
      { kind: "session", projectId: project.id, sessionId: session.id },
      {
        sessionKkv: sk,
        worktree: wt,
        vfs,
        layout: layoutWithWorktree(),
      },
    );
    assert.match(out, /revived/);
  });

  it("T-WP3: 二次 assemble 不重复 vfs.read", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const baseVfs = ctx.sessionVfs(project.id, session.id);
    await baseVfs.write("/once.md", "body");
    await createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    }).setFileRule({ logicalPath: "/once.md", inclusionMode: "show" });

    const read = mock.fn(async (path: string) => baseVfs.read(path));
    const vfs = new Proxy(baseVfs, {
      get(target, prop, receiver) {
        if (prop === "read") {
          return read;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const deps = {
      sessionKkv: sk,
      worktree: wt,
      vfs: vfs as typeof baseVfs,
      layout: layoutWithWorktree(),
    };
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await assembleWorkplaceDisplay(scope, deps);
    const firstReads = read.mock.callCount();
    assert.ok(firstReads >= 1);
    await assembleWorkplaceDisplay(scope, deps);
    assert.equal(read.mock.callCount(), firstReads);
  });

  it("T-FC1: write 工具成功 upsert full:{path}", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const writeTool = createVfsTools().find((t) => t.name === "write");
    assert.ok(writeTool != null);
    await writeTool!.run(
      { path: "/w.md", content: "full-content" },
      {
        vfs,
        projectId: project.id,
        sessionId: session.id,
        listSessionMessages: async () => [],
        sessionKkv: sk,
      },
    );
    const raw = await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/w.md"),
    );
    assert.ok(raw != null);
    const payload = parseFileCachePayload(raw!);
    assert.ok(payload != null);
    assert.equal(payload!.body, "full-content");
  });

  it("T-FC2: edit 成功不改 file_cache", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/e.md", "alpha");
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/e.md"),
      JSON.stringify({ body: "cached-before-edit", mtimeMs: 1 }),
    );
    const editTool = createVfsTools().find((t) => t.name === "edit");
    assert.ok(editTool != null);
    await editTool!.run(
      { path: "/e.md", oldString: "alpha", newString: "beta" },
      {
        vfs,
        projectId: project.id,
        sessionId: session.id,
        listSessionMessages: async () => [],
        sessionKkv: sk,
      },
    );
    const raw = await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/e.md"),
    );
    assert.equal(raw, JSON.stringify({ body: "cached-before-edit", mtimeMs: 1 }));
    assert.equal((await vfs.read("/e.md")).content, "beta");
  });

  it("T-WP4: clearSession 后再度 assemble 重新跑规则引擎并写快照", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/again.md", "v1");
    await createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    }).setFileRule({ logicalPath: "/again.md", inclusionMode: "show" });

    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const deps = {
      sessionKkv: sk,
      worktree: wt,
      vfs,
      layout: layoutWithWorktree(),
    };
    await assembleWorkplaceDisplay(scope, deps);
    assert.ok(
      (await sk.get(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY)) !=
        null,
    );

    await sk.clearSession(session.id);
    assert.equal(
      await sk.get(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY),
      null,
    );

    await vfs.replace("/again.md", "v1", "v2-after-clear");
    const out = await assembleWorkplaceDisplay(scope, deps);
    assert.match(out, /v2-after-clear/);
    assert.ok(
      (await sk.get(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY)) !=
        null,
    );
  });

  it("T-FC3: delete/rename/move 不碰 file_cache 原 key", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const cachedBody = JSON.stringify({ body: "keep-me", mtimeMs: 42 });
    const delKey = fileCacheKey("full", "/del.md");
    const mvKey = fileCacheKey("full", "/old.md");
    await vfs.write("/del.md", "will-delete");
    await vfs.write("/old.md", "will-move");
    await sk.set(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, delKey, cachedBody);
    await sk.set(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, mvKey, cachedBody);

    const fsTool = createVfsTools().find((t) => t.name === "fs");
    assert.ok(fsTool != null);
    const toolCtx = {
      vfs,
      projectId: project.id,
      sessionId: session.id,
      listSessionMessages: async () => [],
      sessionKkv: sk,
    };
    await fsTool!.run({ command: "rm /del.md" }, toolCtx);
    await fsTool!.run({ command: "mv /old.md /new.md" }, toolCtx);

    assert.equal(
      await sk.get(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, delKey),
      cachedBody,
    );
    assert.equal(
      await sk.get(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, mvKey),
      cachedBody,
    );
    // 新 path 不自动拷贝 cache
    assert.equal(
      await sk.get(
        session.id,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        fileCacheKey("full", "/new.md"),
      ),
      null,
    );
  });
});
