---
date: 2026-08-11
dependency: mobile-desktop-optimization-2026-08/prd.md
---

# Feature D：bug 修复 PRD

> **类型**：Bugfix  
> **平台**：Mobile + Core（Bug 1、2）；Mobile + Desktop + Core（Bug 3）  
> **关联迭代**：`mobile-desktop-optimization-2026-08`

## 背景

本次 mobile 深度使用测试发现了三个影响体验的 bug，覆盖工具卡片跳转、文件编辑匹配、批注消息回滚三个层面。这三个 bug 看似互不相关，但都落在 core 层的纯函数或判定逻辑上，desktop 端经代码审查同样存在（Bug 3 在 desktop 有完全相同的判定函数副本）。

探索阶段已经把三个 bug 的根因链路、代码证据、改动面全部摸清，结论汇总如下：

- **Bug 1（mobile 子会话 write/edit 卡片无法跳转）**：静态代码看整条链路是通的——core 白名单、WebView 内镜像、卡片渲染、点击分发、宿主回调、子会话页导航参数都齐备。怀疑是运行时问题（tool_use input 字段名不标准、或现网打包 bundle 滞后），需要在真机上抓日志定位。
- **Bug 2（edit 工具对中文引号匹配失败）**：匹配层是纯 `indexOf`/`includes`，零归一化。read 链路字节级保真已验证，用户也确认没启用正则通道，所以 bug 极大概率在模型端 tokenizer——LLM 生成 `oldString` 时把弯引号 `""`（U+201C/201D）重建成了日式引号 `「」`（U+300C/300D）。治本方向是在匹配层加引号归一化模糊匹配。
- **Bug 3（批注消息回滚失败 + 绕过连续 user 阻塞守卫）**：`extractEditableTextFromMessage` 和 `isPlainUserText` 两个判定函数都只看 `content.blocks` 的 text 块，trim 后为空就返回 null/false。批注存在 `attachments` 里（不在 `content.blocks`），所以"只有批注、没文字"的消息被判定为无效——既无法走 `undo_send` 回滚（回退到 rewind 又找不到 assistant 锚点），也不触发"禁止带文字发送"的连续 user 守卫。这是同一个根因。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 子会话 write/edit 卡片可跳转 | Mobile 子会话内点击 `write`/`edit` 工具卡片，能正确跳转到文件预览/编辑页（与主会话 `read` 卡片行为一致） |
| edit 中文引号可匹配 | 模型生成的 `oldString` 含弯引号/日式引号、而文件实际是另一种引号形态时，edit 仍能命中并替换；归一化只用于定位，落盘内容保持原文引号不被改写 |
| 批注消息可回滚 | "只有批注、无正文文字"的 user 消息，长按回滚能走 `undo_send`（恢复 Composer 批注附件）而非失败 |
| 连续 user 守卫生效 | 末条是"只有批注"的 user 消息时，Composer 禁止带文字发送（与末条是纯文本 user 消息行为一致） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 子会话用户 | 在子智能体会话里查看 `write`/`edit` 工具调用结果，点击卡片想跳到文件预览，却发现没反应 |
| 编辑中文内容的用户 | 用 edit 工具修改含 `""''` 或 `「」『』` 的小说稿，模型重建 oldString 时引号变形，edit 直接报 not found |
| 批注用户 | 在文件里划词加批注后直接发送（不带正文），事后想撤销这条消息却发现回滚失败；或紧接着再发一条带文字消息，本应被守卫拦住却没拦 |

## 范围

### 包含范围

1. **Bug 1 — Mobile 子会话 write/edit 卡片跳转**（Mobile）
   - 真机抓日志定位运行时断点（tool_use input 字段名、bundle 滞后）
   - 视定位结果做防御性加固（字段名兼容、bundle 版本校验）
2. **Bug 2 — edit 中文引号归一化匹配**（Mobile + Desktop + Core）
   - 在 `compute-replace-result.ts` 匹配前加引号归一化层
   - 覆盖弯引号↔直引号、`「」『』`↔`""''`、全角/半角空白等字符族
   - 补 `compute-replace-result.test.ts`（当前这个核心纯函数没有单测）
3. **Bug 3 — 批注消息回滚 + 连续 user 守卫**（Mobile + Desktop + Core）
   - 修 `isPlainUserText`：补充“或消息有批注附件”也返回 true
   - 修 `isPlainUserUndoSendEligible`：补充“或消息有批注附件”
   - 修 mobile `useChatTabMessages.ts` 的 `applyComposerRestore` 提前 return 条件（desktop 已解耦无需改，补测试即可）
   - 补测试覆盖“只有批注附件”的用例（`editable-text-from-message.test.ts` 已存在，追加用例）

### 不包含范围

- **Bug 1 的 desktop 对照**：desktop 缺 mobile 的 `pendingSubagentSessions` 机制（执行中的 task 卡片本就跳不了），属于已知能力缺口，不在本 feature 修复范围
- **edit 正则通道**：用户确认没启用正则通道，本次只在默认匹配层加归一化，不改正则通道
- **批注附件的 UI 渲染改版**：Bug 3 只修判定逻辑，不改批注附件的渲染、序列化、提示词拼接
- **回滚后的 Composer 批注恢复细节**：`undo_send` 成功后 Composer 怎么把批注附件塞回去，依赖现有 `restoreAttachments` 机制。Desktop 侧正文/批注已解耦，本 feature 只补测试不改 desktop restore 实现；**Mobile 侧需改 `applyComposerRestore` 的提前 return 条件**（拿掉 `restoreText == null`），这是 P0-1 的明确改动点，不算“不改 restore 实现”。

## 核心需求

### Bug 1：子会话 write/edit 卡片跳转

1. **定位优先**：因为静态代码链路是通的，先在真机上抓 tool_use 的实际 input 字段，确认 `path` 字段是否存在、是否为字符串、值是否合法。
2. **字段名兼容**：如果定位发现 LLM 用了 `file_path` 等非标准字段名，在 `vfsToolFilePath`（core）和 `resolveVfsToolFilePath`（WebView 镜像）里加字段名兜底（`input.path ?? input.file_path`）。
3. **bundle 滞后排查**：如果字段名没问题，核查现网打包的 WebView bundle 是否滞后于源码（镜像常量、路径解析函数是否是最新的）。
4. **不破坏主会话**：修复不得影响主会话 `read` 卡片的现有跳转行为。

### Bug 2：edit 中文引号归一化

1. **匹配层归一化**：在 `compute-replace-result.ts` 里，对 `currentContent` 和 `oldString` 都跑归一化，用归一化版本 `indexOf` 找位置，然后用原始 `oldString.length` 在原文里做切片替换——**落盘内容保持原文引号不被改写**。单次路径和 replaceAll 路径都遵守同一条硬约束：归一化只参与 `indexOf` 定位，切片和拼接全部走原文 `currentContent`。replaceAll 路径**不能用 `split/join`**（那会让未替换段落到归一化后的内容、引号被改写），而是在归一化坐标系循环 `indexOf` 收集命中 positions，再在原文上逐段切片拼接。
2. **字符族覆盖**（v1 只做 1:1 映射，归一化前后长度严格相等，index 直接通用）：
   - 直引号 `"` `'` ↔ 弯引号 `“` `”` `‘` `’`（U+2018/19/1C/1D）——最常见
   - 日式引号 `「` `」` `『` `』`（U+300C-F）
   - 全角空格（U+3000）vs 半角空格——**不做**全角字母数字归一化（误伤风险高）
   - 省略号归一化（`……` vs `...`，N:1 映射）**推迟到后续迭代**——v1 不做，避免引入位置映射数组的复杂度
3. **代理对安全**：归一化和切片要按码点处理，不能按 UTF-16 码元 `length`/`slice`（参考 `dumpCodepoints` 用 `Array.from` 处理码点的做法）。
4. **补单测**：`compute-replace-result.test.ts` 当前不存在，本次要新建，覆盖弯引号、日式引号、全角空白、代理对、replaceAll 场景。`editable-text-from-message.test.ts` 已存在，本次在其基础上追加 T-B3 系列用例。

### Bug 3：批注消息回滚 + 连续 user 守卫

1. **`isPlainUserText` 加批注判定**：在"末条是否为 plain user 文本"的判定里，补充"或消息 `attachments` 里有 `action: "annotate"` 的批注附件"也返回 true——这样 Composer 的连续 user 守卫就能拦住"批注后带文字发送"。
2. **`isPlainUserUndoSendEligible` 加批注判定**：同理，补充"或消息有批注附件"——这样回滚就走 `undo_send` 分支（恢复批注附件）而非 rewind（找 assistant 锚点）。
3. **批注附件判定方式**：看 `message.attachments` 数组里是否存在 `action === "annotate"` 的项（`source` 必然是 `user_ops`，无需额外判断 `source`）。
4. **`restoreText: null` 容忍**：`extractEditableTextFromMessage` 对“只有批注”的消息仍返回 null（正文确实空）。Desktop 侧已解耦（`resolveComposerDraftAfterRollbackSuccess` 处理正文、`applyUndoAnnotateRestore` 独立反投影批注，互不依赖），`restoreText: null` 只导致正文不恢复，不影响批注附件恢复，大概率无需改只需补测试。**Mobile 侧需改**——`useChatTabMessages.ts` 的 `applyComposerRestore` 里提前 return 条件含 `restoreText == null`，会拦住后续的批注反投影，这是 mobile 侧真实的 bug 点，要把 `restoreText == null` 从提前 return 条件里拿掉，同时给写正文的步骤加 `restoreText != null` 守卫避免写空正文。
5. **双端同步**：`isPlainUserText` 和 `isPlainUserUndoSendEligible` 都在 core 层，mobile/desktop 共用，改一处双端受益；但 Composer 的 `lastMessageIsPlainUserText` 接线在双端各自的 `composer-send-state.ts`，要确认接线没漏。

## 验收标准

### Bug 1：子会话 write/edit 卡片跳转（Mobile）

- **Given** 子智能体会话中有 `write` 或 `edit` 工具调用且已带 `path`  
  **When** 用户点击该工具卡片  
  **Then** 跳转到文件预览/编辑页，导航参数 `{path, scopeKind:'session', projectId, sessionId}` 与主会话一致。

- **Given** 子会话中 `read` 工具卡片（回归基线）  
  **When** 用户点击  
  **Then** 跳转行为与修复前一致（不回归）。

- **Given** 真机抓到的 tool_use input 字段名为 `file_path`（非标准）  
  **When** 字段名兜底生效后  
  **Then** 该卡片也能正确跳转。

### Bug 2：edit 中文引号归一化（Mobile + Desktop + Core）

- **Given** 文件内容含弯引号 `"你好"`，模型生成的 `oldString` 用了日式引号 `「你好」`  
  **When** 执行 edit  
  **Then** 匹配命中，替换成功；落盘内容里未被替换部分的引号保持原文形态（归一化只用于定位）。

- **Given** 文件内容含全角空格（U+3000），`oldString` 用了半角空格  
  **When** 执行 edit  
  **Then** 匹配命中。

- **Given** 文件内容含弯引号，`oldString` 也用了弯引号（两侧一致）  
  **When** 执行 edit  
  **Then** 匹配命中（归一化不能破坏原本就能命中的场景）。

- **Given** `oldString` 确实不存在于文件中（归一化后也不存在）  
  **When** 执行 edit  
  **Then** 抛 `REPLACE_NOT_FOUND`，诊断信息（LCS）正常返回。

- **Given** `replaceAll: true` 且文件里有多处引号变形的命中  
  **When** 执行 edit  
  **Then** 全部命中并被替换。

- **Given** 文件含 emoji 或其他代理对字符（如 `👨‍👩‍👧`）  
  **When** edit 的命中位置跨越或邻近代理对  
  **Then** 切片不截断代理对，落盘内容完整。

### Bug 3：批注消息回滚 + 连续 user 守卫（Mobile + Desktop + Core）

- **Given** 末条 user 消息只有批注附件（`attachments` 含 `action:"annotate"`）、`content.blocks` 无非空 text  
  **When** 用户长按该消息选择回滚  
  **Then** 走 `undo_send` 分支，回滚成功，Composer 恢复批注附件。

- **Given** 末条 user 消息只有批注附件  
  **When** 用户在 Composer 输入文字并尝试发送  
  **Then** 被守卫拦住（与末条是纯文本 user 消息时行为一致）。

- **Given** 末条 user 消息既有正文文字又有批注附件  
  **When** 用户长按回滚  
  **Then** 走 `undo_send` 分支，回滚成功，Composer 同时恢复正文和批注附件（不回归）。

- **Given** 末条是 assistant 消息（回归基线）  
  **When** 用户尝试在 Composer 发送  
  **Then** 不被守卫拦（`isPlainUserText` 对 assistant 返回 false 的行为不变）。

## 约束与依赖

- **Bug 2 归一化只用于定位**：归一化版本只用来找命中位置，实际切片替换必须用原文 + 原始 `oldString.length`，否则会把文件里没动过的引号也改掉——这是产品底线。
- **Bug 3 双端共用 core**：`isPlainUserText` / `isPlainUserUndoSendEligible` 在 core 层唯一定义，mobile/desktop 都 import，改 core 一处双端受益；但 Composer 接线在双端各自实现，需分别确认。
- **Bug 1 运行时依赖**：静态代码已通，修复方向取决于真机定位结果，SPEC 里的字段名兜底是预防性改动，实际改不改要看日志。

## 风险与待确认项

- **Bug 1 真机定位不确定性**：静态链路通了不代表运行时没问题，可能是 bundle 滞后（需重新打包）、字段名（需兜底）、或别的隐性断点——SPEC 里按优先级列了排查路径，但最终改什么要等日志。
- **Bug 2 归一化的字符族边界**：全角↔半角的归一化范围（字母数字要不要归一？标点呢？）需要在 SPEC 里明确，避免归一化过度把不该匹配的也匹配上。当前决策是：v1 只做引号族 + 全角空格→半角空格（均为 1:1 映射），**不**做全角字母数字归一化（误伤风险高），**不做**省略号归一化（N:1 映射会引入位置映射数组的复杂度，推迟到后续迭代）。
- **Bug 3 `restoreText: null` 容忍性**：Desktop 侧已解耦（正文恢复与批注反投影是两条独立路径），`restoreText: null` 不影响批注恢复，补回归测试确认即可。**Mobile 侧是真实 bug 点**——`useChatTabMessages.ts` 的 `applyComposerRestore` 提前 return 条件含 `restoreText == null`，会拦住批注反投影，SPEC 里明确了改法（拿掉该条件 + 写正文加守卫）。
