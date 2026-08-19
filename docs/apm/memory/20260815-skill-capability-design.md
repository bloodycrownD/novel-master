---
date: 2026-08-19 01:30
title: skill 能力全链路 + 全局文件管理器规划（global-fs-manager）
keywords: skill, SKILL.md, meta/skills, load action, skillsPrefix, 技能总开关, ZIP 导入新建, 全局文件管理器, 只读拼接视图, meta 域提升, pullTemplate 拆除, feat/skills-integration
abstract: skill 能力已全量交付在 feat/skills-integration 分支（存储/工具/提示词/$ 引用/双端 UI + 多轮打磨，全部本地未 push）；随后规划 global-fs-manager 迭代——全局工作区改为只读物理树浏览器 + 技能存储提升为独立 meta 域 + 拆 pullTemplate，PRD/SPEC 已定稿待开工。含全程踩坑记录（脏写/CRLF/版本撞车）。
---

# 第一部分：skill 能力（已交付，分支 feat/skills-integration，未 push）

## 最终形态（多轮拍板收敛）

- **存储**：`/meta/skills/{name}/` 两域（global/project）、`skill_disabled_rule` 负清单（SCHEMA_BOOT_VERSION=7，修过 v6 撞车）。
- **skill 工具**（原名 skill_opt 已改名）：单工具多 action —— `load`（装载语义：读生效副本 SKILL.md 全文 + files 附属清单，无域/路径/分页参数）/ `read`（文件访问，分页）/ `write` / `edit` / `list`。load 与 `$` 引用双向共享 seen（`skill:{name}` 命名空间）：方向 A `$` 已附全文→load 回短提示（BuiltinToolSkillsContext.referencedNames 集合，runner 每步 prepare 后回填）；方向 B load 过→后续 `$` alreadyReferenced（prepare 扫可见 assistant tool_use，read 不预填因可能截断）。压缩/置位随可见窗口自动重置。
- **破坏性操作红线**：跨域复制（复制到其他项目/提升为全局）已整链移除（无 checkpoint 版本管理，UI+IPC+core copySkill 全拆）。未来恢复看 `git show 0bc2152` 删除侧 hunks（勿整体 revert，会连带回滚 load）。
- **技能能力总开关** `prompts.skillsEnabled`（缺省 true；false = resolveAgentToolRegistry 强制 delete("skill")，D4 联动自动关索引/闭包/工具；`$` 引用不受影响——deps.skills 独立于 toolCtx.skills）。另有 `prompts.skillsPrefix` 索引前缀语（缺省 DEFAULT_SKILLS_INDEX_PREFIX，等于默认/空/开关关时 omit）。
- **ZIP 导入并入新建弹窗**（双端）：「从 ZIP 导入…」→ core `previewSkillZip`（zip 根=技能目录约定，嵌套目录 skillMd=null）→ 预填 name/description 可改 → 创建时整包落 `/meta/skills/{name}` + 表单值变更时 withFrontMatterValues 重写 front matter（保正文）。desktop 走新 IPC VFS_ZIP_PICK（选文件回字节）+ VFS_ZIP_IMPORT_BYTES（字节直写）。
- **mobile UI 终态**：SkillPanel（点行进详情，无 header 按钮）；SkillsSettings（双 tab 全局/项目无计数；⋮ 菜单=导出 ZIP/删除）；SkillDetail（标题=技能名，复用 VfsFileManager，侧滑逐级上翻）；NewSkillModal（域跟调用方，含 ZIP 导入）。所有计数文案（n/m 启用、全局M/项目N、设置入口「项目 X · 全局 Y」）已全删。
- **智能体编辑器技能卡**：header Switch + 开时（精简 hint + 前缀语输入框，mobile 用 FormField+FormTextInput 与会话区同款）；关时整体隐藏。

## 关键提交（feat/skills-integration，HEAD≈d380b30 后续至 6226a97 等）

load+seen/copySkill 移除=0bc2152；导入并入新建 mobile=9a04dee、desktop=e53630d；总开关=b154eda；前缀语+「我看到工作区了」=bb7d012；样式统一=6226a97。

# 第二部分：global-fs-manager 规划（PRD+SPEC 已定稿，待开工）

需求演化：全局工作区看到 meta/skills → 用户提议移除全局↔项目同步、全局工作区改真实文件管理器 → 多轮收敛最终拍板**只读拼接视图**（简单安全）+ **技能存储提升**。

## 探索确认的核心事实

- VFS 纯虚拟：`vfs_entry` 是 `(scope_key, path)` 三域三棵逻辑树（global/project/session 各自从 `/` 开始），path 列存纯逻辑路径；`/template`（global 物理前缀）、`/projects/{pid}/template`、`/projects/{pid}/sessions/{sid}` 均为应用层拼接的派生视图，不在表里。
- 会话消息/元数据是表行（chat_session/chat_message），不在文件树；树里的「sessions」= 会话工作区文件。
- session 域无 meta（技能只存 global/project 两域，会话初始化被 excludePrefixes 拦）。
- repo 全部 ~25 方法首参 scopeKey，无跨 scope 方法；path 无单列索引（entry-id 迁移删过）；`idx_vfs_entry_scope_path` 复合索引在。
- `toPhysicalPath` 运行时零调用（仅迁移/测试）；`GLOBAL_PHYSICAL_PREFIX="/template"` 全仓唯一生产定义点在 vfs-path-mapper.ts。
- pullTemplate：global→project 唯一主动链（replaceVfsSubtree+worktree.copyScope，excludePrefixes meta/skills）；project→session（initializeSessionWorkspace）是另一条，保留。新项目不自动拉全局（create 只插行）。

## 最终方案（spec 8 步，docs/Iterations/global-fs-manager/）

1. **技能重定位**（未发布零迁移）：新 meta 域 scope——`global-meta`（物理 `/meta`，scopeKey `global:meta`）与 `project-meta`（`/projects/{pid}/meta`，`project:{pid}:meta`）；SkillService 域解析改写（上层全走抽象零感知）；连锁：initializeSessionWorkspace 删 excludePrefixes（技能不在 project 域）、项目复制 D1 额外拷 meta 域。最终树：根=projects/+template/+meta/；项目层=template/+meta/+sessions/。
2-3. **pull 拆除**：core projectTemplatePull/ProjectService.pullTemplate；desktop PROJECTS_PULL_TEMPLATE 全链+WorkspaceHeaderActions session 分支（showSync 收窄 chat-only）；mobile projectPullFromParent+TemplatePullButton 收窄 session-only；CLI `nm project template pull`。TemplatePullService 名字保留；sessionTemplatePull/copyScope/replaceVfsSubtree 全留。GC 测试 T-G2 换载体（sessionTemplatePull 或直调 replaceVfsSubtree）。
4. **只读 PhysicalVfsService**（core 新增，无 scope）：list=逐域 listEntriesUnderPrefix+拼前缀+虚拟目录合成（/projects 等中间目录从 chat_project/chat_session 枚举）；read=五前缀解析（session→project-meta→project→/meta/→/template/→不存在）委托单 scope 读。类型层面无写方法。三端 runtime 挂 physicalVfs()。
5-6. **双端只读 UI**：VfsFileManager readOnly 模式（隐藏全部写操作/菜单）；GlobalTemplateScreen 换源+文案；FileEditor physical 只读分支（保存禁用）；desktop physical 面板类型+IPC 分流。
7-8. 文案+残留 grep 验收（口径 `projectTemplatePull|PROJECTS_PULL_TEMPLATE|projects\.pullTemplate|nm project template pull`，排除 .woktree/dist；session 侧保留项不算残留）+真机走查。

明确否决过的方案：磁盘真实文件系统接入（mobile 沙盒没东西、desktop 能删 DB）；数据物理化统一树（迁移+寻址切换，用户改为只读后不需要）；合成视图+可写（复杂度大）。不 bump SCHEMA_BOOT_VERSION（零 DDL）。

## 遗留待办

- spec 待用户最终确认 → 开 worktree 走 code-dev-loop
- Step 22 真机走查（skill 迭代 manual_user 项）
- write 缺省域：实现补 project，PRD L181 写报错——需对齐文档
- worktree .woktree/skill-dev 清理（用户确认后）

# 第三部分：踩坑与操作纪律（跨会话必读）

- **并行进程脏写**：本会话 skill-tool.ts/SkillsSettingsScreen/agent-editor-state 被写回旧内容 5+ 次（疑似 opencode 会话/编辑器旧缓冲）。纪律：改完立即提交；提交前全仓 grep 关键词防脏写。
- **CRLF 假 diff**：python open() 文本模式和 edit_file 都会把 CRLF 文件写成 LF（全文件假 diff）。纪律：CRLF 文件（AgentEditorForm/AgentEditorView/agent-editor-state 等）用二进制模式或改后 `file` 命令检查 + 必要时 `d.replace(b'\n', b'\r\n')` 转回；提交前看 diff --stat 行数对称异常即行尾问题。
- **desktop 全量测试高负载雪崩**：机器有 opencode+llama-server 抢 CPU 时 node --test 并发模式能拖到数分钟。纪律：desktop 全量必带 `--test-concurrency=1`。
- **SCHEMA_BOOT_VERSION 撞车**：v6 时代两分支各 bump 撞出 no such table。纪律：合并涉它的分支必核对对方版本号。当前=7。
- **验证命令**：core `npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test "test/**/*.test.ts" --test-ignore "test/**/performance.test.ts"`（改 core 先 npm run build）；mobile tsc 用 `./node_modules/.bin/tsc --noEmit -p tsconfig.build.json` + `npx jest <文件>`；desktop `npm run typecheck` + `node scripts/run-tests.mjs --test-concurrency=1 <文件>`。core 当前 2018 全绿。
- **grep 必排除** `.woktree/`（4 个工作树副本）与 `dist/`，否则全是误报。
- **mobile jest 坑**：组件引 react-native-svg 需在测试 mock；message-blocks 测试是 .ts 后缀。
- **用户红线**：merge/push 需明确指令；提交前必 `git branch --show-current`；工作区 UI（session 文件管理器）不能被 skill 场景波及（跑 vfs-file-manager.session.integration.test.tsx 回归）。
