# VFS 域 — 代码审查报告

**日期：** 2026-06-21  
**范围：** `packages/core/src/domain/vfs/**`、`packages/core/src/service/vfs/**`、`packages/core/src/bootstrap/vfs/**`、`packages/core/test/vfs/**`、`packages/core/src/public/vfs.ts`  
**重点：** 代码风格、可维护性、正确性

---

## 执行摘要

VFS 有界上下文**结构良好**，遵循项目六边形分层约定：域 model/port/logic、SQLite adapter 共置于 `repositories/impl`、revision 历史与 scope 映射的服务装饰器，以及 `public/vfs.ts` 中清晰的 public facade。错误处理类型化且一致（`VfsError`、`VfsZipError`）。核心流程（CRUD、scoping、move/copy、ZIP、revisions、user-save mapping）测试覆盖较广。

主要关注点是**正确性边界情况**（`list()` 中 SQL `LIKE` 通配符泄漏、非原子 move/copy、copy 静默覆盖）、**可维护性债务**（重复辅助函数与 `replace()` 逻辑、中英注释混杂、`normalize-path` 在仓储 impl 但跨域使用），以及 **API 清晰度**（`grep` 为子串搜索而非 regex）。无阻塞性架构缺陷；建议修复为增量式。

| 严重程度 | 数量 | 主题 |
|----------|------|------|
| 高 | 1 | `list()` LIKE pattern |
| 中 | 4 | 原子性、copy 覆盖、多 hunk edit、重复逻辑 |
| 低 | 6 | 命名、可扩展性、stub 类型、external storage |

---

## 架构概览

```text
public/vfs.ts
    └── re-exports domain ports, logic, service factories

service/vfs/
    create-vfs-service.ts          → DefaultVfsService + RevisionAwareVfsService
    create-scoped-vfs-service.ts   → above + ScopedVfsService(scope)
    create-vfs-zip-io-service.ts   → DefaultVfsZipIoService
    impl/
        vfs.service.ts             → DefaultVfsService (repo delegate)
        revision-aware-vfs.service.ts → write/delete append vfs_revision
        scoped-vfs.service.ts      → logical ↔ physical path mapping
        vfs-zip-io.service.ts      → export/import transactional replace

domain/vfs/
    model/          VfsEntry, VfsRevision, options
    ports/          VfsService, VfsZipIoService, VfsRestorePort
    repositories/   VfsEntryRepository, VfsRevisionRepository + SQLite impl
    logic/          path-mapper, move/copy/tree-copy, ZIP, user-save mapping

bootstrap/vfs/
    vfs-schema.ts, vfs-revision-schema.ts
```

**分层合规：** 符合 `ARCHITECTURE.md` —— `VfsService` port 在域内；builtin tools 仅依赖域 port。SQLite repo 在 `domain/vfs/repositories/impl/` 为 documented exception。

**Scope 模型：**

| Scope | 物理前缀 | 逻辑根 |
|-------|----------|--------|
| `global` | `/template` | `/` |
| `project` | `/projects/{id}/template` | `/` |
| `session` | `/projects/{id}/sessions/{sessionId}` | `/` |

显式拒绝 legacy `/template/...` 逻辑路径（无双读）。

---

## 优点

### 1. 清晰的 port–adapter 分离

`VfsService` 定义稳定能力面（list、read、write、replace、glob、grep、delete、mkdir）。实现可干净组合：

- `DefaultVfsService` → repository
- `RevisionAwareVfsService` → 装饰 write/delete，追加 append-only `vfs_revision`
- `ScopedVfsService` → 按 `VfsScope` 映射逻辑路径

工厂（`createVfsService`、`createScopedVfsService`）在一处装配依赖。

### 2. Revision 历史设计

`RevisionAwareVfsService` 正确：

- 在事务中包装 write/delete，外层事务已开时有 `NESTED_TRANSACTION` 回退（session-fs 边界）。
- 历史存在但 entry 行已删时，在 `maxRevision + 1` 重建 `vfs_entry`（rollback restore 路径）。
- 文件删除时在 `headVersion + 1` 追加 `deleted` revision。

### 3. ZIP import 安全

`validateVfsZipEntries` 强制：

- Entry 数量 / 未压缩大小上限（5 000 entries、32 MiB）
- 路径遍历拒绝（`..`、Windows 驱动器路径、跨域 `projects/` 前缀）
- UTF-8 往返校验（Hermes 兼容）
- 显式确认门（`confirmed: true`）
- Import 全事务 replace（删前缀 → insert）

### 4. 类型化错误

`VfsError` codes 覆盖操作矩阵（NOT_FOUND、CONFLICT、IS_DIRECTORY 等）。`isVfsError` 处理重复模块实例与 `error.cause` —— 对 test/dist 边界重要。

### 5. 测试覆盖

15 个测试文件覆盖集成路径、纯逻辑与边界（GBK ZIP fixture、import rollback hook、scoped 隔离、revision GC）。测试用共享 `novelMasterTestFixture` 做 realistic DB bootstrap。

---

## 代码风格

### 做得好的部分

- Model 与 port 接口一致使用 `readonly`。
- 多数文件有 JSDoc `@module`；非显而易见行为有 `@remarks`（如 move 变更前冲突检查）。
- 工厂命名（`createVfsService`）符合项目约定。
- `logic/` 纯函数无副作用，可隔离测试。

### 问题

| 问题 | 位置 | 建议 |
|------|------|------|
| **语言混杂** | `user-vfs-save-mapping.ts`、`action-xml-to-tool-uses.ts`、`vfs-zip-central-dir.ts`、`vfs-zip-parse.ts`、`build-user-vfs-turn-op.ts`、`vfs-schema.ts`（中文 DDL 注释）vs 其余英文 | 按项目规范统一内联注释/JSDoc 语言，或文档化双语策略 |
| **`@module` 路径不一致** | `vfs-path-mapper.ts` → `@module domain/vfs/vfs-path-mapper`；`vfs-tree-copy.ts` → `@module domain/vfs/vfs-tree-copy`（缺 `/logic/`） | 标签与实际路径对齐 |
| **重复类型别名** | `VfsEntryKind` 在 `vfs-entry.ts` 与 `vfs-list-entry.ts` 均有定义 | 从一个 model 文件 export；另一处 re-export |
| **无意义类型别名** | `vfs-revision.port.ts` 中 `VfsRevisionAppendInput = Omit<VfsRevision, never>` | 直接用 `VfsRevision` 或 `type VfsRevisionAppendInput = VfsRevision` |
| **模块级可变计数器** | `build-user-vfs-turn-op.ts` 中 `let toolIdSeq = 0` | UI turn ID 可接受；文档化线程/进程假设或注入 ID 生成器以利测试确定性 |

---

## 可维护性

### 重复热点

1. **`replace()` 逻辑** —— `DefaultVfsService` 与 `RevisionAwareVfsService` 实现相同。共享纯辅助（如 `computeReplaceResult(content, oldString, newString, replaceAll)`）可消除漂移风险。

2. **路径前缀辅助** —— `normalizePrefix`、`relativeUnderPrefix`、`escapeLike` 出现在：
   - `sqlite-vfs-entry.repository.ts`
   - `vfs-tree-copy.ts`
   - `vfs-zip-io.service.ts`（`relativeUnderPhysicalPrefix`）

   合并到 `logic/`（如 `path-prefix.ts`）供 repo 与服务共享。

3. **`normalize-path.ts` 位置** —— 在 `repositories/impl/` 但被域 logic（`vfs-path-mapper`、`vfs-zip-path`、`parent-dir`、服务）import。视觉上颠倒预期依赖方向。移到 `domain/vfs/logic/normalize-path.ts`（repo 可 re-export）。

### 服务分层说明

- `RevisionAwareVfsService` 重写 write/delete 而非 inner + hook —— 为事务边界有意，但增大维护面。
- `createVfsService` 暴露**物理路径** VFS（测试直接写 `/new.txt`）。`createScopedVfsService` 为用户面向路径。文档化调用方应使用哪个工厂，避免 scope 泄漏。

### 公共 API 面

`public/vfs.ts` 导出 66 个符号 —— 较宽但连贯。 notable 导出：

- 低级 tree op（`replaceVfsSubtree`、`copyVfsPath`、path mapper）—— 适合 worktree/checkpoint 调用方。
- 域级 ZIP build/parse —— 允许 CLI/测试绕过 service wrapper。

若面继续增长可考虑分组导出（当前无需行动）。

### Stub / 未来工作

- `VfsStorageKind = "inline" | "external"` 与 `external_uri` 列存在；所有 insert 用 `'inline'`。ZIP export 拒绝 external 行。Schema 预示未来工作 —— 文档化为 v2 或不需要前移除。

---

## 正确性

### 高 — `list()` 目录路径中 LIKE 通配符

**文件：** `sqlite-vfs-entry.repository.ts`

```typescript
const likePattern = listPrefix(normalizedDir);
// listPrefix: dir === "/" ? "/%" : `${dir}/%`
```

`likePattern` **未**经 `escapeLike()`，与 delete/prefix 查询不同。若目录路径含 SQL LIKE 元字符（`%`、`_`），`list()` 返回错误子项。

**示例：** 目录 `/notes/v1%draft`，LIKE pattern `/notes/v1%draft/%` 也会匹配 `/notes/v1Xdraft/file`。

**修复：** 构造 `likePattern` 时使用 `escapeLike(normalizedDir)`（与 `delete`、`listEntriesUnderPrefix` 相同模式）。

---

### 中 — Move/copy 非原子

**文件：** `vfs-move.ts`、`vfs-copy.ts`

文件 move 为 `read → write(to) → delete(from)` 无事务。write 后失败会留下重复文件；delete 后失败会丢数据。

目录 move 顺序遍历文件 —— 部分完成会得到分裂树。

**缓解选项：**

- 文档化为 best-effort（agent tools 可重试）。
- 在仓储层加可选事务 move（批量 path rename）用于 session scope。
- 至少：scoped service 时用 revision-aware 事务包装（当前 move 逐个调用 port 方法）。

Move **会**在变更前调用 `assertMoveTargetAvailable` —— 冲突预防良好。

---

### 中 — `copyVfsPath` 静默覆盖目标

与 `moveVfsPath` 不同，copy 不检查 `to` 是否已存在。`write(..., { versionCheck: false })` 覆盖文件；目录 copy 经相同机制覆盖嵌套文件。

**建议：** copy 前复用 `assertMoveTargetAvailable`（或共享 `assertPathAvailable`），或在 `CopyVfsPathOptions` 中文档化覆盖语义。

---

### 中 — 多 hunk 用户 save edit

**文件：** `user-vfs-save-mapping.ts`

`mapUserSaveToToolUses` 发出多个 `edit` tool use，每个锚定在**原始 baseline**。顺序应用会在 hunk 间变更 live content。非重叠行区域通常可行，但：

- 区域相邻时扩展 anchor context 可能在 hunk 间重叠。
- 若 tool 执行在 hunk 间重读文件，后续 `oldString` 可能不匹配。

测试覆盖简单情况；为两个 distant hunk 与两个 adjacent hunk 加集成测试。

---

### 中 — `grep` 为字面子串搜索

**文件：** `vfs.service.ts`

```typescript
const columnIndex = line.indexOf(pattern, searchFrom);
```

Port 与方法名暗示 regex；实现为字面 `indexOf`。调用方传 regex 元字符得到字面匹配。重命名为 `search` 或文档化 `pattern` 为字面子串；仅当产品需要时加 regex。

---

### 低 — `glob` 加载全部文件路径

`listAllPaths()` 取每条文件路径再在内存过滤。当前规模可接受；VFS 变大时可能需要前缀 scope 查询。

---

### 低 — `actionXmlToToolUses` write fallback 丢弃 content

`method="write"` 时 derived input 为 `{ path, content: "" }`。对 flush/compression 有意（content 在别处），但单独 round-trip XML 时 surprising。在 port JSDoc 中说明。

---

### 低 — `deleteExceptReachable` N+1 delete

**文件：** `sqlite-vfs-revision.repository.ts`

循环逐条删 revision 行。大 history GC 可能慢。候选集大时用 temp table 或 `NOT IN` 批量 DELETE。

---

### 低 — 仅目录树与隐式根

`list()` 设计上省略 scope 根行；`moveVfsDirectory` 用 `mkdirIgnoreExists` 补偿。空目录标记依赖显式 `insertDirectory` 或 ZIP import。行为一致但 subtle —— `directory-nodes.test.ts` 覆盖。

---

### 已验证正确性（积极）

| 行为 | 证据 |
|------|------|
| 乐观并发 | `head_version` update 检查； stale `expectedVersion` → CONFLICT |
| 默认 update 需要 version | `versionCheck !== false` 需要 `expectedVersion` |
| Scoped 隔离 | `scoped-vfs.service.test.ts` — session 对 project 不可见 |
| Legacy 路径拒绝 | `/template/...` → INVALID_PATH |
| ZIP import rollback | 事务包装 delete + insert；测试 hook 验证 |
| Write 时自动创建父目录 | `ensureParentDirectories` 经 `isStorageRootParent` 跳过 storage root |
| 递归 delete revision append | 仅文件得 deleted revision；仅目录 delete 跳过 revision 行 |

---

## 测试覆盖评估

| 领域 | 测试 | 缺口 |
|------|------|------|
| DefaultVfsService CRUD/replace/glob/grep | `default-vfs.service.test.ts` | grep regex 语义；list 中含 `%`/`_` 的路径 |
| Revision 历史 | `revision-aware-vfs.service.test.ts` | GC（`deleteExceptReachable`）；entry 移除后 restore |
| Scoped 路径 | `scoped-vfs.service.test.ts`、`vfs-path-mapper.test.ts` | glob/grep 过滤边界 |
| Move/copy | `vfs-move.test.ts`、`vfs-copy.test.ts` | copy 覆盖；部分 move 失败 |
| ZIP | `vfs-zip-parse.test.ts`、`vfs-zip-io.test.ts` | — |
| User save mapping | `user-vfs-save-mapping.test.ts` | 多 hunk 相邻区域 |
| Repository | `sqlite-vfs-entry.repository.test.ts` | list 中 LIKE escape |
| 纯 logic | `glob-match.test.ts`、`action-xml-to-tool-uses.test.ts` | — |
| Bootstrap DDL | `bootstrap.test.ts` | — |

**缺失测试文件：** 无专用 `sqlite-vfs-revision.repository.test.ts`（revision repo 间接测试）。

---

## 文件清单

### 域 — Model（4）

| 文件 | 角色 |
|------|------|
| `model/vfs-entry.ts` | 持久化行形态 |
| `model/vfs-list-entry.ts` | List DTO |
| `model/vfs-options.ts` | Repo list/write/delete options |
| `model/vfs-revision.ts` | Append-only revision 行 |

### 域 — Ports（4）

| 文件 | 角色 |
|------|------|
| `ports/vfs-service.port.ts` | 主能力契约 |
| `ports/vfs-zip-io.port.ts` | ZIP import/export |
| `ports/vfs-restore.port.ts` | Checkpoint restore 子集 |
| `repositories/vfs-entry.port.ts` | Entry 持久化 |
| `repositories/vfs-revision.port.ts` | Revision 持久化 |

### 域 — Logic（14）

| 文件 | 角色 |
|------|------|
| `logic/vfs-path-mapper.ts` | Scope 逻辑 ↔ 物理 |
| `logic/vfs-move.ts` | 经 VfsService move/rename 树 |
| `logic/vfs-copy.ts` | 经 VfsService copy 树 |
| `logic/vfs-tree-copy.ts` | 仓储级 bulk tree copy/replace |
| `logic/ensure-parent-dirs.ts` | 父目录行创建 |
| `logic/parent-dir.ts` | 父路径 + storage root 检测 |
| `logic/user-vfs-save-mapping.ts` | Baseline diff → edit/write tool uses |
| `logic/action-xml-to-tool-uses.ts` | Action XML → tool input |
| `logic/vfs-zip-build.ts` | ZIP 创建（STORE, level 0） |
| `logic/vfs-zip-parse.ts` | 带 fflate fallback 的 ZIP 解析 |
| `logic/vfs-zip-validate.ts` | Import 校验 |
| `logic/vfs-zip-path.ts` | ZIP entry 名 ↔ 逻辑路径 |
| `logic/vfs-zip-central-dir.ts` | 自定义 central directory parser |
| `logic/vfs-zip-filename-decode.ts` | GBK/UTF-8 文件名解码 |

### 域 — Repository Impl（3）

| 文件 | 角色 |
|------|------|
| `repositories/impl/sqlite-vfs-entry.repository.ts` | vfs_entry CRUD |
| `repositories/impl/sqlite-vfs-revision.repository.ts` | vfs_revision append/GC |
| `repositories/impl/normalize-path.ts` | POSIX 规范化 |

### 服务（10）

| 文件 | 角色 |
|------|------|
| `service/vfs/impl/vfs.service.ts` | DefaultVfsService |
| `service/vfs/impl/revision-aware-vfs.service.ts` | Revision 装饰器 |
| `service/vfs/impl/scoped-vfs.service.ts` | Scope 包装 |
| `service/vfs/impl/vfs-zip-io.service.ts` | ZIP IO 服务 |
| `service/vfs/create-vfs-service.ts` | 工厂 |
| `service/vfs/create-scoped-vfs-service.ts` | Scoped 工厂 |
| `service/vfs/create-vfs-zip-io-service.ts` | ZIP 工厂 |
| `service/vfs/build-user-vfs-turn-op.ts` | UI turn op builder |
| `service/vfs/glob-match.ts` | Glob matcher |
| `service/vfs/vfs.port.ts` | Re-export 域 ports |

### Bootstrap（2）

| 文件 | 角色 |
|------|------|
| `bootstrap/vfs/vfs-schema.ts` | vfs_entry DDL |
| `bootstrap/vfs/vfs-revision-schema.ts` | vfs_revision DDL |

### Public（1）

| 文件 | 角色 |
|------|------|
| `public/vfs.ts` | 包导出面 |

### 测试（15 + 1 helper）

均在 `packages/core/test/vfs/` —— 见测试覆盖节。

---

## 建议（按优先级）

### P0 — 尽快修复

1. **在 `list()` 中转义 LIKE 元字符** —— 构造 `likePattern` 时用 `escapeLike(normalizedDir)`。为路径段含 `%` 加测试。

### P1 — 下一迭代

2. **提取共享 path/prefix 工具** —— 去重 `normalizePrefix`、`relativeUnderPrefix`、`escapeLike`；将 `normalize-path` 迁到 `logic/`。

3. **提取共享 `replace` 辅助** —— 两个 VFS service 类共用单一实现。

4. **Copy 目标冲突检查** —— 与 move 语义对齐或文档化覆盖。

5. **澄清 `grep` 契约** —— 重命名参数/文档或实现 regex。

### P2 —  backlog

6. **事务化 move/copy** —— 仓储级 bulk rename 或 revision-aware 时包在事务中。

7. **多 hunk edit 集成测试** —— 相邻与 distant 区域。

8. **Revision GC 批量 delete** —— 优化 `deleteExceptReachable`。

9. **统一注释语言** —— 与项目文档标准对齐。

10. **External storage** —— 实现或 v2 前 defer schema 字段。

---

## 结论

VFS 域对其当前用例（agent tools、session/project scoping、checkpoint revisions、ZIP backup）**已达生产质量**。架构与 `@novel-master/core` 分层指南一致。最高影响修复是 **`list()` LIKE 转义 bug**；其余为可维护性与边界加固。不建议结构性重写。

---

*由代码审查生成 —— 范围限于上述路径。相关消费者（如 `domain/tool/builtin/vfs-tools`、checkpoint restore）未审查。*
