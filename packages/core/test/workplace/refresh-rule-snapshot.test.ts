/**
 * T-CR2（规则快照半边）：refreshRuleSnapshot 写 canon 并清空 file_cache。
 */
import {  unwrap  } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SessionKkvServiceFactory  } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {  WorkplaceServiceFactory  } from "../../src/service/workplace/create-workplace-service.js";
import {  RuleSnapshot  } from "../../src/service/workplace/refresh-rule-snapshot.js";
import {  RULE_SNAPSHOT_CANON_KEY, SESSION_KKV_DOMAIN_FILE_CACHE, SESSION_KKV_DOMAIN_RULE_SNAPSHOT  } from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {  RuleSnapshotCodec  } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("RuleSnapshot.refresh(T-CR2)", () => {
  it("T-CR2/T-CR8: evaluate→写 canon；file_cache 域空（新规则保存不靠 chip）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const sk = SessionKkvServiceFactory.create(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/note.md", "hello");
    const wt = WorkplaceServiceFactory.create(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/note.md", inclusionMode: "show" });

    // 预填 file_cache，确认 refresh 会清空
    await sk.set(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, RuleSnapshotCodec.fileCacheKey("full", "/note.md"), JSON.stringify({ body: "stale", mtimeMs: 1 }));

    await RuleSnapshot.refresh(session.id, {
      sessionKkv: sk,
      workplace: wt,
    });

    const raw = unwrap(await sk.get(session.id, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY));
    assert.ok(raw != null && raw !== "");
    const entries = RuleSnapshotCodec.parseJson(raw!);
    assert.ok(entries.ok);
    assert.ok(entries.value.some((e) => e.path === "/note.md"));

    const cacheKeys = await sk.listKeys(session.id, SESSION_KKV_DOMAIN_FILE_CACHE);
    assert.deepEqual(cacheKeys, []);
  });
});
