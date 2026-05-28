# Tool System (VFS Tools) PRD

## 背景

当前系统缺少“工具（Tool）”的统一定义、注册与调用能力，导致上层（Agent / Workflow / CLI / UI）无法以一致方式声明可用工具、验证输入，并在运行时安全地执行工具逻辑。

本需求聚焦在 **Core** 层提供一个可复用的工具系统（工具注册中心 + 调用），并提供一组与现有 VFS 能力一致的基础工具：`grep` / `glob` / `read` / `write` / `replace` / `list`。

## 目标（含成功指标）

- 上层可以在运行时注册/获取/调用工具，并获得强类型的输入输出校验。
- 提供一组开箱即用的 VFS 基础工具，作为默认工具集，供 Agent/Workflow 自行编排。

成功指标（可量化）：
- 新增的工具系统在 Core 单测中覆盖率：至少覆盖“注册/重复注册/调用/校验失败/工具不存在”等关键路径（不少于 8 个断言点）。
- 内置 VFS 工具至少覆盖：`read`、`write`、`replace`、`list`、`glob`、`grep` 的可用性验证（可通过自动化测试判定）。

## 用户与场景

- **Agent/Workflow 开发者**：需要将“模型输出的工具调用”映射到具体可执行函数，但不希望工具层强耦合到“消息 content blocks”或“具体协议”。
- **核心服务层开发者**：需要统一的工具定义结构，避免分散实现导致的输入不一致、错误码不统一、可用工具列表无法枚举等问题。

## 范围

### 包含范围

- Core 提供：
  - 工具定义模型（名称、描述、输入/输出 schema、执行函数）
  - 工具注册中心（register / unregister / list / get）
  - 工具调用入口（call），并包含输入校验、统一错误返回（工具不存在、校验失败、执行异常）
- 内置工具（基于现有 VFS 能力）：
  - `vfs.read`
  - `vfs.write`
  - `vfs.replace`
  - `vfs.list`
  - `vfs.glob`
  - `vfs.grep`
- 工具可见范围由上层注入的 `VfsService` scope 决定：可以注入 session-scoped VFS，使工具**仅能访问当前 session 的路径前缀**。

### 不包含范围

- 不负责将工具调用/结果写入 ChatMessage（是否写入由上层 Agent/Workflow 决定）。
- 不实现完整 Agent 循环（system prompt → LLM → tool dispatch → 继续）。
- 不实现 LLM 协议层 function calling 适配（如 OpenAI tools / Anthropic tool_use block 的自动映射）。
- 不包含 UI / CLI 命令层面的交互设计（可后续迭代）；现有 `nm vfs ...` 命令不受本迭代影响。

## 核心需求（3-7 条）

1. **可注册与可枚举**
   - 支持按唯一 `name` 注册工具，并可列出当前可用工具清单（用于上层展示/选择）。
2. **强类型输入输出（schema 驱动）**
   - 工具注册时携带 `inputSchema` / `outputSchema`（或至少 inputSchema），调用时自动校验输入；校验失败给出可判定的错误。
3. **统一调用入口**
   - 通过 `call(name, input)` 调用工具，得到 `output`；并提供清晰的错误分类：工具不存在、输入校验失败、执行失败。
4. **内置 VFS 工具集**
   - 基于现有 VFS Service 能力提供上述 6 个基础工具的封装，并将其作为“默认工具集”可被快速接入。
5. **可注入依赖**
   - 内置 VFS 工具在运行时依赖 VFS 实例（或通过 context 注入），便于不同 scope / 项目会话复用。
6. **不强绑 content blocks**
   - 工具系统只负责注册与调用；不要求与 `ToolUseBlock` / `ToolResultBlock` 绑定，也不对消息结构做任何假设。

## 验收标准

- **Registry 行为**
  - Given 一个空的 registry
  - When 注册一个工具 `name = "vfs.read"`
  - Then `list()` 能返回包含该工具的清单，且 `get("vfs.read")` 可获取到工具定义

- **重复注册**
  - Given 已注册 `name = "vfs.read"`
  - When 再次注册同名工具
  - Then 返回可判定的错误（或拒绝覆盖，行为需一致可测试）

- **工具不存在**
  - Given registry 中不存在 `name = "no.such.tool"`
  - When `call("no.such.tool", {...})`
  - Then 返回可判定错误（工具不存在），且错误信息包含 tool name

- **输入校验失败**
  - Given `vfs.read` 的输入 schema 要求 `path` 为非空字符串
  - When `call("vfs.read", {})`
  - Then 返回可判定错误（校验失败），并包含具体字段错误信息

- **VFS read/write/replace 基本可用**
  - Given 一个可用的 VFS 实例与已注册的 `vfs.write` / `vfs.read` / `vfs.replace`
  - When 先 `vfs.write` 写入内容，再 `vfs.replace` 修改，再 `vfs.read` 读取
  - Then 读取内容与预期一致，并且 `write/replace` 返回的版本号等元信息可被断言

- **VFS list/glob/grep 基本可用**
  - Given 写入多个路径的文件
  - When 调用 `vfs.list` / `vfs.glob` / `vfs.grep`
  - Then 返回结果可被断言（路径集合与匹配项数量/位置等）

