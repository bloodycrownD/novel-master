---
date: 2026-09-23
---

# 后台任务执行连续性 技术规格（SPEC）

需求来源：`docs/Iterations/mobile-perf-2026-09/features/background-run-continuity/prd.md`（用户实测 bug，探索报告 2026-09-23）。

## 设计目标

让 run 执行链（网络流投递 → 事件 → 落库）在 app 后台持续推进，不依赖 Choreographer 帧信号；前台行为与现状等价；desktop/CLI 零影响；不引入常驻原生服务。

## 总体方案

### 1. SSE chunk 投递事件驱动化（core，主修复）

`createSseChunkEmitter`（`sse-chunk-emitter.ts`）现状：`append()` 只进缓冲，`setInterval(32ms)` tick 是唯一 flush 通道。改为**数据到达驱动 + 时间闸门 + interval 兜底**：

- `append()` 内同步判断：距上次 flush ≥ `tickMs`(32ms) 则立即 flush（flush 由 onprogress 原生网络事件驱动——`didReceiveNetworkData` 不经 Choreographer，后台照常到达）；
- 未到闸门的 append 留缓冲，interval tick 照旧兜底 flush（前台主路径，节奏不变）；
- 闸门保证事件风暴不回归：32ms 窗口内多次 onprogress 至多触发一次同步 flush，整流语义与现状严格等价（窗口同为 32ms，只是触发源从「定时器到点」扩展为「定时器到点或数据到达且过闸」）。

承重细节：

- **`lastFlushAt` 初始化 = 创建时刻**（不能初始化为 0）：若初始化为 0，首个 append 距「上次 flush」必然已过 32ms、立即开闸同步 flush，既有测试 U-01（「append 后不 tick 则零投递」，`sse-chunk-emitter.test.ts`）即碎。初始化为创建时刻，首个 append 必落在开闸窗口内、进缓冲，U-01 语义原样保留。
- **模块文档契约须同步改写**：`sse-chunk-emitter.ts` 模块头注 Invariants 第一条「`append()` never calls `onChunk`」将被本方案推翻（过闸的 append 可同步触发 flush → onChunk）。改造时须同步改写该头注与接口 JSDoc（`append(text)` 的 "does not call onChunk" 描述），文档契约与实现一起变，不能只改实现。

后台效果：interval 停摆不再致命——数据到达本身驱动投递，run 持续推进。XHR onload 的同步 flush 兜底保留（现状已有）。

### 2. TDBC 量子让步后台感知（驱动层）

`packages/tdbc-driver-op-sqlite` 的事务内让步（`setTimeout(0)`，`src/connection.ts` 的量子化让步处）改为**后台跳过**：注入缝为 driver 注册工厂加参——现状签名 `registerOpSqliteDriver(adapter?)` 有**两份平行实现**：默认入口 `src/index.ts:20-21`（默认 DynamicAdapter）与 RN/Metro 子入口 `src/native.ts:19-20`（默认 NativeAdapter）；mobile 装配点 import 的是 `./native` 子入口，调用的即 native.ts 那份。新增可选参数 `isBackground?: () => boolean`，经 driver 传入 connection；**加参须覆盖两入口**，拍板为：两入口同步加参，或抽内部共享注册函数由两入口转发（**推荐后者**——单点实现，两入口天然一致，杜绝只改 index.ts 漏掉 native.ts 的分叉）：

- 未注入（desktop/cli/测试默认）：行为不变（恒前台口径，照旧让步）；
- mobile 装配点：`apps/mobile/src/db/connection.ts`（`:9` 经 `@novel-master/tdbc-driver-op-sqlite/native` 子入口 import、`:48` 现状调用 `registerOpSqliteDriver()` 处——即 native.ts 那份实现）注入 `() => AppState.currentState === 'background'`：后台时事务内不再休眠让步，连续执行（后台 JS 线程无 UI 交互可阻塞，其他 DB 使用者同样停摆，持锁延长无碍）；回前台恢复让步。AppState 用法先例：`agent-finished-notification.ts:300` 同步读 `AppState.currentState`、`:529` 订阅 `change` 事件（该事件由原生生命周期驱动，不经 Choreographer）。
- 驱动包零依赖现状（`packages/tdbc-driver-op-sqlite/package.json` `dependencies: {}`），「探测注入保包边界」主张成立：driver 不 import RN API，探测函数由 app 层经工厂注入。

### 3. run 链 timer 依赖盘点与处置（core，盘点项）

探索实证的 run 链 timer 清单与处置（口径对齐 PRD 核心需求 3：可低成本同机制覆盖的覆盖，其余登记为已知限制）：

| 原语 | 位置 | 处置 |
|------|------|------|
| SSE 整流 interval | sse-chunk-emitter | 方案 1 事件驱动化 |
| TDBC 量子让步 setTimeout | tdbc-driver-op-sqlite/connection | 方案 2 后台跳过 |
| 重试退避 setTimeout | model-request.service（429/5xx retry） | **已知限制**：后台 429/5xx 重试退避的 setTimeout 停摆 → 重试推迟至回前台执行；前台无影响；失败重试非长任务主链，覆盖需另行机制，登记不改（若未来需要后台重试，需原生 Handler 定时器另行立项） |
| UI 消费链（unit ingress 32ms 合并 / apply buffer 64ms / writethrough 250ms / RAF flush） | apps/mobile stream 链 | 观察面非执行链：后台不更新 UI 本就预期，回前台随方案 1 恢复倾泻；不动 |
| 校准探针 30s 轮询 | run-finish-calibration-probe | 已接 AppState 前台 calibrate，设计自洽；不动 |

### 4. 前提验证（根因钉死，与开发并行）

chrome://inspect 连 hermes，退后台执行 `setTimeout(()=>console.log('TICK'),1000)`：后台无 TICK、回前台立即出现 = timers 停摆前提实证（manual，先例方法论：logcat 双证）。若实测**否定**前提（后台 timer 照跑），本 spec 根因不成立，回探索阶段重查（开发门禁：**合并前须有该实证结论**，结论为否定则撤销实现改动；Step 1 为 manual 人工实证、blocking: no 不阻塞 DAG，可作为合并门禁写明——与 Step 1 描述及 blocking_steps 口径一致）。

## 最终项目结构

```
packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts   # 事件驱动闸门 flush
packages/tdbc-driver-op-sqlite/src/index.ts                       # registerOpSqliteDriver 工厂加参 isBackground（双入口同步，或转发共享注册函数）
packages/tdbc-driver-op-sqlite/src/native.ts                      # 双入口之 RN/Metro 子入口（mobile 实际 import 这份）：同步加参/转发
packages/tdbc-driver-op-sqlite/src/connection.ts                  # isBackground 传递 + 后台跳过让步
apps/mobile/src/db/connection.ts                                  # 注入 AppState 探测
（可选）apps/mobile/src/services/yield-quantum.ts                 # 若盘点发现 UI 侧量子让步挂执行链，同款注入（预期不涉及）
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `sse-chunk-emitter.ts` | append 内闸门驱动 flush；interval 保留兜底 |
| 2 | `tdbc-driver-op-sqlite/src/index.ts` + `src/native.ts` + `src/connection.ts` | 双入口（index.ts / native.ts 两份平行实现，mobile 走 native 子入口）同步加参 `isBackground`——或抽内部共享注册函数由两入口转发（推荐）；传入 connection；后台跳过休眠 |
| 3 | `apps/mobile/src/db/connection.ts` | 注入 AppState 探测 |
| 4 | 测试 | T-B 系列；既有 SSE/传输/事务测试回归 |
| 5 | 文档 | CHANGELOG；已知限制登记（重试退避后台推迟） |

## 详细实现步骤

- Step 1 — phase-premise-verify — blocking: no — qa: manual_user：chrome inspect 后台 timer 停摆实证（开发门禁见方案 4，可与 Step 2 并行启动、合并前须有结论）。
- Step 2 — phase-sse-event-driven — blocking: yes — qa: auto：emitter 闸门驱动 flush + 单测（node:test mock.timers——mock 定时器、真实时钟——模拟 interval 冻结）；T-B1/T-B2/T-B5。
- Step 3 — phase-yield-background — blocking: yes — qa: auto：driver isBackground 注入 + mobile AppState 装配；T-B3/T-B4。
- Step 4 — phase-regression — blocking: yes — qa: auto：core 全量（SSE 传输/协议 adapter/driver 套件）+ mobile 全量 + typecheck + build:webview 不涉及（无 web 侧改动）。
- Step 5 — phase-manual-verify — blocking: no — qa: manual_user：真机后台 AC-1（发送后切后台，logcat/DB 双证持续增长；分别验证「流式生成中切后台」与「发送后立刻切后台（backfill 阶段）」两场景，对应探索的场景实验 2a/2b）。

## 测试策略

基线事实：既有 `packages/core/test/infra/llm-protocol/sse-chunk-emitter.test.ts` 的 U-01 语义是「append 后不 tick 则零投递、tick 后合并为一次 onChunk」；其 timer 控制用 node:test mock.timers，且只 `enable({ apis: ["setInterval"] })`——**mock 定时器、Date 走真实时钟**。本系列新增测试沿用同一工具链与语义基线，闸门改造不得破坏 U-01/U-02（对应 T-B2 与回归）。

- T-B1 — blocking: yes — 事件驱动投递：node:test mock.timers（mock 定时器、真实时钟）下**不 advance interval**（模拟后台 interval 停摆），连续 append 驱动 flush 且 onChunk 收到数据（映射 Step 2）。前置构造：因 `lastFlushAt` 初始化 = 创建时刻，须先过开闸窗口——真实 sleep >32ms（Date 走真实时钟，sleep 即推进闸门时钟）或 mock 时间推进——再进入冻结阶段验证「interval 冻结下 append 驱动 flush」；跳过前置构造则首个 append 仍在窗口内、走缓冲，测不到目标行为。
- T-B2 — blocking: yes — 时间闸门：32ms 窗口内多次 append 至多一次同步 flush（防事件风暴），窗口过后下次 append 再 flush（映射 Step 2；U-01 语义在此扩展下保持——窗口内的 append 零投递）
- T-B3 — blocking: yes — 量子让步后台跳过：注入 isBackground=true 时事务内无 setTimeout 让步调用、语句连续执行；false/未注入时让步行为与现状一致（映射 Step 3）
- T-B4 — blocking: yes — 默认零影响：driver 未注入时全部既有事务测试零修改通过（映射 Step 3）
- T-B5 — blocking: yes — 传输等价：既有 SSE 传输/adapter 套件（含 onload flush、abort、error 路径）零修改全绿（映射 Step 2）
- T-B6 — manual_user：AC-1 后台推进双证（映射 Step 5）

## 风险与回滚方案

- **前提风险**：根因链的头段（RN 后台 timers 停摆）依据 JSTimers 源码注释+社区共识+代码推演，native 侧 `onHostPause→clearFrameCallback` 未取得源码级引用——Step 1 实证是硬门禁（合并前必须有结论），否定则整案撤回重探索。
- 前台节奏变化：闸门驱动 flush 可能使投递时机比 interval 到点**提前**（最多 32ms 内），消费端（解析/事件总线 microtask 合批）对此无感；T-B5 兜底。
- 后台连续执行长事务：跳过让步后事务占满 JS 线程——后台无交互可阻塞；若实测发现后台期间其他子系统（如 keepalive 通知链）被饿死，回退为「后台改用不依赖 Choreographer 的短等待」（评估原生 Handler 定时器，另行立项）。
- 回滚方案：两个改动点独立，可分别 revert；driver 注入默认关闭，mobile 侧一处装配回删即恢复原状。

## Context Bundle

```yaml
iteration_name: mobile-perf-2026-09 / background-run-continuity
requirement_path: docs/Iterations/mobile-perf-2026-09/features/background-run-continuity/prd.md
spec_path: docs/Iterations/mobile-perf-2026-09/features/background-run-continuity/spec.md
explore_summary: >
  run 执行链帧/定时器依赖全清单实证：SSE 整流 setInterval(32ms)=XHR 唯一投递通道
  (onprogress 只 append)；TDBC 16ms 量子 setTimeout(0)；重试退避 setTimeout(低频)；
  UI 消费链 timer(观察面)。RN 0.85 JSTimers 委托 native Timing、由 Choreographer
  frame callback 驱动(JSTimers.js 自注释)，onHostPause 摘回调后台停摆；XHR onprogress
  由原生网络事件驱动不经 Choreographer(对照项)；AsyncMutex/事务外 execute 不依赖 timer。
  FGS 常驻 promise 只保进程。XHR onload 同步 flush 兜底=后台短请求可推进、长流式必卡。
impact_files: 见变更点清单
constraints:
  - 驱动包不得 import RN API（探测注入，包边界；driver 包现状 dependencies: {} 零依赖）
  - emitter 仅 RN XHR 路径使用：desktop/CLI fetch 路径每个 reader.read() 直投
    onChunk、不过 emitter（llm-sse-transport.ts 头注与实现），emitter 闸门改造
    对 desktop/CLI 零影响面（比「三端生效」原表述更窄、更有利）
  - 前台性能零回归是硬约束（T-B5 + 真机观察）
  - 视觉/时序结论须系统级日志双证（RULE 纪律）
blocking_steps: [2, 3, 4]
```
