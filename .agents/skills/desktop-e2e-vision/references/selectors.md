# 桌面端 e2e 选择器速查 + 已知坑

## 选择器速查（按功能域）

### 应用框架
- 设置入口：`button[aria-label="打开设置"]`；关闭：`button[aria-label="关闭设置"]`
- 设置导航：`[data-settings-nav="providers|agentsSettings|regexGroups|skillsManage|dataManagement|tokenUsageStats|about|workspace"]`
- 主题：`button[aria-label="切换主题"]`
- 三栏 splitter：`[data-splitter]`
- 返回（ChatRail 面包屑）：`button[aria-label="返回"]:visible`
- 视图判定：`.chat-nav-view[data-nav-view="projects|sessions|conversation|subagent-conversation"]`（用 `!v.hidden` 过滤可见）

### 聊天
- composer：`textarea[aria-label="消息输入"]`（无模型时整体禁用、placeholder「请先配置模型（设置 → Provider）」）
- 发送/停止：`button[aria-label="发送"]`（running 时 aria-label 变「停止」，可轮询该属性等 run 收敛）
- 发送快捷键：composer.press("Control+Enter")
- 会话操作抽屉入口：`[data-action="open-session-actions"]`（composer 工具栏 ⋯；在 realPrompt 页签下不可见，先切回「聊天」tab）
- 抽屉内：`[data-session-detail-action="close|rename|rename-input|open-skills|switch-agent|switch-model|view-prompt|compact|search-history"]`；上下文占用 `[aria-label="上下文占用"]`
- 搜索面板：`input[placeholder="关键词|从 #|到 #"]`；查询按钮文本「查询」；返回 `[aria-label="返回会话详情"]`
- 消息：`.chat-message`（带 `data-message-id`）；菜单 `button[aria-label="消息操作"]` → `[data-message-action]`；隐藏态 `.chat-message--hidden` + tag `.chat-message__hidden-tag`
- 模型 picker：`.picker-modal__panel li`（**首项是「清除会话覆盖」勿误点**）

### 工作区 / 文件树
- 树节点：`.tree-node`（filter hasText 文件名）；树空白右键 → `[data-workspace-action="create-file|create-folder|import-zip|import-character-card|export-zip|rule-config|file-inclusion|rename|delete"]`
- 右键菜单必须 `mouse.click(x, y, {button:"right"})` 带坐标（click({button}) 无坐标会点 (0,0)）
- 预览：文件 tab（`role=tab`）；模式切换 `[aria-label="预览模式"] button`（预览/编辑）；CodeMirror `.cm-content`；保存 Ctrl+S 或「保存」按钮
- 批注：浮动条 `button.preview-annotate-floating__btn`（文本「添加批注」）；弹窗 textarea `placeholder="输入批注说明"`、确认 `.text-prompt-modal__btn--primary`
- 新建/重命名弹窗（TextPromptModal）：`input:visible` + 「确定」；删除确认 `.confirm-modal button`（危险按钮在 modal 容器内匹配）

### 设置页
- 服务商列表项：`button.settings-list-item`（不是 li！）
- Provider 表单：Base URL/名称 input **无 type 属性**（`input[type="text"]` 匹配不到）——用 `.settings-field:has-text("Base URL") input`；AgentEditor 的名称 input 显式 `type="text"`（两处风格不一致，选择器要兼容）
- toast：`.shell-toast.is-visible`（默认 3.2s 消失，抓取要快）；ConfirmModal：`.confirm-modal`

## 已知坑（踩过 ≥2 次的）

1. **evaluate 里不能用 `:visible` 伪类**——浏览器不认，用 `offsetParent` 过滤（`[...document.querySelectorAll(x)].filter(e => e.offsetParent)`）
2. **playwright filter({hasText}) 是子串匹配**：会撞 DOM 更早的同名元素（「批注」→文件页签「批注测试.md」、「新建」→隐藏视图里的同名按钮）。限定容器（`.settings-view button`、`.chat-rail` 内）+ 足够特异的文本
3. **弹层要逐层关**：抽屉 backdrop `.session-detail-drawer__backdrop` 与 picker `.picker-modal__backdrop` 是不同 class；Escape 不一定关抽屉，优先点 `[data-session-detail-action="close"]`（×）
4. **末条消息是 user 时 composer 禁用**（置位/发送失败后常态）——「仅有批注也可发送」时直接点发送按钮（force），别等 fill
5. **抽屉子面板状态跨开关残留**（D-9 bug）：技能/搜索面板开着时关开抽屉仍停留；用例里每次重新判定当前在哪个子面板（如查 `[placeholder="关键词"]` 是否存在）
6. **点击零效果且无 console 错误** → elementFromPoint 诊断（确认坐标命中的元素）+ `page.evaluate(el.click())` 兜底
7. **vite 孤儿进程**：只杀 spawn 的父进程组不够，结束必须 pkill `-f "desk-e2e-test/node_modules/.bin/vite"`；上轮 vite 占着 5173 会让新脚本连到旧进程（症状：怎么改代码现象不变）
8. **冷启动恢复视图不确定**：启动后可能直接在 conversation（上次活跃会话）；用例开头用 goToProjects() 逐层归位再走流程
9. **会话名会被中途改名**：按名字找会话不可靠，按内容特征找（如消息数 ≥100、含特定文本）
10. **React 版本/ABI 报错**：见 SKILL.md 环境节——react/react-dom 嵌套副本配平、rebuild-native、清 vite 缓存

## 原生对话框（dialog.showOpenDialog/showSaveDialog）

Playwright **拦不到** Electron 主进程原生对话框（page.on("dialog") 只接 JS alert）。选项：xdotool 操作 X11 窗口（DISPLAY=:0），或标记「需手动测试」。正则系统将移除（2026-09-07 拍板），正则相关用例一律跳过。
