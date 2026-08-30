/**
 * provider 双身份键完整性修复（S-8）。
 *
 * provider-identity-v1 migration 之后，每条 `llm_provider` 行有「双身份键」：
 *   - `id`：UUID，所有外部引用（saved_model.provider_id / sksp ref / kkv 指针）都指向它；
 *   - `builtin_key`：仅内置行非空（openai / anthropic / ...），用来判定「是否同一个内置 provider」。
 *
 * 这里的修复操作有两类：
 *   1. **repair**（`createProviderIdentityRepairOperation`）：校验双身份键形态一致性
 *      ——内置行必须有非空 builtin_key、所有行必须有非空 display_name。这两条是
 *      migration 的 `assertMigratedShape` 不变量，运行时一旦违反说明 migration 裂了，
 *      detect 报告 needsRepair=true，repair 阶段抛 ProviderError 告警（不能静默打补丁）。
 *   2. **rename**（`createProviderSecretRenameOperation`）：provider id 变更时把 sksp 密钥
 *      ref 同步搬运到新 id。这条路径来自 provider-identity-v1 的 renameSkspSecrets，
 *      可在 migration 之外（如未来运行时 id 重写）复用。
 *
 * 注意：本模块只校验 provider 自身的双身份键一致性，不碰 vfs 的两套 ref_count——
 * 那是 {@link createRevisionRefCountRepairOperation} 的职责，两套计数器各自独立。
 *
 * @module domain/provider/logic/provider-identity-repair
 */

import type { ProviderRepository } from "../repositories/provider.port.js";
import { ProviderError } from "@/errors/provider-errors.js";
import type { IntegrityRepairOperation } from "@/service/integrity-repair.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { providerApiKeyRef } from "../model/provider.js";

/**
 * 校验 provider 双身份键形态：内置行必须有非空 builtin_key、所有行必须有非空 display_name。
 *
 * 这是 provider-identity-v1 migration `assertMigratedShape` 的运行时镜像。display_name
 * 的非空校验通常已在 `SqliteProviderRepository.rowToProvider` 读取时强制（空值直接抛
 * ProviderError），但某些路径（如 migration 直接读裸行）可能绕过 repo，所以这里作为
 * defense-in-depth 再查一次。builtin_key 一致性则是本操作的主要职责——内置行（is_builtin=1）
 * 缺 builtin_key 说明 migration 裂了。
 *
 * - detect 只读扫一遍 provider 列表，报告哪些行违反；
 * - repair 不会静默补值——migration 不变量一旦在运行时被破坏，说明数据层出了严重问题，
 *   应当 fail-fast 让上层感知，而不是悄悄打补丁掩盖根因。
 */
export function createProviderIdentityRepairOperation(args: {
  readonly providerRepo: ProviderRepository;
}): IntegrityRepairOperation {
  const { providerRepo } = args;
  return {
    name: "provider-identity-shape",
    kind: "repair",
    async detect() {
      const providers = await providerRepo.list();
      const offenders: string[] = [];
      for (const p of providers) {
        if (p.displayName.trim() === "") {
          offenders.push(`${p.id}: 空 display_name`);
        }
        if (
          p.isBuiltin &&
          (p.builtinKey == null || p.builtinKey.trim() === "")
        ) {
          offenders.push(`${p.id}: 内置行缺 builtin_key`);
        }
      }
      if (offenders.length === 0) {
        return { needsRepair: false };
      }
      return {
        needsRepair: true,
        details: `${
          offenders.length
        } 条 provider 违反双身份键不变量：${offenders.join("; ")}`,
      };
    },
    async repair() {
      // migration 不变量不能在运行时静默修复——重新 detect 一遍，违反则抛 ProviderError。
      const providers = await providerRepo.list();
      const emptyNames = providers.filter((p) => p.displayName.trim() === "");
      const builtinMissingKey = providers.filter(
        (p) =>
          p.isBuiltin && (p.builtinKey == null || p.builtinKey.trim() === "")
      );
      if (emptyNames.length === 0 && builtinMissingKey.length === 0) {
        return;
      }
      throw new ProviderError(
        "MIGRATION_ORPHAN_POINTER",
        `provider 双身份键不变量被破坏，无法自动修复：` +
          `空 display_name=[${emptyNames.map((p) => p.id).join(", ")}]，` +
          `内置行缺 builtin_key=[${builtinMissingKey
            .map((p) => p.id)
            .join(", ")}]`
      );
    },
  };
}

/**
 * provider id 重命名时把对应的 sksp 密钥 ref 从旧 id 搬到新 id。
 *
 * 来源是 provider-identity-v1 migration 的 renameSkspSecrets。抽出成独立操作后，
 * 未来如果有「运行时 provider id 重写」场景（比如跨库合并时撞 id），可以复用这条路径。
 *
 * - detect：旧 ref 存在且新 ref 不存在时才标记 needsRepair=true；
 * - repair：读旧值 → 写新 ref → 删旧 ref（标准 rename 三步），幂等。
 */
export function createProviderSecretRenameOperation(args: {
  readonly secretStore: SecretStore;
  readonly oldId: string;
  readonly newId: string;
}): IntegrityRepairOperation {
  const { secretStore, oldId, newId } = args;
  const oldRef = providerApiKeyRef(oldId);
  const newRef = providerApiKeyRef(newId);
  return {
    name: `provider-secret-rename:${oldId}->${newId}`,
    kind: "rename",
    async detect() {
      if (oldId === newId) {
        return { needsRepair: false };
      }
      const hasOld = await secretStore.has(oldRef);
      if (!hasOld) {
        return { needsRepair: false };
      }
      const hasNew = await secretStore.has(newRef);
      if (hasNew) {
        return {
          needsRepair: false,
          details: `新 ref ${newRef} 已存在，跳过 rename（避免覆盖）`,
        };
      }
      return {
        needsRepair: true,
        details: `旧 ref ${oldRef} 存在、新 ref ${newRef} 不存在，需搬运`,
      };
    },
    async repair() {
      if (oldId === newId) {
        return;
      }
      const value = await secretStore.get(oldRef);
      if (value == null) {
        return;
      }
      if (await secretStore.has(newRef)) {
        // detect 已拦，但 repair 要求幂等，这里再核一次避免覆盖。
        return;
      }
      await secretStore.set(newRef, value);
      await secretStore.delete(oldRef);
    },
  };
}
