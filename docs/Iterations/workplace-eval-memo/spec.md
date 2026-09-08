---
date: 2026-09-07
---

# workplace 评估链进程内缓存（L1 memo）技术规格（SPEC）

## 设计目标

**需求来源**：用户口述（huge-card-import-crash 修复轮的后续优化讨论定稿）。需求 = 为 workplace 规则视图评估链加**进程内 memo（L1）**：同一应用运行内重复评估不再重复执行 4 条全量 SQL + 排序；失效采用**读时校验（指纹/签名比对）**，不挂任何写路径钩子。

**明确不做**（已拍板，勿再提案）：
- L2（每文件持久化 collation 排序键）、L3（持久化顺序 map）——等数千文件级工作区真出现再议；
- 不改变 `rule_snapshot`/`file_cache` kkv 持久缓存语义（常驻提示词快照链不动）；
- 不 bump `SCHEMA_BOOT_VERSION`（零 schema 变更）。

**收益定位（诚实口径）**：引擎平方修复（d040dc3f）后单次评估已是百 ms 级，本缓存救的是**连发评估**的重复成本——规则保存背靠背双评估、工作区面板 reload 紧跟 picker/typeahead、agent 每轮 `$filetree` 快照——每次命中省掉 4 条全量行查询（JSI 逐行过桥）+ Map 组装 + O(N·logN) 排序。冷启动首进不受益（属 L2/L3 范畴）。

## 总体方案

### 缓存键与校验（核心设计）

原讨论的三元组指纹（count + max(mtime) + max(head_version)）经全写路径审计**否决**，存在三个确定盲区：

| 盲区 | 机制 |
|------|------|
| rename | `renamePathInScope`/`renamePrefixInScope` 只 `UPDATE path`，三元组全不变，但 fileSet/规则匹配全变 |
| 回滚 | `resetHeadToVersion` 写回历史 `(version, mtime)`；被回拨行非 max 持有者时三元组不变，但排序（created/updated 均吃 mtime）与内容变 |
| 树拷贝 | session 重拉/fork 的 `batchInsertFileEntriesWithHash` 保留源行 mtime、head_version 恒 1，特定分布下三元组重合而集合变 |

替代方案：**path 敏感的有序聚合签名**，一条 SQL、单行返回、单次 JSI 过桥：

```sql
SELECT count(*), group_concat(s, char(31))
FROM (SELECT path || ':' || head_version || ':' || mtime_ms AS s
      FROM vfs_entry
      WHERE scope_key = ?
      ORDER BY path)
```

- 不按 `entry_kind` 过滤（mkdir 空目录必须改变签名）；
- `char(31)`（单元分隔符）做拼接分隔符，规避路径中逗号/换行；
- 依赖排序子查询决定 group_concat 顺序（SQLite 实际语义；两串相等 ⟺ 行集合逐行相等，本项目数据规模与字符集下无碰撞担忧）。

**规则签名**：规则表无版本列且存在同数改写（翻转 `rule_enabled`），不做聚合指纹——`listDirRules` + `listFileRules` 全量重读（人工配置量级，几十行内）后按 `logicalPath` 排序、确定性序列化（JSON）作签名字符串。两表全列参与，无遗漏输入。

**缓存键** = `workplaceScopeKey(scope)`（`session:{sid}` / `project:{pid}` / `global`，全局唯一）；**校验值** = `(vfsEntrySignature, rulesSignature)` 二元组。

### 缓存放点：conn 级 WeakMap（否决实例级与裸模块级）

探索证实三端工厂 `runtime.workplace(scope)` **每次调用 new 新实例**，且大量一次性消费面（ChatComposer @ 弹窗、FileReferencePicker、desktop 每次 IPC、session-prompt-input 每次渲染）——实例级 memo 命中率极低（agent-runner L328 注释已记录实例去重被工厂击穿的教训）。裸模块级 `Map<scopeKey,…>` 也不行：core 测试**多库同进程**（每测试文件一个内存库），跨连接会串库；mobile/desktop rebootstrap 后旧库结果残留。

放点：**模块级 `WeakMap<TdbcConnection, Map<scopeKey, CacheEntry>>`**（新文件 `workplace-view-cache.ts`，风格对齐 `session-api-prompt-token-cache.ts` 先例）：
- 同 conn 下的所有 service 实例（无论谁 new 的）共享缓存——跨表面命中；
- conn 关闭/GC 自动回收；rebootstrap 新 conn = 天然冷缓存，无残留；
- 导出测试专用 `clearAllWorkplaceViewCache()`（不进 public 导出面）。

`CacheEntry` 结构：

```ts
interface WorkplaceViewCacheEntry {
  /** 计算开始前采样的校验值——发布与读取都以它为准 */
  sigs: { vfs: string; rules: string };
  ctx: WorkplaceRuleContext;          // mtimeByPath 供 persist 链读-改-写一致性使用
  view: WorkplaceRuleView;            // rows + displayByPath
  filetreeDisplay: string;            // 宏树渲染串
  inFlight?: Promise<...>;            // 跨实例并发去重（承接 liveViewInFlight 语义）
}
```

### 集成方式（读时校验，零写路径改动）

`DefaultWorkplaceService` 的三个评估入口（`doMaterializeLiveView` / `evaluateRuleView` / `materializePersistBlock`）统一改走：

```
读签名（1 条聚合 SQL + 规则全量重读）
  → 与 entry.sigs 相等且 entry 有值 → 直接返回缓存的 ctx/view/filetreeDisplay
  → 不等或无 entry → 经 inFlight 去重执行 loadContextMetadata + evaluate + render
      → 计算前采样的 sigs 随结果一起写入 entry
```

**竞态自愈**：entry 记录的是**计算开始前**采样的 sigs；若计算期间有写发生，发布进去的是旧 sigs，下一个读者比对当前 sigs 不匹配即重算——脏结果最多存活一次读取，无需 epoch/锁。实例内 `liveViewInFlight` 字段被 entry.inFlight 取代（并发去重升级为跨实例）。

**失效口径**：完全依赖读时校验，**不追加任何写钩子、不动 `clearSessionPromptCaches` 三件套**。规则保存/导入/回滚/重拉全部由签名自然覆盖。

## 最终项目结构

```
packages/core/src/
  domain/vfs/repositories/
    vfs-entry.port.ts                          # + computeEntrySignature(scopeKey)
    impl/sqlite-vfs-entry.repository.ts        # + 聚合签名 SQL 实现
  service/workplace/
    impl/workplace-view-cache.ts               # 新增：conn 级 WeakMap 缓存模块
    impl/workplace.service.ts                  # 三评估入口接缓存；删实例级 liveViewInFlight
packages/core/test/workplace/
  workplace-view-cache.test.ts                 # 新增：命中/失效/隔离/竞态套件
```

mobile/desktop/CLI 调用面零改动（缓存对 service 消费方透明）。

## 变更点清单

| # | 位置 | 变更 |
|---|------|------|
| 1 | `domain/vfs/repositories/vfs-entry.port.ts` + `impl/sqlite-vfs-entry.repository.ts` | 新增 `computeEntrySignature(scopeKey): Promise<string>`：排序子查询 + `group_concat(char(31))`，单行返回；不做 entry_kind 过滤 |
| 2 | `service/workplace/impl/workplace-view-cache.ts`（新增） | `WeakMap<conn, Map<scopeKey, entry>>`；`getEntry(conn, scope)` / `publish(conn, scope, sigs, value)` / `takeInFlight` / `clearAllWorkplaceViewCache`（测试） |
| 3 | `service/workplace/impl/workplace.service.ts` | ① 采样签名（vfs 聚合 + 规则序列化）；② 三入口接缓存（命中短路 / 未命中 inFlight 计算→publish）；③ 移除实例级 `liveViewInFlight`；④ `WorkplaceRuleContext` 复用同一 entry（persist 链的 `mtimeByPath` 一致性来源不受损） |
| 4 | `packages/core/test/workplace/workplace-view-cache.test.ts`（新增） | 见测试策略 |

不改动：`rule_snapshot`/`file_cache` 链、`clearSessionPromptCaches`、rename/回滚等写路径、schema、public 导出面、三端 runtime 工厂。

## 详细实现步骤

- Step 1 — phase-sig-query — blocking: yes — qa: auto：仓储层新增 `computeEntrySignature`（port + sqlite 实现 + 内嵌 SQL 单测：增/删/改/rename/mkdir 空目录五种写各自改变签名；同数据重复查询签名稳定）。
- Step 2 — phase-cache-module — blocking: yes — qa: auto：`workplace-view-cache.ts` conn 级缓存模块（get/publish/inFlight/clearAll；WeakMap 行为单测：同 conn 共享、异 conn 隔离）。
- Step 3 — phase-service-wiring — blocking: yes — qa: auto：`workplace.service.ts` 三入口接线（签名采样→命中短路→inFlight 计算→publish-with-sigs；移除 `liveViewInFlight`；保持 `T-WEC13` 并发合并语义等价——合并升级为跨实例）。
- Step 4 — phase-tests — blocking: yes — qa: auto：`workplace-view-cache.test.ts` 全套（T-WMC1~T-WMC9）+ core 全量回归（1842 例基线）。
- Step 5 — phase-dist-and-apps — blocking: yes — qa: auto：`npm run build -w @novel-master/core` 重建 dist；mobile `NODE_ENV=test` typecheck + jest；desktop typecheck（消费面透明性验证）。
- Step 6 — phase-on-device-spotcheck — blocking: no — qa: manual_user：真机装新包，毒库工作区连续进出 + 规则保存，体感第二次进入明显快于首进（合并后用户验收，非门禁）。

## 测试策略

### 测试用例

- T-WMC1 — blocking: yes — 命中：同 scope 连续两次 `buildListRows`，spy `listFileMetaUnderPrefix` 计数为 1，两次结果 deep-equal（→ Step 3）。
- T-WMC2 — blocking: yes — 文件写失效：写同一文件后重评估，计数变 2、内容更新可见（→ Step 3）。
- T-WMC3 — blocking: yes — rename 失效：`renamePath` 后视图路径更新（path 敏感签名的核心反例，→ Step 1/3）。
- T-WMC4 — blocking: yes — 规则同数改写失效：翻转某目录 `rule_enabled`（count 不变）后视图更新（规则全量签名的核心反例，→ Step 3）。
- T-WMC5 — blocking: yes — 回滚失效：`resetHeadToVersion` 写回历史 mtime 后，按 updated 排序的视图变化可见（→ Step 3）。
- T-WMC6 — blocking: yes — 跨实例共享：同 conn 两个 service 实例同 scope，第二实例命中（工厂击穿场景，→ Step 2/3）。
- T-WMC7 — blocking: yes — 连接隔离：两个 conn 同名 scope 互不命中（测试多库同进程场景，→ Step 2）。
- T-WMC8 — blocking: yes — mkdir 空目录可见（签名不过滤 entry_kind，→ Step 1/3）。
- T-WMC9 — blocking: yes — 性能哨兵：600 文件毒库（复用 `workplace-rule-engine-large-dir.test.ts` 构造法），第二次 `buildListRows` 的 repo 全量查询计数不增长且耗时显著低于首次（→ Step 3/4）。

回归面：既有 21 个 workplace 套件、`workplace-rule-engine-large-dir`、`refresh-rule-snapshot`、`assemble-workplace-display`、mobile `vfs-file-manager.*`、desktop `workplace-handlers`。

## 风险与回滚方案

| 风险 | 评估与对策 |
|------|-----------|
| group_concat 顺序依赖子查询排序（SQLite 未在规范层面保证） | 实际语义稳定（引擎按输入序聚合）；即便理论扰动，后果仅是一次假 miss 多算一遍（正确性无损，签名只会更敏感不会更迟钝）。测试 T-WMC1 钉住稳定性行为 |
| 签名串随文件数线性增长（~120B/文件） | 单行单次 JSI 过桥，556 文件 ≈ 70KB——远低于现行 556 行逐行过桥；数千文件场景本就属 L2/L3 议题 |
| 读时校验非原子（采样与计算间有写） | 发布携带计算前 sigs，读侧比对自愈；最多一次旧视图（SQLite 单连接串行，窗口极小） |
| `WorkplaceRuleContext` 被缓存后，persist 链读到旧 `mtimeByPath` | mtimeByPath 变化必然改变 vfs 签名（mtime 参与拼接）→ entry 失效重算，一致性成立（T-WMC5 覆盖） |
| 回滚 | 单 commit 独立可 revert；无 schema、无写路径改动、无数据迁移，回滚零残留。缓存模块为纯新增文件，revert 后恢复现状（每评估全量计算） |
