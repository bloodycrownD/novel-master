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


user（2026-11-24）:
你看看最近的 spec，是不是有个 mcp spec？

assistant:
有，`docs/iterations/mcp-support/spec.md`（312 行，2026-11-13，只有 spec、没有 prd）。实现状态：零代码——`packages/core/src/domain/mcp` 与 `infra/mcp` 目录不存在，各 package.json 没有 `@modelcontextprotocol/client` 依赖，`register-builtin-tools.ts` 里没有 mcp。即 spec 写完后尚未动工。

同轮：v1.5.52 Release 跑完，五个产物齐全（arm64-v8a / armeabi-v7a / universal / x86 / x86_64 APK + macOS dmg + Windows setup.exe），安卓包恢复产出。

user:
桌面端 stdio 也不做，和手机端一样就行。resources、prompts、sampling 是什么？

assistant:
已改 spec（`docs/iterations/mcp-support/spec.md`，15 处）：设计目标、需求来源补记 2026-11-24 拍板；依赖表删掉 desktop 的 `@modelcontextprotocol/client/stdio` 行，硬规则改为「任何地方都不 import ./stdio / cross-spawn」；配置联合类型里 stdio 收成 `{type:"stdio"}`（command/args/env/cwd 归一时丢弃），与 sse 同口径「只归一、不实现传输」；最终结构删 `stdio-transport.factory.ts`；Step 11 由 phase-mcp-stdio 改为 phase-mcp-unsupported；删 stdio 进程泄漏风险行；测试 T-M1 扩成六种写法，新增 T-M11a / T-M11b。

注意：spec 的红线是「内部码只有 7 个」，不可用的传输类型没有新开 kind，归到既有的 `kind:"server"` + `action:"fix-config"`——这是我的选择，待用户确认（也可考虑 `protocol` 或新开一个配置类 kind）。

resources / prompts / sampling 解释见回复（MCP 三种非工具能力，spec 首版都不做）。

user:
两个任务：①派子代理检查 spec（代码变动较大，需要更新）；②用 HTML 做一个 MCP 配置 demo，想看手机上的效果。

assistant:
【任务① spec-check-loop】第 1 轮派 1 全局 judge + 2 模块审查者（core / 接入与双端），三方 No-Go，P0 归并后四条：
- Tool 契约过时：`Tool.run` 已是 `Promise<Result<Output, AppError>>`，spec 还写 `throw toolFailed(...)`，且 `toolFailed` 全仓不存在。
- 移动端传输底座自相矛盾：原生底座（流式 emitHeaders 与 Kotlin 非流式 request）都只回 Content-Type、shim 的 response.body 恒 null，拿不到 Mcp-Session-Id，原 Step 6 只扩了流式路径。
- `ToolCallOutcome` 类型不存在。
- server 级失败没有读取出口。

doc-fix（我做的设计决定，用户尚未逐条确认）：
- 移动端改用 RN `globalThis.fetch`，整包响应后解析，**不改 llm-sse-native**，Step 6 从「原生层回传全头」改成「移动端 transport 注入 RN fetch」。第 2 轮接入审查者实测核实：mobile 无全局 fetch 替换，RN 0.85.3 的 fetch 是 whatwg-fetch 3.6.20，支持 signal、响应头完整、非 2xx 响应体可读。风险表留了回落方案。
- `callTool` 直接收 `AbortSignal`；取消不进 Result，`AbortError` 透传，`run` 转成 `TOOL_CANCELLED`（在 runner 直通名单里）。
- 新增 `serverStatuses()` + `McpServerStatus` 作为 server 级失败与状态的唯一出口。
- 业务码映射到既有 7 个 kind（401→auth、403→permission、429→rate-limit、其余→server），不新开 kind；stdio / sse 不可用归 `server` + `fix-config`。
- 删 `tools/list_changed` 通知失效（请求-响应 transport 收不到推送），只留 TTL 与 invalidate。
- `timeoutMs` 是单请求上限（默认 30000），装配期单 server 最多等 8 秒，超时记 pending。
- OAuth：`codeVerifier` 与 `state` 落 SKSP；回调接缝 `McpOAuth.start(serverId, redirectUrl)` / `handleCallback`；桌面先起 loopback 拿端口再 start。
- 超大结果走 `OverflowSink`；子 agent 复用同一快照；配置写路径返回 Result.err；catalog 验收改为「结构与条目逐字对齐」。
- 现状约束里的符号名与行号全部按当前代码更新。

第 2 轮：全局 judge Go，接入与双端 ready: yes，core 报 3 条 P1（测试签名位置参数、桌面 OAuth 随机端口与 start 签名冲突、取消通道）已修；另补 catalog `deps.mcpTools()` 同步返回缓存快照、Step 7 冒烟加中止场景。第 3 轮终态 judge 已派出。

【任务② HTML demo】产出 `docs/iterations/mcp-support/demo/mcp-mobile-demo.html`（单文件，无依赖），照 `apps/mobile/src/theme/tokens.ts` 的实际取值还原 iOS 风格：列表页（状态标签 + 开关 + 全局开关）与详情页（连接状态卡 / 启用开关 / 名称 / 传输类型胶囊 / 地址 / 超时 / 认证方式 / 工具勾选），支持深浅色切换与三种「测试连接」结果（正常 / 令牌过期 200+code 401 / 网关错误页），另有 stdio 不可用的详情页。可用 hash 直达：`#detail-zhipu`、`#detail-acme-dark-auth` 等。

踩坑：
- `<button>` 里不能嵌 `<button>`，HTML 解析器会把外层提前闭合，行内开关掉到下一行。可点击的列表行用 `<div role="button">`。
- Edge headless=new 有最小窗口宽度 500 左右，`--window-size=390` 会把页面右侧裁掉，看起来像内容溢出；改成 600 宽让手机画面居中即可。
- 调用无头浏览器截图时输出路径用正斜杠，Bash 里反斜杠加变量会被降级成字面量文件名。
- 我这边 Read 工具读不到 PNG 的画面内容，改用图像分析工具核对截图。

【spec-check-loop 收口】第 3 轮终态 judge 报 No-Go：我上一轮用脚本给「四、非标错误归一」加子条目时，`text.replace(re, () => "$1\n   - ...")` 回调返回串里的 `$1` 被当成字面量，「body 形状」判定规则整条正文被吞、编号断层（T-M5 / T-M6a / T-M8 的验收对象因此失去定义）。已按原文恢复并顺带修 T-M11a 主语与 Step 7 多余括号。第 4 轮终态 judge：Go（execute-ready），无 P0 / P1，全文无替换残留。

现状：共 4 轮审查，spec 已达 execute-ready，等用户确认后才能开工；spec 与 demo、记忆文件均未提交。待用户确认的设计决定是「移动端改用 RN `globalThis.fetch`、不改 llm-sse-native」。

user:
【移动端改用 RN 自带的 fetch，不再改原生网络层】为什么呢？我记得当初实现模型请求时好像就有问题才选的 native 实现。再搜一下历史和记忆。

assistant:
用户记得对。查到三处出处：`docs/Iterations/llm-stream-native/prd.md`（2026-09-25）、`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md`（回炉版）、`docs/apm/memory/20260923-mobile-perf-issues-batch.md`、`docs/apm/memory/20260928-subagent-stream-config-brainstorm.md`。当初离开 RN 自带网络栈的原因：
1. RN 0.85.3 Android 的 OkHttpClientProvider 四类超时（connect / read / write / call）全是 0，XHR 与 fetch 一视同仁，Promise 永不 settle，agent-runner 的 await 挂死、finally 不执行、abortRegistry 不清扫，同一会话门锁死。非流式的 chatNonStream / listModels 就是因此被「收编」进原生 request（600s callTimeout）。
2. OkHttp 4.9.2 连接池死连接复用黑洞：静默半开连接上「空闲大于 10 秒」才做 1ms 探测，探测成功后请求写进 TCP 缓冲被判「成功」然后永久阻塞；靠整调用 callTimeout 兜底。
3. 流式专属：XHR 增量投递事件风暴 + `_response +=` 超线性（与 MCP 无关）。

结论：我在 spec 里拍的「移动端用 RN `globalThis.fetch`」只解决了「拿不拿得到响应头」，没有面对「零超时 + 死连接」这两条有案底的问题，仅靠 AbortSignal 定时器兜底不等于恢复确定性超时语义。更好的做法：MCP 的移动端请求走**已有的原生 `request`**（非流式请求-响应，已带 callTimeout 与 `requestAbort` 真断连，非 2xx 的 status 与完整 body 已原样带回），只补一处「返回全部响应头」（Kotlin `request` 返回值 + types.ts 签名 + 一个 MCP 专用适配），不动流式路径；原生未注册时回落 fetch。待用户确认后改 spec（第 4 轮的 Go 是建立在这个被质疑的决定上的，需重审）。

user:
改 spec 吧，然后异步审查，我还有些 UI 问题需要你调整。

assistant:
已改 spec（移动端改走原生 `request`）：设计目标 4 改为只依赖极小的请求函数 `McpRequestFn`（桌面 Node fetch 适配 / 移动端原生 `request` 适配 / 原生未注册回落 fetch）；现状约束新增「RN 自带网络栈两条案底」与「原生 request 现有契约」；Step 6 改为 `phase-native-request-headers`（Kotlin `request` 返回值带全头、types.ts 签名、shim 的 `headers.get` 查全头；流式路径与 `SseTransport.post` 不动）；新增 `apps/mobile/src/services/mcp-request-adapter.ts`；Step 7 冒烟在原生分支下跑；`timeoutMs` 默认 120000；新增 T-M16b；变更点清单 / 最终项目结构 / 风险表同步。第 5 轮审查（全局 judge + 接入与双端模块审查者）已异步派出，结果待回报。UI 调整需求待用户提出。

【第 5 轮审查】全局 judge：Go（execute-ready）；接入与双端模块审查者：ready yes。核实结论：Kotlin `request` 是独立 `@ReactMethod`，与流式只共享 `buildRequest` / `clientWithCallTimeout`，返回值加 `headers` 键对 LLM 消费方零影响；旧 APK 配新 JS、新 APK 配旧 JS 都安全；原生 `request` 用 `response.body?.string()` 整包读到流关闭，不关流时阻塞到 callTimeout；两条案底转述与历史文档一致。遗留小项已全部改进 spec：两处「注入标准 fetch」的旧措辞；`RawMcpResponse.contentType` 的来源；shim 改动标为顺带并要求回归用例（`headers.get("Content-Type")` 大小写不敏感）；`timeoutMs` 钳到 `>= 1000`（原生对 `<= 0` 落回 600 秒）；装配期 8 秒预算到点调 `requestAbort` 收割；原生 reject code（network / timeout / abort / invalid）映射；现状约束里流式 headers 与非流式 request 两句拆开。终态确认轮已异步派出。

user（UI 反馈）:
① 全局开关移除；② 传输类型支持什么就做什么，sse / streamable 就够了，不展示 stdio；③ 超时时间用 input 不用选择；④ 「启用这台服务器」开关没用，删除。建议看搜索页面怎么实现的来参考，现在的页面和 nm 手机端差距较大。

assistant:
对照实读了 `apps/mobile/src/screens/stack/SearchEnginesScreen.tsx`、`SearchEngineDetailScreen.tsx` 与 ConfigListCard / card-styles / FormSectionCard / FormChipGroup / FormSelectField / FormTextInput / ApiKeyStatusTag，重写 demo：列表页改成每行一张独立卡片（无图标、无顶部说明块），右侧「状态标签 + Switch + ⋮ + ›」，Switch 开启色是 primary 蓝而不是绿，说明文案收进页头「?」帮助弹窗，底部 SecondaryButton「新建服务器」，行菜单（上移 / 下移 / 删除）与删除确认弹窗；详情页改成分组卡片「连接 / 认证 / 工具」：认证方式用带 ▼ 的选择行 + 底部弹层（照 FormSelectField），地址用多行输入框（minHeight 88），超时时间普通输入框；「启用这台服务器」与全局开关、stdio 胶囊都已去掉，第三台示例改成 SSE 传输的旧服务。文件仍是 `docs/Iterations/mcp-support/demo/mcp-mobile-demo.html`，新增 `#tall` 用于截整页长图。

观察（未改，属 app 现有 token）：深色主题下字段提示字用 textTertiary `#48484A`，在深灰卡片上对比度偏低；搜索配置页也是同一取值。

【第 6 轮终态 judge】Go（execute-ready）：第 5 轮遗留六处修订全部落实，与代码事实、风险表、测试用例三方自洽，无 P0 / P1，无替换残留与旧决定残留。顺手清掉了两处 doc-fix 拼接出的「。；」。

现状：spec 共 6 轮审查收敛到 execute-ready，待用户确认后开工；spec、demo、记忆文件均未提交。

user:
三个工具的明细展示可以保留，这个还是展示下比较好。

assistant:
把工具卡片补回完整明细：标题带数量「工具（3）」、右上「测试连接」、状态行，每个工具一行（名称 + 描述 + 右侧蓝色 Switch，可逐个关闭），列表下方一行说明「关闭的工具不会提供给 AI。工具越多占用的上下文越多」；没有工具的服务器显示「连接成功后会在这里列出服务器提供的工具」。开关沿用 app 的 Switch 形态（蓝色），没有用复选框。我对「明细」的理解是每个工具的名称、描述与启停；若用户指的是别的内容待纠正。

user:
「已授权 / 密钥已设置」改成「已连接 / 未连接」；「旧版文件服务」又是啥？这不是 demo 吗？

assistant:
状态标签统一成「已连接 / 未连接」（智谱 = 已连接，Acme = 未连接），详情页 OAuth 卡片里那一行也从「授权状态」改成「连接状态」。第三台「旧版文件服务」是我为了演示「SSE 传输不可用」凭空造的示例数据，用户质疑后已删除，列表只剩两台示例。demo 里的服务器、地址、工具都是假数据，不是真实配置。

user:
「关闭的工具不会提供给 AI。工具越多占用的上下文越多，只留下用得到的。」这种莫名其妙的解释都是干啥的？移除。

assistant:
demo 里我自己加的说教式说明全部移除：工具卡片下的那句、无工具时的占位句、原文框下的「以上是服务器返回的原文」、OAuth 的「授权在系统浏览器里完成」、传输类型下的整段说明；字段提示只留必要的事实（超时「单位：秒」、密钥「已加密保存」、授权日期）。

user:
（iOS 说明文字三个特点那段）这个记到 spec 吧，我之后想优化 UI，因为当前 nm 其实也很多地方说明文字不合理。

assistant:
已记两处：`docs/Iterations/mcp-support/spec.md` 的 Step 14 下面加了「界面说明文字」五条（只说事实不讲道理 / 一组只出现一次 / 只在必要时出现 / 长说明收进「?」帮助弹窗 / 同时适用于 MCP 配置页与 demo，nm 既有页面另立迭代）；`docs/apm/RULE.md` 末尾新增「界面说明文字约定」一节，含「用户计划另立迭代清理 nm 既有页面说明文字」「做 demo 不要凭空编造带情境的示例条目」。既有页面的文案清理尚未立项。
