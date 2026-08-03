# Agent VFS 工具集（10 工具）PRD

## 背景

当前 Agent 内置 VFS 工具共 **7 个**（`vfs.read` / `vfs.write` / `vfs.replace` / `vfs.list` / `vfs.mkdir` / `vfs.glob` / `vfs.grep`），可覆盖读写与搜索，但缺少 **删除、移动、复制** 等目录树操作。`VfsService` 端口已支持 `delete`，且 mobile/desktop 文件管理器已实现 rename/move 组合逻辑，但未下沉到 Core，也未注册为 Agent 工具。

Agent 运行在 **session-scoped VFS** 沙箱内，不暴露真实 Shell。需要在专有工具层补齐 Cursor 常用文件操作心智（Read / Write / StrReplace / Delete / Glob / Grep + 目录类操作），形成 **10 个独立工具**，其中 `rename`/`mv` 合并为 `vfs.move`，`rmdir` 归入 `vfs.delete`（非 recursive）。

## 目标（含成功指标）

- Agent 默认工具集扩展为 **10 个** `vfs.*` 工具，LLM 暴露集与 ToolRunner 可执行集一致。
- 树操作（move/copy/delete）在 Core 单点实现，mobile/desktop 文件管理器复用同一逻辑，避免行为分叉。
- 变更类工具纳入 checkpoint 与 mutating 追踪。

成功指标（可量化）：

- `registerVfsTools()` 后 `registry.list()` 长度为 **10**，名称固定为下表 10 项。
- Core 单测新增不少于 **12 个可判定断言点**（含 delete / move / copy 及 mutating 集合）。
- 现有 Agent 工具策略用例（T1–T6）在工具数变化后仍通过；未配置 `tools` 的 Agent 自动获得全部 10 个工具。

## 用户与场景

- **Agent 使用者**：让模型在 session 工作区内完成「改内容、删文件、移目录、复制模板」等任务，无需多步 read+write+delete 拼凑。
- **Agent 配置者**：通过 YAML `tools.allow` / `tools.deny` 精细控制（如只读 Analyst 禁用 write/move/copy/delete）。
- **平台开发者**：CLI / mobile / desktop Agent 运行路径共用 Core 工具定义，UI 层 rename/copy 与 Agent 语义一致。

## 范围

### 包含范围

**10 个专有工具（均注册为 `vfs.*`）**

| 工具 | 用途 |
|------|------|
| `vfs.read` | 读文件（已有） |
| `vfs.write` | 写文件（已有） |
| `vfs.replace` | 字符串替换（已有） |
| `vfs.delete` | 删文件或目录；默认非 recursive（空目录/rmdir）；可选 recursive 删子树 |
| `vfs.glob` | 路径 glob（已有） |
| `vfs.grep` | 内容搜索（已有） |
| `vfs.list` | 列目录（已有） |
| `vfs.mkdir` | 建空目录（已有） |
| `vfs.move` | 移动或重命名文件/目录（合并 rename + mv） |
| `vfs.copy` | 复制文件；目录需 `recursive: true` |

**Core**

- 新增 `domain/vfs/logic/` 下 move/copy 纯 VfsService 组合函数（从 mobile/desktop 下沉）。
- 扩展 `vfs-tools.ts`：注册 `vfs.delete` / `vfs.move` / `vfs.copy`；更新 `MUTATING_VFS_TOOL_NAMES`。
- 扩展 `format-tool-output.ts`：delete/move/copy/mkdir 成功时返回简洁 `ok` 文本（与 write 一致）。
- mobile/desktop `vfs-operations.service.ts` 改为调用 Core 导出函数（行为对齐，减少重复）。

**文档与测试**

- 更新 Agent 编辑器工具名提示（mobile/desktop 若有硬编码说明）。

### 不包含范围

- 真实 OS Shell 或命令解释器。
- 新增 `vfs.rename` / `vfs.rmdir` / `vfs.mv` 等冗余工具名。
- 修改 `VfsService` 端口签名或 CLI `nm vfs` 子命令行为。
- LLM 工具名 alias（如 `Read` → `vfs.read`）；仅 system prompt 层引导（本迭代不做 alias 层）。
- ZIP 导入导出、checkpoint 算法变更（仅 mutating 工具名集合扩展）。

## 核心需求（6 条）

1. **工具集完备**：`registerVfsTools` 注册恰好 10 个工具，名称与 schema 见 SPEC；现有 7 工具 input/output **保持兼容**（不 breaking）。
2. **delete 语义**：默认 `recursive: false`；删非空目录失败（`DIRECTORY_NOT_EMPTY`）；`recursive: true` 删子树；删不存在路径失败（`NOT_FOUND`）。
3. **move 语义**：支持文件与目录；目录 move 与 mobile 现有 `renameVfsDirectory` 行为一致；目标已存在时按 VFS 错误可判定失败。
4. **copy 语义**：单文件默认；`recursive: true` 复制目录子树；不删除源路径。
5. **Checkpoint 一致**：`vfs.write` / `vfs.replace` / `vfs.delete` / `vfs.mkdir` / `vfs.move` / `vfs.copy` 均视为 mutating，Agent step 结束后触发 checkpoint capture（与现网 write/replace 一致）。
6. **策略兼容**：未配置 `tools` 的 Agent 获得 10 工具；allow/deny 校验工具名必须 ∈ 注册表；幻觉调用未注册工具仍返回 NOT_FOUND。

## 验收标准

- **R1 工具枚举**  
  Given 空 registry  
  When `registerVfsTools(registry)`  
  Then `registry.list()` 排序后等于 10 个固定名称（含新增 delete/move/copy）。

- **R2 delete 文件**  
  Given session VFS 存在 `/a.txt`  
  When `vfs.delete { path: "/a.txt" }`  
  Then 文件不存在；再次 read 报 NOT_FOUND。

- **R3 delete 非空目录失败**  
  Given `/dir/a.txt` 存在  
  When `vfs.delete { path: "/dir" }`（非 recursive）  
  Then 失败且 `/dir/a.txt` 仍在。

- **R4 move 文件**  
  Given `/old.md` 有内容  
  When `vfs.move { from: "/old.md", to: "/new.md" }`  
  Then `/new.md` 内容一致，`/old.md` 不存在。

- **R5 move 目录**  
  Given `/src/a.md`、`/src/sub/b.md`  
  When `vfs.move { from: "/src", to: "/dst" }`  
  Then `/dst/a.md`、`/dst/sub/b.md` 存在，`/src` 下对应路径消失。

- **R6 copy 目录**  
  Given `/src/x.md`  
  When `vfs.copy { from: "/src", to: "/dst", options: { recursive: true } }`  
  Then `/dst/x.md` 与源内容一致，`/src/x.md` 仍在。

- **R7 mutating 集合**  
  Given `MUTATING_VFS_TOOL_NAMES`  
  Then 包含 write/replace/delete/mkdir/move/copy；不包含 read/list/glob/grep。

- **R8 Agent 策略**  
  Given Agent 定义 `tools: { allow: ["vfs.read", "vfs.grep"] }`  
  When resolve + run  
  Then LLM 仅 2 工具；调用 `vfs.move` 返回 NOT_FOUND。

- **R9 UI 复用**  
  Given mobile/desktop rename 入口  
  When 重命名文件/目录  
  Then 调用 Core 下沉后的 move 函数（单测或集成测断言路径结果与 Agent move 一致）。
