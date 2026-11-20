import {  unwrap  } from "./helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import * as coreMain from "@novel-master/core";
import {  createKkvService  } from "@novel-master/core/kkv";
import {  AgentServiceFactory, AgentProjectResolver  } from "@novel-master/core/agent";
import type { ResolvedAgentForProject } from "@novel-master/core/agent";
import {  ChatServiceFactory, sessionAgentConfigSchema  } from "@novel-master/core/chat";
import type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "@novel-master/core/chat";
import {  CompactionFactory  } from "@novel-master/core/compaction";
import {  PromptBuilder  } from "@novel-master/core/prompt";
import {  ProviderServiceFactory  } from "@novel-master/core/provider";
import {  SessionFsServiceFactory  } from "@novel-master/core/session-fs";
import {  VfsServiceFactory  } from "@novel-master/core/vfs";
import {  WorkplaceServiceFactory  } from "@novel-master/core/workplace";
import {  getNovelMasterTestContext, novelMasterTestFixture  } from "./helpers/novel-master-fixture.js";

novelMasterTestFixture();

// 完整 allowlist / 架构守卫见 test/package-exports/

describe("T0 package exports (@novel-master/core entry)", () => {
  it("does not export createKkvService from main entry", () => {
    assert.equal(
      (coreMain as Record<string, unknown>).createKkvService,
      undefined
    );
  });

  it("does not export SimpleEventBus from main entry", () => {
    assert.equal(
      (coreMain as Record<string, unknown>).SimpleEventBus,
      undefined
    );
  });

  it("does not export readTokenCounterModeFromPreferences from main entry", () => {
    assert.equal(
      (coreMain as Record<string, unknown>).readTokenCounterModeFromPreferences,
      undefined
    );
  });

  it("does not leak public sub-entry symbols from main entry", () => {
    const mainEntry = coreMain as Record<string, unknown>;
    assert.equal(mainEntry.AgentServiceFactory, undefined);
    assert.equal(mainEntry.ChatServiceFactory, undefined);
    assert.equal(mainEntry.CompactionFactory, undefined);
    assert.equal(mainEntry.PromptBuilder, undefined);
    assert.equal(mainEntry.ProviderServiceFactory, undefined);
    assert.equal(mainEntry.SessionFsServiceFactory, undefined);
    assert.equal(mainEntry.VfsServiceFactory, undefined);
    assert.equal(mainEntry.WorkplaceServiceFactory, undefined);
  });

  it("exports createKkvService from @novel-master/core/kkv", async () => {
    assert.equal(typeof createKkvService, "function");

    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("t0-smoke", "key", "value");
    assert.equal(unwrap(await kkv.get("t0-smoke", "key")), "value");
  });

  it("exports new public sub-entries", () => {
    // 六组 Factory namespace 化后，create* 函数收敛为工厂对象上的方法。
    assert.equal(typeof AgentServiceFactory, "object");
    assert.equal(typeof AgentServiceFactory.createRegistry, "function");
    assert.equal(typeof ChatServiceFactory, "object");
    assert.equal(typeof ChatServiceFactory.createMessage, "function");
    assert.equal(typeof CompactionFactory, "object");
    assert.equal(typeof CompactionFactory.createConditionsStore, "function");
    assert.equal(typeof PromptBuilder, "object");
    assert.equal(typeof PromptBuilder.assemble, "function");
    assert.equal(typeof ProviderServiceFactory, "object");
    assert.equal(typeof ProviderServiceFactory.create, "function");
    assert.equal(typeof SessionFsServiceFactory.create, "function");
    assert.equal(typeof VfsServiceFactory, "object");
    assert.equal(typeof VfsServiceFactory.createScoped, "function");
    assert.equal(typeof WorkplaceServiceFactory.create, "function");
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
    assert.equal(typeof AgentProjectResolver.resolve, "function");
    assert.equal(AgentProjectResolver.resolve.length, 3);
    // 类型仅作 import 契约存在，锁定 ResolvedAgentForProject 两个 source 分支可达。
    const _typeCheck: ResolvedAgentForProject = {
      source: "session",
      agentId: "x",
      definition: { name: "n", prompts: { persist: [], dynamic: [] } },
    };
    void _typeCheck;
  });
});
