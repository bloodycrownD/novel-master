/**
 * 搜索引擎配置存储（core 纯逻辑，入参 SecretStore + KkvService）：
 * key 明文经 SKSP 存储于 `search/{engineId}/apiKey` ref，引擎元数据
 * （引擎优先级顺序 engineOrder、searxng baseUrl）存 KKV 模块
 * `nm-search`——形态照云同步先例（`cloud-sync/s3-secret-key` ref +
 * `nm-cloud-sync` 模块）。
 *
 * 凭证安全口径：对外类型只用 `configured: boolean`（不暴露 keySet /
 * key 明文）；明文 key 仅在 {@link resolveEngineChain} 内经
 * `secretStore.get` 现读并随 `ResolvedEngineConfig` 注入适配器，不落
 * KKV / 日志 / 任何返回值。
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

/** KKV 键：引擎优先级顺序（EngineId JSON 数组，顺序即串行降级链）。 */
export const KEY_ENGINE_ORDER = "engineOrder";

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
  /** 引擎优先级顺序（串行链优先级；容错归一后恒为 ENGINE_IDS 的全排列）。 */
  readonly engineOrder: readonly EngineId[];
  /** searxng 实例 baseUrl（规范化后；未配置为空串）。 */
  readonly searxngBaseUrl: string;
  /** 五引擎的配置状态（searxng 的 configured = baseUrl 非空、duckduckgo 恒 true，均不查 secretStore）。 */
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

/**
 * engineOrder 存量值容错归一：非 JSON / 非数组 / 含非法项 / 有重复时，
 * 合法前缀保留、缺项按 `ENGINE_IDS` 默认序补齐去重——归一结果恒为
 * ENGINE_IDS 的全排列（UI 排序菜单与串行链都拿得到稳定顺序，损坏值
 * 不致解析链断裂；存量四引擎 order 归一后 duckduckgo 自然补尾）。
 */
function normalizeEngineOrder(raw: string | undefined): EngineId[] {
  const order: EngineId[] = [];
  if (raw != null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            typeof item === "string" &&
            (ENGINE_IDS as readonly string[]).includes(item) &&
            !order.includes(item as EngineId)
          ) {
            order.push(item as EngineId);
          }
        }
      }
    } catch {
      // 非 JSON / 损坏值：丢弃存量值，走默认序补齐。
    }
  }
  for (const engineId of ENGINE_IDS) {
    if (!order.includes(engineId)) order.push(engineId);
  }
  return order;
}

/**
 * 读取对外配置：并行 `kkv.get` × 2 + `secretStore.has` × 3（仅 key 引擎）；
 * searxng 的 `configured` 只看 baseUrl 是否非空，duckduckgo 恒 true，
 * 均不触碰 secretStore。
 */
export async function readSearchConfig(
  deps: SearchConfigDeps
): Promise<SearchConfigPublic> {
  const [engineOrderRaw, baseUrlRaw, ...keySet] = await Promise.all([
    kkvGet(deps.kkv, KEY_ENGINE_ORDER),
    kkvGet(deps.kkv, KEY_SEARXNG_BASE_URL),
    ...KEY_ENGINE_IDS.map((engineId) =>
      deps.secretStore.has(searchApiKeyRef(engineId))
    ),
  ]);
  const searxngBaseUrl = baseUrlRaw ?? "";
  return {
    engineOrder: normalizeEngineOrder(engineOrderRaw),
    searxngBaseUrl,
    engines: {
      bocha: { configured: keySet[0] === true },
      tavily: { configured: keySet[1] === true },
      brave: { configured: keySet[2] === true },
      searxng: { configured: searxngBaseUrl.trim().length > 0 },
      // duckduckgo 内置免费兑底：无 key 无 baseUrl，恒 configured（无存储依赖）。
      duckduckgo: { configured: true },
    },
  };
}

/**
 * 解析串行引擎链：按 `engineOrder` 顺序返回全部已配置引擎的候选数组
 * （优先级即降级链；duckduckgo 恒 configured 队尾兑底，链常规非空）；
 * 显式 `inputEngine` 时从该引擎起截取（位于其前
 * 的引擎不参与，未配置则顺位回落到截取链中下一个 configured）。候选
 * 凭据随项注入（key 引擎现读明文；`has` 之后被并发清除的竞态兜底：
 * get 不到明文视作未配置跳过；searxng 存库 baseUrl 损坏同样跳过），
 * 全无 → 空数组（仅防御路径可达：DDG 恒在链，工具常规不会回落未配置提示）。
 */
export async function resolveEngineChain(
  deps: SearchConfigDeps,
  inputEngine?: EngineId
): Promise<ResolvedEngineConfig[]> {
  const config = await readSearchConfig(deps);
  let order: readonly EngineId[] = config.engineOrder;
  if (inputEngine != null) {
    const index = order.indexOf(inputEngine);
    // 归一后 engineOrder 必含全部引擎，index < 0 仅在入参绕过 zod 校验时出现；
    // 防御性只保留该引擎（不静默丢弃显式指定，交给 configured 过滤判定）。
    order = index >= 0 ? order.slice(index) : [inputEngine];
  }
  const chain: ResolvedEngineConfig[] = [];
  for (const engineId of order) {
    if (!config.engines[engineId].configured) continue;
    if (engineId === "searxng") {
      const baseUrl = normalizeSearxngBaseUrl(config.searxngBaseUrl);
      if (baseUrl == null) continue;
      chain.push({ engine: "searxng", baseUrl });
      continue;
    }
    // duckduckgo 内置兑底：无凭据依赖，直接入链（PRD R1.2：未配置任何
    // key/baseUrl 时链 = [duckduckgo]，搜索开箱即用）。
    if (engineId === "duckduckgo") {
      chain.push({ engine: "duckduckgo" });
      continue;
    }
    const apiKey = await deps.secretStore.get(searchApiKeyRef(engineId));
    if (apiKey == null || apiKey.length === 0) continue;
    chain.push({ engine: engineId, apiKey });
  }
  return chain;
}

/**
 * 搜索配置存储（desktop / mobile runtime 用 core 导出的本工厂包
 * `kkv + secretStore` 装配；CLI 无 kkv 不装配——search 恒返回未配置
 * 提示，known limitation 见 SPEC）。
 */
export interface SearchConfigStore {
  /** 读取对外配置（不含 key 明文）。 */
  readConfig(): Promise<SearchConfigPublic>;
  /** 解析串行引擎链（链语义同 {@link resolveEngineChain}）。 */
  resolveEngineChain(
    inputEngine?: EngineId
  ): Promise<ResolvedEngineConfig[]>;
  /** 保存引擎 API key（明文只经 SKSP set；空串拒绝）。 */
  saveEngineKey(engineId: KeyEngineId, apiKey: string): Promise<void>;
  /** 清除引擎 API key。 */
  clearEngineKey(engineId: KeyEngineId): Promise<void>;
  /**
   * 保存 searxng baseUrl：空串 = 清除；非空则规范化（非法抛错）。
   */
  setSearxngBaseUrl(baseUrl: string): Promise<void>;
  /** 保存引擎优先级顺序（须为 ENGINE_IDS 的合法排列，非法抛错）。 */
  setEngineOrder(order: readonly EngineId[]): Promise<void>;
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
    resolveEngineChain(inputEngine) {
      return resolveEngineChain(deps, inputEngine);
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
    async setEngineOrder(order) {
      const seen = new Set<string>();
      for (const item of order) {
        if (
          !(ENGINE_IDS as readonly string[]).includes(item) ||
          seen.has(item)
        ) {
          throw new Error(
            `engineOrder 必须是五引擎的合法排列（不重复、不缺项），收到: ${JSON.stringify(order)}`
          );
        }
        seen.add(item);
      }
      if (seen.size !== ENGINE_IDS.length) {
        throw new Error(
          `engineOrder 必须是五引擎的合法排列（不重复、不缺项），收到: ${JSON.stringify(order)}`
        );
      }
      await kkv.set(
        SEARCH_KKV_MODULE,
        KEY_ENGINE_ORDER,
        JSON.stringify(order)
      );
    },
  };
}
