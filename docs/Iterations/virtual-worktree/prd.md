# 虚拟工作树（Virtual Worktree）PRD

## 背景

Novel Master 已在 **global / project / session** 三域提供 scoped VFS（`nm vfs`、`nm project vfs`、`nm session vfs`）。**Session 创建时**已从 project 的 `template/` 深拷贝初始文件（chat-project-vfs）。本需求在此基础上增加：

- 各域 VFS 之上的 **worktree 规则**（目录纳入、文件纳入方式、显示状态计算）；
- **创建 session 时**同步继承所属 project 的 worktree 规则（与 template 文件同理，创建后为快照、互不同步）；
- **显式拉取上级 template**：project 从 global 覆盖；session 从 project 覆盖（**同时覆盖该域 template 对应 VFS 与 worktree 规则**）。此前 project **没有**从 global 拉取的能力，本迭代补齐。

首期以 **CLI** 为主，规则持久化在本地 SQLite，**不包含** RN / 桌面 UI。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 规则可配 | 目录排序/头尾/填充、文件纳入方式、文件夹规则开/关 |
| 状态可判 | 文件四种显示状态、文件夹两种规则状态，判定优先级确定 |
| 文本可出 | `worktree display` 输出 `<file>` 串，与 `list` 一致 |
| 层级同步 | session 创建继承 project worktree；`template pull` 从上级覆盖本级 VFS+规则 |
| **成功指标** | 验收清单全部可判定；CLI e2e 覆盖继承、pull、worktree 四子命令 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | global 维护公共 template 与默认 worktree → `nm project template pull` 同步到项目 → 创建 session 自动带上文件与规则 |
| 脚本 | `session template pull` 在 project 更新模板后重置当前会话；`worktree display` 管道输出 |
| 运维 | 调整 global 默认纳入策略后，对选定 project/session 执行 pull 批量对齐（脚本化） |

典型流程：维护 global `template/` 与 worktree → **`nm project template pull`** → 创建 session（自动继承 project 的 template 文件 + worktree 规则）→ 会话内微调 `worktree dir/file` → `worktree list` / `display`。若 project template 已更新，可对既有 session 执行 **`nm session template pull`**。

## 范围

### 包含范围

**域层级与默认关系**

```text
global（/template/… + global worktree）
    │  nm project template pull  ──► 覆盖 project 的 /template/ VFS + project worktree
    ▼
project（/template/… + project worktree）
    │  session 创建时继承（快照）     ──► session 根下文件 + session worktree（路径映射见下）
    │  nm session template pull  ──► 覆盖 session 域 VFS + session worktree
    ▼
session（/ 为根 + session worktree）
```

| 域 | CLI（worktree） | 操作的 VFS 视图 |
|----|-----------------|-----------------|
| global | `nm global worktree …`（或与 `nm vfs` 全局入口统一，SPEC 锁定） | 仅 `/template/…` |
| project | `nm project worktree …` | 仅 `/template/…` |
| session | `nm session worktree …` | 以 `/` 为根 |

**运行期默认**：各域 worktree **独立计算**（改 global 不自动改已存在的 project/session），除非用户执行 **`template pull`** 或 **新建 session（继承 project 当时快照）**。

**Session 创建时继承 worktree（与 template 文件对齐）**

- **When** `nm session create`（归属 project P），**Then** 除现有「project `template/` → session 根」VFS 深拷贝外，**同时复制** P 的 **project 域 worktree 全量配置** 到该 session 的 worktree。
- **路径映射**（与 VFS 一致）：project 逻辑路径 `/template/{rel}` 上的规则 → session 逻辑路径 `/{rel}`；project 上针对 `/template` 目录本身的规则 → session 根 `/`。
- **After** 创建后，project 或 global 的变更**不**自动流入该 session（与 template 文件解耦）；需用 `session template pull` 主动对齐。

**`template pull`（直接覆盖，无合并）**

pull **不做增量合并**：下级与上级（映射后）对齐方式为 **先清空再写入**——上级有的写入/覆盖，下级多出的 **全部删除**。无需 `--force` 确认（执行即覆盖）。

| 命令 | 上级来源 | 覆盖与清除范围 |
|------|----------|----------------|
| `nm project template pull` | global `/template/**` + global worktree | **project 域** `/template/**` 下全部 VFS 文件：与 global template 树 **完全一致**（下级独有路径删除）；**project worktree** 整表替换为 global worktree（路径仍为 project 的 `/template/…` 语义）。**不**改动该 project 下已有 session / message。 |
| `nm session template pull` | project `/template/**` + project worktree | **session 域** 根下 **全部** VFS 文件：按路径映射用 project template 重建（与 `session create` 同映射，下级独有路径删除）；**session worktree** 整表替换为映射后的 project worktree；**该 session 全部 session-fs 数据清除**——含 **路径快照（snapshot）**、**执行批次/执行记录（execute）** 及关联回滚检查点等，**一条不留**。pull 后 session 文件状态等同「刚按当前 project template 新建」的协作基线。**不**删除 message 行（对话历史保留，PRD 默认；若需连 message 清空另开需求）。 |

- **不包含** `nm global template pull`（global 无上级）。
- global / project 域 **无** session-fs 快照（仅 session 域 pull 清除快照与执行记录）。

**界面语义（worktree 行为规则）**

- **文件夹**：**规则状态** — `规则·开` / `规则·关`（根目录恒开，不可关）。
- **文件**：**显示状态** — `不展示` / `全内容` / `文件头` / `文件名`；**纳入方式** — `自动` / `展示` / `隐藏`。
- **目录纳入规则**（仅作用于该目录**直接子文件**且纳入方式为 `自动`）：排序字段/方向、头 N 尾 M（0…1000）、头尾优先集 → `全内容`，其余按填充策略（`不展示` / `文件名` / `文件头`；非 Markdown 的 `文件头` → `不展示`）。
- **显示状态优先级**：隐藏 → 不展示；展示 → 全内容；自动 + 父目录规则关 → 不展示；自动 + 父目录规则开 → 头尾优先 / 填充策略。
- **保存目录规则**后，该目录规则状态为 **规则·开**。

**CLI：worktree 子命令（global / project / session 均有）**

| 子命令 | 用途 |
|--------|------|
| `display` | 生成 `<file>` 文本（仅显示状态 ≠ `不展示`） |
| `dir` | 设置目录纳入规则（长参数） |
| `file` | 设置文件纳入方式 `--mode auto\|show\|hide` |
| `list` | 完整文件树 + 目录**规则状态** + 文件**显示状态**与**纳入方式** |

**CLI：template 子命令**

| 命令 | 用途 |
|------|------|
| `nm project template pull` | 从 global 覆盖当前 project 的 template VFS + worktree |
| `nm session template pull` | 从所属 project 覆盖当前 session 的 VFS（映射后）+ worktree |

**`<file>` 输出（`display`）**

- 结构、属性、行号、转义、块间空行、DFS 顺序：与产品规则文档 §8 一致。
- `list` 与 `display` 对同一库、同一配置须一致。

**持久化与 CLI 集成**

- 与 `nm --db` 同库；project/session 支持 config 默认上下文（flag > config > 报错）。
- 路径校验与各域 scoped VFS 一致。

### 不包含范围

- RN / 桌面 / Web UI。
- `worktree` 直接修改 VFS 正文（仍用 `vfs` 子命令）；`template pull` 除外（ intentional 全量覆盖 VFS / worktree / session-fs）。
- 交互式向导、JSON 批量导入（首期 flags）。
- Message / KKV / session-fs 与 worktree 自动联动。
- **自动**将 global 变更传播到已有 project/session（仅 create 继承与显式 pull）。

## 核心需求

1. **Worktree 配置存储与计算**：三域分别持久化；支持 dir/file/list/display。
2. **Session 创建继承**：创建 session 时复制 project worktree（路径映射与 template VFS 一致）。
3. **`project template pull`**：global → project **直接覆盖**（template VFS 先清空再镜像；worktree 整表替换）。
4. **`session template pull`**：project → session **直接覆盖**（session 域 VFS 先清空再镜像；worktree 整表替换；**清除该 session 全部 snapshot / execute 等 session-fs 数据**）。
5. **目录/文件规则 CLI**：`worktree dir` / `worktree file` 长参数配置。
6. **状态一致性**：`list` 与 `display` 结果一致；pull 与 create 后下级 worktree 与上级（映射后）一致。
7. **与 chat-project-vfs 协同**：不破坏现有 session 创建 template 拷贝；本 PRD 扩展为「文件 + worktree 一并继承/拉取」。

## 验收标准

### 继承（session 创建）

- **Given** project P 在 `/template/a.md` 有文件、且 `/template` 目录配置了 worktree（如 head=1），**When** `nm session create` 得 S，**Then** S 的 session 域有 `/a.md`，且 S 的 worktree 在 `/`（或 `/a.md` 父目录）上的规则与 P 在 `/template` 上映射后的规则一致。
- **Given** 创建 S 后修改 P 的 template 或 worktree，**Then** S **不变**，直至 `nm session template pull`。

### template pull

- **Given** global `/template/g.md` 与 project 仅有 `/template/p.md`，**When** `nm project template pull`，**Then** project `/template` 与 global **完全一致**（`p.md` 被删除或替换，`g.md` 存在），project worktree 与 global 一致；**Then** project 下已有 session 的 VFS/message **不变**。
- **Given** project 更新 `/template/x.md` 与 worktree，session S 根下另有 `/only-in-session.md` 且存在 snapshot/execute 记录，**When** `nm session template pull`（S），**Then** S 的 session 根文件树与 project 映射后一致（`only-in-session.md` **不存在**），worktree 与 project 映射后一致，**且** `snapshot list` / `records list`（或等价命令）对该 session **均为空**。
- **Given** S 曾对某文件多次 write 并产生多版 snapshot，**When** `session template pull`，**Then** 该文件内容以 project template 为准，**历史 snapshot 全部清除**（不可 rollback 到 pull 前版本）。
- **Given** 仅 global 存在某 template 文件，**When** project pull 后 create session，**Then** session 继承的是 pull 后的 project 快照（含该文件与规则）。

### Worktree 行为（保留原验收）

- **Given** 文件纳入 `隐藏`，**When** `list` / `display`，**Then** 不展示且无 `<file>` 块。
- **Given** 纳入 `展示`，**Then** 全内容，不受父目录规则关影响。
- **Given** 自动 + 父目录规则关，**Then** 不展示。
- **Given** 规则开、5 个自动子文件、head=2 tail=1、fill=文件名，**Then** 优先集 3 个全内容，其余文件名。
- **Given** 非 Markdown + fill=文件头 + 自动，**Then** 不展示。
- **Given** 合法参数，**When** `worktree dir` / `worktree file`，**Then** 退出码 0 且 `list` 反映变更。
- **Given** 多文件，**When** `display`，**Then** `<file>` 符合 §8；**When** `list`，**Then** 全树含状态列。

### 域边界

- **Given** global 域 worktree 指向 `/template` 外路径，**Then** 报错。
- **Given** 无 current project/session，**When** `project`/`session` 子命令且无 flag，**Then** 与现有 scoped CLI 一致。

## 约束与依赖

- 依赖 **chat-project-vfs**：scoped VFS、`copyVfsTree`、session 创建、project/session 上下文。
- `template pull` 的 VFS 覆盖语义与现有树拷贝能力对齐（SPEC 实现细节）。
- Front Matter / 元数据默认值在 SPEC 锁定。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| global CLI 前缀 | `nm global worktree` vs `nm vfs worktree`，SPEC 统一 |
| pull 与 message | session pull **不清** message；清快照/执行记录/VFS 非 template 遗留文件 |
| `project copy` 是否复制 worktree | 未在本 PRD 强制；若需与 template 一致可复制，SPEC 另议 |
| `list` 输出格式 | TSV vs 缩进树，SPEC 锁定 |

## 里程碑（可选）

1. core：worktree 存储 + 计算 + pull/继承 + `<file>` 生成  
2. CLI：`worktree *`、`project/session template pull` + e2e  
3. kb spec
