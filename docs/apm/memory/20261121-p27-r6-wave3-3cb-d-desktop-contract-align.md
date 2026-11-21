# p27 R6 波 3c-b 片 D：desktop 源码契约测试正则对齐 + 锁定处补迁（2026-11-21）

M 线（3cb-m）同款四步法收口 desktop 侧：测试断言先对齐 `coreT({key})` descriptor 形态
（断言意图不变——锁「这段 UI 用的确是这些键」，模板串处锁形态+键名+占位实参），
再把契约锁回退处补迁。10 个 commit 按测试文件分片。

## commit 链（10 个）

- a7d1edad1 session-detail-drawer：10 处补迁（toast 精确调用形态/点击卡三元/badge 三态三元/
  锁定模型 toast/已删待重选/智能体锁定/查看提示词/压缩上下文 ×2 含 ConfirmModal title/
  noneLabel）
- 230fe8800 workspace-zip-menu：App.tsx 分流 toast 三元补迁（exported_zip/exported_file）
- 19c54b9d7 settings-agents-tabs：主/子 tab label、「内置」徽标、「全部」徽标 ×2、查看菜单、
  通用助手 · 不可编辑（SettingsViews 6 处）+ AgentEditorView builtin_note_desktop 1 处
- adecbd596 skills-manage-export-menu + skill-zip-import：菜单四项（edit/edit_info/export_zip/delete）
- f4e77727e workspace-settings-subagent-stream：两行开关 label（stream_parent/stream_sub）补迁；
  **desc 两句键面无键保留字面量**（半迁半留，断言锁 coreT label+中文 desc 混合形态）
- a5e11c111 provider-detail-tabs：恢复 0fd49e1c4 回退前形态（ui.nav.providers/model_management）
- c19a4a2d5 settings-db-maintenance-ui：desc 恢复 cleanup_desktop_desc params 形态（两条模板正则
  收为一条形态+键名+占位实参锁）、清理按钮接 3c-a 裁决键 cleanup_action、弹窗 title/message
  补迁（cleanup_confirm_title_desktop / cleanup_confirm_desktop，长文案逐字比对一致）
- 1bfde9cf1 settings-agents-delete-confirm：Agent named 模板接 delete_agent_confirm_msg_named
  params name（模板串→coreT params 形态）
- 2e91fd50f smart-sort-rules-view：仅 name_required 1 处补迁，其余 4 句无键保留（见下）
- 2749e0ffb 连带修正：settings-data-management-cancel 行为测试按文案找按钮
  （buttonByText 全等匹配），清理按钮文案随裁决变「清理数据库空间」后文本锚失配 →
  对齐新文案（全量首跑 1 红，单跑复绿）

## 对齐断言数 / 补迁处数（按测试文件）

| 测试文件 | 对齐断言 | 补迁处 | 键 |
|---|---|---|---|
| session-detail-drawer.test.ts | 12 | 10 | session 域 8 键 + ui.common.loading + ui.nav.view_prompt |
| workspace-zip-menu.test.ts | 2 | 1 | ui.vfs.exported_zip / exported_file |
| settings-agents-tabs.test.ts | 7 | 7 | agent.primary_tab/subagent_tab/general_note/builtin_note_desktop + common.builtin/all/view |
| skills-manage-export-menu.test.ts | 3 | 4 | common.edit/delete + skills.edit_info/export_zip |
| skill-zip-import.test.tsx | 1 | （并入上行源文件） | skills.edit_info |
| workspace-settings-subagent-stream.test.ts | 3 | 2（label）| chat_config.stream_parent/stream_sub |
| provider-detail-tabs.test.ts | 2 | 2 | ui.nav.providers / model_management |
| settings-db-maintenance-ui.test.ts | 6 | 5 | storage.cleanup_section/desc/action/confirm_title/confirm（_desktop） |
| settings-agents-delete-confirm.test.ts | 1 | 1 | agent.delete_agent_confirm_msg_named |
| smart-sort-rules-view.test.ts | 1 | 1 | smart_sort.name_required |

合计对齐断言 38 条、补迁 33 处（含 cancel 连带 1 处测试侧）。键全部 keys.ts + zh-CN.yaml
反查核实（工作期间并行线 3c-a 两 commit 1bf236c6a/e0d82d104 落进分支，长文案逐字比对
EXACT 后才迁），零自立键。

## 无键保留清单（归 3c-c MISS 补迁，断言仍锁中文并注明原因）

1. WorkspaceSettingsView 流式开关 desc 两句「（主对话|子智能体会话）的实时输出；关闭后…」
   ——stream_parent_on/off 与 stream_sub_on/off 均不同文
2. smart-sort 空态两句「加载失败，请重试。」「暂无规则，点击上方按钮创建。」——
   common.load_failed / smart_sort.empty 均不同文、无 3c-a 裁决
3. 「规则不存在或已被删除」——missing_toast 缺「被」字不同文
4. 「输入测试文本后点击「测试」查看匹配结果。」——result_pending 无前缀不同文
5. 「删除服务商「x」？」「删除模型「x」？」named 模板——键面只有 agent 的 *_msg_named
   （无测试锁定，不影响测试）

## 归零自检（六源文件非注释中文行逐条对台账）

残留全部对上三类，零意外：D1/D2/D3 漏键清单（已立键待 3c-c 接线：view_skills_aria、
switch_model_locked_aria、agent_id_missing、load_failed、pull/cloud_newer 弹窗、
deleted_count_done、name_empty、new/rename_title、api_key 系列、models_saved_done、
禁用、新建规则、恢复默认规则、regex_invalid、请输入测试文本、请先填写正则表达式、
启用规则、(空匹配) 等）；本波新登记 MISS（上面 5 条 + 「主/子智能体直接响应…」hint 两句、
「删除规则「x」」aria 组合句、「支持 /正则/flags…」帮助段、SettingsViews:2145 smart-sort
段「内置」标签——键面有 ui.common.builtin 同文，3c-c 可直接接线）；非文案（dev 边界
AppError detail、JSX 注释）。App.tsx / SkillsManageView 双双零残留。

## 验证

- 十个测试文件单跑：12/12、6/6、9/9、18/18（两文件）、3/3、5/5、5/5、1/1、9/9、5/5 全绿
- desktop 主 typecheck 每 commit 前跑，全绿（注意：主 tsconfig 只盖 src/main+shared，
  renderer 面靠测试兜）；renderer typecheck 294 条与 D1-D3 记载基线同数；ratchet
  RED（now 174 / baseline 178，79 new identities）与 D1 记载逐字一致，命中本波文件的
  两条（SettingsViews 358 TS2345、skill-zip-import 18 TS6307）均在 diff 行范围外，既有欠账
- 全量 npm test：774/774（137 suites），与基线一致（首跑 1 红为 cancel 文本锚连带，已修）
- nm-style 显式扫描 17 文件 vs 开工前 worktree 基线逐项一致：signatures=17 hygiene=21
  dup +3/-1 oop=INFO(1)——零新增（全为存量欠账）

## 教训

- 契约锁面之外还有**行为测试的文本锚**：按钮文案收口去漂移（清理→清理数据库空间）会打
  到 buttonByText 全等匹配的行为测试——按裁决迁文案时把断言文本锚一起对齐，别只盯
  readFileSync 源码锁。
- 混合键面处（label 有键、desc 无键）半迁半留是合法中间态：断言锁「coreT label + 中文
  desc」混合形态，注释写明哪半待 3c-c。
