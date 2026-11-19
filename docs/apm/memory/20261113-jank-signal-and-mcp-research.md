---
date: 2026-11-14 17:07
title: 卡顿归因 + signal/MCP 两份 spec，以及 signal spec 的三轮文档审查
keywords: 卡顿根因, AbortSignal, AbortScope, 取消信号, init-busy-yield, MCP, modelcontextprotocol, @modelcontextprotocol/client, llm-sse-native, Streamable HTTP, spec-check-loop, 文档审查, execute-ready
abstract: 逐条分析 CHANGELOG 43 条卡顿条目，确认只有 5 条（约 12%）主因是缺取消信号；调研 MCP TS 生态后产出两份互不耦合的 spec。随后对 signal-abort-scope spec 跑满三轮文档审查循环（8+21 → 1+9 → 0 条 P0），5 路审查放行后，又按用户拍板把取消的失败通道从 throw 全量重构为 Result（遵循 nm-code-style §3），单点一致性审抓出 1 P0 + 3 P1 + 5 P2 并全部修完；最终 439 行，result-refactor-ready: yes。
---

# 卡顿归因 + MCP 调研

user:
先读了 `20261112-web-search-curl-dev-complete.md`。然后问两件事：① 纵观 CHANGELOG，很多造成手机卡顿的 bug，是不是都和工具调用一样，是之前没做 signal 导致的？② 想给 nm 支持 MCP 能力，希望调研 TS 库有没有支持 RN + Node 双端的方案（担心 fetch 之类的问题）。

assistant:
**卡顿归因**：不成立。从 CHANGELOG 筛出 43 条卡顿/冻结/卡死相关条目，逐条归类并抽样验证代码：主因是缺取消信号的只有 5 条（11.6%），算上间接相关 4 条也只到约 21%；79% 与 signal 无关。分布是同步长任务 9 条、渲染/快照重建 8 条、DB/IO 串行 6 条、连接/超时 4 条、跨桥粒度 1 条、原生/内存 3 条、状态机/竞态 7 条。典型误判：1.5.23 流式卡顿真因是每个 chunk 过 JS 桥（原生 100ms/64KB 合批解决）；1.5.41 手动压缩卡顿是同步全量重组；1.5.24 回滚冻结是同步解析+快照重建；1.5.19 启动卡操作靠 yield 让路而非取消。signal 缺失的真正症状是「操作被排队/停止无响应」，不是掉帧。当前仍有四处真实缺口：mobile 非流式原生 LLM 请求无 abort 面（唯一「UI 说停了、钱还在烧」）、desktop main 的备份/导入/统计/模型列表无取消、回滚与压缩不可中断、S3 云同步与模型列表无超时。

**MCP 调研**：官方 TS SDK 已到 v2（`@modelcontextprotocol/client@2.4.0`，2026-07-28 规范）。关键事实：① v1 `@modelcontextprotocol/sdk@1.32.2` 顶层依赖含 express/hono/cors/cross-spawn，Metro 打包会引入 Node-only 模块；② v2 把 stdio 拆到 `./stdio` 子路径，根入口无 cross-spawn，core 只依赖 zod，且 `./_shims` 有 browser 条件，nm 的 Metro 已配置 `unstable_conditionNames: ['require','react-native','browser']` 会正确命中 browser shim；③ 但 `StreamableHTTPClientTransport` 与 `SSEClientTransport` 都依赖 `response.body` 可读流（TextDecoderStream + EventSourceParserStream + getReader），RN 的 fetch body 恒 null，不能直接用；④ Streamable HTTP 支持 `application/json` 非流式响应，对支持该模式的 server，移动端可用现有 native request fetch shim 跑通；⑤ nm 的 `SseTransport.post` 已是「POST + 原生流式 + signal abort + 600s 兜底」，缺响应头回传（Mcp-Session-Id）与通用 SSE 帧解析；⑥ stdio 在 RN 不可能，移动端只能连远程 HTTP MCP server。

**推荐路线**：协议层复用官方 v2 `Client`，传输层自写。桌面端直接上（stdio + Streamable HTTP + 旧 SSE，Electron 35 是 Node 22 满足 engines>=20）；移动端实现自定义 Transport 复用 llm-sse-native，需扩展 headers 事件与 SSE 解析；工具经 ToolRegistry 每 run 注册（run-agent-turn 天然插槽），配置存 KKV 新模块 + SecretStore，双端 agent-tool-catalog 镜像补条目；工具名加 `mcp__<server>__<tool>` 前缀防冲突；首版只做 tools、纯文本结果、不做 OAuth。风险：工具数量膨胀吃上下文预算、jose/eventsource 进 mobile bundle 的体积、stdio 的任意命令执行需显式确认。

user:
追问三件事：① stdio 的逻辑是什么？② `"type": "http", "url": "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp"` 是什么协议？③ signal 缺口能不能抽象成一个统一接口，表示可中断行为？

assistant:
**stdio**：客户端 spawn 子进程，子进程的 stdin/stdout 就是传输通道，每行一条 JSON-RPC（换行分隔 JSON，不是 LSP 的 Content-Length 头）；stderr 只当日志。生命周期 = spawn → initialize → notifications/initialized → 收发 → close 时关 stdin、超时 kill。三个硬约束：server 的 stdout 不能有任何非协议输出（console.log 会污染）、移动端无 child_process 不可用、Electron GUI 启动的进程 PATH 可能不含 npx 且 Windows 上 npx 是 .cmd（官方 stdio transport 用 cross-spawn 正是为此）。

**type: "http"**：就是 Streamable HTTP，单端点、POST 收发 JSON-RPC、响应可为 text/event-stream 或 application/json。实测智谱这个端点（2026-11-13）：未认证 POST 返回 200 + `{"code":1001,...}`，假 Bearer 返回 200 + `{"code":401,...}`——**认证失败不用 HTTP 401，而是 200 + 业务错误体**；GET 同样返回 200 + 业务错误（无 server→client 流）；OPTIONS 只允许 POST 且反射 Origin。结论：这是 Streamable HTTP 的 JSON 响应模式，非严格合规，客户端必须解析 body 判错，不能只看 response.ok。

**signal 抽象**：不该做成 `interface Cancellable`（只能约束「有 signal」，约束不了「何时检查」），应做成「作用域对象 + 检查点」三层：① `AbortScope`（signal + reason + deadline + fork/checkpoint/yieldToUi/race/onCancel），其中 checkpoint 解决同步长循环、yieldToUi 区分「可让路≠可取消」、race 给 native 这类无 abort 面的底层兜底；② 把 AgentAbortRegistry 泛化为 key 带命名空间的 AbortRegistry（`agent:` / `backup:` / `sync:`），IPC 用一条 cancel 通道；③ 迁移增量做：先抽 factory 替换 4 处手写样板（run-agent-turn 桥接、tool-runner 竞速、llm-sse-transport 桥接、native fetch shim 的 raceWithAbort），再补 4 个真实缺口。不要把全仓 `signal?: AbortSignal` 签名改成 scope（会重演签名级地震），scope 内部持有 signal、旧签名保留兼容位。DB 事务等不可中断区段要显式标记，不插 checkpoint。

user:
想了想，官方 SDK 的严格派也没毛病：只要知道授权或验证失败就行，其他原文透出即可，报错信息一般都有。

assistant:
认同并收敛。补丁一，空 body 的 401 从 `WWW-Authenticate` 头取信息（OAuth server 常见 body 为空）；补丁二，HTML 错误页截断并取 `<title>`；补丁三，`CallToolResult.isError === true` 的文本做一次 auth 关键词 sniff（`401|unauthorized|invalid token|expired|credential|api key`），命中只加「去检查配置或重新授权」的提示前缀，不改变结果流向。关键边界：非标 server 恰恰不返回 401（智谱 MCP 端点实测 200 + `{"code":401}`），所以「知道授权失败」这件事 SDK 自己做不到，仍需这十几行；其余情况原文透出、不翻译不重写。另注意 `isError: true` 是成功响应而非异常，必须原样喂给模型让它自我调整，不要抛；错误文本落日志前要脱敏 Authorization。

user:
「Invalid message」或者把 body 当消息交给上层，补一下就行吧？MCP 没必要把所有错误都解析，知道是错误、看原文就够了。而且严格派 + 显示原文派 + 网关归一化派不矛盾吧——严格解析，非标错误映射一个统一内部码，但报错给原文？

assistant:
认同，最终定型为三层分工，互不冲突：**解析层严格**（只判「这个响应是不是合法 MCP 消息」，是就往下走、不是就标记为「非标」，不做任何修复；SSE 响应要按帧逐条判定）。**分类层归一化**（非标 → 粗粒度内部码 `auth|permission|rate-limit|server|protocol|unknown` + `action: reauthorize|fix-config|retry|report`，粗到不会误判、细到够做 UI 决策）。**呈现层原文**（内部码只决定附哪一句提示，永不替换或翻译原文）。真正的判据是两类错误的二分：传输/协议层错误必须识别（因为它不能当工具结果喂给模型，流向不同），业务层错误（JSON-RPC error 或 `isError`）不需要深解析，原文直接交给模型。反模式警告：内部码一旦想精确到「token 过期还是 API key 错误」，就会滑向厂商专用解析器，那是无底洞；保持粗粒度即可。这版覆盖前面所有补丁，替代「三个微补丁」的临时结论。

user:
两个大任务清晰了：signal 全量做不拆二期，MCP 分开实现，两件事不耦合。先各出一份 spec。

assistant:
已按 spec-generate 走完「需求读取 → 4 个 readonly 探索子代理并行取证 → 结论汇总 → 复述闸门（两个范围问题用 AskUserQuestion 确认：OAuth 双端都含、signal 含 native 真断连）→ 落盘」。产出两份互不耦合的 spec：
- `docs/iterations/signal-abort-scope/spec.md`：15 个 Step / 8 个 phase。核心决策：AbortScope 自己持 `reason`（RN 的 abort-controller@3.0.0 会丢 `abort(reason)`）、不依赖 `AbortSignal.any|timeout`（RN 无）、4 个内部 port 直接换签名而 `AgentRunOptions` 与工具 `ctx.signal` 保留兼容位、7 处同步长循环用 `shouldStop/onProgress` 回调而非传染 scope、`better-sqlite3` 同步段标为不可中断区段、移动端改 `LlmSseModule.kt` 为 OkHttp `Call.cancel()` 真断连。
- `docs/iterations/mcp-support/spec.md`：15 个 Step / 9 个 phase。核心决策：core 与 desktop 同装 `@modelcontextprotocol/client@^2.4.0`、core 永不 import `./stdio`（否则 Metro 打进 mobile bundle）、HTTP transport 两端共用一份自写实现且解析失败时把 raw 塞进错误对象（原文透出的唯一前提）、`inputSchema` 用 `z.unknown()` 宽松接收、工具名 `mcp__server__tool` 超 64 字符截断加短哈希、非标错误 7 个内部码 + 4 层判定 + `isError` 文本嗅探、OAuth 桌面走 loopback 回调 / 移动走 `nm://oauth/callback` deep link。
两份 spec 均含 YAML Front Matter、变更点清单、带 phase/blocking/qa 标注的 Step、T-S1~T-S20 与 T-M1~T-M23 测试用例、风险与回滚表。状态：**待用户确认**。

user:
对 `docs/iterations/signal-abort-scope/spec.md` 跑 spec-check-loop，最多循环三次，看看这个 spec 有啥问题。

assistant:
按 skill 派了 1 个全局 judge + 4 个模块审查者（core 设计 / 桌面应用层 / 移动应用层 / 步骤与测试），三轮全部对照代码库核验、互盲。三轮汇总与修复情况：

**第 1 轮（8 条 P0 / 21 条 P1，not ready）**：接口缺 `abort()`、`scopeOf` 同名双义（裸 signal 只读 vs controller 可驱动）、T-S15 与 db-maintenance 不可中断区段矛盾、T-S13 与 batchInsert 单事务硬冲突、桌面 jobId 无来源、移动云同步无中断面、Step 4 无法 tsc 绿、测试适配无人认领、`post_model` 检查点机械替换会丢 partial。doc-fix 重写 spec：拆 `AbortSignalView`（只读）与 `AbortScope`（可驱动）两层、补生命周期契约表、batchInsert 改「抛错整体回滚」语义、桌面改 renderer 生成可选 runId、移动云同步定「阶段级取消」、6 处长循环落点（删掉被误列的 run-compaction）、测试口径分「零改动绿 / 适配后绿」。

**第 2 轮（1 条 P0 / 9 条 P1，not ready）**：T-S18 说三份 registry 测试零改动、Step 5 又把其中两份列入需适配（同一文件两种口径，且删 signal 后物理不可能）；run-agent-turn 的 registry 接线未写（门面 scope 与 run 根 scope 不同实例会让 reason 恒 null、停止静默失效）；T-S15 例外只点名 db-maintenance；desktop `agent-run.service.ts` 漏列；cloudSync 的 id 写成「provider 名」但配置里没有该字段；compaction 检查点宿主不在清单且 hide 后检查点制造半应用态；云同步取消错误被 `mapCloudSyncSdkError` 包成 NETWORK 错误；repository hooks 注入通道未定；测试适配清单漏 10 份中的 5 份；移动 5 处裸 sessionId 判据漏枚举。doc-fix 全部闭合：根 scope 契约（internalController + WeakMap memoize + `registry.abort` 后 reason 应为 `"user-stop"`）、cloudSync 两端统一 `"local"`、compaction 收敛为「入口 + hide 前」、云同步 catch 原样上抛 AbortError 并记 `"cancelled"`、方法级 hooks 注入、T-S24 专项锁。

**第 3 轮（终态认证）**：移动 / 桌面 / core 三份直接 `execute-ready: yes`；全局 judge 与步骤测试各剩一行级问题——§四一处旧口径（可中断点仍写「token cache 失效前」）与 core `AgentTurnRuntimePort.abortRegistry` 未随 app retype 改名（core 会沿同名字段拿到泛化 registry，裸 sessionId 注册导致 `nm:agent/abort` 永远 miss）。两处修完后按 write-after-read 让两位审查者确认，5 路全部放行。

最终 spec 的核心契约：`AbortSignalView`（signal/reason/checkpoint/yieldToUi/race/onCancel）与 `AbortScope extends AbortSignalView`（+deadlineAt/abort/fork/dispose）不是兼容位而是能力分级；`scopeFromController` 与 run 根 scope 共用 WeakMap memoize，`registry.abort` → `controller.abort()` → reason `"user-stop"`；6 处 `LongTaskHooks` 落点；桌面 runId 可选、IPC `nm:run/abort {kind,id}`、错误码 `ABORTED`/`INVALID_ABORT_TARGET`/`PROVIDER_MODELS_IN_FLIGHT`；移动云同步阶段级取消（不承诺立即断开 S3 下载）、native requestId 贯穿 + `Call.cancel()` 真断连；Step 4-6 单提交群、Step 14 升 blocking。状态：**execute-ready 已确认（文档侧），待用户拍板开工**。


## 第 4 轮：取消改走 Result（用户拍板，推翻原 throw 设计）

user:
指出「预期内的控制流不该用 throw」，并让我查 `nm-code-style` §3——项目约定本来就是「域逻辑/校验函数返回 `Result`，只在边界 `if (!result.ok) throw result.error`」，与 spec 原先的「core 内部 throw、边界转 Result」正好相反。随后明确拍板「是的全部按照 Result 重构」。

**改法**：`checkpoint()` / `yieldToUi()` 返回 `Result<void, AbortFailure>`（`AbortFailure = Error`，运行时 `name === "AbortError"`）；`LongTaskHooks.shouldStop: () => boolean` 换成 `checkpoint?: () => Result<void, AbortFailure>`；六个长循环落点（`mapRows` / `batchInsert` / `vfs-tree-copy` / `assemble-workplace-display` / `skills.listSkills` / `count-tokens`+`chunk-splitter`）及其调用方返回 `Result`，中止契约从「抛」改为「返回 err」。

**边界 throw**：桌面 handler 的 `doWork` 返回 `Result`、handler 边界 `if (!r.ok) throw r.error` 交 `format-ipc-error` 映射 `ABORTED`；移动 service 内部 Result、service 边界 throw；`batchInsert` 返回 err、事务边界 throw 触发 better-sqlite3 回滚。

**平台协议例外保留 throw**：`Promise.race` 的 reject（Promise 无 Result 通道，`tool-runner` 靠它保「工具调用已取消」文案）、`fetch` 的 `AbortError`、`better-sqlite3` 事务回滚靠抛错、`AbortSignal.throwIfAborted()`。`createAbortError` 从 `infra/llm-protocol/logic/request-abort.ts` 上移 `domain/abort/logic/create-abort-error.ts`，原文件 re-export 兼容（domain 不得反向依赖 infra）。

**单点一致性审**（1 个只读 agent，重读全文 439 行 + 核对 either.ts / message.port.ts / request-abort.ts）抓出 1 P0 + 3 P1 + 5 P2，全部修完：
- P0：风险表仍把 `assemble` 列进「零改动绿」，与 T-S11「断言抛出 → 断言 err 值」互斥；测试清单也漏了 `assemble-abort-fingerprint.test.ts`。
- P1：读口 Result 连锁调用方约 25 处没进变更点清单（core 域内 2 / core service 9 / cli 6 / desktop 2 / mobile 6）；六落点表把注入简写成 `if (!hooks?.checkpoint?.().ok)`——未注入 hooks 时 `!undefined === true` 会误判为 err，正确形态是 `const r = hooks?.checkpoint?.(); if (r && !r.ok) return r;`；`run-compaction` 没写 checkpoint err 时返回什么。
- P2：`create-abort-error.ts` 不在结构树与文件计数（实为 6 文件）；`batchInsert` 独立小事务路径必须在闭包内 throw 后转 err，否则 commit 半批、T-S13 落空；vfs 的 `onProgress → scope.yieldToUi` 映射与「err 被吞无害」理由需写明；风险表「同波合入」措辞与 phase 布局矛盾。

修完 write-after-read 确认 11/11 落位，`result-refactor-ready: yes`。**教训**：throw vs Either 的取舍不该按「谁省样板」论证，应先查项目既定错误通道规范；取消属预期事件，默认走 Either，只有「协议本身只有 throw 通道」（Promise.race / fetch / 事务回滚）才是例外。

