# Agent 配置形态整理 PRD

## 背景

`agent-model-decouple` 已落地：Agent 不再内嵌 `model: { applicationModelId, params }`，改为可选 `preferredModelId`，工作区通过 `nm model use` 管理当前模型，采样参数归属已保存模型档案。

实践中暴露三类问题：

1. **命名与语义不清**：`preferredModelId` 易被理解为「导出/持久化状态」，实际是 **Agent 可选默认模型（pin）**，与 Mobile 原型里「Agent 专属模型」同一概念；字段名不直观。
2. **可分享模板混入运行态**：`examples/compaction-policy.yaml` 含 `enabled: true`；示例 Agent 含具体 `preferredModelId`，不利于作为仓库内可复用模板。
3. **配置结构冗余**：`registry.json` + 多文件 + Agent 内 `name` 与 registry key 重复；`prompts.blocks` 为数组且每项重复 `name`，渲染层并不依赖 `name`。

本迭代在 **不恢复** 旧版嵌套 `model.params` 的前提下，统一 **Agent 文件形态、压缩策略模板、模型解析语义**，使「可进 Git 的模板」与「工作区/DB 运行态」边界清晰。

**前置依赖**：agent-model-decouple、global-compaction-policy、persistent-state-and-preferences、provider-model（采样档案）已落地。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Agent 可选默认模型语义清晰 | 字段由 `preferredModelId` **改名为** `model`（值为 `applicationModelId` 字符串）；含 `preferredModelId` 或旧嵌套 `model:` 的文档 **校验失败** |
| 工作区模型单例 | 未配置 Agent `model` 时，对话与压缩摘要均回退 **工作区当前模型**（`nm model use`）；**无**会话级、无 provider 默认模型参与解析 |
| 可分享模板干净 | `examples/` 下 Agent 模板 **不含** `model`；压缩策略模板 **不含** `enabled` |
| Agent 文件收敛 | 示例与推荐布局为 **单一 `agents.yaml`**（多 agent 内嵌），**移除** `registry.json` 依赖 |
| Prompt blocks 有序 map | `prompts.blocks` **仅接受** YAML map（key 为块名）；数组格式 **拒绝** 并提示迁移 |
| 压缩模板与运行态分离 | 模板不含 `enabled`；`set --file` 写入 `trigger`/`action` 且 **`enabled` 默认为 `true`**；**`disable`** 暂停；**`remove`** 删除策略 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 作者 | 编辑 `agents.yaml` 中某 agent 的 prompts、runtime；可选为该 agent 写 `model` 作为默认；分享时省略 `model` |
| CLI 用户 | 平时 `nm model use`；临时 `nm agent run --modelId` 覆盖；`nm compaction set --file` 导入后即生效（默认启用） |
| 压缩运维 | 仓库内维护无 `enabled` 的 `compaction-policy.yaml`；环境内用 **disable** 临时关闭；不要策略时用 **remove** 清空 |
| 摘要 Agent | `compaction` 引用 `agentId`；摘要所用模型解析：**`--modelId` → 该 Agent 可选 `model` → 工作区当前模型** |

## 范围

### 包含范围

1. **AgentDefinition 字段**
   - 删除 `preferredModelId`。
   - 新增可选 **`model: string`**（`applicationModelId`，须为已保存模型；校验方式与现 `preferredModelId` 相同）。
   - 拒绝：顶层 `preferredModelId`、嵌套 `model: { applicationModelId, ... }`、`model.params`。
2. **模型 id 解析（宿主/CLI）**
   - 对话与 Agent 执行：**`--modelId` → Agent.`model` → 工作区 current model → 报错**。
   - 压缩摘要（`abstract.type: agent`）：**`--modelId` → 摘要 Agent.`model` → 工作区 current model**（与对话 Agent 的 pin 独立）。
   - Core Runner 仍只接收已解析的 `applicationModelId`（Core 不读 DB/state）。
3. **Agent 文件布局**
   - 支持（并推荐）**单文件多 Agent**，例如 `agents.yaml` 顶层 `agents: { writer: {...}, summarizer: {...} }`。
   - 移除对 `{home}/agents/registry.json` 的依赖；`agentId` 为内嵌 map 的 key。
   - `examples/` 提供合并后的示例，更新 `examples/README.md` 操作说明。
4. **`prompts.blocks`**
   - 配置为 **有序 map**：key 即块名，块内 **无** `name` 字段。
   - **不接受** 数组格式（破坏性变更，无自动迁移）。
5. **Compaction 策略模板 vs 状态**
   - 模板文件（含 examples）：仅 `schemaVersion`、`trigger`、`action`（**不含** `enabled`）。
   - **`nm compaction set --file`**：写入 `trigger`/`action`；持久化时 **`enabled` 固定为 `true`**（模板中的 `enabled` 字段 **拒绝或忽略**，不得从文件导入）。
   - **`nm compaction disable`**：保留策略内容，仅将 `enabled` 置为 `false`（暂停压缩）。
   - **`nm compaction remove`**：删除工作区中的策略记录（无策略 ≡ 不压缩）；与「disable」区分——不要策略时用 remove，而非长期 disable。
   - 子命令命名可与现网 `clear` 对齐（SPEC 定是否保留别名）；产品语义以 **remove** 为准。
   - `nm compaction show` 输出完整运行态（含 `enabled`）；无记录时等价于未配置策略。
6. **示例与文档**
   - 更新 `examples/compaction-policy.yaml`、`examples/agents/`（或合并后的 `agents.yaml`）、移除/替代 `agents-registry.example.json`。
   - 本迭代 **验收范围含 `examples/` 与 CLI/Core**；**不含** `examples/mobile` 原型 UI 改造（若与 `model` 字段文案不一致，记为后续对齐项）。

### 不包含范围

| 项 | 说明 |
|----|------|
| 自动迁移 CLI | 旧 YAML（`preferredModelId`、blocks 数组、registry.json）**校验失败**即可；不提供 `migrate` 命令 |
| 模型采样档案 | 仍归属 provider/已保存模型；Agent **不得** 出现 temperature 等 params |
| 会话级 current model | 本期仅工作区单例 |
| per-agent 模型存 KKV（不进 YAML） | 本期 pin 仅通过 Agent 文件可选 `model` 表达 |
| Provider `defaultModelId` 参与解析 | 仍不作为回退 |
| RN 正式 App | 仅原则性对齐，不做 App 验收 |
| 技术 SPEC / 接口 / 表结构 | 由后续 SPEC 迭代编写 |

## 核心需求

1. **可选 Agent 默认模型**：`model` 为可选字符串 pin；未配置时完全跟随工作区当前模型；`--modelId` 优先级最高。
2. **模板与运行态分离**：仓库示例与 `set --file` 使用的文件 **不含** `enabled`；导入后 **默认启用**；暂停用 disable，彻底不要策略用 remove。
3. **单文件多 Agent**：以 `agents.yaml`（或等价单文件）为推荐形态；compaction 的 `agentId` 指向该文件内 key。
4. **blocks 有序 map**：去掉块级 `name` 冗余；顺序由 map 键顺序决定；旧数组格式拒绝加载。
5. **破坏性更名与清理**：`preferredModelId` 不再合法；旧嵌套 `model` 块不再合法；`registry.json` 不再作为必需组件。
6. **examples 即模板**：examples 中 Agent **不写** `model`；compaction 示例 **不写** `enabled`。

## 验收标准

### Agent 字段与解析

- [ ] **Given** Agent 文档含 `preferredModelId: mock/test`，**When** 加载，**Then** 校验失败，错误信息指明应使用可选字段 `model`（或已移除 `preferredModelId`）。
- [ ] **Given** Agent 文档含旧格式 `model: { applicationModelId: mock/test, params: {...} }`，**When** 加载，**Then** 校验失败。
- [ ] **Given** Agent 仅含 `prompts`、`runtime`，无 `model`，工作区已 `nm model use mock/test`，**When** `nm agent run`，**Then** 使用 `mock/test`。
- [ ] **Given** Agent 含 `model: mock/other`，工作区为 `mock/test`，无 `--modelId`，**When** `nm agent run`，**Then** 使用 `mock/other`。
- [ ] **Given** 同上 Agent，**When** `nm agent run --modelId mock/override`，**Then** 使用 `mock/override`。

### blocks map

- [ ] **Given** `prompts.blocks` 为 YAML map且含 `system`、`history` 等 key，**When** 加载，**Then** 成功，运行时块顺序与文件键顺序一致。
- [ ] **Given** `prompts.blocks` 为数组格式，**When** 加载，**Then** 校验失败，提示需改为 map。

### agents 单文件与 registry

- [ ] **Given** `{home}/agents.yaml`（或文档约定路径）内嵌 `summarizer` 与 `writer`，**When** compaction 策略引用 `agentId: summarizer`，**Then** 能解析到对应定义，**无需** `registry.json`。
- [ ] **Given** 仅存在旧版 `registry.json`、无新格式 agents 文件，**When** 解析 compaction agent，**Then** 失败并提示使用新布局（或文档约定路径）。

### Compaction 模板与 enabled

- [ ] **Given** `compaction-policy.yaml` 仅含 `trigger`、`action`（无 `enabled`），**When** `nm compaction set --file` 后 `nm compaction show`，**Then** `trigger`/`action` 与文件一致，且 **`enabled: true`**。
- [ ] **Given** 已 set 且 `enabled: true`，**When** `nm compaction disable`，**Then** `show` 中 `enabled: false`，且 pipeline **不**触发压缩；`trigger`/`action` 仍保留。
- [ ] **Given** 已 disable 的策略，**When** 再次 `nm compaction set --file`（或 SPEC 约定的 enable 路径，若有），**Then** 行为符合 SPEC（至少：重新 set 后 **enabled 恢复为 `true`**）。
- [ ] **Given** 工作区已有策略，**When** `nm compaction remove`，**Then** `show` 表示无策略（或 NOT_FOUND），pipeline 不压缩。
- [ ] **Given** 模板文件含 `enabled: false`（或任意 `enabled`），**When** `nm compaction set --file`，**Then** 拒绝加载，或忽略该字段且持久化仍为 `enabled: true`（SPEC 二选一，推荐 **拒绝** 以免误解）。

### 摘要 Agent 模型

- [ ] **Given** 摘要 agent `summarizer` 无 `model`，工作区 `mock/test`，对话 agent 有 `model: mock/other`，**When** 触发 agent 摘要压缩，**Then** 摘要 LLM 使用 `mock/test`（非对话 agent 的 pin）。
- [ ] **Given** `summarizer` 含 `model: mock/summary`，工作区 `mock/test`，**When** 触发 agent 摘要，**Then** 使用 `mock/summary`（无 `--modelId` 时）。

### examples

- [ ] `examples/` 中 Agent 示例 **无** `model` 字段；`examples/compaction-policy.yaml` **无** `enabled`。
- [ ] `examples/README.md` 描述新布局（单文件 agents、set/disable/remove、blocks map），**不再**要求复制 `agents-registry.example.json`。

---

**状态**：已确认（2026-05-30）— 可选 `model` pin；`set --file` 后 **`enabled` 默认 `true`**；不要策略用 **remove**，临时关闭用 **disable**。

**路径**：`.apm/kb/docs/Iterations/agent-config-shape/prd.md`
