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
import { Providers } from "../src/main/ipc/handlers/providers.js";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
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
        const rtR = await DesktopRuntimeSingleton.get();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;

        const created = await rt.providers.create({
            protocol: "openai",
            baseUrl: "https://example.com/v1",
            displayName: "CR-F04 悬空网关",
            apiKey: "sk-cr-f04",
        });
        if (!created.ok) throw created.error;
        // 四期签名：providerModels.create 沿 Result 回传，解包取实体。
        const savedCreated = await rt.providerModels.create(created.value.id, "cr-f04-model");
        if (!savedCreated.ok) throw savedCreated.error;
        const saved = savedCreated.value;

        await rt.state.setCurrentProviderId(created.value.id);
        await rt.state.setCurrentModelId(saved.id);
        const currentModel = await rt.state.getCurrentModelId();
        if (!currentModel.ok) throw currentModel.error;
        assert.equal(currentModel.value, saved.id);

        const res = await Providers.delete({ providerId: created.value.id });
        assert.equal(res.ok, true, res.ok ? "" : res.error.message);

        const currentModelAfter = await rt.state.getCurrentModelId();
        if (!currentModelAfter.ok) throw currentModelAfter.error;
        assert.equal(
            currentModelAfter.value,
            undefined,
            "currentModelId 指向已删模型 = 悬空指针，必须在删除成功后被清掉",
        );
        const currentProviderAfter = await rt.state.getCurrentProviderId();
        if (!currentProviderAfter.ok) throw currentProviderAfter.error;
        assert.equal(
            currentProviderAfter.value,
            undefined,
            "currentProviderId 同理必须被清掉",
        );

        // 半套防护：模型行本身确实已被级联抹掉（证明用例不是空跑）。
        // ⚠️ 不能用 savedList 验：provider 已被删，savedList 开头 providers.get 会抛 NOT_FOUND。
        // 四期签名：getSavedById 沿 Result 回传（Ok(null) = 行不存在）。
        const ghost = await rt.providerModels.getSavedById(saved.id);
        if (!ghost.ok) throw ghost.error;
        assert.equal(
            ghost.value,
            null,
            "被删服务商的模型行应已级联抹掉",
        );
    });
});