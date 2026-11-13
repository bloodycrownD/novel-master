/**
 * 搜索引擎配置 IPC 处理器：绑定 main runtime 的 searchConfig store。
 *
 * 凭证口径：key 明文只经 SKSP set，任何返回值不含明文——getConfig
 * 只回配置状态（与 core SearchConfigPublic 同构）。
 * engineId 合法性：引擎 id 已动态化（六预置 / `custom:{nanoid8}` / duckduckgo）。
 * 写路径的校验（模板、明文检测、未知 id、顺序）全部在 core store 内，handler
 * 只做薄转发；store 方法 throw 的失败在编排边界经 formatIpcError 封进
 * IpcResult，renderer 拿到 error.message 即为可展示文案。
 * （v3 拍板 A4：`testEngine` 已整链退役，desktop 无测试搜索入口。）
 */
import type {
  IpcResult,
  SearchClearEngineKeyRequest,
  SearchConfigDto,
  SearchCreateCustomEngineRequest,
  SearchDeleteCustomEngineRequest,
  SearchResetPresetOverrideRequest,
  SearchSaveEngineKeyRequest,
  SearchSetEnabledRequest,
  SearchSetEngineBaseUrlRequest,
  SearchSetEngineOrderRequest,
  SearchUpdateCustomEngineRequest,
  SearchUpdatePresetOverrideRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

export async function handleSearchGetConfig(): Promise<IpcResult<SearchConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    return { ok: true, data: await rt.searchConfig.readConfig() };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSaveEngineKey(req: SearchSaveEngineKeyRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.saveEngineKey(req.engineId, req.apiKey);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchClearEngineKey(req: SearchClearEngineKeyRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.clearEngineKey(req.engineId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSetEnabled(req: SearchSetEnabledRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.setEnabled(req.engineId, req.enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSetEngineBaseUrl(req: SearchSetEngineBaseUrlRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 空串 = 清除；非法 URL 形状由 core normalizeEngineBaseUrl 抛错回传
    await rt.searchConfig.setEngineBaseUrl(req.engineId, req.baseUrl);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSetEngineOrder(req: SearchSetEngineOrderRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 合法性校验在 core setEngineOrder 内（未知 id / 重复项抛错经 IpcResult 回传）
    await rt.searchConfig.setEngineOrder(req.engineOrder);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchCreateCustomEngine(req: SearchCreateCustomEngineRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.createCustomEngine(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchUpdateCustomEngine(req: SearchUpdateCustomEngineRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const { engineId, ...input } = req;
    await rt.searchConfig.updateCustomEngine(engineId, input);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchDeleteCustomEngine(req: SearchDeleteCustomEngineRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.deleteCustomEngine(req.engineId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchUpdatePresetOverride(req: SearchUpdatePresetOverrideRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.updatePresetOverride(req.engineId, req.patch);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchResetPresetOverride(req: SearchResetPresetOverrideRequest): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.resetPresetOverride(req.engineId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
