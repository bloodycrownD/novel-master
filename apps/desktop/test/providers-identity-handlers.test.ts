/**
 * T-PI8：Desktop create 无 id、返回 UUID；list/DTO 主文案走 displayName，无 UUID 回退。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type {
  ProviderCreateRequest,
  ProviderListItemDto,
  ProviderModelSavedDto,
} from "../shared/ipc-types.js";
import {
  handleProvidersCreate,
  handleProvidersList,
} from "../src/main/ipc/handlers/providers.js";
import {
  handleProviderModelsSave,
  handleProviderModelsSavedList,
} from "../src/main/ipc/handlers/provider-models.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("provider-identity Desktop IPC (T-PI8)", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-pi8-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("ProviderCreateRequest 类型不含 id，且 displayName 必填", () => {
    // 编译期：无 id 字段即可赋值；若再引入 id 必填则会红。
    const req: ProviderCreateRequest = {
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "测试网关",
      apiKey: "sk-test",
    };
    assert.equal(
      Object.prototype.hasOwnProperty.call(req, "id"),
      false,
      "创建请求不得携带用户自选 id",
    );
    assert.equal(typeof req.displayName, "string");
  });

  it("create 返回生成 UUID；list 标题为 displayName；模型 DTO 前缀为服务商名称", async () => {
    const created = await handleProvidersCreate({
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      displayName: "我的网关",
      apiKey: "sk-test",
    });
    assert.equal(created.ok, true, created.ok ? "" : created.error.message);
    if (!created.ok) {
      return;
    }
    assert.match(created.data.providerId, UUID_RE);

    const listed = await handleProvidersList();
    assert.equal(listed.ok, true);
    if (!listed.ok) {
      return;
    }
    const row = listed.data.find(
      (p: ProviderListItemDto) => p.id === created.data.providerId,
    );
    assert.ok(row);
    assert.equal(row!.displayName, "我的网关");
    assert.notEqual(row!.displayName, row!.id);

    const saved = await handleProviderModelsSave({
      providerId: created.data.providerId,
      vendorModelId: "gw-model",
      modelName: "网关模型",
    });
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error.message);

    const models = await handleProviderModelsSavedList({
      providerId: created.data.providerId,
    });
    assert.equal(models.ok, true);
    if (!models.ok) {
      return;
    }
    const model = models.data.find(
      (m: ProviderModelSavedDto) => m.vendorModelId === "gw-model",
    );
    assert.ok(model);
    assert.equal(model!.displayName, "我的网关/网关模型");
    assert.ok(
      !model!.displayName.includes(created.data.providerId),
      "派生主文案不得把 provider UUID 顶进人对前缀",
    );
  });
});
