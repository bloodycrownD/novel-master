---
date: 2026-09-06
---

# 文件名智能排序 技术规格（SPEC）

> 需求来源：`docs/Iterations/smart-filename-sort/prd.md`（已确认）。
> 探索依据：本迭代三轮子代理探索报告（workplace 排序链路与迁移机制、regex 域/CLI 模板、依赖与 UI 先例），关键证据以路径+符号标注。

## 设计目标

1. 目录规则排序方式新增 `smart`（智能排序）：识别「第X章/卷」「Chapter N」「001、」等序号，按数值正确排列，中文数字自动转数值。
2. 智能排序规则可管理：设置内新增规则管理页（双端），支持增删改、启停、优先级调序（上下移 + 拖拽）、批量操作、YAML 导入导出、测试预览、恢复默认。
3. 修复「目录排序无视排序方式」的欠账：`sortDirPaths` 尊重 sortField（含 smart 与时间）。
4. CLI 提供 `sort-rule` 管理与排序测试命令（agent 自测用），`workplace dir --sort smart` 可用。
5. 存量行为零回归：未选智能排序的目录排序结果与当前版本完全一致。

## 总体方案

### 架构

```
┌─ core ──────────────────────────────────────────────────────┐
│ bootstrap: 新表 smart_sort_rule DDL + workplace_dir_rule     │
│   CHECK 扩 'smart' + SCHEMA_BOOT_VERSION 10→11               │
│   + rebuild migration（照抄 table-constraints-v1b 模板）      │
│   + 内置规则 seed（幂等，固定 rule_id）                       │
│ domain/workplace/logic: 智能比较纯函数                        │
│   parseChineseNum / tokenizeNatural / extractSortKey /        │
│   compareSmartBasenames（decorate-sort-undecorate）           │
│ domain/workplace: SortField 加 "smart"；sortFilesForDir       │
│   与 sortDirPaths 加可选 smartRules/mtime 参数                │
│ domain/smart-sort-rule: 规则实体 + zod + repo（无分组单表）    │
│ service/smart-sort-rule: CRUD/调序/批量/导入导出/恢复默认/预览 │
│ public/smart-sort-rule 子路径导出                             │
└──────────────────────────────────────────────────────────────┘
   ↓ dist（mobile 经 metro；desktop/CLI 经 runtime 注入）
┌─ desktop ──────────┐  ┌─ mobile ─────────┐  ┌─ CLI ──────────┐
│ IPC 五行模板        │  │ runtime 装配      │  │ main.ts 注册    │
│ 设置页新视图        │  │ 两个新屏          │  │ sort-rule 命令组│
│ DirectoryRuleModal │  │ DirectoryRuleSheet│  │ --sort smart   │
└────────────────────┘  └──────────────────┘  └────────────────┘
```

### 关键设计决策（探索报告风险项的定案）

| # | 决策点 | 定案 | 依据 |
|---|--------|------|------|
| D1 | `sort_field` CHECK 扩枚举 | canonical DDL 改 CHECK + BOOT_VERSION 10→11 + rebuild migration **三件套同一步骤原子完成**。rebuild 照抄 `git 5d271868^` 的 `rebuildTable`（含 rowid 分块搬运，quick-sqlite 整表 INSERT SELECT 会挂起） | 探索1 §3.1/风险1；记忆 #10 两次事故 |
| D2 | 规则表结构与调序 | 单表无分组（比 regex 少一层）：`rule_id TEXT PK`、`sort_order INTEGER` **不加 UNIQUE**；调序统一「整表重编号」（legado PersistOrder 模式：内存排序后批量 UPDATE 1..N），规避唯一约束两阶段交换 | 探索2 §3.3（regex 无 move 先例+UNIQUE 撞调序） |
| D3 | 内置规则标识与生命周期 | 固定 `rule_id` 前缀 `builtin-`；seed 每次幂等 `INSERT OR IGNORE`（不覆盖存量行，用户禁用内置规则后重启保持禁用）；**内置规则仅可禁用不可删除**：service 层 `deleteRule`/`deleteBatch` 对 `builtin-` 前缀一律拒绝（错误 code 可辨），UI 对 `builtin-` 行隐藏删除入口，CLI `remove` 对 `builtin-` 报错；唯一删除路径是恢复默认 = `DELETE WHERE rule_id LIKE 'builtin-%'` 后重灌，用户规则隔离 | legado 负 id 模式（探索1 报告）+ PRD「禁用某内置规则后不再参与匹配」 |
| D4 | 比较器数据流 | `sortFilesForDir(files, dirRule, opts?)`/`sortDirPaths(paths, dirRule, opts?)` 加**可选**第三参 `{ smartRules?: readonly CompiledSmartSortRule[]; dirMtimeByPath?: ReadonlyMap<string, number> }`；缺省时 smart 退化为自然排序（纯函数无 IO、签名向后兼容，三条调用链 + core-shim 不破坏）；规则由 service 层组装传入（workplace.service 构造注入 provider，mobile orderedDirectChildPaths 自行经 runtime 取） | 探索1 §3.4（public API 被三端消费） |
| D5 | 性能 | decorate-sort-undecorate：每文件名**预提取一次** sortKey（缓存于排序前的 map），比较器只比 key；规则加载时预编译 RegExp（参照 compile-regex-rule.ts） | 探索1 风险4、探索2 风险4 |
| D6 | 捕获组约定 | pattern 必须含 ≥1 捕获组（validate 强制）；flags 参与编译 `RegExp(pattern, flags)`（flags 合法性见 Step 1 CHECK / Step 7 validate）；正则命中且**全部捕获组可解析为数值**才采用该规则，否则**继续尝试下一条**；捕获组先 `Number()`（纯数字），失败走中文数字解析（legado `stringToInt` 同款语义），再失败视为未提取 | PRD 全序约定 + legado 字符类 |
| D7 | 目录时间排序 | 本迭代一并支持：`vfs_entry.mtime_ms` 对目录行有值但 `listDirectoryPathsUnderPrefix` 未带出——新增 `listDirectoryMetaUnderPrefix`（path+mtimeMs），`loadContextMetadata` 填 `ctx.dirMtimeByPath`。**缺省 `dirMtimeByPath` 时目录的 created/updated 排序退化为 name 字典序（=现状，零回归）**；mobile `orderedDirectChildrenPaths` 的孤儿路径（不在 rows 里的 extraPaths，无 meta 可查）即此形态 | 探索1 §2.4 |
| D8 | mobile 拖拽 | 上移/下移/置顶/置底按钮为**主路径（blocking）**；长按拖拽为增强（**非 blocking**，自研拖拽手柄，真机验收不过可砍，不引第三方库不补 GestureHandlerRootView）。【实现注 2026-09-07】原定 gesture-handler 路线与「不补 RootView」硬约束互斥：RNGH 2.31 的 GestureDetector 无 GestureHandlerRootView 祖先时 DEV 直接 throw（已读源码确认），故改用 RN 内置 PanResponder（按住手柄 ≥300ms 接管）+ reanimated shared value 位移，纯逻辑拆在 smart-sort-drag.ts 配 12 条单测；交互行为不变（D4 实质约束全保持）。【移除注 2026-09-12】真机验收长按拖拽不生效，按预案整体移除（用户拍板）；调序主路径为上移/下移/置顶/置底按钮 | 探索3 风险1；cr-func-full 实现注 |
| D9 | desktop 拖拽 | HTML5 `draggable` 原生自研（renderer 纯 React+CSS，无新依赖），blocking | 探索3 §2 |
| D10 | YAML 导入语义 | **替换式**（确认对话框→清空全部→按文件顺序全量插入），与 agent YAML 覆盖式先例一致，round-trip 无损严格成立；导出 = 全量按 sort_order。**YAML 文档 schema 单源 core**：smart-sort-rule bundle zod schema（含 schemaVersion）+ encode/decode 收敛在 `domain/smart-sort-rule/model/smart-sort-rule-io.ts`（参照 CLI `agent/import-export.ts` + `schemas/agents-bundle.schema.ts` 模式，但上移到 core 供三端共用，CLI 侧该文件只有 fs/io），desktop yaml service 与 mobile 导入导出直引 | 探索3 §3.8 + agent import-export 先例 |
| D11 | 预览/测试实现 | 单源 core：service 新增 `previewSort(names, rules?)` 纯方法；mobile 屏直调 runtime；desktop renderer 走 IPC channel（renderer 不依赖 core 的既有边界）；CLI test 直调 | 探索2 §2.4、探索3 §2 |
| D12 | desktop ManageHeader | 照 mobile 版补可选 `actions`/`primaryActionLabel` props（只增不改，现有调用方零影响），承载批量启停 | 探索3 §2（desktop 版无 actions） |

### 智能比较全序（实现基准，PRD 定案）

对 basename `a`、`b`（预提取 sortKey：`{ nums: number[] } | null`）：

1. `a` 有 key、`b` 无 → `a` 前；
2. 都有 key → 元组逐位数值比，前缀相同者短者前；
3. 都无 key → 自然排序（照 legado `AlphanumComparator` 语义：ASCII 数字块/非数字块交替切块，只认 `0-9`；两端块均为数字块→先比长度（即位数，等价数值大小）再逐位比码位；两端均为非数字块或类型不一致（一端数字一端非数字）→按整块字符串码位序；一串先耗尽→短者前。注：数字块长度优先意味着「007 vs 7」判为不等——前导零等值场景由序号提取（两名均命中 builtin-numeric 提取同值）+ tiebreak 收敛，长度优先为确定性设计，有意为之）；
4. 仍平 → 原文件名自然排序 tiebreak（确定性全序）；
5. `desc` = 全序整体取反（乘 -1）。

### 内置默认规则集（seed 数据，附录 A 给完整正则）

按 `sort_order` 优先级列表逐条尝试，**首命中者负责提取**；复合规则前置：`builtin-zh-chapter` 后缀类含「卷」，单独即可命中「第2卷 第13章」但只提取卷号 [2]（丢章号）——`builtin-zh-volume-chapter` 必须排在其前，避免被单序号规则抢占（已 node 验证）。

| sort_order | id | 名称 | 捕获组 | flags | example |
|----|------|------|--------|-------|---------|
| 1 | builtin-zh-volume-chapter | 中文卷章复合 | 2 | '' | 第2卷 第13章 |
| 2 | builtin-zh-chapter | 中文名章节 | 1 | '' | 第十二章 风起 |
| 3 | builtin-en-chapter | 英文章节 | 1 | 'i' | Chapter 12 |
| 4 | builtin-numeric | 数字序号开头 | 1 | '' | 001、开端 |

## 最终项目结构（新增/改动）

```
packages/core/src/
  bootstrap/
    novel-master-bootstrap.ts          # SCHEMA_BOOT_VERSION 10→11 + 注册 DDL + seed 挂点
    workplace/workplace-schema.ts      # CHECK 加 'smart'
    smart-sort-rule/smart-sort-rule-schema.ts        # 新表 DDL
    schema-migrations/
      index.ts                          # 注册新迁移
      workplace-dir-rule-smart-field-v1.ts           # rebuild migration（新）
      builtin-smart-sort-rules.ts                    # 内置规则常量 + seed（新，或放 domain）
  domain/workplace/
    model/workplace-types.ts            # SortField 加 "smart"
    logic/smart-sort.ts                 # 新：parseChineseNum/tokenizeNatural/extractSortKey/compareSmartBasenames
    logic/workplace-eval.ts             # sortFilesForDir/sortDirPaths 加可选参 + smart case
    logic/workplace-rule-engine.ts      # ctx 扩 smartRules/dirMtimeByPath，walkDir 传参
    logic/workplace-file-tree.ts        # sortedChildren 传参
    model/workplace-rule-view.ts        # WorkplaceRuleContext 扩字段
  domain/smart-sort-rule/               # 新域（参照 domain/regex 结构）
    model/smart-sort-rule.ts            # 实体 SmartSortRule
    model/smart-sort-rule.schema.ts     # zod（create/update，.strict()）
    model/smart-sort-rule-io.ts         # 新：YAML bundle zod schema + encode/decode（单源，三端共用，D10）
    logic/compile-smart-sort-rule.ts    # 编译+校验（RegExp try/catch、捕获组检查）
    repositories/smart-sort-rule.port.ts
    repositories/impl/sqlite-smart-sort-rule.repository.ts
  service/smart-sort-rule/
    smart-sort-rule.port.ts             # 接口（CRUD/setEnabled/move/reorder/setEnabledBatch/deleteBatch/
                                        #      importRules/exportRules/resetDefaults/previewSort/listCompiled）
    create-smart-sort-rule-service.ts
    impl/smart-sort-rule.service.ts
  service/workplace/impl/workplace.service.ts   # 注入规则 provider + loadContextMetadata 扩目录 mtime
  domain/vfs/repositories/vfs-entry.port.ts  # listDirectoryMetaUnderPrefix 新方法声明（接口先行）
  domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts  # listDirectoryMetaUnderPrefix（新方法）
  public/smart-sort-rule.ts             # 新子路径导出
packages/core/test/
  smart-sort/…（新单测）、workplace/…（扩展）、package-exports/snapshots/public-workplace-allowlist.json（同步）
apps/desktop/
  shared/ipc-types.ts                   # channel + DTO + sortField union 加 'smart'
  src/main/ipc/handlers/smart-sort-rule.ts      # 新（IpcResult 范式）
  src/main/ipc/handler-registry.ts      # bind 注册
  renderer/ipc/invoke-registry.ts       # ipc 封装
  src/main/runtime/create-desktop-runtime.ts + types.ts   # service 装配
  renderer/features/settings/settings-nav.ts       # ViewId + NAV + navState
  renderer/features/settings/SettingsViews.tsx     # SmartSortRulesView + 编辑视图
  renderer/features/workspace/DirectoryRuleModal.tsx # 选项 + 文案「排序方式」
  renderer/components/batch/ManageHeader.tsx       # 扩 actions（D12）
apps/mobile/
  src/runtime/create-mobile-runtime.ts + types.ts  # service 装配
  src/navigation/{types,RootNavigator,header-config}.tsx + screens/tabs/ProfileTabScreen.tsx  # 入口注册
  src/screens/stack/SmartSortRulesScreen.tsx       # 新：列表+批量+调序
  src/screens/stack/SmartSortRuleEditorScreen.tsx  # 新：表单+测试预览
  src/components/sheet/DirectoryRuleSheet.tsx      # 选项 + 文案「排序方式」
  src/components/vfs/vfs-direct-children-order.ts  # orderedDirectChildPaths 传规则
  __tests__/vfs-direct-children-order.test.ts      # 扩展
apps/cli/src/
  main.ts                               # 顶层注册 "sort-rule"
  sort-rule/commands.ts                 # 新：list/create/update/remove/enable/disable/move/import/export/test
  workplace/run-workplace.ts            # parseSortField 加 'smart'
```

## 变更点清单

**core**：① `SortField` 加 `"smart"`（`workplace-types.ts:22`）；② CHECK 扩枚举（`workplace-schema.ts:22`）+ BOOT_VERSION 11（`novel-master-bootstrap.ts:67`，续写注释链）；③ rebuild migration 入 `SCHEMA_MIGRATIONS`（`schema-migrations/index.ts:29-32` 数组尾追加 + import 区）；④ 新表 `smart_sort_rule` DDL 入 `NOVEL_MASTER_SCHEMA_STATEMENTS`；⑤ 比较器纯函数；⑥ `workplace-eval.ts` `sortFilesForDir`（:65）加 case、`sortDirPaths`（:139）补 sortField；⑦ rule-engine/file-tree/context 传参链；⑧ `vfs-entry.port.ts` 新方法声明 + `sqlite-vfs-entry.repository.ts` 目录 mtime 查询（:464 旁新增方法）；⑨ 规则域（含 `smart-sort-rule-io.ts` YAML 单源）+ service + public 导出；⑩ 快照 `public-workplace-allowlist.json` 手动同步（无自动更新，探索1 §2.5）。

**desktop**：IPC 五行（channel/DTO/handler/bind/invoke）+ runtime 两步 + 设置视图 + DirectoryRuleModal + ManageHeader 扩展 + `ipc-types.ts:590` union 加 `'smart'`。

**mobile**：runtime 两步 + 导航五处 + 两屏 + DirectoryRuleSheet + `vfs-direct-children-order.ts` + `test-utils/core-shim.ts` 无需改（re-export 不变形，但跑测前须重建 core dist，记忆 #10）。

**CLI**：`main.ts` 顶层分发加 `"sort-rule"`；`run-workplace.ts:148` `parseSortField` 白名单加 `'smart'`；新命令组。

## 详细实现步骤

> 全部在 worktree 分支开发（记忆 #23），完成后并入 dev（记忆 #37）。

- Step 1 — phase-core-schema — blocking: yes — qa: auto：`smart-sort-rule-schema.ts` 新表 DDL（字段见 D2：`rule_id TEXT PRIMARY KEY / name TEXT NOT NULL / pattern TEXT NOT NULL / flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*') / example TEXT / enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)) / sort_order INTEGER NOT NULL / created_at_ms / updated_at_ms`，索引 `idx_smart_sort_rule_order(sort_order)`）注册进 `NOVEL_MASTER_SCHEMA_STATEMENTS`；`workplace-schema.ts` CHECK 改 `IN ('name','created','updated','smart')`；`SCHEMA_BOOT_VERSION` 10→11 并续写注释链。
- Step 2 — phase-core-schema — blocking: yes — qa: auto：新迁移 `workplace-dir-rule-smart-field-v1.ts`：照抄 v1b `rebuildTable`（`git show 5d271868^` 模板，保留 rowid 分块搬运与列交集搬运），对 `workplace_dir_rule` 以新 CHECK 形态重建 + 重建 `idx_workplace_dir_scope`；`up()` 开头形态探测早退（**查 sqlite_master 的建表 SQL 是否含 'smart'**，v1b 同款判据——`SELECT sql FROM sqlite_master WHERE type='table' AND name='workplace_dir_rule'`，不用 pragma_table_info）；注册进 `SCHEMA_MIGRATIONS`。迁移单测：构造旧 CHECK 形态库 → bootstrap → 写入 `'smart'` 成功、存量行无损。
- Step 3 — phase-core-seed — blocking: yes — qa: auto：内置规则常量（附录 A）+ 幂等 seed（`INSERT OR IGNORE` 按固定 rule_id，挂 bootstrap seed 阶段，参照 `seedBuiltinProviders` 事务内模式）。
- Step 4 — phase-core-comparator — blocking: yes — qa: auto：`smart-sort.ts` 纯函数：`parseChineseNum`（零〇两/一二三…十百千万亿 + 大写，逐位式与进位式，参照 legado `StringUtils.chineseNumToInt` 语义）、`tokenizeNatural`（AlphanumComparator 语义，见全序规则 3）、`extractSortKey(basename, compiledRules)`（优先级逐条、D6 捕获组约定；compiled 规则含 flags，编译为 `RegExp(pattern, flags)`，见 D6）、`compareSmartBasenames(a,b,order,cache)`（全序五条 + decorate-sort-undecorate cache Map）。
- Step 5 — phase-core-workplace — blocking: yes — qa: auto：`workplace-types.ts` `SortField` 加 `"smart"`；`workplace-eval.ts`：`sortFilesForDir` 加可选 `opts.smartRules` + smart case（调 Step 4）；`sortDirPaths` 加 `opts {smartRules, dirMtimeByPath}`，按 sortField 分派（name→现状字典序、created/updated→目录 mtime、smart→智能比较，方向统一取反）；`WorkplaceRuleContext`/`walkDir`/`workplace-file-tree.ts` 传参链打通。
- Step 6 — phase-core-workplace — blocking: yes — qa: auto：新方法先进 `vfs-entry.port.ts` 声明（接口先行），`sqlite-vfs-entry.repository.ts` 实现 `listDirectoryMetaUnderPrefix`（SELECT path, mtime_ms）；存量测试手写 mock 的 fake vfs repo（如 `workplace-materialize-engine.test.ts:33` 一类 `listDirectoryPathsUnderPrefix: async () => []` 的字面量）需同步补齐该方法（返回 []即可）；`workplace.service.ts` `loadContextMetadata` 填 `ctx.dirMtimeByPath`；provider 注入点在 `create-workplace-service.ts` 工厂内：工厂从 conn 自取 `SqliteSmartSortRuleRepository` 组装懒加载 provider（smart 排序时才查表）填 `ctx.smartRules`——三端 runtime（含 CLI）都经此工厂构造 workplace service，零逐端接线，CLI `workplace list` 自动获得 smart 排序。
- Step 7 — phase-core-service — blocking: yes — qa: auto：规则域 + service 全量：model/zod（`.strict()`，含 `flags` 字段：缺省 `''`，正则校验 `^[gimsuy]*$` 且不重复；错误走 `SmartSortRuleError` code 范式）/repo（SqlTemplateParser 模式）/service（`listRules / createRule / updateRule / deleteRule / deleteBatch（均对 `builtin-` 前缀拒绝，D3） / setEnabled / moveRule(id, to: top|bottom|up|down|index) / reorderRules(orderedIds) / setEnabledBatch / exportRules / importRules(替换式) / resetDefaults / previewSort(names, draftRules?) / listCompiledRules`）；`compile-smart-sort-rule.ts` 编译用 `new RegExp(pattern, flags)` try/catch（非法正则/非法 flags 均拒）+ 捕获组检查 + flags 合法性校验（字符集 ⊆ gimsuy）；`smart-sort-rule-io.ts` YAML bundle 单源（D10）；`public/smart-sort-rule.ts` + `package.json` exports `"./smart-sort-rule"`。
- Step 8 — phase-core-tests — blocking: yes — qa: auto：core 单测全集（见测试策略 T-SS/T-WE/T-SR/T-MIG，共 18 条）；同步 `public-workplace-allowlist.json`（新增导出符号按字母序手动加入）+ 新子路径快照；`test/package-exports/public-subpath-allowlist.test.ts` 的 `SUBPATHS` 常量加 `'smart-sort-rule'`（字母序插于 session-fs 与 vfs 之间）；`npm run build -w @novel-master/core` 重建 dist。
- Step 9 — phase-cli — blocking: yes — qa: auto：`main.ts` 注册 `"sort-rule"`；`sort-rule/commands.ts`：`list`（TSV：order⇥id⇥enabled⇥flags⇥name⇥pattern）、`create --name --pattern [--flags] [--example]`、`update --id [--name] [--pattern] [--flags] [--example]`、`remove --id`（对 `builtin-` 前缀报错，D3）、`enable|disable --id`、`move --id --to top|bottom|up|down|<N>`、`import --file <path>` / `export --file <path>`（走 core `parseText/stringifyText` + `smart-sort-rule-io.ts` decode/encode，参照 `agent/import-export.ts`）、`test <name...>`（positional 多文件名，输出逐行 `文件名⇥命中规则id⇥序号元组` + 空行 + 排序后列表）；`run-workplace.ts:148` `parseSortField` 加 `'smart'`。
- Step 10 — phase-desktop-ipc — blocking: yes — qa: auto：`ipc-types.ts`：`IPC_CHANNELS` 加 `nm:sort-rule/*`（list/create/update/delete/setEnabled/move/reorder/setEnabledBatch/deleteBatch/importRules/exportRules/resetDefaults/preview）+ DTO/Request（含 `flags` 字段）+ `WorkplaceSetDirRuleRequest.sortField` union 加 `'smart'`；`handlers/smart-sort-rule.ts`（IpcResult 范式）+ `handler-registry.ts` bind + `invoke-registry.ts` 封装 + desktop runtime 装配两步。
- Step 11 — phase-desktop-ui — blocking: yes — qa: auto：`settings-nav.ts` ViewId `smartSortRules`（「高级」组）+ navState（editingSmartSortRuleId）+ 高亮归并；`SettingsViews.tsx` 新视图：列表（启用 Switch（`ui/Switch.tsx`）+ name + example 小字 + ContextMenu（编辑/上移/下移/置顶/置底/删除，**`builtin-` 行隐藏删除项**（D3：内置仅可禁用），删除走 ConfirmModal 确认——不照抄 RegexRulesView 裸删行为）+ ManageHeader 批量（先扩 D12 actions）+ HTML5 拖拽 + 导入/导出/恢复默认按钮（yaml 走 main 进程 `yaml-shared.ts` 通道，新增 `smart-sort-rule-yaml.service.ts`，schema/encode/decode 引 core 单源 `smart-sort-rule-io.ts`）；编辑视图：名称/正则/**正则输入支持 /pattern/flags 字面量格式（core parsePatternInput 单源），无独立 flags UI；全量 flags 仍可经字面量/CLI/YAML**/示例表单 + 启用开关 + 测试预览（多行输入 → IPC preview → monospace `<pre>`，参照正则编辑器 footer 按钮模式）。
- Step 12 — phase-desktop-ui — blocking: yes — qa: auto：`DirectoryRuleModal.tsx`：`SORT_FIELDS` 加「智能排序」；分组文案「排序字段」→「排序方式」（`:167`）。
- Step 13 — phase-mobile-ui — blocking: yes — qa: auto：runtime 装配两步；导航注册五处（`types.ts`/`RootNavigator.tsx`/`header-config.ts`/`ProfileTabScreen.tsx` CONFIG_MENU）；`SmartSortRulesScreen`（列表 + Switch + ⋮ BottomSheetMenu（编辑/上移/下移/置顶/置底/删除，**`builtin-` 行隐藏删除项**（D3））+ `useBatchSelection`/`useBatchDeleteConfirm`/`ManageHeader actions` 批量启停删 + 导入导出（`yaml-shared.ts`+`document-io.ts`，导入 Alert 确认）+ 恢复默认）；`SmartSortRuleEditorScreen`（FormSectionCard 表单（名称/**正则输入支持 /pattern/flags 字面量格式（core parsePatternInput 单源），无独立 flags UI；mobile 正则字段全屏编辑（照 agent 配置先例）；全量 flags 仍可经字面量/CLI/YAML**/示例）+ 测试预览区，照抄 RegexRuleEditorScreen 的 useCallback+useEffect 联动模式，预览调 service.previewSort）。
- Step 14 — phase-mobile-ui — blocking: yes — qa: auto：`DirectoryRuleSheet.tsx` 选项 + 文案（`:35`/`:131`）；`vfs-direct-children-order.ts` `orderedDirectChildPaths` 经 runtime 取 `listCompiledRules` 传入可选参；扩展 `__tests__/vfs-direct-children-order.test.ts`；`npm run typecheck`（官方脚本，记忆 #38）。
- Step 15 — phase-mobile-drag — blocking: no — qa: manual_user：mobile 长按拖拽调序（自研 gesture-handler 手柄 + reanimated 位移，松手触发 `reorderRules`）；真机录屏验收，不过则砍（上移/下移已可用）。已移除（真机验收不生效，D8 移除注）
- Step 16 — phase-verify — blocking: yes — qa: auto：全量构建（core build → desktop build → mobile typecheck/test NODE_ENV=test）+ core 全测 + CLI 冒烟（`sort-rule list`/`test 第一章.txt 第十章.txt 第二章.txt` 输出核对）。
- Step 17 — phase-verify-device — blocking: yes — qa: manual_user：真机存量库升级验证（装旧版 → 选目录规则 name 保存 → 装新版 → 目录规则面板出现「智能排序」且可选、旧规则不丢）+ 智能排序真机效果验收（第一章…第十一章正序）。RN 侧改动 metro reload 即生效（记忆 #14，无 webview 涉及）。注：blocking 指**发版硬门槛**（schema 变更迭代须真机验收后才能发版，v9/v10 教训）；qa: manual_user 指由用户执行、不作为自动门禁阻塞项，两者并存不矛盾。

## 测试策略

### 测试用例

共 18 条（blocking 16 / 非 blocking 2；qa auto 16 / manual_user 2），每条标注实现 Step 映射：

- T-SS1 — blocking: yes — `parseChineseNum`：「一」~「一万零一百零一」边界、大写、逐位式「一零二五」、非法串返回 null（→Step 4）
- T-SS2 — blocking: yes — `tokenizeNatural`：`2.txt < 10.txt`、中文码位序、混合块（→Step 4）
- T-SS3 — blocking: yes — `extractSortKey`：优先级取首命中、捕获组不可解析时继续下一条、零捕获组被 validate 拒绝（→Step 4/7）
- T-SS4 — blocking: yes — 全序五条：有序号优先/逐位/前缀短前/自然回退/tiebreak/desc 反转，含「第一章 vs 第1章」确定性（→Step 4）
- T-SS5 — blocking: yes — 内置四规则按优先级列表语义断言（sort_order 1→4 逐条尝试、首命中负责提取）：`第2卷 第13章`→命中 builtin-zh-volume-chapter 提取 [2,13]、`第十二章 风起`→builtin-zh-chapter [12]（中文数字转数值）、`Chapter 12`→builtin-en-chapter [12]（flags 'i'）、`001、开端`→builtin-numeric [1]（含前导零转数值）（→Step 4/3）
- T-WE1 — blocking: yes — `sortFilesForDir` smart case（含 opts 缺省退化自然排序）（→Step 5）
- T-WE2 — blocking: yes — `sortDirPaths` 按 sortField 分派（name 零回归快照、created/updated 用目录 mtime、smart 用序号；另断言**缺省 dirMtimeByPath 时 created/updated 目录序与 name 输出一致**——D7 退化分支，mobile 孤儿路径形态）（→Step 5/6）
- T-WE3 — blocking: yes — `workplace-list-order.test.ts` 扩展：智能排序下 head/tail 展示档位随新序（→Step 5）
- T-MIG1 — blocking: yes — 旧 CHECK 库迁移后写 `'smart'` 成功、数据无损、幂等重跑（→Step 2）
- T-MIG2 — blocking: yes — 快路径/慢路径均执行 pending migration（新表在存量库建出）（→Step 2）
- T-SR1 — blocking: yes — service CRUD/move/reorder 全 API（整表重编号后 sort_order 连续 1..N），含 delete/deleteBatch 对 `builtin-` 前缀拒绝（D3）（→Step 7）
- T-SR2 — blocking: yes — `resetDefaults` 只删 `builtin-%` 且重灌，用户规则不动；seed 幂等且不覆盖存量行（禁用后重启/重跑 seed 保持禁用，D3）（→Step 3/7）
- T-SR3 — blocking: yes — export→import round-trip 无损（替换式，含 enabled/sort_order 顺序）（→Step 7）
- T-SR4 — blocking: yes — 非法正则/零捕获组/非法 flags（非 [gimsuy] 字符、重复 flag）create/update 被拒（错误 code 可辨）（→Step 7）
- T-MB1 — blocking: yes — mobile `vfs-direct-children-order.test.ts` smart 透传（NODE_ENV=test）（→Step 14）
- T-CLI1 — blocking: no — qa: auto — `sort-rule` 命令冒烟 + `test` 输出 TSV 可解析（本地 CLI 测试环境受限时以 CI 为准，记忆 #32）（→Step 9）
- T-DT1 — blocking: yes — qa: manual_user — 真机升级路径 + 智能排序效果录屏（→Step 17；发版硬门槛，用户执行，非自动门禁）
- T-DT2 — blocking: no — qa: manual_user — mobile 拖拽真机验收（→Step 15）

## 风险与回滚方案

1. **最高风险：bump/rebuild/DDL 三件套不齐**（v9/v10 同型事故）→ Step 1/2 拆细但同 phase 连续完成，T-MIG1/MIG2 双卡；真机 Step 17 验收存量库。
2. **迁移执行环境差异**：rebuild 在 quick-sqlite（真机）与 better-sqlite3（CLI/desktop）行为差异 → 沿用分块模板（两驱动都验证过的模式）+ 迁移单测跑双驱动测试连接。
3. **性能回归**：`computeDisplay` 对每 auto 文件全量排序的现状被智能比较放大 → decorate-sort-undecorate + 规则预编译 + key 缓存；如仍超预期，后续可按目录缓存（本迭代不做）。
4. **`sortDirPaths` 行为变化面**：created/updated 方向的子目录序会变（从恒字典序变为按 mtime）——这是 PRD 需求 5 的预期行为，验收口径已在 T-WE2 说明；name 方向零回归。
5. **mobile 拖拽真机风险** → Step 15 非 blocking，可砍退化为按钮调序。
6. **回滚**：代码回滚 = revert 分支合并；`SCHEMA_BOOT_VERSION` 不回退（单向升版），migration 幂等可重复执行；新表 `smart_sort_rule` 遗留无害（无 FK 被引用）。
7. **环境**：mobile 测试 `NODE_ENV=test`、desktop `NODE_ENV=development`（记忆 #22/#26）；core 改后必重建 dist（#10）；worktree lint 误报不当回归（#33）。

## 附录 A：内置规则集

（按 sort_order 优先级排列，首命中负责提取；flags 缺省为空字符串，seed 携带固定 sort_order 与 flags，与上表一致；已 node 验证四条均可编译、对 example 命中且提取正确。）

```text
builtin-zh-volume-chapter 「中文卷章复合」                    sort_order=1  flags=''
pattern: 第[ \t]{0,2}(NUM)[ \t]{0,2}卷[ \t]*[-—·.、]?[ \t]*第[ \t]{0,2}(NUM)[ \t]{0,2}章
（NUM = [0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}，两捕获组：卷、章）
example: 第2卷 第13章 → [2,13]

builtin-zh-chapter        「中文序号章节」                    sort_order=2  flags=''
pattern: 第[ \t]{0,2}([0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12})[ \t]{0,2}(?:章|节|集|部|篇|回|卷)
example: 第十二章 风起 → [12]

builtin-en-chapter        「英文章节」                        sort_order=3  flags='i'
pattern: (?:chapter|section|part|episode)[ \t]*[.．]?[ \t]*([0-9]{1,6})
example: Chapter 12 → [12]（大小写不敏感依赖 flags 'i'）

builtin-numeric           「数字序号开头」                    sort_order=4  flags=''
pattern: ^[ \t]*([0-9]{1,6})[ \t]*(?:[、.．\-—_]|$)
example: 001、开端 → [1]
```

说明：

1. **前置必要性**：zh-chapter 后缀类含「卷」，单独可命中「第2卷 第13章」但只提取卷号 [2]（丢章号，已验证）——volume-chapter 必须排在前，避免被单序号规则抢占。
2. **目录名场景**：zh-chapter 后缀类含「卷」的另一面：「第一卷」「第十卷」这类目录名命中 zh-chapter 提取 [1]/[10]（已验证），子目录智能排序依赖此行为（PRD 验收「子目录 [第一卷， 第三卷， 第十卷] 按卷序排列」）。

（`parseChineseNum` 输入含阿拉伯数字混排时按 legado `stringToInt` 语义：整组可 `Number()` 直接转，否则中文解析，失败该组 null → 该规则跳过继续下一条。）

## Context Bundle

```yaml
iteration_name: smart-filename-sort
requirement_path: docs/Iterations/smart-filename-sort/prd.md
spec_path: docs/Iterations/smart-filename-sort/spec.md
explore_summary: 三轮探索覆盖 workplace 排序链路与迁移机制（rebuildTable 模板在 git 5d271868^）、regex 域/CLI/YAML 全链模板、双端 UI 与依赖现状（reanimated/gesture-handler 就绪但无拖拽先例；yaml 仅 core 有）
impact_files: [packages/core(bootstrap/workplace/service/domain), apps/desktop(ipc/settings/workspace), apps/mobile(navigation/screens/vfs), apps/cli(main/sort-rule)]
constraints: [SCHEMA_BOOT_VERSION 三件套, NODE_ENV 测试隔离, core dist 重建, worktree 开发并入 dev]
blocking_steps: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17]
```
