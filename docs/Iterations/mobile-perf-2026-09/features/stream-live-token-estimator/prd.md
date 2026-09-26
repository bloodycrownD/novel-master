---
date: 2026-09-26
dependency: docs/Iterations/mobile-perf-2026-09/prd.md
---

# stream-live-token-estimator Feature PRD（实时 token 估算升级）

## 背景与变更动机

④ 流式指标条的实时 token 数在 usage 真值到达前用启发式估算 `ceil(totalChars / 3.35)`。用户实测指出该系数「一头不准，另一头更不准」：

- 纯中文低估约 **70%**（中文实际约 1.0–1.4 token/字）；
- 纯英文高估约 **47.6%**（英文约 4 字符/token）。

一个常数不可能同时拟合两种语言。对 openai 这类「真值只在收尾到达」的链路，流中显示的就是这个估值；用户 22 秒看到 `1,370 t`、收尾跳到 `12,000 t` 的体感落差就来自这里。用户拍板升级为真分词器，并明确「随便拿个开源模型的 token.json 都比这样估准」。

## 范围说明（相对原需求）

- **升级实时估算（流中逐 delta）**：从字符启发式升级为 **js-tiktoken 尾窗增量真 BPE 计数**；
- **mobile 零新增依赖/零新增包体**：`js-tiktoken` 是 mobile 既有依赖（Metro 已重定向 shim，离线可用）；
- **desktop 加依赖**：renderer 直接引 `js-tiktoken`（纯 JS、无 WASM，沙箱 `contextIsolation/sandbox` 下可用），`apps/desktop/package.json` 增 `js-tiktoken@^1.0.21`（已被 mobile 依赖 hoist 到根，lock 仅 1 行变化）；
- **不动**：原生桥 `tokenizer-driver-rn` 仍是异步 prompt 级 API（逐 delta 不可用），本轮不改；`StreamTokenSource` 联合类型与 `session_run_state.token_source` 列语义不动（真 BPE 估算仍归 `'heuristic'`，语义是「非 usage 真值的本地估算」）；
- **不承诺**：非 tiktoken 家族（claude/qwen/glm…）的精确计数——本轮统一按 cl100k 近似。

## 影响模块与接口

- core 新增纯逻辑 `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts`（经 `@novel-master/core/format` 对双端开放）；
- mobile 新增绑定 `apps/mobile/src/services/stream-token-estimator.ts`；`SessionStreamUnit` 增可选 `tokenEstimatorFactory`，由 `SessionStreamUnitManager` 透传、`novel-master-context.tsx` 装配；
- desktop 新增绑定 `apps/desktop/renderer/hooks/stream-token-estimator.ts`；`useAgentStreamMetrics` 增可选估算器工厂参数，`ConversationPanel` 注入；
- 无注入时走旧启发式路径：**未收到 usage 前与旧口径严格一致；usage 到达后按 ①「基线 + 增量」口径**（见 `docs/Iterations/mobile-perf-2026-09/bugs/stream-multi-step-rate-freeze/spec.md`）。既有测试与极简 runtime 仍全绿，投影形状不变。

## 验收标准

- **精度**（对同一文本全量 encode 真值）：中文长文误差 ≤1%、英文 ≤3%；
- **性能**：单次 push（含读值）不退化成全量重算——纯中文无空白 12,000 字符的全量 encode 是 88s 量级，护栏必须能拦住它；
- **健壮**：encode 抛错（特殊 token 文本）不崩、保持上一次读值；构造失败/解析不出编码时回退启发式；
- **零回归**：不注入估算器的既有 path（含全部既有用例）**未收到 usage 前**行为不变；usage 到达后按 ① 的「基线 + 增量」口径，原 T-M5 断言已据此改写（见 ① spec 测试策略）。

## 测试用例

- core `test/infra/tokenizer/incremental-token-counter.test.ts`：分批/一次 push 一致、单调、reset、空 delta、encode 抛错回退、固化段 encode 抛错按 1:1 兜底计入、读值不倒退、边界回看消除断词误差、单次 encode 入参 ≤64 字符、有界内存（累计 encode 字符量线性）、分桶均摊耗时线性；
- mobile `__tests__/stream-token-estimator.test.ts`：真 js-tiktoken 精度与性能护栏、无空白超长串拆段自保、实例状态独立、编码名解析（o200k 家族 vs cl100k 兜底）、会话估算器解析链路（含解析失败兜底）。
