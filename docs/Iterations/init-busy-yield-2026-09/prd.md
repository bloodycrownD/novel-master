---
date: 2026-09-13
dependency: iterations/session-stream-unit-2026-09/prd.md
---

# 初始化长任务分片让步（init-busy-yield-2026-09）PRD

## 背景

真机实测发现：**reload/冷启动后的「忙期」里，所有用户交互被排队推迟**——reload 后立刻发送消息，保活通知 10~20 秒才出现（初始化完成后同样操作 ≤2 秒）；大会话 WebView 转录就绪实测 15~19 秒，期间消息面对任何操作无反应。排查定案（见 `docs/apm/memory/20260913-reload-busy-period-probe.md`）：React Native 的 JS 单线程在忙期被**一次性大计算**占满——tap 回调的首次执行与链路上每个 `await` 的恢复点都被推迟，异步 API 不免排队（慢在「发起之前」）。

忙期四大长任务源（探索报告实锤，均无任何分片让步）：

1. **WebView 首快照链路**：RN 侧 `buildTranscriptRows`（含工具配对的 O(n²) 放大）→ `enrichTranscriptRows`（richText 时逐条 MarkdownIt 预渲染，冷启动缓存全 miss）→ `JSON.stringify` 整包序列化；webview 侧 Preact 一次性全量 vnode 构建（无虚拟化无分块）。
2. **运行态水合**：manager 构造时 `session_run_state` 全表扫描（含 partial 大字段）+ 逐行同步循环建单元；会话消息初始化加载（view cache 水合）同样同步。
3. **backfill 事务**：每次 run 开头对会话全量消息做 checkpoint 空窗探测（O(N) 逐条查询），事务内同步 SQL 占 JS 线程——非 reload 场景的同类长任务，正常发送链路上的固定 300ms 级占用。
4. **组件树重挂载与启动期查询**：刷新后的 React 大列表重渲染、启动序列多次串行 DB 查询。

现有节流机制（32ms 事件合并 / 64ms apply 节拍 / 250ms 写通 coalescer / TDBC 16ms 时间量子）**全部面向流式 delta 与 DB 写**，对一次性大计算零覆盖；`InteractionManager` / `requestIdleCallback` 全仓零使用。本迭代填补该空白。

## 目标（含成功指标）

| 指标 | 基线（实测） | 目标 |
|---|---|---|
| reload 后立刻发送：点发送 → 保活通知出现 | 10~20s | **≤2s** |
| dev reload 下大会话 WebView ready + 首快照可见 | 15~19s | **≤3s** |
| 正常场景（非忙期）点发送 → 保活通知 | 677ms（首次，被 backfill 推迟） | **≤1s 且不再被 backfill 推迟** |
| 忙期任意阶段触摸/点击响应延迟 | 秒级~十几秒 | **≤100ms（可插队）** |

（release 冷启动场景的绝对基线未实测，spec 阶段先出基线再定目标，方向同上。）

## 用户与场景

- **开发者（dev 工作流）**：改码触发 reload/Fast Refresh 后立即操作 app——发送消息、切会话、滚动，当前全部卡顿。
- **普通用户（release 冷启动）**：打开 app 后立即进入大会话（消息多、工具调用密集、richText 开启）发送消息——忙期轻量版同样存在（无 metro 开销但有水合 + 快照构建）。
- **大会话重度用户**：数千条消息、工具卡片密集的会话，快照构建 O(n²) 配对与整包序列化成本随规模膨胀。

## 范围

### 包含范围

- **RN 侧**：水合（`session_run_state` 水合 + 会话消息初始化加载）、WebView 首快照构建/富文本预渲染/序列化、启动期组件重挂载与查询的分片让步。
- **webview 侧**：转录 DOM 构建分块/虚拟化，bridge 协议相应演进（分片快照传输）——用户拍板两侧都治。
- **backfill 治理**：每次 run 开头的全量扫描探测改为低成本判定，发送链路不再有可感知占用；undo_send 的回滚保证不得削弱。
- **忙期优先级**：交互事件（发送受理、通知链）优先于初始化任务。
- **测量工具转正**：`apps/mobile/src/debug/run-timing.ts` 打点（`__DEV__` 门控）作为验收测量手段正式入库。
- **附带修复**：中断会话在会话列表显示「活跃中」的文案错误（应为「已中断」语义）；列表徽标按三态判定——生成中/已中断/活跃中（当前会话），口径见 spec Step 9。

### 不包含范围

- run 无超时挂死（LLM 无响应时生成中永久占用）——另行处理，见风险与待确认项。
- desktop/CLI 的性能目标（backfill 位于 core 三端共用，core 侧改动须保证三端测试回归，但不承诺 desktop 性能指标）。
- 流式 delta 渲染管线本身的节流（已有 32/64ms 机制覆盖，不动）。

## 核心需求

1. **通用分片让步设施**：为 JS 单线程上的一次性大计算（快照构建、富文本预渲染、序列化、水合逐行处理）提供分片执行能力，段间让出事件循环，让步口径与 TDBC 既有「按时间量子而非逐条」对齐（参数 spec 阶段定）。
2. **WebView 快照链路分片**：RN 侧不再一次性整包构建+序列化；bridge 协议支持分片传输；webview 侧 DOM 构建分块/虚拟化，长会话首屏不一次性全量渲染。分片期间收到 force 直发请求（pendingSubagentSessions 变化、tool_use 落库、repaint 重挂）的时序语义需明确定义。
3. **水合分片**：manager 启动水合与消息初始化加载分片执行，不阻塞首屏渲染与交互；水合期间用户操作照常受理。
4. **backfill 治理**：将每次 run 开头的全量空窗扫描改为有界/缓存判定，探测成本不占发送链路；`undo_send` 回滚保证不削弱（空窗语义变化需在 spec 中论证并测试覆盖）。
5. **忙期交互优先**：发送受理与通知链在忙期优先获得执行时机，达成「点发送 → 通知 ≤2s」。
6. **回归门禁**：session-stream-unit 已钉死的性能红线（`chat-transcript-webview` 的 T-REPAINT 等、`view-cache` 套件）与水合/中断恢复 GWT 全部保持绿。

## 验收标准

- **GWT-1（忙期通知）**：Given dev reload 完成后立即点发送，When 观察通知栏，Then 保活通知在 2 秒内出现（打点 + 截图时序双证）。
- **GWT-2（忙期消息面）**：Given dev reload 后立即进入 1000+ 消息的会话（数据集用脚本灌入测试会话或备份真机大会话），When 等待 WebView ready，Then ready + 首快照可见合计 ≤3 秒（dev 基线 15~19s）。
- **GWT-3（交互可插队）**：Given 忙期任意阶段（水合/快照构建进行中），When 用户点击发送/停止/切换会话，Then 交互响应延迟 ≤100ms（测量口径：打点 tap→handler 执行间隔；打点未扩展时以「忙期发送→通知 ≤2s」间接佐证并注明口径，见 spec Step 10）。
- **GWT-4（正常场景）**：Given 非忙期点发送，When 打点测量，Then 点发送 → 保活通知 ≤1s，且 backfill 探测不再出现在该链路的关键路径。
- **GWT-5（功能不回归）**：session-stream-unit PRD 的全部 GWT（切换防闪、水合恢复、指标恢复、并行无串会话）与性能红线套件全绿；分片快照与 force 直发交织场景（运行中 tool_use 落库、子会话链接更新）渲染正确。
- **GWT-6（附带修复）**：Given 会话 A 中断后重启 app，When 查看会话列表，Then 该会话显示「已中断」语义文案而非「活跃中」。
- **GWT-7（工具转正）**：`run-timing` 打点入库且 `__DEV__` 门控下零生产影响，测试环境零输出。

## 约束与依赖

- 基底：`feat/agent-run-parallel-and-notify` 分支继续开发（唯一在途 feature 分支，水合/快照/消息管线依赖其上 session-stream-unit 轮次的链路）；该分支全部代码未发布，最终一次性并入 main（仓库无 dev 分支）。
- webview 侧改动走三层产物链（`build:webview` → `build:webview:native` → gradle → adb install），验收成本已计入；webview 内 JS 按老浏览器环境写（禁 lookbehind 等）。
- TDBC 铁律：事务内同步执行 + 单连接约束不可破坏；分片方案不得引入同连接并发风险。
- backfill 位于 core（三端共用），core 侧改动需 core/desktop/cli 测试回归。

## 风险与待确认项

- **run 无超时挂死**：LLM 无响应时 run 挂十几分钟不结束——独立可靠性问题，尚未立项，待用户拍板归属。
- **release 冷启动基线缺失**：现有量化数据均来自 dev reload；spec 阶段需先出 release 冷启动基线（可能显著小于 dev 场景，影响 webview 侧投入产出评估）。
- **分片与 force 直发的时序**：分片快照进行中被新快照打断的合并/作废语义，需与现有 defer/force 交织路径重新定义。
- **术语**：「水合」在本迭代特指「初始化加载链（session_run_state 水合 + 会话消息初始化）」，与 session-stream-unit 文档中狭义 `session_run_state` 水合区分；「快照」特指 webview 转录全量快照，与 worktree 快照/回合快照/checkpoint 区分。
