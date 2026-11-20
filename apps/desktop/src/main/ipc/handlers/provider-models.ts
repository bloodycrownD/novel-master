/**
 * Provider model IPC handlers — fetch, save, sampling settings.
 */
import { SavedModelDisplayName } from "@novel-master/core/provider";
import type { SavedModel } from "@novel-master/core/provider";
import { ABORT_KEY, type AbortScope } from "@novel-master/core/abort";
import { type AppError, Result, type Outcome } from "@novel-master/core/errors";
import type {
  IpcResult,
  ProviderModelSavedDetailDto,
  ProviderModelSavedDto,
  ProviderModelSuggestionDto,
  ProviderModelsDeleteSavedRequest,
  ProviderModelsEditSavedRequest,
  ProviderModelsFetchRequest,
  ProviderModelsGetSavedRequest,
  ProviderModelsResetContextWindowRequest,
  ProviderModelsSaveRequest,
  ProviderModelsSavedListRequest,
  ProviderModelsUpdateSettingsRequest,
} from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { FormatIpcError } from "../ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { RunScope } from "../run-scope.js";

export namespace ProviderModels {
  function toSavedDetailDto(model: SavedModel, providerDisplayName: string): ProviderModelSavedDetailDto {
    return {
      id: model.id,
      providerId: model.providerId,
      vendorModelId: model.vendorModelId,
      modelName: model.modelName,
      displayName: SavedModelDisplayName.format(providerDisplayName, model.modelName),
      settings: model.settings,
      createdAtMs: model.createdAtMs,
      updatedAtMs: model.updatedAtMs,
    };
  }

  async function resolveProviderDisplayName(rt: DesktopNovelMasterRuntime, providerId: string): Promise<Result<string, AppError>> {
    const provider = await rt.providers.get(providerId);
    if (!provider.ok) return Result.err(provider.error);
    return Result.ok(provider.value.displayName);
  }

  export async function savedList(req: ProviderModelsSavedListRequest): Promise<IpcResult<ProviderModelSavedDto[]>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const providerDisplayName = await resolveProviderDisplayName(rt, req.providerId);
      if (!providerDisplayName.ok) return IpcResults.err(FormatIpcError.format(providerDisplayName.error));
      const saved = await rt.providerModels.savedList(req.providerId);
      if (!saved.ok) return IpcResults.err(FormatIpcError.format(saved.error));
      return {
        ok: true,
        data: saved.value.map((model) => ({
          id: model.id,
          vendorModelId: model.vendorModelId,
          modelName: model.modelName,
          displayName: SavedModelDisplayName.format(providerDisplayName.value, model.modelName),
        })),
      };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  /**
   * 拉取并保存模型列表（signal-abort-scope §五）。
   *
   * timeout 60s；key 用 providerId，`tryRegister` 拒绝同一 provider 的并发拉取
   * （第二路回 `PROVIDER_MODELS_IN_FLIGHT`）。scope 透传到
   * `provider-model.service.fetch` → `adapter.listModels` → `fetchJson` 的
   * `signal`：单次网络请求由 signal 真断，请求内部不再插检查点。
   */
  export async function fetch(req: ProviderModelsFetchRequest): Promise<IpcResult<void>> {
    const built = await DesktopRuntimeSingleton.get();
    if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
    const rt = built.value;
    return RunScope.abortable(
      { registry: rt.abortRegistry, key: ABORT_KEY.providerModels(req.providerId), timeoutMs: 60_000, exclusive: true },
      (scope) => ProviderModels.doFetch(rt, req.providerId, scope)
    );
  }

  /** 可中断的模型拉取段：请求前与请求后（写回建议表之前）各一个检查点。 */
  // nm-style: keep-local — run-abort-handlers.test 动态 import 解构直引并调用（断言中止 scope 行为）；内联会破坏测试锁名。
  export async function doFetch(rt: DesktopNovelMasterRuntime, providerId: string, scope: AbortScope): Promise<Outcome<void>> {
    const stopped = RunScope.outcomeIfAborted(scope);
    if (stopped != null) return stopped;
    const fetched = await rt.providerModels.fetch(providerId, scope);
    const interrupted = RunScope.outcomeIfAborted(scope);
    if (interrupted != null) return interrupted;
    return fetched.ok ? { kind: "completed", value: undefined } : { kind: "failed", error: fetched.error };
  }

  export async function suggestList(req: ProviderModelsSavedListRequest): Promise<IpcResult<ProviderModelSuggestionDto[]>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const suggestions = await rt.providerModels.suggestList(req.providerId);
      if (!suggestions.ok) return IpcResults.err(FormatIpcError.format(suggestions.error));
      const rows = suggestions.value.map((m) => ({
        vendorModelId: m.vendorModelId,
        displayName: m.displayName?.trim() || m.vendorModelId,
        stale: m.stale,
      }));
      return { ok: true, data: rows };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function save(req: ProviderModelsSaveRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const savedModel = await rt.providerModels.save(req.providerId, req.vendorModelId, req.modelName);
      if (!savedModel.ok) return IpcResults.err(FormatIpcError.format(savedModel.error));
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function editSaved(req: ProviderModelsEditSavedRequest): Promise<IpcResult<ProviderModelSavedDetailDto>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const updated = await rt.providerModels.editSaved(req.savedModelId, req.modelName);
      if (!updated.ok) return IpcResults.err(FormatIpcError.format(updated.error));
      const providerDisplayName = await resolveProviderDisplayName(rt, updated.value.providerId);
      if (!providerDisplayName.ok) return IpcResults.err(FormatIpcError.format(providerDisplayName.error));
      return { ok: true, data: toSavedDetailDto(updated.value, providerDisplayName.value) };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function deleteSaved(req: ProviderModelsDeleteSavedRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      if (req.providerId != null) {
        const saved = await rt.providerModels.getSavedById(req.savedModelId);
        if (!saved.ok) return IpcResults.err(FormatIpcError.format(saved.error));
        if (saved.value != null && saved.value.providerId !== req.providerId) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_MODEL_MISMATCH",
              message: "模型不属于当前服务商",
            },
          };
        }
      }
      const deleted = await rt.providerModels.deleteSaved(req.savedModelId);
      if (!deleted.ok) return IpcResults.err(FormatIpcError.format(deleted.error));
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function getSaved(req: ProviderModelsGetSavedRequest): Promise<IpcResult<ProviderModelSavedDetailDto | null>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const saved = await rt.providerModels.getSavedById(req.savedModelId);
      if (!saved.ok) return IpcResults.err(FormatIpcError.format(saved.error));
      if (saved.value == null) {
        return { ok: true, data: null };
      }
      const providerDisplayName = await resolveProviderDisplayName(rt, saved.value.providerId);
      if (!providerDisplayName.ok) return IpcResults.err(FormatIpcError.format(providerDisplayName.error));
      return { ok: true, data: toSavedDetailDto(saved.value, providerDisplayName.value) };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function updateSettings(req: ProviderModelsUpdateSettingsRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const patch: Parameters<typeof rt.providerModels.updateSettings>[1] = {
        ...(req.contextWindowTokens != null ? { contextWindowTokens: req.contextWindowTokens } : {}),
        ...(req.tokenCounterMode != null ? { tokenCounterMode: req.tokenCounterMode as "auto" } : {}),
        ...(req.sampling != null ? { sampling: req.sampling as Parameters<typeof rt.providerModels.updateSettings>[1]["sampling"] } : {}),
        ...(req.thinkingLevel != null ? { thinkingLevel: req.thinkingLevel } : {}),
      };
      const updated = await rt.providerModels.updateSettings(req.savedModelId, patch);
      if (!updated.ok) return IpcResults.err(FormatIpcError.format(updated.error));
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function resetContextWindow(req: ProviderModelsResetContextWindowRequest): Promise<IpcResult<ProviderModelSavedDetailDto>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
      const rt = built.value;
      const updated = await rt.providerModels.resetContextWindowToDefault(req.savedModelId);
      if (!updated.ok) return IpcResults.err(FormatIpcError.format(updated.error));
      const providerDisplayName = await resolveProviderDisplayName(rt, updated.value.providerId);
      if (!providerDisplayName.ok) return IpcResults.err(FormatIpcError.format(providerDisplayName.error));
      return { ok: true, data: toSavedDetailDto(updated.value, providerDisplayName.value) };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }
}
