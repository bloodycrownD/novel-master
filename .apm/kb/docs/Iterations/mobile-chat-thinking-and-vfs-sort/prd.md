# Mobile 聊天 Thinking 展示与 VFS 目录排序 PRD

## 背景

上一轮 Mobile 体验优化合并后，出现两个回归类问题：

1. **Thinking 块**：助手流式回复结束后，原先应单独展示的 reasoning（`thinking` 内容）不再以 Thinking 卡片呈现，而是与正文一样显示为普通消息气泡。
2. **VFS 目录规则排序**：在目录规则面板中修改「排序字段」「升序/降序」并保存后，文件管理器内当前目录的文件夹/文件列表顺序与行上规则相关展示均无可见变化。

二者均影响 Android 端日常对话与文件管理能力，需作为 bugfix 修复。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 恢复 thinking 与正文的区分展示 | 流式结束后，含 thinking 的 assistant 消息在会话列表中仍显示 **ThinkingBlockCard**（可折叠），正文仍在独立气泡中展示 |
| 目录排序配置可感知 | 保存目录规则后，**同一目录**下列表顺序随 `sortField` / `sortOrder` 变化；行上规则状态/摘要与配置一致 |
| 与桌面端语义一致 | 当前目录子项排序行为与 `@novel-master/core` worktree 逻辑一致：子文件夹在前、子文件在后，组内分别按父目录规则排序 |

## 用户与场景

- **用户**：在 Android 上使用 Novel Master Mobile 的创作者/重度用户。
- **场景 A**：使用支持 extended thinking 的模型对话，流式结束后回看推理过程与最终回复。
- **场景 B**：在会话/项目 VFS 文件管理器中配置某目录的排序规则，通过列表顺序快速找到目标文件或核对规则是否生效。

## 范围

### 包含范围

- Android Mobile 聊天会话：**流式结束后** assistant 消息的 thinking 展示修复。
- Android Mobile VFS 文件管理器：当前浏览目录的直接子项（文件夹 + 文件）列表排序与规则相关 UI 反馈。
- 排序语义对齐 core：`sortDirPaths` / `sortFilesForDir`（文件夹组在前、文件组在后，组内按目录规则字段与方向排序）。
- 目录规则 Sheet 保存后触发的列表刷新与展示更新。

### 不包含范围

- iOS 专项验收与修复（本迭代以 Android 验收为准；若实现可共享 RN 代码可顺带修，不单独列验收）。
- 流式过程中 thinking 的交互改版（除非为修复「结束后丢失」所必需的最小改动）。
- 修改模型/API 的 thinking 输出格式或持久化 schema。
- 非当前目录的递归整树重排、worktree 发给模型的上下文拼装逻辑重构（仅要求文件管理器当前层展示与 core 一致）。
- 目录规则其它字段（head/tail/fill）的行为变更（本 PRD 仅覆盖排序相关可见性问题）。

## 核心需求

1. **Thinking 持久展示**：assistant 消息在流式结束并写入会话后，若内容块中含 `thinking` 类型块，UI 必须使用 **ThinkingBlockCard** 展示，不得并入普通正文气泡。
2. **流式收尾一致性**：从 `streamingThinking` 过渡到落库消息的展示逻辑须与历史消息一致，避免「流式时有/结束后无」或「结束后变正文」。
3. **当前目录列表排序**：文件管理器展示某目录直接子项时，不得固定按路径字典序；须读取该目录的 `WorktreeDirRule`（含继承/默认），按 core 规则排序文件夹组与文件组。
4. **保存后即时反馈**：在目录规则 Sheet 修改排序字段或升序/降序并保存成功后，返回文件管理器无需额外手动操作即可看到列表顺序变化（允许一次 `reload`，但不允许「配置已存但列表永远不变」）。
5. **行展示与规则一致**：列表行 subtitle/角标（如规则开闭、文件 inclusion/display 等已有字段）须与保存后的 worktree 元数据一致；排序相关配置变更后，用户能辨认「规则已生效」（含顺序变化带来的可感知差异）。
6. **与桌面/core 对齐**：同一 scope、同一目录、同一套规则下，Mobile 当前层子项顺序与 CLI/desktop worktree 树在该层的相对顺序一致（文件夹在前、文件在后，组内排序字段/方向一致）。

## 验收标准

### Thinking 块（Android）

- **Given** 已选模型会在回复中产生 thinking 内容，且会话中有一条刚结束流式的 assistant 消息  
  **When** 流式状态结束，消息已出现在消息列表中  
  **Then** thinking 内容显示在 **ThinkingBlockCard**（如「思考」/可折叠区域），与正文气泡分离；正文仍在 assistant 气泡中显示。

- **Given** 上述消息已落库  
  **When** 离开会话再进入，或切换 Tab 后返回  
  **Then** ThinkingBlockCard 仍可见，thinking 未变成普通 Text 气泡正文。

- **Given** assistant 消息仅含 thinking、无正文 text  
  **When** 流式结束  
  **Then** 仅显示 ThinkingBlockCard，不出现空白占位气泡。

### VFS 目录排序（Android）

- **Given** 某目录已启用目录规则，当前路径为该目录，且存在多个子文件夹与子文件  
  **When** 在目录规则 Sheet 将排序字段改为「更新时间」、方向改为「降序」并保存  
  **Then** 文件管理器列表顺序在保存后发生变化；文件夹仍全部位于文件之前；组内顺序符合 core 对该字段与方向的排序结果。

- **Given** 同上目录，仅将「升序」改为「降序」（字段不变）  
  **When** 保存成功  
  **Then** 列表顺序与升序时明显不同（在有多项可比较的前提下）；OptionRow 上当前选中项与保存值一致。

- **Given** 排序字段在「文件名称 / 创建时间 / 更新时间」间切换  
  **When** 每次保存后返回列表  
  **Then** 顺序随字段变化；行上规则相关展示（如目录「开启」、文件 inclusion/display 文案）与 worktree 元数据一致，无「已保存但 UI 完全不变」现象。

- **Given** 与桌面端或 CLI 对同一 scope、同一目录配置了相同 `sortField` 与 `sortOrder`  
  **When** 分别查看该目录直接子项顺序  
  **Then** Mobile 与 desktop/CLI 的文件夹相对顺序一致、文件相对顺序一致（允许显示文案差异，不允许顺序语义相反或固定字典序无视规则）。

### 回归

- **Given** 不含 thinking 的普通 assistant/user 消息  
  **When** 浏览会话  
  **Then** 展示与优化前一致，无多余 Thinking 卡片。

- **Given** 未启用目录规则或规则关闭的目录  
  **When** 浏览文件管理器  
  **Then** 使用默认排序语义（与 core 默认规则一致），不崩溃、不空白列表。
