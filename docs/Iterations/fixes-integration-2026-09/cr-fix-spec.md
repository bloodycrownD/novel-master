---
date: 2026-09-19
node: spec-fix-wave1
---

# CR Fix Spec

集成分支 `fix/2026-09-fixes-integration` 第 1 轮 CR 的修复执行 spec。评审范围覆盖两条业务线：vfs-rename-rollback-fixes-2026-09（回滚恢复被删条目 + 桌面端改名幽灵目录）与 agent-session-fixes-2026-09（智能体被删后放开会话重选）。本文件由四个 review-scope 节点的评审结论汇拢落盘，下游按 Must-fix 条目执行。

## 元信息

- repo: novel-master（/home/bloodycrown/Dev/novel-master）
- base_sha: c34a3821
- head_sha: e932a6f0
- review_round: 2
- dag_version: 3
- 状态: fix-spec-ready（review-full round2 判定通过，待用户确认开工）
- prd_path（只读参考，勿改）:
  - docs/Iterations/vfs-rename-rollback-fixes-2026-09/prd.md
  - docs/Iterations/vfs-rename-rollback-fixes-2026-09/bugs/rollback-restore-deleted-entry/prd.md
  - docs/Iterations/vfs-rename-rollback-fixes-2026-09/bugs/desktop-rename-ghost-dir/prd.md
  - docs/Iterations/agent-session-fixes-2026-09/prd.md
  - docs/Iterations/agent-session-fixes-2026-09/bugs/session-agent-locked-after-delete/prd.md
- spec_path（只读参考，勿改）:
  - docs/Iterations/vfs-rename-rollback-fixes-2026-09/bugs/rollback-restore-deleted-entry/spec.md
  - docs/Iterations/vfs-rename-rollback-fixes-2026-09/bugs/desktop-rename-ghost-dir/spec.md
  - docs/Iterations/agent-session-fixes-2026-09/bugs/session-agent-locked-after-delete/spec.md

## Must-fix

按 P0→P1→P2 排列。本轮评审结论中无 P0 级条目，自 P1 起。

### 1. rsrr/B-1 [P1] 同路径异 entry 时 findMissingRevisionPointers 未做同源判定——误报 BACKFILL_REQUIRED 阻断回滚且漏检真缺失

- 维度：B
- 文件：`packages/core/src/domain/message-checkpoint/logic/detect-missing-revisions.ts:43-52`
- 问题：`restore-path.ts:130-144`、`restore-path.ts:243-255`、`resolve-reconcile-paths.ts:64-71` 三处都有「live entry ≠ checkpoint 旧 entryId ⇒ 独立版本空间」的 diverged 语义，missing 探测没有。删除后同路径重建场景：checkpoint 指针 (E1,V)，代码查 (E2,V)——V 超过 E2 最大版本时误判 missing → 回滚默认抛 REVISION_BACKFILL_REQUIRED（违反 PRD 验收 2 主路径「旧内容回来」）；反向 (E2,V) 恰好存在而 (E1,V) 真缺时不报 missing → restore 抛 restore-missing 被包成 VFS_RESTORE_FAILED 整体失败，绕过 backfill 确认流。既有测试未暴露是因锚点只写一次（V=1）与重建 v1 数值巧合。
- 改法：循环内取 live entry 后加同源分支（checkpointEntryIdByPath 可得时，`entry.entryId !== cpEntryId` 则按 cpEntryId 组对寻址），代码形态对齐 `resolve-reconcile-paths.ts:64-71`。
- 验收/测试：新用例①锚点前写两次（V=2）→ 删除 → 同路径重建一次 → 不带 revisionHeadBackfill 回滚直接复现旧内容；用例②diverged + 手工删 (E1,V) revision 行 → 走 BACKFILL_REQUIRED/降级而非 VFS_RESTORE_FAILED。
- 来源：review-scope-rollback-restore round1

### 2. rg/G-1 [P1] session 分支空目录 rename 零覆盖且用例注释记录了与实现相反的错误事实

- 维度：G（A 关联）
- 文件：`apps/desktop/test/vfs-rename-handler.test.ts:152-156`
- 问题：注释称「纯空目录 rename 属 core 既有 NOT_FOUND 行为不在修复范围」，但 core 修复（59851835 read IS_DIRECTORY 判目录）对 session 分支（executeSessionUserVfsOp→fs mv→moveVfsPath）同样生效，注释过时误导；desktop 两分支均无空目录穿透用例。
- 改法：改写注释为「core 已支持空目录 rename」；补 session 分支空目录用例（mkdir → setDirRule → rename → 断言 ok + 旧规则 undefined + 新规则保留），可顺带 project 分支空目录对照。
- 验收/测试：新用例全绿，注释不再声称空目录必 NOT_FOUND。
- 来源：review-scope-rename-ghost round1

### 3. rg/C-1 [P1] ALREADY_EXISTS→「名称不能重复」映射三处未收敛，core 文案表缺 case

- 维度：C（DRY）
- 文件：`packages/core/src/domain/vfs/logic/format-vfs-error-for-user.ts:43-57`、`apps/desktop/renderer/features/workspace/workspace-actions.ts:34-35`、`apps/mobile/src/components/vfs/VfsFileManager.tsx:792-793`
- 问题：core formatVfsErrorCodeMessage 无 ALREADY_EXISTS case（落 default「操作失败：path」），desktop/mobile 各自本地补映射，同一知识三处分叉。
- 改法：core switch 加 `case "ALREADY_EXISTS": return "名称不能重复"`；desktop 删本地 ALREADY_EXISTS 分支（vfsActionErrorMessage 退化为直调 formatVfsErrorForUser）；mobile 792-793 改用 formatVfsErrorForUser(err)。
- 验收/测试：desktop workspace-actions.test 既有 ALREADY_EXISTS 用例不回归；core 补 formatVfsErrorForUser(ALREADY_EXISTS) 断言。
- 来源：review-scope-rename-ghost round1

### 4. au/B-1 [P1] chat-tab 顶栏「未加载」被误判「已删待重选」——加载窗口可点击甚至静默改绑（回归验收 3）

- 维度：B
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:40-48,88,137,149`、`apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx:166-175,271`、`apps/mobile/src/components/chat/ChatMetaBar.tsx:29`
- 问题：agentMeta state 为非空 ChatAgentMeta、初始 EMPTY_AGENT_META（source:'none'）→ isAgentLocked 恒 false、isAgentDeleted(EMPTY) 恒 true：首屏/切会话 meta 在途窗口即可点击并弹「已被删除」toast，选择会直接改写会话绑定；refreshChatMeta 失败也回退 EMPTY → 永久误呈已删态。修复前 `!meta||source!=='session'` 恰好锁住，本次拆分使其失效（回归）。
- 改法（推荐方案，落 spec 时写明波及面）：useChatTabScope 的 agentMeta state 改 `ChatAgentMeta|undefined`——refreshChatMeta 开始置 undefined、成功才 set；137 行无项目/无会话分支与 149 行 catch 分支置 undefined（绝不能用 source:'none' 占位）；ChatMetaBar meta prop 放宽为可 undefined（undefined 按锁定/占位渲染）；ChatConversationPanel:271 agentMeta.hasDedicatedModel 取值兜底。（备选：meta 加 loaded 标志，任选其一但三处同步。）
- 验收/测试：a) none 态点 agent 卡弹 picker+重选 toast；b) meta 未加载点 agent 卡不开 picker（EMPTY→loaded 窗口断言必须包含）；c) refreshChatMeta 失败后呈锁定/错误占位而非待重选。
- 来源：review-scope-agent-unlock round1

### 5. rsrr/B-2 [P2] diverged 路径 backfill 寻址仍指 live 新 entry——伪造占位 revision 且引用泄漏

- 维度：B
- 文件：`packages/core/src/domain/message-checkpoint/logic/restore-path.ts:275`
- 问题：`const backfillEntryId = entryId ?? cpEntryId` 在 diverged 时永远打在 E2 上：伪造 active 占位行（content_hash 取 E2 当前内容）、adjustRef(+1) 无人持有永不 GC、E2 版本序列留空洞；restore 碰巧结果正确但留垃圾。
- 改法：`diverged = cpEntryId != null && entryId != null && cpEntryId !== entryId` 时 backfillEntryId 取 cpEntryId（真缺按旧 entryId 回补墓碑，与纯删除降级语义一致）。
- 验收/测试：diverged + 确认重试（revisionHeadBackfill:true）后无 E2 伪造行（断言 revision 表）。
- 来源：review-scope-rollback-restore round1

### 6. rsrr/G-1 [P2] diverged 语义缺「锚点版本高于重建 entry」行为测试

- 维度：G
- 文件：`packages/core/test/message-checkpoint/rollback-restore-deleted-entry.test.ts:29-109`
- 问题：现有 diverged 用例 V=1 与重建 v1 数值巧合，短路失效未被证明。
- 改法：并入 B-1 的两条新用例（同一波执行，spec 中注明关联）。
- 验收/测试：同条目 1（rsrr/B-1）的两条新用例覆盖本条，不单独新增文件。
- 来源：review-scope-rollback-restore round1

### 7. rg/G-2 [P2] 路径含 %/_ 的 rename 无测试锚定

- 维度：G
- 文件：`packages/core/test/vfs/vfs-rename-primitive.test.ts`、`packages/core/test/vfs/vfs-move.test.ts`
- 问题：renamePrefixInScope 依赖 escapeLike + ESCAPE '\' 子项匹配（实现正确）但本次改动直接依赖该链路，含 %/_ 目录名无回归锚点。
- 改法：补用例 mkdir(`/a_b%c`) + write 子文件 → renamePrefix 到 `/新_名%d` → 断言根行与子项迁移、旧路径无残留；vfs-move.test 可加一条含 % 名 moveVfsPath。
- 验收/测试：新用例全绿，%/_ 路径下根行与子项迁移正确、旧路径无残留。
- 来源：review-scope-rename-ghost round1

### 8. rg/G-3 [P2] workspace-actions 文案测试缺 create 失败与 default 分支

- 维度：G
- 文件：`apps/desktop/test/workspace-actions.test.ts`
- 问题：spec 用例 6 四态实际只覆盖两态半。
- 改法：补①stub ipcVfsMkdir 返回 NOT_FOUND → createWorkspaceEntry 返回「文件不存在或已被删除。」；②stub rename 返回 `{code:"SOMETHING",message:"x"}` → 断言「操作失败：x」。
- 验收/测试：两条新用例断言文案与 spec 用例 6 四态对齐。
- 来源：review-scope-rename-ghost round1

### 9. au/C-orch-2 [P2] ChatError 归一集合双端不对称 + 「已被删除」文案覆盖错误成因

- 维度：C-orch
- 文件：`apps/mobile/src/services/chat-agent-meta.ts:98-113`、`apps/desktop/src/main/ipc/handlers/prompt.ts`（内层 catch）
- 问题：resolveAgentForProject 抛的 ChatError（配置缺失等）mobile 归一 none → 呈「已被删除·点击重选」（错误归因）；desktop 落 ok:false → 锁死。本次拆分使不对称显性化，与 spec「双端行为对称」冲突。
- 改法（推荐方向 b，标注待用户确认）：双端口径统一为「AgentRunResolveError → source:'none'（待重选）；ChatError 等其它异常 → 报错态（锁定+错误文案，不弹已删语义）」——mobile 收窄归一集合至仅 AgentRunResolveError；desktop B-3 同步（见条目 10）；文案「智能体已被删除」仅覆盖 AgentRunResolveError 成因，ChatError 场景用「智能体信息加载失败」类文案。
- 验收/测试：mobile 单元：ChatError → isAgentDeleted 为 false 且不可弹重选；两端源码断言/单元对齐。
- 来源：review-scope-agent-unlock round1

### 10. au/B-3 [P2] desktop meta 加载失败静默且文案误导（「加载中请稍候」永不发生）

- 维度：B
- 文件：`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:131-142,233,241-245,460-468`
- 问题：metaRes.ok===false 完全静默，meta 停 null 呈 🔒「智能体未绑定」+点击 toast「加载中请稍候」——失败态冒充加载中，无重试入口（重开抽屉才重试）。
- 改法：metaRes.ok 为 false 时 showToast(metaRes.error.message)（或区分「加载失败」文案）；badge 在 meta==null 时改「加载中…」语义与失败 toast 区分；与条目 9 同主题执行避免双端再失配。
- 验收/测试：mock ok:false 断言错误 toast；badge 三态（加载中/失败后 null/已删待重选）文案区分。
- 来源：review-scope-agent-unlock round1

### 11. au/G-4 [P2] chat-tab 两消费方零测试覆盖

- 维度：G
- 文件：`apps/mobile/__tests__/chat-conversation-panel.integration.test.tsx:118-126` 等
- 问题：ChatConversationPanel/ChatMetaBar（含本次 openAgentPicker 改动）无用例；desktop「加载中不可点」仅源码正则断言。
- 改法：补 chat-tab 集成用例 a) none 态点 agent 卡开 picker+toast；b) 未加载不可点；c) 详情页切换成功 onSelected→load() 重拉断言。（与条目 4 的用例同波执行可合并。）
- 验收/测试：三条集成用例全绿，与条目 4 的验收用例可合并且互不遗漏。
- 来源：review-scope-agent-unlock round1

## Spec deviations

- open：vfs spec 变更点 81f24af0 声称 findMissingRevisionPointers 已按旧 entryId 寻址——实际只覆盖 entry==null 分支（=条目 1，修复后转 fixed）。
- open→随条目 4/9/11 修复闭合：agent-unlock spec「加载中仍锁」「双端对称」「三消费方同步」与实现的三处偏差。
- 既有声明无问题：rename 快照语义、断言翻转 3 处、迁移回填规则（评审确认与 spec 一致）。

## Open questions / 待拍板

（不阻塞执行，列给用户拍板）

1. PRD 验收 3 措辞（「不抛 BACKFILL_REQUIRED 阻断」）vs 实现（默认抛+UI 确认重试，双端既有 UX）——建议按现状收窄 PRD 措辞并补 no-option 行为断言；需用户拍板。
2. 迁移回填「冻结时点」语义确认（回填后存量行 rename 不再跟随现路径——spec 已声明，确认即可）。
3. loadFilePointerTree 同 path 双行（快照行 vs NULL 回退行）覆盖顺序不确定——极 corner，是否加确定性优先级。
4. rename-ghost 四条既有项：REPLACE 中段子串误替换（旧问题）、rename 与规则迁移非原子窗口（既有惯例）、filterGhostConfiguredPaths O(M×N)（当前规模可接受）、mobile vfsPathSet 冗余（判定为可接受平台兜底）。
5. agent-unlock 五条既有项：model 锁 agent-pin 分支双端差异、desktop 切换失败静默、mobile 详情页加载失败停留「加载中」、AGENT_LOCK_TOAST_GUIDE/STATEMENT 拆分后文案相同是否合并、ChatMetaBar 无待重选 badge。

## 已豁免（用户确认不修）

本轮暂无条目。Open questions 第 4/5 条所列既有项若经用户拍板确认不修，移入本节登记。

## 合并后 QA（manual_user）

真机/桌面走查：

- 删除文件 → 回滚复现（含删除后重建再回滚）；
- 空目录改名（含 chat 面板）；
- 删智能体 → 会话重选（详情页 + 聊天顶栏，注意加载窗口不可点）；
- VFS 操作失败中文文案。

## K 节建议（下游执行时闭合）

- 全部条目执行后：core 全量测试 + 双端定向测试 + 根 typecheck + dist 重建（mobile 端联调需要）+ CHANGELOG 若有条目影响用户可感知行为（如条目 9/10 的错误文案）评估补条目。
- 顺带清理：shell.css 归属 scope 修正（评审口径，无需改代码）。

review-full round2 补充（执行时带上）：

- 条目 3 执行时同步清理 `workspace-actions.ts:26-29` `vfsActionErrorMessage` JSDoc 中「ALREADY_EXISTS 单独映射」的过时描述（删分支的自然延伸）。
- 条目 10 执行时 `metaRes.error.message` 来自 main 侧 `formatIpcError` 可能直出英文——固定中文兜底文案（如「智能体信息加载失败」）而非直接透出 message。
- `ensure-directory-chain.ts` 的 `ensureDirectoryChain` JSDoc 为英文一行，顺带补中文说明（该层存量英文注释普遍，非阻塞）。
- （可选微优化，不必须）`loadFilePointerTree` 的 `hasCheckpoint` 前置探测可合并为 LEFT JOIN `message_checkpoint` 单查询省一次往返；当前双查询为必要语义判定，非缺陷。

### migration 清理核查结论（本轮无动作）

- 本轮（第五轮）无可退役项：退役线 v1.5.9，四条在册 migration 首发 v1.5.12（retire-pref-session-fs-version-check-v1）/ v1.5.17（workplace-dir-rule-smart-field-v1、rename-smart-sort-rule-example-v1、add-smart-sort-capture-kind-v1）均新于退役线；add-mcp-file-path-snapshot-v1 未发布必留。
- 下次窗口：v1.5.22 时 retire-pref 到窗（届时 BASELINE 12→13 条、最低支持 v1.5.5→v1.5.13）；v1.5.27 时 smart-sort 三条同窗（最低支持→v1.5.18，届时需先解决 OQ-1 rebuild 探针与 OQ-2 builtin 描述兜底两个前置）。
- 现状核对无问题：注册表 5 条、BASELINE_MIGRATION_IDS 12 条/最低支持 v1.5.5、新迁移登记阵尾、SCHEMA_BOOT_VERSION=14 不动。
