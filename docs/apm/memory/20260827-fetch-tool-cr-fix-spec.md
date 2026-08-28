# fetch 工具 CR 第 1 轮 fix-spec 落盘

日期：2026-08-27。节点 spec-fix-fetch-tool（dag_version 2），只改文档不改实现代码：对 `feat/fetch-tool`（base b3429b0 / head 8a2810d）的 code-review 第 1 轮结论落成 `docs/Iterations/fetch-tool/cr-fix-spec.md`，1 条 P1 + 4 条 P2，状态 draft，修复留给下游 wave。

## 写入内容

- **MF-1 [P1] 超时只覆盖到响应头**：`clearTimeout` 在 `doFetch` 的 finally（fetch-tool.ts L207-209），headers 一到计时器就清，`response.text()`（L237）阶段无超时，慢滴流 body 让回合无限挂起；L239 的 `signal.aborted` 分支因此不可达。改法：clearTimeout 移到 fetch+text() 整体结束后的 finally；补 body 挂起用例（headers 立即返回、text() 永不 resolve、mock.timers 推 30s 断言 timed out）。
- **MF-2 [P2] description 与实际回流格式不符**：L135 写「回流 JSON 对象」，模型实际看到 `formatFetchOutput`（format-tool-output.ts L186-198）的可读文本（GET 行 + Status 行 + 正文 + 截断标注）。改措辞为描述实际格式。
- **MF-3 [P2] CHANGELOG 缺条目**：无 `## [Unreleased]` 段（最新停在 1.5.4），按 Keep-a-Changelog 补 Added/新增条目。
- **MF-4 [P2] 非文本仍全量下载**：L235-262 非文本 content-type 先 text() 全量下载（最高 10MB）再丢弃；originalBytes 是解码口径与线上偏差可达数倍。改法：判定提前跳过 text()、体积取 content-length；至少 JSDoc 注明口径。
- **MF-5 [P2] 全量二次 encode**：L250 originalBytes 对全量正文再 encode 一次，10MB 正文峰值约翻倍。改法：与截断共用一次增量编码计数。
- spec_deviations 2 条（finalUrl 空串回落 normalizedUrl 属良性建议回写 spec；超时语义按 spec 意图修实现）；open_questions 3 条（无请求日志/遥测、URL 内嵌凭证 user:pass@ 是否拦截、RN 慢滴流实测）；truncateToByteBudget 块边界代理对复核豁免写入已核实段。

## 关键事实（后续迭代可复用）

- fetch-tool.test.ts 的 fake Response helper 已记录 `text()` 调用次数（L29 附近），MF-4 的「非文本不读 body」断言可直接复用；T-FT4（L201-228）是 mock.timers 超时用例先例。
- CHANGELOG.md 现行无 Unreleased 段，新条目要在版本段落之前新建该段；措辞走 novel-master-changelog skill 的校对清单。
- `tool-schema-descriptions.test.ts` 对 fetch description 无内容断言，改 description 措辞不牵动测试。

## 2026-08-28 CR 修复执行（round 1 闭合）

同 worktree 内按 fix-spec 逐条闭合，五条全部完成，每个逻辑块独立提交：

- **MF-1（e7cc3af）**：run 重构为单层 try/finally 包住 fetch + text() 整体，clearTimeout 只在整体结束后执行；fetch/text 两阶段错误统一抽 fetchPhaseError（abort 给含 URL 的超时文案，其余透传作 cause）。text 阶段的 aborted 分支由死代码变为可达。新增 T-FT14：fakeResponse 加 pendingBodySignal 选项（text() 监听 signal、abort 时 reject AbortError），headers 立即返回 + body 永不 resolve，tick(30s) 断言超时 ToolError。
- **MF-4（ddf67e1，采纳推荐方案）**：isTextualContentType 提前到 text() 之前，非文本不下载正文；体积回填 content-length（缺失文案 unknown size、originalBytes 置 0）；抽 parseContentLength 与预检共用。
- **MF-5（32b1b4d，采纳备选方案）**：抽 utf8ByteLength 按 8192 字符分块增量累计替换全量 encode，截断函数不动；数值口径不变。
- **MF-2（43b3605）**：description 结果格式段改为描述可读文本实际格式。
- **MF-3（50c5f48）**：CHANGELOG 补 `## [Unreleased]`/`### 新增` 单条 fetch 条目，按 changelog skill 清单校对（同批引入即修的 MF-1/4/5 不进修复段）。
- fix-spec 各条目标注闭合状态 + commit sha，元信息状态改已执行。

验证：`tsc --build tsconfig.json` 零错误；`npm run test:fast -- test/tool/fetch-tool.test.ts` 15 例全绿（含新 T-FT14，T-FT7 双场景更新）。踩坑：MF-1 重构时 contentType/finalUrl 声明在 try 内而后续代码在 try 外会 TS18004，正文处理后半段须一并挪进 try 块。
