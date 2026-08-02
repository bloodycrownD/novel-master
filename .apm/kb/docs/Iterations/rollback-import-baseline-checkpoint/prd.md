---
date: 2026-08-02
dependency:
  - Iterations/character-card-import/prd.md
  - Iterations/message-checkpoint-v2/prd.md
  - Iterations/message-rollback-execution-redesign/prd.md
---

# 回滚后工作区被清空 Bugfix PRD

## 背景

写作者常用的一个工作流是：在会话里先导入一张角色卡（或导入 ZIP），把人设、开场、世界书铺成工作区的 Markdown 文件，然后基于这些素材和 Agent 聊几轮。聊到某个分叉点想反悔时，会用到「撤销发送」或「回退到此消息」把对话和工作区一起退回去。

这套流程在 `character-card-import` 落地之后、`vfs-version-redesign` 与 `message-rollback-execution-redesign` 两轮大改之前是正常的；但在 VFS 大迭代之后出现了退化：导入角色卡聊几轮，再回滚到第一条用户消息时，整个工作区里的文件会被**全部清空**，而不是退回到导入完成后的样子。

排查下来根因是两条叠加的：一是导入（角色卡 / ZIP）属于 out-of-band 写入，它直接改 live file head，**不经过**打 checkpoint 的那条路径，所以导入产生的文件状态从来就没有被任何 message 的 checkpoint 记录下来；二是 `undo_send` 在锚点之前没有任何 checkpoint（prior 为空）时，会把 targetTree 当作空树来 diff，于是「对齐空基线」就被理解成「把所有 live 文件删光」。两条合起来就是用户看到的现象——导入的文件压根没进 checkpoint，回滚时又拿空树当基线，自然删光。

VFS 大改之前能工作，是因为当时导入路径里有给当前消息补 baseline 快照的逻辑，大改之后这条接线丢了。本迭代要做的就是把这条基线补回来，同时给回滚加一道兜底，避免类似空窗场景再变成「删光」。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 导入后回滚不再清空工作区 | 导入角色卡或 ZIP 之后，聊若干轮再撤销发送到首条 user message，工作区文件回到导入完成后的样子，而不是被删空 |
| 不破坏既有 checkpoint 语义 | 导入时只为「最后一个有 checkpoint 的消息之后」的空窗消息补 baseline；已有 checkpoint 的消息（及其之前的消息）一律不动 |
| 回滚基线兜底 | 即便出现「锚点之前没有任何 checkpoint」的极端空窗，回滚也退到锚点自身的 checkpoint，而不是把工作区当空树删光 |
| 双入口同语义 | 角色卡导入和 ZIP 导入走同一条 backfill 路径，行为一致；非 session scope（workplace / project）不触发 backfill |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作前期铺设定的作者 | 新建会话 → 导入角色卡 → 聊几轮 → 撤销第一条发送，希望文件原封不动地留在导入后的状态 |
| 用 ZIP 迁移素材的作者 | 导入一个整理好的 ZIP → 聊几轮 → 回退到首条消息，希望导入的文件不被清空 |
| 聊到一半又导入新素材的作者 | 会话已有 checkpoint 的消息若干条之后，再导入一次角色卡，希望新补的 baseline 只覆盖导入点之后的空窗，不影响之前已记录的 checkpoint |

## 范围

### 包含范围

1. **导入事务末尾补 baseline checkpoint**：角色卡导入与 ZIP 导入在 session scope 的事务末尾，调用统一的 backfill 逻辑，给空窗消息补一条指向当前 live file heads 的整树快照。
2. **undo_send 空基线兜底**：当锚点之前没有任何 checkpoint（prior 为空）时，回退到锚点自身的 checkpoint 作为 targetTree，而不是空树。
3. **回归测试**：覆盖「导入 → 聊几轮 → 撤销发送到首条」主路径，以及「中途有 checkpoint 之后再导入」的局部 backfill 边界。

### 不包含范围

1. 不改变 checkpoint 的整树指针语义（仍按 `message-checkpoint-v2` 的产品合同）。
2. 不改 rewind 的基线选取规则，只在 undo_send 的 prior 空窗加兜底。
3. 不引入「导入也算一次 capture」之类的产品概念调整——导入在产品上仍是一次 out-of-band 写入，只是事后补一条 baseline 快照用于回滚兜底。
4. 不处理 workplace / project scope 的导入（非 session scope 不触发 backfill）。

## 核心需求

1. **backfill 只补空窗**：从会话里「最后一个有 checkpoint 的消息」的下一条开始补；如果整个会话都没有 checkpoint，则从第一条消息补起。已有 checkpoint 的消息及其之前的消息一律不碰。
2. **baseline 指向当前 live 状态**：补的 checkpoint 记录的是导入完成那一刻工作区里所有文件的 live head（entryId + headVersion），不引入额外的内容拷贝。
3. **与导入同事务**：backfill 在导入事务内完成，导入失败回滚时 backfill 也一起回滚，不会留下半截快照。
4. **双入口同路径**：角色卡导入和 ZIP 导入调用同一个 `backfillBaselineCheckpoints`，行为一致。
5. **undo_send 兜底**：prior 为空时退到锚点自身 checkpoint，语义是「回滚到锚点完成态」，而不是「删光」。

## 验收标准

- [ ] **Given** 一个空会话，导入角色卡后聊两轮，**When** 用户撤销发送回到首条 user message，**Then** 工作区文件仍在且内容等于导入完成后的状态，没有被清空。
- [ ] **Given** 会话里消息 1/2/3 已有 checkpoint，消息 4/5/6 没有，**When** 在消息 6 之后导入角色卡，**Then** backfill 只给 4/5/6 补 baseline checkpoint，1/2/3 的 checkpoint 不变。
- [ ] **Given** 会话里没有任何 checkpoint（纯导入后聊了几轮），**When** 撤销发送到首条 user message，**Then** 回滚退到首条消息自身的 baseline checkpoint，工作区保留导入的文件。
- [ ] **Given** 导入事务在中途失败，**When** 事务回滚，**Then** 不会留下任何 backfill 写入的 checkpoint 行。
- [ ] **Given** workplace / project scope 的导入，**When** 导入完成，**Then** 不触发 backfill（行为与现网一致）。

## 约束与依赖

- 延续 `message-checkpoint-v2` 的整树指针语义与 `message-rollback-execution-redesign` 的回滚执行合同，本迭代只补数据、加兜底，不改对外语义。
- 依赖导入事务本身已经在 session scope 内完成 live file head 的写入（backfill 读取的就是这些 head）。

## 风险与待确认项

- backfill 会给空窗里每条消息都写一整树 checkpoint，文件多、消息多时写入量与现网「每条 agent 消息打一次整树 checkpoint」量级相当，可接受；如后续要把 checkpoint 改成只记变更，留给 `message-rollback-execution-redesign` 的后续增强。
- undo_send 兜底改了「prior 为空」这一支的行为（从删光变成退到锚点 checkpoint），这是对错误行为的修正，R2 测试断言已相应更新。
