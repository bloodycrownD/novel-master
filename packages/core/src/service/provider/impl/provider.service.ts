/**
 * 默认 provider CRUD 服务。
 *
 * @module service/provider/impl/provider.service
 */

import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { randomUUID } from "@/infra/random-uuid.js";
import { ProviderError } from "@/errors/provider-errors.js";
import { CoordinatedWrite } from "@/service/coordinated-write.js";
import type { LlmProvider } from "@/domain/provider/model/provider.js";
import {
  providerApiKeyRef,
  resolveProviderApiKeySecretRef,
} from "@/domain/provider/model/provider.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import { findSavedModelReferences } from "@/domain/provider/logic/find-saved-model-references.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ModelSuggestionRepository } from "@/domain/provider/repositories/model-suggestion.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { providerApiKeyIsConfigured } from "@/domain/provider/logic/resolve-provider-api-key.js";
import { normalizeBaseUrl } from "@/infra/llm-protocol/logic/http-util.js";
import type {
  CreateProviderInput,
  EditProviderPatch,
  ProviderListItem,
  ProviderService,
} from "../provider.port.js";

export interface DefaultProviderServiceDeps {
  readonly providers: ProviderRepository;
  readonly suggestions: ModelSuggestionRepository;
  readonly savedModels: SavedModelRepository;
  readonly secretStore: SecretStore;
  /**
   * 仅供 `delete` 的 in-use 拒绝用（`findSavedModelReferences` 的首参）。
   *
   * ⚠️ **不得**改走 `providerModels` 反向注入来拿：`ProviderModelService` 已持有
   * `providers`，反向注入会成循环 import。`conn` 由工厂直接传，链路现成。
   */
  readonly conn: TdbcConnection;
}

function requireNonEmptyDisplayName(raw: string, providerId?: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new ProviderError(
      "INVALID_ARGUMENT",
      "displayName 不能为空",
      providerId != null ? { providerId } : undefined
    );
  }
  return trimmed;
}

/** Provider 配置服务。 */
export class DefaultProviderService implements ProviderService {
  constructor(private readonly deps: DefaultProviderServiceDeps) {}

  async list(): Promise<ProviderListItem[]> {
    const rows = await this.deps.providers.list();
    return Promise.all(
      rows.map(async (p) => ({
        ...p,
        apiKeyStatus: await this.apiKeyStatus(p),
      }))
    );
  }

  async get(id: string): Promise<LlmProvider> {
    const p = await this.deps.providers.findById(id);
    if (!p) {
      throw new ProviderError("NOT_FOUND", `Provider not found: ${id}`, {
        providerId: id,
      });
    }
    return p;
  }

  async create(input: CreateProviderInput): Promise<LlmProvider> {
    const displayName = requireNonEmptyDisplayName(input.displayName);
    const id = randomUUID();
    const now = Date.now();
    const secretRef = input.apiKey ? providerApiKeyRef(id) : null;
    const provider: LlmProvider = {
      id,
      builtinKey: null,
      protocol: input.protocol,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      displayName,
      secretRef,
      headers: input.headers ?? {},
      bodyParams: input.bodyParams ?? {},
      isBuiltin: false,
      createdAtMs: now,
      updatedAtMs: now,
    };

    // S-1：secretStore.set → providers.insert 这条跨资源写链走 CoordinatedWrite。
    // 中间步骤失败时逆序补偿：先删 provider 行，再删 secret，避免留半套凭据。
    const write = new CoordinatedWrite();
    if (input.apiKey) {
      const ref = secretRef!;
      write.register({
        name: "set-secret",
        execute: async () => {
          await this.deps.secretStore.set(ref, input.apiKey!);
        },
        rollback: async () => {
          if (await this.deps.secretStore.has(ref)) {
            await this.deps.secretStore.delete(ref);
          }
        },
      });
    }
    write.register({
      name: "insert-provider",
      execute: async () => {
        await this.deps.providers.insert(provider);
      },
      rollback: async () => {
        await this.deps.providers.delete(id);
      },
    });
    await write.run();
    return provider;
  }

  async edit(id: string, patch: EditProviderPatch): Promise<LlmProvider> {
    const provider = await this.get(id);
    if (provider.isBuiltin && patch.protocol !== undefined) {
      throw new ProviderError(
        "BUILTIN_PROVIDER",
        `Cannot change protocol of built-in provider: ${id}`,
        { providerId: id }
      );
    }

    // 先捕获原始 secret 明文与 ref，用于回滚时精确恢复（secretStore 没有事务，
    // 只能在应用层用「读到旧值 → 失败时写回」来补偿）。
    const originalSecretRef = resolveProviderApiKeySecretRef(provider);
    const originalSecretValue = await this.deps.secretStore.get(
      originalSecretRef
    );

    let secretRef = provider.secretRef;
    let secretOp: "set" | "delete" | "noop" = "noop";
    let newSecretValue: string | null = null;
    if (patch.apiKey !== undefined) {
      if (patch.apiKey === "") {
        secretOp = "delete";
        secretRef = null;
      } else {
        secretOp = "set";
        secretRef = providerApiKeyRef(id);
        newSecretValue = patch.apiKey;
      }
    }

    const displayName =
      patch.displayName !== undefined
        ? requireNonEmptyDisplayName(patch.displayName, id)
        : provider.displayName;
    const updated: LlmProvider = {
      ...provider,
      protocol: patch.protocol ?? provider.protocol,
      baseUrl: patch.baseUrl
        ? normalizeBaseUrl(patch.baseUrl)
        : provider.baseUrl,
      displayName,
      headers: patch.headers ?? provider.headers,
      bodyParams: patch.bodyParams ?? provider.bodyParams,
      secretRef,
      updatedAtMs: Date.now(),
    };

    // S-1：secretStore 写 → providers.update 走 CoordinatedWrite。
    // secret 回滚靠上面捕获的原始明文；providers 回滚靠 update 回原始行。
    const write = new CoordinatedWrite();
    if (secretOp !== "noop") {
      write.register({
        name: "write-secret",
        execute: async () => {
          if (secretOp === "delete") {
            if (await this.deps.secretStore.has(originalSecretRef)) {
              await this.deps.secretStore.delete(originalSecretRef);
            }
          } else {
            await this.deps.secretStore.set(secretRef!, newSecretValue!);
          }
        },
        rollback: async () => {
          if (originalSecretValue != null) {
            await this.deps.secretStore.set(
              originalSecretRef,
              originalSecretValue
            );
          } else if (secretOp === "set") {
            // 原本没有 secret：删掉新写的，避免留孤儿凭据。
            if (await this.deps.secretStore.has(secretRef!)) {
              await this.deps.secretStore.delete(secretRef!);
            }
          }
        },
      });
    }
    write.register({
      name: "update-provider",
      execute: async () => {
        await this.deps.providers.update(updated);
      },
      rollback: async () => {
        await this.deps.providers.update(provider);
      },
    });
    await write.run();
    return updated;
  }

  async delete(id: string): Promise<void> {
    const provider = await this.get(id);
    if (provider.isBuiltin) {
      throw new ProviderError(
        "BUILTIN_PROVIDER",
        `Cannot delete built-in provider: ${id}`,
        { providerId: id }
      );
    }

    // S-1：五步顺序写跨 suggestions / savedModels / providers / secretStore 四个域。
    // 先把待删数据快照下来，失败时逆序恢复，保证不留半套。
    const ref = resolveProviderApiKeySecretRef(provider);
    const suggestions = await this.deps.suggestions.listByProvider(id);
    const savedModels = await this.deps.savedModels.listByProvider(id);
    const secretValue = await this.deps.secretStore.get(ref);

    // S-D 前置拒绝（**在 CoordinatedWrite 之外**）：本路径走
    // `savedModels.deleteByProvider(id)` **批量抹掉**该 provider 的全部已保存模型，
    // 完全不经过 `ProviderModelService.deleteSaved` 的 in-use 守卫 ⇒ 即便那条守卫
    // 补全了，这条路依然能静默清空被引用的模型。拒绝发生在任何删除动作之前，
    // 因此不破坏既有五步 CoordinatedWrite 的 rollback 配对。
    for (const m of savedModels) {
      const refs = await findSavedModelReferences(this.deps.conn, m.id);
      // ⚠️ `currentModelId` 是**软指针**，不是内容引用。真实契约分两半，缺一不可：
      //   ① 【本处】把它从 blockingRefs 里滤掉——把它当硬引用会把这层既有契约打死，
      //      provider 只要是当前模型就永远删不掉。真正必须前置拒绝的内容引用只有
      //      agent_definition / chat_project / chat_session 三类。
      //   ② 【调用方】三个调用方都在 **delete 之前**读一次 currentModelId 并按
      //      `saved.providerId === id` 算好 clearCurrentModel，**delete 成功返回之后**
      //      才 resetCurrentModelId（currentProviderId 同理）：
      //        - apps/cli/src/provider/commands.ts `delete` 分支
      //        - apps/desktop/src/main/ipc/handlers/providers.ts `handleProvidersDelete`
      //        - apps/mobile/src/screens/stack/ProvidersScreen.tsx `deleteProviderOne`
      //      顺序不可换：delete 会级联抹掉本 provider 名下的 saved model 行，
      //      之后再 getSavedById 恒为 null ⇒ reset 永不执行 ⇒ currentModelId 悬空
      //      固化进新会话的 agent_config_json，发消息才抛 INVALID_SAVED_MODEL_ID。
      //
      // ⚠️⚠️ 本过滤**依赖三个调用方的 delete 前置判定顺序**——服务层自己不清理这条软
      // 指针，全靠调用方兜。改动任一调用方（新增第四个端、或调整上述顺序）**必须**
      // 同步复核另外两端，否则软指针悬空会静默复发。
      const blockingRefs = refs.filter((r) => r !== "currentModelId");
      if (blockingRefs.length > 0) {
        // 写死复用 SAVED_MODEL_IN_USE、**不新造 PROVIDER_IN_USE**：
        // provider-errors.ts 的码表里没有后者（写了会编译不过）；
        // `formatIpcError` 按 instanceof 类分派后原样透传 err.code，
        // 前端零 SAVED_MODEL_IN_USE 命中 ⇒ 没有需要同步的映射表，
        // 新造码只会让前端拿不到已处理的文案。
        throw new ProviderError(
          "SAVED_MODEL_IN_USE",
          `无法删除服务商：其下模型「${m.modelName}」仍被引用（${blockingRefs.join("、")}）`,
          { providerId: id }
        );
      }
    }

    const write = new CoordinatedWrite();
    write.register({
      name: "delete-suggestions",
      execute: async () => {
        await this.deps.suggestions.deleteByProvider(id);
      },
      rollback: async () => {
        for (const s of suggestions) {
          await this.deps.suggestions.upsert(s);
        }
      },
    });
    write.register({
      name: "delete-saved-models",
      execute: async () => {
        await this.deps.savedModels.deleteByProvider(id);
      },
      rollback: async () => {
        for (const m of savedModels) {
          await this.deps.savedModels.insert(m);
        }
      },
    });
    write.register({
      name: "delete-provider",
      execute: async () => {
        await this.deps.providers.delete(id);
      },
      rollback: async () => {
        await this.deps.providers.insert(provider);
      },
    });
    write.register({
      name: "delete-secret",
      execute: async () => {
        if (await this.deps.secretStore.has(ref)) {
          await this.deps.secretStore.delete(ref);
        }
      },
      rollback: async () => {
        if (secretValue != null) {
          await this.deps.secretStore.set(ref, secretValue);
        }
      },
    });
    await write.run();
  }

  private async apiKeyStatus(
    provider: LlmProvider
  ): Promise<"set" | "not set"> {
    return (await providerApiKeyIsConfigured(provider, this.deps.secretStore))
      ? "set"
      : "not set";
  }
}
