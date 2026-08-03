# Chat / Project / 域 VFS PRD

## 背景

Novel Master 已在 `@novel-master/core` 交付 **TDBC**、**SqlTemplateParser** 与**全局 VFS**（路径化内容、版本校验、CLI `nm vfs …`）。下一阶需要：

- 模拟 **KV 型**配置/状态（KKV，按模块分桶）；
- 管理 **AI 对话**（会话、多厂商通用消息结构）与 **项目**（一个项目下多会话）；
- 将 VFS 按 **全局 / 项目 / 会话** 隔离视图绑定，使各域「以为自己在根目录」；
- 在**会话域**提供**快照、执行记录与回滚**，支撑 Agent 协作与 CLI 脚本化调试。

本迭代以 **CLI 本地开发与脚本化**为主（`nm` + Node + better-sqlite3），为后续 Agent / RN 预留 core 分层；**不包含** `apps/mobile` 同等能力验收。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 数据奠基 | KKV、project、session、message 具备可测试的 domain/service 与基本增删改查 |
| 域隔离 VFS | 全局 / project / session 各自可见路径符合约定，对外路径均以 `/` 为根 |
| 会话协作 | session 支持快照、执行记录、回滚；提供统一的 session 文件操作入口（批量 execute） |
| CLI 可用 | 所列 `nm` 子命令在本地 SQLite 上 E2E 可跑通 |
| **成功指标** | 验收清单全部可判定通过；core 单测覆盖各 domain 核心路径；CLI 对应用例无未文档化行为 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 / 运维 | 用 CLI 创建项目与会话、追加/分支消息、在对应域读写「虚拟根」下文件 |
| 脚本 / CI | 非交互调用 `nm project/session/message/kkv/vfs`，做种子数据与回归 |
| 未来 Agent / RN | 仅依赖 core **service**；本迭代不交付 App UI，但分层与 CLI 语义一致 |

典型流程：创建 project → 在 project 域维护 `/template/…` → **创建 session（自动从 project template 复制初始文件）** → 在 session 域 `write`/`read` → `append` 消息 → 需要分支时对某条 message **fork**（复制到该 message 为止）→ 出错时对 session VFS **rollback** 或按文件 **snapshot rollback**。

## 范围

### 包含范围

**数据与领域**

- **KKV**：SQLite 底表；第一个 key 表示模块/领域分桶；提供 list / get / set / delete；模块名由调用方约定，PRD 不枚举固定模块。
- **Project**：项目实体；基本增删改查；**复制**时包含项目元数据与 **project 域 VFS**（见下），**不复制** sessions 及其下属数据。
- **Session**：会话实体，归属某一 project；基本增删改查。**创建时**自动将所属 project 的 **project 域 `template/` 目录树**深拷贝到该 session 的 session 域 VFS（逻辑路径：`/template/{相对路径}` → session 根下 `/{相对路径}`，如 project `/template/test.md` → session `/test.md`）；与 project template 后续变更**互不影响**（仅为创建时刻的一份副本，非 session 快照功能）。
- **Message**：归属某一 session；基本增删改查；存储采用 **最小通用字段**（如 id、sessionId、role、时间等）+ **content/parts** 承载正文 + **provider / raw 等扩展 JSON** 容纳 OpenAI / Claude / Gemini 差异；首期 domain/CLI **不强制**解析各厂商细粒度字段（如 tool_calls）。
- **Message fork**：指定 `messageId`，将源 session 中**截至该条（含）**的全部消息复制到**新 session**；源 session 不变。

**VFS 绑定与可见性**

各域调用 VFS 时，逻辑路径以 `/` 为根；物理存储可统一，由绑定规则映射。目录布局约定：

```text
/
├── meta/
├── template/          # 例：test.md
└── projects/
    └── {projectId}/
        ├── template/  # 例：test.md
        ├── meta/
        └── sessions/
            └── meta/
                └── {sessionId}/
                    └── …            # 例：test.md
```

| 域 | 可见范围（逻辑根 `/` 下） |
|----|---------------------------|
| 全局 | 仅 `template/` 下文件（如 `/template/test.md`） |
| project | 仅 `/template/` 对应 project 的 `projects/{projectId}/template/` |
| session | 仅该 session 目录下文件（如 `/test.md` 映射到 `…/sessions/…/{sessionId}/`） |

全局与 project **不支持**快照；**仅 session** 支持快照。

**Session 文件操作与版本**

- 提供统一的 **session 文件执行**能力：按序执行 read / write / delete 等操作，调用方标识为 user / assistant / system（或等价角色枚举）。
- **版本号对调用方隐藏**，由工具自动维护；支持按次**关闭版本校验**（与现有 VFS `versionCheck` 语义一致）。
- **执行记录**：每次执行批次可记录动作列表与检查点（路径、版本、时间、操作者），支持**批次回滚**。
- **快照**：按路径记录各版本内容与状态（含 deleted）；支持列出快照与**按文件回滚**到指定快照版本。

**CLI（`apps/cli` / `nm`）**

- `nm project`：list / create / delete / copy
- `nm session`：list / create / delete / copy
- `nm message`：list / append / delete / fork
- `nm kkv`：list / get / set / delete
- `nm` 全局 / project / session 三套 **vfs**：list / read / write / delete / replace / glob / grep / delete（与现有全局 VFS 子命令能力对齐，域参数由命令区分）
- session vfs **records**：list / rollback
- session vfs **snapshot**：list / rollback（需 `--file` 指定逻辑路径）

### 不包含范围

- `apps/mobile` 与 RN driver 在本迭代内的功能对齐或 Dev Screen 扩展
- 对外暴露 **repository** 包级 API（遵循现有 core 分层：bootstrap / domain / service）
- 云同步、多设备冲突合并、Agent 编排 UI
- 真实 OS 文件系统作为 VFS 后端
- Provider 专用查询/过滤（如「列出所有含 Gemini functionCall 的消息」）
- project 复制时**默认复制 sessions**（明确不做；若未来需要另开需求）
- 全局 / project 域的快照与执行记录

## 核心需求（7 条）

1. **KKV**：支持按模块 key 分桶的 KV 读写；CLI 与 service 提供 list / get / set / delete，行为可判定（不存在、覆盖、删除不存在等错误语义一致）。
2. **Project / Session / Message**：各实体具备基本增删改查；**session 创建**须自动从所属 project 的 template 复制初始 VFS 文件（见上路径映射）；message 采用通用字段 + 扩展 JSON，满足多厂商消息**可存可取、可列表展示**。
3. **Message fork**：给定源 session 与 `messageId`，创建新 session 并复制**截至该 message（含）**的历史消息；复制后可在新 session 继续 append。
4. **Project copy**：创建新项目，复制源项目**元数据与 project 域 VFS**；**不**复制 sessions、messages、session VFS 与 session 快照/记录。
5. **域 VFS 绑定**：全局 / project / session 三套 API 仅暴露各自可见路径；调用方传入的逻辑路径均以 `/` 为根，无需知晓 `projects/{id}/…` 前缀。
6. **Session 协作**：session 域支持批量 execute、执行记录 list/rollback、路径级 snapshot list/rollback；版本由实现自动处理，且可关闭校验。
7. **CLI parity**：上述能力均有对应 `nm` 子命令，语义与 core service 一致，供本地开发与脚本使用。

## 验收标准

### KKV

- [ ] **Given** 空库，**When** `nm kkv set --module M --key k --value v`，**Then** `nm kkv get --module M --key k` 输出 `v`。
- [ ] **When** `nm kkv list --module M`，**Then** 列出该模块下所有 key（含刚写入的 `k`）。
- [ ] **When** `nm kkv delete --module M --key k` 后再 get，**Then** 可判定的「不存在」错误（非静默成功）。

### Project / Session / Message CRUD

- [ ] **When** `nm project create` 后 `nm project list`，**Then** 含新项目 id/名称（以 CLI 实际字段为准）。
- [ ] **Given** 某 project，**When** `nm session create --project <id>` 后 `nm session list --project <id>`，**Then** 列出该 session。
- [ ] **Given** project P 的 project 域存在 `/template/a.md`、`/template/sub/b.md`，**When** `nm session create --project P` 得 session S，**Then** session 域 `list` 含 `/a.md`、`/sub/b.md`，且 `read` 内容与 P 的 project 域对应 template 文件一致。
- [ ] **Given** P 的 template 在创建 S **之后**再修改或新增文件，**Then** S 的 session 域文件**不变**（与 project template 解耦）。
- [ ] **Given** P 的 template 为空，**When** `nm session create --project P`，**Then** 成功创建且 session 域 VFS 为空（无隐式占位文件）。
- [ ] **When** `nm message append --session <id> --role user --content "hi"` 后 `nm message list --session <id>`，**Then** 至少一条 message，含 role 与可读的 content/摘要。
- [ ] **When** `nm message delete --session <id> --message <mid>`，**Then** list 中不再出现该条；删除不存在 id 时报错可判定。

### Message fork

- [ ] **Given** session S 含消息 M1→M2→M3，**When** `nm message fork --session S --up-to M2`，**Then** 得到新 session S'，且 S' 中消息序列为 M1、M2（含 M2），**无** M3；S 仍为 M1→M2→M3。
- [ ] **When** 向 S' append M4，**Then** 仅 S' 增长，S 不变。

### Project copy

- [ ] **Given** project P 含 project 域 VFS 文件 `/template/foo.md` 与至少一个 session，**When** `nm project copy P` 得 P'，**Then** P' 的 project 域可 read `/template/foo.md` 且内容与 P 一致。
- [ ] **Then** P' **无** P 的 sessions（`nm session list --project P'` 为空或仅默认说明），且 **无** P 的 session 消息与 session VFS 数据。

### 域 VFS 可见性

- [ ] **Given** 全局写入 `/template/test.md`，project 与 session 域 **list** 不得出现该路径（除非各自域内另有同名逻辑路径）。
- [ ] **Given** project P 写入逻辑路径 `/template/x.md`，**When** 以 P 的 project vfs list，**Then** 可见 `/template/x.md`；**When** 以全局 vfs list，**Then** 不可见 `projects/P/...` 形态路径，仅见全局 `template/`。
- [ ] **Given** session S 属于 P，写入逻辑 `/note.md`，**When** session vfs read `/note.md`，**Then** 成功；**When** project vfs 或 global vfs 同路径 read，**Then** 失败或不可见（与「域独享根」一致）。

### Session execute、记录与版本

- [ ] **When** 对 session 执行一批次 write 再 delete 同一逻辑路径，**Then** 调用方无需传入 version 即可完成（默认自动版本）。
- [ ] **When** 关闭版本校验的配置下执行冲突写，**Then** 行为符合开关语义（与现有 VFS 文档一致）。
- [ ] **When** `nm session vfs records list` 后对该批次 `rollback`，**Then** 文件内容与执行前一致（可再用 read 验证）。
- [ ] **When** execute 的 `createdBy` 为 user/assistant/system 之一，**Then** 记录中可读出对应操作者。

### Session 快照

- [ ] **Given** session 对 `/template/test.md` 多次 write/delete，**When** `nm session vfs snapshot list --file /template/test.md`，**Then** 列出多个版本标识及 deleted 状态。
- [ ] **When** `snapshot rollback --file …` 到某一版，**Then** read 内容与该版一致。
- [ ] **Given** 全局或 project 域路径，**When** 尝试 snapshot 相关命令，**Then** 不支持（明确错误或未暴露命令）。

### CLI 覆盖

- [ ] 需求清单中的 `nm project|session|message|kkv` 与三套 `vfs` 子命令均存在且 `--help` 可发现。
- [ ] 全局 / project / session 的 vfs 均支持：list、read、write、delete、replace、glob、grep（行为与现有 `nm vfs` 一致，仅域与路径解析不同）。
