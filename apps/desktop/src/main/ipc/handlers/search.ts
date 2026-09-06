/**
 * 搜索引擎配置 IPC 处理器：绑定 main runtime 的 searchConfig store。
 *
 * 凭证口径：key 明文只经 SKSP set，任何返回值不含明文——getConfig
 * 只回 configured 状态（与 core SearchConfigPublic 结构同构）。
 * engineId 合法性：setDefaultEngine 在 core 内有运行时校验兜底；
 * saveEngineKey/clearEngineKey 传入脏 id 只会读写孤儿 SKSP ref
 * （resolve 链不认，无实际危害），调用方（本仓 renderer）只传四引擎 id。
 */
import type { EngineId, KeyEngineId } from "@novel-master/core";
import type {
  IpcResult,
  SearchClearEngineKeyRequest,
  SearchConfigDto,
  SearchSaveEngineKeyRequest,
  SearchSetDefaultEngineRequest,
  SearchSetSearxngBaseUrlRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

export async function handleSearchGetConfig(): Promise<
  IpcResult<SearchConfigDto>
> {
  try {
    const rt = await getDesktopRuntime();
    const config = await rt.searchConfig.readConfig();
    // core 的 Record<EngineId, …> 结构化兼容 DTO 的 Record<string, …>
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSaveEngineKey(
  req: SearchSaveEngineKeyRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.saveEngineKey(
      req.engineId as KeyEngineId,
      req.apiKey,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchClearEngineKey(
  req: SearchClearEngineKeyRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.searchConfig.clearEngineKey(req.engineId as KeyEngineId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSetSearxngBaseUrl(
  req: SearchSetSearxngBaseUrlRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 空串 = 清除；非法 URL 形状由 core normalizeSearxngBaseUrl 抛错回传
    await rt.searchConfig.setSearxngBaseUrl(req.baseUrl);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSearchSetDefaultEngine(
  req: SearchSetDefaultEngineRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // null = 清除（回落到「第一个已配置引擎」解析）
    await rt.searchConfig.setDefaultEngine(
      req.engineId as EngineId | null,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
