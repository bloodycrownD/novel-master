# Changelog

本文件记录各版本面向用户的更新说明。发版前在对应 `## [x.y.z]` 条目下补充内容；推送 `v*` tag 后 CI 会将该段落写入 GitHub Release 的「更新说明」区块。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 新增

- **会话分叉 / 复制更稳**：fork 与 session 复制共用合同——挂上分叉时刻的当前工作区快照，并复制会话级工作区规则（inclusion / 目录排序）；非首条回滚不再因空基线误删文件
- **Token 占用单引擎**：聊天展示与压缩共用 `resolveCurrentPromptTokens`；有可用 API `promptTokens` 时优先采用，否则回退本地计数；Desktop 页脚在回合结束 / 消息变化 / Agent·模型设置变更后刷新
- **目录级 ZIP**：导入/导出可针对指定子树（非整域）；CLI 增加 `--path`（默认 `/`）；Desktop 目录/空白右键导出，Mobile「更多」导入 ZIP、目录项导出 ZIP
- **Desktop 工作区拖拽三向**：从本机拖入导入、拖出到本机导出、树内拖动移动；冲突覆盖前确认
- **Mobile 单文件导入/导出**：当前目录「文件导入」、文件项「导出」；目录整包仍走 ZIP（平台多文件另存/多选不稳定，批量 IO 留后续迭代）

### 修复

- **Mobile 文件导出扩展名**：另存以原文件名后缀为准（`xxx.md` / `xxx.yyy`）；用 `application/octet-stream`，避免 `text/plain` 被 SAF 改成 `xxx.md.txt`
- **Mobile / Desktop 大备份导入闪退**：约百兆 `.nmbackup` 不再整包读入 JS 再 base64 写回，改为路径级拷贝，避免 OOM
- **Desktop Windows 拖出导出崩溃**：拖出图标禁止空 `nativeImage`，改用应用图标 / PNG 兜底，避免主进程硬崩
- **Desktop 拖出导出体验**：物化/startDrag 失败改为 toast；prefetch 未完成时提示「导出准备中」；拖出结束后清理 staging，避免临时目录泄漏
- **Desktop 空白区树内移动**：空白处可接收树内 MIME 拖放并移动到根目录
- **Mobile 文件导入**：读文件失败不再假报「导入完成」；失败摘要使用真实错误文案
- **批量写入类型冲突**：同路径 file/dir 冲突在规划阶段检出，避免错误写入
- **Desktop Token 页脚**：在设置中切换模型/Agent 后占用数字同步刷新

### 维护

- Core / Desktop / Mobile 补齐分叉、Token 缓存、ZIP 子树、批量 IO 等相关自动化测试；CR fix-spec 与业务文档对齐 Mobile 单文件收窄

### 新增

- **Mobile 文件编辑器**：会话内 FileEditor 改为 WebView + CodeMirror；编辑聚焦双态更稳（语法高亮、大文件编辑体验贴近 Desktop）
- **提示词宏编辑（Desktop / Mobile）**：动态区宏着色、原子删除；Desktop `PromptMacroTextarea` 叠层宏 Tag，编辑观感与 Mobile 对齐

### 变更

- **「工作树」→「工作区」收口**：产品文案、CLI 子命令、IPC 与库表统一为 `workplace`；旧库自动 rename migration；示例与旧宏提示去掉「工作树」措辞
- **Agent 升级提示**：旧版配置中的 `type:worktree` 提示块升级后不再自动开启「常驻工作区」；若仍需该能力，请在 Agent 设置中手动打开「常驻工作区」开关
- **常驻工作区开关**：Agent 编辑器「常驻工作区」与 `input.workplace` 全量接线（双端顶卡共用）

### 修复

- **关闭常驻工作区**：不再 materialize 差集、也不再露出对应状态 chip，避免「开关已关仍像在用常驻区」
- **未配置 Agent 时仍可改工作区规则**：状态条投影在无 Agent 时按「常驻关闭」处理，不再把规则保存打成失败
- **Desktop Composer**：正文在 append 成功后再清空，避免发送失败却已清空输入
- **Desktop 批注**：切会话后仍按 `sessionId` 清空批注草稿，避免串会话残留
- **CLI**：session workplace 展示与 Agent 常驻前缀同源 assemble，避免 CLI 与 App 口径不一致
- 若干 workplace 校验文案、chip 回滚判定、Mobile 构建等小项

### 维护

- Composer / 批注 / `@路径` / chip 判定等纯逻辑单点进 core，Desktop renderer 经 `@shared` 再导出并加 eslint 门禁；Mobile CT `ui` 禁新组件直读 `state`；用户无感

## [1.4.02] - 2026-07-20

### 修复

- **Android 聊天页 Error loading page / net::ERR_FILE_NOT_FOUND**：发版 CI 在 `assembleRelease` 前补跑 `build:webview:native`，将 WebView 壳打入 APK；Gradle `preBuild` 缺 `assets/webview/**` 时硬失败，避免再打出坏包

## [1.4.01] - 2026-07-20

### 新增

- **阅读态批注（Desktop / Mobile）**：在聊天会话工作区打开文件预览时，可选中文字添加批注；原文下划线标记；点击可查看 / 编辑 / 删除；Composer 状态条显示 `批注:路径`；发送成功后清空本轮批注；仅有批注也可发送
- **常驻工作区 + 消息附件模型**：常驻上下文改为会话级持久（重启不丢）；本轮增量（规则变更、手改、`@` 引用等）走消息附件，与常驻前缀分离
- **Composer 大输入区**：双端统一大输入框与工具栏；状态 chip（规则 / 手改 / 批注等）中文二字口径；正文内 `@路径` 引用与选择器（含多选、目录树）
- **空正文也可发送**：仅有状态增量或附件时即可发送；列表展示附件摘要卡
- **Mobile 对话沉浸**：进入对话后隐藏底部「对话 / 我的」Tab；回到会话列表后恢复

### 改进

- **提示词协议统一**：消息增量统一为 `user-ops` 风格的结构化 action（模型侧更清晰）；状态 chip 与气泡文案对齐中文 `动作:路径`
- **去掉工作树 capture / 历史 UA 折卡**：不再依赖进程内快照与独立 UA 工具卡片；手改与附件并入正常对话流
- **Mobile WebView 基建**：对话 transcript / 富文档预览改为独立打包与更稳的渲染壳（流式、菜单、富文本）
- **助手伪标签可见**：富文本开启时，未知 / 伪 XML 标签不再静默挖空正文（双端观感更一致）
- **文件引用选择器**：支持层级浏览、多选文件/目录、显示隐藏文件；目录附件以树形摘要呈现

### 修复

- 批注相关：同文多条可点选改删、Desktop 预览保留系统复制菜单、门闩校验会话等
- 发送 / 续跑边界：空续跑、workplace 差集与附件合并等边界行为更可预期
- Mac Dock 图标边距等小项

### 维护

- 大量内部重构与测试加固（WebView Preact、发送链路收束、废弃别名清理等）；用户无感或已含于上文

## [1.3.14] - 2026-07-14

### 修复

- **对话停止后保留已生成内容**：停止 Agent 对话时，已输出的文本/thinking 会保留在会话中，不再整条撤回
- **未完成工具显示「失败」**：停止后尚未完成的工具调用标记为失败；已完成的工具仍显示成功
- **停止后冻结 UI**：停止后迟到的 STEP / tool_results 不再刷新界面，避免工具卡片状态被覆盖

### 改进

- Desktop / Mobile 停止流程的异步收尾更稳健，避免 retain 窗口内 lifecycle 卡死
- **内置文件工具说明更清晰**：`read` / `write` / `edit` / `fs` / `glob` / `grep` 的参数与用法描述更完整，便于 Agent 正确选用
- **`grep` 搜索能力增强**：支持字面量/正则模式、路径 glob 过滤、大小写不敏感、上下文行、每文件单条命中等选项
- **移除 `chat_grep` 内置工具**：Agent 配置与内置工具列表统一为上述 6 个文件工具；旧配置中若仍填写 `chat_grep` 将视为未知工具

## [1.3.13] - 2026-07-12

### 维护

- 版本号对齐与常规维护
