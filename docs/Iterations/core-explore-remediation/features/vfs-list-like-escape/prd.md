---
date: 2026-06-21
dependency: Iterations/VFS/prd.md
---

# VFS list() LIKE 通配符转义（vfs-list-like-escape）PRD

## 背景

`packages/core` 两轮代码审查将 VFS `list()` 中 SQL `LIKE` 通配符未转义列为 **P0 正确性缺陷**。`SqliteVfsEntryRepository.list()` 构造 `likePattern` 时直接拼接目录路径，**未**调用同文件内已有的 `escapeLike()`；而 `delete()`、`listEntriesUnderPrefix()`、`listFileMetaUnderPrefix()` 等前缀查询均已转义 `%`、`_` 与 `\`。

当 VFS 路径段含 SQL LIKE 元字符时，`list()` 会返回**错误子项**或**漏列**真实子项，破坏 agent builtin tools、`VfsService.list`、CLI `vfs list` 及依赖目录列举的上层逻辑的可信度。`normalizePath()` 不禁止 `%`/`_` 出现在路径段中，故该问题可在正常写入路径下触发。

**参考材料：** [explore-vfs.md](./explore-vfs.md)、[explore-worktree.md](./explore-worktree.md)、[迭代 readme](../../readme.md)

**典型故障示例：** 目录 `/notes/v1%draft` 存在时，`LIKE '/notes/v1%draft/%'` 还会匹配 `/notes/v1Xdraft/child`（`%` 匹配任意子串），导致非递归 `list` 误报子目录、递归 `list` 混入无关子树。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 修复 `list()` LIKE 语义 | 目录路径含 `%`、`_`、`\` 时，列举结果**仅**包含该目录下的真实直接/递归子项，与 `findByPath` / 精确路径一致 |
| 与同类查询行为对齐 | `list()` 前缀匹配规则与 `delete`（子路径检测）、`listEntriesUnderPrefix` 等已转义方法一致 |
| 回归防护 | 新增 repository 级（及可选 service 级）用例覆盖 `%`/`_` 路径；`npm run test:fast` 全绿 |
| 零 API 变更 | 不修改 `VfsService.list` 签名、CLI 参数或错误码；纯仓储层正确性修复 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent / builtin VFS tools | `list` 目录浏览、递归列举工作区文件；路径含版本占位符（如 `v1%draft`）或用户自定义 `_` 命名 |
| CLI 使用者 | `novel-master vfs list` 查看含特殊字符的路径树 |
| Worktree / session 链路 | 间接依赖 VFS 列举（worktree 主要走 `listFileMetaUnderPrefix`，已转义；但 scoped `list` 仍走 `repo.list`） |
| 核心库维护者 | 修复 Phase 1 P0 项，消除 CR 中唯一 VFS 高严重度正确性 bug |

## 范围

### 包含范围

- 修复 `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` 中 `list()` 的 `likePattern` 构造，对 `normalizedDir` 应用 `escapeLike()`（根目录 `/` 保持 `"/%"` 特例，与同文件其它前缀查询一致）
- 新增测试：`sqlite-vfs-entry.repository.test.ts` 覆盖含 `%`、`_` 的目录路径（非递归 + 递归）
- 跑通验收：`npm run test:fast`（`packages/core`）

### 不包含范围

- 提取共享 `escapeLike` / `listPrefix` 到 `logic/`（explore 建议 P1，属可维护性债务）
- `delete` / `listEntriesUnderPrefix` 等**已正确转义**方法的改动
- move/copy 原子性、copy 静默覆盖、`grep` 语义等非本 bug 项
- 禁止或规范化路径中的 `%`/`_`（产品未要求；修复应支持字面量路径）
- CLI 行为变更或新子命令
- worktree label / tailCount 等 explore-worktree 中的 spec 漂移

## 核心需求

1. **字面量前缀匹配：** `list(dir)` 的 SQL `WHERE path LIKE … ESCAPE '\'` 中，目录前缀须按字面量匹配；路径中的 `%`、`_`、`\` 不得被解释为 LIKE 通配符。
2. **根目录行为不变：** `list('/')` 仍等价于匹配 `path LIKE '/%'`（全库顶层子项），与修复前一致。
3. **非递归 / 递归 / maxDepth 语义不变：** 修复仅影响 SQL 行集过滤；`relativeUnderDir`、深度裁剪、排序逻辑不改动。
4. **与 delete 子路径检测一致：** 对同一 `normalizedDir`，`list` 返回的路径集合应为 `delete(..., { recursive: true })` 会删除的子树中、满足 list 深度规则的那部分（在测试数据下可交叉验证）。
5. **无行为回归：** 不含 `%`/`_` 的常规路径树列举结果与修复前一致（现有 `lists direct children only by default` 等用例保持通过）。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| L1 | 目录 `/x/v1%draft` 存在，且含子项 `/x/v1%draft/a.txt`；另存在**不相关**路径 `/x/v1Xdraft/b.txt` | `list('/x/v1%draft')` 非递归 | 仅返回 `/x/v1%draft` 下直接子项；**不**含 `/x/v1Xdraft/b.txt` 或其中间目录 |
| L2 | 同上树结构 | `list('/x/v1%draft', { recursive: true })` | 仅返回 `/x/v1%draft` 子树内条目 |
| L3 | 目录 `/x/foo_bar` 存在，子项 `/x/foo_bar/ok.txt`；另存在 `/x/fooXbar/wrong.txt` | `list('/x/foo_bar')` | 仅 `foo_bar` 子树；**不**匹配 `fooXbar` |
| L4 | 常规树（无 `%`/`_`） | `list` 非递归 / 递归 / `maxDepth` | 与现有测试期望一致 |
| L5 | `list('/')` | 根列举 | 行为与修复前一致（顶层子项） |
| L6 | `packages/core` 依赖已安装 | `npm run test:fast` | 退出码 0；无新增失败 |
| L7 | `DefaultVfsService` / scoped list（若加 service 级用例） | 经 service 调用含 `%` 目录 | 与 repository 结果一致（可选，SPEC 决定是否加） |

## 约束与依赖

- **前置能力：** [VFS 与数据分层 PRD](../../../VFS/prd.md) 已定义 `list`（含递归与 depth）、路径规范化及 SQLite 仓储；本需求在其之上修正 LIKE 边界行为。
- **迭代位置：** `core-explore-remediation` **Phase 1**（与 compaction、provider 等并列 P0 正确性修复）。
- **实现范围：** 变更应局限在 repository impl + 测试；service 层为透传，无需改 port。
- **文档后续：** 本 PRD 确认后进入 [spec.md](./spec.md)（design-proposal），再实施代码修改。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 历史脏数据 | 若线上已存在因 bug 导致的「误列举」依赖，修复后行为变严格；预期为正确性恢复，无需迁移 |
| `\` 在路径中 | `escapeLike` 已转义反斜杠；POSIX 路径规范化将 `\` 转为 `/`，一般不会出现字面 `\` |
| 性能 | 转义为 O(n) 字符串替换，与 delete/prefix 查询相同，可忽略 |
