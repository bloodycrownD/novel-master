---
date: 2026-08-14
dependency: Iterations/prompt-block-lifecycle/prd.md
---

# macro-turn-snapshot Feature PRD

## 背景与变更动机

prompt-block-lifecycle 引入的 `lifecycle=always` dynamic 块与 customAttach（extra-info）都支持动态宏（`$time` / `$week_cn` / `$filetree`），当前实现在 **每个 agent step** 拼装提示词时实时展开：

- `$time` 每步必然变化（每步各自取 `new Date()`）；
- `$filetree` 每步重新调 `renderFileTree()` 渲染。

这导致 provider 侧前缀缓存命中受损：`<extra-info>` 注入在**最新一条 user 输入消息**上，位于消息序列中部——第 N 步时时间戳一变，从注入点到结尾的全部内容（本回合已积累的 N-1 步工具轮次）整体缓存 miss。回合越深，重复计算的 token 越多。

而回合内的变更只来自 **agent 自己的工具调用**（模型已从工具轮次得知这些变化），用户侧改动走 `user_vfs_pending` 队列本就下回合才生效——因此**回合内冻结宏值不丢失任何模型未知的信息**。

## 范围说明（相对原需求）

- 将 `lifecycle=always` 的语义从「每 step 实时展开宏」收窄为「每 agent run（回合）开始时取一次快照，回合内所有 step 复用」；`once` 语义不变（本就只在 step 0 展开一次）。
- customAttach（extra-info）的宏展开同样改为回合快照。
- 顺带修复：workplace 服务实例从「每 step 经工厂重建」改为「每 run 获取一次」，使 `liveViewInflight` 并发去重跨 step 生效。

### 不包含范围

- `assembleWorkplaceDisplay`（常驻工作区前缀）的每 step 组装与快照策略——它由 session kkv 管理快照语义，且 persist 区不做宏展开。
- 三区布局顺序调整（dynamic 区位于消息序列尾部带来的位置性缓存损耗）。
- persist 区块（本就不做宏展开）。

## 影响模块与接口

| 模块 | 变更 |
|------|------|
| `packages/core/src/service/agent/impl/agent-runner.ts` | run 开始固定 `turnNow`、按需预取 filetree 快照、wt 提升到循环外 |
| `packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts` | `DynamicMacroContext` 新增可选 `filetree` 预取值（优先于实时渲染） |
| `packages/core/src/domain/prompt/model/prompt-render-context.ts` | `PromptRenderContext` 新增可选 `filetree` |
| `packages/core/src/service/prompt/render-prompt.ts` | dynamic 区展开透传 `ctx.filetree` |
| `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` | runtime 新增可选 `filetree` 并透传到 extraInfo 展开 |

所有新增字段均为可选、缺省回退原实时行为，公共 API 无破坏性变更；预览 / token 计数 / CLI 等其它调用方不传新字段即维持原语义。

## 验收标准

1. 一个 agent run 内含 `$filetree` 的配置，`renderFileTree` 只被调用 **1 次**（含 customAttach、dynamic 区、compaction token 计数全部链路合计）。
2. 同一 run 内不同 step 的 dynamic 块与 extra-info 展开文本**逐字一致**（`$time` / `$filetree` 取 run 开始时的快照）。
3. 配置文本不含 `$filetree` 时零预取（不白付一次全量 metadata 渲染）。
4. 不传 `filetree` 的既有调用方（预览、双端 session-prompt-input 等）行为与改前一致。

## 测试用例

- `packages/core/test/prompt/expand-dynamic-macros.test.ts` T-SNAP1：`ctx.filetree` 快照优先，不调实时 `renderFileTree`。
- `packages/core/test/agent/agent-runner-macro-turn-snapshot.test.ts` T-SNAP2：多 step 内 `renderFileTree` 只调一次且 dynamic 块文本跨 step 一致。
- 同文件 T-SNAP3：文本不含 `$filetree` 时预取为零、customAttach 宏仍正常展开注入 `<extra-info>`。
- 回归：`test/prompt/*.test.ts` + `test/agent/agent-runner-template-blocks.test.ts` 共 111 例全过。
