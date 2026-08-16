---
date: 2026-08-15 05:30
title: skill 能力设计探索——global+project 两域存储与 UI 挂点结论
keywords: skill, SKILL.md, VFS scope, 提示词注入, 设置管理页, brain-storm
abstract: 用户想给应用加 skill 能力（类 AI IDE 的 SKILL.md）。第一轮定下存储（VFS global+project 两域）与注入（索引常驻+工具按需）方案；第二轮澄清真正难点是 agent 编辑 skill 的能力与会话隔离的冲突，补探索后拍板方向：skill 放 .agents/skills/ 约定目录（project/global scope、不进 session 复制链），agent 编辑走专用 skill 工具（默认写 project、global 留给用户 UI 编辑），skill 写入显式脱离 session checkpoint 回滚体系。
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
不不不，我纠结的会话隔离难点是智能体编辑 skill 文件的能力。skill 放哪还没想好——是否像 IDE 一样放 .agents/skill 目录？而且由于会话隔离，agent 根本无法编辑 global，这才是我纠结的地方。

assistant:
补派一轮聚焦探索（VFS 写路径 + checkpoint 的 scope 交互），关键事实与结论：

1. agent 的 write/edit 工具走 toolCtx.vfs，是 session scope 钉死的单实例（run-agent-turn.ts L440 装配 sessionVfs），工具层没有按路径路由 scope 的先例；用户编辑链 executeOp 同样是 session scope。
2. checkpoint/回滚硬编码 session scope：listSessionFileHeads 只扫 session scopeKey，message-rollback 的 resolveRollbackPlan 硬编码 {kind:"session"}。project 写入会被静默漏掉（不报错但不进撤销体系）。版本链本身 per-scope（entry 属于 scope_key+path），project scope 写入依然有乐观锁和 append-only revision 保护。
3. copyVfsTree/copyScope 无过滤参数，replaceVfsSubtree 先删后拷：skill 若留在 session，re-pull/置位会被全量冲掉。
4. 拍板方向：skill 放 .agents/skills/{name}/SKILL.md 于 project/global 两域（core/apps 零引用、全新命名空间）；不进 session 复制链（需给复制加排除，成本是分段复制或暂存恢复）；agent 编辑走专用 skill 工具（内部 createScopedVfsService 按 project/global 建实例），默认写 project、global 编辑权留给用户 UI——skill 写入脱离 session 回滚是显式设计（跨会话资产不应被会话回滚卷走）；并发冲突靠 VFS 乐观锁（expectedVersion CONFLICT）兜底。write/edit 普通工具对 .agents/skills/ 前缀应显式拒绝，避免模型绕过专用工具造成「session 假真源」。

未验证：mobile runtime 装配（推测与 desktop/cli 一致）；分段复制排除的具体实现成本。

user:
那 UI 怎么设计？skill 不在 session 域，很难复用现有聊天工作区吧？还有既然都是专用工具了，还有必要放 .agents 目录吗？感觉可以放到之前保留的 meta 目录。

assistant:
又补两路探索（meta 目录现状、vfsScope/文件卡片链路），关键事实与结论：

1. meta 目录是死约定：只在 chat-project-vfs 迭代文档里出现（spec 明说首期仅路径约定不建表），代码里零存在——没有常量、没有复制排除、没有 UI 入口。放 meta 下不省任何接线，还有语义冲突（meta 的既定定位是 project/session 元数据）。目录名是品味决定不是技术决定，两成本完全一样；维持 .agents/skills/（对齐 AI IDE 心智）。
2. 新发现：projectTemplatePull（global→project）也是整树先删后拷——复制排除要做两处（pull 链 + session 初始化链），上一轮只强调了后者。
3. 文件卡片链路现状：ToolResultBlock.meta 实际只有 subagentSessionId/failureReason，没有持久化 vfsScope（RULE.md 的 vfsScope 描述与当前代码不符，待核实）；FILE_OPEN_TOOL_NAMES 只认 read/write/edit，skill 工具卡片默认不可点；两端卡片回调签名都是 (path) 单参、scope 硬编码（mobile 固定 session，desktop 固定 chat panel）。
4. UI 设计拍板：三层分工——浏览零成本（mobile 项目工作区 tab 和 desktop 会话视图树本来就是 project 域，skill 目录自然出现；desktop 的 'session' panel 实际映射 core project 域，命名错位但可用）；聊天卡片跳转需四处线性小改（ToolResultBlock.meta 加 scope、FILE_OPEN_TOOL_NAMES 扩入 skill 工具名、两端回调加 scope 参数、mobile webview openToolFile 消息加字段）；设置管理页照 agent 管理骨架做目录视图，mobile 跳 FileEditorScreen(scopeKind)、desktop 设置内页内栈 push 编辑视图。

user:
不是，用户也只能看当前工作区内容啊。你没懂我 UI 设计的难点。我提 meta 是因为 .agents 在 novel-master 没意义——每个 session 隔离，skill 放进会话工作区改完只在本 session 生效。除非放到不同的地方，与现有工作区隔离。

assistant:
第三轮澄清后明确真正难点：用户心智锚在会话工作区（用户可见可改的是 session 域内容），skill 必须跨会话共享就得活在会话之外，隔离后会话内不可见——可见性设计才是核心。拍板设计：

1. 呈现与存储分离：存储仍用 VFS project/global 域（白拿编辑器/版本链/乐观锁），但呈现上 skill 不以「文件」身份见人，以「会话可用的能力」身份走专属入口；工作区树对 meta/ 默认 hidden（补 workplace 默认目录规则），避免用户误当工作区内容、也避免误编 session 副本。
2. 同意目录改用 meta/skills/：专属入口后目录名用户几乎不可见，novel-master 自有约定比借用 IDE 的 .agents 语义更干净（meta 在 chat-project-vfs 文档里本就是预留的元数据落点）。
3. 三层入口：会话内技能面板（agent/模型选择器同层，发现+开关+跳编辑，mobile 走 stack screen、desktop 走会话头部入口）+ 聊天工具卡片跳转（上一轮的四处小改）+ 设置管理页（agent 管理骨架，列表+域徽标+开关，编辑跳 scope 编辑器）。
4. 事实再澄清：skill 工具写的就是 project 域，不存在「只在本 session 生效」；那个风险只在 skill 出现在 session 树里才成立，所以隔离是对的。

user:
所以 AI 还是可以编辑更改 skill？用户也能方便的管理和编辑 skill？要设计就设计完整，不要说 v1v2。我需要知道 skill 的启用和关闭怎么设计、怎么区分全局和项目。

assistant:
第四轮给出完整设计定稿（无 v1/v2 分期）：

1. 权限矩阵：AI 经 skill 工具对 project 域完整读写删（list/read/create/update/delete），对 global 域只读（read 生效版本可读，update 报错引导 create 同名 project 覆盖，显式不隐式）；禁用/启用/删除全局提升等管理动作不给 AI，只能在回复里建议。用户三入口：会话面板（合并解析列表+开关+跳编辑）、设置管理页（项目/全局分区两段列表+域转换）、聊天卡片（按 scope 跳编辑器）。
2. 启用/关闭：负清单设计——新建 skill 零配置默认启用；禁用 = 在对应域写一行禁用记录（skill_state 表，scope_key + skill_name 主键，照 workplace 规则表模式）。开关不进 front matter（AI 改文件不碰状态）、不进 session KKV（避开压缩/置位清理）。开关是项目/全局级不是会话级——会话级细腻需求由「索引+模型自选」天然兑底。
3. 解析算法：生效版本 = project 副本 ?? global 版本（同名覆盖）；禁用判定 = project 域有禁用行→禁；生效域为 global 时再看 global 域禁用行。推论：项目副本不受全局下架影响；「全局默认关、某项目开」用 project 副本覆盖表达，两态开关+覆盖副本=完整表达力，无需三态。
4. 域区分：存储靠 scope 本身（meta/skills/ 在 global/project 两域）；UI 靠徽标（全局/项目/项目覆盖全局）+管理页分「项目技能/全局技能」两段；域转换：「复制到项目」（本地化定制）/「提升为全局」（需确认，全局影响）；同名且 front matter name 与目录名不一致以目录名为准标警告。
5. front matter：name（显示名）+ description（索引+模型选择依据），缺 description/解析失败标 warn 不进索引；编辑器直接编 yaml 源文件，保存时校验。

user:
新建个 worktree，改 examples/mobile/index.html，我想看 UI 操作逻辑的实现效果，UI 交互对我更重要。

assistant:
在 .woktree/skill-ui-prototype（分支 feat/skill-ui-prototype，基于 origin/main）实现了移动端交互原型，三入口全部落地：

1. 入口一·会话技能面板：会话操作抽屉新增「技能」项+摘要行（N/M 启用）；面板为合并解析后的生效列表（项目覆盖全局带橙色徽标、无效技能红标、每行开关），开关写项目域禁用记录（toast 说明不影响其他项目），点行进编辑器。
2. 入口二·技能管理页（我的→技能管理）：项目/全局两段库存，各自批量管理+新建；全局被同名项目副本覆盖时标「被项目副本覆盖」；⋮ 菜单：编辑/复制到项目（全局→项目）/提升为全局（带覆盖确认）/删除；新建弹窗含名称/描述/域分段选择器（域选择带 AI 权限提示）。
3. 入口三·聊天工具卡片：聊天流里新增 skill create 成功卡（可点，跳编辑器）和 skill update 全局被拒卡（展示 AI 权限边界）+ AI 解释消息。
4. 编辑器复用 fileEditorPage：标题变「技能 · name」，工具栏域徽标（项目域·AI 可编辑 / 全局域·AI 只读），正文为 front matter 源文件。
5. 冒烟测试（linkedom，22 项全过）验证三入口、覆盖解析、禁用、新建、域转换链路。

user:
有个问题：skill 规范支持 reference 等其他文件，不只有一个 SKILL.md，它不是简单 snippet——这也是我想要项目工作区/文件浏览器的另一个原因。

assistant:
承认遇漏并修正：skill = 目录（SKILL.md 入口 + references/ 等辅助文件），存储设计本就是目录所以不动，但 UI 需要加一层。原型更新：

1. 数据模型改为 files 数组（path + content），SKILL.md 的 front matter 含 name/description；mock 数据给 chinese-narrative（项目）挂 references/character-quirks.md、worldbuilding-qa 挂 checklist/contradiction-checklist.md、plot-consistency（全局）挂 references/timeline.md，SKILL.md 正文内用相对路径链接引用它们。
2. 新增技能详情页（skillDetailPage）：行点击（面板/管理页/聊天卡片）先进详情看目录内容，再点具体文件进编辑器；编辑器标题「技能 · name」+ 路径 chip（meta/skills/name/path）+ 域徽标。
3. 详情页支持新建文件（路径可含子目录，SKILL.md 保留名禁止）与删除（入口文件不可删）；保存按钮回写 files 内容。
4. 对 core 设计的推论：skill 工具 read 返回 SKILL.md 全文 + 辅助文件清单，模型再按需读单个文件；复制/提升为全局 = 整目录拷贝；会话技能面板与索引仍只看 SKILL.md 的 front matter，辅助文件不进索引。

user:
测试没必要，只改 demo 文件。另外这个文件浏览还不如复用文件浏览器呢。还有 agent 可以改 global，没什么不能改的，没必要限制。

assistant:
三点修正全部落地（并删掉了 smoke-test.cjs，验证改为内联一次性脚本不留文件）：

1. 技能详情页改为复用现成 vfs-browser：注册 skillDetail 伪 scope（VFS_SCOPE_ROOT/vfsNavState 加 '/'），打开技能时 syncSkillDetailCatalog 把 files 数组同步成目录树喂给现成渲染器——上导航、目录进入、⋯ 更多菜单、⋯ 新建文件、行单击/双击打开全部复用现有交互；skillFile 条目在状态栏标「入口文件/技能辅助文件 + 行数」，不显示纳入规则徽标；⋯ 行菜单只留打开/删除（SKILL.md 不可删）；⋯ 面板菜单只留新建文件。
2. AI 权限限制全面移除：聊天卡片的「update 全局被拒」改为成功卡（全局域写入成功、对所有项目生效），编辑器域徽标文案改为「项目域 · 仅本项目生效 / 全局域 · 所有项目生效」，新建弹窗 hint 改为「两个域 AI 都可读写」。设计层面拍板：AI 对 project/global 两域技能文件均有读写权限，不再设全局只读限制。
3. 内联验证 9 项全过：详情页激活、vfs-browser 复用渲染、SKILL.md 置顶、子目录导航、单击进编辑器、路径 chip、域徽标文案、全局卡片跳详情。

user:
skill 设置的项目技能段应展示所有项目的技能——从「我的」进入时没有当前项目语境，语义上也不应该只展示当前项目。

assistant:
拍板并落地：管理页与会话面板的视角分离——管理页（全局语境）按项目分组展示所有项目的技能；会话面板仍是当前项目+全局的合并解析视图。原型更新：

1. 数据模型改为 skillCatalog.projects（按 projectId 字典，mock 给 novel-2 历史小说加了 dynasty-etiquette 技能含 references 辅助文件）+ skillCatalog.global；skillDisabled 也按项目分组（projects 字典）。
2. 管理页项目段：按 MOCK_PROJECTS 分组渲染，每组带📚分组头（项目名），行引用 data-id/open/menu 改为 project|pid|name 三段载荷；计数为跨项目总数（如「3 · 2 个项目」）。
3. 上下文语义：详情页标题/编辑器域徽标显式带项目名（「项目域 · 历史小说」）；新建弹窗项目域时出现「所属项目」下拉（预选当前项目，全局域时隐藏）；复制到项目/其他项目用项目选择底部弹层（排除源项目）；删除确认文案带项目名。
4. 会话面板、聊天卡片等会话语径仍默认 currentProjectId（findSkill 第三参缺省）；跨项目场景（管理页点击）显式传 pid。
5. 内联验证 15 项全过：分组渲染、跨项目详情/徽标、项目选择弹层排除源项目、新建下拉、全局复制到指定项目、会话面板不混入其他项目技能。

user:
全局技能和项目技能做成双 tab，不要纵向排列。

assistant:
已改：管理页顶部改为双 Tab（复用 chat-top-tabs 样式，全局在前项目在后，默认全局 tab），计数内嵌在 tab 文案里，两个面板各带自己的 manage-header（管理/新建/批量删除）。细节：底部 hint 随 tab 切换文案（全局 tab 提示同名覆盖规则）；批量模式中切 tab 自动退出；新建按钮显式 hint 优先、否则默认当前 tab 域；顺手清掉全局新建按钮上误留的 data-skill-domain-opt。内联验证 12 项全过。

后续补改（用户指出只改了标题不够）：全局优先贯穿所有相关处——新建弹窗存储域分段全局在前且默认全局（默认域跟随当前 tab，显式 hint 优先；会话面板新建仍默认项目域因有当前项目语境）、弹窗 hint 文案全局在前、默认 newSkillDomain='global'。修 bug：上轮换 tab 顺序时只改了面板 id 没换内容，导致 skillsTabPanelGlobal 里装的是项目内容（面板错位，已有验证未覆盖内容归属而漏网），已修正。内联验证 13 项全过（含面板内容归属、新建默认域链路）。教训：验证要断言容器内容归属而不止 active 类切换。
