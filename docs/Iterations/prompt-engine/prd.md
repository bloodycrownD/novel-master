# Prompt 引擎 PRD

## 背景

Novel Master 已具备 **chat**（project / session / message）、**scoped VFS** 与 **virtual-worktree**（session 域 worktree 展示文本）。下一阶需要把「发给模型的提示词」从硬编码字符串升级为 **可声明、可复用、可调试** 的 **Block 组合**，并在本地通过 CLI 渲染为与人类/模型一致的纯文本，便于脚本化与 Agent 迭代前的手工验收。

本需求聚焦 **Prompt 定义格式**、**轻量宏替换** 与 **`nm prompt render`**；不连接 LLM、不管理 prompt 文件的 VFS 存储。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| Block 模型 | 用 YAML 描述 `blocks` 列表，支持 `text` 与 `chat` 两种类型，语义稳定、可校验 |
| 宏替换 | `text` 块 `content` 支持 Go 风格 **字段访问**（`{{ .x }}`、`{{ .a.b }}`、`{{ $.time }}`），首期不做条件/循环/管道/子模板 |
| 数据绑定 | `chat` 块注入 **当前 CLI 默认 session** 的消息；`{{ .worktree }}` 注入 **当前 session 域** worktree 展示结果 |
| CLI 调试 | `nm prompt render --path <文件>` 将完整 prompt **所见即所得** 输出到 stdout（非 JSON） |
| **成功指标** | 下文验收标准全部可判定通过；至少一份示例 blocks YAML + CLI 用例文档可复现 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 在仓库或本地维护 `*.yaml` prompt 定义，渲染后粘贴到厂商控制台或 diff 检查 |
| 脚本 / CI | 非交互调用 `nm prompt render`，对比 golden 文本或做快照回归 |
| 未来 Agent | 复用同一套 Block 模型与 core 渲染 API（本迭代 **不验收** App / 自动调 API） |

典型流程：编辑 blocks YAML → 确保 CLI 已解析默认 project/session → `nm prompt render --path ./prompts/foo.yaml` → stdout 即为模型侧可见的拼接结果。

## 范围

### 包含范围

**Block 定义（YAML，默认序列化/交换格式）**

- 顶层键 `blocks`，元素字段：
  - `name`（string，块标识，用于排错与文档；**不参与** stdout 拼接标题）
  - `type`：`text` | `chat`
  - `role`：仅 `text` 必填，取值为 `system` | `user` | `assistant`（小写，与 chat message 一致）
  - `content`：仅 `text`；多行字符串，渲染前做宏替换
- `type: chat`：**不得**出现 `role`；表示引用真实会话历史，消息来自运行时绑定，不在 YAML 内嵌 `messages`。

示例（与需求描述一致）：

```yaml
blocks:
  - name: system_msg
    type: text
    role: system
    content: |
      You are an assistant.
      Worktree:
      {{ .worktree }}

  - name: conversation_history
    type: chat

  - name: user_query
    type: text
    role: user
    content: |
      Today is {{ $.time }}（{{ $.week_cn }}）。
      {{ .current_input }}
```

**宏系统（首期「基本能力」）**

- **当前上下文** `.`：首期仅暴露 **`worktree`** 字段（string），值为当前 CLI **session 域** worktree 的 **display 文本**（与现有 virtual-worktree 展示语义一致，非 JSON）。
- **根/全局上下文** `$`：
  - `$.time`：渲染时刻的**本地**时间，格式 `YYYY-MM-DD HH:mm:ss`
  - `$.week_cn`：渲染时刻的**本地**星期，**中文**（如「星期一」）
- 支持 **嵌套字段访问**语法：`{{ .a.b }}`（为后续扩展预留；首期无其它 `.` 子字段时，未定义字段行为须在实现说明中明确：空字符串或报错二选一，验收用例锁定一种）
- 支持 **注释** `{{/* ... */}}`（不输出），便于维护模板
- **不包含**：`if` / `range` / `with` / 管道 `|` / `define` / `template` 子模板

**渲染规则**

- 仅对 **`type: text` 的 `content`** 执行宏替换。
- **`type: chat`**：按 session 内消息 **时间/seq 顺序** 展开；每条消息 **不做** 宏替换，原样输出。
- 输出为 **纯文本拼接**：按 `blocks` 顺序依次追加；每个 text 块或 chat 中的每条消息，均以 **`{role}: `** 为行首前缀（或块内首行前缀，多行内容归属同一 role 段，格式在实现说明中固定一种，验收用例锁定）；**不输出 JSON**；**不输出 block name 标题**（所见即所得，AI 看到即人类看到）。
- 定义文件的默认交换格式为 **YAML**；本期 **不提供** 单独的 serialize/export 子命令。

**CLI**

- 命令：`nm prompt render --path <path>`
  - `<path>`：**本机文件系统路径**（相对 cwd 或绝对路径），读取 blocks YAML
  - **chat 数据源**：与现有 CLI 一致，使用 **当前默认 session**（`--project` / `--session` 或 config 默认，与 `nm message` 等一致）
  - **worktree 数据源**：**当前 session 域** worktree display
- 复用现有 runtime / DB / bootstrap；本期 **不新增** `validate` / `lint` 子命令

**Core（交付边界，不写技术方案）**

- 在 `@novel-master/core` 提供可被 CLI 调用的 **解析 + 渲染** 能力（与 SqlTemplateParser、worktree display 同级复用），具体模块划分见后续 SPEC。

### 不包含范围

- 不在 VFS / DB 内管理或版本化 prompt 文件（仅读本地文件）
- 不调用 LLM、不发起网络请求
- 不包含 `apps/mobile`
- 不支持 define/template、with、range、if、管道函数等进阶模板特性
- 不提供 `serialize` / `export` / `validate` / `lint` 等其它 `nm prompt` 子命令
- `chat` 块内消息内容 **不做** 宏替换
- 不支持在 blocks YAML 顶层声明任意自定义 render 参数对象（首期无 `{{ .session }}` 等）；若模板出现未定义占位符，行为由实现锁定并在验收中覆盖

## 核心需求

1. **Block schema**：校验 `type` / `role` / `content` 组合合法；非法 YAML 或未知 `type` 报错且非零退出码。
2. **YAML 解析**：从文件加载 `blocks` 列表，保留块顺序。
3. **text 宏引擎**：实现 `{{ .worktree }}`、`{{ $.time }}`、`{{ $.week_cn }}` 及注释；支持 `{{ .a.b }}` 语法形态。
4. **chat 绑定**：从当前默认 session 读取消息列表，映射为 `system` / `user` / `assistant` 角色前缀输出。
5. **worktree 绑定**：渲染时计算 session 域 worktree display 字符串赋给 `.worktree`。
6. **CLI `render`**：`nm prompt render --path` 将结果写入 stdout；错误信息写入 stderr，退出码非 0。
7. **可测试性**：提供至少一个示例 prompt YAML 与 CLI 验收记录（可放在 `Iterations/prompt-engine/test/`，由后续迭代补充，PRD 仅要求验收时可执行）。

## 验收标准

### Block 定义

- [ ] **Given** 合法 YAML 含 `text`+`chat`+`text` 三块，**When** 解析，**Then** 得到顺序正确的三块模型，且 `chat` 块无 `role`。
- [ ] **Given** `type: text` 但缺少 `role`，**When** 解析或渲染，**Then** 失败并报可读错误。
- [ ] **Given** `type: chat` 且含 `role` 字段，**When** 解析或渲染，**Then** 失败并报可读错误。
- [ ] **Given** 未知 `type: foo`，**When** 解析或渲染，**Then** 失败并报可读错误。

### 宏替换（仅 text content）

- [ ] **Given** `content` 含 `{{ .worktree }}` 且 session 已配置 worktree，**When** `render`，**Then** stdout 对应段包含与 `nm session worktree`（或等价 display 命令）一致的展示文本。
- [ ] **Given** `content` 含 `{{ $.time }}`，**When** `render`，**Then** 输出中时间为本地 `YYYY-MM-DD HH:mm:ss` 格式（测试可 mock 或使用宽松匹配）。
- [ ] **Given** `content` 含 `{{ $.week_cn }}`，**When** `render`，**Then** 输出中星期为本地日期的中文（如「星期一」）。
- [ ] **Given** `content` 含 `{{/* note */}}`，**When** `render`，**Then** 注释不出现在 stdout。
- [ ] **Given** `chat` 块，**When** `render`，**Then** session 内历史消息按序出现，且消息正文中的 `{{ ... }}` **不被** 替换。

### CLI 输出

- [ ] **Given** 默认 session 中有多条 message，且 prompt 文件含 `chat` 块，**When** `nm prompt render --path <file>`，**Then** stdout 为纯文本，含按序的 `role:` 前缀行，**不是** JSON/YAML。
- [ ] **Given** 仅含两个 `text` 块，**When** `render`，**Then** stdout 等于两段带 `role:` 前缀的拼接结果，中间无 block name 标题。
- [ ] **Given** 不存在的文件路径，**When** `render`，**Then** 非零退出码，stderr 有错误说明。
- [ ] **Given** 无默认 session 或 session 不存在，**When** `render` 且定义含 `chat` 块，**Then** 非零退出码或明确错误（行为须在实现说明中二选一并写用例）。

### 范围外（本期不应出现）

- [ ] **When** 仅执行本期交付，**Then** 不存在 `nm prompt serialize|validate|export` 等子命令。
- [ ] **When** `render`，**Then** 不发起任何 LLM HTTP 请求。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 未定义模板字段 | 如示例中的 `{{ .current_input }}` 首期无数据源，须约定报错或输出空，并在示例中改为实际支持的字段 |
| 多行 `content` 与 `role:` 前缀 | 多行正文是否每行加前缀、仅首行加前缀，须在实现说明中固定，避免「人类所见」与模型 API 消息数组语义漂移（本期 stdout 以 PRD「所见即所得」为准） |
