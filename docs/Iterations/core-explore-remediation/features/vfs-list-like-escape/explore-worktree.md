# Worktree 域 — 代码审查

**日期：** 2026-06-21  
**审查者：** Agent（explore pass）  
**范围：** `packages/core/src/domain/worktree/**`、`packages/core/src/service/worktree/**`、`packages/core/test/worktree/**`、`packages/core/src/public/worktree.ts`  
**已运行测试：** `npx tsx --test test/worktree/*.test.ts` — **33/33 通过**

---

## 执行摘要

worktree 域**结构良好且大体正确**。纯 evaluation/display 逻辑与持久化、编排 cleanly 分离；服务按 spec 实现 metadata-first 遍历与 lazy content read。eval、display、materialization 及与 template pull / session snapshot 的集成测试覆盖强。

**总体结论：批准， minor follow-up。** 范围内未发现阻塞性正确性 bug。主要关注 spec 漂移（labels、默认 `tail`）、`materialize()` 冗余工作、重复辅助函数及若干可维护性 nit。

| 领域 | 评级 | 说明 |
|------|------|------|
| 代码风格 | B+ | 约定扎实；中英文档与 `@module` 路径混杂 |
| 可维护性 | B | 分层清晰；有重复与性能空间 |
| 正确性 | A- | 逻辑符合 unified-root 模型；minor spec 不匹配 |
| 测试覆盖 | B+ | 33 个测试；tree helper、labels、边界有缺口 |

---

## 架构概览

```
public/worktree.ts          ← package export surface (@novel-master/core/worktree)
        │
service/worktree/           ← WorktreeService (orchestration)
  create-worktree-service.ts
  impl/worktree.service.ts
        │
domain/worktree/
  model/worktree-types.ts   ← enums + DTOs
  logic/                    ← pure functions (eval, display, tree, scope, path-map)
  repositories/             ← WorktreeRepository port + SqliteWorktreeRepository
        │
bootstrap/worktree/worktree-schema.ts   ← DDL (out of scope but referenced)
        │
Related (exported from public/worktree.ts):
  service/template/*        ← copyScope on template pull
  service/prompt/*          ← SessionWorktreeSnapshotStore
```

**设计优点**

- **六边形边界：** 域 logic 无 infra import（除共享 VFS path helper）；repository 在 port 后。
- **纯核心：** `worktree-eval.ts`、`worktree-display.ts`、`worktree-tree.ts`、`front-matter.ts` 可无 DB 测试。
- **Lazy I/O：** `walkDir` 仅在 `display === "full" | "header"` 时读文件 content；测试断言 `scanContents` 从未调用且 `findByPath` 有界。
- **Unified root 对齐：** `worktreeRootLogicalPath` 对所有 scope 返回 `/`；path map 在 vfs-unified-root 后为 identity —— 与当前 mapper 一致。

---

## 文件清单

| 路径 | 角色 | 行数（约） |
|------|------|------------|
| `model/worktree-types.ts` | 类型、DTO | 74 |
| `logic/default-dir-rule.ts` | 默认 dir rule 常量 | 19 |
| `logic/worktree-eval.ts` | Display state、排序、head/tail | 152 |
| `logic/worktree-display.ts` | `<file>` block 渲染 | 75 |
| `logic/worktree-file-tree.ts` | ASCII 树 + macro load labels | 143 |
| `logic/worktree-labels.ts` | 中文 list/macro labels | 53 |
| `logic/worktree-path-map.ts` | Project ↔ session path（identity） | 22 |
| `logic/worktree-scope.ts` | Scope keys、root path | 39 |
| `logic/worktree-tree.ts` | Dir set、parent/child helper | 102 |
| `logic/front-matter.ts` | Markdown front matter split/parse | 65 |
| `repositories/worktree.port.ts` | Repository 接口 | 48 |
| `repositories/impl/sqlite-worktree.repository.ts` | SQLite 实现 | 202 |
| `service/worktree/worktree.port.ts` | Service 接口 | 47 |
| `service/worktree/create-worktree-service.ts` | 工厂 | 30 |
| `service/worktree/impl/worktree.service.ts` | Default service | 346 |
| `public/worktree.ts` | Public 导出 | 51 |

**测试：** 10 个文件，33 个用例 —— eval（7）、display（6）、file-tree（3）、materialize（6）、path-map（2）、default-dir-rule（1）、getDirRule（1）、list-order（1）、session snapshot（2）、template-pull（4）。

---

## 代码风格

### 做得好的部分

- 一致使用 `@/` path alias、DTO 字段 `readonly`、`DEFAULT_WORKTREE_DIR_RULE` 中 `satisfies`。
- 公共函数与模块头 JSDoc 与 sibling 域（regex、vfs、chat）一致。
- 根 rule 禁用错误明确：`"cannot disable rules on root directory"`。
- SQL 用参数化模板（`#{scopeKey}`）—— 无用户输入字符串拼接。

### 问题

| ID | 严重程度 | 发现 |
|----|----------|------|
| S1 | Minor | **文档语言混杂。** 英文模块头（`worktree-eval.ts`、`worktree-types.ts`）vs 中文（`default-dir-rule.ts`、`worktree-file-tree.ts` macro 注释、`worktree-labels.ts`）。按层统一约定或文档化双语策略。 |
| S2 | Nit | **`@module` 路径与文件路径不符。** 如 `front-matter.ts` 声明 `@module domain/worktree/front-matter` 但在 `logic/` 下。`worktree-display.ts` 同理。 |
| S3 | Nit | **`worktree.service.ts:333` 中 `TreeContextMetadata` 内联 type import** 而非顶层 import —— 与文件其余不一致。 |
| S4 | Nit | **`WorktreeListRow` 字符串字段**（`ruleState`、`inclusionMode`、`displayState`）在 model 层为无类型 `string`；labels 在服务边界应用。TSV 输出可接受；若消费者期望 enum key 则失去类型安全。 |

---

## 可维护性

### 优点

- **每个 logic 文件单一职责** —— 易导航。
- **工厂装配**（`createWorktreeService`）使 CLI/测试免手动 DI。
- **`copyScope`** 封装 template-pull / session-create 继承；`template-pull.service.ts` 中事务用法清晰。

### 问题

| ID | 严重程度 | 发现 | 建议 |
|----|----------|------|------|
| M1 | Major | **`basename()` 重复**于 `worktree-eval.ts` 与 `worktree-display.ts`；`worktree-file-tree.ts`（`entryName`）有类似逻辑。 | 在 `worktree-tree.ts` 或 tiny `worktree-path.ts` 提取共享 `logicalBasename()`。 |
| M2 | Major | **`materialize()` 两次加载 metadata。** `walkDir` 调用一次 `loadContextMetadata()`；随后 `renderFileTree()` 再加载。测试记录此点（`listFileMetaUnderPrefix` 调用 3× vs 2×）。 | 从 walk 传入 `TreeContextMetadata` + 预计算 `displayByPath`，或单次调用链缓存 metadata。 |
| M3 | Minor | **`renderDisplay()` 委托完整 `materialize()`**，仅需 `<file>` blocks 时仍构建 `filetreeDisplay`。 | 加 `renderDisplayOnly()` 路径或 `materialize` 可选 flag。 |
| M4 | Minor | **`directChildDirs` DFS 时每目录扫描整个 `allDirs` set** —— O(dirs × totalDirs)。典型 VFS 大小 OK；大树可能 matter。 | 若 profiling 有 pain，在 `loadContextMetadata` 一次构建 adjacency map。 |
| M5 | Minor | **`copyScope` N 次顺序 upsert** —— 无 batch insert。rule 数量可接受；scope 变大时注意。 | 需要时在事务中 batch INSERT。 |
| M6 | Nit | **`public/worktree.ts` barrel 混合关注点：** worktree 域 + template pull + session snapshot。对 `@novel-master/core/worktree` 消费者方便但模糊包边界。 | 在 export 头文档化或后续拆 subpath export。 |
| M7 | Nit | **`FRONT_MATTER_START` 与 `FRONT_MATTER_END`** 为相同 regex 常量 —— 可合并为一个 `FRONT_MATTER_DELIMITER`。 |  cosmetic 去重。 |

---

## 正确性

### 已验证行为（符合 spec / 测试）

1. **Display 优先级：** `hide` → `show` → `auto` + 父 rule → head/tail → fill policy（`worktree-eval.test.ts`）。
2. **Head/tail 去重：** `computeHeadTailIndices(5, 2, 1)` → indices `{0,1,4}`。
3. **非 `.md` 上 fill `header`：** 返回 `hidden`。
4. **根 rule 始终 on；** 不能经 `setDirRule` 禁用。
5. **DFS 顺序：** 每层 child 目录在 sibling 文件之前（`worktree-list-order.test.ts`）。
6. **Lazy content read：** filename/hidden 从不调用 `findByPath`；show/full 文件会（`worktree-materialize.test.ts`）。
7. **Unified-root 后 path map identity**（`worktree-path-map.test.ts`、`template-pull.test.ts`）。
8. **`created` / `updated` 排序均用 `mtimeMs`** —— virtual-worktree spec 文档化（VFS 无单独 created time）。
9. **`<file>` attrs：** `createdAt`/`updatedAt` 均来自 mtime；`updatedBy="user"` 按 spec 固定。
10. **XML 转义**于 path attributes（`worktree-display.test.ts`）。

### 潜在问题 / spec 漂移

| ID | 严重程度 | 发现 | 详情 |
|----|----------|------|------|
| C1 | Major | **Inclusion label 不匹配。** Spec 表映射 `auto` → `自动`；实现在 `worktree-labels.ts` 用 `跟随`。 | CLI/list 输出与 virtual-worktree spec 不同。确认产品意图；对齐 label 或更新 spec。 |
| C2 | Major | **默认 `tailCount` 漂移。** `DEFAULT_WORKTREE_DIR_RULE.tailCount = 1000` 与 schema 默认 `1000`；virtual-worktree spec 对新 dir rule 说 `tail=0`。 | 对 ≤1000 个 `auto` 文件且无显式 dir rule 行（根情况）的目录，**全部**文件进入 head/tail 优先级 → `full`，非 `header` fill。有意「根默认全展示」还是 oversight？文档化或与 spec 对齐。 |
| C3 | Minor | **Schema vs 服务 default 的 `fill_policy`。** DDL 默认 `'hidden'`；经 `setDirRule` 持久化时服务默认 `'header'`。服务总是显式写行，运行时一致；raw SQL insert 会不同。 | DDL default 与 `DEFAULT_WORKTREE_DIR_RULE` 对齐或文档化「服务为 source of truth」。 |
| C4 | Minor | **SQLite enum 列无校验。** `rowToDirRule` 用 `as SortField` cast `sort_field`、`fill_policy` 等。损坏 DB → 静默无效值进入 eval。 | 加窄 validator 或回退 default（可选加固）。 |
| C5 | Minor | **`setFileRule` 不验证 path 为文件**（或存在）。可为不存在 path 存 rule；文件后创建时出现 —— 可能为预配置有意。 | 文档化行为；可选 assert VFS entry kind。 |
| C6 | Info | **`sortDirPaths` 忽略父 `sortField`。** 仅 `sortOrder` 与 basename tie-break 用于目录；spec 说「同级目录按该目录的目录规则排序（无规则则用 name + asc）」。Dir entry 排序子项时用**自身** rule，非父 `sortField` 排 sibling dir 名 —— 匹配「该目录的目录规则」但 worth  noting：L 层 sibling **dirs** 仅用**父** `sortOrder`，不用 `sortField`。 | 确认 dir 是否应对 name vs created/updated  respect 父 `sortField`。当前总是 basename。 |
| C7 | Info | **`evaluateFileDisplay` index 回退 `index < 0 ? 0`。** 安全因 `hide`/`show` 在 index 使用前短路；仅 `auto` 文件应到 index 逻辑且必须在 `autoSiblings` 中。 | 非 bug；略 opaque —— dev 中 comment 或 assert。 |

### 根 / 默认 rule 交互（ subtle）

对**非根目录**：

- 无持久化 dir rule 行 → `resolveRuleState` → `rule_off` → 所有 `auto` 文件 **hidden**。
- 显式 `setDirRule`（即使 partial）→ 除非 `--rule off` 否则 `ruleEnabled: true` → 行用 merged default 创建。

对**根 `/`**：

- 无行也始终 `rule_on`。
- Eval 在 `dirRule` 为 null 时用 `DEFAULT_WORKTREE_DIR_RULE` → head=0, tail=1000, fill=header。
- 效果：小树（≤1000 文件）→ 根上所有 `auto` 文件 **full**；大树 → 中间文件 **header**（对 `.md`）。

该行为在大树 header 用例**有测试**但模块注释**未文档化**。

---

## 服务层审查

### `DefaultWorktreeService`

**良好：**

- 所有 mutating/query 路径 path 规范化 + `assertLogicalPathAllowed`。
- `setDirRule` merge 语义：无显式 `ruleEnabled: false` 的任意 save 开启 rules（L83–84 注释）。
- `buildListRows` vs `materialize` 共享 `walkDir`，`displayBlocks: null | string[]` —— DRY 遍历。
- `computeDisplay` 正确为 head/tail index 过滤 `autoSiblings`，列出所有文件 sorted 用于输出顺序。

**注意：**

```typescript
// materialize() — renderFileTree() re-loads all metadata
async materialize(): Promise<WorktreeMaterialized> {
  const ctx = await this.loadContextMetadata();
  // ... walkDir ...
  return {
    listRows,
    worktreeDisplay: joinFileBlocks(blocks),
    filetreeDisplay: await this.renderFileTree(), // second loadContextMetadata()
  };
}
```

### `SqliteWorktreeRepository`

**良好：** 读写路径规范化；caller 事务包装时 `copyScope` delete-then-copy 原子。

**注意：** `findDirRule` / `findFileRule` 用 `rows[0]!` —— length 检查后安全。

---

## 公共 API（`public/worktree.ts`）

导出对 CLI/mobile 消费者连贯：

- 类型 + eval/display/tree 纯函数
- `createWorktreeService` 工厂
- 相关：`createTemplatePullService`、`createSessionWorktreeSnapshotStore`

**未导出（内部）：** `WorktreeRepository`、`WorktreeFileRule`、`SqliteWorktreeRepository`、tree helper —— 符合 spec（「repository 不导出」）。

**说明：** 独立包 export `./front-matter` 直接指向域文件 —— tree-shaking OK。

---

## 测试覆盖评估

### 覆盖良好

| 领域 | 测试 |
|------|------|
| Eval / head-tail / fill policies | `worktree-eval.test.ts` |
| Display / front matter / XML escape | `worktree-display.test.ts` |
| ASCII file tree | `worktree-file-tree.test.ts` |
| Materialize lazy I/O + list 一致性 | `worktree-materialize.test.ts` |
| DFS list 顺序 | `worktree-list-order.test.ts` |
| Dir rule CRUD readback | `worktree-get-dir-rule.test.ts` |
| Template pull + session 继承 | `template-pull.test.ts` |
| Snapshot store dirty refresh | `session-worktree-snapshot.test.ts` |

### 缺口（建议补充）

| 缺口 | 建议测试 |
|------|----------|
| `worktree-tree.ts` | `parentDirOf`、`directChildFiles`、`buildWorktreeDirSet` 单元测试（空 dir、仅配置 path） |
| `worktree-scope.ts` | 三种 kind 的 `worktreeScopeKey`；`isWorktreeRootPath` |
| 根 rule 护栏 | `setDirRule({ logicalPath: '/', ruleEnabled: false })` 抛错 |
| `setDirRule` enable 语义 | 仅 `headCount` save 重新启用先前 disabled rule |
| `sortFilesForDir` / `sortDirPaths` | 显式排序用例（name desc、mtime、tie-break full path） |
| `renderWorktreeFileTreeForMacro` | 文件上 load-state 后缀 |
| `parseMarkdownFrontMatter` | 空 front matter block（`---\n---\n`） |
| Repository | `copyScope` path mapping + deleteScope 集成测试 |
| Label 契约 | 断言 `inclusionModeLabel('auto')` 与产品 spec 一致（`自动` vs `跟随`） |

---

## 安全与数据完整性

- **SQL 注入：** 模板参数缓解。
- **路径遍历：** `normalizePath` + `assertLogicalPathAllowed` 缓解。
- **Display 中 XML 注入：** Attribute 转义存在；文件**正文**不转义（行内容 raw 注入 `<file>` —— 为 LLM 消费有意，非 HTML）。
- **Scope 隔离：** `scope_key` PK 前缀保证 global/project/session rule 分离。

---

## 建议（按优先级）

### 应修复 / 澄清

1. **解决 `auto` label：** `跟随` vs spec `自动` —— 产品决策。
2. **文档化或对齐默认 `tailCount`：** 1000 vs spec 0；解释小树根行为。
3. **消除 `materialize()` 双重 metadata 加载** —— 直接性能收益。

### 锦上添花

4. 提取共享 `basename` helper。
5. 修正 `@module` 注释路径含 `logic/`。
6. 为 `worktree-tree.ts` 与根 rule 护栏加单元测试。
7. DDL default `fill_policy` 与服务 default 对齐或读时加 row 校验。

### 无需行动

- Identity path map（unified-root 后）。
- `created`/`updated` 均用 mtime。
- Repository 不从 public API 导出。

---

## 结论

worktree 域对其当前 scope **已达生产质量**：关注点分离清晰，eval/display 语义正确，集成测试强。发现的问题为**可维护性与 spec 对齐**而非功能破坏。处理 C1–C2（labels 与默认 tail 语义）与 M2（重复 metadata 加载）可将模块提升至 **A** 评级。

---

## 附录：关键代码引用

**默认 dir rule（注意 `tailCount: 1000`、`fillPolicy: "header"`）：**

```12:18:packages/core/src/domain/worktree/logic/default-dir-rule.ts
export const DEFAULT_WORKTREE_DIR_RULE = {
  sortField: "name" as const satisfies SortField,
  sortOrder: "asc" as const satisfies SortOrder,
  headCount: 0,
  tailCount: 1000,
  fillPolicy: "header" as const satisfies FillPolicy,
} as const;
```

**Inclusion label（`auto` → `跟随`，spec 说 `自动`）：**

```17:25:packages/core/src/domain/worktree/logic/worktree-labels.ts
export function inclusionModeLabel(mode: InclusionMode): string {
  switch (mode) {
    case "auto":
      return "跟随";
    case "show":
      return "展示";
    case "hide":
      return "隐藏";
  }
}
```

**Eval 优先级链：**

```97:131:packages/core/src/domain/worktree/logic/worktree-eval.ts
  if (params.inclusion === "hide") {
    return "hidden";
  }
  if (params.inclusion === "show") {
    return "full";
  }
  if (!params.parentRuleOn) {
    return "hidden";
  }
  // ... head/tail + fill policy ...
```

**Walk 中 lazy content read：**

```308:324:packages/core/src/service/worktree/impl/worktree.service.ts
      if (displayBlocks != null && display !== "hidden") {
        let content = "";
        if (display === "full" || display === "header") {
          const physical = toPhysicalPath(this.scope, filePath);
          const entry = await this.deps.vfs.findByPath(physical);
          content = entry?.content ?? "";
        }
        displayBlocks.push(renderFileBlock({ ... }));
      }
```
