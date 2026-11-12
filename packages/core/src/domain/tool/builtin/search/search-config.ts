/**
 * 搜索引擎配置存储（core 纯逻辑，入参 SecretStore + KkvService）：key 明文经
 * SKSP 存储于 `search/{engineId}/apiKey` ref，其余配置（启用开关 / 排序 / 自定义
 * 实例 / 预置覆盖 / 实例地址）存 KKV 模块 `nm-search`——形态照云同步先例。
 *
 * 存储布局（SPEC web-search-curl §5，全部新键；旧 `engineOrder` /
 * `searxngBaseUrl` 读路径已删除，存量丢弃）：
 * - `enabledEngines`：启用的实例 id，缺省 `["duckduckgo"]`；
 * - `engineOrderV2`：全部已知 id 的排序，缺省六预置 + DDG 出厂序（DDG 队尾）；
 * - `customEngines`：自定义实例定义（模板只含占位符，明文 key / baseUrl 另存）；
 * - `presetOverrides`：预置模板覆盖副本（恢复默认 = 删除该键下条目）；
 * - `engineBaseUrls`：模板引用 `{{baseUrl}}` 的实例地址（当前仅 searxng 出厂用）。
 *
 * 动态已知全集 = 六预置 id ∪ {duckduckgo} ∪ customEngines 现存 id：顺序归一、
 * 开关归一、显式 engine 已知性判定、模板查找全部以它为准。读路径容错归一
 * （未知 id 丢弃、缺失项补尾），写路径校验失败即 throw `AppError` + i18n key
 * （store 是保存路径的错误边界，内部校验函数返回 Result）。
 *
 * @module domain/tool/builtin/search/search-config
 */

import { isRecord } from "@/common/guards.js";
import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import { createLogger } from "@/infra/log/logger.js";
import { searchWithDuckduckgo } from "./engines/duckduckgo.js";
import { runTemplateEngine } from "./engines/template-engine.js";
import { findPlaintextSecrets } from "./curl-import.js";
import { DUCKDUCKGO_ENGINE_META, PRESET_ENGINE_TEMPLATES } from "./preset-templates.js";
import { normalizeMaxResults, redactSecret, validateSearchEngineTemplate, type CustomEngineDef, type ResolvedEngineConfig, type SearchEngineTemplate, type SearchResult } from "./types.js";

/** KKV 模块名（照 nm-cloud-sync 命名先例）。 */
export const SEARCH_KKV_MODULE = "nm-search";

/** 搜索配置域 logger（装配期快照降级与 testEngine 失败各记一条，SPEC §4）。 */
const log = createLogger("tool.search");

/** KKV 键：启用的引擎实例 id。 */
export const KEY_ENABLED_ENGINES = "enabledEngines";

/** KKV 键：全部已知引擎 id 的排序（顺序即串行降级链）。 */
export const KEY_ENGINE_ORDER_V2 = "engineOrderV2";

/** KKV 键：自定义引擎实例定义列表。 */
export const KEY_CUSTOM_ENGINES = "customEngines";

/** KKV 键：预置模板覆盖副本（按预置 id 索引）。 */
export const KEY_PRESET_OVERRIDES = "presetOverrides";

/** KKV 键：引擎实例地址（按引擎 id 索引；当前仅 searxng 出厂模板引用）。 */
export const KEY_ENGINE_BASE_URLS = "engineBaseUrls";

/** DDG 内置代码引擎 id。 */
const DUCKDUCKGO_ENGINE_ID = "duckduckgo";

/** 出厂预置 id 列表（对象声明序即出厂序）。 */
const PRESET_ENGINE_IDS: readonly string[] = Object.keys(PRESET_ENGINE_TEMPLATES);

/** 出厂预置模板表（只读索引视图，免去逐处字面量断言）。 */
const PRESET_TEMPLATES: Readonly<Record<string, SearchEngineTemplate>> = PRESET_ENGINE_TEMPLATES;

/** 出厂缺省排序：六预置 + DDG 队尾。 */
const DEFAULT_ENGINE_ORDER: readonly string[] = [...PRESET_ENGINE_IDS, DUCKDUCKGO_ENGINE_ID];

/** 出厂缺省启用集：仅 DDG（开箱即用，PRD R1.2）。 */
const DEFAULT_ENABLED_ENGINES: readonly string[] = [DUCKDUCKGO_ENGINE_ID];

/** 自定义实例 id 形态：`custom:{nanoid8}`（进 SKSP ref，禁斜杠）。 */
const CUSTOM_ENGINE_ID_PATTERN = /^custom:[A-Za-z0-9_-]{1,64}$/;

/** 自定义实例 id 前缀。 */
const CUSTOM_ENGINE_PREFIX = "custom:";

/** SKSP ref：引擎 API key（预置与自定义统一通道；自定义实例 ref 含 `custom:` 前缀）。 */
export function searchApiKeyRef(engineId: string): string {
  return `search/${engineId}/apiKey`;
}

/** 对外公开的搜索配置（DTO 不含 key 明文，双端 UI / IPC / 描述快照共用）。 */
export interface SearchConfigPublic {
  /** 全部已知引擎，按 engineOrderV2 归一后顺序（含 DDG、预置与自定义实例）。 */
  readonly engines: readonly {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly needsKey: boolean;
    readonly hasKey: boolean;
    readonly needsBaseUrl: boolean;
    readonly baseUrl?: string;
    readonly isCustom: boolean;
    /** 参数说明（合并 presetOverrides 后的生效模板；DDG 取展示常量）——描述快照逐引擎段用。 */
    readonly paramHint: string;
  }[];
  /** 自定义实例定义（模板只含占位符）。 */
  readonly customEngines: readonly CustomEngineDef[];
  /** 预置模板覆盖状态回显（恢复默认按钮可见性；键 = 预置 id）。 */
  readonly presetOverrides: Readonly<Record<string, boolean>>;
  /** enabled ∩ 配置完整（= 串行链成员），按 engineOrderV2 序。 */
  readonly canRun: readonly string[];
}

/** 配置读写依赖（调用方注入实例；纯函数便于单测 mock）。 */
export interface SearchConfigDeps {
  readonly kkv: KkvService;
  readonly secretStore: SecretStore;
}

/** 新建自定义引擎入参：`def` 由调用方生成（id 形如 `custom:{nanoid8}`），apiKey/baseUrl 拆分落库。 */
export interface CreateCustomEngineInput {
  readonly def: CustomEngineDef;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** 更新自定义引擎入参：apiKey/baseUrl 缺省保留、空串清除、非空覆盖。 */
export interface UpdateCustomEngineInput {
  readonly name?: string;
  readonly template?: SearchEngineTemplate;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** 草稿直测入参（不落库；占位符取值优先级 draft > KKV 现存值 > 空）。 */
export interface TestEngineDraft {
  readonly template: SearchEngineTemplate;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** 测试搜索入参：draft 优先于 engineId；DDG 仅支持 engineId 模式。 */
export interface TestEngineInput {
  readonly engineId?: string;
  readonly draft?: TestEngineDraft;
  readonly query: string;
  readonly maxResults?: number;
}

/** 测试搜索成功载荷（前 5 条样例，供配置页展示）。 */
export interface TestEngineSuccess {
  readonly resultCount: number;
  readonly sample: readonly SearchResult[];
}

/** 测试搜索失败载荷（descriptor 由宿主 translator 译后展示）。 */
export interface TestEngineFailure {
  readonly message: CoreMessageDescriptor;
}

/** 一次读取归一后的存储状态（读模型与链解析共用，避免两份归一逻辑）。 */
interface SearchEngineState {
  readonly order: readonly string[];
  readonly enabled: readonly string[];
  readonly customEngines: readonly CustomEngineDef[];
  readonly presetOverrides: Readonly<Record<string, Partial<SearchEngineTemplate>>>;
  readonly baseUrls: Readonly<Record<string, string>>;
}

/**
 * 引擎实例地址规范化（原 normalizeSearxngBaseUrl 泛化）：仅 http/https、
 * 禁 userinfo、剥 path 尾部斜杠与 search/hash；非法返回 null。
 */
export function normalizeEngineBaseUrl(value: string): string | null {
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
async function kkvGet(kkv: KkvService, key: string): Promise<string | undefined> {
  try {
    return await kkv.get(SEARCH_KKV_MODULE, key);
  } catch (error) {
    if (isAppError(error, "KKV_NOT_FOUND")) return undefined;
    throw error;
  }
}

/** KKV 删除：NOT_FOUND 忽略（幂等清除）。 */
async function kkvDelete(kkv: KkvService, key: string): Promise<void> {
  try {
    await kkv.delete(SEARCH_KKV_MODULE, key);
  } catch (error) {
    if (isAppError(error, "KKV_NOT_FOUND")) return;
    throw error;
  }
}

/** JSON 解析（损坏值归一为 undefined；调用方按缺省语义处理）。 */
function parseJson(raw: string | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** 读取并归一全部存储状态（5 次 KKV 并行读；容错归一集中于此，读模型与链解析共用）。 */
async function readEngineState(kkv: KkvService): Promise<SearchEngineState> {
  const [orderRaw, enabledRaw, customRaw, overridesRaw, baseUrlsRaw] = await Promise.all([kkvGet(kkv, KEY_ENGINE_ORDER_V2), kkvGet(kkv, KEY_ENABLED_ENGINES), kkvGet(kkv, KEY_CUSTOM_ENGINES), kkvGet(kkv, KEY_PRESET_OVERRIDES), kkvGet(kkv, KEY_ENGINE_BASE_URLS)]);

  // 自定义实例：模板走保存路径同一校验，非法条目跳过；id 必须带 custom: 前缀（防与预置 / DDG 撞名）。
  const parsedCustom = parseJson(customRaw);
  const customEngines: CustomEngineDef[] = [];
  if (Array.isArray(parsedCustom)) {
    for (const item of parsedCustom) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.startsWith(CUSTOM_ENGINE_PREFIX)) continue;
      if (customEngines.some((def) => def.id === item.id)) continue;
      const template = validateSearchEngineTemplate(item.template);
      if (!template.ok) continue;
      const name = typeof item.name === "string" && item.name.trim().length > 0 ? item.name.trim() : template.value.name;
      customEngines.push({ id: item.id, name, template: template.value, createdAt: typeof item.createdAt === "string" ? item.createdAt : "" });
    }
  }
  const knownIds = new Set<string>([...PRESET_ENGINE_IDS, DUCKDUCKGO_ENGINE_ID, ...customEngines.map((def) => def.id)]);

  // engineOrderV2：未知项丢弃、已知项保序去重、缺失项按出厂序补尾（自定义实例按存储序补尾），损坏值回出厂序。
  const order: string[] = [];
  const parsedOrder = parseJson(orderRaw);
  if (Array.isArray(parsedOrder)) {
    for (const item of parsedOrder) {
      if (typeof item === "string" && knownIds.has(item) && !order.includes(item)) order.push(item);
    }
  }
  for (const engineId of DEFAULT_ENGINE_ORDER) {
    if (knownIds.has(engineId) && !order.includes(engineId)) order.push(engineId);
  }
  for (const engineId of knownIds) {
    if (!order.includes(engineId)) order.push(engineId);
  }

  // enabledEngines：dangling id 丢弃；键缺失 / 损坏回缺省（仅 DDG 启用）。
  const parsedEnabled = parseJson(enabledRaw);
  const enabled: string[] = [];
  if (!Array.isArray(parsedEnabled)) enabled.push(...DEFAULT_ENABLED_ENGINES);
  else {
    for (const item of parsedEnabled) {
      if (typeof item === "string" && knownIds.has(item) && !enabled.includes(item)) enabled.push(item);
    }
  }

  // presetOverrides：只认预置 id 的对象值（写入路径已校验，读路径不做二次校验）。
  const parsedOverrides = parseJson(overridesRaw);
  const presetOverrides: Record<string, Partial<SearchEngineTemplate>> = {};
  if (isRecord(parsedOverrides)) {
    for (const engineId of PRESET_ENGINE_IDS) {
      const value = parsedOverrides[engineId];
      if (isRecord(value)) presetOverrides[engineId] = value as Partial<SearchEngineTemplate>;
    }
  }

  // engineBaseUrls：逐值 normalizeEngineBaseUrl，非法值丢弃（canRun 与 resolveEngineChain 同源判定，脏数据不判可跑）。
  const parsedBaseUrls = parseJson(baseUrlsRaw);
  const baseUrls: Record<string, string> = {};
  if (isRecord(parsedBaseUrls)) {
    for (const [engineId, value] of Object.entries(parsedBaseUrls)) {
      if (typeof value !== "string") continue;
      const normalized = normalizeEngineBaseUrl(value);
      if (normalized != null) baseUrls[engineId] = normalized;
    }
  }

  return { order, enabled, customEngines, presetOverrides, baseUrls };
}

/** 引擎模板唯一查表点（预置 ∪ presetOverrides 浅合并 ∪ customEngines；DDG 无模板返回 undefined）。 */
function effectiveTemplate(state: SearchEngineState, engineId: string): SearchEngineTemplate | undefined {
  if (engineId === DUCKDUCKGO_ENGINE_ID) return undefined;
  if (PRESET_ENGINE_IDS.includes(engineId)) {
    const preset = PRESET_TEMPLATES[engineId];
    if (preset == null) return undefined;
    const override = state.presetOverrides[engineId];
    return override == null ? preset : { ...preset, ...override };
  }
  return state.customEngines.find((def) => def.id === engineId)?.template;
}

/** 模板是否引用某占位符（url / headers 值 / bodyTemplate 任一命中即需要该取值）。 */
function templateReferences(template: SearchEngineTemplate, placeholder: "apiKey" | "baseUrl"): boolean {
  const token = `{{${placeholder}}}`;
  if (template.url.includes(token)) return true;
  if (Object.values(template.headers).some((value) => value.includes(token))) return true;
  return template.bodyTemplate?.includes(token) === true;
}

/**
 * 读取对外配置：5 次 KKV 并行读 + 需 key 引擎的 secretStore.has。
 * `engines` 按归一后顺序含 DDG / 预置 / 自定义实例；`canRun` 与串行链同源
 * （enabled ∩ 配置完整），UI 列表与描述快照共用该读模型。
 *
 * nm-style: keep-public — spec §5 新读模型 + §7 装配期快照的唯一读取入口（index 再导出）。
 */
export async function readSearchConfig(deps: SearchConfigDeps): Promise<SearchConfigPublic> {
  const state = await readEngineState(deps.kkv);
  const keyRefs = new Map<string, string>();
  for (const engineId of state.order) {
    const template = effectiveTemplate(state, engineId);
    if (template != null && templateReferences(template, "apiKey")) keyRefs.set(engineId, searchApiKeyRef(engineId));
  }
  const hasKeyResults = await Promise.all([...keyRefs].map(async ([engineId, ref]) => ({ engineId, hasKey: await deps.secretStore.has(ref) })));
  const hasKeys = new Set(hasKeyResults.filter((entry) => entry.hasKey).map((entry) => entry.engineId));
  const engines = state.order.map((engineId) => {
    const template = effectiveTemplate(state, engineId);
    const needsKey = template != null && templateReferences(template, "apiKey");
    const needsBaseUrl = template != null && templateReferences(template, "baseUrl");
    const baseUrl = state.baseUrls[engineId];
    const customName = state.customEngines.find((def) => def.id === engineId)?.name;
    const name = engineId === DUCKDUCKGO_ENGINE_ID ? DUCKDUCKGO_ENGINE_META.name : customName ?? template?.name ?? engineId;
    const paramHint = engineId === DUCKDUCKGO_ENGINE_ID ? DUCKDUCKGO_ENGINE_META.paramHint : template?.paramHint ?? "";
    return { id: engineId, name, enabled: state.enabled.includes(engineId), needsKey, hasKey: hasKeys.has(engineId), needsBaseUrl, ...(baseUrl == null ? {} : { baseUrl }), isCustom: engineId.startsWith(CUSTOM_ENGINE_PREFIX), paramHint };
  });
  const canRun = engines.filter((engine) => engine.enabled && (!engine.needsKey || engine.hasKey) && (!engine.needsBaseUrl || engine.baseUrl != null)).map((engine) => engine.id);
  const presetOverrides: Record<string, boolean> = {};
  for (const engineId of PRESET_ENGINE_IDS) if (state.presetOverrides[engineId] != null) presetOverrides[engineId] = true;
  return { engines, customEngines: state.customEngines, presetOverrides, canRun };
}

/**
 * 解析串行引擎链：order → 过滤 enabledEngines ∩ 配置完整（模板就绪 + 占位符判据的
 * key / baseUrl 就绪）→ 显式 engine 三分支。
 *
 * 显式 `inputEngine`：① 已知且通过过滤 → 钉为该引擎单发（失败不降级）；
 * ② 已知但未通过（关闭 / 未配置）→ 沿 order 从该 id 起截尾，取截尾后第一个
 * 通过过滤的引擎（保留顺位回落语义，链空则返回空数组；pinned 已试探过的引擎
 * 记 `pinnedTried` 跳过，不重复读 SKSP）；③ 不在动态全集 →
 * throw `AppError`（key `error.tool.search_engine_not_found`，search-tool 边界
 * 照常映射为工具失败）。DDG 只有 enabled 才入链，不再恒在链尾。
 *
 * nm-style: keep-public — spec §5 链解析单一入口（store 方法 + §7 快照同源 + 测试直连）。
 */
export async function resolveEngineChain(deps: SearchConfigDeps, inputEngine?: string): Promise<ResolvedEngineConfig[]> {
  const state = await readEngineState(deps.kkv);
  const resolveOne = async (engineId: string): Promise<ResolvedEngineConfig | null> => {
    if (engineId === DUCKDUCKGO_ENGINE_ID) return { engine: engineId };
    const template = effectiveTemplate(state, engineId);
    if (template == null) return null;
    let apiKey: string | undefined;
    if (templateReferences(template, "apiKey")) {
      const stored = await deps.secretStore.get(searchApiKeyRef(engineId));
      if (stored == null || stored.length === 0) return null;
      apiKey = stored;
    }
    let baseUrl: string | undefined;
    if (templateReferences(template, "baseUrl")) {
      const stored = state.baseUrls[engineId];
      const normalized = stored == null ? null : normalizeEngineBaseUrl(stored);
      if (normalized == null) return null;
      baseUrl = normalized;
    }
    return { engine: engineId, ...(apiKey == null ? {} : { apiKey }), ...(baseUrl == null ? {} : { baseUrl }), template };
  };

  if (inputEngine != null) {
    if (!state.order.includes(inputEngine)) throw engineNotFound(inputEngine);
    let pinnedTried = false;
    if (state.enabled.includes(inputEngine)) {
      pinnedTried = true;
      const pinned = await resolveOne(inputEngine);
      if (pinned != null) return [pinned];
    }
    const startIndex = state.order.indexOf(inputEngine);
    for (const engineId of state.order.slice(startIndex)) {
      if (!state.enabled.includes(engineId)) continue;
      if (engineId === inputEngine && pinnedTried) continue;
      const resolved = await resolveOne(engineId);
      if (resolved != null) return [resolved];
    }
    return [];
  }

  const chain: ResolvedEngineConfig[] = [];
  for (const engineId of state.order) {
    if (!state.enabled.includes(engineId)) continue;
    const resolved = await resolveOne(engineId);
    if (resolved != null) chain.push(resolved);
  }
  return chain;
}

/**
 * 保存路径模板校验：结构 + 明文密钥检测复用 validateSearchEngineTemplate（create /
 * updateCustomEngine / updatePresetOverride 三入口共用）；paramHint 流入 agent 可见
 * 工具描述，另过 findPlaintextSecrets（拍板 4，name 不扫）；失败 throw。
 */
function validateTemplateForSave(raw: unknown): SearchEngineTemplate {
  const validated = validateSearchEngineTemplate(raw);
  if (!validated.ok) throw validated.error;
  if (findPlaintextSecrets(validated.value.paramHint).length > 0) throw new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_secret_detected", params: { field: "paramHint" } });
  return validated.value;
}

/** 实例地址写入值归一（非空时校验；非法 throw `error.tool.search_searxng_base_url_invalid`）。 */
function normalizeBaseUrlForSave(baseUrl: string): string {
  const normalized = normalizeEngineBaseUrl(baseUrl);
  if (normalized == null) throw new AppError("TOOL_SEARCH_INVALID_ARGUMENT", { key: "error.tool.search_searxng_base_url_invalid" });
  return normalized;
}

/** 引擎未知的统一写路径错误（key `error.tool.search_engine_not_found`）。 */
function engineNotFound(engineId: string): AppError<"TOOL_SEARCH_INVALID_ARGUMENT"> {
  return new AppError("TOOL_SEARCH_INVALID_ARGUMENT", { key: "error.tool.search_engine_not_found", params: { engine: engineId } });
}

/**
 * 搜索配置存储（desktop / mobile runtime 用 core 导出的本工厂包
 * `kkv + secretStore` 装配；CLI 无 kkv 不装配）。写方法即错误边界：
 * 校验失败 throw `AppError` + i18n key；`testEngine` 按 spec 返回 Result。
 */
export interface SearchConfigStore {
  /** 读取对外配置（不含 key 明文）。 */
  readConfig(): Promise<SearchConfigPublic>;
  /** 解析串行引擎链（语义同 {@link resolveEngineChain}）。 */
  resolveEngineChain(inputEngine?: string): Promise<ResolvedEngineConfig[]>;
  /** 保存引擎 API key（预置与自定义统一通道；未知 engineId / 空串拒绝，防 dangling SKSP ref）。 */
  saveEngineKey(engineId: string, apiKey: string): Promise<void>;
  /** 清除引擎 API key（未知 engineId 拒绝）。 */
  clearEngineKey(engineId: string): Promise<void>;
  /** 保存引擎顺序：动态已知 id 的不重复序列（未知 id 拒绝、缺项容忍，读侧归一补齐）。 */
  setEngineOrder(order: readonly string[]): Promise<void>;
  /** 开关引擎（只动 enabledEngines；未知 id 拒绝）。 */
  setEnabled(engineId: string, on: boolean): Promise<void>;
  /** 保存实例地址：空串清除；非空规范化（非法 throw），服务 `{{baseUrl}}` 模板。 */
  setEngineBaseUrl(engineId: string, baseUrl: string): Promise<void>;
  /** 新建自定义引擎：校验模板 + 明文检测 + append engineOrderV2 + key/baseUrl 拆分落库。 */
  createCustomEngine(input: CreateCustomEngineInput): Promise<void>;
  /** 更新自定义引擎：模板重校验；apiKey/baseUrl 缺省保留、空串清除、非空覆盖。 */
  updateCustomEngine(engineId: string, input: UpdateCustomEngineInput): Promise<void>;
  /** 删除自定义引擎：从 customEngines / engineOrderV2 / enabledEngines / engineBaseUrls prune 并清 SKSP ref。 */
  deleteCustomEngine(engineId: string): Promise<void>;
  /** 写入预置模板覆盖（浅合并、嵌套对象整体替换；保存前校验 + 明文检测）。 */
  updatePresetOverride(engineId: string, patch: Partial<SearchEngineTemplate>): Promise<void>;
  /** 恢复预置模板默认（删除覆盖条目）。 */
  resetPresetOverride(engineId: string): Promise<void>;
  /** 草稿直测 / 已存实例测试（KKV / SKSP 零写入；失败返回脱敏 descriptor）。 */
  testEngine(input: TestEngineInput): Promise<Result<TestEngineSuccess, TestEngineFailure>>;
}

/** 构造搜索配置存储：绑定 kkv + secretStore，读归一与链解析复用模块纯函数。 */
export function createSearchConfigStore(deps: SearchConfigDeps): SearchConfigStore {
  const { kkv, secretStore } = deps;
  const testFailure = (reason: string | CoreMessageDescriptor): Result<TestEngineSuccess, TestEngineFailure> => {
    log.debug("搜索测试失败", { reason });
    return Result.err({ message: { key: "error.tool.search_test_failed", params: { reason } } });
  };
  const writeBaseUrls = async (baseUrls: Readonly<Record<string, string>>): Promise<void> => {
    if (Object.keys(baseUrls).length === 0) await kkvDelete(kkv, KEY_ENGINE_BASE_URLS);
    else await kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_BASE_URLS, JSON.stringify(baseUrls));
  };
  return {
    readConfig() {
      return readSearchConfig(deps);
    },
    resolveEngineChain(inputEngine) {
      return resolveEngineChain(deps, inputEngine);
    },
    async saveEngineKey(engineId, apiKey) {
      const state = await readEngineState(kkv);
      if (!state.order.includes(engineId)) throw engineNotFound(engineId);
      const trimmed = apiKey.trim();
      if (trimmed.length === 0) throw new AppError("TOOL_SEARCH_INVALID_ARGUMENT", { key: "error.tool.search_api_key_required" });
      await secretStore.set(searchApiKeyRef(engineId), trimmed);
    },
    async clearEngineKey(engineId) {
      const state = await readEngineState(kkv);
      if (!state.order.includes(engineId)) throw engineNotFound(engineId);
      await secretStore.delete(searchApiKeyRef(engineId));
    },
    async setEngineOrder(order) {
      const state = await readEngineState(kkv);
      const knownIds = new Set(state.order);
      const seen = new Set<string>();
      for (const engineId of order) {
        if (!knownIds.has(engineId) || seen.has(engineId)) throw new AppError("TOOL_SEARCH_INVALID_ARGUMENT", { key: "error.tool.search_engine_order_invalid", params: { order: JSON.stringify(order) } });
        seen.add(engineId);
      }
      await kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, JSON.stringify(order));
    },
    async setEnabled(engineId, on) {
      const state = await readEngineState(kkv);
      if (!state.order.includes(engineId)) throw engineNotFound(engineId);
      const enabled = on ? (state.enabled.includes(engineId) ? state.enabled : [...state.enabled, engineId]) : state.enabled.filter((id) => id !== engineId);
      await kkv.set(SEARCH_KKV_MODULE, KEY_ENABLED_ENGINES, JSON.stringify(enabled));
    },
    async setEngineBaseUrl(engineId, baseUrl) {
      const state = await readEngineState(kkv);
      if (!state.order.includes(engineId)) throw engineNotFound(engineId);
      const baseUrls = { ...state.baseUrls };
      if (baseUrl.trim().length === 0) delete baseUrls[engineId];
      else baseUrls[engineId] = normalizeBaseUrlForSave(baseUrl);
      await writeBaseUrls(baseUrls);
    },
    async createCustomEngine(input) {
      const { def } = input;
      if (!CUSTOM_ENGINE_ID_PATTERN.test(def.id)) throw new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_template_invalid", params: { reason: `invalid custom engine id: ${def.id}` } });
      const name = def.name.trim();
      if (name.length === 0) throw new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_template_invalid", params: { reason: "custom engine name is required" } });
      const template = validateTemplateForSave(def.template);
      const apiKey = input.apiKey?.trim();
      const normalizedBaseUrl = input.baseUrl == null || input.baseUrl.trim().length === 0 ? undefined : normalizeBaseUrlForSave(input.baseUrl);
      const state = await readEngineState(kkv);
      if (state.customEngines.some((existing) => existing.id === def.id)) throw new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_template_invalid", params: { reason: `duplicate custom engine id: ${def.id}` } });
      const customEngine: CustomEngineDef = { id: def.id, name, template, createdAt: def.createdAt.trim().length > 0 ? def.createdAt : new Date().toISOString() };
      await kkv.set(SEARCH_KKV_MODULE, KEY_CUSTOM_ENGINES, JSON.stringify([...state.customEngines, customEngine]));
      await kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, JSON.stringify([...state.order, def.id]));
      if (apiKey != null && apiKey.length > 0) await secretStore.set(searchApiKeyRef(def.id), apiKey);
      if (normalizedBaseUrl != null) await writeBaseUrls({ ...state.baseUrls, [def.id]: normalizedBaseUrl });
    },
    async updateCustomEngine(engineId, input) {
      const state = await readEngineState(kkv);
      const existing = state.customEngines.find((def) => def.id === engineId);
      if (existing == null) throw engineNotFound(engineId);
      const template = input.template == null ? existing.template : validateTemplateForSave(input.template);
      const name = input.name == null ? (input.template == null ? existing.name : template.name) : input.name.trim();
      if (name.length === 0) throw new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_template_invalid", params: { reason: "custom engine name is required" } });
      const apiKey = input.apiKey?.trim();
      const normalizedBaseUrl = input.baseUrl == null ? undefined : input.baseUrl.trim().length === 0 ? "" : normalizeBaseUrlForSave(input.baseUrl);
      const updated: CustomEngineDef = { ...existing, name, template };
      await kkv.set(SEARCH_KKV_MODULE, KEY_CUSTOM_ENGINES, JSON.stringify(state.customEngines.map((def) => (def.id === engineId ? updated : def))));
      if (apiKey != null) {
        if (apiKey.length === 0) await secretStore.delete(searchApiKeyRef(engineId));
        else await secretStore.set(searchApiKeyRef(engineId), apiKey);
      }
      if (normalizedBaseUrl !== undefined) {
        const baseUrls = { ...state.baseUrls };
        if (normalizedBaseUrl.length === 0) delete baseUrls[engineId];
        else baseUrls[engineId] = normalizedBaseUrl;
        await writeBaseUrls(baseUrls);
      }
    },
    async deleteCustomEngine(engineId) {
      const state = await readEngineState(kkv);
      if (!state.customEngines.some((def) => def.id === engineId)) throw engineNotFound(engineId);
      await kkv.set(SEARCH_KKV_MODULE, KEY_CUSTOM_ENGINES, JSON.stringify(state.customEngines.filter((def) => def.id !== engineId)));
      await kkv.set(SEARCH_KKV_MODULE, KEY_ENGINE_ORDER_V2, JSON.stringify(state.order.filter((id) => id !== engineId)));
      await kkv.set(SEARCH_KKV_MODULE, KEY_ENABLED_ENGINES, JSON.stringify(state.enabled.filter((id) => id !== engineId)));
      const baseUrls = { ...state.baseUrls };
      delete baseUrls[engineId];
      await writeBaseUrls(baseUrls);
      await secretStore.delete(searchApiKeyRef(engineId));
    },
    async updatePresetOverride(engineId, patch) {
      if (!PRESET_ENGINE_IDS.includes(engineId)) throw engineNotFound(engineId);
      const state = await readEngineState(kkv);
      const preset = PRESET_TEMPLATES[engineId];
      const template = validateTemplateForSave({ ...preset, ...state.presetOverrides[engineId], ...patch });
      await kkv.set(SEARCH_KKV_MODULE, KEY_PRESET_OVERRIDES, JSON.stringify({ ...state.presetOverrides, [engineId]: template }));
    },
    async resetPresetOverride(engineId) {
      if (!PRESET_ENGINE_IDS.includes(engineId)) throw engineNotFound(engineId);
      const state = await readEngineState(kkv);
      const overrides = { ...state.presetOverrides };
      delete overrides[engineId];
      if (Object.keys(overrides).length === 0) await kkvDelete(kkv, KEY_PRESET_OVERRIDES);
      else await kkv.set(SEARCH_KKV_MODULE, KEY_PRESET_OVERRIDES, JSON.stringify(overrides));
    },
    async testEngine(input) {
      if (input.query.trim().length === 0) return testFailure("query is required");
      const state = await readEngineState(kkv);
      const { draft } = input;
      let engineId: string;
      let template: SearchEngineTemplate | undefined;
      if (draft != null) {
        const validated = validateSearchEngineTemplate(draft.template);
        if (!validated.ok) return testFailure(validated.error.messageKey == null ? validated.error.message : { key: validated.error.messageKey, params: validated.error.messageParams });
        template = validated.value;
        engineId = input.engineId ?? `${CUSTOM_ENGINE_PREFIX}draft`;
      } else if (input.engineId != null) {
        engineId = input.engineId;
        if (engineId !== DUCKDUCKGO_ENGINE_ID) {
          template = effectiveTemplate(state, engineId);
          if (template == null) return testFailure(`unknown search engine: ${engineId}`);
        }
      } else {
        return testFailure("engineId or draft is required");
      }

      if (template == null) {
        try {
          const response = await searchWithDuckduckgo({ engine: engineId }, input.query, { maxResults: normalizeMaxResults(input.maxResults) }, globalThis.fetch);
          return Result.ok({ resultCount: response.results.length, sample: response.results.slice(0, 5) });
        } catch (error) {
          return testFailure(redactSecret(error instanceof Error ? error.message : String(error), undefined).slice(0, 300));
        }
      }

      const draftKey = draft?.apiKey?.trim();
      let apiKey: string | undefined;
      if (draftKey != null && draftKey.length > 0) apiKey = draftKey;
      else if (templateReferences(template, "apiKey")) apiKey = (await secretStore.get(searchApiKeyRef(engineId))) ?? undefined;
      const draftBaseUrl = draft?.baseUrl?.trim();
      let baseUrl: string | undefined;
      if (draftBaseUrl != null && draftBaseUrl.length > 0) {
        const normalized = normalizeEngineBaseUrl(draftBaseUrl);
        if (normalized == null) return testFailure("invalid base URL: only http/https is supported");
        baseUrl = normalized;
      } else if (templateReferences(template, "baseUrl")) {
        const stored = state.baseUrls[engineId];
        const normalized = stored == null ? null : normalizeEngineBaseUrl(stored);
        if (normalized != null) baseUrl = normalized;
      }
      try {
        const response = await runTemplateEngine(template, { engine: engineId, ...(apiKey == null ? {} : { apiKey }), ...(baseUrl == null ? {} : { baseUrl }), template }, input.query, { maxResults: normalizeMaxResults(input.maxResults) }, {}, globalThis.fetch);
        return Result.ok({ resultCount: response.results.length, sample: response.results.slice(0, 5) });
      } catch (error) {
        return testFailure(redactSecret(error instanceof Error ? error.message : String(error), apiKey).slice(0, 300));
      }
    },
  };
}
