# p27 R6 波 3c-c 片 D：desktop MISS 补迁收尾 + 清单外杂项（2026-11-21）

分支 p27-backlog。波 3-2 六片与 3c-b D 线迁移时「键面缺键保留中文」的 MISS 处，键已在
3c-a（1bf236c6a，68 键 + 15 裁决）与 3c-c 前置补键（c702d0a6b，12 键，ui 域 1195 → 1207）
全部立齐；本片把 desktop 侧全部接线，组件零立键。四个 commit 按文件组分片。

## commit 链（4 个）

- 5eabbfca7 D1 壳/导航/会话段（+13 coreT）
- 3afdacb57 D2 配置视图 + 流式 desc（+12 coreT，含 subagent-stream 契约断言升级）
- 13a5bf29e D3 SettingsViews 全量 + provider 弹窗标题（+54 coreT，含 smart-sort 契约断言升级 ×3）
- 6f0231d5c D3 工作区/统计段（+18 coreT，含 stats 行为测试文本锚对齐）

合计新增 coreT 引用 97 处（覆盖台账全部键面欠账；模板/组合句一处多 coreT 计多）。

## 接线处数（按键域分列）

| 域 | 处 | 明细 |
|---|---|---|
| ui.nav / ui.project / ui.about | 8 | nav-workspace 六处（workspace_session/workspace_chat/file_browser/workspace 兜底/project.title/subagent_session_view）+ settings-nav 关于 ×2 |
| ui.session / ui.common(renamed) | 3 | drawer 已重命名（裁决）、view_skills_aria、switch_model_locked_aria |
| ui.stats(session_total) | 1 | MetricsDetailPopover |
| ui.agent | 10 | agent_id_missing、load_failed、deleted_count_done、scope aria、primary/subagent_scope_hint、new_title、list_primary/subagent_empty、assistant_text_readonly_hint |
| ui.skills | 2 | aux_deleted、path_relative_label |
| ui.sampling | 3 | model_missing（裁决）、saved_done、reset_done |
| ui.provider | 25 | 模型改名（裁决）、SettingsViews 全部漏键（copy/rename_blocked、name_required/empty×2、new_title×2、rename_title、api_key 系列、secret_key×2、path_style、models_saved_done、models_deleted_count/done、named 删除×2、keep_hint composed×2）+ SettingsOverlay:187 new_title（对号表第三处） |
| ui.chat_config | 2 | stream_parent_desc / stream_sub_desc（c702d0a6b） |
| ui.cloud_sync | 4 | pull_confirm_title/msg_desktop、cloud_newer_title/msg_desktop |
| ui.smart_sort / ui.common(disable/builtin) | 16 | disable、new_rule_title（裁决）、空态两句、builtin、删除规则 named、reset_title、rule_missing、test_text_required、regex_required、regex_invalid×2、help_regex_syntax、enable_label、no_match_text（全角裁决）、test_result_pending |
| ui.vfs | 13 | invalid_action×3、pick_file_failed、drag_out_failed×2、export_materialize_failed×2、import_hint_zip/card/file、annotate_actions_aria |
| ui.stats(其余) | 6 | range_required×2、range_start_after_end（裁决）、format_invalid×2、day_hourly_template |

## 断言同步数（3 处测试文件）

- workspace-settings-subagent-stream.test.ts：desc 断言「coreT label + 中文 desc」混合形态
  → 全 coreT 形态锁（stream_sub_desc 键名+形态），意图不变。
- smart-sort-rules-view.test.ts：空态两句 / 规则缺失 toast / idle 占位三条断言升级 coreT
  形态锁（load_retry_empty/empty_create_hint/rule_missing/test_result_pending）。
- token-usage-stats-view.test.tsx：from>to 行为测试文本锚随裁决对齐
  「自定义区间起始日不能晚于结束日」（先例 2749e0ffb；请选择起止日期/格式异常两锚同文不受影响）。

## 清单外处理结果

- nav-workspace.ts 6 处：全部接线（键对号见上表；coreT import 新增；模块级常量求值安全沿 D1 先例）。
- AgentWorkplaceBlockCard.tsx:56：接线 ui.agent.assistant_text_readonly_hint（键 3c-a 已立），
  新增 coreT import。
- SettingsOverlay.tsx:187：对号表 ui.provider.new_title 第三处，接线 + coreT import。
  该文件其余中文（标题兜底组/aria/守卫弹窗）不在五份台账，保留记台账（见下）。
- skillsTag 借键裁决（主代理拍板）：ui.nav.skills 借「技能」同文合法，保留不动（SkillsManageView 未触碰）。

## 验证

- desktop 主 typecheck 每 commit 前绿；renderer typecheck 294 条 stash 对照**归一化逐字节一致**（剥行号列号），零新增。
- 涉及契约/行为测试单跑：smart-sort + subagent-stream 12/12、drawer+popover+agents-tabs+delete-confirm 30/30、token-usage-stats 25/25、provider-tabs/db-maintenance/skills-export/skill-zip/zip-menu/cancel/push-menu/shell-menu 47/47。
- 全量 npm test：774/774（137 suites），与基线一致。
- nm-style 显式 15 文件扫描：signatures=0；hygiene 61 条 stash 前后逐条同符号同判定（仅行号位移）零新增；gate dup +3/-1 stash 前后同数（分支既有，非本片）；gate bare PASS；throw-audit PASS。
- 归零自检（renderer+shared 非注释中文 grep）：台账内 MISS 全部接线；残留见下。

## 残留台账（豁免类对账）

本片文件内保留 4 类：
1. SettingsViews:2168 aria-label「启用 {name}」组合句——键面无组合模板键，不立键保留。
2. SettingsViews:1340 AppError detail「自定义参数必须是 JSON 对象」——AppError detail 豁免类。
3. vfs-tree-utils:20 RangeError「segment index 越界」——基建 throw（3c-a 不立清单裁决）。
4. ChatComposer「未选择模型」×2——协议哨兵非文案（D1 记忆口径）；console.error/warn（ChatComposer:351、useAgentStreamMetrics:211）与 ipc/client preload 诊断串——日志/诊断豁免。

台账外存量（不在本片五份台账，未动）：desktop 通用组件（code-block/ManageHeader/MermaidMarkdown:334/ConfirmModal/BatchCheckbox/TextPromptModal/PickerModal）、ToolCallGroupCard、PromptCollapsibleField、SkillPicker、NewSkillModal（desktop 版全文件）、SkillInfoEditModal、useAutoUpdateCheck、format-user-error、ExplorerPane/PreviewEditorTabs/PreviewPane/session-default-title、SettingsOverlay 其余段、SkillDetailView JSX 注释若干。多行 JSX 块注释被行过滤漏计的行均为注释非文案。

## 教训：共享 worktree 并行线的 commit 污染

并行 M 线（3c-c M）与 D 线同 worktree 同分支：M 线 `git add` 过的 mobile 文件躺在共享
index 里，`git commit`（不带 pathspec）会把它们一并提交——首投 6f0231d5c 前身误带 23 个
mobile 文件，`git reset --soft HEAD~1` + `git restore --staged apps/mobile` 退回工作区后
按 `git commit -- <pathspec>` 重投，M 线改动零损失。**并行线共用 index 时 commit 必须带
pathspec，commit 后必须核对 `--stat` 文件数与预期一致。**
