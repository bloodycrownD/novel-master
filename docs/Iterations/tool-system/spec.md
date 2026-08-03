# Tool System (VFS Tools) 技术规格（SPEC）

## 设计目标

- 在 `@novel-master/core` 提供一个**可复用**的 Tool 系统：工具定义、注册中心、统一调用入口。
- Tool 层只负责“**注册 + 调用 + schema 校验 + 统一错误**”，不绑定 chat message / content blocks / LLM 协议。
- 提供一组默认内置工具：`vfs.read` / `vfs.write` / `vfs.replace` / `vfs.list` / `vfs.glob` / `vfs.grep`，直接复用现有 `VfsService`。
- 保持实现风格与现有 core 一致：E2E 依赖少、错误码可判定、测试可在内存 SQLite 上跑通。

## 总体方案

### 现状约束（来自代码探索）

- Core 已有稳定的 VFS 抽象与实现：
  - `VfsService`（`packages/core/src/service/vfs/vfs.port.ts`）
  - `DefaultVfsService`（`packages/core/src/service/vfs/impl/vfs.service.ts`）
  - 现有 VFS 已包含所需能力：`list/read/write/replace/glob/grep`（并且 glob 匹配器为自研 `matchGlob`）。
- Core 已内置“VFS scope（global/project/session）”映射能力：
  - `createScopedVfsService(...)` + `ScopedVfsService`
  - session scope 会将逻辑路径映射到物理前缀 `/projects/<projectId>/sessions/<sessionId>/...`，从而实现“session 级可见性”（工具看到的范围取决于注入的 VFS scope）。
- Core 已有“注册表”风格可参考：TDBC driver registry（`packages/core/src/infra/tdbc/registry.ts`）：
  - 使用 `Map` 存储，`register` 默认覆盖（last wins），`get/list` + 测试用清理方法。
- Core 当前没有显式 schema 校验库使用痕迹（代码中未出现 Zod），但 `package-lock.json` 中存在 `zod` 依赖条目（需要在实现阶段确认工作区依赖策略：是否引入到 `packages/core` dependencies）。
- 错误体系在各 domain/service 中统一用 `XxxError` + `code` discriminant（例如 `VfsError`, `PromptError`, `ChatError`, `ProviderError`）。

### 核心抽象

引入 Tool 体系三层：

1. **Tool 定义**
   - `name`：全局唯一（建议命名空间：`vfs.read`）
   - `description`：用于上层展示/日志
   - `inputSchema`：用于 `call()` 前校验
   - `outputSchema`（可选）：用于 `call()` 后校验（建议默认启用，便于测试/防御式编程）
   - `run(input, ctx)`：实际执行函数

2. **ToolRegistry**
   - 负责注册/查询/列举工具
   - 注册冲突策略：**拒绝重复注册**（比“last wins”更安全；也更符合“工具名唯一”直觉）

3. **ToolRunner**
   - 统一 `call(name, input, ctx)`：
     - 工具存在性检查
     - schema 校验（输入/输出）
     - 执行并将异常归一化为 ToolError（保留原始 error 作为 `cause`）

### Schema 选择（实现阶段决策）

本次需求明确要“typed generics + schema 驱动”。在实现阶段建议：

- 使用 `zod`（若工作区依赖允许）：
  - `inputSchema: z.ZodType<Input>`
  - `outputSchema?: z.ZodType<Output>`
  - `schema.safeParse(...)` 产出结构化错误，便于 `ToolError("INVALID_ARGUMENT", ...)`。

若后续不希望引入三方依赖，可退化为“自定义 schema interface（parse/validate）”，但会显著增加维护成本；此处先按 `zod` 方案落地（以实现阶段确认依赖为准）。

## 最终项目结构

建议新增目录（core）：

- `packages/core/src/domain/tool/`
  - `model/tool.ts`：Tool 类型定义（泛型 + schema）
  - `tool-errors.ts`：ToolError + error codes + 构造函数
  - `tool-registry.ts`：ToolRegistry（register/unregister/get/list）
  - `tool-runner.ts`：ToolRunner（call）
  - `builtin/vfs-tools.ts`：createVfsTools(ctx) 或 registerVfsTools(registry, deps)

并在 `packages/core/src/index.ts` 导出需要的 public API（ToolRegistry/ToolRunner/ToolError/内置 vfs tools factory）。

> 说明：路径以现有项目组织风格为准，若项目更倾向 `service/` 放“应用服务”，也可将 runner/registry 放在 `service/tool/`；但建议放 `domain/tool`，与 chat/vfs 的 domain 层保持一致。

## 变更点清单

### 新增（Core）

- Tool 领域模型与执行：
  - `Tool`, `ToolContext`（至少包含 `vfs: VfsService`，后续可扩展）
  - `ToolRegistry`
  - `ToolRunner`
  - `ToolError`（codes：`NOT_FOUND` / `CONFLICT` / `INVALID_ARGUMENT` / `FAILED`）
- 内置 VFS 工具：
  - `vfs.read`：输入 `{ path }`，输出 `VfsReadResult`
  - `vfs.write`：输入 `{ path, content, options? }`，输出 `{ version }`
  - `vfs.replace`：输入 `{ path, oldString, newString, options? }`，输出 `{ version, replacements }`
  - `vfs.list`：输入 `{ dir, options? }`，输出 `string[]`
  - `vfs.glob`：输入 `{ pattern, options? }`，输出 `string[]`
  - `vfs.grep`：输入 `{ pattern, options? }`，输出 `VfsGrepMatch[]`

### 可能修改（实现阶段才会做）

- `packages/core/package.json`：若需要显式加入 `zod` 到 dependencies（当前 core 的 dependencies 很精简，需要遵循仓库策略）。
- `packages/core/src/index.ts`：导出新模块 API。

### 明确不受影响（本迭代）

- 现有 CLI 的 `nm vfs read/write/grep/...` 命令不改动：它们继续直接调用 `VfsService`，不会经过本次新增的 ToolRegistry/ToolRunner。

## 详细实现步骤

1. **定义 ToolError**
   - 仿照 `VfsError/PromptError` 的模式：`class ToolError extends Error { code; toolName?; details? }`
   - 提供辅助构造函数：`toolNotFound(name)`, `toolConflict(name)`, `toolInvalidArgument(name, issues)`, `toolFailed(name, cause)`

2. **定义 Tool 类型与 schema 契约**
   - `Tool<Input, Output, Ctx>`
   - `inputSchema` / `outputSchema`（Zod）
   - `run(input: Input, ctx: Ctx): Promise<Output>`

3. **实现 ToolRegistry**
   - 内部 `Map<string, Tool<any, any, any>>`
   - `register`：同名拒绝并抛 `ToolError("CONFLICT")`
   - `unregister`：移除（返回 boolean）
   - `get/list`：获取与列举

4. **实现 ToolRunner**
   - `call(name, input, ctx)`：
     - registry.get -> not found => ToolError NOT_FOUND
     - inputSchema.safeParse -> invalid => ToolError INVALID_ARGUMENT（包含 issues）
     - await tool.run
     - outputSchema.safeParse（若提供）-> invalid => ToolError FAILED/INVALID_ARGUMENT（建议 FAILED，因为这是工具实现违约）

5. **实现内置 VFS 工具集**
   - 以 `VfsService` 为唯一依赖输入（通过 ctx 或构造参数注入）
   - 将 VfsError 透传（作为 `cause`）或映射为 ToolError FAILED（实现阶段确定一致策略）

6. **补齐测试**
   - registry：
     - register/list/get
     - duplicate register -> CONFLICT
     - unregister
   - runner：
     - tool not found
     - input invalid
     - tool throws -> FAILED
   - vfs tools：
     - write/read/replace 走通
     - list/glob/grep 结果可断言
   - 测试环境复用现有 `packages/core/test/vfs/helpers.ts`（in-memory sqlite + createVfsService）

## 测试策略

### 测试用例

- **ToolRegistry**
  - 注册后可 get/list
  - 重复注册同名工具返回/抛出 `ToolError(code="CONFLICT")`
  - unregister 后 get 为空

- **ToolRunner**
  - 调用不存在工具 -> `ToolError(code="NOT_FOUND")`
  - 输入缺字段/类型不符 -> `ToolError(code="INVALID_ARGUMENT")` 且包含 issues
  - tool.run 抛错 -> `ToolError(code="FAILED")` 且保留 cause

- **VFS 内置工具**
  - `vfs.write` 写入、`vfs.replace` 替换、`vfs.read` 读取结果一致
  - `vfs.list` 返回包含目标路径
  - `vfs.glob` 按 `matchGlob` 规则匹配
  - `vfs.grep` 返回 line/column/excerpt 可判定

## 风险与回滚方案

- **依赖风险（zod）**：若仓库希望 core 继续保持零/极少依赖，则需要实现自定义 schema 契约。
  - 回滚：将 schema 层抽象为 `Schema<T> { safeParse(input): { success; data|error } }`，实现最小适配层，不影响 registry/runner 的 API 形状。
- **错误映射一致性**：VFS 层已有 `VfsError`；Tool 层新增 `ToolError`，需明确“透传还是包裹”策略。
  - 回滚：runner 只负责 NOT_FOUND / INVALID_ARGUMENT，执行阶段错误原样抛出（会降低上层可判定性，但更简单）。

---

下一步：请你确认这份 `spec.md` 的总体方案（尤其是：**重复注册策略（拒绝 vs 覆盖）**、**zod 依赖策略**、**VfsError 是否透传**）。确认后我再进入编码实现。

