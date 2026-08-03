---
date: 2026-07-11
dependency:
  - Iterations/project-agent-config/prd.md
  - Iterations/vfs-user-ops-unified-tool-turn/prd.md
---

# Agent 工作树块 UI 与双消息注入 PRD

## 背景

智能体配置（全局 Agent / 项目专属 Agent）的「提示词模版」当前为四区纵向布局：**系统区 → 持久区 → 会话区 → 动态区**。

**工作树（worktree）** 在业务上表示：向模型注入当前会话的**项目文件树快照**（`worktreeDisplay`），让模型了解可访问的文件与展示状态。配置层 today 将工作树建模为持久区 `persist[]` 内的一种块（`type: worktree`，wire 名 `canon`），通过持久区「添加」菜单与文本块混排，UI 为嵌套子卡片（含角色下拉、排序、删除）。

这与用户对 worktree 的心智模型不一致：

- 用户期望工作树在语义上对应 **user 工作树内容 + assistant `【done】`** 两条固定消息对（与 VFS 工具回合桥接语义对齐），而非单条可配 role 的合成消息。
- 用户期望工作树在 UI 上为 **system 下方的独立开关顶卡**（样式对齐系统区），而非藏在持久区块列表里；持久区、动态区的「添加」仅用于**文本块**，添加体验统一。

现状与缺口（代码探索摘要）：

| 维度 | 现状 | 缺口 |
|------|------|------|
| UI 位置 | worktree 在 persist 块列表内 | 应在 system 卡下方独立展示 |
| UI 样式 | 嵌套子卡 + role 下拉 + ↑↓× | 应对齐 system 顶卡 + Switch |
| 添加入口 | persist「添加」菜单含「工作树」 | persist/dynamic「添加」仅文本块 |
| 运行时 | 1 worktree 块 → 1 条合成消息（role 可选） | 应固定 2 条：user 树 + assistant done |
| 开关语义 | 无独立开关；依赖 `persistEnabled` 才注入 | 顶卡 Switch 控制 persist 内 worktree 块有无；注入与 persist 总开关解耦 |
| 默认值 | 示例 Agent（如 writer）常带 `canon` worktree | **一律默认关**（新建、内置模板均无 worktree 块） |

本 PRD 仅定义产品与验收；技术方案、组装实现见后续 SPEC。

**迁移原则（用户确认）**：worktree **仍作为 persist 内的普通块**（`type: worktree`，wire 键 `canon`），**不新增**顶层 wire 字段。版本更新后旧 Agent YAML/JSON **无需迁移**即可加载；worktree 块相对文本块无非 runtime 正文字段（等价于「普通块内容为空串」）。UI 顶卡 Switch 仅映射「persist 内是否存在 worktree 块」。

## 目标（含成功指标）

1. **心智对齐**：配置页能一眼看出「工作树 = 运行时注入 user 文件树 + assistant done」，无需理解 persist 内部块类型。
2. **UI 统一**：system 下独立工作树开关卡；持久区、动态区「添加」行为一致（仅新增文本块）。
3. **行为正确**：开启工作树后，每轮 agent step 固定注入 **2 条**合成消息（user=worktreeDisplay，assistant=`【done】` 或产品等价文案）；关闭则不注入。
4. **双端一致**：Desktop 设置页与 Mobile Agent 编辑器交互与文案对齐。
5. **可度量**：
   - 全局/项目 Agent 编辑器中，工作树配置路径 ≤ 2 步（开 Switch 即完成，无 role/排序操作）。
   - 开启 worktree 的 Agent，prompt 预览或 LLM 输入中可见连续 user+assistant 两条（树 + done），且顺序稳定。
   - 持久区「添加」菜单不再出现「工作树/移除工作树」项（0 处残留）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 小说作者 / 重度用户 | 编辑 Writer 等 Agent，希望像开关 system 一样开关工作树，不必在持久区块列表里找 canon |
| 项目维护者 | 为某项目配置专属 Agent，需要与全局 Agent 相同的工作树 UX |
| 调试 / 预览 | 在 Prompt 预览中确认文件树与 done 成对出现，便于理解模型上下文 |

## 范围

### 包含范围

- **UI 重组（Desktop + Mobile）**
  - 在 **系统区 system 卡正下方** 新增 **工作树顶卡**，视觉与交互对齐 **system 开关块**（badge + Switch + 展开说明区）。
  - 移除 worktree 在持久区块列表中的嵌套子卡呈现；移除 role 下拉、块内排序/删除（工作树通过顶卡 Switch 增删）。
  - 持久区、动态区「添加」**仅保留「文本块」**（或等价单一入口）；不再提供「工作树」菜单项。
- **配置语义（wire 不变）**
  - **不新增** `worktreeEnabled` 等顶层字段；真相源为 `persist[]` 内是否存在 `type: worktree` 块（wire 名 `canon`）。
  - 顶卡 Switch **开** → 确保 persist 含 worktree 块；**关** → 移除该块。**一律默认关**：新建 Agent、表单初始值、`examples/agents.yaml` 等内置种子均**不含** worktree 块；**无**针对旧模板 / bundled 配置的单独兼容分支。
  - worktree 块在 wire 上仍视为 persist 普通块的一种：**无 `content` 字段**（相对文本块等价内容为空）；**不**因 UI 提到 system 下而改变存储位置。
  - 关闭 Switch 时是否从 wire 删除 worktree 块 vs 仅 UI 关断：与 persist 文本块策略一致（SPEC 细化；默认关 Switch 即移除块，开则写入块）。
  - **注入与 `persistEnabled` 解耦**：persist 内**存在** worktree 块即注入双消息，**不要求** `persistEnabled === true`；persist 文本块仍仅在 `persistEnabled` 时注入。
- **运行时行为**
  - persist 内**存在** worktree 块时，在 system 之后、chat 之前（组装顺序 SPEC 细化）注入：
    1. **user**：`worktreeDisplay`（当前会话文件树快照）
    2. **assistant**：`【done】`（与现有 `tool_turn_bridge` 文案一致，或 SPEC 统一常量）
  - 不再支持通过 worktree 块的 `role` 切换合并为一条消息；加载旧 wire 时忽略历史 `role` 字段。
- **校验与兼容（非迁移）**
  - **无需 wire 形态迁移**：用户已保存的 Agent 若 wire 含 `persist.canon`，加载后顶卡 Switch 随块存在性为开（与任意 persist 块相同，**非**额外兼容逻辑）。
  - **内置模板同步**：`examples/agents.yaml`（及仓库内等价默认 Agent 种子）移除默认 `canon` worktree 块，与「默认关」一致。
  - 持久区列表 UI **不展示** worktree 块，但 wire 仍保留在 `persist[]`。
  - 调整与 worktree 相关的布局校验——worktree 不参与 persist 末块 role 校验（SPEC）。
- **文案**：更新 `WORKTREE_BLOCK_HINT` 等编辑器说明，反映双消息与独立开关。

### 不包含范围

- 工作树**快照刷新策略**（markDirty、手动刷新、VFS 写盘不一致）——沿用 `message-worktree-refresh-tighten` 等既有口径。
- `{{$filetree}}` 动态宏、工作区列表 UI、worktree 规则编辑。
- 修改 `tool_turn_bridge` 在 chat 区的落库逻辑（仅对齐注入文案常量）。
- 压缩、云同步冲突、CLI `agents.yaml` 批量编辑工具（可后续跟进）。
- Desktop `AgentEditorView` / `AgentDefinitionEditorForm` 代码合并重构（除非 SPEC 判定为阻塞项）。

## 核心需求

1. **独立工作树开关卡**：system 下方展示工作树顶卡；Switch 映射 persist 内 worktree 块有无；**默认关**（含新建与内置种子）；样式对齐 system 区。

2. **固定 user + assistant 双消息**：运行时不再使用单条可配 role 的 worktree 合成消息；固定为 user（文件树）+ assistant（done）。

3. **与持久区解耦（注入层）**：persist 内存在 worktree 块即注入双消息，**不要求** `persistEnabled` 为 true；persist 文本块注入仍受 `persistEnabled` 控制。

4. **统一「添加块」**：持久区、动态区添加操作仅增加文本块；工作树不再出现在任何「添加」菜单中。

5. **双端 parity**：Mobile `AgentEditorForm` 与 Desktop `AgentDefinitionEditorForm`（及全局 Agent 编辑入口）行为、文案、**默认关**一致。

6. **向后兼容（无 wire 迁移）**：wire 仍为 persist 内 worktree 块；用户若已保存含 `canon` 的配置，打开编辑器 Switch 随块存在性显示，保存行为与普通块一致。**内置模板**与本迭代后新建 Agent 统一为默认无块。

7. **预览可验证**：Prompt 预览 / token 统计在存在 worktree 块时能看到 user 树 + assistant done 两条，顺序与运行时一致；**与 `persistEnabled` 无关**（`persistEnabled=false` 时预览与 LLM 均仍注入双消息）。

## 验收标准

### A. 编辑器 UI

- **A1** Given 打开任意 Agent 编辑器（全局或项目专属），When 展开「提示词模版」，Then system 卡下方可见「工作树」顶卡（badge + Switch），且**不在**持久区块列表中出现工作树子卡。
- **A2** Given 工作树 Switch 关闭，When 用户操作，Then 无 role 下拉、无 worktree 块排序/删除按钮。
- **A3** Given 持久区或动态区已开启，When 点击「添加」，Then **直接**新增一块文本块；**无**二级菜单（Desktop 已移除 ContextMenu / Mobile 已移除 BottomSheet），**无**「工作树」「移除工作树」项。
- **A4** Given 工作树 Switch 从关→开，When 保存 Agent，Then wire 的 `persist` 中含 `type: worktree` 块（`canon`），再次打开 Switch 为开。
- **A5** Given 工作树 Switch 从开→关，When 保存并重新打开，Then Switch 为关、`persist` 中无 worktree 块，且运行时不再注入工作树对（见 B 类）。
- **A6** Given **新建** Agent 或空白表单默认值，When 打开编辑器，Then 工作树 Switch **默认关闭**，且 `persist` 中无 worktree 块。
- **A7** Given 仓库内置 `examples/agents.yaml`（如 writer），When 新环境导入或阅读默认配置，Then **无** `persist.canon` worktree 块（与 A6 默认关一致）。

### B. 运行时与预览

- **B1** Given `persist` 中含 worktree 块且会话有文件树快照，When 执行 agent run 或 Prompt 预览（step 0），Then LLM 输入在 system（若有）之后、chat 历史之前，出现**连续两条**合成消息：user 文件树 + assistant `【done】`。
- **B2** Given `persist` 中**无** worktree 块，When agent run，Then **不**出现上述 worktree/done 合成对（与 persist 总开关无关）。
- **B3** Given `persistEnabled=false` 且 `persist` 中**仍有** worktree 块，When agent run **或 Prompt 预览**，Then 仍注入/展示 B1 双消息（验证注入与预览均与 persist 总开关解耦）；且**不**注入 persist 文本块。
- **B4** Given 用户**自行保存**的 wire 含 `persist.canon`（历史数据），When 加载编辑器，Then Switch 为开且按 B1 注入；Given 仅使用本迭代后的内置模板/新建 Agent，Then 无块、Switch 关（**无**模板级特殊分支）。

### C. 双端与回归

- **C1** Desktop 与 Mobile 工作树 Switch **默认关**、文案、开关联动一致。
- **C2** 开启持久区且仅含文本块时，既有校验（如至少一块、末块 assistant 等，若仍适用）不因本迭代而无故失败；worktree 不再参与 persist 末块 role 校验。
- **C3** 项目专属 Agent（`project-agent-config`）复用同一编辑器组件，满足 A/B 类。

### D. 非目标回归

- **D1** 工作区列表、`{{$filetree}}` 宏、手动「刷新工作树」行为与改前一致（本迭代不改刷新策略）。

## 约束与依赖

- 依赖 **project-agent-config**：项目专属 Agent 须复用同一 Prompt 编辑器能力。
- 依赖 **vfs-user-ops-unified-tool-turn**：worktree 块曾在此定义 persist 内规则；本迭代 supersede 其 **UI 与单消息 role** 部分，刷新与快照策略仍遵循 **message-worktree-refresh-tighten**。
- `【done】` 文案与 `packages/core` 现有 `tool_turn_bridge` 常量保持一致，避免同屏两种 done 文案。
- Desktop / Mobile 须同步交付，避免双端 Agent 配置 wire 形态分裂。

## 非功能需求（业务/体验）

- 工作树顶卡说明文案简洁，说明「开启后每轮注入文件树与 done 确认」，避免暴露 wire 名 `canon`。
- Switch 关断时仅移除 worktree 块，**不**误删 persist 内其他文本块。
- 用户已保存的含 `canon` 配置按 wire 正常读写；**不**为 bundled 模板单独保留默认 worktree。

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| persist 列表 UI 隐藏 worktree 但 wire 仍在 `persist[]`，与排序/校验逻辑分叉 | SPEC 统一：`splitPersistBlocksForEditor` + 组装层分别处理 text / worktree |
| 双消息注入与「persist 末块 assistant」校验冲突 | 校验与末块判断**排除** worktree 块 |
| `persistEnabled=false` 仍有 worktree 块时的组装顺序 | SPEC 明确：worktree 双消息插入点独立于 persist 文本遍历；**预览与 LLM 同步** |
| 历史「仅 worktree + persist 开」配置无法保存 | SPEC 兼容性表 UX 指引：加文本块 / 关 persist / 关工作树 |
| Desktop 双份表单漏改 | 验收 C 覆盖两入口 |

**已确认（澄清记录）**：

- 双消息：运行时固定 user 树 + assistant done，去掉 role 下拉。
- 开关：顶卡映射 persist 内 worktree 块有无；**注入**与 `persistEnabled` 解耦。
- **迁移**：worktree 仍为 persist 普通块，**无新 wire 字段**；旧配置直接可用。
- **默认**：新建与内置模板**统一默认关**；`examples/agents.yaml` 移除默认 `canon`；无旧模板特殊兼容。
- 样式：对齐 system 开关顶卡。
- 范围：Desktop + Mobile 同期。

## 里程碑（可选）

| 阶段 | 交付 |
|------|------|
| M1 | Core：双消息组装 + 校验调整 + 注入解耦；`examples/agents.yaml` 移除默认 canon |
| M2 | Desktop Agent 编辑器 UI |
| M3 | Mobile Agent 编辑器 UI + 双端验收 |
