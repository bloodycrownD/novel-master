# Tool System V2 PRD

> **平台**：Core + Mobile / Desktop / CLI UI 同步更新  
> **类型**：工具集重构（破坏性变更）  
> **关联迭代**：`tool-system`（V1）、`agent-system`  
> **参考**：OpenCode `read` / `grep` / `glob` 输出限制设计

## 背景

当前内置文件工具有 10 个（`read`、`write`、`replace`、`delete`、`list`、`mkdir`、`glob`、`grep`、`move`、`copy`），存在以下问题：

1. **工具粒度过细**：`delete` / `move` / `copy` / `mkdir` 等各自独立，LLM 上下文占用多、策略配置繁琐。
2. **命名不一致**：行业惯例使用 `edit` 表示精确替换编辑，本系统仍用 `replace`。
3. **读取无边界**：`read` / `grep` / `glob` 等可能返回超大内容，撑爆模型上下文。
4. **缺少聊天记录检索**：Agent 无法像 `grep` 一样搜索当前会话历史，需人工翻阅消息。
5. **工具策略配置不便**：Agent 编辑器中白/黑名单使用 **逗号分隔文本输入**（Mobile / Desktop 均有），用户需记忆工具名与拼写，易出错。

本需求对内置工具集进行 **V2 重构**：合并文件操作、重命名编辑工具、统一读取类工具输出限制，并新增 `chat_grep`；同时将工具黑白名单改为 **可搜索多选 UI**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 工具集精简 | 内置工具从 10 个减至 **7 个**：`read`、`write`、`edit`、`fs`、`glob`、`grep` + 新增 `chat_grep` |
| 读取可控 | `read` / `grep` / `glob` / `chat_grep` / `fs ls` 输出均受统一上限约束，单轮工具结果 **≤ 50KB**（或等价条数限制） |
| 文件操作统一 | `delete` / `move` / `copy` / `mkdir` / `rmdir` / **`list`** 合并为 **`fs` 单工具**，通过 command 字符串调用 |
| 聊天可检索 | `chat_grep` 可在 **当前会话全部消息（含 hidden）** 中搜索并返回匹配楼层与行 |
| 全端一致 | Core 定义 + Mobile / Desktop / CLI 工具展示、权限、Agent 默认策略 **同步更新** |
| 工具策略易配 | Agent 编辑器白/黑名单 **100% 通过多选 UI** 配置，无文本输入 |

**整体成功指标**：现有 Agent 集成测试迁移至 V2 工具名后全部通过；各端 UI 不再出现已移除工具名；用户可在 30 秒内完成常见工具白名单配置（≤5 个工具）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 开发者 | 配置更少的工具权限项；通过搜索多选快速勾选白/黑名单，无需手打工具名 |
| Agent 配置用户 | 在 Mobile / Desktop Agent 编辑器中可视化选择允许或禁止的工具 |
| 对话用户 | Agent 读大文件时分页读取；搜索历史消息找之前讨论过的内容 |
| 平台维护者 | 统一输出截断规则，避免 LLM 上下文被单次 tool result 撑爆 |

## 范围

### 包含范围

#### 1. 工具重命名：`replace` → `edit`

- 工具名由 `replace` 改为 **`edit`**。
- 语义不变：在工作区文件内精确查找并替换文本（支持 `replaceAll` 等现有选项）。
- **破坏性变更**：移除 `replace`，不提供别名。

#### 2. 文件操作合并：`fs` 工具

- 移除独立工具：`delete`、`move`、`copy`、`mkdir`、`list`（及空目录删除语义）。
- 新增 **`fs`** 工具，输入为 **单条 command 字符串**（类似 bash，在 VFS 工作区内解析执行）。
- 支持命令（首期）：

| 命令 | 说明 | 对应 bash 参考 |
|------|------|----------------|
| `ls [dir]` | 列出目录条目（默认 `dir` 为 `/`） | `ls` |
| `ls -r <dir>` | 递归列出子树 | `ls -R` |
| `rm <path>` | 删除文件 | `rm` |
| `rm -r <path>` | 递归删除目录树 | `rm -r` |
| `mv <from> <to>` | 移动/重命名 | `mv` |
| `cp <from> <to>` | 复制文件 | `cp` |
| `cp -r <from> <to>` | 递归复制目录 | `cp -r` |
| `mkdir <path>` | 创建目录（父目录须已存在，与现 VFS 语义一致） | `mkdir` |
| `rmdir <path>` | 删除**空**目录 | `rmdir` |

- 路径均为 VFS 逻辑路径；不支持管道、通配符、任意 shell 语法。
- 解析失败或命令不支持时返回 **可判定错误**（含原始 command 与原因）。
- `fs` 的 **变更子命令**（`rm`/`mv`/`cp`/`mkdir`/`rmdir`）属于 checkpoint Eligible；**只读子命令** `ls` 不修改 VFS。
- `ls` 输出受 **50KB** 上限约束，超出时截断并提示。

#### 3. `read` 工具增强：分页与截断

新增参数（参考 OpenCode）：

| 维度 | 参数/常量 | 作用 |
|------|-----------|------|
| 行范围 | `offset`（1-based，可选）+ `limit`（可选，**默认 2000 行**） | 从第 N 行起最多读 M 行 |
| 单行长度 | `MAX_LINE_LENGTH = 2000` | 超长按 2000 字符截断并加后缀 |
| 总输出 | `MAX_BYTES = 50KB` | 本次返回超 50KB 提前停止 |

- 输出需标明：是否截断、总行数、建议下次使用的 `offset`（若还有更多内容）。
- `offset` 超出文件行数时返回错误。

#### 4. `grep` / `glob` 输出限制

参考 OpenCode，对现有 VFS 工具加统一约束：

| 工具 | 限制（首期） |
|------|-------------|
| `grep` | 单行 `MAX_LINE_LENGTH = 2000`；最多 **100 条**匹配；总输出 **≤ 50KB** |
| `glob` | 最多 **100 条**路径；总输出 **≤ 50KB** |
| `fs ls` | 条目输出 **≤ 50KB**；超出截断并提示（见 §2） |

截断时输出须包含：`truncated: true` 或等价提示，以及被省略的数量。

#### 5. 新增 `chat_grep` 工具

- **范围**：**当前会话**的全部消息，**包含 hidden 消息**。
- **能力**：类似 `grep`，在消息文本（user / assistant / tool 结果等可搜索字段）中按正则或文本模式搜索。
- **返回**：匹配项列表，至少包含：
  - 消息 ID 或楼层序号（session 内顺序）
  - 角色（user / assistant / …）
  - 匹配行号（消息内第几行）
  - 匹配 excerpt（受 `MAX_LINE_LENGTH` 约束）
- **限制**：与 `grep` 对齐——最多 100 条匹配、总输出 ≤ 50KB；超限时截断并提示。
- **不包含**：跨会话、跨项目搜索。

#### 6. 保留不变的工具

- `write` 保留。
- Agent 工具策略、UI 工具卡片、format-tool-output、checkpoint 分类等 **随新工具名更新**。

#### 7. 全端 UI 同步（Core + UI）

- Mobile / Desktop / CLI 中工具调用展示、Agent 编辑器默认工具列表、工具权限配置 **同步 V2 名称**。
- 移除对已删除工具名（`replace`、`delete`、`move`、`copy`、`mkdir`、`list`）的 UI 引用。

#### 8. 工具黑白名单：可搜索多选 UI

**现状**：`AgentEditorForm`（Mobile）与 `AgentEditorView`（Desktop）在 allow/deny 模式下使用 **逗号分隔文本框**（`toolsList`）；底层经 `config-forms` 的 `buildToolsPolicy` 序列化为 `tools.allow` / `tools.deny` 数组。

**目标**：替换为 **可搜索多选列表 + 顶部已选面包屑/标签条**，降低记忆与拼写成本。

**交互（已确认）**

| 要素 | 说明 |
|------|------|
| 主交互 | **可搜索多选列表**：展示当前运行时注册的全部内置工具名（V2 集合），支持按名称过滤 |
| 已选展示 | 顶部 **面包屑/标签条** 展示已选工具，可点击移除单项 |
| 模式联动 | 仍保留「默认 / 白名单 / 黑名单」三态；仅 allow/deny 模式显示多选器 |
| 输入方式 | **仅多选 UI**，**完全移除**逗号分隔文本输入，不提供高级手动编辑 |
| 数据来源 | 工具选项来自 **已注册工具名列表**（与 `validateAgentToolPolicy` 校验源一致），V2 重构后自动反映新工具集 |
| 共享逻辑 | 选中状态与 `AgentDefinition.tools` 的序列化/反序列化仍走 `config-forms`（`toolsFromDefinition` / `buildToolsPolicy`），UI 层只改「编辑控件」 |

**交付端**

- **Mobile**：`AgentEditorForm` 工具策略区块
- **Desktop**：`AgentEditorView` 工具策略区块
- **CLI**：不在本需求范围（CLI 可继续 YAML/命令行编辑）

**展示增强（建议，非阻塞）**

- 每个工具项可附一行简短中文说明（如 `read`：读取文件），帮助非技术用户理解；说明文案与 V2 工具集同步维护。

### 不包含范围

- 真实 OS shell 执行（`bash` / 进程）；`fs` 仅操作 **VFS 工作区**。
- `fs` 支持 `mkdir -p`、通配符、`&&` 链式命令（可后续迭代）。
- 跨会话 / 跨项目 `chat_grep`。
- LLM 协议层（OpenAI / Anthropic function calling）映射改造细节（属 SPEC）。
- OpenCode 式 truncation 文件落盘（首期仅 inline 截断 + 提示；不写入临时文件）。
- Desktop-only 或 Mobile-only 的独立工具集分叉。
- CLI Agent 编辑器的交互式工具多选 UI。

## 核心需求

1. **破坏性工具集迁移**：`replace`→`edit`；`delete`/`move`/`copy`/`mkdir`/`list`→`fs`；旧名 **不保留别名**。
2. **`fs` command 字符串**：LLM 传入单条 command，服务端解析并映射到 VFS 操作；不支持任意 shell。
3. **`read` 分页读取**：`offset` + `limit`（默认 2000 行）+ 单行/总字节截断。
4. **读取类工具统一上限**：`grep`、`glob`、`chat_grep`、`fs ls` 均受行宽、条数、50KB 约束。
5. **`chat_grep`**：当前会话全量消息（含 hidden）可搜索，返回楼层 + 行 + excerpt。
6. **全端一致**：Core 与各端 UI、Agent 默认配置、测试用例同步更新。
7. **工具策略多选 UI**：Mobile / Desktop Agent 编辑器用可搜索多选 + 已选标签替代文本输入；选项与 V2 注册工具名一致。

## 验收标准

### 工具重命名与合并

- **Given** Agent 调用 `edit`  
  **When** 传入 `{ path, oldString, newString }`  
  **Then** 行为与原 `replace` 一致，返回 `{ version, replacements }`

- **Given** 已移除 `replace`、`delete`、`move`、`copy`、`mkdir`、`list`  
  **When** Agent 或测试调用旧名  
  **Then** 返回「工具不存在」类错误

- **Given** `fs` command 为 `ls /dir`  
  **When** 执行  
  **Then** 返回目录条目列表，等价于原 `list` 工具（非 recursive）

- **Given** `fs` command 为 `ls -r /dir`  
  **When** 执行  
  **Then** 递归列出子树，等价于原 `list` + `recursive: true`

- **Given** `fs` command 为 `mv /a.txt /b.txt`  
  **When** 执行  
  **Then** 文件移动成功，等价于原 `move` 工具

- **Given** `fs` command 为 `rm -r /dir`  
  **When** `/dir` 为非空目录  
  **Then** 递归删除成功，等价于原 `delete` + `recursive: true`

- **Given** `fs` command 为 `rmdir /empty`  
  **When** 目录非空  
  **Then** 返回明确错误（非空目录不可 rmdir）

- **Given** 无法解析的 command（如 `foo bar`）  
  **When** 调用 `fs`  
  **Then** 返回可判定错误，不修改 VFS

### read 限制

- **Given** 文件 5000 行  
  **When** `read` 不传 offset/limit  
  **Then** 默认返回前 2000 行，输出含截断提示与建议 `offset`

- **Given** 某行 3000 字符  
  **When** `read` 读取该行  
  **Then** 该行截断至 2000 字符并带后缀

- **Given** 读取结果累计将超 50KB  
  **When** 继续拼接  
  **Then** 提前停止，输出 `truncated` 提示

- **Given** `offset` 大于文件总行数  
  **When** `read`  
  **Then** 返回错误（非空成功）

### grep / glob / chat_grep 限制

- **Given** `grep` 匹配超过 100 处  
  **When** 执行  
  **Then** 返回前 100 条 + 截断说明

- **Given** `glob` 匹配超过 100 个路径  
  **When** 执行  
  **Then** 返回前 100 条 + 截断说明

- **Given** 当前会话有 50 条消息，其中 3 条含关键词  
  **When** `chat_grep` 搜索该关键词  
  **Then** 返回 3 条匹配，含消息楼层/序号、角色、行号、excerpt

- **Given** 会话含 hidden 消息且内容匹配  
  **When** `chat_grep`  
  **Then** hidden 消息 **纳入** 搜索结果

- **Given** 匹配结果将超 50KB  
  **When** `chat_grep` / `grep` / `glob`  
  **Then** 截断并提示省略数量

### 工具黑白名单 UI

- **Given** 用户在 Agent 编辑器选择工具策略为「白名单」或「黑名单」  
  **When** 查看工具名单配置区  
  **Then** 显示 **可搜索多选列表** 与 **顶部已选标签/面包屑**；**不存在** 逗号分隔文本输入框

- **Given** 注册工具包含 V2 全集（`read`、`write`、`edit`、`fs`、`glob`、`grep`、`chat_grep`）  
  **When** 打开多选列表  
  **Then** 列表展示上述 7 个工具名；**不展示** 已移除的 `replace`、`delete`、`move`、`copy`、`mkdir`、`list`

- **Given** 用户在搜索框输入 `grep`  
  **When** 过滤列表  
  **Then** 仅显示名称匹配的工具（如 `grep`、`chat_grep`）

- **Given** 用户勾选 `read`、`grep` 并保存 Agent  
  **When** 重新打开该 Agent  
  **Then** 已选标签显示 `read`、`grep`；持久化字段为 `tools.allow: ["read","grep"]`（或等价 deny）

- **Given** 用户点击已选标签上的移除  
  **When** 确认保存  
  **Then** 对应工具从 allow/deny 列表移除

- **Given** Mobile 与 Desktop 编辑同一 Agent 的工具白名单  
  **When** 两端分别配置并保存  
  **Then** 持久化结果一致（共享 `config-forms` 序列化逻辑）

### 全端与回归

- **Given** Mobile / Desktop / CLI 展示一次 `edit` 或 `fs` 工具调用  
  **When** 用户查看工具卡片  
  **Then** 显示 V2 工具名，不出现 `replace` / `delete` 等旧名

- **Given** 内置 Agent 默认工具列表  
  **When** 新建 Agent  
  **Then** 默认启用 V2 工具名

- **Given** `write` + `edit` + `fs` + `read` 组合流程  
  **When** Agent 完成写文件 → 编辑 → 移动 → 分页读取  
  **Then** 全流程成功，checkpoint 对变更类工具仍生效

## 约束与依赖

- 依赖现有 `VfsService`（read/write/replace/delete/mkdir/glob/grep + move/copy 逻辑）。
- 依赖消息存储与 session 上下文（`chat_grep` 需 sessionId + message repository）。
- **破坏性变更**：已有 Agent YAML / 数据库中 `tools.allow` 含旧工具名的配置 **须人工或迁移脚本更新**（本 PRD 不要求自动 DB 迁移，但 SPEC 应说明影响面）。

## 风险与待确认项

| 风险 | 说明 |
|------|------|
| Agent 配置断裂 | 破坏性移除旧工具名后，存量 Agent 若未更新将无法调用文件操作 |
| `fs` 解析歧义 | command 字符串需严格 grammar，避免 LLM 注入式多命令 |
| `chat_grep` 性能 | 长会话全量扫描可能慢；首期可接受，后续可加索引 |

**已确认（评审澄清）**

- `fs` 形态：**单参数 command 字符串**
- 兼容性：**破坏性变更，无别名**
- `chat_grep` 范围：**当前会话，含 hidden**
- 交付：**Core + 各端 UI**
- 工具策略 UI：**可搜索多选 + 顶部已选标签**；**仅多选，移除文本输入**
