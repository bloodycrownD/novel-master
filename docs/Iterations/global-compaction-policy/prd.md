# 全局压缩策略（与 Agent 解耦）PRD

## 背景

当前压缩（compaction）配置嵌在 **AgentDefinition.compact** 中：触发条件（token / 消息条数 OR）、动作（`keepLastN` + `abstract`）、摘要注入依赖同文件内的 **`type: abstract` Prompt 块**。运行时 `CompactionPipeline` 从 **正在执行的 Agent 定义** 读取 `compact`，且 `abstract.type: agent` 使用 **同一 Agent 的 model** 调摘要。

实践中压缩解决的是 **会话上下文生命周期** 问题，与「该 Agent 的人设、工具、主对话模型」正交；绑在 Agent 上会导致：

- 每个 Agent 重复配置相同压缩策略；
- 专用「摘要 Agent」与「对话 Agent」无法自然组合；
- Agent 配置文件职责过重，不利于 App 设置页与 CLI 统一管理。

用户目标：将压缩策略抽为 **独立领域对象**，**全局仅一条** 策略，全体会话共用；`abstract.type: agent` 时通过 **agentId** 引用 Agent 列表中的任意 Agent（可与当前对话 Agent 不同）。**不考虑** 旧版 `AgentDefinition.compact` 的兼容迁移。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 领域解耦 | `AgentDefinition` **不再包含** `compact` 字段；压缩策略有独立模型与持久化 |
| 全局单例策略 | 全应用 **至多一条** 生效的压缩策略配置；不按 project / session 下发 |
| 可扩展摘要 Agent | `abstract.type: agent` 必须支持 **agentId** 指向已注册 Agent；摘要调用使用该 Agent 的 model/采样配置 |
| 运行时行为保持 | 触发 OR、hide、`[Compaction summary]` 用户消息、`type: abstract` 块注入等行为与现网 **可观测等价**（在策略启用且配置等价时） |
| 可配置 | 通过 **novel.db KKV（或等价单记录存储）** 读写；CLI 提供子命令管理（见核心需求） |

**量化验收（首期）：**

- 删除 `compact` 后，`examples/agent-writer.yaml` 等样例改为 **无 compact 段**，压缩仅由全局策略控制。
- Core 单测 + 既有 compaction 相关测试改编后 **全绿**。
- CLI 可 **set / show** 全局策略；`nm agent run --agent-config` **不再**从 Agent 文件读取压缩配置。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 开发者 / 运维 | 在 CLI 配置一次全局压缩阈值与摘要 Agent，所有项目会话一致 |
| 产品（App 设置） | 「压缩与摘要」独立设置页，与 Agent 列表编辑分离 |
| 对话 Agent 作者 | 只维护 prompts/tools/model，不关心压缩 |
| 摘要 Agent 作者 | 维护轻量 Agent（如仅 system + 无 tools），专供压缩策略引用 |

## 范围

### 包含范围

1. **新领域模型：CompactionPolicy（名称以实现为准）**
   - 字段与现 `CompactConfig` 对齐并扩展：
     - `trigger`：`tokenThreshold?`、`floorThreshold?`（至少一项，OR）
     - `action`：`keepLastN`、`abstract`
     - `abstract`：`type: text`（content）| `type: agent`（**agentId** 必填，**instruction** 可选）
   - **enabled**（或等价）：全局可关闭压缩（关闭时 pipeline 不执行）
   - 校验：引用的 **agentId** 必须存在于 Agent 注册表/存储（校验时机见 SPEC）

2. **持久化**
   - **novel.db** 内 **单条** 记录（KKV 或专用 key，SPEC 定键名与 JSON schema）
   - 无记录或 `enabled: false` 时视为不压缩

3. **运行时**
   - `CompactionPipeline.maybeCompact` 入参改为读取 **全局 CompactionPolicy**，**不再**读取 `AgentDefinition`
   - `abstract.type: agent`：按 **agentId** 加载目标 Agent，使用其 `model.applicationModelId` 与 `params` 调摘要（**无 tools**）
   - `AgentRunner` / `createAgentRunner` 接线调整；对话用 Agent 与摘要用 Agent 分离

4. **AgentDefinition 变更**
   - 从 schema / 类型 / 序列化中 **移除** `compact`
   - **不考虑** 旧 YAML 中 `compact:` 段的兼容；含该字段的文件 **校验失败** 或 strict 拒绝（以实现为准，须可判定）

5. **Prompt**
   - 对话 Agent 仍通过 **`type: abstract` 块** + `{{.abstract}}` 消费摘要（块留在 **对话 Agent** 的 prompts 中）
   - 压缩策略 **不** 携带 prompts 块列表

6. **CLI**
   - 子命令族（命名 SPEC 细化，如 `nm compaction show|set|clear`）：
     - 查看当前全局策略
     - 设置/更新（支持从 YAML/JSON 文件导入或键值编辑）
     - 可选：禁用（enabled false）或 clear

7. **示例与文档**
   - 更新 `examples/agent-writer.yaml`（去掉 `compact`）
   - 提供全局策略配置示例（文档或 `examples/` 下样例文件，仅作参考，权威存储为 DB）
   - 更新 `feature-inventory` / monorepo 说明中与「Agent 内压缩」相关的表述

8. **移动端原型（与 Core 同期，必做）**
   - Agent 编辑器 **移除**「压缩策略 compact」区块；Agent mock 数据 **不含** `compact`
   - 「我的」增加 **压缩策略** 入口 → 全屏编辑 **全局** 策略（mock 内存态，字段对齐 `CompactionPolicy` + `agentId` 下拉）
   - 更新 `examples/mobile/docs/feature-inventory.md` 与 `README.md`

### 不包含范围

- 按 project / session 的不同压缩策略（用户明确 **仅全局一条**）
- 多套策略并存、策略版本历史、A/B
- 自定义 Trigger/Action 插件脚本
- 真实 tokenizer 对接（仍可用字符估算，除非 SPEC 单列）
- Agent 定义存入 DB（仍可为文件；**agentId** 引用范围以实现为准）
- 压缩策略的图形化时间线/可观测 UI（会话日志属其他迭代）
- 旧 `agent.compaction.*` 全局 config 键恢复

## 核心需求

1. **CompactionPolicy** 作为独立聚合根（或等价领域对象），与 **AgentDefinition** 无包含关系。
2. **全局单例**：持久化层保证读写的是同一条逻辑配置；并发更新策略以实现为准（CLI 单用户即可）。
3. **`abstract.type: agent` 必须含 agentId**，解析后加载目标 Agent 并调用其模型做摘要。
4. **AgentDefinition 删除 compact**；反序列化与 Zod **不包含** compact。
5. **CompactionPipeline** 仅依赖全局策略 + session + worktreeDisplay（及摘要 Agent 解析服务）。
6. **CLI** 可管理全局策略；`nm agent` 行为不依赖 Agent 文件中的压缩段。
7. **测试**：改编 `compaction.test.ts`、`agent-runner` 相关用例；新增 policy 持久化与 agentId 引用校验测试。

## 验收标准

### 模型与配置

- **Given** 一份 Agent YAML 含 `compact:` 段  
  **When** 执行 `deserializeAgentDefinition`（或等价校验）  
  **Then** **失败** 并提示非法字段（或不包含 compact 的 schema 拒绝）。

- **Given** `examples/agent-writer.yaml` 已去除 `compact`  
  **When** 加载为对话 Agent  
  **Then** 成功；压缩行为 **仅** 由全局策略决定。

### 全局策略

- **Given** 全局策略 `enabled: true` 且 trigger/action 与现 `agent-writer` 旧 compact 等价  
  **When** 会话可见消息满足 trigger  
  **Then** 发生 hide、追加 `[Compaction summary]` 用户消息、Runner 侧 `abstract` 非空；`type: abstract` 块出现在后续 LLM system 中。

- **Given** 全局策略 `enabled: false` 或未配置  
  **When** 任意 Agent run  
  **Then** **不** hide、**不** 追加 summary 消息（与现 `createNoOpCompactionPipeline` 行为一致）。

- **Given** `abstract.type: agent` 且 `agentId` 指向 Agent B，对话使用 Agent A  
  **When** 触发压缩  
  **Then** 摘要 LLM 调用使用 **Agent B** 的 `applicationModelId`（及 params），**不是** Agent A；且 **无 tools**。

- **Given** `agentId` 不存在  
  **When** 设置或触发压缩（以实现定义的校验点为准）  
  **Then** 明确错误，不静默回退到对话 Agent。

### CLI

- **Given** 通过 CLI 写入全局策略  
  **When** `nm compaction show`（或等价）  
  **Then** 输出与库内一致（trigger、action、enabled、agentId 等）。

- **Given** 已配置全局策略  
  **When** `nm agent run --agent-config <无 compact 的 agent>`  
  **Then** 压缩仍可按全局策略执行。

### 回归

- **Given** 仓库根执行 `npm test`（core/cli 相关包）  
  **Then** 全绿（不含仅依赖旧 compact 字段的用例）。

---

## 风险与待确认项（扩展章节）

| 项 | 说明 |
|----|------|
| Agent 注册表来源 | `agentId` 解析依赖 Agent 列表存储方式（文件目录 vs 未来 DB），SPEC 需定最小可行引用解析 |
| 无 abstract 块的对话 Agent | 压缩仍执行 hide/summary 消息，但 Prompt 不展示摘要；是否 CLI 警告由 SPEC 决定 |
| 全局策略误删 | 需提供 `clear` 或默认 disabled，避免无声失败 |

---

**请确认本 PRD 后**，再进入 SPEC（存储键名、CLI 子命令、类图、迁移步骤）。本文件路径：

`.apm/kb/docs/Iterations/global-compaction-policy/prd.md`
