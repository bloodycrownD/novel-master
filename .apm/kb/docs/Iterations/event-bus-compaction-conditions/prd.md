# 事件总线与压缩条件 PRD

> **范围**：Core 事件总线、宏缓存与刷新、**统一深度切片**、全局「事件配置」与「压缩条件」、压缩语义重构、正则深度迁移、Mobile/CLI 消费方式。  
> **边界**：不含技术方案、接口、表结构、任务拆分（见后续 SPEC）。  
> **关联**：[global-compaction-policy](../global-compaction-policy/prd.md)（现行全局 compaction 策略，本需求将替代其语义与配置形态）。

## 背景

- 当前 **Agent 流式 UI** 通过回调与 `runAgentTurn` 紧耦合；**宏** 每次组 prompt 实时 render worktree/filetree，无缓存。
- 当前 **压缩** 使用 `keepLastN` + abstract；与「仅 hide + worktree」方向不一致。
- 当前 **正则规则** 使用 `minDepth` / `maxDepth`（基于从会话**开头**计数的 1-based floor），与「从最新消息往回数」的直觉不一致，且与压缩侧深度概念不统一。
- 用户希望：
  1. 事件总线 + 压缩条件 / 事件配置解耦；
  2. 压缩动作改为 **`hide-message` action**（动作 + 实体，与 `refresh-macros` 命名一致），用 **深度切片**指定要 hide 的消息范围；
  3. **正则规则深度与 `hide-message` 共用深度切片**（**不考虑**旧 `minDepth`/`maxDepth` 兼容，仅新字段）；
  4. 其余：宏缓存、`refresh-macros`、默认 events、CLI emit、Mobile 手动压缩等（见下文）。

## 目标（含成功指标）

| 目标 | 说明 | 成功指标 |
|------|------|----------|
| 深度切片统一 | `hide-message` 与 regex 共用 `start-depth` / `end-depth` 语义 | Core 单测覆盖边界与缺省 |
| 事件总线 + emit | 同前 | 同前 |
| 宏缓存 / refresh-macros | 同前 | 同前 |
| 压缩语义 | `hide-message` 切片；无 summary / abstract | 同前 |
| 默认 events | compaction parallel：`hide-message` + `refresh-macros` | show 与默认 YAML 一致 |
| 配置校验 | 含 depth 切片合法性 | 非法切片保存失败 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 产品 / 终端用户 | 压缩时 hide 旧深度区间；正则只作用于「最近 N 条」等 |
| 开发者 | 用 `start-depth` / `end-depth` 表达与 slice 一致的范围 |
| 写作用户 | Mobile 手动压缩（默认 hide 深度 6～∞） |

## 范围

### 包含范围

1. **统一深度切片（Depth slice）**

   适用于：**`hide-message` action**、**正则规则深度范围**（替代现行 `minDepth` / `maxDepth`）。

   - **深度定义**：在**当前可见消息**（`hidden=false`）上，按时间顺序 **从旧到新** 排列后，**从最新一条往回** 编号：`depth 0` = 倒数第 1 条，`depth 1` = 倒数第 2 条，以此类推（0-based，自尾部计数）。
   - **区间字段**（均可选，但至少提供一个边界，否则校验失败）：
     - `start-depth`：区间**下界**（含），朝向更旧消息方向数值增大。
     - `end-depth`：区间**上界**（含），朝向更新消息方向数值更小。
   - **缺省边界 = 无穷**（与 slice 一致）：
     - 仅 `start-depth: 6` → 深度 **6 ≤ d < ∞**（隐藏倒数第 7 条及更旧所有可见消息）→ **保留最近 6 条**可见（等价于原 `keepLastN: 6`）。
     - 仅 `end-depth: 99` → 深度 **0 ≤ d ≤ 99**（隐藏最近 100 条中的全部，即倒数第 1～100 条）。
     - `start-depth: 0` + `end-depth: 99` → 深度 **0～99**（倒数第 1～100 条）。
     - 仅 `start-depth: 0` → 深度 **0～∞**（所有可见消息均 hide）。
   - **校验**：若两者均存在，须满足 `start-depth ≤ end-depth`；深度为非负整数。
   - **实现注意**（SPEC）：对「∞」侧在消息条数不足时，hide 到最旧可见消息即可。

2. **Core 事件总线** — 同前（含 CLI `emit`）。

3. **内置事件名**

   | 事件名 | 用途 | 出厂默认 events |
   |--------|------|-----------------|
   | `agent.run.started` / `finished` / `failed` | Run 生命周期 | 不配置 |
   | `agent.stream.text-delta` / `thinking-delta` | 流式 UI | 不进用户 YAML |
   | `session.message.received` | **本回合 agent run 成功结束**，且 **已持久化至少一条 assistant 消息** 后发出：含正文回合，也含 **仅 tool_use** 的回合（worktree 可能已变更）。**不**在 run 失败、或未写入 assistant 消息时发出 | 不配置 |
   | `session.compaction.requested` | 压缩条件满足或手动压缩；`trigger: manual \| condition` | 见默认 events |

   **已定稿**：手动与自动压缩共用 `session.compaction.requested`（`trigger` 区分）。

4. **宏系统** — 同前；出厂默认不在 `message.received` 上刷新。

5. **压缩条件（独立）**

   - 可 `enabled`；触发字段均可选，**启用时至少一项**：
     - `tokenThreshold`：`-1` = 当前 model max context token（推荐默认 `-1`）。
     - `tokenRatio`：相对有效 token 阈值的比例（如 `0.8`）。
     - **`visible-floor`**：可见消息 **条数** 阈值（**hidden 不计入**；原名 `floorThreshold`）。**已定稿**：当 **可见条数 > visible-floor** 时满足该条件（与现 `FloorThresholdTrigger` 一致），与 token 条件 **OR** 组合。
   - 深度切片 **仅用于** `hide-message` / regex，**不**用于压缩条件判定。
   - 满足时仅 emit `session.compaction.requested`（`trigger: condition`），不含 action 参数。

6. **事件配置与 action**

   - **Action 列表写法**：
     - 无参：`- refresh-macros`（可简写）。
     - 有参：`- <actionName>:` + 嵌套字段，例如：
       ```yaml
       - hide-message:
           start-depth: 6
       ```
       或完整区间：
       ```yaml
       - hide-message:
           start-depth: 0
           end-depth: 99
       ```
   - **内置 action（首期）**（命名：**动词-实体**）：
     - **`hide-message`**：按深度切片对**可见消息**执行 hide（`MessageService` / `hideRange` 等由 SPEC 映射）；**替代原 `keepLastN`**，不再使用 `keepLastN` 作为 action 名。
     - **`refresh-macros`**：无参，可简写。
     - **`run-agent`**：可选，参数 `agent-id`（Agent 注册表 id）；产出消息不写入会话，工具调用可用；非默认。
   - **parallel 执行（已定稿）**：各 action 独立；失败 **不回滚** 已成功项；向调用方报告 **部分失败**。

7. **全局默认 events**

   ```yaml
   events:
     session.compaction.requested:
       parallel:
         - hide-message:
             start-depth: 6
         - refresh-macros
   ```

   - 语义：压缩时并行 **隐藏深度 6～∞** + **刷新宏**；保留最近 **6** 条可见消息。
   - 不含 `session.message.received`；不含 `run-agent`。

8. **压缩语义变更** — 移除 abstract / 摘要 message；压缩产物仅 worktree（工具），同前。

9. **正则配置深度（本期纳入，无旧版兼容）**

   - 规则 **仅** 使用 **`start-depth` / `end-depth`**（与 `hide-message` 同一套自尾 0-based 深度切片）。
   - **不考虑** `minDepth` / `maxDepth` 的读取、迁移或双写；升级后用户 **重写正则规则**（开发环境可清库/重导）。
   - CLI / Mobile / schema **仅暴露** 新字段。
   - 应用 regex 时：按可见消息的 depth 判断是否命中区间。

10. **配置保存期校验** — 含 depth 切片、未知 action、events 冲突等。

11. **CLI / Mobile** — 同前（含 `emit`、菜单「压缩」）。

### 不包含范围

- 同前（插件沙箱、Agent 内嵌 events、Web 等）。
- 旧版 **compaction policy**（`keepLastN` + abstract）及 regex **`minDepth`/`maxDepth`** 的兼容与自动迁移（一律按新配置重写）。

## 核心需求

1. **深度切片** 为跨领域能力：`hide-message` action + regex 深度范围。
2. **事件总线** + **CLI emit** + `session.message.received` / `session.compaction.requested`。
3. **出厂默认** compaction：`hide-message`（`start-depth: 6`）与 `refresh-macros` 并行。
4. **宏缓存**；可选 `message.received` → `refresh-macros`（非默认）。
5. **压缩不写 message**；移除 abstract/摘要。
6. **正则深度** 仅 `start-depth` / `end-depth`；压缩条件保留 **`visible-floor`**（可见条数阈值）。
7. **Mobile 手动压缩**；无参 action 简写；**保存期校验**。

## 验收标准

### 深度切片与 hide-message

- **Given** 可见消息 10 条，**When** 执行 `hide-message` 且仅 `start-depth: 6`，**Then** 深度 6～9 的消息 hidden，深度 0～5 仍可见（共 6 条）。
- **Given** 同上，**When** `start-depth: 0`、`end-depth: 99`，**Then** 深度 0～9 均 hidden（不足 100 条时 hide 全部可见）。
- **Given** 仅 `end-depth: 2`，**When** 执行 `hide-message`，**Then** 深度 0～2 hidden（最近 3 条），更旧深度不受影响。
- **Given** 仅 `start-depth: 0`，**When** 执行 `hide-message`，**Then** 全部可见消息 hidden。

### 默认 events

- **Given** 新用户默认配置，**When** 自动或手动压缩，**Then** 并行执行 `hide-message`（`start-depth: 6`）与 `refresh-macros`；保留 6 条可见消息。

### 正则深度统一

- **Given** 规则 `start-depth: 0`、`end-depth: 2`，**When** 对可见消息应用 regex，**Then** 仅深度 0～2（最近 3 条）命中；更旧消息文本不变。
- **Given** 规则 YAML 仍写 `minDepth`/`maxDepth`，**When** 保存，**Then** 失败（不支持旧字段）。

### session.message.received

- **Given** agent run 结束且 assistant 消息含正文已落库，**When** 回合完成，**Then** emit `session.message.received`。
- **Given** agent run 结束且 assistant 消息 **仅含 tool_use**（无 text/thinking 正文）、工具已执行并落库，**When** 回合完成，**Then** **仍** emit `session.message.received`（以便用户配置 `refresh-macros` 等感知 worktree 变更）。
- **Given** 出厂默认 events，**When** 仅 user 发消息、agent 未结束，**Then** 不 emit。
- **Given** agent run **失败**（异常/中断），**When** 回合结束，**Then** **不** emit `session.message.received`。
- **Given** run 结束但 **未** 持久化任何 assistant 消息，**When** 评估 emit，**Then** **不** emit。

### 压缩条件 visible-floor

- **Given** `visible-floor: 20` 且可见消息 **21** 条，**When** 评估压缩条件，**Then** 满足 visible-floor 条件（`21 > 20`），可与 token 条件 OR 后触发 compaction。
- **Given** 可见消息 **20** 条、`visible-floor: 20`，**When** 评估，**Then** 仅 visible-floor **不**满足（`20 > 20` 为假）。

### parallel actions

- **Given** 默认 compaction parallel，`hide-message` 成功且 `refresh-macros` 失败，**When** 链结束，**Then** hide 结果保留；调用方得知 refresh 失败（不回滚 hide）。

### 事件 / 宏 / Mobile / emit

- `message.received` 默认 **不** 绑定 `refresh-macros`；`emit` 压缩链；`refresh-macros` 简写等同前。

### Action 配置形态

- **Given** YAML `- hide-message:\n    start-depth: 6`，**When** 保存并执行，**Then** 通过且行为符合切片语义。
- **Given** `- hide-message:` 无任何 depth 字段，**When** 保存，**Then** 失败。

## 约束与依赖

- 依赖 `MessageService.hide` / `hideRange`、自尾 depth 计算（regex 与 `hide-message` 共用）。
- **`visible-floor`**：可见消息 **条数** 阈值，与自尾 **depth 切片** 独立；hidden 消息不参与计数。

## 非功能需求（业务/体验）

- 同前。

## 已定稿（原待确认项）

| 项 | 决策 |
|----|------|
| `session.message.received` | run **失败** 或 **无 assistant 消息落库** → **不** emit |
| `visible-floor` | **可见条数 > visible-floor**（与现网一致） |
| parallel 失败 | 独立执行、**不回滚** 已成功 action；报告部分失败 |

## 风险与待确认项（SPEC 阶段）

| 项 | 说明 |
|----|------|
| token 条件去重 | 同一 step 多次触发 compaction 的冷却策略 |

## 里程碑（可选）

| 阶段 | 交付 |
|------|------|
| M1 | 深度切片模型 + 单测；事件总线 + CLI emit |
| M2 | 宏缓存 + `refresh-macros` + `message.received` |
| M3 | `hide-message` action + 默认 compaction；压缩条件 |
| M4 | regex 新深度字段；移除 abstract；Mobile「压缩」；`visible-floor`；校验 |
