---
date: 2026-09-06
dependency: Iterations/export-link-skill-mgmt-2026-09/prd.md
---

# 聊天 markdown 文件链接跳转工作区文件 PRD

## 背景

聊天正文 markdown 链接的点击现状（探索证据：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:1228-1240`、`apps/desktop/renderer/components/MermaidMarkdown.tsx`、`apps/desktop/src/main/main.ts`）：

- mobile：webview 内 `<a>` 无 preventDefault，RN 侧 `shouldStartLoadWithRequest` 对 http(s) 显式 `Linking.openURL` 外跳系统浏览器；`/` 开头的路径链接点击静默无效；相对路径链接解析进 webview 包内导致错误页。
- desktop：react-markdown 共享组件未覆盖 `a`，主进程无 `will-navigate`/`setWindowOpenHandler` 拦截——点外链**整个窗口导航离开应用**（比 mobile 更糟）。

agent 常在正文里以 markdown 链接引用工作区文件，用户点击的意图是看文件本身。两端已有完整的「点击→打开工作区文件」管道（mobile：工具文件卡片 `open-tool-file` → `openSessionFilePreview` → FileEditor；desktop：ToolCallCard → `openChatWorkspacePreview` → 预览面板），缺的只是链接这一入口形态。

## 目标（含成功指标）

文件地址形态的聊天链接点击后直达聊天工作区对应文件预览；外部链接行为不劣化（desktop 顺带修复整窗导航缺陷）。成功指标：正文里指向工作区文件的链接 100% 在应用内打开。

## 用户与场景

双端用户阅读 agent 产出正文时点击文件引用链接，期望像点工具文件卡片一样看文件；点普通网页链接时期望去浏览器。

## 范围

### 包含范围

1. 聊天正文 markdown 链接点击路由（Typora 式标准行为，用户已拍板）：链接目标为无 scheme 的路径形态——**相对路径、绝对路径、带锚点三种写法均可点**——且文件存在（先查聊天工作区，再查项目工作区）时，打开该文件预览（mobile FileEditor / desktop 预览面板），跳转口径与现有工具文件卡片一致。
2. 路径形态链接但文件不存在时点击无动作（不再出现 webview 错误页）；http(s)/mailto 等非路径链接维持现状：http(s) 外跳系统浏览器，不报错、不崩溃。
3. desktop 外链安全兜底：http(s) 链接改为系统外部打开，主窗口不再整窗导航离开。
4. 双端一致。

### 不包含范围

- 文件预览/编辑器内部能力改造（含锚点滚动定位：v1 仅按 path 部分打开文件，`#标题` 不解析定位，后续如需再立项）。
- wiki 风格 `[[...]]` 链接（双端管线本就不产链接，维持纯文本；如需支持需预处理层，本轮不做）。
- 提示词/内置技能层引导 agent 产出链接写法（本轮不做，能力上线后观察使用情况再设）。
- 流式渲染期不做专门处理：mobile 拦截挂在 `#rows` 事件委托层，流式尾巴与已提交消息同一拦截面（天然覆盖，行为正确）；desktop 流式分支与正文共用同一 markdown 组件，随正文一并接线保持行为一致。

## 核心需求（3-7 条）

1. mobile webview 链接点击拦截上抛（preventDefault + bridge 传 href），识别与路由在 RN 宿主侧完成。
2. RN 侧路由：路径归一化 → session 工作区探测 → project 工作区探测 → 命中打开 FileEditor（scope 按命中层传递）→ 未命中无动作。
3. desktop 共享 markdown 组件支持链接点击回调注入（聊天侧接工作区预览，文件预览侧不改变现状）。
4. desktop 主进程补外链拦截（`will-navigate`/`setWindowOpenHandler` + 外部打开）。
5. 识别规则（Typora 式标准行为）：markdown 语法链接的路径目标——相对、绝对、锚点三形态，href 先 decodeURIComponent 再归一化；锚点取 path 部分定位文件，`#` 后内容 v1 不解析。

## 验收标准

- Given 聊天正文存在指向聊天工作区已有文件的路径链接（相对/绝对/锚点任一写法） When 点击 Then 打开该文件预览（与点击工具文件卡片同一目标页）。
- Given 路径链接指向的文件仅存在于项目工作区 When 点击 Then 以 project scope 打开预览。
- Given 路径链接指向的文件两处都不存在 When 点击 Then 无动作（不出错误页）、不报错。
- Given http(s) 链接 When mobile 点击 Then 系统浏览器打开（现状不变）。
- Given http(s) 链接 When desktop 点击 Then 系统外部打开且主窗口停留在应用内。
- Given wiki 风格 `[[...]]` 与反引号裸路径 When 渲染 Then 维持纯文本（与现状一致）。

## 风险与待确认项

- **真实样本已取得（2026-09-06 真机实测 + 本地同款管线验证）**：诱导 agent 产出六种写法，用同款 markdown-it（html/linkify）+ sanitize 白名单本地验证——相对路径、绝对路径、带锚点、不存在文件四种渲染为可点 `<a>`（**中文 href 被 URL 编码，宿主侧须先 decodeURIComponent**）；反引号裸路径为 `<code>` 不可点；wiki 风格 `[[...]]` 双端管线均不产链接（纯文本）。
- **现状点击行为（代码实证，改造后全部改为应用内路由）**：mobile 相对路径链接落在包目录前缀内被导航守卫放行 → WebView 导到不存在 asset 出错误页；绝对路径链接被拒 → 点击无反应；desktop 双形态均无拦截 → 主窗口整窗导航。
- 已拍板（2026-09-06）：支持形态 = markdown 语法链接全三形态（Typora 式，用户确认 B 方案）；wiki 风格与裸路径维持纯文本；锚点 v1 不滚动定位；提示词层引导本轮不做。
- 跨 scope 探测顺序（先 session 后 project）为默认口径，spec 阶段可复核。
