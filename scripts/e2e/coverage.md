# novel-master 桌面端回归覆盖矩阵（2026-09-08 三轮连跑后全量；2026-09-19 增量 v1.5.16→v1.5.20 见 I 节）

依据：CHANGELOG 全量 desktop 条目 + renderer 盘点。状态：✅ 通过 | ❌ 发现问题 | ◻️ 未测 | 🔧 待手动/待补（含原因）
完整缺陷清单：docs/iterations/desktop-regression-fixes-2026-09/prd.md（D-1~D-17 + S-1~S-3）

## A. 文件树 / 工作区
- 三域面板（physical/session/chat）：✅ 面板存在与切换（physical 树内容浏览待补）
- 右键菜单（blank/dir/file）：✅ 三态菜单项全集
- 新建文件/文件夹/重命名/删除：✅ 文件全链（文件夹创建/删除弱证据）
- ZIP 导入/导出：🔧 触发+覆盖确认文案已验；文件级落盘待手动（原生对话框无法自动确认，patch 方案被 electron 内部解构缓存挡住）
- 角色卡导入：🔧 待手动（需造 PNG 卡文件 + 对话框）
- 拖拽三向：🔧 建议手动（本机无 xdotool；树内拖动 startDrag 物化难）
- chat 面板「初始化」：◻️ 菜单项未确认（R5 弱证据，下轮补）
- 目录规则/文件状态：✅（408/409/406/407）

## B. 预览 / 编辑 / 批注
- 预览/编辑切换、保存（Ctrl+S/按钮/脏状态）：✅
- Markdown 预览 + mermaid：✅（svg 真渲染）
- 批注：划词→浮动条→添加→chip→发送：✅（D-15 已排除：脚本双发误报，见 PRD 定性）；下划线投影/详情：✅ 草稿态投影正常；重开不恢复系双端一致设计（2026-09-09 结案）
- 多文件 tab：◻️ 弱（R5 断言空+截图丢失，下轮重拍）
- Frontmatter 批注/跨行/草稿回显：◻️
- 保存失败错误展示：◻️（需构造失败场景）

## C. Composer
- 发送/停止/Ctrl+Enter/空发续跑：✅ 全部（停止后内容保留 ✓）
- 无模型禁用指引：✅
- @ 文件引用（picker+token）：✅（typeahead 候选在空工作区会话无数据，合理）；$ 技能引用（typeahead+picker）：✅
- 批注 chip 出现/发送：✅；移除/切会话清空：◻️
- 长文本折叠语义：✅；点击展开交互：◻️（弱）

## D. 消息操作
- 编辑/复制/置位/分叉/回滚：✅（rewind 确认文案+截断 8→4；undo_send 反投影）
- 隐藏消息样式（压缩/置位）：✅
- 工具卡片：✅ 成功态（含「点击查看·子智能体会话」）+失败态（Invalid input 报错展示）；task 子会话真实创建 ✓（mock tool_calls+子 Agent）；子会话面板跳转：◻️（卡片点击未跳转，低优先）
- 聊天/提示词双页签：✅；生成中速率条：✅（StreamMetricsBar 值出现在状态栏）
- 回滚 rewind/降级/回填三态：◻️（undo_send 外的确认变体未逐个触发）

## E. 会话详情抽屉
- 重命名/上下文占用/提示词/压缩/搜索：✅ 全过（S1-S4 口径验证）
- 技能面板：✅ 渲染+新建弹窗；❌ D-9 困住（P1）；开关切换：◻️
- Agent/模型切换：✅ 模型切换+Agent picker 打开（无第二 Agent 可切换，锁定态 ◻️）

## F. 项目 / 会话 / 子会话
- 新建/重命名（项目+会话）：✅；多会话切换：✅
- 会话批量管理（勾选/批量删 7→5/单行菜单删）：✅
- 项目批量/项目删除：✅ 菜单存在+同款流程（第二轮 232 实证；自动化导航在空态视图易迷路，不重跑）
- 子会话只读面板：🔧 同 D（待 keyring）

## G. 设置页
- 常规页开关组：◻️ 页内操作（低风险）
- Agent 编辑器：✅ 六区渲染+保存+工具策略+作用域/最大步数；🔧 YAML 导入导出待手动（saveDialog；导出弹导入确认是脚本撞名误点，非 bug）
- 服务商/模型管理：✅ 创建链+baseUrl 编辑+拉取全链路（mock /models 全选批量添加）；🔧 模型重命名/批量删除/全选待手动（弹层迷宫）
- 模型采样编辑器：◻️（未触达）
- 正则过滤：🔧 系统将移除（用户拍板），不测
- 技能管理：✅ 新建全流程+DetailView+脏状态行；❌ D-12 未保存侧导航切走零拦截（P1）；🔧 行菜单删除/域切换待手动（612 截图丢失）
- 备份与恢复：✅ 确认文案（完全替换警告+保留本机服务商说明）+云同步 S3 表单展开/填写/测试连接错误态（inline「云端 rev：—」）；🔧 文件级导出导入待手动（对话框）；检查更新：◻️ 待确认（点击后无可见反馈，D-14 候选低置信度）
- 数据统计：✅ 三页签×时间×模型+流水+图表钻取（64 条造数）

## H. 桌面集成
- 三栏拖拽：✅（vision 像素实测 -42px 生效；脚本断言选择器曾误报）
- 栏位显隐：✅；主题明暗：✅
- 应用菜单：🔧 原生 globalMenu（Linux 无 DOM 渲染），待手动
- 自动更新检查：◻️（同 G 待确认项）
- 空状态引导：✅

## I. 2026-09-19 增量回归（v1.5.16 → v1.5.20，四批 11 例）

- **B1 v1.5.20 修复**（case-rollback-restore / case-empty-dir-rename / case-vfs-error-copy / case-agent-reselect）：✅ 4/4——回滚复现被删文件（含正文一字不差）、空目录重命名、目录改名无幽灵残留、VFS 失败中文报错（「名称不能重复」）、删智能体「⚠ 点击重选」徽标可点且重选后无多余 toast
- **B2 v1.5.17**（case-smart-sort-basic / case-sort-rule-manager / case-subdir-sort / case-filename-validation）：✅ 智能排序全序（序章置顶/中文·阿拉伯·混排数值序/番外沉底/无序号自然序沉底/同序号原名决胜/弹窗持久化）、子目录遵循目录规则（名称/创建时间/智能三态实测序各异）、「排序方式」文案更名、规则页内置七条+启停经真实排序验证+恢复默认只重灌内置+内置不可删、`./..` toast 拒绝+纯空白按钮禁用；❌ **D-16** 规则编辑页打开即白屏（P1，SR-EDIT-TEST/SR-CREATE/SR-EDIT-FIXED 三场景被堵，自定义规则暂经 DB 预写绕过）；❌ **D-17** 首尾空格静默 trim（与移动端「拒绝+提示」口径相反）；🔧 YAML 导入导出（原生对话框，按钮存在性已断言）
- **B3 v1.5.16**（case-chat-file-link / case-skill-rename）：✅ 消息文件链接五场景（chat 域中文路径打开/项目域 fallback/不存在 toast 长路径省略号「/一个.../报告.md 不存在」/http 链接窗口不导航+界面完整）、技能重命名编辑信息（改名+描述一次提交、`$$100 && $&x` 逐字保留、内置技能名只读描述可改并还原、撞名拒绝、空白/`.` 开头行内提示+提交禁用）；🔧 技能导出 ZIP 实际落盘（行菜单项已断言）、备份默认名 nmbackup.db / 工作区 ZIP 命名（原生对话框）
- **B4 v1.5.19**（case-run-fail-unlock）：✅ 6/6——上游 500 → 「[生成失败] …」提示落会话、返回重进仍在（落库）、composer 解禁、改写重发得正常回复；空回复 → 「（本次生成无内容输出）」占位 + 同款解锁闭环；mock 已支持 `{httpError}`/`{empty}` 失败注入（lib startMock replyFor 协议扩展）
- 截图证据 out/ 800-916；关键 19 张经 MCP 视觉审查与 DOM 断言一致（857 白屏= D-16 证据、886 省略号 toast、911/915 提示消息、893 $$保留）
- 遗留：case-empty-dir-rename 全量序列负载下 ER-GHOST 时序 flake（单跑过，等待窗口偏紧待加轮询重试）；CLI `sort-rule` 命令组属 CLI 端不在桌面 e2e 范围；run-all 现 17 脚本（B2 轮全量 1194s 验证过 16 脚本序列，B4 为增量单跑验证）

## 序列编排约定
- 全量序列：`rm -rf data/*` 清本地产物库 → 先跑 bootstrap.mjs（重建库+建项目/会话+绑模型）→ 依次跑全部 case
- 单跑：依赖本机已 bootstrap 过的 data/ 库；data/ 已 ignore，novel.db 产物不再提交入库（含 wal/shm 伴生文件）

## 环境备忘（2026-09-08 更新）
- keyring 已解锁（用户 pkill -f gnome-keyring-daemon + --daemonize --login --components=secrets 常驻方案）：SKSP/发消息链路恢复
- 解锁后补跑完成：bootstrap 带 key 版（消息链路活）、case-subagent（task 工具成功）、case-annotate2（发现 D-15）

## 旧备忘（2026-09-07/08 事故）
- 机器重启清空 /tmp：资产已迁 worktree（scripts/e2e/），playwright-core 装在 scripts/e2e/node_modules
- 重启后 login keyring 锁定：SKSP 存取 API Key 失败 → 聊天链路（发消息）不可用；无桌面交互无法解锁/建无密码 collection（D-Bus 挂起）。解锁后需重跑：bootstrap（补 API key 版）+ case-subagent + 批注下划线投影
- lib.mjs 已内置 DISPLAY=:0 兜底（重启后 shell 无 DISPLAY 会 SIGSEGV）
- 按钮文本选择器勿用 ^锚点$ 正则（textContent 带空白）；会话列表按钮是「新建」非「新建会话」（非空态）
