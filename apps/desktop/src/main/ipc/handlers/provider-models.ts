/**
 * Provider model IPC handlers — fetch, save, sampling settings.
 */
import { formatApplicationModelId } from "@novel-master/core/provider";
import type {
  IpcResult,
  ProviderModelSavedDto,
  ProviderModelsDeleteSavedRequest,
  ProviderModelsFetchRequest,
  ProviderModelsGetSavedRequest,
  ProviderModelsResetContextWindowRequest,
  ProviderModelsSaveRequest,
  ProviderModelsSavedListRequest,
  ProviderModelsUpdateSettingsRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

export async function handleProviderModelsSavedList(
  req: ProviderModelsSavedListRequest,
): Promise<IpcResult<ProviderModelSavedDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.savedList(req.providerId);
    const rows = saved.map((m) => ({
      vendorModelId: m.vendorModelId,
      displayName: m.displayName ?? m.vendorModelId,
      applicationModelId: formatApplicationModelId(req.providerId, m.vendorModelId),
    }));
    return { ok: true, data: rows };
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
): Promise<IpcResult<ProviderModelSavedDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const suggestions = await rt.providerModels.suggestList(req.providerId);
    const rows = suggestions.map((m) => ({
      vendorModelId: m.vendorModelId,
      displayName: m.displayName ?? m.vendorModelId,
      applicationModelId: formatApplicationModelId(req.providerId, m.vendorModelId),
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
      req.displayName,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsDeleteSaved(
  req: ProviderModelsDeleteSavedRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providerModels.deleteSaved(req.providerId, req.vendorModelId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsGetSaved(
  req: ProviderModelsGetSavedRequest,
): Promise<IpcResult<unknown>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.getSaved(req.applicationModelId);
    return { ok: true, data: saved ?? null };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsUpdateSettings(
  req: ProviderModelsUpdateSettingsRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providerModels.updateSettings(req.providerId, req.vendorModelId, {
      contextWindowTokens: req.contextWindowTokens,
      tokenCounterMode: req.tokenCounterMode as "auto",
      sampling: req.sampling as Parameters<
        typeof rt.providerModels.updateSettings
      >[2]["sampling"],
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProviderModelsResetContextWindow(
  req: ProviderModelsResetContextWindowRequest,
): Promise<IpcResult<unknown>> {
  try {
    const rt = await getDesktopRuntime();
    const updated = await rt.providerModels.resetContextWindowToDefault(
      req.providerId,
      req.vendorModelId,
    );
    return { ok: true, data: updated };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
