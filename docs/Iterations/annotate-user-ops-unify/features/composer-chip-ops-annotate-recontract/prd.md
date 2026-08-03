---
date: 2026-07-23
dependency:
  - Iterations/annotate-user-ops-unify/prd.md
  - Iterations/message-attachment-unified/prd.md
  - Iterations/message-attachment-unified/features/composer-ops-chip-lifecycle/prd.md
  - Iterations/mobile-chat-composer-annotate-ux/prd.md
---

# composer-chip-ops-annotate-recontract Feature PRD

> 敏捷名称：`composer-chip-ops-annotate-recontract`  
> 挂靠迭代：`annotate-user-ops-unify`  
> 平台：Mobile + Desktop（合同双端一致；实现可分批）  
> 性质：状态 chip 与规则快照合同重订  
> SPEC：同目录 `spec.md`  
> **相对前稿：Undo 不再恢复手改**（盘已回发送前，本轮手改一并作废；批注仍可从附件恢复）  
> **局部 supersede**：
> - `composer-ops-chip-lifecycle`：状态条含 workplace「规则」差集 chip；置位/压缩后无叉条必须清空（含强制 `attachments:[]`）  
> - `message-attachment-unified` / `chat-send-render-refactor`：规则变更**不**刷新 `rule_snapshot`、靠 workplace 增量通知模型；仅规则差集可空发（T-SR1 / T-SR1b）  
> - chip 文案：`mkdir` 显示「建目」——改为与建文件同为「创建」  
> - 父 SPEC 中 workplace 差集进状态 chip / 可空发 / `mkdir→建目` 等口径：见 `annotate-user-ops-unify/spec.md` supersede 指针

## 背景与变更动机

当前状态条实际有三类：规则差集（`规则:path`）、手改 user ops、批注。规则侧故意做成「常驻前缀冻旧快照 + 差集进 chip + 发送再 materialize」，带来两套复杂路径：用户以为规则 chip 是本轮附件，实际上前缀与增量各走各的；回滚 / 置位 / 压缩对 KKV 与 chip 的处理也不对称。

产品上更干净的切分是：

- **规则**属于 Workplace 本身：一改就进常驻快照，不再当本轮 chip / 消息增量。
- **手改与批注**才是「跟输入框、跟本轮消息」的状态 chip：自带要交给模型的内容，和正文 `@path` 引用不是一类东西。

## 范围说明

### 纳入

1. **规则变动移出状态 chip**  
   保存规则后：立刻刷新 `rule_snapshot`，并**清空**该 session 的 `file_cache`（不要求当场预填正文）。下次拼装常驻前缀时按新快照路径懒加载（cache miss → 读 VFS → 写回 cache）。  
   不再投影「规则:path」chip；发送时不再 materialize 本轮 `workplaceChange` 差集附件（历史消息里已有的 workplace 附件仍可展示/兼容）。

2. **状态 chip 仅保留手改 + 批注**  
   - 手改：创建 / 编辑 / 删除 / 重命等（落库 `action` 可仍区分 `write`/`mkdir` 等）  
   - 批注：`批注:path`（按 path 聚合）  
   - **文案**：`mkdir` 与建文件统一显示为「创建」，不再使用「建目」。

3. **空发门闩**  
   只改了规则、输入框为空、且无手改/批注 chip 时：**不能发送**（UI 与 Core 双闩）。规则变更靠下次对话的常驻前缀生效，不靠空发一条消息。全链路去掉 `hasWorkplaceDelta` 可发语义。

4. **回滚（undo_send）**  
   Undo 仍滚到「该消息之前」的盘（现网 prior，不变）。盘已回到发送前，**本轮手改 user ops 一并作废**：不反投影手改 chip，不做 restored 旁路再带回 Composer。  
   - 手改 chip：**不恢复**；`user_vfs_pending` 随 truncate 清空即可  
   - 批注：仍从锚点附件恢复工作区批注草稿 + 批注 chip（字段：`action`/`path`/`originalText`/`userAnnotation` 足够；draft id 可新 mint；Mobile 已有，Desktop 补齐）  
   - 正文：回填到输入框  
   双端对齐（Desktop Undo 顺序对齐 Mobile：truncate → 可先空条 → 正文 → 反投影 annotate → ∪ chip）。

5. **置位 / 压缩**  
   与「不清输入框正文」同理：**不清**当前输入框里的手改/批注 chip（及批注草稿 store）。  
   KKV：**只** `clearDomain(rule_snapshot)` + `clearDomain(file_cache)`，**保留** `user_vfs_pending`；**废除**成功钩子终态强制 `attachments:[]`，改为 project(ops) ∪ annotate。产品口径是 chip 生命周期跟输入框，不跟置位/压缩。

6. **Undo 与规则前缀**  
   常驻前缀因规则变更出现的新文件，来自 Workplace，不是某条消息的 `@` 引用。Undo **不必**、也**不能**指望收回「模型刚在前缀里看到的新文件」；这是预期行为。

### 不纳入

- 重做 `@path` 双管道或 attach chip  
- 跨节点批注高亮（见 `annotate-cross-node-highlight`）  
- 消息正文批注（已拆除）  
- 强制统一 Desktop/Mobile WebView 宿主  
- Undo 后把手改 chip / 附件旁路带回 Composer 再发

## 影响模块与接口（意向）

| 区域 | 意向 |
|------|------|
| 规则保存钩子 | `refreshRuleSnapshot` + 清 `file_cache`；去掉 workplace 差集 suggest/投影 |
| Composer 状态投影 | 仅 user_ops + App ∪ annotate；无 workplace 半边 |
| 发送 / 空发 | 去掉「仅规则差集可发」与 `hasWorkplaceDelta`；无正文且无手改/批注则不可发 |
| 回滚 | 盘 prior；正文回填；批注从附件恢复；**手改不恢复**（pending 随 truncate 清空） |
| 置位 / 压缩成功钩子 | 清域收窄；project∪annotate；不再强制 `attachments:[]` |
| chip 文案 | `mkdir` → 「创建」 |

## 验收标准

1. **Given** 用户只改了规则且输入框为空、无手改/批注，**When** 尝试发送，**Then** UI 与 Core 均不可发送；状态条无「规则:」chip。  
2. **Given** 用户改规则后发起下一轮有效发送，**When** 拼装常驻前缀，**Then** 使用刷新后的 `rule_snapshot`；`file_cache` 可按路径懒加载。  
3. **Given** 存在手改与批注草稿，**When** 看状态条，**Then** 仅见对应手改/批注 chip；`mkdir` 显示为「创建」。  
4. **Given** 已发送含手改与批注附件的用户消息，**When** Undo Send，**Then** 正文回填；**手改 chip 不恢复**（pending 随 truncate 清空）；批注可从附件恢复工作区草稿 + chip（双端；Desktop 顺序同 Mobile）。  
5. **Given** 输入框已有手改或批注 chip，**When** 置位或压缩成功，**Then** 正文与这些 chip（及批注草稿、pending）仍在；状态条终态不是空 `[]`。  
6. **Given** 规则变更使前缀出现新文件后用户 Undo 某条消息，**When** 看常驻前缀，**Then** 不要求前缀回到改规则之前（Undo 不撤回 Workplace 规则）。

## 测试用例（草案，与 SPEC T-CR* 对齐）

- 规则保存 → snapshot 更新、cache 空、无规则 chip、不能空发（废止 T-SR1b 可空发）  
- 手改 + 批注可发；发送后清空本轮 chip/草稿（既有「一次性」合同保留）  
- Undo：正文回填；批注草稿/chip 恢复；**手改 chip 不出现**；pending 已空；伪 `__message__:` 仍跳过  
- 置位/压缩：正文与 ops/批注 chip 保留；**废止**旧「强制 attachments:[]」终态（对照 T-LF1 改写）  
- chip 文案：`write`/`mkdir` 均显示「创建」  
- 历史消息上已有 `workplaceChange` 附件：气泡/旧数据只读兼容，不再生效为新 chip 合同

## 待 SPEC / 产品拍板

- ~~置位/压缩时 `user_vfs_pending` / `rule_snapshot` / `file_cache` 各域策略~~ → **已钉**（SPEC D7：清 snapshot+cache，保留 pending）  
- ~~回滚时手改是否写回 pending / 旁路恢复~~ → **已钉**（**不恢复**手改；盘 prior + pending 随 truncate 清空；批注仍从附件恢复）  
- **手动重置常驻**：是否仍 `clearSession`（含 pending）——SPEC 已给默认建议与已知限制，**待产品确认**  
- 历史 `source:workplace` 附件在提示词重放中的兼容策略（SPEC D9：只读兼容；细节随 prepare 现网）
