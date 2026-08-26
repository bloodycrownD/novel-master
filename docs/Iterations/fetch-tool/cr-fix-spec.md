# CR Fix Spec: fetch-tool（agent 联网 fetch 工具）

## 元信息
- repo: novel-master（worktree .woktree/fetch-tool，分支 feat/fetch-tool）
- base_sha: b3429b0（main）
- head_sha: 8a2810d
- prd_path / spec_path: docs/Iterations/fetch-tool/prd.md、docs/Iterations/fetch-tool/spec.md（只读参考，本轮不改）
- review_round: 1 / dag_version: 2
- 状态: draft（fix-spec 已落盘，修复待下游 wave 执行）

## Must-fix（按 P1 → P2）

### MF-1 [P1] 超时只覆盖到响应头，body 下载阶段无超时，慢滴流可让回合无限挂起
- 维度：B/I（正确性 + 挂起中断风险）
- 文件：`packages/core/src/domain/tool/builtin/fetch-tool.ts` L207-209（clearTimeout 位置）、L235-248（text() 阶段及不可达的 aborted 分支）
- 问题：`clearTimeout(timer)` 落在 `doFetch` 的 `finally`（L207-209），响应头一到计时器就被清掉，`response.text()`（L237）下载正文阶段不再有任何超时覆盖——慢滴流 body（服务器每隔一段时间滴一个字节维持连接）会让工具无限挂起、整个回合卡死。连带后果：`text()` catch 里的 `controller.signal.aborted` 分支（L239-246）因计时器已清永远不可达，是一段死代码。spec §3 的意图是「请求结束（无论成功或失败）后 clearTimeout」，请求应包含正文读取全程，实现与 spec 意图不符（详见 Spec deviations #2）。
- 改法：把 `clearTimeout` 移到 `fetch + text()` 整体结束后的 `finally`——用同一个 try/finally 包住两个阶段（或把 `text()` 挪进 `doFetch` 的 try 块）；abort 语义随之覆盖 body 阶段：超时 abort 后 `text()` 会 reject 并进入 aborted 分支，拿到可读的超时文案。
- 验收/测试：`packages/core/test/tool/fetch-tool.test.ts` 补 body 阶段挂起用例——mock `ctx.fetchFn` 立即返回 headers（复用文件内 fake Response helper），`text()` 永不 resolve；`mock.timers.tick(30_000)` 推进时钟后断言得到 ToolError FAILED 且文案含 `timed out` 与 URL（照 T-FT4 先例，L201-228）；既有 T-FT1~T-FT13 零回归。
- 来源：review round 1

### MF-2 [P2] description 宣称回流 JSON 对象，模型实际看到的是可读文本
- 维度：C（模型可见描述与实际回流格式不一致）
- 文件：`packages/core/src/domain/tool/builtin/fetch-tool.ts` L135
- 问题：description 写「结果格式：本工具回流一个 JSON 对象，结构为 { url, finalUrl, status, contentType, body, truncated, originalBytes }」，但模型实际收到的是 `formatToolOutputForLlm` → `formatFetchOutput`（`packages/core/src/domain/tool/logic/format-tool-output.ts` L186-198）产出的可读文本：首两行 `GET <url>[ → <finalUrl>]` 与 `Status: <status>[ · <contentType>]`，空行后为正文，截断时正文末尾附 `Output truncated (original N bytes).` 标注行。描述与实际格式失真，会误导模型的解析预期（比如去找 JSON 字段）。
- 改法：措辞改为描述实际格式——首两行 GET 请求行（重定向时附 `→ finalUrl`）与 Status 行（含 content-type），空行后为正文文本；超过 50KB 按字节截断、末尾附截断标注；非文本类型返回占位说明。
- 验收/测试：人工核对 description 与 `formatFetchOutput` 实际输出一致；`tool-schema-descriptions.test.ts` 现无 fetch description 内容断言，无需同步（如后续加快照需一并更新）。
- 来源：review round 1

### MF-3 [P2] CHANGELOG 无 fetch 新工具条目
- 维度：K（文档同步）
- 文件：`CHANGELOG.md`
- 问题：现行文件最新段落停在 `## [1.5.4] - 2026-08-25`，无 `## [Unreleased]` 段，fetch 新工具零条目——agent 联网是用户可见的新能力，不补条目发版时会漏报。
- 改法：按 Keep-a-Changelog 惯例在文件头（版本段落之前）补 `## [Unreleased]` 段 + `### 新增`，写一条面向用户的双端条目：agent 新增 `fetch` 工具，可对 http/https 网址发起只读 GET 请求获取网页 / 接口文档 / 公开 API 内容，可在智能体配置中 allow/deny。措辞按 changelog skill 校对清单过：不暴露内部术语、粗体标题 + 破折号补充、与既有条目风格一致。
- 验收/测试：人工核对格式与 `## [1.5.4]` 段既有条目风格一致；发版时由 publish 流程挪入具体版本号段。
- 来源：review round 1

### MF-4 [P2] 非文本 content-type 仍全量下载后丢弃；originalBytes 是解码口径与线上偏差可达数倍
- 维度：E/B（效率 + 数值口径正确性）
- 文件：`packages/core/src/domain/tool/builtin/fetch-tool.ts` L235-262（text() 先于 isTextualContentType 判定）、L54-59（originalBytes JSDoc）
- 问题：`contentType` 在响应头阶段即可得，但非文本类型（如 `image/png`）仍先 `await response.text()`（L237）全量下载（上限内最高 10MB）再在 L253-262 丢弃，白耗带宽与内存；且此路径的 `originalBytes`（L250）是 TextEncoder 对解码后文本的编码字节数，与线上传输字节数（gzip 压缩 / 二进制原样）偏差可达数倍，占位文案 `[binary content, N bytes, not shown]` 的 N 口径失真。
- 改法：把 `isTextualContentType(contentType)` 判定提前到 `text()` 之前，非文本时跳过 `text()`，体积取 `content-length` 头（缺失时置 0 或标 unknown）；若维持现状不调整顺序，则至少在 `originalBytes` 的 JSDoc（L54-59）与 outputSchema 的 describe 注明 N 为解码后口径、非线上字节数。推荐前者（省一次全量下载）。
- 验收/测试：T-FT7 更新——非文本 Content-Type 时断言 `text()` 未被调用（测试文件已有记录 `text()` 调用次数的 fake Response helper，L29 附近），`originalBytes` 回填 content-length 头数值；文本路径行为不变。
- 来源：review round 1

### MF-5 [P2] originalBytes 对全量正文再 encode 一次，10MB 正文瞬时峰值约翻倍
- 维度：E（内存效率）
- 文件：`packages/core/src/domain/tool/builtin/fetch-tool.ts` L250
- 问题：`const originalBytes = new TextEncoder().encode(text).byteLength` 对全量正文单独做一次完整编码、数完即弃——10MB 正文场景下，解码字符串之上再瞬时产一份 10MB 字节数组，峰值额外 ~10MB（叠加字符串本体约翻倍至 ~20MB）。而截断路径的 `truncateToByteBudget`（L88-115）本身就在做同样的增量编码计数，两趟重复劳动。
- 改法：与截断共用一次增量编码计数——让 `truncateToByteBudget` 同时返回切点与累计字节数（或抽一个按块累计的 `utf8ByteLength` 增量实现），`originalBytes` 不再单独全量 encode；未触发截断的路径同样按块（8192 字符/块）累计，避免第二份全量字节数组。
- 验收/测试：T-FT3 / T-FT7 的 `originalBytes` 断言保持不变仍绿（数值口径不变，只是计算方式收敛）；代码评审确认 `run` 内不再出现对全量正文的第二次 encode。
- 来源：review round 1

## Spec deviations
1. **finalUrl 空串回落 normalizedUrl**（`fetch-tool.ts` L212）：spec §4 定义 `finalUrl` 为 `response.url`（与请求 URL 相同时仍回填）；实现多了一层防御——`response.url` 为空串时回落规范化请求 URL。属良性偏差（部分引擎 / mock 场景 `response.url` 可能为空，避免空串回流），建议回写 spec 在 §4 字段说明补一句「response.url 为空时回落规范化 URL」。
2. **超时语义实现与 spec 意图不符**：spec §3 写「请求结束（无论成功或失败）后 clearTimeout」，覆盖 fetch + `text()` 全程；实现只覆盖到响应头（即 MF-1）。处置方向是按 spec 意图修实现（移 `clearTimeout` 到整体结束后），而非改 spec 放松口径。

## Open questions / 待拍板
1. **fetch 无请求日志 / 遥测**：工具调用不记 URL、状态码、耗时与截断情况，线上问题不可观测。是否加 debug 级日志或接入现有遥测通道，待拍板。
2. **URL 内嵌凭证可过白名单**：schema 只校验协议，`https://user:pass@host` 形式的内嵌凭证会原样发给目标（并出现在回流 的 url/finalUrl 里）。是否拍板在 schema 层拦截（解析后 `username` / `password` 非空即拒），待定。
3. **RN 慢滴流实测**：MF-1 修复后 body 阶段 abort 在 RN/Hermes 上的实际行为（`text()` 是否如期随 signal reject）需真机验证，列入合并后 QA。

## 已豁免 / 已核实
- **truncateToByteBudget 块边界代理对**（`fetch-tool.ts` L88-115）：经复核不构成问题——块内切点按码位成对推进（`codePointAt` + `charLength` 按 `codePoint > 0xffff` 取 2），不会切在块内字符中间；跨块边界理论上有代理对被 8192 字符切块切开的可能，但唯一风险情形是字节预算恰好在边界间隙耗尽，最坏影响是截断末尾出现一个替换字符（U+FFFD）、字节口径偏差 ≤2，判定为可接受噪声，豁免不改。

## 合并后 QA（manual_user）
- RN 真机慢滴流：真实慢速 body 下载场景，30s 超时如期中断、回合不挂起（对应 Open questions #3）。
- 双端走查 fetch 四场景：正常 200 / 大正文截断 / 非文本占位 / 超时报错，desktop 与 mobile 行为一致（mobile 经 core dist）。
- 智能体配置 UI 确认 fetch 可 allow/deny 且策略生效（迭代 Step 6 的 manual_user 项随本轮一并走）。

## K 节建议（下游执行时闭合）
- 修 MF-2 时同步检查 `tool-schema-descriptions.test.ts` 是否新增了 fetch description 快照断言，有则一并更新。
- 修 MF-3 时按 changelog skill 的校对清单逐项过（无内部术语、无 CR 编号、面向用户、一个功能只在一个分类出现）。
- 修复提交沿用 conventional commits（如 `fix(tool):` / `docs(changelog):`），与分支既有提交风格一致。
