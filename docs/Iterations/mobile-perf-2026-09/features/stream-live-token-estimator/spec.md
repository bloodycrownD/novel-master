---
date: 2026-09-26
agile_trace: true
---

# stream-live-token-estimator 实现规格（SPEC）

## 根因 / 方案摘要

`ceil(chars/3.35)` 是单参数拟合，中文/英文两头不可兼得。真 BPE 计数可行，但**不能每次全量重算**：

| 口径 | 12,000 字符成本（cl100k_base） |
|---|---|
| 英文全量 encode | 3.1ms |
| 中文（含换行）全量 encode | 68ms |
| 纯中文无空白全量 encode | **88s**（预分词把整段当一个 piece，BPE 合并近似 O(len²)） |

方案：**「已固化前缀 + 尾窗」两段式**——`tokens = committedTokens + encode(尾窗)`，只保留尾窗片段（不持有全文），单次 encode 的字符数有硬上限。

## 变更点清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts` | 新增：尾窗增量计数器（纯逻辑，宿主注入 `encode`） |
| 2 | `packages/core/src/public/format.ts` | 追加导出（`createIncrementalTokenCounter` + 默认参数常量 + 类型） |
| 3 | `apps/mobile/src/services/stream-token-estimator.ts` | 新增：js-tiktoken 绑定（惰性单例 + 按编码缓存 + 会话级编码名解析/预热） |
| 4 | `apps/mobile/src/services/session-stream-unit.ts`、`-manager.service.ts`、`runtime/novel-master-context.tsx` | 注入点：可选 `tokenEstimatorFactory`（正文/思考各一条计数器），未注入 = 旧行为 |
| 5 | `apps/desktop/renderer/hooks/stream-token-estimator.ts` | 新增：renderer 侧绑定（v1 固定 cl100k_base） |
| 6 | `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts`、`features/chat/ConversationPanel.tsx`、`shared/logic/format.ts`、`package.json` | 注入点 + renderer barrel 再导出 + 依赖 `js-tiktoken@^1.0.21` |
| 7 | 文档 | ④ `features/stream-metrics-tokens/{prd,spec}.md` 增「实时估算升级」小节（含实测数字与参数取舍） |

## 详细改动说明

### 参数（默认值即双端装配值）

- `tailChars = 24`：尾窗字符数，每次读值重算（实时数字贴合真值的来源）；
- `lookbackChars = 8`：固化切点向前回看 ≤8 字符找自然边界（空白/CJK 标点/ASCII 标点）——**断词误差的关键旋钮**：同一段英文长文按固定 64 字符硬切误差 +7.5%，边界对齐后 0.000%；
- `commitStepChars = 64`：固化步长（**实测收紧**：方案草案为 256，实测单次 push 峰值 5.24ms 超过「≤2ms」验收线，收紧到 64 后 0.92ms、误差仅从 +0.25% 变到 +0.31%）；
- `MAX_ENCODE_CHARS = 64`（内部自保，不暴露）：单次 encode 入参上限；无自然边界的长串按固定步长拆段，把「88s 量级」压到「百毫秒量级」。

### 实测（Node v22 + js-tiktoken 1.0.21 + cl100k_base，本次实跑）

| 口径 | 真值 | 估算 | 误差 |
|---|---|---|---|
| 中文 3,660 字符（7 字符/delta 流式） | 5,160 t | 5,176 t | **+0.31%** |
| 英文 3,675 字符（同上） | 736 t | 736 t | **0.000%** |

- 单次 push（含读值）：Node 稳态峰值 0.92ms / 均摊 0.47ms；jest 环境 p99 1.00ms / 均摊 0.50ms（全量并行负载下均摊可到 1.03ms，故测试护栏取「中位/均摊 ≤5ms、峰值 ≤50ms」的数量级回归线，精确的 O(1) 不变量由 core 侧计数假 encode 用例断言）；
- 编码表构造：cl100k 约 180–250ms、o200k 约 420ms → 按编码名缓存单例、单元创建时同步构造（落在「run 开始到首字」之间，用户已接受）。

### 编码解析与注入（best-effort，全同步）

- 链路：sessionId → 会话 agent 配置 modelId（缺省回退 agent pin）→ saved model → `vendorModelId` → core `resolveTokenizerFamily` / `mapVendorModelIdToTiktokenModel` + js-tiktoken `getEncodingNameForModel` → `o200k_base`（gpt-4o/o1/o3/o4/gpt-4.1/gpt-4.5/gpt-5）否则 `cl100k_base`；
- 仓储读取本质异步而单元创建同步：解析结果落会话级提示缓存（`primeStreamTokenModelHint`，上限 32，装配方在会话切换时预热），首个 run 没赶上就 cl100k 兜底；**run 内锁定编码不中途切换**（防估值跳变污染速率窗）；
- 构造/encode 失败一律返回 null → 调用方回退启发式（整张编码表建不起来的情况挡在调用方之前；单段 encode 抛错由计数器内部吞掉并保持上次读值）；
- **不在模块顶层 `new Tiktoken`**：RN 依赖 `fast-text-encoding` polyfill 先执行；ranks 命名空间按 `(mod.default ?? mod)` 兼容 ESM/CJS（Metro/jest/Vite 三种环境）。

### desktop 取舍（登记）

- v1 **固定 cl100k_base**：按会话模型解析 o200k 需要异步仓储/IPC 面（renderer 侧暂无），o200k 模型用 cl100k 估算的偏差有界，且 usage 真值到达即重锚；后续迭代补；
- 未走 main 进程 IPC：main 的 NMTP 驱动是 WASM（renderer 沙箱不可用），且逐 delta IPC 与「hook 内同步累加 + 250ms 渲染 tick」的现有架构错配。

## 测试策略

### 测试用例

- core：见 PRD 测试用例第 1 条（9 条，含记录型假 encode 的有界性/线性护栏）；
- mobile：`__tests__/stream-token-estimator.test.ts` 7 条（真 js-tiktoken 精度/性能/编码解析/会话链路）；
- 零回归：不注入估算器的既有 path 全绿（`session-stream-unit-*`、`chat-stream-metrics-bar-live`、desktop `use-agent-stream-metrics*`）。

## 风险与回滚方案

- **包体积**：mobile 零新增（ranks 已在 bundle 内）；desktop renderer bundle 增约 1.1MB（cl100k ranks），Electron 本地加载无网络成本，可接受；
- **首帧成本**：首次构造编码表 180–420ms。缓解：按编码名缓存 + 单元创建时构造（不在 delta 路径上）；若后续发现影响体感，可改为应用启动后空闲预热；
- **近似性**：非 tiktoken 家族（claude/qwen/glm…）与 desktop 的 o200k 模型都是近似估算，注释与 spec 已明示；`tokenSource` 语义未变；
- **回滚**：注入点是可选的——删掉装配侧传参即整体回退启发式，core 模块与绑定文件可独立保留/删除，无持久化面变更。
