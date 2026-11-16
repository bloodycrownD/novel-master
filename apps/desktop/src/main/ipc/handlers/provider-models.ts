/**
 * Provider model IPC handlers — fetch, save, sampling settings.
 */
import { savedModelDisplayName } from "@novel-master/core/provider";
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
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr } from "../ipc-result.js";
import { outcomeIfAborted, runAbortable } from "../run-scope.js";

function toSavedDetailDto(model: SavedModel, providerDisplayName: string): ProviderModelSavedDetailDto {
  return {
    id: model.id,
    providerId: model.providerId,
    vendorModelId: model.vendorModelId,
    modelName: model.modelName,
    displayName: savedModelDisplayName(model, providerDisplayName),
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

export async function handleProviderModelsSavedList(req: ProviderModelsSavedListRequest): Promise<IpcResult<ProviderModelSavedDto[]>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const providerDisplayName = await resolveProviderDisplayName(rt, req.providerId);
    if (!providerDisplayName.ok) return ipcErr(formatIpcError(providerDisplayName.error));
    const saved = await rt.providerModels.savedList(req.providerId);
    if (!saved.ok) return ipcErr(formatIpcError(saved.error));
    return {
      ok: true,
      data: saved.value.map((model) => ({
        id: model.id,
        vendorModelId: model.vendorModelId,
        modelName: model.modelName,
        displayName: savedModelDisplayName(model, providerDisplayName.value),
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
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
export async function handleProviderModelsFetch(req: ProviderModelsFetchRequest): Promise<IpcResult<void>> {
  const built = await getDesktopRuntime();
  if (!built.ok) return ipcErr(formatIpcError(built.error));
  const rt = built.value;
  return runAbortable(
    { registry: rt.abortRegistry, key: ABORT_KEY.providerModels(req.providerId), timeoutMs: 60_000, exclusive: true },
    (scope) => doProviderModelsFetch(rt, req.providerId, scope)
  );
}

/** 可中断的模型拉取段：请求前与请求后（写回建议表之前）各一个检查点。 */
export async function doProviderModelsFetch(rt: DesktopNovelMasterRuntime, providerId: string, scope: AbortScope): Promise<Outcome<void>> {
  const stopped = outcomeIfAborted(scope);
  if (stopped != null) return stopped;
  const fetched = await rt.providerModels.fetch(providerId, scope);
  const interrupted = outcomeIfAborted(scope);
  if (interrupted != null) return interrupted;
  return fetched.ok ? { kind: "completed", value: undefined } : { kind: "failed", error: fetched.error };
}

export async function handleProviderModelsSuggestList(req: ProviderModelsSavedListRequest): Promise<IpcResult<ProviderModelSuggestionDto[]>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const suggestions = await rt.providerModels.suggestList(req.providerId);
    if (!suggestions.ok) return ipcErr(formatIpcError(suggestions.error));
    const rows = suggestions.value.map((m) => ({
      vendorModelId: m.vendorModelId,
      displayName: m.displayName?.trim() || m.vendorModelId,
      stale: m.stale,
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsSave(req: ProviderModelsSaveRequest): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const savedModel = await rt.providerModels.save(req.providerId, req.vendorModelId, req.modelName);
    if (!savedModel.ok) return ipcErr(formatIpcError(savedModel.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsEditSaved(req: ProviderModelsEditSavedRequest): Promise<IpcResult<ProviderModelSavedDetailDto>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const updated = await rt.providerModels.editSaved(req.savedModelId, req.modelName);
    if (!updated.ok) return ipcErr(formatIpcError(updated.error));
    const providerDisplayName = await resolveProviderDisplayName(rt, updated.value.providerId);
    if (!providerDisplayName.ok) return ipcErr(formatIpcError(providerDisplayName.error));
    return { ok: true, data: toSavedDetailDto(updated.value, providerDisplayName.value) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsDeleteSaved(req: ProviderModelsDeleteSavedRequest): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    if (req.providerId != null) {
      const saved = await rt.providerModels.getSavedById(req.savedModelId);
      if (!saved.ok) return ipcErr(formatIpcError(saved.error));
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
    if (!deleted.ok) return ipcErr(formatIpcError(deleted.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsGetSaved(req: ProviderModelsGetSavedRequest): Promise<IpcResult<ProviderModelSavedDetailDto | null>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const saved = await rt.providerModels.getSavedById(req.savedModelId);
    if (!saved.ok) return ipcErr(formatIpcError(saved.error));
    if (saved.value == null) {
      return { ok: true, data: null };
    }
    const providerDisplayName = await resolveProviderDisplayName(rt, saved.value.providerId);
    if (!providerDisplayName.ok) return ipcErr(formatIpcError(providerDisplayName.error));
    return { ok: true, data: toSavedDetailDto(saved.value, providerDisplayName.value) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsUpdateSettings(req: ProviderModelsUpdateSettingsRequest): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const patch: Parameters<typeof rt.providerModels.updateSettings>[1] = {
      ...(req.contextWindowTokens != null ? { contextWindowTokens: req.contextWindowTokens } : {}),
      ...(req.tokenCounterMode != null ? { tokenCounterMode: req.tokenCounterMode as "auto" } : {}),
      ...(req.sampling != null ? { sampling: req.sampling as Parameters<typeof rt.providerModels.updateSettings>[1]["sampling"] } : {}),
      ...(req.thinkingLevel != null ? { thinkingLevel: req.thinkingLevel } : {}),
    };
    const updated = await rt.providerModels.updateSettings(req.savedModelId, patch);
    if (!updated.ok) return ipcErr(formatIpcError(updated.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsResetContextWindow(req: ProviderModelsResetContextWindowRequest): Promise<IpcResult<ProviderModelSavedDetailDto>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    const updated = await rt.providerModels.resetContextWindowToDefault(req.savedModelId);
    if (!updated.ok) return ipcErr(formatIpcError(updated.error));
    const providerDisplayName = await resolveProviderDisplayName(rt, updated.value.providerId);
    if (!providerDisplayName.ok) return ipcErr(formatIpcError(providerDisplayName.error));
    return { ok: true, data: toSavedDetailDto(updated.value, providerDisplayName.value) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
