/**
 * 搜索引擎配置存储（core 纯逻辑，入参 SecretStore + KkvService）：
 * key 明文经 SKSP 存储于 `search/{engineId}/apiKey` ref，引擎元数据
 * （默认引擎、searxng baseUrl）存 KKV 模块 `nm-search`——形态照云同步
 * 先例（`cloud-sync/s3-secret-key` ref + `nm-cloud-sync` 模块）。
 *
 * 凭证安全口径：对外类型只用 `configured: boolean`（不暴露 keySet /
 * key 明文）；明文 key 仅在 {@link resolveEngine} 内经 `secretStore.get`
 * 现读并随 `ResolvedEngineConfig` 注入适配器，不落 KKV / 日志 / 任何
 * 返回值。
 *
 * @module domain/tool/builtin/search/search-config
 */

import { KkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import {
  ENGINE_IDS,
  KEY_ENGINE_IDS,
  type EngineId,
  type KeyEngineId,
  type ResolvedEngineConfig,
  type SearchEngineStatus,
} from "./types.js";

/** KKV 模块名（照 nm-cloud-sync 命名先例）。 */
export const SEARCH_KKV_MODULE = "nm-search";

/** KKV 键：默认引擎（EngineId 字符串）。 */
export const KEY_DEFAULT_ENGINE = "defaultEngine";

/** KKV 键：searxng 实例 baseUrl。 */
export const KEY_SEARXNG_BASE_URL = "searxngBaseUrl";

/**
 * SKSP ref：引擎 API key（仅 bocha/tavily/brave 有 key；searxng 走
 * baseUrl，不占 ref）。
 */
export function searchApiKeyRef(engineId: KeyEngineId): string {
  return `search/${engineId}/apiKey`;
}

/** 单引擎配置状态（对外展示面，不含 key 明文；定义于 types.ts 供闭包/配置两侧共用）。 */
export type { SearchEngineStatus } from "./types.js";

/** 对外公开的搜索配置（DTO 不含 key 明文，双端 UI / IPC 直接消费）。 */
export interface SearchConfigPublic {
  /** 默认引擎（未设置或存量值非法时为 null）。 */
  readonly defaultEngine: EngineId | null;
  /** searxng 实例 baseUrl（规范化后；未配置为空串）。 */
  readonly searxngBaseUrl: string;
  /** 四引擎的配置状态（searxng 的 configured = baseUrl 非空，不查 secretStore）。 */
  readonly engines: Readonly<Record<EngineId, SearchEngineStatus>>;
}

/** 配置读写依赖（调用方注入实例；纯函数便于单测 mock）。 */
export interface SearchConfigDeps {
  readonly kkv: KkvService;
  readonly secretStore: SecretStore;
}

/**
 * searxng baseUrl 规范化：仅 http/https、禁 userinfo、剥 path 尾部斜杠
 * 与 search/hash；非法返回 null。参考实现同款规则。
 */
export function normalizeSearxngBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** KKV 读取：NOT_FOUND 归一化为 undefined（缺省视同未配置）。 */
async function kkvGet(
  kkv: KkvService,
  key: string
): Promise<string | undefined> {
  try {
    return await kkv.get(SEARCH_KKV_MODULE, key);
  } catch (error) {
    if (error instanceof KkvError && error.code === "NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

/** KKV 删除：NOT_FOUND 忽略（幂等清除）。 */
async function kkvDelete(kkv: KkvService, key: string): Promise<void> {
  try {
    await kkv.delete(SEARCH_KKV_MODULE, key);
  } catch (error) {
    if (error instanceof KkvError && error.code === "NOT_FOUND") {
      return;
    }
    throw error;
  }
}

/** 存量 defaultEngine 值合法性归一：非引擎 id（含空串/undefined）→ null。 */
function normalizeDefaultEngine(raw: string | undefined): EngineId | null {
  return raw != null && (ENGINE_IDS as readonly string[]).includes(raw)
    ? (raw as EngineId)
    : null;
}

/**
 * 读取对外配置：并行 `kkv.get` × 2 + `secretStore.has` × 3（仅 key 引擎）；
 * searxng 的 `configured` 只看 baseUrl 是否非空，不触碰 secretStore。
 */
export async function readSearchConfig(
  deps: SearchConfigDeps
): Promise<SearchConfigPublic> {
  const [defaultEngineRaw, baseUrlRaw, ...keySet] = await Promise.all([
    kkvGet(deps.kkv, KEY_DEFAULT_ENGINE),
    kkvGet(deps.kkv, KEY_SEARXNG_BASE_URL),
    ...KEY_ENGINE_IDS.map((engineId) =>
      deps.secretStore.has(searchApiKeyRef(engineId))
    ),
  ]);
  const searxngBaseUrl = baseUrlRaw ?? "";
  return {
    defaultEngine: normalizeDefaultEngine(defaultEngineRaw),
    searxngBaseUrl,
    engines: {
      bocha: { configured: keySet[0] === true },
      tavily: { configured: keySet[1] === true },
      brave: { configured: keySet[2] === true },
      searxng: { configured: searxngBaseUrl.trim().length > 0 },
    },
  };
}

/**
 * 解析本次调用实际使用的引擎（解析链：`inputEngine` → `defaultEngine`
 * → `ENGINE_IDS` 顺序第一个 `configured` 引擎；候选未配置则顺位回落，
 * 全无 → null）。key 引擎命中时现读明文；searxng 命中时规范化 baseUrl
 * （存库值非法的防御路径视同未配置，顺位继续）。
 */
export async function resolveEngine(
  deps: SearchConfigDeps,
  inputEngine?: EngineId
): Promise<ResolvedEngineConfig | null> {
  const config = await readSearchConfig(deps);
  const candidates: EngineId[] = [];
  if (inputEngine != null) candidates.push(inputEngine);
  if (
    config.defaultEngine != null &&
    !candidates.includes(config.defaultEngine)
  ) {
    candidates.push(config.defaultEngine);
  }
  for (const engineId of ENGINE_IDS) {
    if (
      config.engines[engineId].configured &&
      !candidates.includes(engineId)
    ) {
      candidates.push(engineId);
    }
  }
  const pick = candidates.find(
    (engineId) => config.engines[engineId].configured
  );
  if (pick == null) return null;

  if (pick === "searxng") {
    const baseUrl = normalizeSearxngBaseUrl(config.searxngBaseUrl);
    if (baseUrl == null) return null;
    return { engine: "searxng", baseUrl };
  }
  // has 之后被并发清除的竞态兜底：get 不到明文视同未配置。
  const apiKey = await deps.secretStore.get(searchApiKeyRef(pick));
  if (apiKey == null || apiKey.length === 0) return null;
  return { engine: pick, apiKey };
}

/**
 * 搜索配置存储（desktop / mobile runtime 用 core 导出的本工厂包
 * `kkv + secretStore` 装配；CLI 无 kkv 不装配——search 恒返回未配置
 * 提示，known limitation 见 SPEC）。
 */
export interface SearchConfigStore {
  /** 读取对外配置（不含 key 明文）。 */
  readConfig(): Promise<SearchConfigPublic>;
  /** 读取单引擎配置状态。 */
  loadEngineConfig(engineId: EngineId): Promise<SearchEngineStatus>;
  /** 解析引擎（链语义同 {@link resolveEngine}）。 */
  resolveEngine(inputEngine?: EngineId): Promise<ResolvedEngineConfig | null>;
  /** 保存引擎 API key（明文只经 SKSP set；空串拒绝）。 */
  saveEngineKey(engineId: KeyEngineId, apiKey: string): Promise<void>;
  /** 清除引擎 API key。 */
  clearEngineKey(engineId: KeyEngineId): Promise<void>;
  /**
   * 保存 searxng baseUrl：空串 = 清除；非空则规范化（非法抛错）。
   */
  setSearxngBaseUrl(baseUrl: string): Promise<void>;
  /** 设置默认引擎；null = 清除。 */
  setDefaultEngine(engineId: EngineId | null): Promise<void>;
}

/**
 * 构造搜索配置存储：绑定 kkv + secretStore 的薄封装，全部逻辑走本模块
 * 纯函数（工厂只做依赖闭包，便于双端装配与单测复用同一实现）。
 */
export function createSearchConfigStore(
  deps: SearchConfigDeps
): SearchConfigStore {
  const { kkv, secretStore } = deps;
  return {
    async readConfig() {
      return readSearchConfig(deps);
    },
    async loadEngineConfig(engineId) {
      const config = await readSearchConfig(deps);
      return config.engines[engineId];
    },
    resolveEngine(inputEngine) {
      return resolveEngine(deps, inputEngine);
    },
    async saveEngineKey(engineId, apiKey) {
      const trimmed = apiKey.trim();
      if (trimmed.length === 0) {
        throw new Error("API key 不能为空");
      }
      await secretStore.set(searchApiKeyRef(engineId), trimmed);
    },
    async clearEngineKey(engineId) {
      await secretStore.delete(searchApiKeyRef(engineId));
    },
    async setSearxngBaseUrl(baseUrl) {
      const trimmed = baseUrl.trim();
      if (trimmed.length === 0) {
        await kkvDelete(kkv, KEY_SEARXNG_BASE_URL);
        return;
      }
      const normalized = normalizeSearxngBaseUrl(trimmed);
      if (normalized == null) {
        throw new Error(
          "searxng baseUrl 无效：仅支持 http/https，且不允许携带用户名密码"
        );
      }
      await kkv.set(SEARCH_KKV_MODULE, KEY_SEARXNG_BASE_URL, normalized);
    },
    async setDefaultEngine(engineId) {
      if (engineId == null) {
        await kkvDelete(kkv, KEY_DEFAULT_ENGINE);
        return;
      }
      if (!(ENGINE_IDS as readonly string[]).includes(engineId)) {
        throw new Error(`未知搜索引擎: ${engineId}`);
      }
      await kkv.set(SEARCH_KKV_MODULE, KEY_DEFAULT_ENGINE, engineId);
    },
  };
}
