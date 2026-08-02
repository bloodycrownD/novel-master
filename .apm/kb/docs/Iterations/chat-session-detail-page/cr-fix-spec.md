# CR Fix Spec: 聊天会话详情页

## 元信息

- **repo**: `D:\Dev\Js\novel-master`
- **base_sha**: `9fdca68c6b41dde8b7271cc1af0da22b7a7e9460`
- **head_sha**: `dcb10dd5ac431abd4b0e09c2e5e912b95fdc6395`
- **branch**: `feat/chat-session-detail-page`
- **prd_path**: `.apm/kb/docs/Iterations/chat-session-detail-page/prd.md`（只读参考）
- **spec_path**: `.apm/kb/docs/Iterations/chat-session-detail-page/spec.md`（只读参考）
- **review_round**: round1（core / desktop / mobile / cli 四个 scope 已完成 readonly 评审）
- **dag_version**: cr-round1
- **scope 状态**：
  - cli: scope-ready
  - core: not-ready（见 P1/P2 must-fix）
  - desktop: not-ready（见 P1/P2 must-fix）
  - mobile: not-ready（见 P1/P2 must-fix）
- **状态**: draft

## 用户已拍板的关键决策（贯穿本 fix-spec）

1. **`SessionAgentConfigPatch` 用 partial overlay**：切 agent 时保留 modelId，切 model 时保留 agentId。core service 加 merge 逻辑，patch 形态为 `{ agentId?: string; modelId?: string | null }`。
2. **`SET_AGENT_BINDING` 允许传 null**：null 表示将该会话的 agentId 同步为 workspace 当前 agent（作为该会话的新默认值）。代码里要写清楚注释，spec 也要登记这条语义。这不是"解绑/回退"，而是"同步到当前默认"——会话始终持有 agentId。
3. **patch 类型形态跟随 ①**：`agentId` 在 patch 里可选，在最终 `SessionAgentConfig` 里必填。

---

## Must-fix

### P1

#### review-core/A-1 — `SessionAgentConfigPatch` 改为 partial overlay

- **P**: P1
- **维度**: A / C-orch
- **文件**:
  - `packages/core/src/domain/chat/model/session-agent-config.ts`
  - `packages/core/src/service/chat/session.port.ts`
  - `packages/core/src/service/chat/impl/session.service.ts`
  - `packages/core/test/service/chat/session.agent-config.test.ts`
- **问题**: 当前 `updateSessionAgentConfig(id, config: SessionAgentConfig)` 是全量替换，切 agent 时会把 modelId 一并清掉。用户决策 ① 要求保留 modelId，改成 partial overlay。
- **改法**:
  1. 定义 `SessionAgentConfigPatch = { agentId?: string; modelId?: string | null }`，并明确 `agentId` 在最终 `SessionAgentConfig` 里仍是必填。
  2. service 接口签名改为 `updateSessionAgentConfig(id, patch: SessionAgentConfigPatch): Promise<SessionAgentConfig>`。
  3. service 内部 merge 逻辑按下面这套规则来：
     - 先读当前 config（`getSessionAgentConfig`）作为基线；
     - `patch.agentId` 有值 → 覆盖 agentId；
     - `patch.modelId === undefined` → 保持当前 modelId 不动；
     - `patch.modelId === null` → 清除 modelId（写库时落成 undefined）；
     - `patch.modelId` 是字符串 → 覆盖；
     - merge 完做一次 schema 校验（agentId 必填），然后序列化写库。
  4. 更新测试，覆盖 partial overlay 的四种场景：仅切 agent、仅切 model、清 model（null）、不传 model 字段（保持）。
- **验收**: 切 agent 后 `getSessionAgentConfig` 返回的 modelId 与切换前一致；切 model 不影响 agentId。
- **依赖**: 无（本条是 desktop A-3、B-1 的上游）。
- **来源**: review-scope-core round1 / 用户决策 ①

---

#### review-core/G-1 — migration 零测试覆盖

- **P**: P1
- **维度**: G
- **文件**: 新建 `packages/core/test/bootstrap/session-agent-config-v2.test.ts`
- **问题**: `session-agent-config-v2` migration 目前零行为覆盖，T-S4 验收过不去。
- **改法**: 补测试覆盖下面 7 个场景：
  1. `NULL` + workspace 有 agentId/modelId → 回填；
  2. `NULL` + workspace agentId 空 + registry 有 agent → 回落 registry 首项；
  3. `NULL` + workspace 与 registry 均空 → 保留 NULL；
  4. `{mode:"bind", agentId, modelId?}` → 剥掉 mode，保留 agentId/modelId；
  5. `{mode:"follow"}` → 与 NULL 同策略回填；
  6. 已是 v2 形态 → 跳过（幂等）；
  7. 二次执行 → 数据不变。
- **验收**: migration 测试覆盖 T-S4 全部 7 个场景；本地跑该测试通过。
- **来源**: review-scope-core round1

---

#### review-desktop/A-1 — `WorkspaceFooter` 死文件 + 死测试

- **P**: P1
- **维度**: C / A
- **文件**:
  - `apps/desktop/renderer/features/chat/WorkspaceFooter.tsx`（删）
  - `apps/desktop/test/session-detail-drawer.test.ts`（删 T-D4 中 WorkspaceFooter 相关断言块）
- **问题**: `WorkspaceFooter.tsx` 已经没有任何 renderer import（死文件），里面还留着旧 picker 文案（"回退工作区"），但 T-D4 测试还在断言它。
- **改法**:
  1. 删除 `apps/desktop/renderer/features/chat/WorkspaceFooter.tsx`。
  2. 删除 `session-detail-drawer.test.ts` 里 T-D4 describe 中那条断言 WorkspaceFooter 源码的 `it` 块；保留"不再渲染 `#session-actions-menu`"那一条断言。
- **验收**: `grep -r "WorkspaceFooter" apps/desktop/` 仅剩 `.worktree` 副本（如有）。
- **来源**: review-scope-desktop round1

---

#### review-desktop/A-2 — `SET_AGENT_BINDING` null 语义

- **P**: P1
- **维度**: A
- **文件**:
  - `apps/desktop/shared/ipc-types.ts`
  - `apps/desktop/src/main/ipc/handlers/sessions.ts`
  - `apps/desktop/test/sessions-agent-binding-handlers.test.ts`
- **问题**: 业务 spec「核心设计契约 3」说不支持 null 解绑，但实现保留了 `agentId: string | null` 这条路径——null 会回退 workspace 当前 agent。
- **用户决策**: **保留 null**，但要写清楚注释，并把语义登记进 spec。
- **改法**:
  1. 代码里继续保留 `agentId: string | null`，在 `handleSessionsSetAgentBinding` 上加注释明确语义：「null 表示将该会话的 agentId 同步为 workspace 当前 agent（作为该会话的新默认值）；会话始终持有 agentId，这不是解绑/回退，而是『同步到当前默认』」。
  2. spec「IPC DTO wire 形态」段落补一句登记这条 null 语义（这条留给下游 spec 同步节做，本 fix-spec 只登记）。
  3. 测试保留 null 断言，把测试标题改为「null 同步到 workspace 当前 agent」。
- **验收**: null 路径有清晰注释；spec 有登记条目（见 spec deviations #2）；测试标题与实际行为一致。
- **来源**: review-scope-desktop round1 / 用户决策 ②

---

#### review-desktop/A-3 — 切 agent 时清掉 modelId

- **P**: P1
- **维度**: A / B
- **文件**:
  - `apps/desktop/src/main/ipc/handlers/sessions.ts`
  - `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx`
- **问题**: handler 切 agent 时只传 `{ agentId }`，全量替换把 modelId 清掉了。
- **改法**: **依赖 core A-1 的 partial overlay**。core 改完之后，desktop 的 `handleSessionsSetAgentBinding` 改为只传 `{ agentId: req.agentId }`（partial），service 内部 merge 会保留 modelId；同时删掉 handler 里"切换 agent 时重置 modelId"那条注释。
- **验收**: 切换 agent 后 modelId 保持不变。
- **依赖**: core A-1 必须先合入。
- **来源**: review-scope-desktop round1

---

#### review-desktop/B-1 — handler 注释与 core 契约错配

- **P**: P1
- **维度**: B / C-orch
- **文件**: `apps/desktop/src/main/ipc/handlers/sessions.ts`
- **问题**: handler 注释描述 core 是"全量替换"，但 core 改完之后是 partial overlay，注释和实现对不上。
- **改法**: core A-1 改完后，更新 handler 注释，描述 partial overlay 的语义：传 `{ agentId }` 保留 modelId、传 `{ modelId }` 保留 agentId、`modelId: null` 清除。`handleSessionsSetModelOverride` 改为传 `{ modelId: req.modelId }`（partial，null 即清除），不再需要 read-modify-write。
- **验收**: handler 注释与 core 实际契约一致；`handleSessionsSetModelOverride` 不再 read-modify-write。
- **依赖**: core A-1 必须先合入。
- **来源**: review-scope-desktop round1

---

#### review-mobile/C-1 — `clearSessionAgentBinding` 死代码

- **P**: P1
- **维度**: C
- **文件**:
  - `apps/mobile/src/services/agent-picker.ts`
  - `apps/mobile/__tests__/agent-picker-session.test.ts`
- **问题**: `clearSessionAgentBinding` 没有任何生产调用点，而且语义上也不需要了——会话始终持有 agentId。
- **改法**: 删除 `clearSessionAgentBinding` 函数，同时删除对应的测试用例。
- **验收**: 全仓 grep `clearSessionAgentBinding` 零命中。
- **来源**: review-scope-mobile round1

---

### P2

#### review-core/C-1 — run-agent.handler workspace fallback + typo

- **P**: P2
- **维度**: C / A
- **文件**:
  - `packages/core/src/service/events/impl/actions/run-agent.handler.ts`
  - 业务 spec（spec deviations #3 登记，不在本 fix-spec 改）
- **问题**: event 触发的 run-agent 没有 session 上下文，保留 workspace fallback 但 spec 里没登记这条例外；另外注释 typo「田语义」应为「原语义」。
- **改法**:
  1. 修注释 typo「田语义」→「原语义」。
  2. spec「兼容性」段落补一条：「event 触发的 run-agent 无 session 上下文，保留 agent pin → workspace fallback 作为例外」（spec 同步留到下游做，本 fix-spec 登记）。
- **验收**: 代码无 typo；spec 有例外登记条目。
- **来源**: review-scope-core round1

---

#### review-core/A-2 — `DEFAULT_SESSION_AGENT_CONFIG` 未定义

- **P**: P2
- **维度**: A
- **文件**: 业务 spec（spec deviations #4 登记）
- **问题**: spec 点名要导出 `DEFAULT_SESSION_AGENT_CONFIG`，但实际没有这个常量；而且运行时根本不需要静态默认——默认值由 service 通过 `resolveWorkspaceAgentForNewSession` 现算。
- **改法**: spec 同步节删除两处 `DEFAULT_SESSION_AGENT_CONFIG` 引用，注明「默认值由 service 运行时通过 `resolveWorkspaceAgentForNewSession` 计算，不提供静态常量」。本 fix-spec 只登记，不改业务 spec。
- **验收**: spec 无悬空引用。
- **来源**: review-scope-core round1

---

#### review-core/C-2 — migration `mode=follow` 未显式分支

- **P**: P2
- **维度**: C
- **文件**: `packages/core/src/bootstrap/schema-migrations/session-agent-config-v2.ts`
- **问题**: `mode=follow` 走的是 catch-all 分支，读起来像是异常态，跟 spec「mode=follow → 同 NULL」对不上。
- **改法**: 补一个显式 `parsed.mode === "follow"` 分支，或在分支注释里写清楚「含 mode=follow，按 NULL 同策略回填」。
- **验收**: 代码注释与 spec「mode=follow → 同 NULL」一一对应。
- **依赖**: 与 core G-1 测试配合，建议同一批次改。
- **来源**: review-scope-core round1

---

#### review-mobile/B-1 — `source='none'` 时卡片仍可点击

- **P**: P2
- **维度**: B
- **文件**: `apps/mobile/src/screens/stack/SessionDetailScreen.tsx`
- **问题**: `loadChatAgentMeta` catch 会返回 `'none'`，但详情页只把 `'project-custom'` 当成锁定态，`'none'` 被当成可切。
- **改法**: 两种方案选其一：
  - 方案一（最小改动）：把 `agentLocked` 改成 `meta?.source !== 'session'`（只有 session 才允许切）。**注意**：只锁 agent 卡过不了验收，必须同时把 `modelLocked` 也按 `meta?.source !== 'session'` 收口——因为当前 `modelLocked` 是 `modelSource === 'agent-pin' || hasDedicatedModel`，而 `source='none'` 时 `modelSource` 会被设成 `'session'`（见 `chat-agent-meta.ts` L114），方案一只锁 agent 卡的话 model 卡仍然可点。
  - 方案二（整体禁用）：加载失败时整体禁用卡片 + 显示重试入口。
  倾向方案一，但需注意上面 model 卡的连带改法。
- **验收**: `source='none'` 时 agent/model 卡片**都**不可点击。
- **关联**: 与 review-desktop/B-2 同口径，两端必须选同一个方案。
- **来源**: review-scope-mobile round1

---

#### review-mobile/B-2 — `ModelPickerModal` session 模式回退 workspace currentId

- **P**: P2
- **维度**: B
- **文件**: `apps/mobile/src/components/provider/ModelPickerModal.tsx`
- **问题**: session 模式下 `sessionConfig.modelId` 为空时，picker 回退到了 workspace 当前模型去高亮，用户会误以为这个会话已经绑了模型。
- **改法**: session 模式不回退——`modelId` 为空时不高亮任何项。
- **验收**: session 模式 modelId 为空时 picker 无高亮。
- **来源**: review-scope-mobile round1

---

#### review-mobile/G-1 — legacy fixture 旧枚举

- **P**: P2
- **维度**: G
- **文件**:
  - `apps/mobile/__tests__/chat-tab-screen-legacy-scroll.test.tsx`
  - `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`
- **问题**: mock fixture 里还残留 `source: 'global'` / `modelSource: 'workspace'` 这种旧枚举。
- **改法**: 改成 `source: 'session'` / `modelSource: 'session'`。
- **验收**: fixture 枚举与新类型契约一致。
- **来源**: review-scope-mobile round1

---

#### review-mobile/G-2 — 缺加载失败场景测试

- **P**: P2
- **维度**: G
- **文件**: `apps/mobile/__tests__/session-detail-screen.test.tsx`
- **问题**: 没有 `loadChatAgentMeta` reject / 返回 `'none'` 时详情页行为的测试。
- **改法**: 补一条用例，比如 `mockLoadChatAgentMeta.mockRejectedValue(new Error('boom'))`，断言卡片锁定/不可点。
- **验收**: 有加载失败场景的回归保护。
- **关联**: 与 review-mobile/B-1 配套。
- **来源**: review-scope-mobile round1

---

#### review-desktop/B-2 — `source='none'` 时 agent/model 卡片仍可点击

- **P**: P2
- **维度**: B
- **文件**: `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx`
- **问题**: L143-149 `const source = meta?.source ?? "none"; agentLocked = source === "project-custom";`。当 `ipcPromptAgentMeta` 返回 `source: "none"`（session.agentId 指向已删 agent，handler 内层 catch 走对应分支）时，agent 卡片照样可点，与 mobile/B-1 同类问题但 desktop 这边漏了，导致两端口径不一致。`modelLocked` 同理：`source='none'` 时 `modelSource` 为 undefined → modelLocked=false → model 卡也可点。
- **改法**: 与 mobile/B-1 同口径，两端口必须一致。两种可选方案：
  - 方案一（与 mobile/B-1 方案一对齐）：把 `agentLocked` 改成 `source !== "session"` 才锁；同时把 `modelLocked` 也按同一条件收口（`source !== "session"` 时锁）。
  - 方案二（整体禁用）：`source='none'` 时整张卡片禁用点击。
  两端子代理执行时必须统一选同一个方案；若 mobile/B-1 选了方案一，desktop/B-2 也选方案一，反之亦然。
- **验收/测试**:
  - `source='session'` 时 agent/model 卡片可点击切换（正常路径）；
  - `source='none'` 时 agent/model 卡片不可点击（与 mobile/B-1 行为一致）；
  - 如有 desktop 详情抽屉测试，补一条 `source='none'` 场景断言。
- **关联**: 与 review-mobile/B-1 同口径，执行时两端方案必须一致。
- **来源**: review-full（round 2）

---

#### review-desktop/G-1 — inline 编辑竞态测试缺

- **P**: P2
- **维度**: G
- **文件**: `apps/desktop/test/session-detail-drawer.test.ts`
- **问题**: inline 编辑只断言了源码字面量，没覆盖 `submittingRef` 竞态防护和空串短路。
- **改法**: 二选一——
  - 方案 A：补源码断言 `submittingRef` 存在 + 注释说明已审查；
  - 方案 B：抽一个纯函数测竞态逻辑。
- **验收**: 有竞态防护覆盖（源码断言或行为断言均可）。
- **来源**: review-scope-desktop round1

---

#### review-desktop/C-1 — `chat-prompt-tokens` DRY

- **P**: P2
- **维度**: C
- **文件**: `apps/desktop/src/main/services/chat-prompt-tokens.service.ts`
- **问题**: 主路径和 fallback 各自重复读了一次 sessionConfig + resolveSavedModelId。
- **改法**: 抽一个内部 helper 共用，fallback 只在 token counter 调用上分叉。
- **验收**: 无重复的 sessionConfig 读取。
- **来源**: review-scope-desktop round1

---

## Spec deviations

> 本节只登记需要同步业务 spec / PRD 的条目。实际改业务 spec / PRD 的动作留到下游 spec 同步执行批次做，本 fix-spec 阶段不动业务文档。

| # | 条目 | 状态 | 处置 |
| --- | --- | --- | --- |
| 1 | `SessionActionsDrawer` 移除重命名（用户确认） | open | spec L207 / PRD L44 原写"保留不动含重命名"，需改为"保留四项，移除重命名"。下游同步。 |
| 2 | `SET_AGENT_BINDING` null 语义登记（review-desktop/A-2） | open | spec「IPC DTO wire 形态」段落补一句：null = 同步到 workspace 当前 agent 作为该会话新默认值；会话始终持有 agentId，非解绑。下游同步。 |
| 3 | run-agent.handler workspace fallback 例外（review-core/C-1） | open | spec「兼容性」段落补一条：event 触发的 run-agent 无 session 上下文，保留 agent pin → workspace fallback 作为例外。下游同步。 |
| 4 | `DEFAULT_SESSION_AGENT_CONFIG` 删引用（review-core/A-2） | open | 删除 spec 两处引用，注明默认值由 service 运行时通过 `resolveWorkspaceAgentForNewSession` 计算，不提供静态常量。下游同步。 |
| 5 | `SessionAgentConfigPatch` 改 partial overlay（用户决策 ①） | open（改代码不改 spec） | spec 本就写的是 partial，是代码偏离了 spec。本次只改代码（core A-1），业务 spec 无需改动。 |

## Open questions / 待拍板

> 本 round 无新增 open question。三个关键决策用户已拍板，其余 must-fix 均有明确改法。

## 已豁免（用户确认不修）

#### review-mobile/A-1（原 P0）— `SessionActionsDrawer` 删了重命名

- **用户原话**: 「移除输入框菜单的聊天重命名，详情页面能改，这里就减少一个入口」。
- **处置**: 不恢复重命名入口；`SessionActionsDrawer` 维持四项（不含重命名）。
- **后续**: 业务 spec / PRD 需同步描述（见 spec deviations #1），下游执行时闭合，本 fix-spec 阶段不动业务文档。

## 合并后 QA（manual_user）

Step 26 真机/桌面端手动验收，覆盖以下场景：

1. **切 agent 保留 model**（core A-1 / desktop A-3）：会话先绑模型 A，切到另一个 agent，回到详情页确认 modelId 仍是 A。
2. **切 model 保留 agent**（core A-1）：会话先绑 agent X，切到另一个模型，确认 agentId 仍是 X。
3. **清 model**（core A-1 / desktop B-1）：session model override 传 null，确认 modelId 被清除，agentId 保留。
4. **`SET_AGENT_BINDING` null 同步**（desktop A-2）：切 workspace 当前 agent 后，会话详情页 agentId 跟着同步到该默认值。
5. **mobile 加载失败锁定**（mobile B-1 / G-2）：mock `loadChatAgentMeta` reject，确认 agent/model 卡片不可点。
6. **mobile ModelPicker session 模式空 model**（mobile B-2）：未绑模型的会话打开 picker，确认无项高亮。
7. **migration 幂等**（core G-1）：旧库二次跑 migration，确认数据不变。

## K 节建议（下游执行时闭合）

无额外 lint / format 项需要登记。所有 must-fix 已在上方逐条列明文件、改法、验收；下游执行批次按 P1 → P2 顺序闭合即可，注意以下两条依赖链：

- **core A-1** → desktop A-3 / desktop B-1（partial overlay 是上游）。
- **core G-1** ↔ core C-2（migration 测试和显式分支同一批次改最顺）。
- **mobile B-1** ↔ mobile G-2（同一屏幕的行为 + 测试一起补）。
- **mobile B-1** ↔ **desktop B-2**（同口径问题，两端方案必须一致）。
- **desktop A-2** 与 **desktop A-3** 改同一文件 `apps/desktop/src/main/ipc/handlers/sessions.ts`，且 A-3 要删的「重置 modelId」注释（L185）紧挨 A-2 要补的 null 语义注释（L157-159/L165-166），建议同批次执行避免 merge 冲突。
