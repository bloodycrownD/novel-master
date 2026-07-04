/**
 * Provider model IPC handlers — fetch, save, sampling settings.
 */
import { savedModelDisplayName } from "@novel-master/core/provider";
import type { SavedModel } from "@novel-master/core/provider";
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
import { formatIpcError } from "../ipc-error.js";

function toSavedDto(model: SavedModel): ProviderModelSavedDto {
  return {
    id: model.id,
    vendorModelId: model.vendorModelId,
    modelName: model.modelName,
    displayName: savedModelDisplayName(model),
  };
}

function toSavedDetailDto(model: SavedModel): ProviderModelSavedDetailDto {
  return {
    id: model.id,
    providerId: model.providerId,
    vendorModelId: model.vendorModelId,
    modelName: model.modelName,
    displayName: savedModelDisplayName(model),
    settings: model.settings,
    createdAtMs: model.createdAtMs,
    updatedAtMs: model.updatedAtMs,
  };
}

export async function handleProviderModelsSavedList(
  req: ProviderModelsSavedListRequest,
): Promise<IpcResult<ProviderModelSavedDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.savedList(req.providerId);
    return { ok: true, data: saved.map(toSavedDto) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsFetch(
  req: ProviderModelsFetchRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providerModels.fetch(req.providerId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsSuggestList(
  req: ProviderModelsSavedListRequest,
): Promise<IpcResult<ProviderModelSuggestionDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const suggestions = await rt.providerModels.suggestList(req.providerId);
    const rows = suggestions.map((m) => ({
      vendorModelId: m.vendorModelId,
      displayName: m.displayName?.trim() || m.vendorModelId,
      stale: m.stale,
    }));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsSave(
  req: ProviderModelsSaveRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providerModels.save(
      req.providerId,
      req.vendorModelId,
      req.modelName,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsEditSaved(
  req: ProviderModelsEditSavedRequest,
): Promise<IpcResult<ProviderModelSavedDetailDto>> {
  try {
    const rt = await getDesktopRuntime();
    const updated = await rt.providerModels.editSaved(
      req.savedModelId,
      req.modelName,
    );
    return { ok: true, data: toSavedDetailDto(updated) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsDeleteSaved(
  req: ProviderModelsDeleteSavedRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    if (req.providerId != null) {
      const saved = await rt.providerModels.getSavedById(req.savedModelId);
      if (saved != null && saved.providerId !== req.providerId) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_MISMATCH",
            message: "模型不属于当前服务商",
          },
        };
      }
    }
    await rt.providerModels.deleteSaved(req.savedModelId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsGetSaved(
  req: ProviderModelsGetSavedRequest,
): Promise<IpcResult<ProviderModelSavedDetailDto | null>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.getSavedById(req.savedModelId);
    return { ok: true, data: saved ? toSavedDetailDto(saved) : null };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsUpdateSettings(
  req: ProviderModelsUpdateSettingsRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providerModels.updateSettings(req.savedModelId, {
      ...(req.contextWindowTokens != null
        ? { contextWindowTokens: req.contextWindowTokens }
        : {}),
      ...(req.tokenCounterMode != null
        ? { tokenCounterMode: req.tokenCounterMode as "auto" }
        : {}),
      ...(req.sampling != null
        ? {
            sampling: req.sampling as Parameters<
              typeof rt.providerModels.updateSettings
            >[1]["sampling"],
          }
        : {}),
      ...(req.thinkingLevel != null ? { thinkingLevel: req.thinkingLevel } : {}),
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsResetContextWindow(
  req: ProviderModelsResetContextWindowRequest,
): Promise<IpcResult<ProviderModelSavedDetailDto>> {
  try {
    const rt = await getDesktopRuntime();
    const updated = await rt.providerModels.resetContextWindowToDefault(
      req.savedModelId,
    );
    return { ok: true, data: toSavedDetailDto(updated) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
