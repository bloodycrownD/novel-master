import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  RULE_SNAPSHOT_CANON_KEY,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("SessionKkvService", () => {
  it("get/set/listKeys/delete 按 session+domain 隔离", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const s1 = `s1-${testIsolationSuffix()}`;
    const s2 = `s2-${testIsolationSuffix()}`;

    await sk.set(s1, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, "[]");
    await sk.set(s1, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", '{"body":"x","mtimeMs":1}');
    await sk.set(s2, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md", '{"body":"y","mtimeMs":2}');

    assert.equal(
      await sk.get(s1, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY),
      "[]",
    );
    assert.equal(
      await sk.get(s1, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md"),
      '{"body":"x","mtimeMs":1}',
    );
    assert.equal(
      await sk.get(s2, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md"),
      '{"body":"y","mtimeMs":2}',
    );

    const keys = await sk.listKeys(s1, SESSION_KKV_DOMAIN_FILE_CACHE);
    assert.deepEqual(keys, ["full:/a.md"]);

    await sk.delete(s1, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md");
    assert.equal(
      await sk.get(s1, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md"),
      null,
    );
  });

  it("clearDomain 仅删该 domain", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `dom-${testIsolationSuffix()}`;
    await sk.set(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, "[]");
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/z.md", '{"body":"z","mtimeMs":1}');
    await sk.clearDomain(sid, SESSION_KKV_DOMAIN_FILE_CACHE);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/z.md"),
      null,
    );
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY),
      "[]",
    );
  });

  it("clearSession 删除该会话全部 domain", async () => {
    const ctx = getNovelMasterTestContext();
    const sk = createSessionKkvService(ctx.conn);
    const sid = `clr-${testIsolationSuffix()}`;
    await sk.set(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY, "[]");
    await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/z.md", '{"body":"z","mtimeMs":1}');
    await sk.clearSession(sid);
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY),
      null,
    );
    assert.equal(
      await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/z.md"),
      null,
    );
  });

  it("sessions.delete 级联 clearSession", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      "full:/a.md",
      '{"body":"kept-until-delete","mtimeMs":1}',
    );
    await ctx.sessions.delete(session.id);
    assert.equal(
      await sk.get(session.id, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/a.md"),
      null,
    );
  });
});
