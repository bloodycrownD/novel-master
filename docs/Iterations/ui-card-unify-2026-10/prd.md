---
date: 2026-10-03
dependency: [Iterations/ui-prompt-fixes-2026-10/prd.md]
---

# 工具卡片统一化与 UI 修正（ui-card-unify-2026-10）PRD

## 背景

上一迭代 ui-prompt-fixes-2026-10（v1.5.32 合并）落地了提示词查看页重做（嵌套卡片流 + 四级明度交替）、附件超大降级（100k 明文当量字符预算，三链统一）、工具入参 JSON 结构化预览（formatToolUsePreviewJson）。真机使用后用户提出新一轮六项优化，经 brain-storm 四路探索 + 两轮拍板定稿：

现状关键事实（探索实锤）：
- 附件预算是全仓单点常量（`ATTACH_PROMPT_CHAR_BUDGET = 100_000`，packages/core/src/domain/chat/logic/attach-budget.ts:30），实发/token 估算/提示词预览三链同走 core prepare，改一处全生效。
- 「聊天记录查询」（1.4.16 引入、1.5.1 两次增强）是会话详情页的「查找聊天记录」——单会话内关键词+编号区间检索；整条链路（core searchMessages / desktop IPC / 双端组件）无任何第二消费者，纯减法可删。
- 提示词页正文用了 `textSecondary`（mobile #8E8E93 对白底仅 3.3:1，观感禁用灰）。
- msg 聊天列表工具卡片是**三份平行实现**：desktop React（ToolCallCard，生效）/ mobile WebView Preact（ToolGroup，生效）/ mobile RN（ToolCallCard+ToolCallGroupCard，legacy-rn 退役后的死代码）；无公共基类；跳转门控在 webview 侧还有两份 core 镜像。11 个内置工具中 8 个完全不可点；结果正文从不展示；core 已按 11 工具算好的成功态摘要（summarizeToolSuccess：read 行数、edit 替换数、curl 状态码体积等）被 UI 整段丢弃（仅失败态读 summary）。
- edit 的 tool_use input 完整携带 oldString/newString（camelCase），做行级 diff 数据足够；diff 库仅 core 有依赖、双端 UI 侧没有（webview 加依赖会撞 allowlist 与 ES2018 基线门禁），需零依赖实现。

## 目标（含成功指标）

1. 六项全部落地，其中工具卡片统一化（R6）形成「core 唯一规格层 + 双端薄壳」结构，消灭三份平行实现与两份镜像。
2. 成功指标：
   - 11 个工具卡片在 desktop 与 mobile（WebView）上展示口径、交互行为一致；
   - 成功态摘要对用户可见（不再只在失败态展示摘要）；
   - edit 卡片展开可见红删绿增的行级 diff；
   - 聊天记录查询功能删除后全仓零残留（生产代码与测试）；
   - 附件预算放宽到 50 万明文当量字符后三链行为一致。

## 用户与场景

作者本人（双端：desktop Electron + mobile Android 真机/模拟器）。长会话小说写作场景中大量回看 agent 工具调用：确认 read/write/edit 改了什么、grep 找到了什么、子任务跑到哪了。窄屏手机上翻查工具结果是高频动作，卡片信息密度与展开形态直接影响可用性。

## 范围

### 包含范围

1. R1 附件预算放宽：100k → 500k 明文当量字符。
2. R2 移除聊天记录查询：双端 UI 入口、组件、导航注册、desktop IPC 链、core port/service/仓储方法、专属测试全删。
3. R3 提示词页正文颜色：textSecondary → 正文色（6 处）+ 护栏断言。
4. R4 嵌套卡片明度翻转 + workplace 文件列表美化。
5. R5 提示词页工具组卡非卡片化收窄（照聊天侧配方）。
6. R6 msg 列表工具卡片统一化（收起摘要 / 展开入参+结果 / edit diff / 架构收敛）。

### 不包含范围

- CLI `nm prompt render` 的预算约束（现状本就不受预算覆盖，保持）。
- workplace 常驻前缀的 8MB / 2MB 两道闸门（OOM 防护，性质不同，不动）。
- edit 带行号的完整 git 档 diff（用户拍板不做行号，留二期）。
- 提示词查看页与聊天页的 DTO / 组件合并（提示词页卡片保持独立 DTO，仅交互模式互相参考）。
- 聊天记录查询的三份历史迭代文档（chat-history-search / -seq-range / -collapsible-form，历史留痕保留）。
- 跨会话 / 全局消息搜索（本就不存在，非本轮引入）。

## 核心需求（6 条）

### R1 附件预算放宽至 50 万明文当量字符

把附件降级阈值从 10 万（≈300KB CJK）放宽到 50 万（≈1500KB）。预算口径不变：明文当量字符（String.length，行号前缀不计；image/binary/dir 不参与计量；超限项不占预算；恰好等于预算不降级）。skill 引用（$技能名）同预算同降级。常量、相关注释、测试标题中的「100k」字样同步更新；实发 / token 估算 / 提示词预览三链经同一常量自动一致。

### R2 移除聊天记录查询

删除「会话详情页 → 查找聊天记录」整条功能链：desktop 的 SessionDetailDrawer 入口按钮与 ChatHistorySearchPanel 面板、IPC channel 与 handler/invoke 注册、CSS 专属规则；mobile 的 SessionDetailScreen 入口卡、ChatHistorySearchScreen、导航注册（types/RootNavigator/header-config）；core 的 searchMessages（port/service/仓储）、message-content-match.ts 纯函数模块、public/chat.ts 类型导出。删除顺序必须 UI 先、core 后（避免 TS 悬空）。三个藏在其它测试文件里的耦合断言定点摘除（desktop chat-link-route T-L6、mobile session-detail-screen T-MO1、core message-plaintext-write 的 searchMessages 段）与 renderer typecheck baseline 两条失效豁免一并清理。

### R3 提示词页正文颜色修正

Assistant/user 的 content 普通正文从灰色禁用观感的 textSecondary 改为正常正文色（浅色=黑，深色=跟随主题正文色），覆盖 mobile 叶子卡正文、mobile workplace 预览正文、desktop 叶子卡预览、desktop 组卡格 body、desktop workplace 预览共 6 处。pill 徽标类（非正文）保持次级色。全屏详情页本就是正文色，不动。补颜色断言护栏（当前零覆盖）。

### R4 嵌套卡片明度翻转 + workplace 文件列表美化

明度层次从「灰页→白轮卡→灰子卡→白格子」翻转为「**灰页→白轮卡→白组卡→灰格子**」：组卡（二级）整张改白，格子（三级/最内层）改用**当前灰子卡的同款 token**（mobile bgSecondary #E5E5EA、desktop --surface-muted #f3f6fb，不新造颜色）。workplace 卡同步翻转（列表壳→白、预览卡作为最内层→灰），保持整页一套交替规律。在此基础上 workplace 文件列表做一轮美化——按「文件系统列表」常见形态提升观感（具体设计 demo 拍板后落 spec）。同步更新写死「灰→白→灰→白」口径的设计注释与双端背景色断言。
（spec 裁决注：R4「组卡白」与 R5「壳清零」在同一属性上互斥，spec A3 合一裁决为「二级壳透明透白（视觉等效白）+最内层灰」，层级规律不变、观感目标一致。）

### R5 提示词页工具组卡非卡片化收窄

照 msg 聊天列表工具组的现成配方改造提示词页组卡：清零壳（无背景、无边框、无 padding），收起态只留一行标题（工具名 + 状态），展开时才出格子间距与格子。组卡「左 3px primary 粗条」随非卡片化退役（相关断言与形态注释一并改）。收起态高度显著收窄，向聊天侧一行形态看齐（两端目标值 spec 阶段定）。

### R6 msg 列表工具卡片统一化

核心交互形态（用户拍板：未必需要点，主要是优化展开效果）：

- **收起态 = 一行**：工具名 + 状态 + 摘要。成功态接入 core 已算好的 `tool_result.summary`（read「R/T 行」、edit「N 处替换」、glob「N 路径」、curl「状态码 · 体积」等；现状仅失败态读摘要）。
- **展开态 = 入参 + 结果两段**：入参用 formatToolUsePreviewJson（大 key 截断保结构）渲染；结果展示 tool_result.content 可读文本。
- **点击跳转仅保留有真实去处者**：read/write/edit → 文件、task → 子会话（结果落库后）、skill → 技能详情；grep/glob/search/curl/agent/fs 不做跳转，主打展开。
- **edit 展开内嵌行级 diff**：零依赖行级 LCS（公共前后缀 + 行级比对），无行号（窄屏不占位），oldString 红删、newString 绿增。
- **架构收敛**：core 新增工具卡片视图规格层（每工具的标题/副标题/状态/主动作/可选 diff 数据的唯一实现），desktop 与 WebView 各写薄壳消费；删 webview 侧两份 core 镜像（vfs-tool-path / skill-tool-ref）与 mobile RN 僵尸卡；summarizeToolSuccess 提为可导出函数供 UI 复用（spec 裁决注：数据面不成立——该函数吃原始 output 对象而 UI 只有格式化 content 字符串，spec A5 改为 UI 读已落库 summary 字段，验收等效满足）。顺手接线两处已埋点：用户停止的 task 显示「已中断」（interrupted 死枚举激活 / failureReason 落库信息消费）。

## 验收标准

### R1（GWT）

- Given 明文当量 480k 字符的文本附件，When 发送消息，Then 提示词正常注入全文（不降级）。
- Given 明文当量 501k 字符的文本附件，When 发送消息，Then 降级为文件名引用 + 引导文案（「文件过长，可用 read 配合 offset/limit 分段读取」口径不变）。
- Given 明文当量恰好 500k 字符，Then 不降级（边界含等于）。
- Given 同一输入分别走真实 run / token 估算 / 提示词预览，Then 三链行为一致（同常量单源）。
- Given 全仓检索预算数字，Then 仅单点常量一处定义（无散落 100_000/500_000 字面量）。

### R2（GWT）

- Given 双端会话详情页（desktop SessionDetailDrawer / mobile SessionDetailScreen），Then 无「查找聊天记录」入口。
- Given 全仓生产代码检索 searchMessages / ChatHistorySearch / MESSAGES_SEARCH，Then 零命中（历史迭代文档除外）。
- Given 删除后跑双端与 core 全量测试，Then 既有绿不新增红（专属测试随功能移除）。
- Given 删除后的 typecheck，Then renderer baseline 无失效残留条目。

### R3（GWT）

- Given 浅色主题打开提示词页，When 查看叶子卡正文 / 组卡格 body / workplace 预览正文，Then 颜色为正文色（黑），非 textSecondary。
- Given 深色主题，Then 正文为深色主题正文色（跟随主题）。
- Given 颜色断言护栏用例，When 人为改回 textSecondary，Then 红。

### R4（GWT）

- Given 提示词页展开 assistant 轮，Then 明度层次为：灰页 → 白轮卡 → 白组卡 → 灰格子，格子色为各端「当前灰子卡」token（mobile bgSecondary / desktop surface-muted）。
- Given workplace 卡，Then 列表壳为白、预览卡（最内层）为灰。
- Given 双端背景色断言用例，When 层次被改回旧序，Then 红。
- workplace 美化：demo 经用户拍板后落 spec（见风险与待确认项）。

### R5（GWT）

- Given 提示词页组卡收起态，Then 无卡片背景、无边框（含左粗条）、单行标题，高度对齐聊天侧形态（目标值 spec 定，mobile 显著小于现状 48px）。
- Given 展开组卡，Then 格子照常渲染且可交互（点击进全屏不变）。
- Given 双端相关断言（左粗条契约），Then 已随形态更新（不再钉旧契约）。

### R6（GWT）

- Given 任一工具调用收起态，Then 一行内含工具名 + 状态 + 摘要；成功态摘要来自 tool_result.summary（如 read 显示行数、edit 显示替换数）。
- Given read 成功调用展开，Then 可见入参（结构化 JSON 预览）与结果（行号正文）两段。
- Given edit 成功调用展开，Then 可见行级 diff：oldString 行红、newString 行绿、无行号列。
- Given grep 调用展开，Then 可见 pattern 入参与 matches 结果列表文本；卡片无「点击查看」跳转。
- Given task 调用（结果已落库），Then 可点进子会话；Given task pending 期，Then mobile 经既有注入链（pendingSubagentSessions）保留子会话入口（现状能力不回退），desktop 无注入链则无入口——该双端差异为既有形态，对齐挂账不在本轮（spec A4 裁决）。
- Given 用户停止的 task，Then 卡片状态显示「已中断」类文案（非「失败」）。
- Given 双端分别查看同一会话的工具卡片，Then 展示内容与可交互集合一致（点击优先级统一口径）。
- Given 全仓检索，Then webview 两份 core 镜像与 mobile RN 僵尸卡已删除；desktop 与 webview 卡片壳均消费 core 规格层。

## 约束与依赖

- 依赖父迭代 ui-prompt-fixes-2026-10（附件预算机制、提示词页卡片体系、formatToolUsePreviewJson 均为其产物，本迭代在其上调整参数与形态）。
- mobile WebView 侧改动遵守「build:webview --copy-native + gradle + install 三连」装机规矩；webview 不新增 npm 依赖（edit diff 零依赖实现，规避 allowlist 与 ES2018 门禁）。
- desktop 消费 core 新导出前先 `npm run build -w @novel-master/core`（dist 声明滞后会假绿）；core 新导出须同步 public allowlist 快照。
- R2 删除顺序：UI 先、core 收尾。
- 改 core 后三链测试（真实 run / token 估算 / 预览）都要跑。

## 风险与待确认项

1. **workplace 文件列表美化的具体设计**：本轮只定了「同步翻转 + 美化」方向，具体形态（图标/层级/徽标排布等）需 demo 拍板后进 spec（上轮 prompt-preview demo 先例可复用）。
2. **R6 点击优先级统一口径**：现状 desktop 文件优先、WebView 子会话优先，两端相反；spec 阶段定统一序（已裁决：file > subagent > skill 取第一个非空，与 read/write/edit 主用途一致）。
3. **R5 收起态高度目标值**：两端具体 px 值 spec 阶段定（参考聊天侧 ~16px 一行与 desktop 现状 28px）。
4. **R1 测试资源放大**：T-A 组用例的字符串构造随预算 ×5，测试内存/耗时上升，必要时分片或降构造量。
5. **R6 规格层的 public API 面**：summarizeToolSuccess 提导出、tool-card-view 新模块的导出面与 allowlist 快照同步（漏了会挂 CI，上轮教训）。
6. **并行既有红账**：mobile/webview 侧存在 mega-CR 遗留既有红（包清单序、batch-delete mock 等），验收时以 stash 对照归因，勿混入本轮。
