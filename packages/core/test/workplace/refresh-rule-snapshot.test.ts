/**
 * T-CR2（规则快照半边）：refreshRuleSnapshot 写 canon 并清空 file_cache。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import { refreshRuleSnapshot } from "../../src/service/workplace/refresh-rule-snapshot.js";
import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  fileCacheKey,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { parseRuleSnapshotJson } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("refreshRuleSnapshot (T-CR2)", () => {
  it("T-CR2/T-CR8: evaluate→写 canon；file_cache 域空（新规则保存不靠 chip）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/note.md", "hello");
    const wt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/note.md", inclusionMode: "show" });

    // 预填 file_cache，确认 refresh 会清空
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/note.md"),
      JSON.stringify({ body: "stale", mtimeMs: 1 }),
    );

    await refreshRuleSnapshot(session.id, {
      sessionKkv: sk,
      workplace: wt,
    });

    const raw = await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
    );
    assert.ok(raw != null && raw !== "");
    const entries = parseRuleSnapshotJson(raw!);
    assert.ok(entries != null);
    assert.ok(entries!.some((e) => e.path === "/note.md"));

    const cacheKeys = await sk.listKeys(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
    );
    assert.deepEqual(cacheKeys, []);
  });
});
