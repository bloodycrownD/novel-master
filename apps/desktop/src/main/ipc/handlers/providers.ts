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
        bodyParams: provider.bodyParams,
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
    const created = await rt.providers.create(req);
    return { ok: true, data: { providerId: created.id } };
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
    // ⚠️ 归属判定必须发生在 providers.delete 之前：delete 会级联抹掉该 provider 名下
    // 的全部 saved model 行，delete 之后再 getSavedById 恒为 null，reset 永不执行 ⇒
    // currentModelId 悬空固化进新会话 agent_config_json，发消息才抛 INVALID_SAVED_MODEL_ID。
    // 该顺序是 core `DefaultProviderService.delete` 里「currentModelId 是软指针、
    // 不参与 SAVED_MODEL_IN_USE 前置拒绝」这条契约的另一半，三调用方
    // （cli/desktop/mobile）必须保持一致，改动任一方须同步复核另外两方。
    const currentModelId = await rt.state.getCurrentModelId();
    let clearCurrentModel = false;
    if (currentModelId != null && currentModelId !== "") {
      const saved = await rt.providerModels.getSavedById(currentModelId);
      clearCurrentModel = saved?.providerId === req.providerId;
    }
    await rt.providers.delete(req.providerId);
    const currentProviderId = await rt.state.getCurrentProviderId();
    if (currentProviderId === req.providerId) {
      await rt.state.resetCurrentProviderId();
    }
    if (clearCurrentModel) {
      await rt.state.resetCurrentModelId();
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
