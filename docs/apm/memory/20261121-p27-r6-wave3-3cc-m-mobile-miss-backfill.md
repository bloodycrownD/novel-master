# p27 R6 波 3c-c 片 M：mobile MISS 补迁收尾（2026-11-21）

分支 p27-backlog。波 3-2 六片（M1/M2/M3）迁移时「键面缺键保留中文」的 MISS 处，键已在
3c-a（1bf236c6a，68 键 + 15 裁决）与 3c-c 前置补键（c702d0a6b）全部立齐；本片把 mobile
侧全部接线，零立键。六个 commit 按文件组分片。与 D 线（3c-c D，desktop）同 worktree
并行互不重叠。

## commit 链（6 个）

- 1296565ad M1 聊天会话导航组（16 处）
- e9895e31a M2 状态域组（13 处）
- c791b5a92 M2 provider/sampling/prompt/push 组（6 处 + throw-audit 基线键同步）
- 1177e817d M2 skills 组（8 处）
- 42d1bc488 M3 内容同步统计组（7 处）
- b68ed2a55 复用裁决补线（2 处，归零自检抓漏后补）

合计 52 处接线（一处多 coreT 调用按调用计；push_action 台账 M2/M3 各记 1 处实为同一
物理点 TemplatePushButton:63）。

## 接线处数（按键域分列）

| 域 | 处 | 明细 |
|---|---|---|
| ui.common | 17 | compact_failed×7（M1 两文件压缩链）、fork_failed×3、disable×1（SmartSortRules 批量）、unsaved_changes×2（AgentEditorForm + SmartSortRuleEditor，「未保存的更改/有未保存的更改」措辞归一裁决）、unsaved_title/unsaved_confirm_msg/stay/leave×4（useUnsavedGuard，M2 披露顺手接线） |
| ui.session | 4 | compact_button×2（两处压缩 Alert 确认按钮）、agent_unconfigured×2（chat-agent-meta none 兜底名） |
| ui.chat_config | 2 | header-config ChatConfig + ProfileTabScreen 菜单 |
| ui.agent | 1 | not_found 插值 {agent_id}（useAgentEditorFormState） |
| ui.provider | 3 | connect_section、change_required（throw 沿 handleSave catch 走 toast，用户可见）、auth_section（裁决） |
| ui.sampling | 2 | saved_done、reset_done（ModelSamplingScreen） |
| ui.skills | 8 | load_failed×3（SkillPanel/SkillDetail/SkillsSettings）、NewSkillModal 校验四句（desc_empty/project_required/zip_root_missing/domain_name_conflict 插值）、delete_confirm_frame（frame+尾句合一模板，{names} 取 selected_skills_label(count) 或「names」字面，scopeHint 前拼） |
| ui.smart_sort | 6 | saved_done、enable_label、regex_invalid 插值 {detail}、help_smart_title/body、regex_required（裁决） |
| ui.prompt | 1 | select_project_session（RealPromptScreen） |
| ui.cloud_sync | 4 | push_action（推送按钮）、push_done（裁决：推送成功→推送完成）、minio_optional_hint、region_label |
| ui.stats | 3 | session_total（MetricDetailSheet）、usage_label、ratio_label（PieChart 详情行） |
| ui.vfs | 1 | protected_path_blocked 插值 {path}（VfsFileManager 批量阻断 toast） |

## 复用裁决接线（mobile 侧 5 处）

推送成功→push_done、请先填写正则表达式→regex_required、认证 section→auth_section、
未保存措辞归一→unsaved_changes×2。其余 11 组裁决源在 D1/D2/D3（desktop），D 线处理。

## 验证

- mobile typecheck 三段（tsconfig.build / src/web / e2e:tsc）每 commit 前跑，全绿。
- 契约/行为测试单跑：M1 组 7 套件 51 测试、M2 状态域 2 套件 8、C 组 4 套件 27、skills 组
  3 套件 10、M3 vfs 7 套件 33 + metric-detail-sheet、裁决补线 2 套件 14——全绿
  （provider-detail-tabs 因 :43 锁中文，:209 停迁，见残留）。
- comm 校验：mobile 全量 coreT 键 603 个对 keys.ts 零非法（CRLF 需 tr -d 归一）。
- throw-audit gate PASS（change_required throw 原文进基线键、line 同步 135）。
- nm-style 显式 23 文件：signatures=0；hygiene=39 与波前（git checkout 波前版对照扫描）
  完全同数零新增；dup +3/-1 与波前一致（分支既有）；bare INFO(0)。
- 全量 npm test：268 suites 2384/2384 全绿，与基线一致（含 D 线并行 commit 合并态）。

## 停迁项（1 处，停下报告口径）

- ProviderDetailScreen:209「已保存模型」（models_saved_done）：provider-detail-tabs.test:43
  仍锁 `title="已保存模型"` 中文源码形态——3c-b 对齐时明确留待后续，未在对齐清单内。
  按纪律不迁不红测不碰测试文件，键已立（ui.provider.models_saved_done），待测试对齐片
  一并接线。3c-b 残留清单其余四组均已在本片迁完。

## 残留台账（豁免类对账）

本片 23 文件内非注释中文残留全部落类：
1. ProviderForm 三处 dev throw（Headers/Header/自定义参数 JSON）——BOUNDARY 已登记
   （3c-a 不立清单），豁免。
2. JSX 注释与行尾注释（SessionDetailScreen/PieChart/RealPromptScreen 等）——注释非文案。
3. ProviderDetailScreen:209——停迁项（上节）。
4. MetricDetailSheet 其余 ~16 行——整文件从未入迁移波（清单外，见下）。

台账外存量（不在五份台账，未动，键面多数有键待后续片）：
- **MetricDetailSheet.tsx**（除 session_total 外整文件）：标题/最近请求段/行标签/两行口径
  脚注（与 desktop 同文勿单侧改写）——从未列入任何波次文件清单；metric-detail-sheet.test
  以渲染中文 toContain 锁（coreT 同文不破，可迁但需走行为测试核对流程）。
- **token-usage/DetailTab.tsx** 整文件（按天用量标题/检视行/{day}·按小时分布——后者键
  day_hourly_template 3c-a 已立）：M3 只迁了 TokenUsageStatsScreen 主文件，拆分件漏网。
- **useChatTabController.ts:120** confirmBatchDeleteSessions 删除确认四串（确认删除/
  确定删除选中的 N 个会话？/取消/删除）——键全齐（ui.chat.confirm_delete/
  delete_sessions_confirm/ui.common.cancel/delete），M1 迁的是 useChatTabScope 的同款，
  controller 副本漏网。
- ChatConversationPanel/ChatSessionListPanel/SummaryTab/StatsFilterBar/RequestsTab/
  CloudSyncStorageScreen/DirectoryRuleSheet/config-forms/agent 等——更早批次未迁移面，
  与本波 MISS 口径无关，未清点。
- services 层（cloud-sync-progress-ui label 表、map-cloud-sync-sdk-error 等）与
  日志/console、协议哨兵——豁免类。

## 教训：共享 worktree 并行线的 checkout 竞态（与 D 线记忆互证）

D 线首投误带 M 线 staged 文件后 `git reset --soft` + `git restore --staged` 重投；同一
窗口本片正在做 nm-style 波前对照（`git checkout <波前> -- 23 文件` → 扫描 →
`git checkout HEAD -- 23 文件` 恢复），恢复步被并行线对 index/HEAD 的操作撞掉——23 文件
工作区静默退回波前版本（git status 全 M、内容是旧中文）。发现于归零自检 grep（台账行
「未接线」但 commit 里明明有），`git checkout HEAD -- <清单>` 二次恢复 + 重跑 typecheck
与全量 test（2384/2384）确认无损。**并行线共享 worktree 期间：checkout 到临时版本的
对照法要慎用，用了就必须在恢复后立即 grep 抽验内容 + 重跑验证；commit 带精确 pathspec
两线都已照做。**
