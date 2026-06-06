/**
 * Provider CRUD IPC handlers (apiKey → SKSP via Core providers service).
 */
import type {
  IpcResult,
  ProviderCreateRequest,
  ProviderDetailDto,
  ProviderEditRequest,
  ProviderIdRequest,
  ProviderListItemDto,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

export async function handleProvidersList(): Promise<
  IpcResult<ProviderListItemDto[]>
> {
  try {
    const rt = await getDesktopRuntime();
    const providers = await rt.providers.list();
    const rows: ProviderListItemDto[] = [];
    for (const provider of providers) {
      const saved = await rt.providerModels.savedList(provider.id);
      rows.push({
        id: provider.id,
        displayName: provider.displayName,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        isBuiltin: provider.isBuiltin,
        apiKeyStatus: provider.apiKeyStatus,
        savedCount: saved.length,
      });
    }
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProvidersGet(
  req: ProviderIdRequest,
): Promise<IpcResult<ProviderDetailDto>> {
  try {
    const rt = await getDesktopRuntime();
    const provider = await rt.providers.get(req.providerId);
    const listed = (await rt.providers.list()).find((p) => p.id === req.providerId);
    return {
      ok: true,
      data: {
        id: provider.id,
        displayName: provider.displayName,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        isBuiltin: provider.isBuiltin,
        headers: provider.headers,
        apiKeyStatus: listed?.apiKeyStatus ?? "not set",
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProvidersCreate(
  req: ProviderCreateRequest,
): Promise<IpcResult<{ providerId: string }>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providers.create(req);
    return { ok: true, data: { providerId: req.id } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProvidersEdit(
  req: ProviderEditRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const { providerId, ...patch } = req;
    await rt.providers.edit(providerId, patch);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProvidersDelete(
  req: ProviderIdRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.providers.delete(req.providerId);
    const currentProviderId = await rt.state.getCurrentProviderId();
    if (currentProviderId === req.providerId) {
      await rt.state.resetCurrentProviderId();
    }
    const currentModelId = await rt.state.getCurrentModelId();
    if (currentModelId?.startsWith(`${req.providerId}/`)) {
      await rt.state.resetCurrentModelId();
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
