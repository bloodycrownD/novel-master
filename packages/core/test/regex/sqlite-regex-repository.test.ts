import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteRegexGroupRepository } from "@/domain/regex/repositories/impl/sqlite-regex-group.repository.js";
import { SqliteRegexRuleRepository } from "@/domain/regex/repositories/impl/sqlite-regex-rule.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("SqliteRegex repositories", () => {
  it("R-SQL2: listByGroupOrdered follows sort_order", async () => {
    const ctx = await openNovelMasterTestConnection();
    const groups = new SqliteRegexGroupRepository(ctx.conn);
    const rules = new SqliteRegexRuleRepository(ctx.conn);
    const now = Date.now();
    await groups.insert({
      groupId: "g1",
      displayName: null,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await rules.insert({
      groupId: "g1",
      ruleId: "r2",
      sortOrder: 2,
      name: "second",
      pattern: "b",
      flags: "",
      enabled: true,
      llmReplace: "B",
      displayReplace: null,
      startDepth: 0,
      endDepth: 9,
      scopeUser: true,
      scopeAssistant: false,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await rules.insert({
      groupId: "g1",
      ruleId: "r1",
      sortOrder: 1,
      name: "first",
      pattern: "a",
      flags: "",
      enabled: true,
      llmReplace: "A",
      displayReplace: null,
      startDepth: 0,
      endDepth: 9,
      scopeUser: true,
      scopeAssistant: false,
      createdAtMs: now,
      updatedAtMs: now,
    });
    const ordered = await rules.listByGroupOrdered("g1");
    assert.deepEqual(
      ordered.map((r) => r.ruleId),
      ["r1", "r2"],
    );
    await ctx.conn.close();
  });

  it("R-SQL1: deleting group cascades rules", async () => {
    const ctx = await openNovelMasterTestConnection();
    const groups = new SqliteRegexGroupRepository(ctx.conn);
    const rules = new SqliteRegexRuleRepository(ctx.conn);
    const now = Date.now();
    await groups.insert({
      groupId: "g-del",
      displayName: null,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await rules.insert({
      groupId: "g-del",
      ruleId: "r1",
      sortOrder: 1,
      name: "n",
      pattern: "x",
      flags: "",
      enabled: true,
      llmReplace: "y",
      displayReplace: null,
      startDepth: 0,
      endDepth: 1,
      scopeUser: true,
      scopeAssistant: false,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await groups.delete("g-del");
    const left = await rules.listByGroupOrdered("g-del");
    assert.equal(left.length, 0);
    await ctx.conn.close();
  });

  it("nextSortOrder appends after max", async () => {
    const ctx = await openNovelMasterTestConnection();
    const groups = new SqliteRegexGroupRepository(ctx.conn);
    const rules = new SqliteRegexRuleRepository(ctx.conn);
    const now = Date.now();
    await groups.insert({
      groupId: "g-sort",
      displayName: null,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await rules.insert({
      groupId: "g-sort",
      ruleId: "a",
      sortOrder: 5,
      name: "a",
      pattern: "a",
      flags: "",
      enabled: true,
      llmReplace: "x",
      displayReplace: null,
      startDepth: 0,
      endDepth: 1,
      scopeUser: true,
      scopeAssistant: false,
      createdAtMs: now,
      updatedAtMs: now,
    });
    assert.equal(await rules.nextSortOrder("g-sort"), 6);
    await ctx.conn.close();
  });
});
