/**
 * CR-F04（core2 A-1）：handleProvidersDelete 的 currentModelId 软指针兜底。
 *
 * 牙齿：providers.delete 会级联抹掉该服务商名下的 saved model 行——若把
 *「取 currentModelId + 判归属」放在 delete **之后**，getSavedById 恒为 null，
 * resetCurrentModelId 永不执行，currentModelId 悬空固化进新会话的
 * agent_config_json。本用例把 currentModelId 指向本 provider 名下的模型，
 * 删完必须读回 undefined（悬空 = 后续发消息抛 INVALID_SAVED_MODEL_ID 且 UI 零解释）。
 *
 * 依赖 core `DefaultProviderService.delete` 把 currentModelId 当软指针（不参与
 * SAVED_MODEL_IN_USE 前置拒绝）这半契约；cli / mobile 两端须保持同一顺序。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleProvidersDelete } from "../src/main/ipc/handlers/providers.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("providers.delete 级联清理 currentModelId（CR-F04）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-cr-f04-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("currentModelId 指向被删服务商的模型时，删除后必须清空", async () => {
    const rt = await getDesktopRuntime();

    const created = await rt.providers.create({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "CR-F04 悬空网关",
      apiKey: "sk-cr-f04",
    });
    const saved = await rt.providerModels.create(created.id, "cr-f04-model");

    await rt.state.setCurrentProviderId(created.id);
    await rt.state.setCurrentModelId(saved.id);
    assert.equal(await rt.state.getCurrentModelId(), saved.id);

    const res = await handleProvidersDelete({ providerId: created.id });
    assert.equal(res.ok, true, res.ok ? "" : res.error.message);

    assert.equal(
      await rt.state.getCurrentModelId(),
      undefined,
      "currentModelId 指向已删模型 = 悬空指针，必须在删除成功后被清掉",
    );
    assert.equal(
      await rt.state.getCurrentProviderId(),
      undefined,
      "currentProviderId 同理必须被清掉",
    );

    // 半套防护：模型行本身确实已被级联抹掉（证明用例不是空跑）。
    // ⚠️ 不能用 savedList 验：provider 已被删，savedList 开头 providers.get 会抛 NOT_FOUND。
    assert.equal(
      await rt.providerModels.getSavedById(saved.id),
      null,
      "被删服务商的模型行应已级联抹掉",
    );
  });
});