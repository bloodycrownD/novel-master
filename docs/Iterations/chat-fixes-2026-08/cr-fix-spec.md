# CR Fix Spec: chat-fixes-2026-08

> 状态：draft ｜ review_round 1 ｜ dag_version 2
> 本 spec 只约束修复项，不改动业务行为定义；业务口径以 [spec.md](./spec.md) 为准（只读参考）。

## 元信息

| 项 | 值 |
| --- | --- |
| repo | /home/bloodycrown/Dev/novel-master（worktree `.woktree/chat-fixes-2026-08`，分支 `feat/chat-fixes-2026-08`） |
| base_sha | `574c6de` |
| head_sha | `96ae526` |
| prd_path | 无（用户口述） |
| spec_path | `docs/Iterations/chat-fixes-2026-08/spec.md` |
| review_round | 1 |
| dag_version | 2 |
| 状态 | draft |

must-fix 共 6 条，全部 P2（无 P0/P1）。维度图例：C=core、A=android/mobile、G=general（跨端/测试基建）。

## Must-fix（按 P0 → P1 → P2）

本轮无 P0、P1；以下为 6 条 P2。

### review-scope-core/C-1 [P2] [C] 测试文件残留已删除接口的 mock stub

- **文件**：
  - `packages/core/test/service/agent/run-agent-turn.test.ts:18-19`
  - `packages/core/test/service/agent/annotate-drafts-send.test.ts:41-42`
  - `packages/core/test/service/agent/run-agent-turn-abort-registry.test.ts:51-52`
  - `packages/core/test/service/agent/subsession-workspace-isolation.test.ts:85-86`
  - `packages/core/test/service/agent/run-agent-turn-project-agent.test.ts:42-43`
- **问题**：5 个测试文件的 `mockUserVfsTurn` 仍带 `previewUserOpsChangedPaths` / `previewUserOpsActions` stub；这两个接口成员已在 `96ae526` 从 `UserVfsTurn` 删除，stub 属于残留死代码，mock 形状与真实接口已不一致。
- **改法**：5 处 mock 删掉这两行 stub，只保留 `executeOp`。
- **验收/测试**：
  - `grep -rn "previewUserOpsChangedPaths\|previewUserOpsActions" packages/core/test/` 零残留；
  - core 全量测试仍绿。
- **来源**：review-scope-core r1

### review-scope-core/C-2 [P2] [C] `userVfsTurn` doc 注释描述已删除的 flush 编排行为

- **文件**：`packages/core/src/service/agent/run-agent-turn.ts:118-120`
- **问题**：`AgentTurnRuntimePort.userVfsTurn` 的 doc 注释仍在描述已删除的 flush 编排行为，注释与现状不符。
- **改法**：注释改为现状描述——`executeOp` 由 VFS 写链路直接消费，本模块不再使用该成员。成员本身的去留见 Open questions，不在本条处理范围。
- **验收/测试**：注释与代码实际行为一致（人工核对）。
- **来源**：review-scope-core r1

### review-scope-core/G-1 [P2] [G] `resolve-hide-message-range` 缺 to 侧「tool_use 无配对 tool_result」显式用例

- **文件**：`packages/core/test/.../resolve-hide-message-range.test.ts`（用例补入该文件）
- **问题**：缺少 to 侧「tool_use 无配对 tool_result（崩溃残留）」的显式测试用例，边界行为未被测试锁住。
- **改法**：补一条用例——to 边缘为 assistant(tool_use `t_x`)、后续 user 消息只含其他 `toolUseId` 的 result，断言 `toSeq` 不变（不外扩）。
- **验收/测试**：新用例通过，并锁住「找不到配对 result 不外扩」的行为。
- **来源**：review-scope-core r1

### review-scope-mobile/A-1 [P2] [A] unhide 分支 reload 失败误报「取消隐藏失败」

- **文件**：`packages/mobile/.../useChatTabMessages.ts`（unhide 分支，约 L694-712）
- **问题**：`showMessagesInRange` 成功后若 `reloadMessages` 抛错，会落进同一 catch 弹出「取消隐藏失败」toast——但此时 DB 已生效，提示与实际状态不符。
- **改法**：`showMessagesInRange` 成功后对 `reloadMessages` 单独 catch，toast 口径改为「已取消隐藏，但列表刷新失败」；`refreshChatTokenLabel` 保持 void 吞掉（与 rollback 段风格一致）。
- **验收/测试**：单测覆盖 reload 失败路径，断言提示文案为「已取消隐藏，但列表刷新失败」。
- **来源**：review-scope-mobile r1

### review-scope-mobile/G-1 [P2] [G] composer「仅批注草稿可发」缺组件级镜像用例

- **文件**：`packages/mobile/.../chat-composer.integration.test.tsx`（用例补入该文件）
- **问题**：删除 T-UOL9 后，「仅批注草稿可发」（T-UO3）只剩纯函数级覆盖；而 ChatComposer 本轮换了接线（`hasPendingUserOps` → `hasAnnotateDrafts`），组件级行为未被测试钉住。
- **改法**：补 annotate 镜像用例——无正文 + 仅 annotate 草稿时发送键可点，且 `mockRunAgentTurn` 收到 `annotateDrafts`；顺带断言无正文、无批注时不可发。
- **验收/测试**：新用例通过。
- **来源**：review-scope-mobile r1

### review-scope-desktop/G-1 [P2] [G] annotate store 测试隔离钩子缺失 + 未使用 import

- **文件**：`apps/desktop/test/messages-rollback-annotate-clear.test.ts:9`
- **问题**：`import resetChatAnnotateDraftStoreForTests` 未使用——本次 diff 唯一新引入的 lint 噪音，且旧测试的 store 隔离钩子丢了。
- **改法（推荐）**：补 `beforeEach(() => resetChatAnnotateDraftStoreForTests())` 恢复隔离习惯，与同批改写的 `notify-composer-status-after-kkv-clear.test.ts` 对齐。
- **验收/测试**：eslint 该文件零 warning；该测试全绿。
- **来源**：review-scope-desktop r1

## Spec deviations

以下均为 fixed-记录态（已发生、已核，不要求回改代码）：

| # | deviation | 处理 |
| --- | --- | --- |
| 1 | T-UH3 镜像方式与 spec 措辞不符 | 仅记录；建议后续修订 spec L165 措辞（见 K 节建议） |
| 2 | B-mobile 收窄为单点归一 | 仅记录 |
| 3 | `prepare-user-vfs-turn-for-agent-run.ts` 整删 | 授权内评估结果 |
| 4 | `replaceComposerStatusAttachments` 两端拆除 | 必要同构修复，行为等价已核 |
| 5 | `previewUserOps*` 存根删除 | 同构清理 |

## Open questions / 待拍板

写入附录，不阻塞本 wave 合并：

1. **乱序 tool_result（跨 assistant 交错配对）形态**是否认定为不可达——协议上严格交替按序返回，评审判断不可达，待确认。
2. **`AgentTurnRuntimePort.userVfsTurn` 成员去留**：core 内已零消费，三端装配方可能仍传；是否跨端删除，待拍板。
3. **`chat-transcript-webview.test.tsx` 5 个 base 失败**：修复时顺带确认 force 改动未改变失败形态。
4. **STEP_COMMITTED flush 先于 `shouldApplyTranscriptReload` 判定**（freeze/abort-retain 场景提前 ≤64ms 送达）是否确认为预期。
5. **desktop main 侧 annotate store**：生产无写入方、pull/push main 投影恒空——是否为 D7 预期终态，两条通道未来价值待评估。
6. **base 存量 lint**（如 `ConversationPanel.tsx` no-restricted-imports error）：是否另开清理任务。

## 已豁免（用户确认不修）

无。本轮评审无用户确认豁免的条目。

## 合并后 QA（manual_user）

不阻塞合并，由用户在合并后执行（即业务 spec Step 15）：

- Android 真机回归：
  - 批注 chip 正常、发送正常；
  - prompt 无手改 XML；
  - 多轮 tool 流式不丢内容；
  - 取消隐藏菜单正常；
  - 分叉后选择器 / 详情页正常。

## K 节建议（下游执行时闭合）

执行完 6 条 must-fix 后：

1. 跑三端定向测试：core `test:fast`、mobile jest、desktop `run-tests`；
2. 跑三端 typecheck；
3. 顺手修正业务 spec L165 的 T-UH3 措辞：「漏重建会被 T-UH3 拦住」→ 实际由 pretest 自动重建兜底（对应 Spec deviations #1）。
