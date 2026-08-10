import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as coreMain from "@novel-master/core";
import { createKkvService, KkvError } from "@novel-master/core/kkv";
import {
  createAgentRegistryService,
  resolveAgentForProject,
} from "@novel-master/core/agent";
import type { ResolvedAgentForProject } from "@novel-master/core/agent";
import {
  createMessageService,
  sessionAgentConfigSchema,
} from "@novel-master/core/chat";
import type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "@novel-master/core/chat";
import { createCompactionConditionsStore } from "@novel-master/core/compaction";
import { buildPromptAssemblyFromLayout } from "@novel-master/core/prompt";
import { createProviderServices } from "@novel-master/core/provider";
import { createRegexConfigService } from "@novel-master/core/regex";
import { createSessionFsService } from "@novel-master/core/session-fs";
import { createScopedVfsService } from "@novel-master/core/vfs";
import { createWorkplaceService } from "@novel-master/core/workplace";
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
    assert.equal(mainEntry.buildPromptAssemblyFromLayout, undefined);
    assert.equal(mainEntry.createProviderServices, undefined);
    assert.equal(mainEntry.createRegexConfigService, undefined);
    assert.equal(mainEntry.createSessionFsService, undefined);
    assert.equal(mainEntry.createScopedVfsService, undefined);
    assert.equal(mainEntry.createWorkplaceService, undefined);
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
    assert.equal(typeof buildPromptAssemblyFromLayout, "function");
    assert.equal(typeof createProviderServices, "function");
    assert.equal(typeof createRegexConfigService, "function");
    assert.equal(typeof createSessionFsService, "function");
    assert.equal(typeof createScopedVfsService, "function");
    assert.equal(typeof createWorkplaceService, "function");
  });

  it("从 @novel-master/core/chat 导出 session agent config 符号", () => {
    assert.equal(typeof sessionAgentConfigSchema, "object");
    assert.equal(typeof sessionAgentConfigSchema.toWire, "function");
    assert.equal(typeof sessionAgentConfigSchema.parse, "function");
    // 类型仅作 import 契约存在，运行期断言仅占位
    const _typeCheck: SessionAgentConfigPatch = { agentId: "a" };
    const _cfg: SessionAgentConfig = { agentId: "a" };
    void _typeCheck;
    void _cfg;
  });

  it("从 @novel-master/core/agent 导出 resolveAgentForProject（sessionId 必填签名）", () => {
    // Step 10 契约：sessionId 升级为必填后，函数仍从公开子入口导出。
    assert.equal(typeof resolveAgentForProject, "function");
    assert.equal(resolveAgentForProject.length, 3);
    // 类型仅作 import 契约存在，锁定 ResolvedAgentForProject 两个 source 分支可达。
    const _typeCheck: ResolvedAgentForProject = {
      source: "session",
      agentId: "x",
      definition: { name: "n", prompts: { persist: [], dynamic: [] } },
    };
    void _typeCheck;
  });
});
