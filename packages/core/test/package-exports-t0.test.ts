import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as coreMain from "@novel-master/core";
import { createKkvService, KkvError } from "@novel-master/core/kkv";
import { createAgentRegistryService } from "@novel-master/core/agent";
import { createMessageService } from "@novel-master/core/chat";
import { createCompactionConditionsStore } from "@novel-master/core/compaction";
import { createEventsConfigStore } from "@novel-master/core/events";
import { buildPromptAssemblyFromLayout } from "@novel-master/core/prompt";
import { createProviderServices } from "@novel-master/core/provider";
import { createRegexConfigService } from "@novel-master/core/regex";
import { createSessionFsService } from "@novel-master/core/session-fs";
import { createScopedVfsService } from "@novel-master/core/vfs";
import { createWorktreeService } from "@novel-master/core/worktree";
import { getNovelMasterTestContext, novelMasterTestFixture } from "./helpers/novel-master-fixture.js";


novelMasterTestFixture();

// 完整 allowlist / 架构守卫见 test/package-exports/

describe("T0 package exports (@novel-master/core entry)", () => {
  it("does not export createKkvService from main entry", () => {
    assert.equal(
      (coreMain as Record<string, unknown>).createKkvService,
      undefined,
    );
  });

  it("does not export SimpleEventBus from main entry", () => {
    assert.equal((coreMain as Record<string, unknown>).SimpleEventBus, undefined);
  });

  it("does not export readTokenCounterModeFromPreferences from main entry", () => {
    assert.equal(
      (coreMain as Record<string, unknown>).readTokenCounterModeFromPreferences,
      undefined,
    );
  });

  it("does not leak public sub-entry symbols from main entry", () => {
    const mainEntry = coreMain as Record<string, unknown>;
    assert.equal(mainEntry.createAgentRegistryService, undefined);
    assert.equal(mainEntry.createMessageService, undefined);
    assert.equal(mainEntry.createCompactionConditionsStore, undefined);
    assert.equal(mainEntry.createEventsConfigStore, undefined);
    assert.equal(mainEntry.buildPromptAssemblyFromLayout, undefined);
    assert.equal(mainEntry.createProviderServices, undefined);
    assert.equal(mainEntry.createRegexConfigService, undefined);
    assert.equal(mainEntry.createSessionFsService, undefined);
    assert.equal(mainEntry.createScopedVfsService, undefined);
    assert.equal(mainEntry.createWorktreeService, undefined);
  });

  it("exports createKkvService and KkvError from @novel-master/core/kkv", async () => {
    assert.equal(typeof createKkvService, "function");
    assert.equal(KkvError.name, "KkvError");

    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("t0-smoke", "key", "value");
    assert.equal(await kkv.get("t0-smoke", "key"), "value");
  });

  it("exports new public sub-entries", () => {
    assert.equal(typeof createAgentRegistryService, "function");
    assert.equal(typeof createMessageService, "function");
    assert.equal(typeof createCompactionConditionsStore, "function");
    assert.equal(typeof createEventsConfigStore, "function");
    assert.equal(typeof buildPromptAssemblyFromLayout, "function");
    assert.equal(typeof createProviderServices, "function");
    assert.equal(typeof createRegexConfigService, "function");
    assert.equal(typeof createSessionFsService, "function");
    assert.equal(typeof createScopedVfsService, "function");
    assert.equal(typeof createWorktreeService, "function");
  });
});
