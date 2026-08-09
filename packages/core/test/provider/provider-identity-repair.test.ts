/**
 * provider 双身份键完整性修复操作测试（S-8 / Step 20）。
 *
 * 验证：
 * - 形态正常的 provider 列表 → detect 返回 needsRepair=false；
 * - 人为破坏形态（内置行清空 builtin_key / 清空 display_name）→ detect=true、repair 抛 ProviderError；
 * - provider secret rename 操作的 detect + repair 幂等搬运。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProviderIdentityRepairOperation,
  createProviderSecretRenameOperation,
} from "@/domain/provider/logic/provider-identity-repair.js";
import { SqliteProviderRepository } from "@/domain/provider/repositories/impl/sqlite-provider.repository.js";
import { ProviderError } from "@/errors/provider-errors.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { LlmProvider } from "@/domain/provider/model/provider.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

/** 内存版 ProviderRepository，方便构造异常形态（绕开真实 repo 的读取校验）。 */
function inMemoryProviderRepo(rows: LlmProvider[]): ProviderRepository {
  return {
    async list() {
      return [...rows];
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async insert() {},
    async update() {},
    async delete() {
      return true;
    },
  };
}

function fakeBuiltin(id: string, builtinKey: string | null): LlmProvider {
  return {
    id,
    builtinKey,
    protocol: "openai",
    baseUrl: "https://example.com",
    displayName: `fake-${id}`,
    secretRef: null,
    headers: {},
    isBuiltin: true,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

novelMasterTestFixture();

/** 拿一个仅内存 map 的假 SecretStore，方便测 rename 搬运。 */
function inMemorySecretStore(): SecretStore & {
  _dump(): Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
    async has(ref) {
      return map.has(ref);
    },
    _dump() {
      return map;
    },
  };
}

describe("provider-identity-repair: createProviderIdentityRepairOperation", () => {
  it("形态正常的 provider 列表 detect 返回 needsRepair=false", async () => {
    const ctx = getNovelMasterTestContext();
    // bootstrap 已种了内置 provider（openai / anthropic / ...），形态正常
    const providerRepo = new SqliteProviderRepository(ctx.conn);
    const op = createProviderIdentityRepairOperation({ providerRepo });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, false);
  });

  it("内置行 builtin_key 被清空时 detect=true 且 repair 抛 ProviderError", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const providerRepo = new SqliteProviderRepository(ctx.conn);

    // 直接破坏一条内置行的 builtin_key（模拟 migration 裂了）
    const builtins = await providerRepo.list();
    const target = builtins.find((p) => p.isBuiltin);
    assert.ok(target != null, "bootstrap 应已种内置 provider");
    await ctx.conn.execute(
      `UPDATE llm_provider SET builtin_key = NULL WHERE id = ?`,
      [target.id],
    );

    const op = createProviderIdentityRepairOperation({ providerRepo });
    const detection = await op.detect();
    assert.equal(detection.needsRepair, true);
    assert.match(detection.details ?? "", /builtin_key/);

    await assert.rejects(
      () => op.repair(),
      (err: unknown) => err instanceof ProviderError,
    );

    // 还原，避免污染同一 test file 内的后续用例
    await ctx.conn.execute(
      `UPDATE llm_provider SET builtin_key = ? WHERE id = ?`,
      [target.builtinKey, target.id],
    );
  });

  it("display_name 被清空时 detect=true 且 repair 抛 ProviderError", async () => {
    // display_name 的非空校验已在 SqliteProviderRepository.rowToProvider 读取时强制
    // （空值直接抛 ProviderError）。这里用 mock repo 绕开读取校验，验证 op 自身的逻辑。
    const mockRepo = inMemoryProviderRepo([
      {
        ...fakeBuiltin("fake-display-empty", "openai"),
        displayName: "",
      },
    ]);
    const op = createProviderIdentityRepairOperation({ providerRepo: mockRepo });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, true);
    assert.match(detection.details ?? "", /display_name/);

    await assert.rejects(
      () => op.repair(),
      (err: unknown) => err instanceof ProviderError,
    );
  });
});

describe("provider-identity-repair: createProviderSecretRenameOperation", () => {
  it("旧 ref 存在时 detect=true，repair 搬运到新 ref 并删旧", async () => {
    const store = inMemorySecretStore();
    const oldId = `old-${testIsolationSuffix()}`;
    const newId = `new-${testIsolationSuffix()}`;
    const oldRef = `provider/${oldId}/apiKey`;
    const newRef = `provider/${newId}/apiKey`;
    await store.set(oldRef, "sk-secret");

    const op = createProviderSecretRenameOperation({
      secretStore: store,
      oldId,
      newId,
    });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, true);

    await op.repair();

    assert.equal(store._dump().has(oldRef), false, "旧 ref 应已删");
    assert.equal(store._dump().get(newRef), "sk-secret", "新 ref 应有值");

    // 再 detect 应为 false（幂等）
    const after = await op.detect();
    assert.equal(after.needsRepair, false);
  });

  it("oldId === newId 时 detect=false（无需搬运）", async () => {
    const store = inMemorySecretStore();
    const id = `same-${testIsolationSuffix()}`;
    const op = createProviderSecretRenameOperation({
      secretStore: store,
      oldId: id,
      newId: id,
    });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, false);
  });

  it("新 ref 已存在时 detect=false（避免覆盖）", async () => {
    const store = inMemorySecretStore();
    const oldId = `old2-${testIsolationSuffix()}`;
    const newId = `new2-${testIsolationSuffix()}`;
    await store.set(`provider/${oldId}/apiKey`, "old-val");
    await store.set(`provider/${newId}/apiKey`, "existing-val");

    const op = createProviderSecretRenameOperation({
      secretStore: store,
      oldId,
      newId,
    });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, false);
    assert.match(detection.details ?? "", /跳过 rename/);
  });
});
