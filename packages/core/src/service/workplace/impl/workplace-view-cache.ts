/**
 * workplace 评估链进程内缓存（L1 memo，conn 级 WeakMap）。
 *
 * 背景：三端工厂 `runtime.workplace(scope)` 每次调用都 new 新 service 实例，
 * 实例级 memo 命中率极低（agent-runner L328 已记录被工厂击穿的教训）；裸模块级
 * `Map<scopeKey,…>` 又会在 core 多库同进程测试与 mobile/desktop rebootstrap 下串库。
 * 因此放点为 **模块级 `WeakMap<TdbcConnection, Map<scopeKey, entry>>`**：
 * 同 conn 下所有实例（无论谁 new 的）共享缓存；conn 关闭/GC 自动回收；
 * rebootstrap 新 conn 即天然冷缓存，无残留。
 *
 * 失效完全依赖读时校验（签名比对），不挂任何写路径钩子；entry 记录的是
 * **计算开始前**采样的校验值，计算期间发生写入时下一个读者比对不匹配即重算，
 * 脏结果最多存活一次读取，无需 epoch/锁。
 *
 * @module service/workplace/impl/workplace-view-cache
 */

import type {
  WorkplaceRuleContext,
  WorkplaceRuleView,
} from "@/domain/workplace/model/workplace-rule-view.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** 读时校验用的校验值三元组（vfs 聚合签名 + 规则表/智能规则表序列化签名）。 */
export interface WorkplaceViewSigs {
  readonly vfs: string;
  readonly rules: string;
  /** smart_sort_rule 全量按 sort_order 排序后的确定性序列化（core/B-3）。 */
  readonly smartRules: string;
}

/** 缓存的完整评估结果（三个评估入口共享同一次计算）。 */
export interface WorkplaceViewCacheValue {
  /** mtimeByPath 供 persist 链读-改-写一致性使用。 */
  readonly ctx: WorkplaceRuleContext;
  readonly view: WorkplaceRuleView;
  readonly filetreeDisplay: string;
}

/**
 * 单 scope 缓存条目。
 *
 * 可变对象：`inFlight` 由 service 在起算时挂载、完成时清除（跨实例并发去重）。
 */
export interface WorkplaceViewCacheEntry {
  /** 计算开始前采样的校验值——发布与读取都以它为准；undefined = 尚未发布过。 */
  sigs: WorkplaceViewSigs | undefined;
  ctx?: WorkplaceRuleContext;
  view?: WorkplaceRuleView;
  filetreeDisplay?: string;
  /** 承接原实例级 liveViewInFlight 的并发去重语义（升级为 conn 级跨实例）。 */
  inFlight?: Promise<WorkplaceViewCacheValue>;
}

let cache = new WeakMap<
  TdbcConnection,
  Map<string, WorkplaceViewCacheEntry>
>();

function connScopeMap(conn: TdbcConnection): Map<string, WorkplaceViewCacheEntry> {
  let scopes = cache.get(conn);
  if (scopes == null) {
    scopes = new Map();
    cache.set(conn, scopes);
  }
  return scopes;
}
/**
 * ensure 语义：取（无则建）scope 的缓存条目，供 service 挂载/清除 inFlight。
 */
export function ensureWorkplaceViewEntry(
  conn: TdbcConnection,
  scopeKey: string
): WorkplaceViewCacheEntry {
  const scopes = connScopeMap(conn);
  let entry = scopes.get(scopeKey);
  if (entry == null) {
    entry = { sigs: undefined };
    scopes.set(scopeKey, entry);
  }
  return entry;
}

/**
 * 发布：以**计算开始前**采样的校验值写入（若计算期间有写，下一个读者比对
 * 当前签名不匹配即重算——脏结果最多存活一次读取）。
 */
export function publishWorkplaceView(
  conn: TdbcConnection,
  scopeKey: string,
  sigs: WorkplaceViewSigs,
  value: WorkplaceViewCacheValue
): void {
  const entry = ensureWorkplaceViewEntry(conn, scopeKey);
  entry.sigs = sigs;
  entry.ctx = value.ctx;
  entry.view = value.view;
  entry.filetreeDisplay = value.filetreeDisplay;
}

/**
 * 命中读取：entry 已发布（sigs 有值 + 三件套齐全）且校验值与刚采样的相等时
 * 返回缓存结果，否则返回 undefined（miss，由调用方走计算路径）。
 */
export function getCachedWorkplaceView(
  entry: WorkplaceViewCacheEntry,
  sigs: WorkplaceViewSigs
): WorkplaceViewCacheValue | undefined {
  if (
    entry.sigs == null ||
    entry.ctx == null ||
    entry.view == null ||
    entry.filetreeDisplay == null
  ) {
    return undefined;
  }
  if (
    entry.sigs.vfs !== sigs.vfs ||
    entry.sigs.rules !== sigs.rules ||
    entry.sigs.smartRules !== sigs.smartRules
  ) {
    return undefined;
  }
  return {
    ctx: entry.ctx,
    view: entry.view,
    filetreeDisplay: entry.filetreeDisplay,
  };
}

/** 测试专用：清空全部连接的缓存（不进 public 导出面）。 */
export function clearAllWorkplaceViewCache(): void {
  // WeakMap 不可枚举：整体换新实例，旧 map 丢引用后连同各 conn 的条目一起
  // 可回收，语义上等价于清空且不阻止 conn 本身被 GC。
  cache = new WeakMap();
}
