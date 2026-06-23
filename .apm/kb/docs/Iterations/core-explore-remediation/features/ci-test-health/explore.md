# packages/core 测试健康报告

> 生成时间：2026-06-21  
> 分支：`main` @ `181ae43f`  
> 命令：`npm run test:fast`（工作目录 `packages/core`）  
> 耗时：约 180.7s（180667 ms）  
> 退出码：**1（失败）**

## 总览

| 指标 | 数值 |
|------|------|
| 用例（tests） | 893 |
| 通过 | **891** |
| 失败 | **2** |
| 跳过 / 取消 / todo | 0 |
| 套件（suites） | 209（嵌套）；顶层 Node test 套件约 265 |
| 顶层失败套件 | **1**（`runHideMessageAction`） |

**结论：** 全量 fast 测试几乎全部通过，CI 红灯仅由 `hide-message.handler` 相关 2 条用例引起；与第一轮 CR 文档中「events 域 2/8 失败」的描述一致（当前 fast 套件中该文件仅含这 2 条失败用例）。

## 失败用例明细

### 套件：`runHideMessageAction`

**文件：** `packages/core/test/events/hide-message.handler.test.ts`

| # | 用例名 | 错误类型 | 错误摘要 |
|---|--------|----------|----------|
| 1 | `startDepth=6 无 endDepth 且 depth6 为 user 时锚定 assistant 起点` | `TypeError` | `Cannot read properties of undefined (reading 'hideMessagesInRange')` |
| 2 | `有 endDepth 时仍 hide slice 内 min~max seq` | `TypeError` | 同上 |

**堆栈要点：**

- `runHideMessageAction` → `hide-message.handler.ts:71`（调用 `deps.messageTranscriptEffects.hideMessagesInRange`）
- 测试内调用点：`hide-message.handler.test.ts:54`、`hide-message.handler.test.ts:88`

**根因分析（与当前代码对照）：**

1. **Handler 签名已变更：** `runHideMessageAction(projectId, sessionId, slice, deps)`，且 `HideMessageHandlerDeps` 要求同时提供 `messages` 与 `messageTranscriptEffects`。
2. **测试仍按旧调用方式：** 第一个参数传入 `ChatAgentSession` 实例，第四个参数仅 `{ messages: ctx.messages }`，未注入 `messageTranscriptEffects`。
3. 因此 `deps.messageTranscriptEffects` 为 `undefined`，在访问 `hideMessagesInRange` 时抛出 TypeError——与第一轮 CR 所述「将 `ChatAgentSession` 当作 `projectId`、缺少 transcript effects」一致，属于**测试与 handler 重构未对齐**，而非 depth 算法本身在该两条用例中先断言失败。

**同文件/同域其他结果：**

- `event orchestrator (DAG)` 套件：**全部通过**（含「hide-message 委托 effects，orchestrator 不调用 markDirty」等用例，位于其他测试文件）。
- `SimpleEventBus` 等 events 相关套件：**通过**。

## 与第一轮 CR 已知问题对照

依据 [迭代 readme](../../readme.md) 中的 P0 / CI 项与测试覆盖摘要。

| CR 已知问题 | 本轮测试表现 | 说明 |
|-------------|--------------|------|
| **1. 损坏的 `hide-message.handler` 集成测试**（events, depth） | **仍失败（2/2）** | 唯一 CI 阻断项；需按 DAG 测试惯例补全 `projectId`、`messageTranscriptEffects` 或调整调用参数 |
| **2. compaction 策略损坏时静默禁用 compaction** | **未由本套件红灯** | compaction 相关迁移/构建用例通过；损坏 KKV 行为属运行时/缺测，fast 测试未覆盖 |
| **3. `setConditions` 绕过 schema 校验** | **未红灯** | 无对应失败用例 |
| **4. VFS `list()` LIKE 通配符** | **未红灯** | summary 记为缺测而非失败 |
| **5. Provider 模型 ID 推断** | **未红灯** | 无失败记录 |
| **6. `hide-message.handler.ts` 并行重构（工作区有改动）** | **与测试不同步** | `hide-message.handler.ts` 工作区有未提交 diff（+85/-43），handler 已依赖 transcript effects，测试未跟进 |
| events 域「2/8 失败」摘要 | **一致** | 失败集中在 `hide-message.handler.test.ts` |
| compaction-conditions 测试「够用」 | **一致** | 现有用例绿，损坏读取路径仍可能缺覆盖 |

## 建议修复优先级

### P0 — 恢复 CI（立即）

1. **修复 `hide-message.handler.test.ts`**
   - 使用真实 `project.id` 作为 `projectId`，`sessionRow.id` 作为 `sessionId`。
   - 在 `deps` 中注入 `messageTranscriptEffects`（与 `event-orchestrator.dag.test.ts` 或生产 wiring 一致）。
   - 勿将 `ChatAgentSession` 作为 `runHideMessageAction` 首参。
2. **核对 orchestrator 调用链：** 确认生产路径已向 handler 传入完整 deps；若仅有测试过时，修测试即可；若 wiring 也缺 effects，需同步修服务装配。

### P1 — CR 运行时风险（测试未拦）

3. **compaction-conditions store：** 损坏数据时抛错而非返回 `null`（并补集成/单元测试）。
4. **`setConditions` schema 校验：** 补测试防止回归。

### P2 — 覆盖与一致性

5. **VFS `list()` LIKE 通配符：** 补回归测试（summary 已标缺测）。
6. **events-config `endDepth` 表单校验：** UI/校验与 `normalizeHideMessageAction` 对齐（无本轮失败，但 CR 已列）。
7. **工作区 `hide-message.handler.ts` 格式/重构：** 与测试、CRLF 清理一并收敛后提交。

## 命令与环境备注

- PowerShell 下请使用 `Set-Location packages/core; npm run test:fast`（旧版 PowerShell 不支持 `&&`）。
- `test:fast` 使用 `tsx --test` 扫描范围宽于 `npm test`（后者仅 `test/**/!(performance).test.ts`）；本轮使用 `test:fast` 且未超时，未改跑 `npm test`。
- 本地 Node 内置 test runner 汇总：`# pass 891` / `# fail 2`。

## 复现

```powershell
Set-Location d:\Dev\Js\novel-master\packages\core
npm run test:fast
```

预期：893 tests，2 failures，exit code 1，失败套件 `runHideMessageAction`。
