---
date: 2026-10-05
tags: [usage-tutorial, skill, builtin-skill, mobile, desktop, page-inventory]
source: 用户要写「教用户用 novel-master」的使用教程 skill（外置给 agent + 内置进产品，参照 agent-config），先列双端页面清单再逐页写教程
---

# 使用教程 skill 立项——双端页面清单与内置技能机制探索（brain-storm 轮）

## 用户诉求

写一个 skill 帮用户使用 novel master，且要内置给 novel master（「像 agent config 一样」）。本轮先列双端页面清单，之后按页面一条条写使用教程。

## 探索结论（brain-storm：mobile/desktop 两子代理报告 + 内置机制主代理手工探索补位——第三个子代理两次网络失败转手工）

### 双端页面全景（两份底稿报告落盘，后续写教程直接引用）

- `tmp/page-inventory-mobile.md`（33 界面）：2 Tab（对话/我的）+ chat tab 四格（会话/项目工作区/聊天/聊天工作区——同一 WebView 文档切 data-view，不是换屏）+ 27 Stack 屏 + ~20 弹层。27 屏几乎全挂「我的」页菜单。关键入口事实：对话态顶栏 ☰ = 会话详情页（最易漏的隐藏入口）；消息菜单是气泡 ⋯（长按开菜单已废）；划词批注仅「文件预览态 + session 域」开启；输入区 ⛶/@/$；VfsFileManager 文件树在四处复用（文件浏览器/项目工作区/聊天工作区/技能详情）。
- `tmp/page-inventory-desktop.md`（56 界面）：单 Electron 窗口「顶栏 + 三栏（左文件预览多 tab / 中工作区树三 scope / 右聊天三级下钻）+ 设置覆盖层（10 顶层入口 + 7 二级页 + 未保存守卫）」；工作区 scope 随右栏导航自动切换（projects→物理只读 / sessions→会话工作区 / conversation→聊天工作区）；工具卡点击优先级链：文件 → 子会话 → 技能详情 → 结果全文。
- 教程必须写对的易错认知：① mobile 会话列表与对话是同一页两个视图；②「工作区」= 逻辑文件树（VFS），「文件浏览器」= 只读物理树，勿混用；③ 更新流程不做应用内自动更新，弹窗引导去 GitHub 下载；④ mobile 会话操作抽屉（BottomSheetMenu 四项）是遗留死路径，现入口是会话详情页。

### 内置技能机制（新增「使用教程」内置技能的路线图）

- 单一来源：`packages/core/src/bootstrap/skills/seed-builtin-skills.ts` 的 `BUILTIN_SKILL_NAMES`（现仅 `agent-config`）；`skills.service` 的删除拦截与同名新建拦截（`assertSkillNameNotReservedForCreate`，中文报错，ZIP 导入落盘前同样过门）共用该名单——名单加名字即自动受双域保护。
- 正文形态：TS template string 常量 `AGENT_CONFIG_SKILL_MD`（front matter name+description + 章节式正文，~90 行，给 agent 读的参考文档）；写法约定 D5：缩进式代码块（4 空格）+ 行内强调用「」，整篇避开反引号与 `${`，TS template string 无需转义。
- 幂等台账：KKV `nm-seeds/<名>` 存 SEED_VERSION（现 3）；全新库首种、版本落后**无条件重种**（官方文案即权威，与 migration 语义一致）、已当前版单次 kkv 读早退。文案变更 = 改常量 + 版本 +1。
- 种入：`seedBuiltinSkills` 在 bootstrap 事务后经 `SkillsService.writeSkillFile`（首种 `builtinSeed: true` 豁免新建拦截）；升级挂 seed 不挂 SCHEMA_MIGRATIONS（技能存 VFS，migration 事务内裸写等于重实现 VFS 写路径）。
- 新增第二个内置技能改动面：seed-builtin-skills.ts（名单 + 正文常量 + 版本常量 + 种入逻辑，宜抽象成数组遍历）+ bootstrap 相关测试注意计数断言圈 scope（RULE 红线）；双端技能管理 UI 天然展示无需改。注意：内置名不可删不可同名新建，用户想定制只能复制成新名字。

### 教程组织建议（两报告建议汇总）

通用概念篇（项目/会话/三层工作区/智能体/技能/压缩置位批注）→ 双端分篇逐页教程 → 隐藏入口专章。mobile 按四大块（会话与项目/文件与工作区/配置/提示词与统计进阶）；desktop 三栏工作台起手 + 设置「按任务查」+ 术语统一（置位/回滚/压缩上下文/分叉各配一句话定义）。每页五要素模板：显示名 → 入口 → 能做什么 → 关键交互 → 隐藏入口。

## 下一步

用户审完页面清单后按页一条条写教程（外置 skill 本体 + 内置技能版）；本轮未动任何代码，仅 tmp/ 两份报告与本记忆。

## 第二轮：用户拍板分开双端、不做内置、手动分发；两个教程 skill 已产出（brain-storm + skill-creator）

用户拍板：desktop/mobile 分开两个 skill（两端界面差异大）；先不做内置种入（不动 core seed），由用户手动 ZIP 分发。预期问题是五类：「怎么设置服务商」「怎么连接 API」「怎么压缩上下文」「怎么写小说」「怎么越狱」。

产物（两个子代理并行初稿 + 主代理终审修正）：

- `.agents/skills/novel-master-mobile-guide/`（SKILL.md 52 行 + 7 references，共 ~1000 行）
- `.agents/skills/novel-master-desktop-guide/`（SKILL.md 58 行 + 7 references，共 ~1173 行）
- 结构：SKILL.md（front matter name+description 触发导向 / 概念速览 / 四术语 / 五类问题路由表 / 写法约定）+ references 按问题域分：quickstart / providers / context / workspace / agents / skills / misc（misc 末尾 FAQ 含越狱条目）。素材：tmp/ 两份页面报告 + 源码定点复核（mobile 子代理复核 20+ 源文件；desktop 子代理纠出「设置入口实为 9 个非 10 个」）。
- 写作说明落盘：`tmp/guide-authoring-{mobile,desktop}.md`（含复核清单与模糊化点清单）。
- 「越狱」条目定调（两 skill 一致）：客户端不内置内容过滤，限制在服务商侧；两条正规调节路径＝换服务商/自建中转 + 智能体系统提示词定尺度；不提供不编写越狱提示词。

主代理终审修正六处（源码级核实）：

1. **「压缩」≠折叠成摘要**：两端初稿把压缩写成「折叠成摘要」，实为隐藏（hide，不进上下文、数据保留）——desktop/mobile 的 SKILL.md 与 context.md 术语全部改为隐藏语义。
2. **「分叉」语义**：core `message.service.ts:319` fork(sessionId, upToMessageId)＝同项目新建独立会话、复制锚点及之前全部消息（hidden 状态保留）、不复制 session KKV；双端 fork 成功均直接切进新会话（mobile `useChatTabMessageActions.ts:173` setCurrentSession / desktop `ConversationPanel.tsx:818` openSession）。两端定义补「复制出新会话并切过去」。
3. desktop 置位节「切回起点就又能看到」表述含糊 → 改「把置位点换到更早的消息就又能看到」。
4. mobile context.md 常见坑补「置位/分叉运行中被拒」（toast 文案「Agent 运行中无法置位/分叉」源码实锤）。
5. desktop SKILL.md 概念表「三层工作区」原把文件浏览器（物理树）算进三层 → 改为「工作区（中栏三视图）」并桥接 README 三层概念（全局模板→项目模板→会话工作区复制链）。
6. 核实为准确、无需改：desktop 压缩确认文案「将按照事件配置压缩上下文」（SessionDetailDrawer.tsx:633 实锤）、mobile「请稍候 / Agent 运行中无法压缩」（SessionDetailScreen.tsx:154）、desktop 统计空态两句文案（TokenUsageStatsView.tsx:797/801）、mobile 隐藏消息渲染＝纯 opacity 0.45 降透明度无「已隐藏」标签（transcript.css:174），而 desktop 有「已隐藏」标签——双端渲染差异，各自照实写。

双端真实差异（分开 skill 的正当性实证）：mobile 项目工作区（项目域）只读浏览、改模板靠「下推模板」；desktop 会话工作区（同指项目模板母本，历史命名）可直接编辑。

第三轮小补（用户问「支持哪些工具」暴露的缺口）：两端 agents.md 原来只列 11 个工具名、无功能说明——已按 core `packages/core/src/domain/tool/builtin/` 各工具官方 description 补成「11 个内置工具一览」表（read/write/edit/fs/glob/grep/skill/agent/curl/search/task 各一句话），「支持哪些工具」与「怎么限制工具」由同一节答全。覆盖面其余确认：agent 配置/批注/技能/统计/导出（书稿 ZIP + 数据库 .nmbackup 双义）均已有专节；刻意不收录：nm 命令行、iOS、越狱提示词内容。

分发方式（未内置）：ZIP 根直接含 SKILL.md + references/（novel-master 技能 ZIP 导入的硬要求），用户经「技能管理 → 新建 → 从 ZIP 导入」安装；ZCode 侧可放 ~/.agents/skills/。技能名 novel-master-mobile-guide / novel-master-desktop-guide 均合规（kebab-case、不撞内置保留名 agent-config）。
