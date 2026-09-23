---
date: 2026-09-23
dependency: []
---

# mobile 性能问题批次（2026-09）总纲 PRD

## 背景

用户从 mobile 端实测汇总的性能问题批次（记忆：`docs/apm/memory/20260923-mobile-perf-issues-batch.md`），其中 content_json 压缩已独立立项（`message-content-compression`，spec 已落盘），本迭代收拢其余四个命题。探索阶段已完成（七只只读子代理，2026-09-23），根因候选与现状约束均实证到代码行级，详见各 feature spec 的 Context Bundle。

## Feature 列表

| feature | 命题 | 性质 | 一句话根因/现状 |
|---------|------|------|----------------|
| `features/rollback-large-jank` | ② 大文本消息回滚页面卡顿、界面不刷新 | 性能 bug | 回滚链同一时间窗 content_json 全量 parse ≥3 遍 + 快照恒单包（分片 50 > 页 40）无让步 + webview 全量重建，JS 线程被串行长任务独占 |
| `features/background-run-continuity` | ③ 后台任务卡住、回前台才继续 | 可靠性 bug | RN Android 的 JS timers 由 Choreographer 帧回调驱动，后台停摆；SSE 整流 `setInterval(32ms)` 是 XHR 路径唯一投递通道、TDBC 16ms 量子让步 `setTimeout(0)` 同停；FGS 保进程不保 vsync（开关开/关都卡已实证） |
| `features/stream-metrics-tokens` | ④ 指标条「正文/思考 X 字 · Z 字/秒」改「输出 N t · M t/s」+ 实时速率 | 功能改造 | 现状按字符计数、全程平均速率；anthropic/gemini 流中累计 usage 已在 parser state 只差 emit，openai 仅流尾；真 tokenizer 异步重，同步可用的只有 heuristic（len/3.35） |
| `features/llm-stream-timeout` | ⑤ 高速 LLM 流卡死不输出、换模型/重启恢复 | 可靠性 bug | 四类超时（connect/response/read/idle）全缺失——XHR 四回调一个不来 Promise 永不 settle，retry 只对 throw 生效；挂死时 abort registry 不清、同会话被门禁锁死 |

## 用户拍板记录

- ③：常驻通知开关开/关都卡（排除 ROM 冻结为主因）。
- ③：重试退避后台推迟登记为已知限制（2026-09-23 审查轮提出，待用户随 execute-ready 一并确认）。
- ④：token 数优先用协议 usage；usage 不可得用 tokenizer 兜底；速率必须实时（现状全程平均是缺陷）；「正文与思考」合并为「输出」，单位 t、速率 t/s。

## 范围边界

- ③ 与 ⑤ 独立可并行交付；⑤ 的 watchdog 在后台的生效依赖 timer 调度，后台 watchdog 失效登记为已知限制（详见其 spec）。
- ② 不改回滚语义（锚定/删尾/VFS 恢复行为零变化），只治执行链性能。
- ④ 不动统计页（token-usage）已有 t/s 展示。

## 验收（总纲级）

各 feature 验收见各自 PRD/spec；共同要求：core 全量 + mobile/desktop 定向测试全绿、全仓 typecheck 零错、真机验收（manual_user）覆盖各自场景。
