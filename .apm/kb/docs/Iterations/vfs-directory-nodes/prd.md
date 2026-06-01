# VFS 目录节点 PRD

> **范围**：Core + CLI + RN 移动端；VFS 底层显式目录节点，空目录可持久化。  
> **边界**：本 PRD 不含技术方案、接口、表结构、任务拆分（见后续 SPEC）。  
> **关联**：与 [vfs-zip-io-agent-tool-policy](../vfs-zip-io-agent-tool-policy/prd.md) **分迭代**；ZIP 语义调整不在本 PRD。

## 背景

- Novel Master VFS 当前 **仅持久化文件**（`vfs_entry` 一行一路径 + 内容）；目录由文件路径前缀 **隐式推导**，`list` 不返回空目录。
- RN 移动端为显示空目录，在「新建目录」时写入 **`.keep` 占位文件**——属于 UI 层 workaround，污染文件树，且与「纯文本快照 / ZIP」语义纠缠。
- 用户期望 **空目录本身可存、可列、可删**，新建目录 **不再产生 `.keep`**；CLI、移动端、Agent 行为一致。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 显式目录节点 | VFS 底层支持 **directory** 与 **file** 两类条目；空目录可单独存在 |
| 统一 list 语义 | `list(dir)` 返回该目录下 **直接子目录 + 直接子文件** 路径；空子目录 **可见** |
| mkdir 能力 | Core 提供目录创建；CLI 与移动端接入；Agent 暴露 **`vfs.mkdir`**（或等价注册名） |
| 去掉 .keep 新建 | **新操作**不再创建 `.keep`；存量 `.keep` **保留为普通文件** |
| 三端一致 | 同一 session / 域内，CLI `list` 与移动端文件管理器对空目录的可见性一致 |

**成功指标（可量化）**

- Core + CLI + Mobile 相关自动化用例在迭代完成时通过；`npm test`（core + cli）与移动端相关用例通过。
- 至少 **8 条**可判定验收（见下）：含 mkdir、空目录 list、delete 空目录、目录路径 read/write 失败、Agent mkdir、存量 .keep 保留、三端 list 一致、新目录无 .keep。
- 文档或 help 说明目录与文件路径的操作差异（read/write 不可用）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作用户（移动端） | 新建空文件夹组织章节；刷新列表后空文件夹仍在，且无 `.keep` |
| 模板维护者 | CLI / 移动端在 global / project template 下 mkdir 空目录结构 |
| 开发者 / 运维 | `nm … vfs mkdir /path` 脚本化创建目录树 |
| Agent | 通过 `vfs.mkdir` 创建目录后再 `vfs.write` 子文件 |

## 范围

### 包含范围

**1. VFS 底层目录节点**

- 持久层区分 **文件** 与 **目录** 条目（具体存储形态见 SPEC）。
- **目录节点**：无用户可编辑正文；**不**参与 grep 内容扫描（与文件区分）。
- **文件节点**：行为与现网一致（content、version、write/read 等）。

**2. 路径操作语义**

| 操作 | 目录路径 | 文件路径 |
|------|----------|----------|
| `read` | **失败**（明确错误） | 与现网一致 |
| `write` / `replace` | **失败** | 与现网一致 |
| `delete` | 支持；非 recursive 时 **仅当目录为空**（无子文件、无子目录）可删；recursive 删除子树 | 与现网一致 |
| `list` | 返回 **直接子目录 + 直接子文件** | — |
| `mkdir`（新增） | 创建空目录节点；父路径不存在时 **失败**（不隐式创建多级，除非 SPEC 另定单层/递归策略——默认 **仅创建最后一级，父必须已存在**） | — |

**3. `.keep` 策略**

- **存量**：数据库中已有 `.keep` **不自动删除**，仍视为 **普通文本文件**。
- **增量**：移动端 / CLI / Agent **新建目录** 不得再写入 `.keep` 或任何占位文件。

**4. Agent 工具**

- 注册 **`vfs.mkdir`**（名称以 ToolRegistry 为准），输入含目标逻辑路径；行为与 Core mkdir 一致。

**5. 交付面**

- **Core**：目录节点模型、mkdir、list 语义扩展、迁移/兼容（存量数据）。
- **CLI**：域 VFS 子命令增加 **mkdir**（global / project / session 三域）；`list` 输出能区分或标注目录（具体 UX 见 SPEC，至少可判定）。
- **RN 移动端**：`VfsFileManager`「新建目录」改调 mkdir；移除 `createVfsDirectory` 写 `.keep` 的逻辑。

**6. Worktree 列表（适配，非规则大改）**

- **不修改** worktree 目录规则、inclusion、排序策略的业务语义。
- **允许** 文件管理器 / 列表数据源 **消费 VFS list 中的目录项**，使空目录在 UI 中可见（实现层适配，见 SPEC）。

### 不包含范围

- **VFS ZIP** 导入/导出格式或空目录 ZIP 语义（见 vfs-zip-io 迭代）。
- **Session execute / snapshot / rollback** 对目录节点（`mkdir` / `delete` 空目录）的 **批次录制与回滚**；本迭代 **不** 为目录操作单独建 checkpoint（见下节「文件回滚与目录节点」——与「恢复文件夹里的文件」不是同一问题）。
- **Worktree 规则引擎** 改造（dir rule、inclusion 算法不重写）。
- **Web 端**。
- 批量迁移：自动删除全库 `.keep` 并 materialize 空目录（用户已选 **保留存量 .keep**）。
- 单 ZIP 多域、非 UTF-8、二进制等（属其他 PRD）。

## 核心需求

1. **空目录可持久化**：仅含目录节点、无子文件时，该目录在 DB 中仍存在，重启后仍在。
2. **list 含子目录**：`list('/parent')` 同时返回 `/parent/subdir`（目录）与 `/parent/file.md`（文件）；空 `/parent/subdir` 仍出现在 `list('/parent')`。
3. **mkdir 三端 + Agent**：Core API、CLI 子命令、移动端新建目录、Agent `vfs.mkdir` 行为一致；**新目录不创建 `.keep`**。
4. **目录路径只读**：对目录路径 `read` / `write` / `replace` **必须失败**，错误可判定。
5. **delete 目录**：空目录可非 recursive 删除；含子项时需 recursive（与现网目录 delete 预期一致）。
6. **存量 .keep 兼容**：升级后已有 `.keep` 仍可读、可删、可 list，**不**在迁移中自动删除。
7. **Worktree 规则不变、列表可展示空目录**：规则配置与 inclusion 逻辑不改；用户能在文件管理器中看到 VFS 中的空目录。
8. **文件回滚与目录节点（Git 式）**：回滚**只恢复文件** checkpoint；目录**不是回滚对象**（不撤销 mkdir、不因文件回滚而删掉空目录）；但写/回滚写**文件**时**须按需创建**缺失的**父级目录节点**（类似 Git 恢复文件时会建父路径，但不会为「删空目录」做反向操作）。

### 文件回滚与目录节点（与「mkdir 不进批次」区分）

现网 session 回滚（`rollbackBatch` / `rollbackSnapshot`）仅对 **execute / snapshot 中登记的文件 `logicalPath`** 执行 `write` 或 `delete`，**从不**对「文件夹路径」做 checkpoint。

**两种「目录」相关行为（不要混为一谈）**

| 类型 | 是否进 snapshot / 是否被回滚撤销 | 说明 |
|------|----------------------------------|------|
| **显式 `mkdir` 的空目录** | **不进**批次；回滚**不撤销** | 用户/Agent 主动建的目录节点；撤销 write 批次后目录**仍可空着留在** |
| **写文件时补齐的父目录链** | **不进**批次；**不是**「回滚目录」 | 为成功 `write`/`rollback → write` 路径而**自动创建**的 directory 行；仅当该路径上**尚不存在**目录节点时创建（SPEC：`ensureParentDirectories`） |

**与 Git 的类比（产品口径）**

| Git | 本 VFS |
|-----|--------|
| 恢复一个文件时，会**创建**所需父目录 | 回滚/写 `/drafts/a.md` 时，若缺 `/drafts` 目录节点 → **创建** `/drafts`（及中间各级） |
| 一般**不会**因恢复文件而删掉其它空目录 | 回滚**不会**因恢复文件而 `delete` 无关的空目录节点 |
| `mkdir` 的空目录不随某次 commit 的「文件回滚」自动消失 | 显式 `mkdir` 的空目录在 `records rollback` 后**仍存在** |

| 问题 | 本迭代 PRD 口径 |
|------|------------------|
| 回滚后，**曾 mkdir 的文件夹**会消失吗？ | **不会**（除非用户另做 `delete` 目录）。 |
| 回滚后，**需要父路径的文件**能写回吗？ | **能**；缺父目录时**自动创建目录节点**，**不报错**。 |
| 这算「回滚创建了文件夹」吗？ | **不算回滚目录**：没有目录的 checkpoint；是**写文件副作用**补齐路径（与 Git 建父目录同类）。 |
| 与「mkdir 不进批次」的关系 | **不同维度**：不进批次 = 不回滚撤销 mkdir；**按需建父目录** = 保证文件 write/回滚成功。 |

## 验收标准

### 目录节点 — 基本

- **Given** session 域空工作区，**When** `mkdir /drafts` 成功，**Then** `list /` 含 `/drafts`，且 **无** 任何 `.keep` 文件被创建。
- **Given** 仅有目录 `/drafts`、无子文件，**When** `list /`，**Then** 返回含 `/drafts`；**When** `list /drafts`，**Then** 为空集（或仅含明确列出的子项，无隐式占位文件）。
- **Given** 空目录 `/drafts`，**When** `delete /drafts`（非 recursive），**Then** 成功；**When** 再 `list /`，**Then** 不含 `/drafts`。
- **Given** `/drafts/a.md` 存在，**When** `delete /drafts` 非 recursive，**Then** 失败（目录非空）；**When** `delete /drafts` recursive，**Then** 子树清除。

### 目录 vs 文件操作

- **Given** 目录 `/drafts` 存在，**When** `read /drafts` 或 `write /drafts …`，**Then** 失败，错误码/文案可判定「路径为目录」类语义。
- **Given** 文件 `/note.md`，**When** `read` / `write`，**Then** 与现网一致。

### 存量 .keep

- **Given** 升级前 session 域存在 `/foo/.keep`（普通文件），**When** 升级后 `list /foo`，**Then** 仍含 `/foo/.keep` 且 `read` 内容不变。
- **Given** 升级后，**When** 用户「新建目录」`/bar`，**Then** `/bar` 下 **无** `.keep`。

### 三端一致

- **Given** 同一 session，**When** CLI `mkdir /x` 后分别在 CLI 与移动端 list 根目录，**Then** 均可见 `/x`（路径集合一致）。

### Agent

- **Given** Agent 调用 `vfs.mkdir` 创建 `/agent-dir`，**When** 随后 `vfs.list /`，**Then** 含 `/agent-dir`。
- **Given** 工具 Registry 已注册 `vfs.mkdir`，**When** 模型被允许使用该工具，**Then** 可成功创建空目录（与 Core mkdir 一致）。

### Worktree（适配）

- **Given** 空目录 `/empty` 已通过 mkdir 创建，**When** 移动端打开该域文件管理器，**Then** 用户可见 `/empty` 目录项（不要求变更任何 dir rule 配置）。

### Session 文件回滚（与目录节点）

- **Given** 已 `mkdir /drafts`，且批次仅对 `/drafts/a.md` 执行 write→delete，**When** `records rollback` 该批次，**Then** `/drafts/a.md` 内容恢复，且 **`/drafts` 目录仍在** `list /` 中（目录不因回滚而消失）。
- **Given** 批次仅修改 `/drafts/a.md`（从未对 `/drafts` 做 mkdir/delete 目录操作），**When** 回滚成功，**Then** **不报错**；`/drafts/a.md` 与快照一致。
- **Given** 回滚需写回 `/drafts/a.md`，且当前**无** `/drafts` 目录节点，**When** 执行 rollback write，**Then** **成功**，且 **`/drafts` 目录节点被创建**（ensure 父链）；**Then** 不得仅因缺少目录节点而失败。
- **Given** 曾 `mkdir /empty` 且批次未触及 `/empty`，**When** 回滚其它文件批次，**Then** `/empty` **仍存在**（空目录不被连带删除）。

## 约束与依赖（扩展）

- 依赖现有 **三域 VFS**（[chat-project-vfs](../chat-project-vfs/prd.md)）、**Tool 系统**、**Session VFS / execute**（本迭代 **不扩展** execute 录目录操作）。
- 依赖 [virtual-worktree](../virtual-worktree/prd.md) 的列表展示链路；仅 **数据源适配**，不改规则语义。
- 与 **vfs-zip-io** 迭代独立；ZIP 是否导出空目录、是否再导出 `.keep` 由彼迭代 SPEC 决定。

## 风险与待确认项（扩展）

| 项 | 说明 |
|----|------|
| Session rollback 不含 mkdir | `records rollback` **不会** 撤销批次外的 `mkdir`；**文件回滚也不撤销目录**（见「文件回滚与目录节点」） |
| 回滚写文件缺父目录 | **ensure 父级目录链**（按需 **创建** directory 行，非回滚 checkpoint）；与 session execute 写文件、Agent `vfs.write` 同规则（SPEC 定稿） |
| Worktree 与 VFS 双源目录 | 现网 worktree 从文件路径 **推导** 目录；显式空目录仅存在于 VFS list，UI 需合并展示（SPEC 定稿） |
| 父路径不存在 | 默认 mkdir **不** 递归创建父目录；多级创建需多次 mkdir 或 SPEC 明确 `parents: true` 选项 |
| 迁移 | 存量无 directory 行；升级后仅 **新 mkdir** 产生目录节点，空目录需用户重新 mkdir（除非 SPEC 做 optional 推导 materialize——**本 PRD 不要求**） |
| Agent write 隐式建目录 | 现网 write 文件路径可能隐式存在父路径；是否与显式目录节点冲突由 SPEC 统一（PRD 要求：mkdir 与 list 语义清晰可测） |

## 里程碑（可选）

| 阶段 | 内容 |
|------|------|
| M1 | Core 目录节点 + mkdir/list/delete/read 语义 + 单测 |
| M2 | CLI 三域 mkdir + list 行为 + e2e |
| M3 | Mobile 去 .keep + 文件管理器展示空目录 |
| M4 | Agent `vfs.mkdir` + 三端回归 |
