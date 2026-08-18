---
date: 2026-08-18 00:00
title: skill 能力全链路：设计→实现→合并→mobile 打磨（含 v6 版本撞车修复）
keywords: skill, SKILL.md, VFS scope, meta/skills, 提示词注入, 技能管理页, code-dev-loop, feat/skills-integration, SCHEMA_BOOT_VERSION 撞车, VfsFileManager 复用, mobile UI 打磨
abstract: skill 能力从设计到实现到合并到双端打磨的全记录：两域 meta/skills 存储、skill_opt 工具、提示词索引、$ 引用、双端管理 UI（dev-loop 6 wave 交付后合并入 feat/skills-integration）；合并后修复 SCHEMA_BOOT_VERSION v6 撞车（升 7）；mobile 侧持续打磨——NewSkillModal 域固定+键盘避让、SkillDetail 改为复用 VfsFileManager（workplace 可选化）、侧滑逐级上翻、技能 ⋮ 菜单提供单技能 ZIP 导入导出；后续用户拍板移除「跨域复制/提升为全局」两能力，desktop 侧整链拆除（IPC channel+类型+handler+菜单/弹窗+测试）。
---

user:
我想给应用加 skill 能力，skill 本身不复杂（像常见 AI IDE 那样当普通文件处理），但我们的工作区是会话隔离的，有点麻烦。skill 不需要这么强隔离，感觉全局 + 项目两个域就够了。而且除了文件编辑器，还想在设置里做可视化管理，mobile/desktop 的交互我还没有好思路。

assistant:
按 brain-storm 派了四路探索（VFS scope 机制、提示词拼装、文件编辑器 UI、设置页架构），关键结论：

1. 会话隔离不碍事：session 工作区是 project 树的一次性拷贝（initializeSessionWorkspace 的 replaceVfsSubtree），但 skill 读取可以在拼装时直接按 scopeKey 查 global / project:{pid} 两个域，完全绕开复制链。ScopedVfsService 本来就支持按 scope 建视图。而且 session 内 agent 工具读不到 global/project，反而契合「skill 由系统注入而非模型自己翻」的设计。
2. 不要复用 rule_snapshot/file_cache：那是会话生命周期缓存，语义是展示档位；skill 需要的是 front matter 元数据。要缓存就新开 kkv 域（域类型是开放字符串）。
3. 注入方案：skill 索引（name+description+来源域）做常驻小块，正文按需拉取——task 工具的 callableAgents「description lambda + 模型自选」模式是现成先例，照抄即可。注入点选 buildPromptLlmInputFromLayout（唯一拼装入口，三端预览免费生效），注意同步改 computeLlmExportZonesFromLayout。
4. 存储约定：VFS 下 /skills/{name}/SKILL.md，global + project 两域，同名 project 覆盖 global。启用/禁用如需要可参照 workplace 规则表的 scope_key + logical_path 模式建小表。
5. UI 现状比预想好：global 域两端已有完整浏览+编辑入口（mobile Profile→全局工作区 GlobalTemplateScreen；desktop Explorer 的 global 树）。「skill 当普通文件」基本零成本。缺口是 desktop 进项目/会话视图后 global 树不可见。
6. 设置管理：两端都有「列表→详情」现成范式（agent 管理），照抄骨架；mobile 编辑页可直接参数化复用 FileEditorScreen（scopeKind 路由参数现成），desktop 加 SettingsViewId 页内栈 push。两个视图是同一份 VFS 文件的两个窗口，无同步问题。

待拍板：触发方式（索引+skill 工具 vs 全文常驻）、同名覆盖语义、启用开关存哪、desktop 项目内 global 树可见性缺口要不要顺手补。

user:
不不不，我考虑会话隔离的难点在于智能体编辑 skill 文件的能力。.agents 在 novel master 没意义——每个 session 是隔离的而不是共享的，改完只会在当前 session 生效。既然都是专用的工具了，还有必要放到 .agents 目录吗？感觉完全可以放到之前保留的 meta 目录。要设计就设计完整，不要说 v1 v2，我需要知道怎么设计 skill 的启用和关闭、怎么区分全局和项目。

assistant:
与用户多轮收敛后拍板完整设计：

1. 存储：VFS 两域 meta/skills/{name}/，skill 是目录（SKILL.md 入口 + references/ 等辅助文件），不是单 snippet。
2. 不进 session 复制链：技能读写直连 global/project scopeKey，绕开 initializeSessionWorkspace（project→session）与 projectTemplatePull（global→project）两条整树先删后拷的链，真实现需给两处加排除。
3. AI 权限：对 project/global 两域技能文件均可读写，无限制（用户明确撤掉早期「global 只读」设想）。
4. 启停：负清单（默认启用，禁用=写行），按域+项目分组；开关不进 front matter、不进 session KKV。
5. 合并解析：同名 project 副本覆盖 global；禁用判定 project 行优先。
6. 视角分离：会话技能面板=当前项目+全局合并视图；设置管理页=全局语境、按项目分组展示所有项目技能。
7. UI 三入口：会话操作抽屉「技能」→ 面板；我的→技能管理（双 tab，全局在前默认、项目在后）；聊天工具卡片跳详情。技能详情页复用文件浏览器（skillDetail 伪 scope）。

user:
新建个 worktree 吧，然后改下 examples/mobile/index.html，我想看看 UI 操作逻辑，对我来说 UI 交互更重要。另外 skill 规范是支持 reference 或其他文件的，不只有一个 skill 文件。还有 agent 可以改 global，没什么不能改的，这里没必要限制。项目 skill 那里你得展示所有项目 skill。全局技能和项目技能做成双 tab，全局在前默认，项目在后。不能只改标题啊，其他相应的也得改啊。

assistant:
在 worktree .woktree/skill-ui-prototype（分支 feat/skill-ui-prototype，基于 origin/main）改 examples/mobile 三个文件实现原型：会话面板（合并解析+开关+覆盖徽标+无效标签）、设置管理页双 tab（项目 tab 按项目分组展示所有项目、批量管理、跨项目复制/提升全局带项目选择弹层）、新建弹窗（域分段全局在前+所属项目下拉）、详情页（文件浏览器复用、子目录导航、新建/删除辅助文件、SKILL.md 保留名）、编辑器复用（路径 chip meta/skills/…+域徽标带项目名）、聊天 create/update 工具卡片。内联脚本验证 13 项全过。教训：调换 tab 顺序必须整块交换面板内容，只改按钮和 active 类会全局面板装着项目内容，且验证要断言容器实际内容归属。

user:
原型设计的差不多了，可以生成 prd 了。

assistant:
按 prd-generate 走完探索（三路子代理：docs 惯例与前置 PRD、原型交互全清单、主仓业务现状），准备落 docs/Iterations/<迭代名>/prd.md。命名建议 agent-skills（英文 kebab-case 惯例）；dependency 候选：vfs-unified-root（域路径语义基准）、chat-project-vfs（VfsScope/ScopedVfsService 奠基）、agent-subagent（skill 工具仿 task 的 description lambda 先例），待用户确认后落盘。原型两处语义留待 PRD 定夺：全局 tab「被项目副本覆盖」标签的判定范围（现按当前项目）；全局域禁用行无 UI 写入路径（是否补设置页全局开关）。

user:
这都小问题，我只关注 prd 内容。

assistant:
PRD 已落盘 docs/Iterations/agent-skills/prd.md（date 2026-08-16，dependency 三项：vfs-unified-root / chat-project-vfs / agent-subagent）。结构：背景（两大冲突：会话隔离、AI 无跨域通道）→ 目标（5 条成功指标）→ 用户与场景 → 范围（含隔离豁免、不含市场/版本/组合）→ 核心需求 7 条（存储与两域/AI 能力/启停/会话面板/设置管理页/新建详情编辑/聊天卡片）→ 验收标准 8 组 GWT（含隔离豁免专门一组）→ 风险与待确认 4 项（覆盖标签判定范围、全局禁用无 UI 通路、desktop global 树不可见、索引体积增长）。待用户最终确认 PRD。

user:
想起一个重要的实现问题：输入框已有 @ 引用，这次也加上 / 引用，UI 与 @ 完全一致（按钮+手动输入）；去重也一样，不重复加载，只有第一个 / 引用加载。

assistant:
派子代理核清 @ 引用全链路（双端 ChatComposer/AtPathTypeahead/FileReferencePicker + core 的 scan-at-path-attachments/prepare-user-messages-for-prompt/prompt-path-seen，以及置位/压缩的 seen 重置），PRD 增补技能引用需求。关键拍板（用户已确认同意）：常驻索引不计入「已出现」（索引只有名称+描述，首次引用仍附全文）；已关闭技能可被显式引用（明示意图优先于负清单，选择器标注关闭态）。触发符号用户提出 / 不好用可换 $，最终定 $：/ 与 @/path 的路径前缀天然冲突，$ 无色栉；用户同时拍板选择器直接平铺技能列表，不套文件浏览器层级 UI。注意：纯 $ 引用无正文需计入发送门闩；examples/mobile 原型尚未覆盖 $ 引用交互，待用户决定是否补。

user:
skill 描述提示词得在智能体提示词配置中体现，类似会话区：虽然没法控制，但得体现存在和位置，所见即所得。

assistant:
派子代理核清提示词配置与预览链路：配置 UI 分区是纵向卡片序列（系统→常驻工作区→持久→会话→动态，顺序由 PROMPT_REGION_LABELS.layoutOrder 文案钉住且有测试断言），不可控区块的呈现模式是「固定位置占位卡片 + 无任何控件 + 说明文案」（会话区 chat-slot 卡片）；预览三端共用 buildPromptAssemblyFromLayout 单次遍历，core 加 segment 三端自动出现；computeLlmExportZonesFromLayout 的 persistCount 需计入新块否则 token 分区错位；AgentDefinitionEditorForm.tsx 在 desktop 无引用疑似遗留。PRD 增补：核心需求 2 加注入位置（系统区之后、常驻工作区之前，我定的待用户确认）、配置 UI 占位卡片（照会话区模式）、预览独立分段三条；验收新增「提示词配置与预览」组（含三处顺序一致性断言）；范围加「提示词配置与预览的体现」条目。实现时注意 layoutOrder 断言测试要同步改。

user:
$ 引用候选列表显示 skill 名字和描述就够了吧？agent 的 skill 工具我期望是通用单工具 skill_opt(action, params) 这样。

assistant:
确认 $ 候选列表就是平铺名字+描述（加域/覆盖/关闭三个标记，无效不出现），PRD 已是该语义。skill_opt 单工具分发方案赞成并落 PRD：小内聚域+统一权限档位，拆多工具只多付 schema token。四处打磨：params 用扁平显式字段不用不透明包（准确率）；action 四个 read/write/edit/list（read 缺省按生效副本解析，list 供查重与辅助文件发现，索引只有名称+描述）；path 限定技能目录内禁 ..；AI 不给 delete（创建/更新开放，删整技能仅用户 UI）。代价：单工具 policy 粒度全有或全无，当前无限制拍板下可接受。验收补了 read/edit 行为、path 越界与 write 缺域报错两条。

user:
（附 spec-generate skill）原型设计的差不多了，可以生成 spec 了。

assistant:
按 spec-generate 流程：读 PRD+三份前置 PRD（vfs-unified-root/chat-project-vfs/agent-subagent），另派三路子代理探 core 存储数据层、工具提示词层、双端 UI 集成点，SPEC 落盘 docs/Iterations/agent-skills/spec.md。关键技术结论：技能文件即 global/project 域 VFS /meta/skills/ 文件（逻辑路径无限制，assertLogicalPathAllowed 只拦 /template）；负清单照 workplace_dir_rule 建独立表 skill_disabled_rule（SCHEMA_BOOT_VERSION 5→6，不用 KKV）；复制链排除动 replaceVfsSubtree 的 excludePrefixes（删/拷/seed 三侧，revision GC 最易错）；skill_opt 照 fs 工具单工具多 action + task 工具 description lambda 先例，AgentTurnRuntimePort 扩 skills()，主/子两装配点；卡片跳详情照 subagentSessionId 的 meta 自动透传，需同步 desktop DTO+双端 message-blocks+mobile WebView 镜像；提示词 PromptRenderContext 加预解析 skillsIndex（render 纯函数），两套遍历（assembly+LLM input）都要插段否则三方一致性验收不过，zones persistCount 计入，layoutOrder 断言测试同步；$ 引用 composer-at-path 参数化 trigger+新 scan-skill-attachments+skillAttach 枚举+skill: seen key（S0 不预填）。SPEC 新拍板设计决策：D1 项目复制携带技能与负清单；D2 子代理同样注入技能索引与 skill_opt；D3 mobile 技能详情新建轻量 SkillFileManager 不硬复用 VfsFileManager（workplace 深耦合）。另修正大坑：mobile「会话操作抽屉」实际已迁移为 SessionDetailScreen（五卡片），技能入口加第六张卡。

user:
补充一点，skill_opt 工具也要可以像 task 工具一样是可配置的。

assistant:
补深工具策略链路后更新 PRD+SPEC。关键发现：validateAgentToolPolicy 无静态白名单常量，是 probe 驱动（registerBuiltinTools 注册即合法，用户已确认此机制）；BUILTIN_TOOL_CATALOG 手工同步关系，task 已在 catalog 首条——agent-subagent PRD 的「task 不进 catalog / subagentCallable」描述已过时（subagentCallable 已废弃改 mode），以代码为准。skill_opt 可配置只需两处：registerBuiltinTools（校验/运行时自动生效）+ catalog 条目（双端 picker 自动出现、计数变 8）；附带三处写死「7 个」文案改 8 + 双端 picker 测试硬编码数字。新拍板 D4：agent deny skill_opt 时其 run 不注入技能索引（工具与索引同进退，避免看得见用不了），$ 引用不受影响（注入全文不依赖工具）；子代理按子定义自己的 policy 判定不继承父。SPEC 加 Step 7a/T-SK7a，Step 10 与 T-SK 扩 D4 联动。

user:
标注废弃吧。

assistant:
在 docs/Iterations/agent-subagent/prd.md 顶部加废弃横幅（三条更正：subagentCallable 已废弃改 mode；task 已进 catalog 首条；无静态白名单常量、probe 驱动），并在 subagentCallable 字段、核心需求 4「配置可控」、约束与依赖「工具白名单口径」三处加内联 ⚠️ 已废弃标注，均指向 agent-skills/spec.md 的以代码为准结论。目的：防止后续实现者被旧 PRD 带偏。

user:
（附 spec-check-loop skill）对 agent-skills 的 PRD/SPEC 跑审查循环。

assistant:
进入 spec-check-loop：第 1 轮审查 No-Go（0 P0，3 P1：desktop 会话面板缺失、skillAttach 与 superRefine 相撞、$ 扫描正则错+容错未定义；另有 3 P2）。主代理拍板修复方向后派 doc-fix 子代理一轮闭合全部六条（含新增 D5 覆盖标签任意项目判定、SKILL_NAME_PATTERN 常量、desktop 挂点 SessionDetailDrawer 含 App.tsx 调用链证据、skillAttach 专用 skillName 字案+superRefine 分支、不存在技能不写 seen key 自愈）。第 2 轮审查 Go（execute-ready）：上轮六项全部核实修复、PRD↔SPEC 映射完整、代码行号抽查全部命中；遗留 1 P1（正则 $ 未转义，照抄必挂）+3 P2（一句话级），满足 trivial 豁免由主代理直接修复（已注明）：正则改 /(?<!\S)\$([^\s$/@]+)/g、strict schema 补 skillName object 层声明、attachmentDedupeKey 加 skillAttach 分支、无效技能引用附原文不视为不存在。待用户确认 execute-ready。

user:
（附 code-dev-loop skill）新建 worktree 开发吧。

assistant:
在 .woktree/skill-dev（分支 feat/agent-skills，base 574c6de）按 code-dev-loop 走完全程，dag_version 2（一次 fix-wiring 重编排）：
- wave-0 存储（3056204）：vfs-tree-copy excludePrefixes 三侧排除 meta/skills、两条 pull 链、skill_disabled_rule 表升 SCHEMA_BOOT_VERSION 6、domain/skills 纯函数。
- wave-1 服务（e250d7c）：SkillService 两域读写/启停/复制删除 + 三端 runtime skills() 工厂 + 项目复制携带技能（D1）。
- wave-2 工具（d5dde67/b3fa2df/5b40a39）：skill_opt 四 action 单工具 + description lambda + catalog 第 8 条 + meta.skillRef 透传（desktop DTO/双端 message-blocks/mobile WebView 镜像 skill-tool-ref）。
- wave-3 并行 prompt（7bb16ba/87d8678/91f434a）+ attach（112dda8/32bef7c）：skillsIndex 常驻段（两套遍历、D4 deny 置空、三端预览含 CLI budgetSkillsIndex）+ $ 扫描（/(?<!\S)\$([^\s$/@]+)/g）+ skillAttach schema（skillName 专用字段、strict 声明、superRefine 分支）+ hydrate 首次全文/skill: seen/不存在自愈。
- fix-wiring（01642cb）：agent-runner/双端 session-prompt-input 传 skills+projectId（hydrate 独立于 D4，$ 显式引用不受工具禁用影响）、desktop DTO 补 skillName、CLI 预览补预算。
- wave-4 verify+cr-func：mobile TranscriptAttachmentView 漏 skillAttach 枚举一行修（62a20ad）；func-ready。
- wave-5 并行双端 UI：mobile f7c94a9/0ba891a/fcb4c3b/cf4a1e9（面板/双 tab 管理页/详情+SkillFileManager(D3)/composer $+卡片跳转+WebView 链路）；desktop 72c3e6f/b5da8c0/c4dae36/4bcc17f（IPC 四件套九 channel/SessionDetailDrawer 面板/skillsManage+skillDetail 设置视图/composer $+跳设置详情）。
- wave-6 verify-final+cr-func-final：core 2038/desktop 40/mobile 61 全绿，双 cr-func func-ready，dev-ready 达成。
spec_deviations 已认定 8 条（vfs-exclude-prefixes 独立文件、deleteUnreferencedUnderScope 加参、祖先目录连带保留、replaceVfsSubtree 改调 sweep、事务外抛错、delete 清负清单孤儿、+2 条 spec 内含扩展：hydrate 独立接线、CLI 壳 definition 预算）。待用户拍板 1 条：skill_opt write 缺省域实现为补 project（携会话 projectId），PRD L181 写报错拒绝——建议对齐文档（现实现更友好，服务层缺域仍报 MISSING_DOMAIN，两层各自自洽）。
遗留：Step 22 真机走查（manual_user，核验点清单在 wave-5 报告）；worktree 环境存量不阻塞（cli e2e、mobile webview 两项、packaging/smoke）；examples/mobile 原型因主仓并行会话切分支丢失（PRD/SPEC 已被 766c81c 收编保住，spec 内决策完整，未阻塞实现）。worktree 的 docs/Iterations/agent-skills/ 仍 untracked，是否随分支提交待用户定。

user:
将当前分支合并到主 worktree 的 feature。

assistant:
主 worktree 当时停在 main（v1.4.29，chat-fixes 已并入），无检出中的 feature 分支，遂从 main 新建 feat/skills-integration 承接合并（main 未动；若要直接进 main 指针可再挪）。25 个文件双向改动重叠但真冲突仅 2 处：① vfs-tree-copy.deleteVfsPrefix——main 侧 N+1 优化改成批量 deleteRecursiveIfAny，我们侧是 excludePrefixes 逐条豁免，解法为双路径并存（无排除走批量快路径、有排除退逐条）；② run-agent-turn 的 import——isUserVfsUnifiedToolTurnEnabled 门控被 main 的 chat-fixes 整体移除（flag 模块仍在但 run 链路不再用），按 main 新行为丢弃该 import，我们分支基点 574c6de 携带的旧门控代码不保留。自动合并后核验 skills 装配点（L427/L621）、$ 扫描合并（L296）、skills() 端口全部存活。合并提交 da12f98，验证：core 2003/0、desktop typecheck+5 测试文件 0 fail、mobile typecheck+71/71。主仓 AGENTS.md 与本记忆文件的未提交改动保持未提交（AGENTS.md 非本会话所改，不碰）。

user:
修一些小问题：1）聊天详情页点技能，空的会报错 tip；2）技能管理应放配置组、排智能体配置后面；3）全局/项目技能要用 tab 样式。

assistant:
三个 mobile 小修（280a551）：① SkillPanelScreen reload 对 isVfsError(NOT_FOUND) 静默置空不弹 toast（补 skill-panel-screen.test 两条用例锁行为；core 补 empty-state.test 锁服务层空态返回 []）；② 技能管理从「工作区」组移入「配置」组第二位（智能体配置后，value 计数照旧）；③ SkillsSettingsScreen 双 tab 从自制 Pressable+下划线换成标准 SegmentedControl（全局在前项目在后保持）。排查 #1 时的重要发现：用户桌面正式版 DB（~/.config/@novel-master/desktop/novel.db）还在 user_version=5、无 skill_disabled_rule 表——正式版 app 未跑过 skills 代码；当前合并代码在该 DB 副本上跑 effectiveSkills 空态零报错（bootstrap 先迁移建表）。真机报错推测是旧 bundle/未迁移 DB 的环境错配（如热重载混新旧 runtime），代码路径已证清白；若复现需看 toast 具体文案。

user:
问题 1 报错的是 no such table。

assistant:
根因实锤：SCHEMA_BOOT_VERSION 版本号撞车——main v1.4.29 与 skills 分支各自把版本升到 6（内容不同）。真机 DB 被 main 的 v6 迁移过后，合并代码看 6>=6 走快路径跳过建表，skill_disabled_rule 永远建不出来，effectiveSkills 查表报 no such table。修复（709dd40）：SCHEMA_BOOT_VERSION 升 7，强制所有 v6 库重跑全量幂等 DDL（CREATE TABLE IF NOT EXISTS 补齐缺失表，已存在表不受影响）；bootstrap 注释记录撞车原因；skills-schema.test 改断言升 7 并新增「v6 撞车库补建」回归用例。教训：并行分支各自 bump 全局 schema 版本号必然撞车，合并时必须检查对方是否也动了 SCHEMA_BOOT_VERSION——这次合并时只解了两个文本冲突，漏了这处语义冲突。core 全量 2005 pass。

user:
技能管理放到服务商配置后面，我不是说三字在前二字在后吗。

assistant:
改了（ef970f9）：配置组顺序为 智能体配置 → 服务商配置 → 技能管理 → 聊天配置 → 存储配置 → 正则配置。用户原话「三字在前二字在后」指名称字数排序的长前短后，我此前误解为「紧跟智能体配置」。

user:
老问题，所有输入框的位置没有适配键盘顶起。

assistant:
定位：技能 UI 里唯一漏避让的是 NewSkillModal（底部 sheet 弹窗，面板和技能管理页共用），键盘弹起直接盖住输入框；SkillFileManager 新建文件走的 TextPromptModal 已有避让，FileEditorScreen 是存量编辑器不涉及。修复（9485c02）照项目标准双平台模式：iOS 用 react-native-keyboard-controller 的 KeyboardAvoidingView behavior=padding 包裹；Android 给 panel 挂 useAndroidModalKeyboardAvoid(1)（底部 sheet 传 fraction=1 上移整个键盘高度，DirectoryRuleSheet/AddModelModal 同款），表单区套 ScrollView 键盘弹起时内部可滚。排查入口：grep TextInput 于 skills 组件 + 对照 ui/sheet 下既有弹窗的 KeyboardAvoidingView/useAndroidModalKeyboardAvoid 先例——以后新增带输入的弹窗都要走这套。

user:
描述太长会直接把名称顶出页面。

assistant:
NewSkillModal 三处修（键盘避让修复的连带问题）：① 表单区 ScrollView 从 flexGrow:0 改 flexGrow:0+flexShrink:1——内容超高时收缩内部滚动，保住标题与底部按钮；② 描述多行输入加 maxHeight:140，防止单输入框占据整个面板；③ Android 面板 maxHeight 从 85% 收紧到 60%（panelAndroid 平台样式）——translateY 式避让是整块上移键盘高度，面板若到 85% 高再上移，顶部（标题+技能名输入框）会被顶出屏幕；iOS 的 KeyboardAvoidingView padding 会自动压缩可用高度不受影响。根因链：长描述→面板撑到 maxHeight→键盘 translateY 上移→顶部出界。

user:
技能详情直接复用文件编辑器不行吗？现在这样都没办法创建文件夹。如果不好复用，可以抽象一个通用文件管理器。

assistant:
推翻 D3 自建 SkillFileManager 的拍板，改为复用 VfsFileManager（17498a7，净删 310 行）。评估结论：workplace 实际耦合点仅 8 处（reload 的 buildListRows/getDirRule、rename/move 的 migrateWorkplaceDirRename、导入与新建目录后的 setDirRule、纳入/目录规则/角色卡菜单），可选化后即成通用文件管理器——无需大抽象重构（那会波及 session/project 现网场景）。改动：workplace? 可选（空时排序退化纯 VFS、目录计数缺省、菜单条件隐藏）；新增 isProtectedPath 钩子拦删除/重命名/批量删除/移动（skill 域保护 SKILL.md 入口）；SkillDetailScreen 传 scope+vfs+rootPath=/meta/skills/{name} 直接内嵌；删 SkillFileManager 与 skill-file-events（编辑器被删踢回改为返回时刷新暴露，与 session 工作区行为对齐）。现网回归：vfs-file-manager.session.integration 4/4 通过验证可选化无破坏。

user:
优化点：技能详情标题改技能名；全局域那堆 head 全移除；/meta/skills/{name} 前缀隐藏替换为 /；跟随/全展示 tag 不展示；不能影响工作区 UI。

assistant:
四处收敛（均 gate 在 skill 场景，工作区零改动）：① 标题走 setStackOverride({title: name})（ProviderDetailScreen 同款，useEffect 卸载清 undefined）；② SkillDetailScreen 整个 meta 头删掉（含域徽标/描述/无效原因/项目名），item 仅剩存在性判断；③ VfsFileManager 新增 pathLabel prop 只改顶栏显示（skill 传 p => p===root?'/':p.slice(root.length)），编辑器 skillBar chip 改按技能根截取显示 /rel；④ 跟随/全展示来源是 mapVfsListEntry 兜底映射的硬编码 subtitle/badge——reload 里 workplace==null 时统一剥掉（badge: null + subtitle ''），工作区路径（workplace 传了）不受影响。回归：vfs-file-manager.session.integration 4/4 确认工作区 UI 无破坏。

user:
技能 全局|这个文件详情的 head 也移除吧。

assistant:
FileEditorScreen 的 skillBar（「技能 · 名称」+ 路径 chip + 全局/项目域徽标）整行删除，连带 skillBar/skillChip 样式与 skillDomainBadgeLabel import 清理。技能文件编辑器现在与其他文件编辑器同构：栈标题「编辑文件」+ 工具栏 basename。

user:
新建 skill，选择项目/全局的 tab 不要放在下面——因项目下拉出现而变动。移除，当前在什么 tab 就创建什么领域的 skill。

assistant:
NewSkillModal 移除存储域 SegmentedControl 与内部 domain state：prop 改为 domain（固定），管理页传当前 tab 域、会话面板固定 project+当前项目。项目下拉仅在 domain==='project' && defaultProjectId==null（即管理页项目 tab）时显示并懒加载项目列表——面板场景直接建在当前项目，布局不再跳动。

user:
聊天详情页面的 skill 开关出现抖动问题。

assistant:
SkillPanelScreen 开关抖动三因叠加（bcadcd7）：① 切换时 togglingName 驱动 Switch disabled 灰态 + await 后才翻转 value + 行透明度变化，三段渲染视觉来回跳；② useFocusEffect 每次聚焦 reload 都 setLoading(true)，从详情返回时 RefreshControl 闪、整列表重建；③ value 受控更新滞后于拨动手势。修法：乐观更新提前到 onValueChange 同步 flip（失败回滚+toast）；防连点改 togglingRef 不驱动渲染，Switch disabled 只留无效技能；reload 加 silent 参数（聚焦返回静默刷新不拉 loading，手动下拉照旧）——注意 silent 只能静默开头，finally 必须无条件 setLoading(false) 否则首屏 loader 卡死（测试抓到）。

user:
整理/新建两个按钮也移除，右上角空白位置加管理按钮或管理 icon。

assistant:
SkillPanelScreen 头部按钮行整行删除；「管理」入口走 stackOverride({showMenu: true, onMenu: 跳 SkillsSettings})——AppHeader 右上角菜单位（汉堡 icon，与主题切换按钮并排），卸载自动清。新建入口保留在管理页头部与空态卡（面板空态仍有新建按钮）。测试补 useHeaderContext mock。

user:
skill 文件管理器侧滑应逐级返回上一目录而非直接回管理页；菜单导入/导出 zip 全移除，skill 管理的更多菜单应有导入导出；复制到项目直接移除。

assistant:
三改（gate 在 skill 场景，工作区零影响，session 集成 4/4 回归过）：① SkillDetail 用 VfsFileManagerHandle ref + BackHandler（hardwareBackPress：canGoUp 则 goUp 拦截，否则放行 pop），header 返回按钮同逻辑（stackOverride.onBack=goUpOrExit）；② VfsFileManager 实体/更多菜单的导入导出 ZIP、角色卡、纳入全部并入 workplace!=null 条件——skill 域菜单只剩新建目录/文件+重命名/删除；③ SkillsSettings 头部加「更多」按钮：导出/导入技能包 (ZIP)，zip 根=目标域 /meta/skills（zip 内为各技能目录），全局 tab 直接执行、项目 tab 先弹目标项目选择，导入前 Alert 覆盖确认；全局技能 ⋮ 菜单移除「复制到项目…」，copyContext 类型收窄只剩 crossProjectCopy。

user:
不是在上面加更多，而是技能管理每个技能的更多按钮菜单里加导入/导出 zip。

assistant:
纠正上一轮的理解错误（6234e08 把导入导出做成了管理页头部的「更多」按钮+域级 zip）：头部更多按钮、zipProjectPick 项目选择弹层、ZipTarget 类型全部拆除；导入/导出改为每个技能 ⋮ 菜单项（编辑/导出 ZIP/导入 ZIP/[复制到其他项目…/提升为全局]/删除），zip 根=该技能目录 /meta/skills/{name}（导出即整个技能包，导入把 zip 内文件合并进该技能目录、同名覆盖、Alert 确认）。skill-panel 测试补 TabIcons mock（ManageListIcon 的 react-native-svg 依赖在测试环境会挂）。

user:
（补记漏掉的几轮 mobile 打磨）按钮文本 创建并编辑 改为 创建；技能页面的提示文字太长了，移除；2/2启用 也不需要，移除。

assistant:
三个文案精简提交：cae4124（NewSkillModal 按钮「创建并编辑」→「创建」，行为不变仍创建后跳详情）；bdd0993（面板头部提示精简为「n/m 启用」）；809bd47（n/m 计数也移除，头部只剩整理/新建按钮——此提交手滑删过整行 header 连按钮一起，当即恢复）。

user:
更多icon改成其他的吧，因为容易让人混淆。

assistant:
d7ea5a0：右上角管理入口的汉堡 icon 换成新画的 ManageListIcon（三行条目+右侧竖杆滑块的列表管理语义）。实现：HeaderOverride 加可选 menuIcon 字段（ReactNode），AppHeader 菜单位 fallback MenuIcon——聊天页等其它汉堡菜单使用方零改动；SkillPanel 传新 icon。后续演进：f472941 把整理/新建按钮行整个移除、管理入口挪到右上角 stackOverride showMenu；6234e08 又给 SkillDetail 加了侧滑逐级上翻（BackHandler + goUpOrExit）。

user:
聊天详情页的技能详情右上角跳转 icon 不稳定，移除；技能管理页 ⋮ 菜单的「编辑」也移除，点技能本来就能进编辑。

assistant:
两处精简：① SkillPanelScreen 移除右上角 ManageListIcon 管理入口（stackOverride.showMenu+menuIcon 整个 useEffect 删掉，连带 useHeaderContext/ManageListIcon 导入）——不稳定根源是它和 SkillDetail 的 stackOverride 清理时序打架，跳转 icon 会时隐时现泄漏到详情页；管理页仍可从设置进入。② SkillsSettingsScreen ⋮ 菜单移除「编辑」项（handleMenuSelect 的 case 'edit' 一并删，项目域 splice 插入位从 3/4 改 2/3），菜单变为：导出 ZIP/导入 ZIP/[复制到其他项目…/提升为全局]/删除。typecheck 干净，skill-panel 测试 + session 文件管理器集成回归（6/6）通过。

user:
skill opt 工具改名 skill 吧，顺便给我看看当前工具的 schema。

assistant:
功能未发版无存量数据，直接全量替换 skill_opt→skill（136 处，sed 一次性覆盖 core src/test + cli + desktop + mobile，含注释）。关键落点：skill-tool.ts 的 SKILL_TOOL_NAME、skill-tool-ref.ts（core/cli/desktop/mobile 四处本地同名常量）、build-tool-result-block.ts 的 name === "skill"、agent-tool-catalog 第 8 条（label/description 同步）。core rebuild 后 2005 全绿；desktop typecheck+全量测试、mobile typecheck + message-blocks(32)/tool-policy-picker/skill-panel/vfs session 回归全过。注意 mobile message-blocks 测试是 .ts 后缀，jest glob 别写 .tsx。

user:
「跨域复制（复制到其他项目）」和「提升为全局」两个能力整个移除，desktop 侧由子代理拆，core/mobile 主代理并行处理，不要切分支不要 commit。

assistant:
desktop 侧整链拆除（两能力底层都是 core 的 copySkill，desktop 引用清零）：① handlers/skills.ts 删 handleSkillsCopy/handleSkillsPromote 及 SkillsCopyRequest/SkillsPromoteRequest 导入；② handler-registry.ts 删对应 import+bindReq；③ shared/ipc-types.ts 删 SKILLS_COPY/SKILLS_PROMOTE channel 与两个请求类型（SKILL_EXISTS 错误码随之消亡）；④ invoke-registry.ts/client.ts 删 ipcSkillsCopy/ipcSkillsPromote；⑤ SkillsManageView.tsx 删三个菜单项（复制到项目/复制到其他项目/提升为全局）、copyTarget/promoteConfirm 状态、PickerModal 目标选择弹窗与覆盖确认 ConfirmModal，PickerModal import 一并清（导出/导入 ZIP、删除、编辑未动，preload 是通用 invoke 透传无需改）；⑥ test/skills-handlers.test.ts 删 promote/copy 用例，delete 用例改用 write 造数据。typecheck 干净（core copySkill 尚未移除也不影响），skills-handlers 测试 7/7 过。

user:
skill 工具加 load action（与 read 分语义层）；load 与 $ 引用共享 seen；跨域复制（复制到其他项目/提升为全局）UI 和整条链路全部移除（用的少，且 skill 无 checkpoint 版本管理，要保险）。

assistant:
分三块落地：① core 加 load：读生效副本 SKILL.md 全文 + files 附属文件清单（不含 SKILL.md，来自 SkillListItem.files），无域/路径/分页参数；seen 双向共享——方向 A（$ 已附全文→load 回短提示）：BuiltinToolSkillsContext 加 referencedNames 可变集合，assembleSkillsToolContext 建集合、agent-runner 每步 prepare 后扫 visible 附件回填；方向 B（load 已发生→后续 $ 短提示）：prepareUserMessagesForPrompt 入口扫可见 assistant 的 skill tool_use(action=load) 预填 seen，read 不预填（可能截断）。压缩/置位隐藏后随可见窗口自动重置。② 跨域复制整链移除：core SkillService.copySkill（port+impl+测试）、desktop SKILLS_COPY/SKILLS_PROMOTE IPC 通道与 SkillsManageView 菜单（子代理完成）、mobile SkillsSettingsScreen 的 confirmPromote/runCopy/copyContext/copyTargetProjects/菜单项/弹层。③ 摘要/跳转：buildToolResultBlock 加 load 分支（domain:name · n files / 已在提示词中），skill-tool-ref 的 REF_ACTIONS 与输出解析加 load。core 2010 全绿，desktop typecheck 干净 + 328/328（--test-concurrency=1 单并发 72s），mobile typecheck + 42/42。

坑：desktop 全量测试在高负载机器（opencode+llama-server 抢 CPU）并发模式会雪崩到数分钟，单并发 --test-concurrency=1 稳定，以后全量都带。另：本会话中 skill-tool.ts 与 SkillsSettingsScreen.tsx 两次被并行进程（疑似 opencode 会话/编辑器旧缓冲）写回旧内容——改完立刻提交 + 提交前全仓 grep 防脏写。

user:
跨域复制未来要加回来的时候，可以参考 git 历史吧？

assistant:
可以，但别直接 revert 0bc2152（它是 load 新增+复制移除的混合提交，revert 会连带回滚 load）。正确挖法：git show 0bc2152 看删除侧 hunks——copySkill 的 port/impl（事务内 sweepRevisionsUnderScope + copyVfsTree + seedLiveHeadRevisions 整包覆盖）、desktop SKILLS_COPY/SKILLS_PROMOTE 通道、mobile confirmPromote/runCopy/弹层，按需重新应用；设计意图看 docs/Iterations/agent-skills/spec.md 与本记忆文件。

user:
skill 列表 UI 上所有「X/Y 启用」文本移除（实时性差、没用），「全局技能（M）/项目技能（N）」tab 计数也一并移除。

assistant:
四处清理：mobile SessionDetailScreen 技能卡的 n/m 启用（state+load 里的 effectiveSkills 汇总一并删，卡片值改「查看与管理」）；desktop SessionDetailDrawer 的技能 n/m 启用（连带 skill-ui.ts 的 skillEnableSummary 删除、ipcSkillsEffective/EffectiveSkillDto 导入清理，卡片值改「查看与管理」）；mobile/desktop 技能管理页 SegmentedControl tab label 的计数后缀全部去掉，只留「全局技能/项目技能」。desktop tsc 干净 + skills-handlers 测试过，mobile tsc 干净 + skill-panel/session 回归过。本轮 SkillsSettingsScreen 第三次被并行进程写回 copySkill 旧代码，再清后立即提交。

user:
mobile 的技能管理入口还有「项目 XX · 全局 YY」计数。

assistant:
漏网之鱼在 ProfileTabScreen（设置 tab）：技能管理入口行的 value 文案「项目 N · 全局 M」，refreshSkillsLabel 每次聚焦 listSkills 全局 + 逐项目各查一次（性能差根源）。整链删除：state/refresh 函数/useFocusEffect 调用/入口行 value 条件传参。教训：上一轮只扫了 SkillsSettingsScreen/SkillsManageView/SessionDetail* 三处，没扫设置入口页（ProfileTabScreen）；双端 skill 相关文案清理应全仓 grep「全局.*\${|项目.*\${」而不是只盯已知文件。

user:
技能管理 ⋮ 菜单移除「导入 ZIP」，导入功能挪进新建弹窗：导入后自动预填技能名与描述（可改），创建后就是导入的技能。这样设计更好。

assistant:
mobile 落地：① core 新增 previewSkillZip（public/skills 导出）——parseVfsZip+parseSkillFrontMatter 复用，返回 name/description/skillMd 全文/fileCount/valid，约定 zip 根即技能目录（本产品导出格式），嵌套目录返回 skillMd=null；② vfs-zip.service 导出 pickZipFileBytes（选 zip+读字节，取消返回 null），importVfsZip 复用之；③ NewSkillModal：标题下「从 ZIP 导入…」按钮 → 预检 → 预填 name/description（可改），已导入态显示「已导入 ZIP · N 个文件（创建后全部带入）」+移除；创建分支：zipSvc.import 整包落入 /meta/skills/{name}（新目录为空无覆盖风险），表单值与 zip 元数据不一致时重写 SKILL.md front matter（withFrontMatterValues：保留其余键与正文，YAML 双引号标量）；④ SkillsSettingsScreen ⋮ 菜单删「导入 ZIP」项+case+runSkillZipImport，zipScopeFor 保留（导出仍用）。core 新测试 4/4，mobile typecheck 干净+回归过。desktop 未动（⋮ 菜单仍有导入 ZIP，新建弹窗无导入），待用户确认是否对齐。

user:
把 mobile 已落地的「技能 ZIP 导入并入新建弹窗」同步到 desktop（参考 9a04dee）。

assistant:
desktop 落地（上一条的续）：① 文件选择走新 IPC 通道——VFS_ZIP_PICK（nm:vfs/zipPick，bindNoArg，主进程 dialog.showOpenDialog 选 zip 读字节回传，取消返回 null）+ VFS_ZIP_IMPORT_BYTES（nm:vfs/zipImportBytes，字节直写不弹框）；vfs-zip.service 拆出 pickVfsZipBytesWithDialog/importVfsZipBytes，旧 importVfsZipWithDialog 复用两者；② NewSkillModal 加「从 ZIP 导入…」：pick→previewSkillZip（renderer 纯函数）→预填可改→创建时 importBytes 整包落 /meta/skills/{name}+表单值不一致时 withFrontMatterValues 重写 front matter（yamlScalar/withFrontMatterValues 落在 desktop skill-ui.ts）；③ SkillsManageView 无需移除——desktop ⋮ 菜单从未有过「导入 ZIP」（c4dae36 建页时就只有编辑/删除，App.tsx 的导入 ZIP 是 workspace 通用菜单），mobile 侧移除项在 desktop 无对应物；④ eslint 禁 renderer 直接 import core，新建 shared/logic/skills.ts 薄转发 previewSkillZip/SKILL_NAME_PATTERN，顺带把 skill-ui.ts 存量违规 import 一并改走转发。测试 skill-zip-import.test.tsx 8/8（handler 整包落盘+非法 zip 拒绝+front matter 重写+弹窗渲染）；desktop typecheck 干净。坑：VfsZipError 在 formatIpcError 无专门分支，code 落 err.name（"VfsZipError"）而非 INVALID_ZIP，断言按现状写。

user:
desktop 也同步导入并入新建弹窗；另外给智能体配置的 skill 块加总开关，默认开启，关闭后关闭 skill 注入并移除 skill 工具注册——给用户完全控制。

assistant:
两件事：① desktop 导入并入新建（子代理完成）：新 IPC 通道 VFS_ZIP_PICK（弹框选 zip 回传字节到 renderer）+ VFS_ZIP_IMPORT_BYTES（字节直写目标子树），previewSkillZip 在 renderer 跑，NewSkillModal 加「从 ZIP 导入…」，withFrontMatterValues/yamlScalar 落 desktop skill-ui；desktop ⋮ 菜单本来就没有导入项（mobile 那轮的移除无对应物）。② 技能总开关 skillsEnabled：AgentPromptLayout 加可选字段（缺省 true，wire 关=显式 false，照 customAttach 的 omit-when-on 模式）；关键设计——resolveAgentToolRegistry 里 skillsEnabled===false 时照 task 强制移除先例 delete("skill")，D4 联动自动串起一切（registry 无 skill → assembleSkillsToolContext 返回 undefined → toolCtx.skills 缺席 → skillsIndex 置空 → LLM 看不到工具）；$ 引用不受影响（deps.skills 独立于 toolCtx.skills，与 D4 deny 语义一致）。双端 agent 编辑器技能卡加 Switch（mobile chatSlotHeader 右侧 / desktop 卡头右侧），skillsReadonlyHint 文案更新（「不可关闭」不再成立）。测试：T-SK13（开关强制移除/缺省保留）+ 文案断言更新，core 2015 全绿。

assistant:
（补坑）python 文本模式改文件把 AgentEditorView/AgentEditorForm/agent-editor-state 三个 CRLF 文件洗成 LF，提交出现全文件假 diff（+3360/-3279）——file 命令看行尾即知。修复：二进制模式 LF→CRLF 转回 + git commit --amend。教训：**改 CRLF 文件禁用 python open() 文本模式，用 'rb'/'wb' 或 edit_file 工具**；提交前看 diff --stat 行数对称异常即行尾问题。

user:
skill 块描述精简、关闭时不显示；开关打开时出现输入框——作用是 skill 索引前缀语（如「当前支持的skill如下：」），参考会话区模式。常驻工作区默认文本改成「我看到工作区了」。

assistant:
三改：① DEFAULT_WORKPLACE_ASSISTANT_TEXT 从 "i have seen workplace" 改为「我看到工作区了」（WORKPLACE_BLOCK_HINT 文案同步，测试断言更新——test 多用常量引用所以只改两处硬编码）。② 新增 prompts.skillsPrefix（索引前缀语）：模型层 AgentPromptLayout + validate + wire schema（trim 非空，omit-when-default）；渲染层 formatSkillsIndexBody(entries, prefix?) 头行用 layout.skillsPrefix ?? DEFAULT_SKILLS_INDEX_PREFIX（常量=原默认头行文案），synthetic 消息与 segment 两处消费，三端预览走 buildPromptLlmInputFromLayout(layout) 自动生效无需改；渲染层补双保险——skillsEnabled===false 时即便 ctx 携带 skillsIndex 也不注入。③ 编辑器：skillsPrefixText 表单字段（definitionToForm 缺省回填默认前缀；layoutFromFormInput 等于默认/空/开关关时 omit），双端技能卡=header Switch + 开时（精简 hint + 前缀输入框 mobile TextInput/desktop textarea），关时 hint 整体不显示。skillsReadonlyHint 精简为「运行时注入生效技能索引；关闭后不注入索引且不注册 skill 工具（正文 $ 引用不受影响）。」。core 2018 全绿（+3 前缀测试）。

坑（更新）：并行进程本轮第 4/5 次脏写 agent-editor-state.ts（skillsPrefix patch 被洗，用 edit_file 重做）；且发现 edit_file 对 CRLF 文件写出 LF（AgentEditorForm 被 edit 后行尾变 LF）——CRLF 文件 edit 后必须检查 file 命令 + 必要时二进制转回，否则全文件假 diff。

user:
skill 区样式和会话区不一样，尤其输入框。

assistant:
差异根源在 mobile：技能区前缀输入框上轮用了裸 TextInput + 自定义 skillsPrefixInput 样式，而会话区（customAttach）是 FormField label + FormTextInput 统一表单控件。改为同款 FormField+FormTextInput（multiline，placeholder=默认前缀），删自定义样式；desktop 本就是 SettingsField+textarea 与会话区同款，未动。教训：区块内输入控件一律复用 FormField/FormTextInput（mobile）或 SettingsField（desktop），别为省事裸写。
