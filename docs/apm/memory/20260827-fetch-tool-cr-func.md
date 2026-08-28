# fetch 工具实现 CR（非功能维度，readonly diff 评审）

- 日期：2026-08-27
- worktree：`.woktree/fetch-tool`，BASE b3429b0 → HEAD 8a2810d（8 commits）
- spec/prd：`docs/Iterations/fetch-tool/spec.md`（worktree 内）
- 模式：diff 评审，侧重 B 正确性 / C 质量 / D 安全 / E 性能 / F 中文注释 / I 可观测 / K 收尾

## 结论

需产出 fix-spec（`docs/Iterations/fetch-tool/cr-fix-spec.md`）。测试实跑 46 pass（fetch-tool / format-tool-output / agent-tool-catalog / tool-schema-descriptions）。

## must-fix 摘要

1. P1 超时只覆盖到响应头：`clearTimeout` 在 `doFetch` settle 后执行，`response.text()` 下载正文阶段无超时，慢滴流 body 会无限挂起；text() catch 里的 `signal.aborted` 分支永远不可达。改法：clearTimeout 移到 fetch+text() 整体结束。
2. P2 description「回流一个 JSON 对象」与实际模型看到的 formatter 可读文本（GET/Status/body）不一致，误导模型。
3. P2 CHANGELOG Unreleased 未记 fetch 条目（K 收尾）。
4. P2 非文本 content-type 仍先 `response.text()` 全量下载解码（≤10MB）再丢弃；originalBytes 是解码后字节数而非线上字节数，语义偏差。

## 已核无误项

- `truncateToByteBudget` 块边界代理对：切点不会落在代理对中间；孤立代理按 U+FFFD 3 字节计数只导致轻微低估切点（实际保留 ≤ 预算），安全。
- SSRF 面：仅协议白名单，与 spec §5 一致；重定向 http↔https 引擎层限制，无白名单绕过。
- finalUrl 对 `response.url` 空串（RN）做了回落。
- content-length 预检、非 2xx 照常返回、formatter/summary/注册/策略均与 spec 一致。
