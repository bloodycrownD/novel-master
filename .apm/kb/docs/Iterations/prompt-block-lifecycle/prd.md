---
date: 2026-06-12
dependency:
  - Iterations/prompt-engine/prd.md
  - Iterations/agent-config-and-compaction/prd.md
---

# Prompt 块生命周期（lifecycle）PRD

## 背景

Novel Master 的 Agent 通过 **Prompt 块**（`text` / `chat`）组合出每次发给模型的上下文。当前行为是：`type: text` 且 `role` 为 `user` 或 `assistant` 的块，会在 **Agent 每一轮工具循环**（同一用户发送后的 step 0、1、2…）中 **重复注入** 为 synthetic 消息。

作者在 `type: chat` 之前放置「继续」类 `user` 文本块时，期望仅在 **用户发送或恢复后的第一轮** 带入模型；实际却每轮都出现，模型持续收到「继续」信号，容易 **跑满 maxSteps** 而非正常结束。这是配置意图与引擎行为不一致造成的体验问题。

Desktop 与 Mobile 已有 Agent 编辑器（Prompt 块卡片：名称、角色、内容），尚无「仅首轮带入 / 每轮都带入」的配置项。本需求在 **不改动 chat 块、system 块既有语义** 的前提下，为 **非 system 的 text 块** 增加可理解的 **生命周期** 配置，并在双端编辑器用 **「常驻」开关** 呈现。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 可配置生命周期 | 非 system 的 `text` 块可设为 **常驻**（每 agent step 都带入）或 **仅首轮**（本次用户动作触发的 agent run 的 step 0 带入，工具循环后续 step 不带入） |
| 解决「继续」误用 | 将 kick 类块设为「仅首轮」后，同一 run 内 **不再** 因该块重复注入而异常拉长工具循环；正常任务可在无工具调用时 **completed** 结束 |
| 向后兼容 | 未配置 lifecycle 的既有 Agent YAML/DB 配置行为与现网 **一致**（视为常驻） |
| 双端编辑一致 | Desktop、Mobile Agent 编辑器均提供同一套「常驻」开关与说明文案 |
| 可验收 | 下文验收标准在 Core 单测 + 双端 Agent 编辑 + 一次真实对话抽测中 **100% 可判定** |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 配置作者 | 在 `chat` 前放「继续 / 请开始」类 **user** 块，仅在用户点发送或空消息恢复后的 **第一轮** 生效，避免 tool loop 每轮重复 |
| Agent 配置作者 | 放 worktree / 文件树等 **上下文快照** 为 user 块，且希望 **每轮工具循环** 都更新带入（常驻开） |
| 日常创作者 | 使用已配置 Agent 对话，感知为 agent **该停则停**，不会因隐藏 prompt 配置而莫名一直跑工具 |

## 范围

### 包含范围

1. **Prompt 块模型扩展（业务语义）**  
   - 非 `system` 的 `text` 块支持生命周期：`always`（常驻）与 `once`（仅首轮）。  
   - 省略字段时等价 **常驻**，保证旧配置无感升级。

2. **运行时行为**  
   - **常驻**：每次组装发给模型的 prompt 时均包含该块（与现行为一致）。  
   - **仅首轮**：仅在 **一次用户发送或恢复** 所触发的 agent run 的 **第一轮 LLM 请求** 包含；同一 run 内后续 tool 循环轮次 **不包含**。  
   - `role: system` 的 text 块：始终按 system 合并，**不提供** lifecycle 配置（业务上视为永远常驻）。  
   - `type: chat` 块：无 lifecycle，语义不变。

3. **Agent 编辑器 UI（Desktop + Mobile）**  
   - 在 **非 system 的 text 块** 卡片上增加 **「常驻」开关**：**开 = 常驻（默认）**，**关 = 仅首轮**。  
   - 提供简短说明：关时「仅在用户发送/恢复后的第一轮带入；工具循环后续轮不再重复」。  
   - 保存、导入 YAML、再次打开编辑页时，开关状态与配置一致。

4. **配置持久化与交换**  
   - Agent 定义（YAML/JSON/DB）可读写 `lifecycle` 字段；`always` 时可省略字段以保持文件简洁。  
   - 非法 lifecycle 取值应拒绝加载并给出可理解错误（验收以「无法保存/无法加载 + 提示」为准）。

5. **真实 Prompt 预览 / Token 统计（业务口径）**  
   - 预览与 token 计数在 **无 agent run 上下文** 时，按 **首轮（step 0）** 展示与计量，使「仅首轮」块 **可见且可计数**；不因 lifecycle 导致预览空白或口径缺失。

### 不包含范围

| 项 | 说明 |
|----|------|
| `once_per_session`（整个会话一生一次） | 本期仅 **always / once（per agent run）** 两档 |
| 压缩后 auto-continue 专用块 | 仍由压缩/事件管线处理；不通过本 PRD 的 lifecycle 开关表达 |
| `type: chat` / `role: system` 的 lifecycle UI | chat 无开关；system 固定常驻 |
| CLI 新增独立子命令 | 不强制；若 Agent YAML 经现有路径可表达 lifecycle 即可 |
| 改 tool loop 上限、 doom loop 检测 | 属 runtime 策略，非本 PRD |
| iOS / Web 端 Agent 编辑器 | 未交付平台不纳入本期验收 |
| 技术 SPEC（接口、表结构、任务拆分） | 另文 `design-proposal` / SPEC |

## 核心需求

1. **生命周期语义清晰**：作者能区分「每轮工具循环都带」与「仅用户动作后第一轮带」，且后者不会在 tool step 1+ 重复出现。  
2. **默认常驻、兼容旧配置**：未写 lifecycle 的块与现网行为一致；作者无需批量改旧 Agent 即可升级。  
3. **UI 极简**：一个「常驻」开关即可，无需下拉或 `first_step` / `human_turn` 等术语暴露给用户。  
4. **system / chat 边界不变**：system 仍只进 system 合并；chat 仍注入会话历史；lifecycle 仅约束 **非 system 的 synthetic text 块**。  
5. **双端一致**：Mobile、Desktop 开关默认、文案、保存语义一致。  
6. **可观测**：作者在「真实 Prompt」类预览中能看到仅首轮块在首轮上下文中的位置与内容（用于配置自检）。  
7. **错误可理解**：配置非法 lifecycle 时，编辑/加载路径有明确失败反馈，不出现静默忽略。

## 验收标准

### 配置与兼容

- [ ] **Given** 既有 Agent 无 `lifecycle` 字段，**When** 升级后加载并运行，**Then** prompt 组装结果与升级前 **一致**（视为常驻）。  
- [ ] **Given** text 块 `lifecycle: once`，**When** 保存后再打开编辑器，**Then** 「常驻」开关为 **关**。  
- [ ] **Given** text 块常驻（省略或 `always`），**When** 保存后再打开，**Then** 「常驻」开关为 **开**。  
- [ ] **Given** `lifecycle` 为非法值，**When** 加载 Agent，**Then** 失败且有可读错误提示，**不** 静默降级。

### 运行时（Core / 对话）

- [ ] **Given** `user` text 块内容为「继续」、`lifecycle: once`、且位于 `chat` 之前，**When** 用户发送消息且 agent 需多轮 tool，**Then** **仅第一轮** LLM 请求的 history 含该 synthetic 块；**step ≥ 1** 的请求 **不含** 该块。  
- [ ] **Given** 同上配置，**When** agent 完成任务且无进一步 tool，**Then** run 以 **completed** 结束（**不** 仅因该块而跑满 maxSteps）。  
- [ ] **Given** 同一块 `lifecycle: always`，**When** 多轮 tool loop，**Then** **每一轮** LLM 请求均含该块（与现行为一致）。  
- [ ] **Given** `role: system` text 块，**When** 任意 step，**Then** 内容均在 system 中，**不受** lifecycle 开关影响。  
- [ ] **Given** 用户 **再次发送** 新消息（新的 agent run），**When** 块为 `once`，**Then** 新 run 的 **step 0** **再次** 包含该块。

### UI（Desktop + Mobile）

- [ ] **Given** text 块 `role: system`，**When** 打开编辑卡片，**Then** **不显示** 「常驻」开关。  
- [ ] **Given** text 块 `role: user` 或 `assistant`，**When** 打开编辑卡片，**Then** 显示「常驻」开关，**默认开**。  
- [ ] **Given** `type: chat` 块，**When** 打开编辑卡片，**Then** **不显示** lifecycle 相关控件。  
- [ ] **Given** 用户将开关从开改为关并保存，**When** 导出或查看持久化配置，**Then** 对应块含 `lifecycle: once`（或项目约定的等价表示）。

### 预览与 Token

- [ ] **Given** 含 `once` 的 text 块，**When** 在会话中打开真实 Prompt 预览，**Then** 预览内容 **包含** 该块（按首轮口径），作者可确认块位置与文案。  
- [ ] **Given** 同上，**When** 查看 Prompt token 统计，**Then** 计数 **包含** 该块，与首轮 LLM 口径一致。

## 约束与依赖

- 依赖既有 **Prompt 引擎**（block 模型、YAML、`buildPromptLlmInput` 组装路径）与 **Agent 配置化**（AgentDefinition 存取、双端编辑器）。  
- 术语 **lifecycle** 指 prompt 组装时的 **包含策略**，**不** 表示消息是否写入会话 DB（synthetic 块仍不持久化为 chat 消息）。  
- 与 **prompt-llm-input-parity** 迭代口径一致：预览 / token / 实际请求在首轮语义上对齐。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 新建 user 块默认开关 | 本期 **默认开（常驻）** 以兼容旧行为；作者配置 kick 块时需 **手动关**。若后续反馈遗忘率高，可单独立项「新建 user 块默认关」。 |
| 预览多 step 模拟 | 本期预览按 **首轮** 展示；若需「模拟 step 2 不含 once 块」的可视化，列为后续增强。 |

## 里程碑（可选）

1. PRD 确认 → SPEC / 实现（Core + 双端 UI）→ 单测与手工验收 → 合入 main。
