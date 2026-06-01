import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RegexError } from "@/errors/regex-errors.js";
import { createRegexConfigService } from "@/service/regex/create-regex-config-service.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("RegexConfigService", () => {
  it("creates group and rule with validation", async () => {
    const ctx = await openNovelMasterTestConnection();
    const svc = createRegexConfigService(ctx.conn);
    await svc.createGroup({ groupId: "g1" });
    const rule = await svc.createRule({
      groupId: "g1",
      ruleId: "r1",
      name: "mask",
      pattern: "secret",
      llmReplace: "[x]",
      startDepth: 0,
      endDepth: 10,
      scopeUser: true,
    });
    assert.equal(rule.sortOrder, 1);
    await ctx.conn.close();
  });

  it("rejects rule without replace or scope", async () => {
    const ctx = await openNovelMasterTestConnection();
    const svc = createRegexConfigService(ctx.conn);
    await svc.createGroup({ groupId: "g2" });
    await assert.rejects(
      () =>
        svc.createRule({
          groupId: "g2",
          ruleId: "bad",
          name: "bad",
          pattern: "x",
          startDepth: 0,
          endDepth: 2,
        }),
      (e: unknown) => e instanceof RegexError && e.code === "INVALID_ARGUMENT",
    );
    await ctx.conn.close();
  });

  it("R8: deleteGroup resets current pointer when state injected", async () => {
    const ctx = await openNovelMasterTestConnection();
    const svc = createRegexConfigService(ctx.conn, ctx.state);
    await svc.createGroup({ groupId: "current-g" });
    await ctx.state.setCurrentRegexGroupId("current-g");
    await svc.deleteGroup("current-g");
    assert.equal(await ctx.state.getCurrentRegexGroupId(), undefined);
    await ctx.conn.close();
  });

  it("listCompiledRulesForGroup skips disabled", async () => {
    const ctx = await openNovelMasterTestConnection();
    const svc = createRegexConfigService(ctx.conn);
    await svc.createGroup({ groupId: "g3" });
    await svc.createRule({
      groupId: "g3",
      ruleId: "on",
      name: "on",
      pattern: "a",
      llmReplace: "A",
      startDepth: 0,
      endDepth: 9,
      scopeUser: true,
    });
    await svc.createRule({
      groupId: "g3",
      ruleId: "off",
      name: "off",
      pattern: "b",
      llmReplace: "B",
      enabled: false,
      startDepth: 0,
      endDepth: 9,
      scopeUser: true,
    });
    const compiled = await svc.listCompiledRulesForGroup("g3");
    assert.equal(compiled.length, 1);
    await ctx.conn.close();
  });
});
