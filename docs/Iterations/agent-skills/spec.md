---
date: 2026-08-16
---

# Agent Skills（技能能力）技术规格（SPEC）

> 需求文档：`docs/Iterations/agent-skills/prd.md`
> 依赖前置：`vfs-unified-root`、`chat-project-vfs`、`agent-subagent`
> 交互原型：`.woktree/skill-ui-prototype`（分支 `feat/skill-ui-prototype`，`examples/mobile/`，仅作交互参照，主仓无半成品可接）

## 设计目标

按 PRD 交付 skill 能力全链路：两域存储（`meta/skills/`）、隔离豁免（不进两条复制链）、`skill_opt` 单工具、提示词常驻索引与配置/预览体现、负清单启停、`$` 引用（去重语义同 `@`）、双端管理 UI（会话面板 / 设置管理页 / 详情 / 编辑器 / 聊天卡片）。

本 SPEC 基于 2026-08-16 三路代码探索（core 存储与数据层、工具与提示词层、双端 UI 集成点）+ 本会话前序探索（`@` 引用链路、提示词配置 UI），所有变更点可追溯至探索报告证据。

## 总体方案

### 存储模型

- **技能文件 = VFS 文件**：global / project 两域的 `/meta/skills/{name}/SKILL.md` 及辅助文件，直接存 `vfs_entry`（逻辑路径无 `/template` 前缀，`assertLogicalPathAllowed` 对 `meta/` 无限制，已核实）。读写走 `ScopedVfsService` → `RevisionAwareVfsService`，天然有版本链（同文短路、乐观锁、墓碑）。
- **禁用负清单 = 独立表** `skill_disabled_rule`（照 `workplace_dir_rule` 模式）：`scope_key TEXT NOT NULL + skill_name TEXT NOT NULL` 复合主键 + `idx_skill_disabled_scope` 索引。`scope_key` 取 `project:{pid}`（PRD 拍板：面板开关只写当前项目禁用记录；全局域禁用行本期无 UI 写入路径，表结构预留）。**不用 KKV**（`service/kkv` 注释明确非公共 API；session KKV domain 是受限常量集）。
- **front matter 解析复用**：`splitMarkdownFrontMatter`（`domain/workplace/logic/front-matter.ts`）+ `parseText(source, "yaml")`（`infra/serialization`）+ zod strict object（照 `agent-definition.schema.ts` 模式）。`yaml@^2.8.2` 已是 core 依赖，无新依赖。
- **技能名字符集（`SKILL_NAME_PATTERN`）**：排除式定义——不得包含空白字符与 `/`、不得以 `.` 开头、不得为保留名 `SKILL.md`（大小写不敏感）。三处引用同一常量（`domain/skills/model/skill-name.ts` 导出，避免口径漂移）：新建校验（双端新建弹窗 + `SkillService.writeSkillFile`）、`$` token 正则、`$` 扫描正则。
- **checkpoint 边界（明确语义）**：`DefaultMessageCheckpointService.capture` 只扫 session scopeKey，skill 写入产生的 revision **不进任何消息 checkpoint**，消息级回滚不会回滚技能写入。这是有意的（技能是长存数据，与 PRD「AI 写入→用户经卡片追改」模型自洽）。

### 隔离豁免（复制链排除）

`replaceVfsSubtree`（`domain/vfs/logic/vfs-tree-copy.ts`）是两条链的公共底座，现状 `CopyVfsTreeOptions` 只有 `mapPath` / `contentStore`。方案：`CopyVfsTreeOptions` / `ReplaceVfsSubtreeOptions` 增加可选 `excludePrefixes: string[]`，**三处同步生效**：

1. **删除侧**：目标 scope 整根替换前，`meta/skills/` 前缀下的 entry 不删、revision 不 sweep（保护 project 域已有技能）；
2. **拷贝侧**：源 scope 拷贝时跳过 `meta/skills/` 前缀（global 技能不随模板同步镜像到 project）；
3. **seed 侧**：`seedLiveHeadRevisionsUnderPrefix` 随 `excludePrefixes` 一并跳过（防御性对齐，非正确性必需——该函数自带存在性跳过；head revision 意外缺失时 seed 补种是自愈路径）。

两条链调用处传入 `excludePrefixes: ["meta/skills"]`：

- 链 A `DefaultTemplatePullService.projectTemplatePull`（`template-pull.service.ts:26-49`）
- 链 B `initializeSessionWorkspace`（`initialize-session-workspace.ts:25-52`，调用方 `session.create` 与 `sessionTemplatePull` 自动继承）

**设计决策 D1（探索报告未定点，SPEC 拍板）**：`project.service.ts` 的项目复制（project→project `copyVfsTree`）**不排除** `meta/skills/`——项目复制是用户显式操作，项目域技能随项目走符合预期；对应 `skill_disabled_rule` 行按 scope_key 一并复制。`message.service.ts` fork 与 `session.service.ts` copy 是 session 域内操作，session 域本就不该有 skills（链 B 拷贝侧已挡），无需改动。

### SkillService（core 新服务）

`service/skills/` 新建聚合服务，端口 `SkillServicePort`：

- `listSkills(scope: 'global' | { projectId })` → 技能清单（含 files 路径、front matter 元数据、有效性）
- `effectiveSkills(projectId)` → 合并视图（global ∪ project、同名项目覆盖、剔除禁用与无效），供索引预算 / `$` 候选 / 面板
- `readSkillFile(domain, name, path?)` / `writeSkillFile(...)` / `editSkillFile(...)`（edit 复用 `normalize-for-match` 语义，同 edit 工具）
- `setDisabled(projectId, name, disabled)`（负清单读写）
- `copySkill(from, to)` / `deleteSkill(domain, name)`（整目录，UI 与 `skill_opt.write` 共用底层）
- 实现：内部持 `globalVfs` / `projectVfs(pid)` 工厂闭包（对齐 runtime 惰性工厂风格），列出 `/meta/skills/` 前缀后逐技能解析 front matter。

**三端 runtime 装配**（同构改三处）：`apps/mobile/src/runtime/create-mobile-runtime.ts`、`apps/desktop/src/main/runtime/create-desktop-runtime.ts`、`apps/cli/src/runtime.ts` 各暴露 `skills()` 惰性工厂；接口加进 `MobileNovelMasterRuntime` / desktop runtime / `NovelMasterRuntime`。

### skill_opt 工具

新文件 `domain/tool/builtin/skill-tool.ts`，注册进 `register-builtin-tools.ts`：

- **形态**：单工具多 action 分发 + 扁平显式字段（照 `fs` 工具先例）：`action: 'read' | 'write' | 'edit' | 'list'`、`name`、`domain?: 'global' | 'project'`、`path?`（相对技能目录，默认 `SKILL.md`）、`content?`。`path` 校验禁 `..`（复用 `assertLogicalPathAllowed` 同款思路）。
- **可配置（与 task 同机制）**：`registerBuiltinTools` 注册后，probe 驱动的 `validateAgentToolPolicy` 与双端运行时 `resolveAgentToolRegistry` 自动认识 `skill_opt`，`tools.allow/deny: ["skill_opt"]` 直接生效（无静态白名单常量，探索已核实）；`BUILTIN_TOOL_CATALOG` 加条目 `{name: "skill_opt", label, description}`，双端 `ToolPolicyPicker` 自动出现、计数自动变 8（catalog 与注册表是手工同步关系，两边必须同改）。同步三处写死文案「未配置时使用全部内置工具（7 个）…」→ 8 个：desktop `AgentDefinitionEditorForm.tsx` L619、`AgentEditorView.tsx` L750、mobile `AgentEditorForm.tsx` L843；双端 `tool-policy-picker.test` 的硬编码数字（7）同步更新。⚠️ 注意：`agent-subagent` PRD L162「task 不进 catalog / 白名单常量」的描述已过时（当前代码 task 就在 catalog 首条，`subagentCallable` 已废弃改 `mode` 控制），以代码为准。
- **与索引注入联动（SPEC 拍板 D4）**：agent 的 policy 禁用 `skill_opt` 时，其 run 不注入技能索引（`resolveAgentToolRegistry` 产物不含 `skill_opt` → `skillsIndex` 置空）；`$` 引用不受影响（注入全文不依赖工具）。主 agent 与子代理各自按自己的 policy 判定（子代理沿用子定义的 tools，不继承父，现状语义）。
- **description lambda**：照 `subagentTool.description` 先例，从 `ctx.skills.effective` 读装配期预算的清单拼文案（名称+描述）。求值时机 `toolsFromRegistry` 每 run 一次——**回合内启停不即时反映，与 task 工具现状一致，有意行为**。
- **ctx 注入**：`BuiltinToolContext` 加可选 `skills` 闭包（照 `subagent` 字段惯例）。`AgentTurnRuntimePort` 新增 `skills()` 工厂；`runAgentTurn`（主 agent，L440-530 装配区）与 `runChildAgent`（L627-631）**两个装配点都注入**。
- **设计决策 D2（SPEC 拍板）**：子代理同样注入技能索引与 `skill_opt`，清单按父会话 projectId 解析——与「子代理共享父工作区」语义一致。
- **权限**：两域读写无限制（PRD 拍板）；无 delete 动作（删除仅用户 UI）。跨域写不进消息 checkpoint（见存储模型）。
- **成功摘要**：`summarizeToolSuccess` 加 `skill_opt` 分支（read 行数 / write 域+路径 / edit 替换数 / list 条数）。

### 聊天卡片（skill_opt）

- 跳详情三元组（domain / projectId / name）：write / edit 必含于 tool_use input，照 `resolveVfsToolFilePath` 模式从 input 解析（新 `skill-tool-ref.ts`）；read 缺省域命中生效副本，由工具输出携带解析结果，`buildToolResultBlock` 照 `subagentSessionId` 自动检测透传进 `meta`。
- `ToolResultBlock.meta` 扩可选 `skillRef?: { domain: 'global' | 'project'; projectId?: string; name: string }`；同步 desktop `ContentBlockDto`（IPC DTO）、双端 `message-blocks.ts` 解析、**mobile WebView transcript 镜像**（`apps/mobile/src/web/chat-transcript/webview/runtime/util/` 的 `vfs-tool-path.ts` 同款镜像文件，漏了 transcript 内卡片不可点）。
- 卡片渲染：双端 `ToolCallCard` 加 `skill_opt` 专用样式（对齐原型 `tool-call--skill`：工具名 + 状态 + 摘要 + 「点卡片查看/编辑」提示行）。

### 提示词注入与配置/预览体现

- **上下文通道**：`PromptRenderContext` 加 `skillsIndex?: { name: string; description: string; domain: 'global' | 'project' }[]`（**预解析条目，render-prompt 保持纯函数无 IO**）。生产方：`agent-runner.run()`（`options.projectId` 现成，L293-300 构造 ctx 处补）与预览服务（desktop `prompt-preview.service.ts` / mobile 对应，props 已带 projectId）各调 `SkillService.effectiveSkills` 预算；预算时若 agent 的 resolve 后 registry 不含 `skill_opt`（D4），`skillsIndex` 置空。
- **拼装**：`render-prompt.ts` **两套遍历都要插**（漏一处违反 PRD 三方一致性验收）：`buildPromptAssemblyFromLayout` 在 system 段（L202-210）与 `appendWorkplacePairSegmentsIfPresent`（L212）之间插技能索引 segment；`buildPromptLlmInputFromLayout` 在 `appendWorkplacePairIfPresent`（L283）之前插合成消息。固定 id `prompt-skills` / title `skills`。`skillsIndex` 空/缺省不产生该段。
- **三区边界**：`computeLlmExportZonesFromLayout` 的 `persistCount` 计入技能索引段（`(skillsIndex?.length ? 1 : 0)`）。
- **文案**：`PROMPT_REGION_LABELS.layoutOrder` 改「系统 → 技能索引 → 常驻工作区 → 持久区 → 会话历史 → 动态区」；新增技能索引占位卡片文案键（照 `chatReadonlyHint` 模式：运行时自动注入、不可编辑不可关闭）；**同步 `agent-editor-state.test.ts` L51-54 精确断言**。
- **双端占位卡片**：desktop `AgentEditorView.tsx` 系统区与 `AgentWorkplaceBlockCard` 之间插 chat-slot 风格占位卡（无 Switch 无输入框）；mobile `AgentEditorForm.tsx` 对应位置插同款（模板：会话区 chatSlotCard 段去掉 customAttach 控件）。desktop `AgentDefinitionEditorForm.tsx` 现无引用（疑似遗留），**不改**，若后续接线再同步。
- **预览 label**：desktop `RealPromptPanel` 的 `segmentTitleLabel` 映射 + mobile `PromptPreviewSegmentCard` 标题映射各加 `skills` 条目（segment 从 core 单次遍历自动出现，三端预览免费生效）。

### `$` 引用

- **composer 参数化**：`packages/core/src/domain/chat/logic/composer-at-path.ts` 的 `findActiveAtQuery` / `replaceActiveAtWithToken` 等参数化触发字符（`trigger: '@' | '$'`），双端共享语义不复制；desktop / mobile 各自的 `ComposerAtPathInput` mention 呈现加 `$` trigger（mobile controlled-mentions 配置、desktop 高亮层正则）。
- **typeahead**：`$`（行首/空格/制表符边界）拉起技能 typeahead（≤5 条，按名称/描述模糊匹配），点选插 `$技能名` token 补尾空格。候选源 `SkillService.effectiveSkills(projectId)`——**不走 session 工作区 buildListRows**（技能不进复制链）。
- **选择器**：新 `SkillPicker`（平铺列表，非层级浏览器）：合并视图、同名标覆盖、无效不出现、已关闭可选但标关闭态（显式引用优先于负清单，PRD 拍板）。双端各一份，形态对齐 `FileReferencePicker` 弹层。
- **工具栏按钮**：双端 ChatComposer 工具栏 `@` 按钮旁加 `$` 按钮（mobile L630-635 区 / desktop L485-497 区）。
- **扫描**：新 `scan-skill-attachments.ts`（正则 `/(?<!\S)\$([^\s$/@]+)/g`——`$` 必须转义（字符类外是行尾锚，不转义恒匹配空），前导边界 `(?<!\S)` 一步到位（Node 22 / Electron Chromium / Hermes 均已支持 lookbehind，或等价实现）；token 形态 `$name`，name 字符集引用 `SKILL_NAME_PATTERN`，避免误吞 `a$b`、`$$b` 等正文片段）；`runAgentTurn` 发送编排扫描合并（照 `mergeAttachmentsWithScannedAtPaths` 模式，`attachmentDedupeKey` 加 `skillAttach` 分支返回 `skill:{name}`（与 seen key 同形），避免未来 chip/草稿态重复落库）；`resolveComposerSendIntent` 计入 `$` 附件（纯 `$技能` 无正文可发送）。
- **附件形态（schema 对齐）**：`messageAttachmentActionSchema` **扩枚举** `skillAttach`，附件落库为 `{ action: "skillAttach", source: "attach", type: "text", content: null, name: skillName, skillName }`——专用字段 `skillName: string`，**无 `path` 字段**。现有 `messageAttachmentSchema` 的 superRefine 要求带 action 的附件 `name === attachmentStorageName(path)`（path 空时为 `__no_path__`），与无 path 形态相撞，故 superRefine 加 `skillAttach` 分支跳过 path/name 规则（`skillName` 必填校验在该分支内做；注意 `messageAttachmentObjectSchema` 是 `.strict()`，`skillName` 须在 object 层声明为可选字段，否则 parse 直接拒绝未知键）。UI chip 文案以 `skillName` 为准（`name` 仅落库占位，不当 chip 真源，对齐既有口径）。
- **容错（不存在的技能名）**：扫描出的技能名按**合并视图存在性**判定（global ∪ 当前项目技能名集合，含无效技能；禁用不影响存在性——已禁用技能显式引用是允许的，故不按「生效性」判定）。不存在时：附件照常落库（保留用户输入可追溯）、hydrate 输出一行提示而非全文、发送不阻塞。
- **hydrate 与去重**：`prepare-user-messages-for-prompt` 加 `skillAttach` 分支——首次出现读 `SKILL.md` 全文附 `<action name="skillAttach">`（按生效副本解析，跨域读不经 session `file_cache`，直接 `SkillService` 读，附件 `skillName` 字段为解析与展示唯一依据）；后续走 `alreadyReferenced` 短标记。seen key 用 `skill:{name}` 前缀（`{name}` 即附件 `skillName` 字段值——skillAttach 无 path，判重唯一键；与路径 seen 同一集合、不同命名空间，避免碰撞）。技能名在合并视图不存在时输出一行提示（如「技能不存在或已删除」）而非全文，且**不写入 seen key**（技能后续被创建后再次引用可重新附全文，自愈）；存在但**无效**（front matter 缺失/不可解析）时附 `SKILL.md` 原文（读文件内容不依赖 front matter 解析，原样保留），不视为不存在——选择器与 typeahead 不含无效技能，此分支仅手打 token 可命中。S0 前缀集**不预填**技能 key（常驻索引不计入「已出现」，PRD 拍板）；置位/压缩重置语义随可见窗口自动继承。
- **AI 侧呈现**：正文 token 原样保留（hydrate 不剥离），与 `@` 一致。

### 双端管理 UI

**mobile**（页面注册三件套：`navigation/types.ts` + `RootNavigator.tsx`（`withStackLayout`）+ `header-config.ts`）：

- **会话入口**：`SessionDetailScreen` 加第六张卡片「技能」（icon + label + 「n/m 启用」value + chevron）。⚠️ PRD 写「会话操作抽屉」，但当前代码抽屉已迁移为详情页（`ChatTabNavigationProvider` L122-129 注释），落点以 `SessionDetailScreen` 为准。
- `SkillPanelScreen`：合并视图列表（域徽标三态/无效标签/开关/覆盖徽标），开关写当前项目负清单；头部「整理」→ 管理页、「新建」→ 弹窗默认项目域。
- `SkillsSettingsScreen`：双 tab（全局默认在前/项目在后按所有项目分组）、批量（`useBatchSelection` + `BatchCheckbox`/`VfsBatchHeader` 先例）、⋮ 菜单（编辑/删除/复制到项目/跨项目复制/提升全局带覆盖确认）、新建弹窗（域分段+项目下拉）。**设计决策 D5（SPEC 拍板）**——全局 tab「被项目副本覆盖」灰标签按「任意项目存在同名副本」判定（与项目 tab 展示所有项目的全局语境一致，不按「当前项目」判定），tooltip 文案注明该全局版仅对无副本的项目生效。
- `SkillDetailScreen`：**设计决策 D3（SPEC 拍板）**——新建轻量 `SkillFileManager` 组件而非复用 `VfsFileManager`（后者与 `WorkplaceService` 深耦合：列表行合并、纳入状态、目录规则，伪 scope 需伪造 workplace 行为，裁剪成本高于自建；PRD「复用文件浏览器」语义为交互一致）。功能：SKILL.md 置顶排序、子目录导航、文件行 打开/删除（SKILL.md 保留）、目录 进入、更多=新建文件（路径校验禁 `..`/`SKILL.md`/查重）、删除确认、被删文件正被编辑时踢回。
- **编辑器**：`FileEditorScreen` 扩 `scopeKind: 'skill'` 路由值 + `skillRef` 参数（`{domain, name, projectId?}`），`resolveVfs` 分支按域取 `globalVfs`/`projectVfs`，路径拼 `/meta/skills/{name}/{rel}`；绕开 session 特殊保存路径；顶栏标题「技能 · {名称}」+ 路径 chip + 域徽标；`useUnsavedGuard` 复用。
- `ProfileTabScreen`：「工作区」分组加「技能管理」项，`value` prop 显示「项目 X · 全局 Y」（`ProfileMenuItem.value` 先例，useFocusEffect 刷新）。

**desktop**（IPC 四件套 + 设置视图）：

- IPC：`shared/ipc-types.ts` 加 channel + DTO（skills list/effective/read/write/toggle/copy/promote/delete）→ `src/main/ipc/handlers/skills.ts`（样板 `regex.ts`：`getDesktopRuntime()` + `IpcResult` + `formatIpcError`）→ `handler-registry.ts` 注册 → `renderer/ipc/client.ts` wrapper。preload 通用桥不动。
- 设置：`settings-nav.ts` 三表加 `skillsManage`（顶级，双 tab 管理页，覆盖标签判定同 D5）+ `skillDetail`（子级，`SettingsNavState` 加 `viewingSkillRef`）；`SettingsOverlay.tsx` `renderContent` + `getSettingsMainTitle` 挂载；视图组件新文件（列表/详情/编辑态复用 `CodeEditor`，照 `PreviewPane` read/edit 双态但独立视图，不耦合 `WorkspaceTree`/`WorkspacePanelScope`）。
- 会话技能面板（PRD 双端承诺，desktop 对齐 mobile）：挂点 `SessionDetailDrawer`（`renderer/features/chat/SessionDetailDrawer.tsx`）——desktop 会话操作已收拢为该模态抽屉（`ChatComposer` 会话操作按钮 → `openSessionActions` → `setSessionDetailOpen`，`App.tsx`），抽屉中新增「技能」项并展示「技能 n/m 启用」汇总（n 剔除无效技能）；点开为会话技能面板视图（合并视图列表 + 域徽标/覆盖/无效标签 + 开关写当前项目负清单 + 整理/新建头部动作，形态对齐 mobile `SkillPanelScreen`，数据走 Step 18 的 IPC）。具体挂点实现时可调（如改挂 `ChatRail` 会话侧栏区域）。
- ChatComposer `$` 按钮 + typeahead + SkillPicker（见 `$` 引用节）。
- 卡片跳转：`ToolCallCard` skill 分支点击 → 设置栈 push `skillDetail`（带 skillRef）。

## 最终项目结构

```text
packages/core/src/
  domain/skills/                      # 新
    model/skill.schema.ts             #   front matter zod + SkillSummary/SkillRef 类型
    model/skill-name.ts               #   SKILL_NAME_PATTERN 常量（新建校验/$ token/$ 扫描共用）
    logic/parse-skill-front-matter.ts #   split + parseText + 校验 → 有效性
    logic/effective-skills.ts         #   合并/覆盖/禁用过滤（纯函数）
  service/skills/                     # 新
    skills.port.ts / impl/skills.service.ts
  domain/tool/builtin/skill-tool.ts   # 新（skill_opt）
  domain/chat/logic/
    scan-skill-attachments.ts         # 新
    composer-at-path.ts               # 改：trigger 参数化
  bootstrap/skills/skills-schema.ts   # 新（skill_disabled_rule）
  bootstrap/novel-master-bootstrap.ts # 改：登记 + SCHEMA_BOOT_VERSION 6
  domain/vfs/logic/vfs-tree-copy.ts   # 改：excludePrefixes
  service/template/（两调用处）        # 改：传 excludePrefixes
  service/agent/logic/run-agent-turn.ts # 改：AgentTurnRuntimePort + 两装配点
  domain/tool/builtin/builtin-tool-context.ts # 改：skills 闭包
  domain/prompt/model/prompt-render-context.ts # 改：skillsIndex
  service/prompt/render-prompt.ts     # 改：两套遍历 + zones
  config-forms/agent/agent-editor-state.ts     # 改：layoutOrder + 文案键
apps/mobile/src/
  screens/stack/{SkillPanelScreen,SkillsSettingsScreen,SkillDetailScreen}.tsx  # 新
  components/skills/{SkillFileManager,SkillPicker,NewSkillModal}.tsx           # 新
  components/chat/{ChatComposer,message-blocks,ToolCallCard,ComposerAtPathInput,AtPathTypeahead}.tsx # 改
  screens/stack/{SessionDetailScreen,FileEditorScreen}.tsx # 改
  screens/tabs/ProfileTabScreen.tsx  # 改
  navigation/{types,RootNavigator,header-config} # 改
  web/chat-transcript/webview/runtime/util/skill-tool-ref.ts  # 新（镜像）
apps/desktop/
  shared/ipc-types.ts / src/main/ipc/handlers/skills.ts / handler-registry.ts / renderer/ipc/client.ts # 增
  renderer/features/settings/{settings-nav,SettingsOverlay,SkillsManageView,SkillDetailView} # 增/改
  renderer/features/chat/{ChatComposer,AtPathTypeahead,message-blocks,ToolCallCard} # 改
packages/core/test/                   # skills / 复制链 / prompt / attachments 新增用例
```

## 变更点清单

| # | 文件/模块 | 变更 | 依据 |
|---|---|---|---|
| 1 | `domain/vfs/logic/vfs-tree-copy.ts` | `excludePrefixes`（删/拷/seed 三侧） | 存储层探索 §2 |
| 2 | `template-pull.service.ts` / `initialize-session-workspace.ts` | 传 `["meta/skills"]` | 同上 |
| 3 | `bootstrap/skills/` + bootstrap 登记 | `skill_disabled_rule` 表 + 版本 6 | workplace-schema 先例 |
| 4 | `domain/skills` + `service/skills` | 解析/合并/SkillService/SKILL_NAME_PATTERN 常量 | 存储层探索 §2 |
| 5 | 三端 runtime | `skills()` 工厂 | runtime 装配探索 |
| 6 | `skill-tool.ts` + `register-builtin-tools` + `builtin-tool-context` | skill_opt | 工具层探索 §2.1/2.2 |
| 6a | `agent-tool-catalog.ts` + 双端三处「7 个」文案 + picker 测试 | skill_opt 可配置（catalog 条目 + 计数） | 工具策略探索 |
| 7 | `run-agent-turn.ts` | port 扩展 + 两装配点 + 清单预算 | 工具层探索 §2.2 |
| 8 | `content-block.ts` + `build-tool-result-block.ts` + `skill-tool-ref.ts` | meta.skillRef 透传 | 工具层探索 §2.3 |
| 9 | `prompt-render-context.ts` + `render-prompt.ts` + 预览服务 | skillsIndex 注入两套遍历 + zones | 工具层探索 §2.4 |
| 10 | `agent-editor-state.ts` + 测试 + 双端编辑器 | layoutOrder + 占位卡片 | 工具层探索 §2.5 / UI 探索 |
| 11 | `composer-at-path.ts` + 双端 composer/picker | `$` 触发参数化 + SkillPicker | `@` 链路探索 |
| 12 | `scan-skill-attachments.ts` + attachment schema（superRefine 分支）+ `run-agent-turn` + send-intent + `prepare-user-messages-for-prompt` | skillAttach 落库（skillName 专用字段）/扫描前导边界与容错/hydrate/seen | `@` 链路探索 |
| 13 | mobile 导航三件套 + 4 个新 screen/组件 + 3 处改 | 双端 UI（见总体方案） | UI 探索 |
| 14 | desktop IPC 四件套 + 设置视图 + 会话技能面板（SessionDetailDrawer）+ composer/卡片 | 同上 | UI 探索 §2 |

## 详细实现步骤

- Step 1 — phase-skill-storage — blocking: yes — qa: auto：`vfs-tree-copy.ts` 加 `excludePrefixes`（默认空数组=现行为不变），`vfs-tree-copy-batch.test.ts` 先落删除侧/拷贝侧/seed 三侧用例。
- Step 2 — phase-skill-storage — blocking: yes — qa: auto：两条 pull 链传 `["meta/skills"]`；更新 `initialize-session-workspace.test.ts` / `template-pull.test.ts` / `vfs-gc-trigger.test.ts`（断言技能不被复制/删除/重置、blob GC 边界正确）。
- Step 3 — phase-skill-storage — blocking: yes — qa: auto：`skill_disabled_rule` 表 DDL + bootstrap 登记 + `SCHEMA_BOOT_VERSION` 5→6；空表迁移用例（存量库升级路径）。
- Step 4 — phase-skill-storage — blocking: yes — qa: auto：`domain/skills`（front matter 解析 + effective 合并纯函数 + 无效标记）；单测覆盖缺 name/description、不可解析 YAML、同名覆盖、禁用过滤。
- Step 5 — phase-skill-service — blocking: yes — qa: auto：`SkillService` 实现（两域读写/edit/启停/复制/删除，经 ScopedVfsService）；单测含 `..` 路径拒绝、write 缺域报错、整目录复制覆盖、删除清理负清单。
- Step 6 — phase-skill-service — blocking: yes — qa: auto：三端 runtime 暴露 `skills()`；`project.service.ts` copy 携带技能与负清单行（D1）+ 用例。
- Step 7 — phase-skill-tool — blocking: yes — qa: auto：`skill-tool.ts`（四 action、description lambda、summarize 分支）+ 注册 + `BuiltinToolContext.skills` + `AgentTurnRuntimePort.skills()` + 主/子两装配点注入（D2）；工具单测（read 生效副本解析、edit 局部改、path 越界、list 清单）。
- Step 7a — phase-skill-tool — blocking: yes — qa: auto：`BUILTIN_TOOL_CATALOG` 加 `skill_opt` 条目 + 双端三处「全部内置工具（7 个）」文案改 8 + 双端 `tool-policy-picker.test` 硬编码数字更新 + policy 用例（allow/deny skill_opt 校验通过、deny 后运行时 registry 不含它）。
- Step 8 — phase-skill-tool — blocking: yes — qa: auto：`ToolResultBlock.meta.skillRef` 透传 + `skill-tool-ref.ts`（input 解析）；desktop DTO + 双端 message-blocks + mobile WebView 镜像同步。
- Step 9 — phase-skill-prompt — blocking: yes — qa: auto：`PromptRenderContext.skillsIndex` + 两套遍历插段 + `computeLlmExportZonesFromLayout` 计数；单测断言位置（system 后 workplace 前）、空清单不产生段、zones 边界。
- Step 10 — phase-skill-prompt — blocking: yes — qa: auto：`agent-runner.run()` 与双端预览服务预算 skillsIndex（含 D4 联动：resolve 后 registry 不含 skill_opt 则置空）；三端预览出现 `skills` 分段的手动核验点列入验收文档。
- Step 11 — phase-skill-prompt — blocking: yes — qa: auto：`PROMPT_REGION_LABELS` layoutOrder + 技能索引文案键 + `agent-editor-state.test.ts` 断言更新。
- Step 12 — phase-skill-attach — blocking: yes — qa: auto：`composer-at-path.ts` trigger 参数化（`@` 行为回归用例锁死）+ `scan-skill-attachments.ts`（前导边界 + SKILL_NAME_PATTERN）+ schema 扩 `skillAttach`（skillName 专用字段 + superRefine 分支）+ send-intent 计入；扫描用例含不存在技能名容错（附件照常落库、不阻塞发送）。
- Step 13 — phase-skill-attach — blocking: yes — qa: auto：`prepare-user-messages-for-prompt` skillAttach 分支（首次全文/短标记/`skill:` seen key/S0 不预填/不存在技能名输出提示行且不写 seen）；单测镜像 T-PD2/T-PD3 写法 + 置位/压缩重置用例。
- Step 14 — phase-skill-ui-mobile — blocking: yes — qa: manual_user：mobile 导航注册 + `SessionDetailScreen` 第六卡片 + `SkillPanelScreen`（开关写项目负清单）。
- Step 15 — phase-skill-ui-mobile — blocking: yes — qa: manual_user：`SkillsSettingsScreen`（双 tab/分组/批量/⋮ 菜单/新建弹窗）+ `ProfileTabScreen` 入口。
- Step 16 — phase-skill-ui-mobile — blocking: yes — qa: manual_user：`SkillDetailScreen` + `SkillFileManager`（D3）+ `FileEditorScreen` scopeKind `'skill'` 扩展。
- Step 17 — phase-skill-ui-mobile — blocking: yes — qa: manual_user：mobile composer `$` 按钮/typeahead/SkillPicker + mention `$` trigger + ToolCallCard skill 卡片。
- Step 18 — phase-skill-ui-desktop — blocking: yes — qa: auto：desktop IPC 四件套（handler 单测/类型检查）。
- Step 18a — phase-skill-ui-desktop — blocking: yes — qa: manual_user：`SessionDetailDrawer` 加「技能」项与「技能 n/m 启用」汇总（n 剔除无效技能）+ 会话技能面板视图（合并视图/开关写当前项目负清单/整理与新建头部动作；挂点见总体方案，实现时可调）。
- Step 19 — phase-skill-ui-desktop — blocking: yes — qa: manual_user：`skillsManage` + `skillDetail` 设置视图（列表/详情/编辑）+ 占位卡片 + RealPromptPanel label。
- Step 20 — phase-skill-ui-desktop — blocking: yes — qa: manual_user：desktop composer `$` 入口 + SkillPicker + ToolCallCard 跳转。
- Step 21 — phase-skill-verify — blocking: yes — qa: auto：全量 `npm test -w @novel-master/core` + 双端 typecheck/build；PRD 验收矩阵逐条核对（auto 项）。
- Step 22 — phase-skill-verify — blocking: no — qa: manual_user：真机走查 PRD 验收 manual 项（面板/管理页/详情/编辑/`$` 引用/卡片跳转/预览三端），录屏归档。

## 测试策略

分层：纯函数单测（合并解析/composer/scan/seen）→ 服务集成测（SkillService + 复制链 + GC）→ 工具链路测（skill_opt 四 action + meta 透传）→ 提示词快照测（注入位置/zones/预览分段）→ 双端手动走查（qa: manual_user 项）。

### 测试用例

- T-SK1 — blocking: yes — `replaceVfsSubtree` excludePrefixes 三侧行为 + blob GC 边界（→ Step 1/2）
- T-SK2 — blocking: yes — 两条 pull 链后技能不被复制/删除/重置；同项目新会话技能可用（→ Step 2）
- T-SK3 — blocking: yes — `skill_disabled_rule` 建表 + 存量库升级（→ Step 3）
- T-SK4 — blocking: yes — front matter 解析有效性 + 合并/覆盖/禁用纯函数（→ Step 4）
- T-SK5 — blocking: yes — SkillService 读写/edit/启停/复制/删除 + 校验拒绝（→ Step 5）
- T-SK6 — blocking: yes — 项目复制携带技能与负清单（D1）（→ Step 6）
- T-SK7 — blocking: yes — skill_opt 四 action + description lambda 快照 + 两装配点注入（→ Step 7）
- T-SK7a — blocking: yes — catalog/policy：skill_opt 在 picker 可选、allow/deny 校验与运行时过滤生效、deny 后索引不注入且 `$` 引用照常（→ Step 7a/10）
- T-SK8 — blocking: yes — meta.skillRef 透传与双端解析（→ Step 8）
- T-SK9 — blocking: yes — 索引段位置/空段省略/zones 计数/预览分段（→ Step 9/10）
- T-SK10 — blocking: yes — layoutOrder 断言更新后通过（→ Step 11）
- T-SK11 — blocking: yes — composer `@` 参数化回归 + `$` 扫描（前导边界/token 字符集）/不存在技能名容错/发送门闩（→ Step 12）
- T-SK12 — blocking: yes — skillAttach 首次全文/短标记/seen 隔离/不存在技能名提示行不写 seen/置位压缩重置（→ Step 13）
- T-SK13 — blocking: no — mobile/desktop 手动走查清单（PRD manual 验收项，含 desktop 会话技能面板，→ Step 14-20（含 18a）/22）

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|---|---|---|
| `excludePrefixes` 的 revision ref_count / GC 边界错误（删除侧保留最易错；seed 侧为防御性对齐，函数自带存在性跳过，非正确性关键） | T-SK1 直接构造 `replaceVfsSubtree` 用例先行；GC 用例照 T-G2 模式 | 该参数默认空数组=行为不变，可独立 revert |
| `skillAttach` 枚举扩展的版本回退：旧版本读新消息 `parseAttachmentsJson` 校验失败 | 发布前进度内不混合版本使用；回滚时若已有含 `skillAttach` 的消息，需一次性脚本清洗该 action 附件（附迁移 SQL 草案于实现 PR） | 枚举 revert + 清洗脚本 |
| `SCHEMA_BOOT_VERSION` 递增遗漏配套（历史事故：bump 丢逗号致 CI 全挂） | 提交前 `node -e "require('./package.json')"` + 三端 `npm ci` 冒烟（RULE.md 禁令） | 新表独立空置无害，代码 revert 即可 |
| 两套提示词遍历只改一处导致预览与实际不一致 | T-SK9 同时断言 assembly 与 LLM input 两产物 | 独立小 revert |
| mobile `VfsFileManager` / `FileEditorScreen` 改动波及现有三个使用方 | D3 已规避前者（新组件）；后者仅扩联合类型分支，现有调用点类型不动，回归走查会话工作区/全局模板/子会话浏览 | 分支删除即回退 |
| 双端 `$`/`@` 共享逻辑参数化引入 `@` 回归 | T-SK11 锁死 `@` 现有行为快照 | 参数默认 `@`，行为等价 |
| 子代理注入技能放大索引 token（D2） | 索引体积风险 PRD 已列（描述长度约束）；监控点写入验收文档 | 子装配点单独关闭即回退 |
| desktop `AgentDefinitionEditorForm` 疑似遗留未接线 | 不改；若后续接线需同步占位卡片（备注于代码） | — |

回滚总策略：core 新增（domain/skills、service/skills、skill-tool、表）均为增量，逐模块独立 revert 不影响存量；复制链排除与提示词注入各有默认关闭语义（空数组/空清单），可单独摘除。
