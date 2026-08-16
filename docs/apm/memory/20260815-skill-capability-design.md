---
date: 2026-08-16 00:10
title: skill 能力设计→原型→PRD：meta/skills 两域方案与 mobile 交互拍板
keywords: skill, SKILL.md, VFS scope, meta/skills, 提示词注入, 技能管理页, UI 原型, PRD
abstract: 用户要给应用加 skill 能力（类 AI IDE SKILL.md）。已拍板：VFS global+project 两域 meta/skills/ 目录式存储（SKILL.md 入口+辅助文件），不进 session 复制链，AI 对两域技能均可读写，负清单启停，同名 project 覆盖 global；mobile 原型已在 worktree feat/skill-ui-prototype 完成。PRD 已定稿（含 $ 引用、skill_opt 工具、提示词配置/预览体现），SPEC 已落盘 docs/Iterations/agent-skills/spec.md，待用户确认。
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
