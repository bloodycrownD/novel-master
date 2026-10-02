---
zone: synth-core-misc
agent: reduce（W5 归并）
inputs:
  - raw/w2-core-provider.md
  - raw/w2-core-skills.md
  - raw/w2-core-workplace.md
  - raw/w2-core-prompt.md
  - raw/w2-core-infra-proto.md
  - raw/w2-core-infra-misc.md
  - raw/w3-xc-proto.md
  - raw/w3-xc-dup-ends.md
raw_findings_in: 134
merged_out: 39
severity: P0×0 / P1×5 / P2×25 / P3×9
---

# W5 归并：core-misc（provider / skills / workplace / prompt / infra-proto / infra-misc / xc-proto / xc-dup-ends）

## 摘要

本簇覆盖六块 core 域逻辑（provider 实体与仓储、skills+character-card 纯函数、workplace 规则引擎、
prompt 三区布局、llm-protocol 协议适配、infra 零件盒 tokenizer/sksp/cloud-sync/db-*），
外加两台横切机位（协议栈全链、双端重复实现+循环环）。原始 134 条发现去重后合并为 39 条：
两处三源印证顶格（流中断重试重复正文、删模型守卫漏扫），两处双源撞车升级，
其余为单源但证据密度高（实测/实跑/逐字确认）。P0 为 0——本簇无静默数据损坏或跨端不可恢复失败。
最大结构债是「纯逻辑域层反向依赖 service/infra 层」与「同一口径两份实现」两条主线。

## 输入与去重裁决

| 源 | 原始条数 | 主要贡献 |
|---|---|---|
| w2-core-provider | 22 + 6 争议 | 删除守卫漏扫、builtin 派生群、应用模型 id 归一、API key 空串判定 |
| w2-core-skills | 16 + 6 争议 | front matter 双实现、strict 死角、zip 预检、PNG 解码拷贝 |
| w2-core-workplace | 20 + 5 争议 | 1970 假时间戳、评估复杂度、体积闸门、事务契约 |
| w2-core-prompt | 12 + 5 争议 | skillsEnabled 白名单漏字段、宏预检不同源、blocks 死路径 |
| w2-core-infra-proto | 23 + 4 争议 | 传输/解析层全清单（abort 泄漏、data: 无空格、tool_use 双 emit） |
| w2-core-infra-misc | 16 + 7 争议 | 切分器不变量、L1 缓存跨会话、push/agent 锁未接线、体积闸 |
| w3-xc-proto | 7 | 协议栈横切全链 + 5 处实跑复现 |
| w3-xc-dup-ends | 17 组 | 双端重复 15 组 + 循环环 5 个 + L0 环数修正 |

**合并规则**（本次执行）：
1. 同根因不同机位 → 归并为一条，severity 取「用户可见性 + 证据密度」最高的一侧，置信取实跑/实测侧。
2. 同文件同函数族但成因不同 → 保持独立条目，交叉引用。
3. 纯死码/零消费导出 → 归入 M-31 死码簇并标注转交 synth-dead，不逐条占台账行。

---

## 归并发现清单

### P1

---

#### M-01 | P1 | 流中断被当可重试 → 用户看到「残段 + 完整回答」两遍，且同一 prompt 计费两次

**三源印证**（顶格）：
- `w2-core-infra-proto` F-1（P1，suspected）——协议层只找到根因的一半（错误未定级 + reset 不在重试路径）。
- `w2-core-service-vfs` F-03（W2 同源撞车，见 status.md 裁决行，登记在 registry）——从 service 侧读出同一判定口径不严。
- `w3-xc-proto` F-xc-proto-01（P1，**实跑复现**）——补齐用户可见形态与落库侧正确性。

```ts
// service/provider/impl/model-request.service.ts:81    —— 任何非 ProviderError 一律当"瞬时故障"重试
  if (!(error instanceof ProviderError) { return true; }
  // :226   —— 同一个 onStream 被原样带进每一次 attempt
          onStream: options?.onStream,
```

实跑观测（W3 假 fetch 探针，跑完已删）：

```
[probe] fetch calls = 2
[probe] result.assistantText = 前半段。被掐断了，这是重试后的完整回答。   ← 落库的，正确
[probe] streamRegistry partial = "前半段。被掐断了，前半段。被掐断了，这是重试后的完整回答。"
[probe] bus text-delta concat  = 同上（重复）
```

裁定理由链（5 步已由 W3 逐段实跑闭合）：`postSse` fetch 分支把 `reader.read()` 中途异常原样 reject
（`llm-sse-transport.ts:673-682`）→ 非 `ProviderError` → `isRetryableError` 判可重试（`maxRetries: 2`）
→ 第二次 attempt 复用同一 `onStream`，`agent-runner.ts:1061` 的 `streamRegistry.append` 与
`agent-runner.ts:1062-1068` 的 bus publish 再次驱动 → 双端累积器**只增不换**
（`session-stream-unit.ts:1119` / `useAgentStream.ts:176`），唯一清零点在 step 边界
（`agent-runner.ts:724`），而重试发生在 step 内部。

三条主路径都在暴露面：desktop fetch（`TypeError: terminated`）、RN XHR（`ProviderError("XHR network error")`
无 `HTTP nnn` → `status == null → true`，`llm-sse-transport.ts:568-573`）、**mobile native 主路径**
（`NativeSseTransportError{kind:"network"}`，`llm-sse-native/src/transport.ts:225-235`）。

**建议**：采纳 W3 的 A 方案——在 `model-request.service` 重试判定里引入 attempt 级
「本次是否已产出」探针（收到任意 delta/tool-use 即置 `emitted`），`emitted === true` 时不重试、
直接上抛走既有失败收尾链。语义与 `LlmStreamTimeoutError.idle` 完全对齐，且天然消除重复计费。
B 方案（发 reset-stream 让双端清 partial 后重试）**不推荐**：LLM 采样不可复现，
拼接后是两段不同回答，观感比直接失败更糟。
无论选哪个，都要在 `packages/core/test/provider/model-request-retry.test.ts` 补一条
「attempt1 产出后失败 → 断言 onStream 未被二次驱动」的回归（现有 6 条全只覆盖无输出失败）。

**置信**：confirmed（实跑）。native 路径只有静态推理，W6 建议真机补那一路。

---

#### M-02 | P1 | desktop 端 `buildNewSkillDoc` 裸插值 → 描述含冒号即产出「无效技能」

**双源**：`w3-xc-dup-ends` 组 4 + `w2-core-skills` 争议 6（后者已记录「两处 UI 侧手拼 front matter 不复用」，
但未识别出转义分叉，W3 升级为 C 级并给出 core 落点）。

```ts
// apps/mobile/src/components/skills/skill-ui.ts:47
function yamlScalar(value: string): string { return JSON.stringify(value); }   // 有引号
// apps/desktop/renderer/features/skills/skill-ui.ts:21
  return ["---", `name: ${name}`, `description: ${description}`, ...            // 裸插值
```

**用户可见后果**：desktop 新建技能时描述里含 `:`（如「用途：调研」）会让 YAML 解析成嵌套 map 或抛错，
`parseSkillFrontMatter` 返回 `valid: false` + `invalidReason: 'front matter 不可解析：…'`
（`domain/skills/logic/parse-skill-front-matter.ts:52-60`），技能创建后**立即显示为「无效技能」**。
mobile 端同一输入正常。这是本次普查中**唯一确定会造成用户可见功能失败**的漂移。

**建议**：下沉 core 为 `domain/skills/logic/build-new-skill-doc.ts`，采用 mobile 的 `yamlScalar` 口径
（JSON 字符串即合法 YAML double-quoted scalar，core 已有 `stringify-text.js`），两端 re-export。

**置信**：confirmed。

---

#### M-03 | P1 | `filename` 档位与读失败降级把 `1970-01-01` 假时间戳写进常驻提示词

**双源（同文件两个入口，已合并）**：`w2-core-workplace` F-1（filename 档位）+ F-2（catch 降级）。

```ts
// domain/workplace/logic/load-or-fill-file-cache.ts:214
  if (status === "filename") { return { body: "", mtimeMs: 0 }; }     // 入口 A
// :220
  } catch { return { body: "(missing)", mtimeMs: 0 }; }              // 入口 B
```

载荷在 `:152-164` 落 `file_cache` → `assemble-workplace-display.ts:188-195` 原样喂
`renderFileBlock` → `formatLocalMtime(0)`（`workplace-display.ts:21`）→ `createdAt="1970-01-01 08:00:00"`。

两点加重：
- `fillPolicy: "filename"` 是**双端 UI 的正式选项**（`DirectoryRuleSheet.tsx:54`、
  `DirectoryRuleModal.tsx:32`），不是边缘路径。
- 入口 B 是**永久固化**：按 RULE，`file_cache` 命中无条件返回、无 mtime 校验，改写它的只有
  改规则/压缩/置位/会话删除。一次偶发 SQL 失败就让该 path 在本会话余下所有轮次渲染成 `(missing)`。
  与同文件 `:145-148` 注释对超限占位符「不写 file_cache（避免把占位符粘进缓存）」的决策**自相矛盾**。

自证：同文件 `:8-9` 与 `:145-148` 的注释已把「1970 假时间戳随提示词送模型」列为要防的问题，
超限占位符因此专门带回真实 `mtimeMs`——`filename` 档位与 catch 路径漏掉了同款处理。
测试也只断言了超限占位符不出现 1970（`assemble-workplace-display.test.ts:459-466`），两入口均无覆盖。

**建议**：入口 A 在回填前做一次轻量 `vfs.findContentSize`（只拿 mtimeMs，不读正文，成本同超限探测），
或在 assemble 侧用 `ctx.mtimeByPath` 覆盖；入口 B 把降级归入「不落 cache」分支，
或 catch 内区分 `NOT_FOUND`（可落库）与其余异常（不落库）。补一条「createdAt 不得以 1970 开头」的断言。

**置信**：confirmed（控制流逐段读过；W6 可补一次实跑组装取证）。

---

#### M-04 | P1 | 删模型守卫漏扫会话级 modelId；且「删服务商」这条路完全绕过守卫

**双源（同族，已合并）**：`w2-core-provider` F-1 + 其跨 zone 观察第 6 条。

```ts
// domain/provider/logic/find-saved-model-references.ts:66
    `SELECT id, agent_config_json FROM chat_project`,   // 扫的是已下线的列
```

`findSavedModelReferences` 的 doc 写「Empty when safe to delete」（:29-30），但**没有扫
`chat_session.agent_config_json`**。会话级 modelId pin 恰恰存在那里：`chat_session` 表**没有**
`model_id` 列（`bootstrap/chat/chat-schema.ts:16-24`），覆盖存于
`SessionAgentConfig = { agentId, modelId? }`，经 `sqlite-session.repository.ts:185` 落
`agent_config_json`，并在 `service/agent/logic/agent-run-shared.ts:107-112` 真实生效
（`sessionModelId` 覆盖 agent pin）。

失效链：会话 A 选模型 M → `provider-model.service.ts:173` 的 in-use 守卫放行 → M 被删 →
该会话下次开跑在 `assertSavedModelUuid` 处抛 `Saved model not found`。

**同源第二处（更严重）**：`service/provider/impl/provider.service.ts:211-260` 的 `delete(provider)`
走 `savedModels.deleteByProvider(id)` **批量抹掉该 provider 的全部已保存模型，完全不经过本守卫**。
即便把守卫补全，「删服务商」这条路依然能静默清掉被会话/agent 引用的模型。

**建议**：(1) 在 `chat_project` 扫描旁补 `SELECT id, agent_config_json FROM chat_session`，
命中记 `chat_session:{id}`；(2) `delete(provider)` 路径补同样的 in-use 拒绝。

**置信**：confirmed（未做端到端复现，属控制流结论；失败是显式报错非静默损坏，故不判 P0）。

---

#### M-05 | P1 | 切分器「每块 ≤64 字符」不变量可被连续句末符打破（L2 块缓存的唯一护栏）

```ts
// infra/tokenizer/logic/chunk-splitter.ts:52   句末分支不检查块长
    chunks.push(text.slice(start, end));
```

**实测复现**（W2 逐字复刻实现，探针 `tmp/w2-chunk-probe.mjs`，跑完已清）：`"。"×100` → 单块 100 字符；
`"\n"×200` → 单块 200；`">"×300` → 单块 300。

危害不在单块大小，而在它破坏的**唯一护栏**：`chunk-splitter.ts:14` 明写「块内无任何软边界时按上限硬切
（无空白长中文串的病态输入由此兜住，**保证后续逐块 encode 恒 ≤64 字符，防 O(len²)**）」，
而 `count-text-with-tokenizer.ts:5-22` 的实测数据（8K 中文 32.8s → 亚秒级）全部建立在这个保证上。
测试 `chunk-splitter.test.ts:17-29` 的 `assertInvariants` 对任意输入断言 `chunk.length <= MAX_CHUNK_CHARS`，
但 golden 用例最长只到 `"。。。！！！"`（6 字符）——**断言从未红过**，正是 RULE
「验收断言要有牙齿」条目描述的「夹具覆盖不到 ⇒ 恒真」形态。

**建议**：句末贪吃循环加 `end - start < MAX_CHUNK_CHARS` 封顶，让超长串回落到下方软边界/硬切路径；
补 `assertInvariants("。".repeat(200))` / `assertInvariants("\n".repeat(200))` 两条边界用例（当前实现下会红）。

**置信**：confirmed（实测复现）。

---

### P2

---

#### M-06 | P2 | SSE `data:` 无空格形态 → 整流静默丢弃、零诊断、run 以「空回复」正常收尾

**双源**：`w2-core-infra-proto` F-4（规范层面判断，判 P2 因触发前提未证实）+
`w3-xc-proto` F-02（**实跑三 parser × 5 形态**，判 P1）。

```ts
  if (!line.startsWith("data: ")) { return; }   // openai:70 / anthropic:206 / gemini:199
```

实跑：`data-no-space` 与 `bom` 两形态在三家 parser 上均 `text="" malformed=0`。
因为每行都被 `startsWith` 早退，`recordMalformedSseLine` 一次都不进，
`assertSseParseSucceededOrThrow`（判据 `blocks.length === 0 && malformedLineCount > 0`）**不抛**，
最终 `agent-runner.ts:743-748` 落一条「（本次生成无内容输出）」占位，run 以 `completed` 收尾。
无错误、无日志、无重试、无诊断计数。CRLF 已被 `slice(6).trim()` 兼容（**非缺陷**，登记免得重复排查）。

**严重度校准**：判 **P2**。W3 判 P1 的理由是用户可见形态严重（秒回空消息），但证据密度上
「机制 confirmed（实跑）」与「真实网关确实发无空格形态」是两回事——后者无抓包证据，
W2 侧也只停在规范层面（WHATWG 允许 `field ":" [space] value`）。P2 已足够优先修（改动 3 行）。

**建议**：三处换成规范读法 `/^data:[ ]?/`（只去一个空格，保留 payload 前导空格语义），
建议在 `sse-line-buffer.ts` 旁抽一个共享 `parseSseDataLine(line): string | null`（当前是三份同款复制）；
`feedSseLines` 剥首块 BOM；把「非空行但既不是 data: 也不是已知字段」计入诊断，
让 `assertSseParseSucceededOrThrow` 在「整流零内容 + 有无法识别行」时有牙；三 parser 各补
无空格/CRLF/BOM 三组用例。

**置信**：confirmed（机制，实跑）/ suspected（真实网关形态）。**争议见 D-2**。

---

#### M-07 | P2 | abort 监听器三处泄漏，`{once:true}` 只在 abort 触发时自摘

**双源**：`w2-core-infra-proto` F-3 + `w3-xc-proto` F-03（**打桩实测**：`[abort] added=5 removed=0 leaked=5`）。

`postSse` 的 native/xhr/fetch 三分支都 `signal.addEventListener("abort", …, { once: true })`
（`llm-sse-transport.ts:399 / :513 / :611`），而 `resolveOnce`/`rejectOnce`（`:312-327`）只清
`wholeCallTimer`，**全程无 `removeEventListener`**。闭包各自钉住 `controller`（native/fetch）或
`xhr` + emitter + dispatchState（xhr）在调用方 signal 上直到 GC。

边界不是零：signal 来自 `run-agent-turn.ts:329` 的 `internalController`（**每 run 一个，非每 step**），
一次 30 步 + 多子 agent 的大 run 可累积数百 listener，每个持一份 AbortController/XHR/emitter 闭包；
mobile 是常驻进程，同一会话反复重开会持续叠加。**同仓已有正确写法可照抄**：
`llm-sse-native/src/transport.ts:168-178` 的 `finish()` 与
`model-request.service.ts:119-144` 的 `delayWithSignal` 都做了 `removeEventListener`。

同款模式在 `run-agent-turn.ts:335`（callerSignal）与 `:1091`（parentSignal → childController）
各有一份，后者的 parentSignal 是父 run 的长命 signal，每次 `task` 派发都加一个。

**建议**：把 abort 转发抽成具名 handler，在 `resolveOnce`/`rejectOnce`/`handleWholeCallTimeout`
三处统一摘除；`run-agent-turn.ts` 两处同样在 finally 摘；补一条「N 次成功请求后 signal 上 listener 数为 0」的回归。

**置信**：confirmed（实跑）。

---

#### M-08 | P2 | anthropic / gemini 的 abort 路径重复 emit tool_use，违反 port 的显式契约

**双源**：`w2-core-infra-proto` F-2 + `w3-xc-proto` F-04（**实跑**：`after feed: tool-use,text-delta`
→ `after finish: …,tool-use`，emit count = 2）。

契约原文（`infra/llm-protocol/ports/adapter.port.ts:31-36`）：「每种协议每个 tool call **至多一次**」。
OpenAI 是对的——`openai-content-mapper.ts:494-502` 用 `emittedToolIndices` 挡了。
anthropic/gemini 的 `buildStreamPartialBlocks`（`stream-partial-blocks.ts:42-55`）**无条件再 emit 一次**
（`state.blocks` 里的 tool_use 已被 flush 过）。三家口径不一致。

**严重度校准**：判 **P2**（W2 曾提出 P1 之议）。判 P1 的理由是契约已破，判 P2 的理由是
当前**零功能消费方**：desktop `useAgentStream.ts:211-217` 对 `EVENT_AGENT_STREAM_TOOL_USE` 是空 handler，
mobile manager 根本没订阅（`session-stream-unit-manager.service.ts:415-465` 只订 TEXT/THINKING/STEP/USAGE）。
按「契约破坏 vs 用户可见」口径，无用户可见面 → P2。

**建议**：照抄 openai 形态——`AnthropicSseParserState` 加 `emittedToolUseIds: Set<string>`，
`buildStreamPartialBlocks` 加可选 `emittedKeys?: Set<string>`（与 gemini 侧
`emitToolUsesFromAccumulators` 已有形参同款），两个 partial finish 传入各自集合。

**置信**：confirmed（实跑）。

---

#### M-09 | P2 | partial 路径丢 thinkingSignature / degradedToolCalls / 块序

**双源**：`w2-core-infra-proto` F-23（判 intentional 口径记录）+ `w3-xc-proto` F-05（判 P3）。

1. **thinkingSignature 被丢（最重）**：`buildStreamPartialBlocks` 只吐 `{type:"thinking", text}`
   （`stream-partial-blocks.ts:37`），不带 signature；而 `flushActiveBlock` 的正常路径是带的
   （`anthropic-sse-parser.ts:114-118`）。W3 判断：用户中断一轮带 thinking 的 Anthropic 对话后，
   落库的 thinking 块无 signature，下轮回喂历史时**会被 API 拒绝**。
2. **degradedToolCalls 硬编码 `[]`**（`anthropic-sse-parser.ts:425` / `gemini-sse-parser.ts:405`），
   而 `flushActiveBlock` 已往 `state.degradedToolCalls` 收了 `INVALID_TOOL_ARGUMENTS`
   （`anthropic-sse-parser.ts:142-148`）——abort 恰落在参数损坏的 tool call 上时 `rawArguments` 全丢。
3. **块序被重排**（anthropic 按 `[thinking, text, ...toolUses, ...other]` 重建）。

**严重度校准**：从 W3 的 P3 提到 **P2**，理由是第 1 点若成立就是硬失败（不是观感问题）。
但「Anthropic 是否真的拒绝无 signature 的 thinking 块」属外部契约，本仓无证据可引——
**该子项升级为争议 D-3**，W6 需实跑一轮「带 thinking 块 → 中断 → 下一轮回喂」取证。
第 2、3 点维持 P2/P3 观感级。

**建议**：thinking 分支补 signature 透传；两个 partial finish 改用 `state.degradedToolCalls`；
块序改从 `state.blocks` 顺序过滤而非重排。

**置信**：confirmed（实跑 + 读码）；子项 1 的后果 suspected。

---

#### M-10 | P2 | 协议层错误分类与可观测性缺口簇

合并三处同族：

- **providerId 恒为 undefined**（`w2-core-infra-proto` F-8）：`postSse` 第 4 参与 `fetchJson` 第 4 参
  三家 adapter 一律传字面量 `undefined`（`anthropic.adapter.ts:198`、`openai.adapter.ts:221`、
  `gemini.adapter.ts:156` 等），而 `LlmChatRequest`（`ports/adapter.port.ts:55-76`）根本没有该字段。
  后果：本区抛出的每个 `ProviderError`（HTTP_ERROR / UNSUPPORTED_CONTENT / MALFORMED_SSE /
  INVALID_TOOL_ARGUMENTS）的 `providerId` 都是 undefined；`SseTransport.post` 的
  `opts.providerId`（`llm-sse-transport.ts:92`）与 native 侧 `types.ts:97` 声明的字段是**纯死参数**。
- **native 传输绕过 HTTP 状态码分类**（`w3-xc-proto` F-06b）：
  `NativeSseTransportError{kind:"http"}`（消息形如 `HTTP 401: …`）既不是 `LlmStreamTimeoutError`
  也不是 `ProviderError`，落到 `isRetryableError` 的 `true` 分支——**native 路径上 401/403/400 也被判可重试**，
  白等两次退避才报错，而 XHR/fetch 路径同状态码立即失败。属口径分裂。
- **未知 delta 类型静默丢弃**（`w2-core-infra-proto` F-19）：`input_json_delta` 在
  `state.active?.type !== "tool_use"` 时不进 malformed 计数、不告警；`signature_delta` 落到
  `ensureActiveThinking()` 会凭空造出空 thinking 块；`citations`/`input_json` 整体无处理。

**建议**：`LlmChatRequest` 加 `providerId` 并透传（`model-request.service.ts:214-230` 手上就有）；
`isRetryableError` 给非 ProviderError 补 `/HTTP\s+(\d{3})/` 兜底解析，与
`parseHttpStatusFromProviderError` 复用同一函数；未知 delta 记一条 `unrecognizedLineCount` 诊断。

**置信**：confirmed（三处均为确定性读码）。

---

#### M-11 | P2 | L1 整串缓存的 pendingWrites 跨会话共享，落库归属靠「谁最后 persist 就归谁」

`infra/tokenizer/logic/prompt-whole-cache.ts:71-78,318-360`：`pendingWrites` 是模块级数组、不带 sessionId；
`persistPendingWrites(sessionKkv, sessionId)` 先 `splice` 取走整批**再**判 `sessionKkv == null`（:322-325），
为 null 时批次已被取走且直接 return（永久丢失，但只是丢加速）；更实际的是 A 会话 `record` 的条目若在
B 会话 persist 前入队，会被写进 **B 的 KKV 行**，且 `persistedItems`（:78）按「最后 persist 的会话」归一，
A 的历史条目在内存表里被 B 覆盖。

模块头把「落哪个会话行只影响加速续命位置、无脏读」写成刻意设计（:20-25），同时又说「会话删除的级联清理会
连带丢他会话条目」——两条合起来意味着 **A 的加速数据会被 B 的删除清掉**，而这个「运行期互相覆盖」的后果
没写进注释的取舍清单。

**建议**：至少把该后果补进注释（文档与实现的落差）；更稳的做法是 pendingWrites 带 sessionId、
persist 时按会话分桶。

**置信**：suspected（口径是刻意设计，报的是文档落差）。

---

#### M-12 | P2 | 体积闸门三层口径不一致（字符当字节 / 通用读侧借用角色卡闸门 / 为测长度全量编码）

合并三处同族（跨 skills + workplace 两域，共用 `character-card-limits.ts`）：

- **字符数当字节**（`w2-core-workplace` F-4，`load-or-fill-file-cache.ts:191`）：
  `size.size` 是 SQLite `length(content)`，对 TEXT 返回**字符数**；而
  `CHARACTER_CARD_MAX_SINGLE_FILE_BYTES` 是**字节**（8 MiB）。注释 :171 声称「字符数 ≥ 字节数场景已足够」
  ——**对中文是反的**：CJK 一字 3 字节 UTF-8。8M 字符的中文文件 = 24 MB 实际字节，能过这道闸并被整读进提示词。
  本项目是中文小说写作工具，这是常态路径不是理论边界。对照 blob 分支（:199）走压缩侧 `byte_len`，
  是唯一口径不一致的一处。
- **通用读侧借用角色卡闸门**（`w2-core-workplace` F-6，`load-or-fill-file-cache.ts:23`）：
  workplace 的通用读取路径直接复用角色卡导入域的闸门，且对**所有** workplace 文件无差别生效
  （:142 只按 `status !== "filename"` 过滤）。后果：一个 3 MB 压缩比高的项目参考文档（正文 12 MB）
  被静默替换成「（文件过大，已跳过，约 12288000 字符）」送进提示词，用户与模型都看不出这是被裁掉的。
  同时这是**依赖方向倒置**（通用装配层依赖业务域）。RULE 与迭代文档只把这两道闸定位在「巨大角色卡」场景，
  未记录「对普通项目文件也生效」是拍板结果。
- **为测长度全量编码**（`w2-core-skills` F-5，`character-card-limits.ts:58`）：
  `utf8ByteLength` 快路径用 `TextEncoder.encode(text)` 拿 byteLength——为了测量长度把整串编码成一份
  `Uint8Array` 副本。而本模块存在的全部理由（:4-7）就是「巨大角色卡产生多份全尺寸拷贝触发原生 OOM」。
  手工折算兜底已写好（:61-83）但只在 `typeof TextEncoder === "undefined"` 时启用，
  在 Node/Electron/Hermes 上**永远走不到**——真正需要它的场景恰恰是「字符串很大」。

**建议**：内联分支改用 `utf8ByteLength`（或按 CJK 折算系数下调并写明依据）；
`utf8ByteLength` 改 `encodeInto` 配可复用 scratch buffer（零分配、结果与 `encode().byteLength` 一致），
补一组对拍用例防两条路径漂移；workplace 侧至少在文件头写明「全域生效是有意口径」并引拍板出处，
或把闸门下沉到角色卡导入链。

**置信**：confirmed（三处均为确定性读码）。

---

#### M-13 | P2 | 双端重复实现簇（15 组）——含与 W1 裁决 2 的处置冲突

`w3-xc-dup-ends` 全部 15 组的归并。已漂移出用户可见行为差异的三组单独列，其余按可下沉清单归并。

| 组 | 主题 | 漂移档 | 处置建议 |
|---|---|---|---|
| 1 | `summarizeToolInput` **三份实现三种行为**：desktop 有 skill 分支、mobile WebView 有 task 分支、mobile RN 卡片两个都没有 | C | 下沉 core `domain/chat/logic/tool-summary.ts`，**同时合并两个特判分支** |
| 2 | `hitRate` 分母 null 口径分叉（desktop 收 `number\|null`，mobile 只收 `number`） | C | 下沉 core，签名统一取 desktop 侧；RULE:45 已是持久规则 |
| 3 | `session-default-title` 前缀文案漂移（mobile「新会话」/ desktop「会话」），正则各自硬编码前缀 | C | 下沉 core，**前缀作为参数**，正则由前缀派生，消除「前缀与正则不同源」 |
| 4 | `buildNewSkillDoc` YAML 转义分叉 | C | **已独立为 M-02**（P1），从本簇移出 |
| 5 | `SKILL_ENTRY_FILE` 4 处字面量、public 面无出口 | B | **已独立为 M-15** |
| 6 | 存储迁移三态文案逐字相同但形态分叉（mobile 两函数 / desktop 表驱动） | B | 下沉 core 表驱动形态 |
| 7 | `deriveComposerSendState` + `findLastVisibleMessage` 逻辑逐字相同，差异全来自 desktop 的 DTO 壳 | B | 下沉 core，只依赖 `{role, content}` 结构化子类型 |
| 8 | `flush-run-ui` 签名分叉 | intentional | 保持各端私有，但**补文档说明为何不同**（缺文档保护） |
| 9 | `tool-turn-actions` hide 分支形态分叉 + `deleteToolTurn` 配对逻辑 | B | 见下方冲突说明 |
| 10 | `transcript-selectable-role` **12 个纯计算函数导出面全同** | B | 见下方冲突说明 |
| 11 | 4 对逐字重复（`useBatchSelection` 44 行 tokenJaccard=1.000；`parse-release-tag.ts` **字节级相同**；`language-for-path` 13 行；`useStreamTailGenerating` 8 行） | A | 零成本下沉 |
| 12 | 11 对近似重复（tokenJaccard ≥0.70，`prompt-preview.service` 达 0.966、`app-meta` 五个 URL 构造函数） | B | 按各行「可下沉清单」拆 |
| 13 | 各自私有实现只有名字相同（`stream-token-estimator` 依赖不同是 RULE:96 有意分化） | — | **不下沉**，标 intentional |
| 14 | 跨线索重复 8 项（`NEAR_BOTTOM_THRESHOLD_PX` 两端各定义、`normalizeFenceLang`、`draftToRecogitoAnnotation` 等） | B/C | 下沉 core |
| 15 | 端内重复（`summarizeToolInput` 两份都在 mobile 内；`NEAR_BOTTOM_THRESHOLD_PX` mobile 内部可能第三份） | — | 随组 1 / 组 14 处理 |

**处置冲突（重要）**：组 9、组 10 的原始建议是「下沉 core」，但 status.md W1 裁决 2 已确认
`transcript-selectable-role` 与 `tool-turn-actions` 的 **mobile 与 desktop 两份副本同死**（零生产 import）。
即正确处置是**成对删除**，不是下沉。**争议 D-1**，需主代理确认后由本簇改写这两组的建议。

另：W3 自己在争议 4 已指出「可下沉 ≠ 应该下沉」——core public 面有快照测试
（`packages/core/test/package-exports/snapshots/`），组 10 + 组 12 合计会让 public 面显著变大。
本簇不代拍这个板，只标注为 backlog 优先级输入。

**置信**：confirmed（逐对读过 + 消费者 grep 确认全活）。

---

#### M-14 | P2 | 循环环修复包：真环 5 个（core 3 + mobile 2），修正 L0 的「7 个」

`w3-xc-dup-ends` 组 16（方法论修正）+ 组 17（逐环方案），与 `w2-core-bootstrap` F-1
（三文件 import 环实锤，撤回 madge 零循环结论，见 status.md）旁证合并。

**口径修正**：L0 把「含至少一条 value 边的 SCC」都算成环，但 value 边只有一条、回边是 `import type` 的
SCC 在编译后**根本不成环**（`import type` 被 TS 整条擦除）。W3 用两套独立脚本 + 逐环读 import 语句复算，
**运行时真环 5 个**（core 3 + mobile 2），且 L0 表格首行的「runtime-risk 环 0」并不矛盾。
CYC-006 的假阳性直接成因是 **JSDoc `{@link import(...)}` 被误判为 import 语句**（`session-fs-errors.ts:210`），
应补进 L0 已知局限。**本簇不代改 L0 文件**（只读纪律），由主代理裁决。

**修复包**（5 环全部 runtime-safe，无一需紧急处理；但 A+D+E 合计只改 3 个文件，性价比极高）：

| 环 | 文件 | value 边 | 问题本质 | 方案 | 优先级 |
|---|---|---|---|---|---|
| A (CYC-003) | `skills.service` ⇄ `seed-builtin-skills` ⇄ `create-skills-service` | 3 | **service 层 → bootstrap 层 → service 层的层级倒挂**；文件头把「共用一份名单」误当成「同住一层」 | `BUILTIN_SKILL_NAMES` 单独下沉 `domain/skills/model/builtin-skill-names.ts`（**只搬这一个绑定**，`AGENT_CONFIG_SKILL_MD` 等留 bootstrap，它们不构成环边） | 必做 |
| B (CYC-005 子环) | `fs-command` ⇄ `fs-command-classify` | 2 | parse 与 classify 职责没切干净 | 惰性注入/反向注入（当前已惰性求值，运行时无风险；纯为让静态分析报 0 环） | 可做 |
| C (CYC-008) | `resolve-thinking-wire` ⇄ `thinking-level-presets` | 2 | 一个概念被切成两个文件 | **合并为单 logic 模块**（不要把 `resolveEffectiveMaxTokens` 下沉到 model——它依赖 `LlmProtocolKind`（infra port），下沉会引入 domain→infra 反向依赖） | 可做 |
| D (CYC-011) | mobile WebView transcript runtime 6 文件 | 14 | 观察者模式双向注册（`bridge` 是中心节点，5 个叶子都回引） | 抽 `web/shared/post.ts`，5 个叶子改从它 import | 必做 |
| E (CYC-013) | mobile composer-input 2 文件 | 2 | 环 D 的退化版 | 与 D 共用同一个 `web/shared/post.ts`（顺带回应 `20260830-mobile-cr-dedup-abstraction` 记忆里「三份平行」的技术债） | 必做（搭 D 的车） |

环 C 与本簇的 `w2-core-provider` F-3 / F-15 是同一处：F-15 指出
`resolveThinkingParamsForLevel`（`resolve-thinking-wire.ts:76-88`）是零值透传壳
（签名逐参数一致、只调一次并原样返回，还悄悄换了参数顺序），它与本体分处两文件正是环的成因。
**合并修法**：删掉该透传函数、调用方改引 `thinkingLevelToModelThinkingParams`，并把两个本体函数并入一个模块。

CYC-005 的 9 文件大 SCC 里另外 7 个文件（`vfs-tools`/`skill-tool`/`builtin-tool-context`/
`validate-agent-definition`/`validate-agent-tool-policy`/`agent-registry.port`/`persistent-state.port`）
**不是真环**（连边全是 `import type`）——修的时候只碰 2 个文件，别让人误以为要重构 9 个。

**置信**：confirmed（两套独立脚本交叉验证 + 逐环读源码）。

---

#### M-15 | P2 | `SKILL_ENTRY_FILE` 单源建了但没开出口，4 处字面量

**双源**：`w3-xc-dup-ends` 组 5 + `w2-core-skills` 争议 6。

`packages/core/src/domain/skills/logic/skill-paths.ts:16-17` 是 core domain 单源
（文件头注释明写「防止出现第二份路径逻辑」），但 `public/skills.ts` **未导出**它，于是：
`apps/desktop/renderer/features/settings/SkillDetailView.tsx:21-34` 本地重定义一份、
`apps/mobile/src/screens/stack/SkillDetailScreen.tsx:147-151` 硬编码 `"SKILL.md"`、
`packages/core/src/domain/tool/builtin/skill-tool.ts:41` 注释里还有第三份认知（「与服务层 SKILL_ENTRY_FILE 同值」）
——硬编码是靠注释维系的。

**建议**：`public/skills.ts` 加 `export { SKILL_ENTRY_FILE, SKILLS_ROOT }`；
desktop 删本地 const、`sortSkillFiles` 改用常量；mobile 改模板串拼接。

**置信**：confirmed（双源）。

---

#### M-16 | P2 | provider 域零消费派生群：9 份 builtin 派生里 6 份是死的

`logic/builtin-providers.ts:105-147` 从单一数据源 `BUILTIN_PROVIDER_ROWS`（:39，注释明写「禁止另维护第二套」）
派生出 9 张表/函数，只有 2 份是活的（`BUILTIN_PROVIDER_PROTOCOLS` → `infer-llm-protocol-from-model-id.ts:45`、
`BUILTIN_PROVIDER_UUID_PROTOCOLS` → 同文件 :30）：

| 符号 | 行 | 生产引用 |
|---|---|---|
| `BUILTIN_KEY_TO_UUID` / `BUILTIN_UUID_TO_KEY` | :105 / :111 | 无（仅 test） |
| `BUILTIN_PROVIDER_UUIDS` | :128 | 无（仅 test） |
| `BUILTIN_PROVIDER_IDS` | :125 | 无（@deprecated 别名，恒等于 `BUILTIN_PROVIDER_KEYS`） |
| `builtinProtocolByProviderKey` | :133 | 无 |
| `builtinProtocolByProviderId` | :140 | 无（@deprecated） |
| `BUILTIN_PROVIDER_KEYS` | :120 | 无（仅 test） |

每新增一行 seed 数据都要维护 9 处 `Object.fromEntries`。两个 `@deprecated` 却从未有过调用方，
说明兼容期早已过期。

**建议**：只留 `BUILTIN_PROVIDER_ROWS` + 上述 2 份 protocols map，其余一并删（含两个 deprecated）。
与 M-14 环 A 同属 skills 域的收敛动作，建议打包。

**争议 D-4**：`BUILTIN_UUID_TO_KEY`/`BUILTIN_KEY_TO_UUID` 这对双向映射看起来是给「跨库合并撞 id」预留的
（与 `createProviderSecretRenameOperation` 同一猜想）。若那条线在规划中应标 intentional 而非删除。
本簇倾向删（RULE 的迁移退役节奏表明本仓偏好物理删除），但需主代理确认无规划中调用方。

**置信**：confirmed。

---

#### M-17 | P2 | 删除守卫的 `chat_project` 扫描结构上永空，且 `prompts_json` 裸 `JSON.parse`

`logic/find-saved-model-references.ts:56,66-90`：扫的是 `chat_project.agent_config_json`，
但按 `docs/apm/RULE.md:38`「项目智能体（已下线）……v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留」，
`service/agent/logic/resolve-agent-for-project.ts:37` 明写「不再读取该列」，
`bootstrap/novel-master-bootstrap.ts:250-269` 的 `hasLegacyChatProjectShape` 甚至断言该列非 NULL 行数必须为 0。
即这段扫描**永远扫不到东西**，却每次删除都全表扫一遍 + 逐行 `JSON.parse`。

`:56` 的 `JSON.parse(String(row.prompts_json))` 无 try/catch：任一行 agent prompt JSON 损坏，
整次删除守卫直接抛 SyntaxError（且 `AgentDefinitionRow.prompts_json` 类型标成非空 string，实际列可空）。

**建议**：删掉 `chat_project` 分支（连同 `ChatProjectRow` 接口）；`prompts_json` 加 null/try 保护。

**置信**：confirmed。

---

#### M-18 | P2 | 应用模型 id 归一：前缀早退绕过了 `models/` 剥离

`logic/application-model-id.ts:49-67`：`value.startsWith(`${providerId}/`)` 早退**绕过了后面的
`models/` 剥离**，两个语义等价的输入产出不同结果——
`normalizeVendorModelId("openai", "openai/models/gpt-4")` → `"models/gpt-4"`
（应为 `"gpt-4"`）；`normalizeVendorModelId("openai", "models/gpt-4")` → `"gpt-4"`。
doc（:36-38）声称两者都会剥。

线上未爆（`provider-model.service.ts:81` 的 fetch 主路径传裸 id），但
`config-forms/shared/application-model-id.ts` 消费粘贴的完整 application id，会踩到早退分支。

**建议**：把 `models/` 剥离提到前缀早退之前（或早退后继续走剥离）。

**置信**：confirmed。

---

#### M-19 | P2 | `skillsEnabled` / `skillsPrefix` 白名单漏字段 + persistCount 少门（两处同源 latent）

合并 `w2-core-prompt` F-1（主代理已降级为 P2）+ F-2。

```ts
// domain/prompt/logic/normalize-agent-prompt-layout.ts:62-73
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    ...(layoutHasCustomAttach(layout) ? { customAttach: layout.customAttach } : {}),
    persist,
    dynamic: [...layout.dynamic],          // ← 漏了 skillsEnabled 与 skillsPrefix
```

后果：`prompts.skillsEnabled: false` 的 agent 从 domain-shape 存储读出后变成 `undefined` →
`resolve-agent-tool-registry.ts` 的 `if (definition.prompts.skillsEnabled === false)` 不成立 →
**skill 工具不被摘除、skill 索引照常注入**。`skillsPrefix` 同理丢 customizing 前缀语。
这是 `docs/Iterations/cr-fix-spec/review/phase2-slice/D2-prompt.md` 记录过的**同一类 bug 复发**
（那次修的是 `customAttach` 丢失）。

同源的第二处（`render-prompt.ts:104-113`）：`computeLlmExportZonesFromLayout` 的 persistCount
只看 `options.skillsIndex.length`，**不看 `layout.skillsEnabled`**，而真正拼装消息的
`buildPromptLlmInputFromLayout` 是双保险的。`skillsEnabled === false` 且 `skillsIndex` 非空时多算 1，
`resolveZone` 据此把本该属 chat 区的第一条消息判成 persist 区 → **跨区 merge 禁令被打开**。
当前不可达（`budgetSkillsIndexEntries` 读的 `toolCtx.skills` 只在 registry 保留 skill 工具时注入），
但这是**跨文件隐式不变量，无断言守护**。

**严重度校准**：维持 **P2**。F-1 的字段遗漏由代码直读确认，但唯一消费链
`resolveAgentDefinitionFromStorage` **当前无生产调用方**（`rg` 全仓只命中 3 个测试文件；
`apps/desktop/shared/logic/config-forms-stored-config-validity.ts:5-6` 显式禁止 renderer 再调用）。
即潜伏于公开子路径导出面，暂不可达。主代理已就此降级。

**建议**（要点是**系统性**而非逐字段补）：normalize 的白名单展开改用 exhaustiveness 断言
（对 `AgentPromptLayout` 的键做 `satisfies Record<keyof AgentPromptLayout, true>` 编译期守卫），
让「新增字段忘了跟上」在编译期就红，而不是靠第二次人工补 `skillsEnabled`。
同时补一条「删掉 spread 即红」的 skills 两字段断言（现有 6 条测试零断言 skills）。
`computeLlmExportZonesFromLayout` 的 persistCount 加同款门，或抽
`shouldInjectSkillsIndexMessage(layout, skillsIndex)` 纯函数由两处共用。

**置信**：confirmed（遗漏）/ suspected（生产可达性）。

---

#### M-20 | P2 | `$filetree` 预检与宏解析不同源：`{{$.filetree}}` 静默展开为空串

`domain/prompt/logic/expand-dynamic-macros.ts:32-36` 用朴素子串 `content.includes("$filetree")` 预检，
而宏语法是 `{{$filetree}}`（`macro-scan.ts:64`）。两个方向都偏：
- **假阳**：正文出现字面量 `$filetree` 会白跑一次 `renderFileTree()`。
- **假阴**：`{{$.filetree}}`（`macro-scan.ts:66` 显式支持 `$` 后跟 `.`，`key = rest.slice(1)`）
  **不会**命中子串预检 → 宏解析时 `root.filetree` 是空串 → `lookupRoot` 只在 `value == null` 时抛
  UNKNOWN_FIELD，`""` 合法通过 → **静默展开成空串**，提示词里少一棵文件树，模型无从察觉。

同款偏差在 `agent-runner.ts` 的 `resolveTurnFiletreeSnapshot`（回合级预取用同一个朴素子串），
两处同根因：宏语法知识在 `infra/prompt-template/macro-scan.ts`，预检却手写字符串匹配。

**建议**：预检改用 `scanMacroActions(content).some(a => a.kind === "root" && a.path[0] === "filetree")`，
与解析器同源；`agent-runner.ts` 同步改。或对「文本含 `$filetree` 但扫描器没找到 filetree 根宏」补 dev 期 warn。

**置信**：confirmed。

---

#### M-21 | P2 | front matter 识别在本域有两份不等价实现，重写侧会把旧块变成正文

`skills/logic/with-skill-front-matter-values.ts:51` 的识别正则要求 `---` 后**紧跟**换行
（`/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/`），而解析侧走 `splitMarkdownFrontMatter`，
其判定是 `FRONT_MATTER_START = /^---\s*$/`（`workplace/logic/front-matter.ts:7`）逐行测试，`\s` 覆盖尾随空格。

于是 `--- \nname: a\n...\n---\n\n正文`（分隔符带一个尾随空格，YAML 生态常见）：
解析侧 → `valid: true`；重写侧 → `match == null` → 走 `:53-56` 的「无 front matter 块」分支，
**在文件头再插一个完整 front matter 块**。结果文件里出现两个块，`splitMarkdownFrontMatter` 只取第一个，
旧的 `--- \nname: a...` 整块**变成正文可见内容**——技能文档正文凭空多出一段 YAML。
`updateSkillInfo` 的调用点（`skills.service.ts:566-574`）正是「解析成功才重写」，真实改名/改描述会走到。

**建议**：让重写函数复用 `splitMarkdownFrontMatter` 的判定口径（同一份 `FRONT_MATTER_START`），
或两处合并为 domain 内单源；补一条「分隔符带尾随空白」的 core 侧测试（当前 core 侧无此文件测试）。

**置信**：confirmed（两侧判定式已读原文，差异是确定性的）。

---

#### M-22 | P2 | `skill.schema` 的 `.strict()` × 重写函数「保留其余键」= UI 静默无效的死角

`skills/model/skill.schema.ts:23` 的 `.strict()` 让 `name`/`description` 之外的**任何键**都使技能永久 invalid；
而 `withSkillFrontMatterValues` 的设计承诺恰恰是「保留其余键」（文件头 + `:58-65` 的「块内缺失该 key 时追加到块尾」）。
两处叠加产生**无法从 UI 脱困的死角**：一个带 `version: 1`（或任何第三方附加元数据）的 SKILL.md
→ `parseSkillFrontMatter` 返回 `valid: false` → `updateSkillInfo` 的
`if (source != null && parseSkillFrontMatter(source).valid)`（`skills.service.ts:566`）判定跳过重写
→ 用户在「编辑信息」里改描述**静默无效**（目录迁移那半边还会执行，于是出现「技能目录已改名、
SKILL.md 里还是旧名」的不一致状态）。ZIP 导入同病：双端 `NewSkillModal.tsx:219` 无条件调重写函数，
导入带附加键的技能包 → 落盘即 invalid 且 UI 改不动。

**建议**：二选一并写进 RULE——(a) schema 改 `.loose()`/`.catchall(z.unknown())`，严格性只放在
「name/description 必填」；(b) 保持 `.strict()` 但 `updateSkillInfo` 改成「invalid 时仍重写
name/description、只是不视作修复」，UI 显式提示「该技能含未知 front matter 键，重命名不会生效」。
无论哪种都要一条 core 侧测试锁住行为。**争议 D-5**（口径需产品判断，本簇不单方面定调）。

**置信**：confirmed（schema、重写函数、service 调用点、双端 UI 调用点全部读过原文）。

---

#### M-23 | P2 | 复制/改名类仓储方法的「必须在事务内调用」契约缺失

合并 `w2-core-workplace` F-7 与 `w2-core-skills` F-10（同型不同域）：

- `workplace/repositories/impl/sqlite-workplace.repository.ts:244` `copyScope` 是 4 步非原子操作
  （清空目标 → 读源 ×2 → 写目标 ×2），`deleteScope`（:163-176）自身也是两条独立语句之间无事务。
  任一步失败，目标 scope 停在「空」或「只有 dir 规则」的半拷贝状态，而 port 契约
  （`workplace.port.ts:54-58`）只说「Replaces all rules」，**没声明必须在事务内调用**。
  现状安全：三个生产调用方都用 `new SqliteWorkplaceRepository(tx)` 落在外层事务里；
  但 `createWorkplace-service.ts:33` 构造的是**非事务** conn，任何未来非事务调用方静默失去原子性。
- `skills/repositories/impl/sqlite-skill-disabled-rule.repository.ts:86` `renameByName` 由
  UPDATE OR IGNORE + 无条件 DELETE 两条独立语句组成，方法本身不开事务，唯一调用方确实包在事务里，
  但 port 签名（`skill-disabled-rule.port.ts:32-36）无任何约束。
  下一调用方用非事务 conn 会得到「UPDATE 成功、DELETE 失败」的半迁移：技能同时存在新旧两个名字的禁用行，
  改名后**继续处于禁用态**且旧名留孤儿行。

**建议**：port 的 JSDoc 写死「必须在事务连接内调用」并在依赖注入点补同款警示；
或让方法自包事务并在检测到已是事务连接时复用（`renameRulesUnderLogicalPrefix:318` 已有「复用外层 tx」的注释先例）。

**置信**：confirmed（缺陷是契约缺失；当前生产调用方恰好安全）。

---

#### M-24 | P2 | 手动清理只清 blob 侧 pending 键 → 冷启动多跑一次全库 VACUUM

**双源**：`w2-core-infra-misc` F-4 + `w4-msgstore-pro`（status.md 裁决行已记同款结论）。

`db-maintenance/impl/db-maintenance.service.ts:88-99` 手写
`DELETE FROM kkv_entry WHERE module = ? AND key = ?`，参数是字面量
`["nm-blob-binary", "startupMaintenancePending"]`。blob 侧私有常量
`STARTUP_MAINTENANCE_PENDING_KEY`（`blob-binary-normalization.ts:72`）值相同但模块私有、互不引用
（为避免循环依赖，合理）；但 message 侧的 `MESSAGE_COMPACTION_MAINTENANCE_PENDING_KVV_KEY`
（同值 `startupMaintenancePending`，module 不同）是 **exported 的**，db-maintenance 却**没有**顺手清它
——即手动「数据清理」成功后，message 侧若留有 pending 标记，下次冷启动仍会多补跑一次全库 VACUUM，
与该代码块注释声明的意图在 message 侧落空。

**建议**：把那条 DELETE 扩成两条（或 `WHERE module IN (?, ?)`）。注意不能改成 import 常量——
`message-content-compaction` 已 import db-maintenance，反向引用会成环，保留字面量但写全两条并注明原因。

**跨簇重叠**：`w4-msgstore-{pro,adv}` 在 synth-core-data 的输入集里，**本条应指定单一归属簇**（争议 D-6）。

**置信**：confirmed（双源）。

---

#### M-25 | P2 | push/agent 互斥锁已实现但**全仓无 agent 侧调用方**，且未从 index 导出

`cloud-sync/logic/push-agent-mutex.ts` 整文件 + `cloud-sync-coordinator.ts:49,60,119`：
`getDefaultPushAgentMutex` 的全仓引用只有 3 处，**全在 coordinator 自身**；
`apps/desktop/src/main/ipc/handlers/agent.ts:410` 与 mobile 对应入口**只做
`isDesktopAgentActive()` 布尔检查，从不 acquire 这把锁**。更关键的是
**`PushAgentMutex` 与 `getDefaultPushAgentMutex` 都没从 `infra/cloud-sync/index.ts` 导出**——
apps 层即便想接也拿不到，这是「接线未完成」的硬证据，不是设计取舍。
模块头第 6-8 行却把「push 和 agent 启动入口排队」写成已实现的能力。

现状下 coordinator 靠两处 `isAgentActive()` 复检（:219、:267）兜底，而那两处是**采样式**的：
agent 在上传完成后、final status PUT 之前抢跑写入，快照与库不一致——即注释里说的
「agent 拍跑到这里就拒绝」只覆盖「上传期间」，不覆盖「上传完成到 final PUT 之间」。

**建议**：二选一——(1) 把两个符号加进 `infra/cloud-sync/index.ts` 与 `packages/core/src/index.ts`，
在 desktop `handleAgentRun` 与 mobile agent 入口 acquire/release，模块头改成「agent 侧接线待办」；
(2) 若短期不接，把模块头与 coordinator:49 注释改成「当前仅互斥并发 push，agent 侧靠 isAgentActive 采样守卫
（已知盲区：上传完成到 final PUT 之间）」。

**转交**：本条的 agent 侧入口在 apps/，**归属 synth-cloudsync**（见「跨簇转交」）。

**置信**：confirmed（grep 全仓引用集合 + index 导出面缺失，均为确定性核对）。

---

#### M-26 | P2 | webview tsconfig 未设 `types: []` → es2018 纪律形同虚设，2 处 `trimStart` 越界

**双源**：`w3-xc-proto` F-06(a)（**实跑**：往 `apps/mobile/src/web/shared/` 丢探针用
`replaceAll`/`Object.hasOwn`/`Promise.any`/`flatMap`/lookbehind，`npx tsc --noEmit -p src/web/tsconfig.json`
**零报错**）+ `w2-mobile-web`（status.md 裁决行已记同款：「es2018 纪律被 @types/node 架空」）。

`apps/mobile/src/web/tsconfig.json:7` 的 `"lib": ["ES2018","DOM"]` 被注释与 `RULE.md:73` 当纪律闸门，
但该 tsconfig **没设 `"types": []`**，TS 自动注入 `@types/node` 的全局增强，把 ES2019+ 内建方法全补齐。

现状盘点（越界项全部 ≤3 处）：`annotate-collect.ts:132-133` 的 `trimStart()`/`trimEnd()`、
`block-split.ts:42` 的 `trimStart()`——需要 ES2019（Chrome 66+）。
`(?<` / `\p{` / dotAll 在 web 层**零出现**，纪律的**核心目标目前是守住的**。

风险面：`minSdkVersion = 26`（Android 8.0，出厂 WebView 约 Chromium 58-60，且国内 OEM WebView 更新常滞后）。
`trimStart` 是运行时 `TypeError`（不是解析期 SyntaxError，所以走到划词/批注路径才炸，**可观测性差**）；
lookbehind 才是加载期整页白。RULE 记录过 2026-08-20 第一版把 lookbehind 点炸老 WebView 的实锤。

自动化守卫缺口：唯一守卫测试 `apps/mobile/__tests__/chat-transcript-stream-block.test.ts:215-227`
只断言 **4 个文件**不含 `(?<`/`\p{`/`s})`，`rich-document/`、`code-editor/`、`composer-input/`、
`shared/`（含 vendored 的 `mermaid-core.ts`）**全不在内**。

**建议**：(1) tsconfig 补 `"types": []`（先确认 `shared/` 下没在用 Node 全局）；
(2) 两处 `trimStart/trimEnd` 换成 `replace(/^\s+/,"")`（或抽 `trimStartCompat` 放 `shared/`）；
(3) 守卫测试从「列 4 个文件」改成「扫整个 `apps/mobile/src/web` 目录」，
并加 `trimStart|trimEnd|replaceAll|Object\.fromEntries|matchAll|Promise\.any` 的禁用断言。

**转交 synth-apps-mobile**（文件全在 apps/mobile）。

**置信**：confirmed（实跑）。

---

#### M-27 | P2 | 兼容网关不发 `index` / `id` 时，并行 tool_call 塌陷为一个

合并 `w2-core-infra-proto` F-6 + F-7（同类不同协议）：

- OpenAI（`openai-content-mapper.ts:385`）：`const index = typeof tc.index === "number" ? tc.index : 0;`
  ——省略 `index` 时**所有 tool_calls 全部塌进 index 0**：`argumentsJson` 被顺序拼接、
  `name`/`id` 被后写覆盖。多个并行工具调用退化成 1 个（多半 JSON 非法 → 走 `degradedToolCalls`
  降级成 `input={}`，**工具静默不执行**）。OpenAI 规范保证 `index` 必带，但兼容网关不守规矩。
- Gemini（`gemini-sse-parser.ts:122`）：未回 `functionCall.id` 时 `key` 退化为 `fc.name`，
  **同名函数的并行调用塌成一个累加器**（`argsJson` 被后者整体覆盖）。附带：`:132-137` 用
  `acc.argsJson = newJson` **覆盖**而非追加——Gemini 官方是整对象下发所以正确，
  但若某网关改成分片对象下发会丢键（建议保留覆盖 + 注释锁定）。

**建议**：缺失 `index`/`id` 时退化为「按出现顺序分配下一个未占用槽位」，至少能区分两个并行调用；
gemini 侧加注释锁定覆盖语义。

**置信**：suspected（无真实网关抓包）。

---

#### M-28 | P2 | gemini 历史里存在一个 image 块 → 整轮 run 硬失败而非降级

`gemini-content-mapper.ts:220-224` 的 `blocksToGeminiParts` 遇 `image` 块直接
`throw new ProviderError("UNSUPPORTED_CONTENT")`，而 `chatMessagesToGeminiContents:376-381`
会把历史里的任意非 tool_result 块喂进来——**只要历史里存在一个 image 块，整轮 run 直接抛错**，
而不是降级为纯文本。当前产品路径基本到不了（RULE：attach 的图片「只给文件名不喂正文」，
`parse-message-content.ts:140` 的 image 块只从入站响应产生），所以是潜伏态；
但它是**硬失败**而非降级，且 `gemini-content-mapper.test.ts` / `protocol-gemini.test.ts` 里
**零 image 用例**（已实测 grep 无命中）。

**建议**：与 `blocksToTextOnly`（`text-only-content.ts:19`）口径对齐：明确决定是「跳过并记日志」
还是「硬失败」，并补一条锁定用例。

**置信**：suspected（可达性未实测；RULE 判定产品路径不可达）。

---

#### M-29 | P2 | 模型建议 upsert 是 O(N²) 次序列化 + N 次 KKV 写事务

`domain/provider/repositories/impl/kkv-model-suggestion.repository.ts:44-65`：
每次 upsert 都是「读整份文档 → 改一个元素 → 写整份文档」。调用方
`service/provider/impl/provider-model.service.ts:80-90` 在 for 循环里对每个模型调一次，
N 个模型 = N 次整文档读 + N 次整文档写。OpenRouter / OpenCode Zen 这类 provider 一次返回数百个模型。

语义上无 bug：`markStaleExcept` 在所有 upsert 之后调用且会保留 `existing?.displayName`
（`provider-model.service.ts:92`），所以 displayName 不会被抹掉。

**建议**：port 加 `upsertMany(providerId, suggestions[])`，或 fetch 路径直接调 `markStaleExcept` + 一次批量写。

**置信**：confirmed（复杂度）/ suspected（实际耗时未实测 500 模型场景）。

---

#### M-30 | P2 | workplace 评估的实际复杂度与模块头契约不符；排序次数口径打架

合并 `w2-core-workplace` F-3 与 F-12：

`computeHeadTailIndices`（`workplace-eval.ts:165`）每次调用都新建 `Set` 并插入
`min(head,total)+min(tail,total)` 个元素，而它在**每个文件**上被调一次
（`workplace-rule-engine.ts:176`，由 `buildDisplayByPath:135` 遍历）。默认 `tailCount = 1000`
（`default-dir-rule.ts:20`）→ 556 文件的工作区一次评估光这一项就 ~55 万次 Set 插入。
这与 `workplace-rule-engine.ts:4-7` 的模块头契约「单次评估 O(N·logN)」直接冲突——排序确实被优化到
O(N·logN)（`buildDirSortPlans` 缓存了名次与计数），但 head/tail 优先集没跟着缓存，
把 O(N·(head+tail)) 又请了回来。

F-12：同一模块头声明「每个目录的文件只排序**一次**」，但 `buildDirSortPlans` 对每个目录实际调
`sortFilesForDir` **两次**（:105 auto 名单、:113 全量名单），智能排序下 `decorateSmartCache` 也重建两遍。
函数级注释（:70-71）写的是准确的「每个目录只排序两次」，两处口径打架。

**建议**：优先集并入已有的 `DirSortPlan`（`workplace-rule-engine.ts:39-46`）按目录缓存一次，
`computeDisplay` 从 plan 取；补一条计数式断言（每目录 `computeHeadTailIndices` 调用次数 = 目录数，
不是文件数）。模块头与函数级注释统一为「每个目录排序两次」。

**置信**：confirmed（结构）/ 未实测（典型工作区的 head+tail 配置若都为 0 则该项接近零成本，
建议先测再改）。

---

### P3

---

#### M-31 | P3 | 死码与退役簇（14 项）→ 转交 synth-dead

| 项 | 位置 | 说明 |
|---|---|---|
| `validate-prompt-blocks.ts` + `PromptBlock` 联合类型 | `domain/prompt/` | 生产零调用（`rg` 全仓只命中自身 + 13 条测试），服务的 `prompts.blocks` 形态已被 `agent-definition.schema.ts:41-46` 显式判死。~180 行 + 13 条测试的死路径，新人读代码会误以为 `blocks` 仍受支持 |
| `logic/message-body.ts` | `domain/prompt/` | 零逻辑纯再导出 shim，指向隔壁两个目录的 `chat/content/message-body-text.ts`；仓内另有 4 处直连，域内自相矛盾 |
| `renderWorkplaceFileTree` + `workplaceFileTreeRootLabel` public 导出 | `domain/workplace/` | 生产零调用方（`workplace.service.ts:294` 用的是 `...ForMacro` 版） |
| `parseKkvJsonDocument` + `infra/kkv/` 整目录 | `infra/kkv/` | 全域 21 行、零消费、未从 `index.ts` 导出 |
| `derive-model-name-from-legacy` + 专属测试 | `domain/provider/logic/` | 零生产消费；按 RULE 的迁移退役节奏，源文件与测试都应物理删除 |
| `parseToolArgumentsJson` / `parseOpenAiSseStream` / `blocksToOpenAiMessageContent` | `infra/llm-protocol/` | 三者均无生产消费（后者只在同文件内被调）；`parseOpenAiSseStream` 是 `postSse` 取代前的历史双实现残留，最值得删 |
| `createProviderSecretRenameOperation` | `provider/logic/provider-identity-repair.ts:105-152` | doc 自陈用途是「未来如果有…可以复用」——纯投机性死代码（149 行的一半） |
| `createProviderIdentityRepairOperation` 未注册 | 同上 | 退役有出处（bootstrap:388-389 明写随 vfs-entry-id-redesign-v1 移除），标 intentional；同文件 `detect()` 的空 display_name 分支结构上不可达（`rowToProvider` 读行时已抛），且 `repair()` 抛 `"MIGRATION_ORPHAN_POINTER"` 与语义无关 |
| `savedModelSettingsDocumentSchema` 等 3 个别名 | `provider/model/saved-model-settings.schema.ts:129,78,26` | 标 `@deprecated 保留别名供旧引用` 但零引用；另两个降为模块私有 |
| `toSavedModelView` / `SavedModelView` | `provider/model/saved-model.ts:33-43` | 只出现在本文件 + barrel；实际在用的是 `savedModelDisplayName` |
| `maxOutputTokensFromSampling` / `samplingProtocol` / `thinkingProtocol` | provider model | 三者零生产消费（`params?.protocol` 一行取属性） |
| 两份同成员枚举（`THINKING_LEVEL_OPTIONS` / `TOKEN_COUNTER_MODE_OPTIONS`） | provider model | 双端 UI 全用 SELECT 版，裸值版零生产消费（后者仅被 1 个测试引） |
| `mapSessionWorkplacePathToSession` / `mapProjectWorkplacePathToSession` | workplace/logic | 两者都是纯 `normalizePath` 恒等；`mapSessionWorkplacePathToProject` 生产零调用（JSDoc 写了 identity after unified root 的理由，标 intentional 但可降级） |
| `frontMatter.closed` 字段 | workplace/logic/front-matter.ts:16 | 恒为 `true` 的签名兼容残留，无人读；但 5 处测试仍断言它恒真（RULE 点名的恒真断言形态） |

**置信**：confirmed（全部为确定性 grep + 读码）。

---

#### M-32 | P3 | SSE 行缓冲层欠账

合并 `w2-core-infra-proto` F-12 与 `w3-xc-proto` F-07：

- `SseLineBufferState` 声明 `{ readonly buffer: string }`，写入靠
  `(state as { buffer: string }).buffer = trailing` 强转绕过 readonly——类型谎言 + 一个共用的 cast 抑制点。
- **`state.buffer` 无上限**：上游发来一条不含 `\n` 的超长行（超大 base64 图片内联）时缓冲无界增长。
- `feedSseLines` 只按 `"\n"` 切行，`\r` 靠各 parser 的 `slice(6).trim()` 侥幸吃掉。CRLF 实测兼容，
  但这是**三处 parser 各自兜住了共享层该兜的事**：按 SSE 规范 CRLF/LF/CR 三种换行都合法，
  纯 `\r` 换行的流会被当成一整行 → 全部丢弃。建议在 `feedSseLines` 统一按 `/\r\n|\n|\r/` 切。
- XHR 分支若在 `xhr.send()` 之前抛错（如 `applyXhrHeaders` 遇非预期 headers 形态，`:582`），
  `cleanupBranch`（:476）已挂上但没人调，emitter 的 32ms `setInterval` 永久泄漏（概率低）。

**置信**：confirmed（类型与结构）/ suspected（纯 `\r` 流未构造验证）。

---

#### M-33 | P3 | tokenizer / nmtp 分层与导出面漂移簇

合并 `w2-core-infra-proto` F-14 + `w2-core-infra-misc` F-13 / F-16 + provider 域的 tokenizer 依赖：

- **分层倒置**：`infra/nmtp/ports/tokenizer-driver.port.ts:7-10`（port，抽象）反向 import 了
  `infra/tokenizer/logic/count-prompt-llm-input.js`（实现层的具体函数）；`tokenizer/index.ts:128` 又把
  nmtp 的东西 re-export 出去——`nmtp`（协议抽象）↔ `tokenizer`（实现）互为依赖，实为同一件事被切成两半。
- **`@deprecated` 与实际使用矛盾**（`tokenizer/logic/resolve-tokenizer-family.ts:136`）：
  `mapVendorModelIdToTiktokenModel` 标 `@deprecated Use resolveTokenizerFamily`，
  但全仓有 **5 处生产消费方**（`packages/tokenizer-driver-node`×2、`tokenizer-driver-rn`、
  `apps/mobile/src/services/stream-token-estimator.ts:126`、`public/provider.ts:161`），
  移动端还在用它做 o200k 改写。二选一：撤销 `@deprecated`（它现在是编码表选择的事实单源），
  或改成 `@deprecated` + 一句「仅 tiktoken 编码表名映射链路使用」。
- **provider 域 → infra/tokenizer 的依赖**：`domain/provider/model/{saved-model-settings,token-counter-mode-options,default-saved-model-settings}`
  分别 import `infra/tokenizer/logic/{resolve-tokenizer-family,read-token-counter-mode-pref,seed-context-window-tokens}`。
  domain 引 infra 是本仓允许的方向（`infra/llm-protocol` 同款），但 tokenizer 属「实现 + 缓存」重镇，
  provider 的纯模型层被它绑住，与 M-14 环 C 里 W3 提醒的「下沉到 model 会引入 domain→infra 反向依赖」
  是同一族权衡。
- `tokenizer/index.ts:125-132` 的导出面混入 nmtp 域驱动注册 API——设计上就是统一出口，标 intentional，
  但 L3 读「tokenizer 对外接口」清单时须知这层是穿透。

**另簇外提示**：cli-periph 机位独立命中「双 tokenizer 驱动对称漂移」（RN 缺 node 的 cr-tok-1 修正、
node 缺 RN 的 p50k 出界防护），**不在本簇输入集内**，已在 status.md 登记；建议与本条同批下沉 core 统一，
归属由主代理指定。

**置信**：confirmed（结构与引用数均为确定性核对）。

---

#### M-34 | P3 | provider 域内一致性小面（11 项）

| 项 | 位置 | 说明 |
|---|---|---|
| API key 空串两函数判定相反 | `model/resolve-provider-api-key.ts:27,52` | `resolveProviderApiKey` 把 `""` 当未配置（回落内置默认再抛 API_KEY_NOT_SET），`providerApiKeyIsConfigured` 视 `""` 为已配置（`has` 只查行存在）。后者喂 `provider.service.ts:276-281` 的 `apiKeyStatus` → UI 显示「已配置」但一跑就报未设置。当前**不可经标准写路径触发**（:75 只在 truthy 时 set，:140-147 把 `""` 当删除），属结构性分歧 |
| 两处 identity `.transform` | `saved-model-settings.schema.ts:113-120` + `model-suggestion-cache.schema.ts:26-32` | 输出与输入结构完全相同（零字段映射、零默认值填充），「以为在归一化、其实什么都没做」的噪音 |
| `id.includes("gemini-3") \|\| id.startsWith("gemini-3.")` | `thinking-level-presets.ts:28-31` | 第二个条件被第一个完全包含，恒冗余 |
| gemini `thinkingLevel` 是不受约束的 `z.string()` | `model-thinking-params.ts:23` + schema:25 | 同一 union 里 anthropic 是字面量、openai 是 `z.enum([...])`，唯独 gemini 放宽类型。拼错的档位（`"hgih"`）能过 schema 上线。实际写入方传的是受约束值，暂无实害，但 schema 是持久化/校验边界 |
| 新建 vs 读旧行两个相反默认 | `default-saved-model-settings.ts:28` vs schema:59 | 新建 `thinkingLevel: "high"`，读盘缺失时 `.default("off")` 回填为 `"off"`。文件头只说明了后半句 |
| `parseHeaders` / `parseBodyParams` 近乎逐行重复 | `sqlite-provider.repository.ts:19-48` | 同样的 JSON.parse→null/非对象/数组→`{}`→try/catch，唯一差别是前者多一层 `typeof v === "string"` 过滤 |
| 模块级共享 `SqlTemplateParser` | `find-saved-model-references.ts:16` | 与两个 SQLite repo 的实例级私有 parser 不一致，会被并发删除请求同时使用 |
| 两条 import 可合并 | `sqlite-saved-model.repository.ts:14-15` | 同一模块的两条 import 语句 |
| `assertSavedModelUuid` 首个检查被第二个完全覆盖 | `logic/assert-saved-model-uuid.ts:27-33` | `trimmed.includes("/")` 不可能先于 `isSavedModelUuidFormat` 命中；唯一价值是错误文案更具体，建议注释说明它只为诊断存在 |
| `resolveThinkingParamsForLevel` 零值透传 | `resolve-thinking-wire.ts:76-88` | 见 M-14 环 C，合并修 |

**置信**：confirmed（全部确定性读码）。

---

#### M-35 | P3 | 提示词与展示层杂项（12 项）

- `formatCharCount` 非有限值传播 + **废断言**：`format-char-count.ts:2-3` 的
  `n.toLocaleString("zh-CN")` 不夹取；`format-stream-metrics-line.ts:57` 传的
  `composeStreamTokens(base, increment) = Math.max(0, base + increment)`，而 `Math.max(0, NaN) === NaN`
  → 指标条显示「输出 NaN tok」（`increment` 能否为 NaN 取决于 `incremental-token-counter` 的 encode 绑定，
  在本簇外未追）。现有断言是 `assert.match(formatCharCount(1234), /1/)`——**近乎恒真的废断言**。
  建议 `Number.isFinite` 兜底 + 换成精确值断言 + 补 0/负数/非整数边界。
- `MAX_RATE_SAMPLES = 512` 与注释严重脱节（`sliding-token-rate.ts:82`）：注释写「2.5s 窗口 × 250ms 采样
  ≈ 10 条在册」，实际 512 条（≈128s）。余量本身是刻意防御（标 intentional），但 50 倍余量意味着
  一个「样本不去重」的 bug 可以在 128 秒内不被裁剪发现，内存上限从「~10 条 × 32B」推到「~16KB/run」。
  建议改注释陈述「触顶即说明去重/折叠逻辑已失效」。
- `validate-agent-prompt-layout.ts:259-300` 启用态口径三样：`system` 空串抛错、`:264-266` `customAttach`
  空串静默当关、`persistEnabled`/`dynamicEnabled` 用 `=== true` 严格取真（wire 传字符串 `"true"` 当关闭）、
  `skillsEnabled` 用 `=== false` 才写域（字符串 `"false"` 当开启）。当前无实际触发路径（上游 zod 兜住），
  标 intentional/无触发，仅备将来有非 zod 调用方。
- `WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT = "【done】"`（`agent-prompt-layout.ts:49`）：与已全链路移除的
  done 桥字面量完全同形，而同模块已有语义正确的 `DEFAULT_WORKPLACE_ASSISTANT_TEXT = "我看到工作区了"`。
  代码注释明确说是刻意保留（intentional），但**建议复议**：兼容的是「哪个 wire 值映射到哪个字符串」，
  不是「必须用这个字符串」。
- `workplaceFileTreeRootLabel` 恒返回 `"/"`（`workplace-scope.ts:30`）导致下游一整片分支成死代码
  （`workplace-file-tree.ts:62-65,130-131,145`）；统一根是拍板设计（intentional）但**死分支未随之清理**。
  连带：`domain/chat/logic/render-dir-attach-tree.ts:31-38` 注释写「根标签走 workplaceFileTreeRootLabel
  口径一致」却另起一份实现 `attachDirTreeRootLabel`——注释里的「一致」只在 `rootDir === "/"` 时成立。
  属 `domain/chat/` 地盘，本簇只提供死分支清理建议。
- `sortFilesForDir` 的 switch 穷尽 `SortField` 但**无 `default`**（`workplace-eval.ts:116`）：
  DB `CHECK (sort_field IN (...))` 是唯一防线（`workplace-schema.ts:26`），越界时回调返回 `undefined`
  → 排序静默失效不报错。**同文件 `sortDirPaths:228` 是有 `default:` 的**，两个姊妹函数不一致。
  （**存疑 Q3 交叉**：DDL 是 `CREATE TABLE IF NOT EXISTS`，若 CHECK 约束是后加的，存量库不会被补上，
  这条就从理论边界变成可触发——需 bootstrap 域核实。）
- `workplace-tree.ts:92` 第二个条件恒等冗余（`normalized === "/"` 时 `prefix` 已被赋 `"/"`），
  另本函数假定 `filePaths` 元素已归一化而 `directChildDirs` 反而做了 normalize，两边不对称。
- `renameRulesUnderLogicalPrefix:303` 的 `substr` 在 `oldPrefix === "/"` 时会吃掉开头斜杠
  （`"/a"` → `"a"` → 拼成 `"/ca"`）。**当前不可达**（先跑 `renameVfsDirectory(vfs, "/", ...)` 会失败），
  属潜在陷阱，建议开头加 `if (oldBase === "/") throw`。
- `DEFAULT_WORKPLACE_DIR_RULE`（TS 侧）与 `workplace-schema.ts:27-28` 的 DDL DEFAULT **两处独立声明**，
  无任何断言或测试锁定一致；后者只在绕过 service 直插 SQL 时发生（e2e fixture/迁移），正是最难复现的一类。
- `CompiledSmartSortRule.regex` 是被缓存复用的共享实例，每次匹配前写 `lastIndex`——
  单线程同步下安全，但这是对共享对象的**可变写**，搬进 worker/并发场景会变成真竞态。
  建议 compile 阶段去掉 `g` 标记。
- `workplace-rule-engine.ts:97` `autoCount` 先初始化为 0 两行后被无条件覆盖，初始值是死代码（纯可读性）。
- `renderFileBlock` 无条件写死 `updatedBy="user"`（`workplace-display.ts:83`），但同一段里
  `createdAt`/`updatedAt` 都取同一个 `mtimeMs`，且文件可能是 agent 自己写的
  （`vfs-tools.ts:263` 的 `upsertFileCacheAfterWrite`）——常驻前缀里 agent 写过的文件也被标成 user。
  `git grep updatedBy` 全仓只有本行与一个 legacy 测试，说明**这条属性没有消费方**，属无依据的事实声明。

**置信**：confirmed（结构/确定性读码）；`formatCharCount` 的 NaN 到达性 suspected。

---

#### M-36 | P3 | 协议层诊断与竞态小面（8 项）

- **idle 相位文案失真**（`llm-stream-timeout-error.ts:38`）：文案写「idle for Xms **after the last chunk**」，
  但按 RULE 流式不设空闲超时，idle 相位实际是整调用预算 600s 耗尽且已有输出。文案会让排障者去找一个
  不存在的语义。
- **`getProtocolAdapter` 的 `fetchFn` 形参被静默忽略**（`registry.ts:21-29`）：`ensureDefaults` 首行
  `if (adapters.size > 0) return;`。唯一用它覆盖的调用方 `apps/cli/src/test/e2e-llm-fetch.ts:14-15`
  靠先调 `clearProtocolAdapters()` 侥幸成立；任何人调整顺序或提前触发一次就会静默走 `globalThis.fetch`。
  另 `:25-28` 与 `:36-39` 三行注册逐字重复。
- **decoder 从不 flush**（`llm-sse-transport.ts:662`）：`decoder.decode(value, {stream:true})` 后
  `done` 时不调 `decoder.decode()`，流末尾被截断的多字节字符会丢。
- **gemini finish 兜底绕过断言**（`gemini-sse-parser.ts:360-372`）：先 `assertSseParseSucceededOrThrow`，
  **之后**才走「blocks 为空 → 从最后一个 raw chunk 重新 `geminiPartsToBlocks`」的兜底，
  兜底产出的 blocks 绕过了断言。
- **首条 assistant 角色不保证**（`anthropic-content-mapper.ts:227`）：`chatMessagesToAnthropic` 不保证
  首条 wire 消息是 `role: "user"`，Anthropic 对首条 assistant 会 400。回滚到 assistant 处的场景理论上
  能构造这种历史（正常路径首条必是 user）。gemini 侧同理，RULE「压缩」保证了压缩后以 user 开头，
  但回滚路径没同等保证。
- **`redactUrl` 只脱敏 `key` 参数**（`debug-fetch.ts:31-41`）：用户自配 baseUrl 里带的其它形态凭据
  （`?token=` / `?access_token=` / path 段里的 key）会原样进 `console.log`，
  而 `isLlmFetchDebugEnabled` 在 RN `__DEV__` 下恒真，每个非流式请求都打。header 侧 `redactHeaders:50-56` 是完整的。
- **`postSse` resolve 后到 `req.signal?.aborted` 之间有 microtask 竞态**（三 adapter）：
  会走 partial 分支（丢弃已 flush 的 tool_use / 降级 usage）而非正常 finish。窗口极窄但存在。
  建议记录 settle 原因（resolve vs abort）据此选分支。
- **`useTextOnlyShortcut` 塌陷多轮历史**（`openai.adapter.ts:44-54,148-153`）：
  命中时把整段多轮历史塌成一条 user 消息，每条前拼 `"user: "`/`"assistant: "`，角色结构彻底丢失。
  生产唯一调用点恒传 system 与 tools 故**实际不可达**，但 CLI `nm model request`（`apps/cli/src/model/commands.ts:79`）
  走的就是这条路。建议明确该 shortcut 定位（仅单轮有效）或对多轮历史禁用。

**置信**：confirmed（除竞态项为 suspected）。

---

#### M-37 | P3 | skills / character-card 域小面（10 项）

- **`decodeLatin1` 多份全尺寸拷贝**（`extract-png-chara.ts:45`）：逐字符字符串拼接 → `atob` → 逐字符
  `charCodeAt` 建 `Uint8Array` → `TextDecoder`。输入闸门是 48MB，但贴闸上限时峰值驻留可达 **400MB 量级**
  （latin1 字符串 + atob binary string + Uint8Array + TextDecoder 字符串）。
  `character-card-limits.ts:4-7` 已把「多份全尺寸拷贝 → 原生 OOM」写成本模块的存在理由，这里是最宽的一环。
  `db-backup.service.ts:70` 已为同类问题做过分块 ascii 写入，本文件没跟上。
  **建议**：分块 `String.fromCharCode.apply(null, chunk)`（每 8K）或 `TextDecoder("latin1")`；
  更根本是给 `extractPngCharaBase64` 单独设一个远低于 48MB 的上限（只做这一件即可同时缓解 M-32 类风险）。
- **CRLF 重建混行尾**（`with-skill-front-matter-values.ts:67`）：匹配用 `\r?\n` 容忍 CRLF，重建固定用 `\n`。
  CRLF 文件走完「编辑信息」或 ZIP 导入回写后，front matter 块变 LF、其余仍是 CRLF，同文件内混合行尾；
  git diff 上该文件整体行尾被改写。建议探测 `source` 的行尾统一三处拼接。
- **`character_book` 回退口径与同文件其余字段不一致**（`parse-character-card-json.ts:99`）：
  `??` 只在 `null`/`undefined` 时回退。若 `data.character_book` 存在但类型不对（脏数据/第三方导出常见），
  `asRecord` 返回 undefined，`readCharacterBookEntries` 直接 `return []`——**不会回退去读根上的
  `character_book`**，世界书被整段静默丢弃，用户看不到任何提示。而同文件的 `readStringField`（:67-81）
  走「逐字段 primary→fallback」。两处必须同口径。
- **空壳角色卡被认可**（`parse-character-card-json.ts:117`）：`assertRecognizableCard` 第一条判定是
  「spec 等于 `chara_card_v2` 就可识别」，不看有没有 `data`。`{"spec":"chara_card_v2"}` 会产出只含
  `角色描述.md`（空正文）的 md 树并成功导入——用户得到一个空目录，全程无警告。
  `{"data":{}}` 同理通过第二条判定。建议加「`data` 是对象」的前置条件，spec 命中但 data 缺失时落
  `UNSUPPORTED_SPEC` 而非静默通过。
- **`allocateUniqueName` 整体 O(n²)**（`character-card-to-md-tree.ts:85`）：每次冲突从 `n = 2` 重新开始扫。
  角色卡条目上限 5000，一条全同名的世界书（模型批量生成很常见）就是 ~1250 万次 `Set.has`，
  低配手机上可感知卡顿。建议维护 `Map<baseName, number>` 游标降到 O(n)。
- **`SkillRef.projectId` 可选**（`skill.schema.ts:29`）：「project 域必带」这条不变量只在注释里。
  service 层用 `vfsForDomain` 在缺 projectId 时抛 `skillMissingProjectId` 兜住运行时，但 `SkillRef` 被双端 UI
  大量构造，漏传时类型检查不拦、运行时跨 IPC 才炸。建议改判别联合。
- **`.` 段导致归一化碰撞**（`validate-md-tree-paths.ts:105`）：`assertMdTreeRelativePathAllowed` 拒绝空段与
  `..` 段但**不拒绝 `.` 段**；`logicalFromZipEntryRelativeToDirectory` 内部走 `normalizePath` 会静默丢弃 `.` 段，
  于是 `世界书/./a.md` 与 `世界书/a.md` 归一化到同一 logical，`files.set` 后者静默覆盖前者。
  连带 `validateMdTreeLimits` 的条目数闸用 `files.size`，**5000 上限可被 `.` 段绕过**。
  对照 ZIP 通道 `validateVfsZipEntries` 对同一情形显式抛 `DUPLICATE_PATH`（`vfs-zip-validate.ts:215-217`）。
  生产生成器（`sanitizeEntryFilename` 把 `/`/`\` 全换 `_`）产不出这种 key，但 `MdTree` 是 `public/vfs.ts`
  导出的公开类型，`validateMdTreeForImport` 的注释也把它当通用校验器。
  建议段循环加 `segment === "."` 拒绝 + `files.set` 前补 `has()` 撞名检查，两条都改。
- **`localeCompare` 无 locale**（`effective-skills.ts:85`，同款在 `skills.service.ts:263`）：
  技能名允许 CJK，排序结果依赖运行时默认 locale；Hermes（裁剪 ICU）与 Electron（完整 ICU）
  对中英混排名的排序可能不同。影响面小（只是展示顺序）但跨端一致性测试会踩。建议改码点序。
- **`readUInt32BE` 后的 `length < 0` 是死分支**（`extract-png-chara.ts:72`）：`>>> 0` 已保证无符号 32 位。
  真正有效的越界防护是前半句。建议删掉并在 `readUInt32BE` 上留一句注释。
- **`.` 段之外的 `sanitizeEntryFilename` 无独立测试**（见 M-39 测试缺口）。

**置信**：confirmed（结构）/ suspected（400MB 峰值是按 UTF-16 存储推算，未实测内存剖面）。

---

#### M-38 | P3 | infra 零件盒其余杂项（7 项）

- **`insertTableRows` 用首行列名决定整批 INSERT 的列集合**（`db-backup/provider-table-snapshot.ts:111-127`）：
  `const columns = Object.keys(rows[0]!)` 之后所有行按这套列取值（`row[column] ?? null`）。
  当 `SELECT *` 结果各行列集合不一致时，多出的键被吞成 NULL——对 NOT NULL 列会抛错（可发现），
  但若该列允许 NULL 就是静默数据丢失。当前唯一构造路径是 `SELECT *`，实测不触发，属「隐式依赖未登记」。
  建议取所有行列并集，或在函数头写死「本实现依赖行内列集合恒一致」。
- **三处注释含 U+FFFD 替换字符**（`sksp/impl/composite-secret-store.ts:17`、`sksp/logic/ref-to-env.ts:8`、
  `sksp/ports/secret-store.port.ts:2`）：逐字节核对为 `ef bf bd 3f`，原文应是 `→`。
  与 mobile-runtime 独立命中的「178 个 U+FFFD 已提交进 HEAD」同族（RULE「PS 管道改写 UTF-8 必毁编码」）。
  修时**勿用 PowerShell 管道写回**。
- **`publish` 同步遍历活 Set**（`events/simple-event-bus.ts:56-62`）：handler 内对同类型 `subscribe`
  会让新 handler 在本轮 publish 内被调用（重入语义未定义）。`unsubscribe` 在遍历中删当前元素是安全的。
  当前消费方 agent-runner 的 handler 未在回调内订阅同类型，无实害。
- **lease 单位换算不可读**（`cloud-sync-coordinator.ts:271`）：`uploadElapsed > this.leaseSeconds * 500`
  ——lease 是秒、`uploadElapsed` 是毫秒，`*500` 恰好是半个租约的毫秒数但看不出这层意思，且 500 是魔数。
  改成具名常量 `HALF_LEASE_MS`。
- **`startupMaintenanceRan` 是模块级布尔、不按连接隔离**（`db-maintenance.service.ts:121,134-142`）：
  desktop 备份导入路径会「关 live 连接 → 覆盖库文件 → 开 restore 连接」，若维护链路恰在这中间被调过一次，
  后续对新连接的维护会被短路。因 app 层有 `dbMaintenanceBusy` 令牌互斥而不易触发，标 intentional，仅补登记。
- **`scrubProviderTablesInDatabase` 把 `alias` 字面量拼进 SQL**（`provider-table-snapshot.ts:66,70`）：
  函数注释已声明「字面量写入 SQL，由调用方控制」，实测两个调用方都传模块常量，**无注入面**。
  intentional，注释补一句「调用方必须传常量而非用户输入」即可。
- **`infra/content-cache` 未从 `packages/core/src/index.ts` 导出**（整目录）：
  所有消费方走深路径 import（5 个接线点实测均为 `@/infra/content-cache/logic/decoded-content-cache.js` 形式），
  与 `db-backup`/`cloud-sync`/`sksp` 经 index 单点转发的做法不一致，RULE 条目的接线面在包外不可见。
  若确定只 core 内部用，在模块头注明；若宿主换库时需清池则加转发。

**置信**：confirmed（全部确定性核对）。

---

#### M-39 | P3 | skills / character-card 核心纯函数的 core 侧测试缺口（backlog 条目）

`w2-core-skills` 18 个源文件里有 **7 个在 `packages/core/test/` 下无对应用例**：
`skill-paths.ts`（RULE:83 点名的路径合成单源！）、`with-skill-front-matter-values.ts`、
`validate-md-tree-paths.ts`、`sanitize-entry-filename.ts`、`character-card-to-md-tree.ts`、
`parse-character-card-json.ts`、`sqlite-skill-disabled-rule.repository.ts`。
`withSkillFrontMatterValues` 仅由 `apps/desktop/test/skill-zip-import.test.tsx:141` 从 UI 侧覆盖，core 侧无测试。

这是 M-21 / M-22 / M-37 多条定为 P2 的加重因素：那几处都是「单源口径分裂」类问题，
恰恰最需要回归测试兜底，而 core 侧没有。**本簇按 backlog 单独立条，不淹没在单点发现里。**

**置信**：confirmed（`rg` 逐符号核对）。

---

## 本簇架构小结

1. **分层方向有四道裂缝**，都指向同一个病根：domain 纯逻辑层在长 IO 依赖。
   `domain/prompt/logic/expand-dynamic-macros.ts:7` 引 `service/workplace` 的 port（唯一一处理想倒置，
   目前无环）；`domain/workplace/logic/load-or-fill-file-cache.ts:23` 引 `domain/character-card` 的体积闸门
   （通用装配层依赖业务域）；`infra/nmtp/ports/tokenizer-driver.port.ts:7` 反向引 `infra/tokenizer` 的实现函数
   （port 引实现）；`domain/provider/model/*` 三处引 `infra/tokenizer/logic/*`（纯模型层被缓存重镇绑住）。
2. **「单源」注释比「单源」实现多**。本簇至少有 7 处文件头/注释声明了单一数据源，而实际存在 2~4 份：
   `SKILLS_ROOT`/`SKILL_ENTRY_FILE`（4 处字面量）、`DEFAULT_WORKPLACE_DIR_RULE`（TS 侧 + DDL DEFAULT）、
   `BUILTIN_PROVIDER_ROWS`（派生 9 份里 6 份死）、`CHARACTER_CARD_MAX_SINGLE_FILE_BYTES`（三处口径不一）、
   front matter 识别（skills 域与 workplace 域两份不等价）、`NEAR_BOTTOM_THRESHOLD_PX`（两端 + mobile 内部疑三份）、
   `startupMaintenancePending` 键（两处字面量 + 一个私有常量，覆盖面还不全）。
   **模式是同一个：抽出单源时没开 public 出口，调用方拿不到就复制。** 修复应优先补出口（M-15）而非逐处改。
3. **协议适配层（infra/llm-protocol）是本簇质量最高的模块**，边界纪律良好（零持久化、零三方依赖、
   不 import 原生包，transport 靠鸭子类型注入）。但它的**错误分类**是薄弱环节：流中失败未定级（M-01）、
   native 路径不认 HTTP 状态码（M-10）、`data:` 形态过窄（M-06）、未知 delta 静默（M-10）、
   abort 契约在两家里破（M-08/M-09）——五处都指向同一个缺口：**这个层没有「错误分类表」这回事**。
4. **tool_use 事件链是全簇最被低估的面**：`EVENT_AGENT_STREAM_TOOL_USE` 今天**零功能消费方**
   （desktop 空 handler、mobile 不订阅），但契约已破（M-08 双 emit）、abort 侧信息已丢（M-09）、
   兼容网关会让并行调用塌陷（M-27）。任何一端接上工具调用卡片渲染就会同时中三枪。
   建议在 roadmap 排「工具调用实时卡片」之前先修这三条。
5. **三处「实测优于静态推断」的实例**（W3 的 data: 五形态、abort listener 打桩、tool_use emit 计数）
   全部把 W2 的 suspected 升级为 confirmed，且都落在同一族。W6 验证 P0/P1 时，
   **优先用同款打桩/探针法而非读码复述**。
6. **本簇无 P0**：没有静默数据损坏、没有跨端不可恢复失败、没有提交进 HEAD 的破坏性内容。
   最高影响是 M-01（用户看到重复正文 + 重复计费）与 M-02（用户建出的技能直接无效），
   两者都是「用户当场可见且当场可复述」的形态，适合放 backlog 前两位。
7. **待主代理裁决的口径问题有三条会影响本簇多条**：流中断重试的产品口径（A/B 方案）、
   skill schema 的 strict/loose、以及 core public 面扩张的边界（双端下沉清单 vs 快照测试成本）。
   前两条各只需一个产品判断，第三条是工程量权衡，建议在 W7 一次性拍完再开工。

---

## 严重度校准记录（本簇改级明细）

| 归并 ID | 原判（源） | 校准后 | 依据 |
|---|---|---|---|
| M-01 | P1（两源） | **P1 不变** | 三源印证 + 实跑；证据密度最高，置信升为 confirmed |
| M-02 | 组 4（源未给级别，C 档） | **P1** | 唯一确定的用户可见功能失败（desktop 新建技能即 invalid），确定性强于一般 C 档漂移 |
| M-05 | P1（单源 + 实测） | **P1 不变** | 护栏被绕过本身值得修，RULE 已把该护栏列为性能前提 |
| M-06 | P1（W3 实跑）/ P2（W2 规范判断） | **P2** | 机制 confirmed、触发前提（真实网关形态）无抓包证据；改动 3 行，P2 已足够优先 |
| M-08 | P2（两源） | **P2** | 契约已破但零功能消费方 → 按「契约破坏 vs 用户可见」口径取无可见面侧 |
| M-09 | P3（W3）/ intentional（W2） | **P2** | thinkingSignature 丢失若成立即为硬失败；外部契约未验证部分已拆为争议 D-3 |
| M-19 | P1（W2） | **P2** | 唯一消费链 `resolveAgentDefinitionFromStorage` 当前无生产调用方（主代理已先降级，本簇复核维持） |
| M-26 | P2（双源 + 实跑） | **P2，转交 apps-mobile** | 文件全在 apps/mobile，归属簇不是本簇 |
| M-31~M-39 | 逐条 P3 | **归簇为 9 条** | 纯死码/小面逐条占台账行会稀释主线；明细全量保留在上表，不丢证据 |

## 争议与存疑（上交主代理 / W6）

- **D-1（处置冲突，需裁决）**：`w3-xc-dup-ends` 组 9/组 10 建议「下沉 core」，但 status.md W1 裁决 2 已确认
  `transcript-selectable-role` 与 `tool-turn-actions` 的 mobile/desktop 两份副本**同死**（零生产 import）。
  若裁决 2 成立，这两组正确处置是**成对删除**而非下沉，M-13 的建议表需改写。请确认。
- **D-2（定级）**：M-06（`data:` 无空格）是否升 P1。升的理由是用户可见形态为「整轮生成秒回空消息且零诊断」；
  不升的理由是没有真实网关抓包。若用户或运营侧有「中转站/自建网关」相关报障记录，建议直接升 P1 提前修。
- **D-3（外部契约待验证）**：M-09 第 1 点——中断落库的 thinking 块无 `thinkingSignature`，
  回喂 Anthropic 是否会被 400 拒绝？本仓无证据可引，需 W6 实跑一轮
  「带 thinking 块 → 中断 → 下一轮回喂」取证。若成立，M-09 应升 P1。
- **D-4（是否有规划中调用方）**：M-16 的 `BUILTIN_UUID_TO_KEY`/`BUILTIN_KEY_TO_UUID` 与
  `createProviderSecretRenameOperation` 看起来是给「运行时 provider id 重写 / 跨库合并撞 id」预留的。
  本簇倾向删（RULE 的迁移退役节奏表明本仓偏好物理删除），但需确认这条线没有在规划中。
- **D-5（产品判断）**：M-22 的 skill schema `.strict()` vs `.loose()`。两个意图各自合理，冲突是组合产生的，
  需产品给「带第三方附加元数据的技能算不算有效技能」的答案。W2 与本簇均不单方面定调。
- **D-6（跨簇归属）**：M-24（db-maintenance 只清 blob 侧 pending 键）同时被 `w2-core-infra-misc` 与
  `w4-msgstore-pro` 独立命中，而后者在 **synth-core-data** 的输入集内。请指定单一归属簇，避免两条各自进台账。
- **D-7（产品口径）**：M-01 的 A/B 方案。W3 已把「网络抖动自动恢复是否曾被当作产品特性宣传过」
  标为未找到文案依据；本仓也未见相关承诺。若从未宣传，A 方案（不重试、让流断就失败）无产品代价。
- **D-8（L0 产物修正）**：M-14 的「真环 7 → 5」是对 L0/circular-alias.md 汇总行的修正。
  本簇遵守只读纪律**未代改 L0 文件**。需主代理裁决是否采纳，并同步在 L0「已知局限」补
  「JSDoc `{@link import(...)}` 会被误判为 import 语句」这条（本次假阳性的直接成因）。

## 跨簇转交

| 本簇条目 | 建议归属 | 理由 |
|---|---|---|
| M-25（push/agent 互斥未接线） | **synth-cloudsync** | agent 侧入口在 apps/；`w4-cloudsync-{pro,adv}` 在该簇输入集内，可一并接线 |
| M-26（webview tsconfig `types:[]` + trimStart） | **synth-apps-mobile** | 文件全在 `apps/mobile/src/web` 与 `apps/mobile/__tests__` |
| M-31（死码与退役簇 14 项） | **synth-dead** | 全部为「确认死 / 确认死但 allowlist 锁定 / 仅测试消费」三类，建议并入删除 backlog 逐批过 W6 |
| M-13 组 11/12/14（双端下沉清单） | **synth-apps-{mobile,desktop}** | 是否下沉是工程量权衡，需两端机位从消费方角度排优先级 |
| M-33 末段（双 tokenizer 驱动对称漂移） | **主代理指定** | 由 `w2-cli-periph` 独立命中，不在本簇输入集内，但修法同源（建议同批下沉 core 统一） |
| M-30 附 Q3（DDL CHECK 是否覆盖存量库） | **synth-core-storage** | 属 bootstrap/migration 纪律问题（`CREATE TABLE IF NOT EXISTS` 不补后加的 CHECK） |

## 一句话交接

本簇 39 条：**P0 0、P1 5**（流中断重试致正文重复+重复计费 / desktop 建技能即无效 /
1970 假时间戳进提示词 / 删模型守卫漏扫会话 pin / 切分器护栏可破），
**P2 25**（协议层错误分类与 tool_use 事件链为主线，其余为单源口径分裂与分层裂缝），
**P3 9**（死码/小面归簇，证据全量保留）；待裁 8 条争议，其中 D-1（双端副本同死 vs 下沉）
与 D-6（跨簇归属）建议优先处理。
