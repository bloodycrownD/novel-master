---
date: 2026-09-27
agile_trace: true
---

# context-usage-real-tokenizer-fallback 实现规格（SPEC）

## 根因 / 方案摘要

**根因**：上下文占用的本地估算走「按模型家族分流」，其中所有降级档都落到 `ceil(字符数 / 3.35)`。该系数来自 SillyTavern 的**英文**口径（cl100k 英文 ~3.5 字符/token），对中文实测低估 **82%~84%**（中文约 **1.64 token/字符** ≈ **0.61 字符/token**）。这个数字被压缩判定拿去卡上下文窗口，低估即「该压不压」。

**方案**：新增 core 纯函数 `countTextWithIncrementalTokenizer(encode, text)`，把所有折算落点换成真分词器计数（默认 cl100k）。

**为什么是「增量计数器」而不是「全量 `encode`」**（本方案唯一的关键取舍，有实测支撑）：

| 场景 | 全量 `encode` | 增量计数器（整段喂入） |
|---|---|---|
| 中文叙事 30K 字符 | 266ms | 240–250ms（收紧尾窗后复测；**持平或略快**） |
| 英文 / 结构化 30K | 6ms / 41ms | 8.5ms / 41ms（打平） |
| **无空白长中文串 8K** | **32.8s** | 264ms |
| **无空白长中文串 12K** | **93s**（O(len²)） | 478–530ms（**快 175~195×**） |

即：增量计数器在正常文本上不比全量差，却把病态输入从分钟级拉回亚秒级——**唯一能同时覆盖两类输入的统一实现**。附带拿到「单次 encode 恒 ≤64 字符」的不变量。准确度实测：中文 +0.24%~+0.34%、英文 +0.33%~+0.56%、结构化 +0.41%~+0.52%。

**缓存下沉**：`new Tiktoken(ranks)` 实测每次 185–248ms 且 js-tiktoken **自身无模块级缓存**（第二次构造仍 185ms+）。原 app 侧 `stream-token-estimator` 自带按编码名单例，驱动侧若再建一份 → 同进程两份表。故把单例缓存**下沉到驱动**（依赖方向只能 app→packages），app 侧改为 import。

## 变更点清单

| # | 位置 | 改动 |
|---|---|---|
| 1 | `packages/core/src/infra/tokenizer/logic/count-text-with-tokenizer.ts`（新） | 新增 `countTextWithIncrementalTokenizer(encode, text)`；空串早退 0；**非空文本读出 0 时按 1:1 兜底**（见下）；经 `infra/tokenizer/index.ts` + `public/provider.ts` 转出，同步 `public-provider-allowlist.json` |
| 2 | `tokenizer-driver-rn/src/impl/encoding-cache.ts`（新）+ `src/encoding.ts` + `package.json` 的 `./encoding` 子路径 | 编码表单例（`js-tiktoken/lite` + cl100k/o200k ranks，惰性构造、失败缓存 `null` 不重试）；独立子路径让 app 的纯逻辑服务复用而不拖入 RN 运行时 |
| 3 | `tokenizer-driver-rn/src/count-prompt-llm-input.ts` | 4 处折算落点收口到 `fallbackCount()`（真计数 → 折算）；**原生不可用时的 `counterKind` 由家族名改为 `heuristic`**；GPT 系的编码表选择逻辑与 Kotlin 侧不动 |
| 4 | `tokenizer-driver-node/src/impl/encoding-cache.ts`（新） | `encoding_for_model` / `get_encoding` 按「model:」/「enc:」双命名空间单例缓存；**缓存后一律不再 `free()`**（精确档与兜底档共享同一张 WASM 表，提前释放会让另一方拿到已释放句柄） |
| 5 | `tokenizer-driver-node/src/count-prompt-llm-input.ts` | 4 处 async 兜底改真计数（counterKind 一律 `heuristic`）；**精确档 `:122` 仍报 `tiktoken`**；整体 catch 的 `new HeuristicTokenCounter()` 换成模块级单例 |
| 6 | `tokenizer-driver-node/src/impl/{web-tokenizer-counter,sentencepiece-token-counter}.ts` | async `countSerializedPrompt` 的加载失败兜底改真计数；**同步 `countText/countMessages` 保持折算**（port 是同步契约） |
| 7 | `apps/mobile/src/services/stream-token-estimator.ts` | 删掉私有 `encodingByCacheKey`/`getOrCreateEncoding`，改 import 驱动的 `getRnEncoding`（同进程只剩一份表） |
| 8 | `apps/mobile/src/services/chat-prompt-tokens.service.ts` | 「无模型早退」与「build 失败兜底」两处改真计数（`counterKind: heuristic` / `estimated: true` / UI 文案不变） |
| 9 | `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | 同上两处改真计数；异常兜底用 `TokenCounter` 适配器把 registry 的 `heuristic` 换成真实现（不改 core 的同步计数路径） |
| 10 | `apps/cli/src/prompt/commands.ts` | `prompt render --tokens` 的无模型分支同口径（输出契约不变） |
| 11 | `packages/core/package.json` + `package-lock.json` | 补 `js-tiktoken` devDependency（core 的基准用例要真编解码器；lock 仅 +1 行） |

## 详细改动说明

### 1. `countTextWithIncrementalTokenizer` 的额外收口（本次发现的真缺陷）

计数器「尾窗读值失败」分支的语义是**保持上一次成功读值**——流式用法下那≈累计值，合理。但**一次性调用**时「上一次」是 **0**，于是「整段都不可编码」会**安静返回 0**，把调用方（压缩阈值 / 占用标签）骗成「上下文是空的」。故 helper 在非空文本读出 0 时按「1 字符 ≈ 1 token」兜底（与计数器固化路径失败时的处理同一条），并把理由写进 JSDoc 与单测。

⚠️ **口径订正（见 CR fix-spec v3 `agile-1`）**：这条「读出 0 → 按字符数兜底」的收口**会把此前已成功固化的计数整段丢掉**（尾窗整段不可编码时 `tokens` 返回 0，而固化部分已经进 `committedTokens`）。实测 6,024 字符中文提示词、尾部 24 字符窗口恰好是 `<|endoftext|>` + 11 个无边界 CJK 时：真值 9,421、helper 返回 6,024（**低估 36%**）。修法是**构造计数器时收紧尾窗**（`tailChars: 0` / `commitStepChars: 1`），让全文逐段走固化路径（失败段 1:1 计入、不丢段），读值路径实际不再可能失败；那条字符数兜底**保留**作最后一道保险。另需注意：**「1 字符 ≈ 1 token」对中文不是上界**（cl100k 中文约 **1.64 token/字符** ≈ **0.61 字符/token**，1:1 只有真值的 0.61×）——它保证的是「不丢段、读数不倒退」，方向偏保守，但**不是上界**，代码与文档都不得再称其为「上界 / 宁可高估」。

### 2. 诚实化：`counterKind` 不再冒充家族

`token-ratio.trigger` 只在 `counterKind === "heuristic"` 时把阈值乘 0.85。原生分词器不可用时旧代码返回家族名（`claude`/`glm`…）却实际跑折算 → **用低估八成的值卡精确阈值、且无安全垫**，是最容易冲破上下文窗口的组合。现统一报 `heuristic`。

### 3. 两级降级顺序（两端一致）

真分词器（家族精确档）→ 真分词器（cl100k 近似档，仍标 `heuristic`）→ 字符折算（仅在编码表**建不起来**时，且失败被缓存、本进程不重试）。**任何一级的 `counterKind` 都不冒充精确**。

## 测试策略

### 测试用例

见 PRD「测试用例」表的四组，**条数以该表为准**。其中两条带**反向验证**：

- mobile「编码表建不起来才降级且不重试」：注入抛错构造器后断言 `attempts === 1`；
- desktop T-T9c：把 `countFallbackTokens` 临时改回折算 → 该用例报「早退读数 182 相对精确档 670 偏低」而红，恢复即绿。

### 验证账目（2026-09-27，`0d79f559..HEAD`）

core 全量 `2173 / 2 红`（既有时区归桶）、mobile 全量 `1505 / 1~2 红`（`T-MF3` 产物断言 + 空套件为基线；另两处时间类断言为并行负载抖动，单独跑与整文件跑均绿）、desktop `527/527`、Node 驱动 `13/13`、三端 typecheck 零输出、desktop renderer tsc 全仓 349 条既有债（改动文件新增 0）、三包构建通过。**本轮零真回归。**

### 已知基线红（非本轮引入，已双树验证）

`apps/cli/test/prompt-tokens-e2e.test.ts` **5/5 红**：失败点在 `session create`（`workspace 未配置 Agent，且 registry 为空`），主仓旧树（`34d8939e`，不含本轮任何改动）跑同一文件同样 5/5 红 → 长期基线。`apps/desktop` 的 `npm test` 在 Windows cmd 下收集 0 条测试（`run-tests.mjs` 单引号 glob）也是既有平台缺陷，跑全量须用等价的双引号参数。

## 风险与回滚方案

- **风险 R1（最高）：Hermes 真机未测**。Node 上单步计数中位 0.8ms / 峰值 7.4ms（病态串）、建表 185–248ms；若真机是 3~5×，病态档单步会到 15~37ms 并逼近一帧预算，建表会到 0.6~1s。**缓解**：② 已做「会话切换时空闲预热」（`primeStreamTokenModelHint` 热 cl100k 兜底表 + 解析出的那张），本次把编码表单例下沉后预热与计数**共用同一张表**；**desktop 侧另做「启动后空闲预热」cl100k**（`setTimeout` + try/catch 静默，不阻塞启动）——注意 `model:<tiktokenModel>` 与 `enc:cl100k_base` 是**两个互不命中的缓存命名空间**，所以两条预热都要有，缺一不可；即便如此，**首次兜底若仍发生在预热之前，desktop 主进程仍有一次约 250ms 的同步建表成本**（同步阻塞事件循环、IPC 排队），这是已知残留、不是 bug。仍需 1310 真机实测（见 PRD「真机复验」）。
- **风险 R1 的 mobile 侧对称口径（见 CR fix-spec v3 `agile-3` 改法 #6）**：**mobile 侧同理——预热挂在会话切换上，冷启动到首次会话切换之间的读数仍可能白付一次建表**（RN 侧 `primeStreamTokenModelHint` 覆盖的是切换之后）；具体说，mobile 的 UI 读口（`apps/mobile/src/services/chat-prompt-tokens.service.ts` 的兜底计数）那段窗口里**没人预热过**，它可能抢在空闲预热之前同步调用真计数、从而承担一次建表成本，`apps/mobile/src/services/chat-prompt-tokens.service.ts:100` 那句「不会再白付一次构造」按**未验证前提**对待。本轮**只登记、不改实现**（**不加冷启动预热、不重构预热时机**——真机倍率未出前无法判断收益），1310 真机复验时一并观察。
- **风险 R2：家族近似**。cl100k 对 Claude/GLM/Qwen 只是近似（对中文词表更大的家族偏高、对 Llama 系偏低）。**处置**：一律保持 `counterKind: heuristic` + 0.85 安全系数，绝不宣称精确。
- **风险 R3：压缩触发点前移**。诚实化让原生不可用场景首次吃 0.85，且读数从低估变准——两者都会让压缩**更早**触发。这是有意的方向修正，但真机复验时应观察「是否突然多压一次」。
- **回滚**：改动集中在各落点的 `fallbackCount()` 一层与 core 的新 helper；回滚 = 让 `fallbackCount` 直接返回折算（或 revert 两笔提交 `f0186106` / `4e179e1a`）。core helper 独立、无副作用，可单独保留。
- **未覆盖（登记）**：RN 驱动包自身无测试套件（其 `encoding-cache` 由 `apps/mobile/__tests__/mobile-prompt-token-counter.test.ts` 经驱动间接覆盖）；desktop renderer 流式指标条「未注入估算器」的折算兜底未动（属另一条链）。
