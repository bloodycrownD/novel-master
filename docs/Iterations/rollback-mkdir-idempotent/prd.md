# 消息回滚 `ensureDirectoryChain` 幂等修复 PRD

## 背景

`rollbackToMessage` 在恢复嵌套路径（如 `/原文/章节.md`）时，会调用 `ensureDirectoryChain` 为父目录执行 `vfs.mkdir`。当前实现直接调用 `mkdir`，当父目录**已存在**（常见：文件本来就在该目录下、或目录由先前 write / 手动操作创建）时抛出 `VfsError: ALREADY_EXISTS`，导致整次回滚失败。

同仓库 `vfs-move.ts` 已提供 `mkdirIgnoreExists`（目录已存在则跳过），且 message-checkpoint v2 SPEC 将 `ensureDirectoryChain` 标注为 idempotent，但 `restore-path.ts` 未对齐实现。

该缺陷与 checkpoint 采集策略（仅 mutating 轮次 capture、手动改文件不进 checkpoint）**无关**：在现有回滚算法下，父目录已存在属于正常状态，回滚仍应成功完成。

**关联调研**：用户路径「手动重命名 → Agent 读写 → 回滚」触发了 `Path already exists: …/原文`；根因之一是 mkdir 非幂等，而非 rename 语义本身错误。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 回滚基本可用 | 恢复含父路径的文件时，父目录已存在不再导致回滚失败 |
| 与 SPEC / 现网 move 一致 | `ensureDirectoryChain` 行为对齐 `mkdirIgnoreExists` 语义 |
| 不扩大迭代范围 | 不改动 checkpoint 采集策略、不做全树 diff、不处理手动 rename 进 checkpoint |

成功指标：

- 嵌套路径回滚在**父目录已存在**时 P0 单测通过，Mobile/Desktop/CLI 共用 Core 行为一致。
- 现有 `rollback.test.ts`（R1–R9 等）无回归。
- 父路径已存在且为**文件**（非目录）时，仍抛出明确错误（`NOT_A_DIRECTORY` 或等价），不静默破坏数据。

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile / Desktop 用户 | 工作区含子目录文件，长按消息「回滚」后应成功，不出现 `Path already exists` Toast |
| 写作者 | 手动重命名后 Agent 修改子路径文件，回滚到较早消息时不应因父目录仍在而失败 |
| 开发者 | `nm session rollback --message <id>` 在嵌套路径场景下稳定完成 |

## 范围

### 包含范围

1. **Core `ensureDirectoryChain`**：创建父目录链时使用幂等 mkdir（复用或抽取 `mkdirIgnoreExists`），目录已存在视为成功。
2. **文件占位冲突**：若父路径已存在且 `entry_kind=file`，保持失败并抛出可判定错误（与 `ensureParentDirectories` 行为一致），不将文件误判为可跳过。
3. **单测**：新增「父目录已存在时嵌套文件回滚成功」用例；保留 R4「父目录缺失时自动创建」用例。
4. **跨端**：仅 Core 变更；Mobile / Desktop / CLI 无需改 IPC，回滚入口自动受益。

### 不包含范围

- 每条消息 / 每次手动 VFS 操作产生 checkpoint
- `liveTree` vs `targetTree` 全量 diff 式回滚
- 手动 rename 写入 checkpoint 或路径映射表
- 目录节点本身的 revision 历史（mkdir 仍不写 `vfs_revision`）
- 回滚前 diff 警告、FileEditor 覆盖提示（message-checkpoint-v2 P2）

## 领域澄清：rename 在 VFS 中的语义

用户理解基本正确，补充精度如下：

| 操作 | `vfs_entry` | `vfs_revision` |
|------|-------------|----------------|
| **文件 rename** (`moveVfsPath`) | `read(from)` → `write(to)` → `delete(from)`：新路径有 entry，旧路径 entry 删除 | 新路径 append `active` revision；旧路径 append `deleted` revision |
| **目录 rename** | 逐文件 `write`+`delete` 迁移，目录行 `mkdirIgnoreExists` 创建目标树 | 各文件路径分别产生上述 revision；目录行无 revision |
| **与 checkpoint** | Live 树立即反映新路径 | 旧 path 的 revision 仍保留在库中，但 **checkpoint 不自动更新**，直到下次 Agent mutating capture |

因此：**rename ≠ 单条「改名」revision 记录**，而是**新路径新建（write）+ 旧路径删除（delete）** 的组合；回滚靠 checkpoint 里的 path→version 指针，不靠 rename 事件。

## 核心需求（5 条）

1. **幂等 mkdir**：`ensureDirectoryChain` 对每一级父目录，若已为 directory 则继续，不抛 `ALREADY_EXISTS`。
2. **文件占位拒绝**：父路径已为 file 时，恢复子路径必须失败并报错（不可把文件当目录跳过）。
3. **回滚事务原子性不变**：修复后仍在一个事务内完成 reconcile + 删 tail 消息 + GC；任一路径不可恢复时整次失败。
4. **行为与 move 对齐**：幂等逻辑与 `packages/core/src/domain/vfs/logic/vfs-move.ts` 中 `mkdirIgnoreExists` 一致，避免两处语义漂移（优先复用，不复制第三份）。
5. **可回归验证**：新增单测覆盖「未删父目录、仅改子文件内容后回滚」——这是现网常见路径，R4 仅覆盖「父目录已删」分支。

## 验收标准

- **A1 父目录已存在 — 内容回滚**  
  Given `/dir/file.md` 存在且 `/dir` 目录行存在，checkpoint 记录 `/dir/file.md` v1  
  When 将 `file.md` 改为 v2 后 `rollbackToMessage` 至锚点  
  Then 回滚成功，`file.md` 内容为 v1，无 `ALREADY_EXISTS`

- **A2 父目录缺失 — 自动创建（R4 保持）**  
  Given checkpoint 含 `/deep/nested/file.md`，且 `/deep` 整链已删除  
  When 回滚至锚点  
  Then 父目录链被创建且文件内容恢复

- **A3 父路径为文件 — 明确失败**  
  Given `/dir` 为 **file** 行，checkpoint 含 `/dir/child.md`  
  When 回滚尝试恢复 `child.md`  
  Then 失败且错误可区分（非笼统 `ALREADY_EXISTS` 误导为「目录已存在」）

- **A4 手动 rename 后 Agent 改子文件再回滚（集成场景）**  
  Given 目录 `/原文/` 下 `a.md`，用户将目录重命名为 `/初稿/`（无 checkpoint），随后 Agent mutating 修改 `/初稿/a.md` 并 capture  
  When 回滚至 mutating 前一条有 checkpoint 的消息（target 含 `/原文/a.md` 或等价前序树）  
  Then 不因 `/原文` 或既有目录行已存在而 `ALREADY_EXISTS` 失败（在 target 与 revision 齐全前提下完成 reconcile）

- **A5 无回归**  
  Given 现有 `packages/core/test/message-checkpoint/rollback.test.ts` 全量  
  When CI 执行  
  Then 全部通过

## 风险与备注

| 风险 | 缓解 |
|------|------|
| 仅修 mkdir 仍无法覆盖「checkpoint 与 live 路径不一致」的还原偏差 | 本迭代只修硬失败；路径分叉属后续「capture / 全树 diff」迭代 |
| A3 与 A1 边界 | 实现须检查 `entry_kind`，不能对所有 `ALREADY_EXISTS` 一律吞掉 |

## 迭代命名

`rollback-mkdir-idempotent` — 回滚父目录 mkdir 幂等修复
