---
date: 2026-09-28
---

# message-token-cache 技术规格（SPEC）

## 设计目标

上下文占用本地计数引入两层缓存：L1 会话级整串缓存（挡无变更重复刷新）+ L2 **固定切分块平面缓存**（句末符号优先的确定性切分，内容寻址、代际清理、KKV 持久化），消灭无变更重复计算与压缩/置位/回滚/编辑后的全量重算；desktop 精确档 encode 接分块保护；双端 chip 刷新加防抖与在途合并。依赖 `fallback-caliber-align` 先行。需求来源：`docs/Iterations/context-usage-overhaul/features/message-token-cache/prd.md`。

**方案依据（真实库实测，2026-09-28，用户备份库 5350 消息 / 23 会话）**：切分健康度 P50 块长 24~50 字符、64 兜底触发率 0.3%~8.9%；分块计数 vs 整串 encode 误差 **-0.02% ~ +0.35%**（4 会话有基准样本，验收线 1%）；编辑局部性——改 5 字符仅 **2 块 miss**（含 194KB 巨型消息场景，重算量 0.02%）；全库 142,789 块中唯一块 93,294（**34.7% 重复**，平面缓存跨内容共享红利实测存在）；实测捕获 10,697 字符无空白串（64 兜底必要性实证）；hidden 消息占 63.9%（压缩/置位高频，代际保留依据）。验证脚本原型：`tmp/token-cache-probe/verify-chunks.mjs`（实现时收编为 core 模块与 golden 生成器）。

## 总体方案

**切分器**：core 新增 `infra/tokenizer/logic/chunk-splitter.ts`——纯函数 `splitTextIntoChunks(text: string): string[]`，规则（确定性，无内部状态）：①遇句末符号（`。！？!?；;…\n\r>」』`）收尾并贪吃连续句末符号成块；②块长达到 64 字符上限时回退到块内最近的软边界（`，、,.:：）)】]}"'“”‘’ \t—·%/\|` 等标点与空白，含入块尾）；③无软边界则硬切。同文本任何时刻切出相同块序列（缓存正确性前提）。病态长无空白串被 ③ 兜住（每块 ≤64 字符，计算层防 O(len²)）。

**L2 块平面缓存**：core 新增 `infra/tokenizer/logic/token-chunk-cache.ts`——进程内单例平面 Map（跨会话共享），条目 `块hash:计数器身份 → 块 token 数`：
- 块 hash：`hashContent(块文本)`（sha256，noble 实现，返回完整 64-hex）**取前 16 hex** 作缓存键段（spec 侧新增截断逻辑，非 hashContent 自带）；
- 计数器身份：`vendorModelId + tokenizerOverride + tokenizerFamily + driverName` 归一串（同文本不同词表计数不同，换模型/换端自动 miss）；
- **代际**：3 代环形。每完成一次整 prompt 计数（代 = 一次成功的本地计数周期）推进：当前代 → 第 2 代 → 第 3 代淘汰；命中任意一代即算命中并提升至当前代。总量上限 100K 条（超限先淘汰最旧代）；
- miss 块经 `countTextWithIncrementalTokenizer`（内部 ≤64 字符分块）现算。**注记**：≤64 字符的块进入该函数后内部仍可能在尾窗按自然边界二切甚至多切再求和——确定性、不丢字符、误差近零，行为无害；但**测试不得断言「单块 = 恰好 1 次 encode」**（会翻车），计数断言一律用「缓存全命中时 baseEncode 调用 0 次」这类口径。

**持久化（转正）**：每次「代际推进」且该次计数源于真实刷新（非预热）时，把当前代整表序列化写 session KKV（域 `token_chunks`、键 `chunkCache`，值 = 紧凑 JSON：`{v: 1, items: [hash16, count, ...]}` 数组或 map）。读取：本地计数开始时若热层对该会话无种子，则读 KKV 载入为一代（作为第 2 代种子，不顶当前代）；坏行 / `v` 不符 → 静默忽略按 miss（模式抄 `session-api-prompt-token-store` 的 parse 防御）。会话删除随 session KKV 级联清理，无独立 GC。写盘频率受防抖约束（run 收尾/防抖后至多一次）。

**计数流程**（替换原「段级」设计——句子块平面寻址不需要段结构，`serializePromptSegments` 导出砍掉）：
1. 查 L1（`hashContent(整串+tools串) + 身份` → `{tokenCount, counterKind, estimated}`）→ 命中直接返回；
2. `serializePromptLlmInput` 产整串（既有函数不动，CLI parity 契约保持）；
3. `splitTextIntoChunks(整串)` → 逐块查 L2（三代 + 持久化种子）→ miss 现算写入 → 求和（连接符已被句末贪吃自然并入块内，无需额外补偿——实测误差已含此效应）；
4. 写 L1、推进代际、按上述条件写持久层。

native WEB/SP 档（node @agnai / Android 原生桥）不分块，仅走 L1。

**L1 持久化形态（CR 收窄注记，2026-09-29 用户拍板「按现状收窄」）**：上文「L1 Map（sessionId+身份 → 结果）」为 spec 撰写期的初始设计；实际落地形态为——L1 键 = 内容指纹（hashContent 前 16 hex，含 tools 串）× 计数器身份，**驱动层查/写传空 sessionId（"" 桶）实现跨会话共享**；进程内持久层之外，性能修复链追加 **L1 KKV 持久化**（token_chunks 域 `promptWholeCache` 键、每会话 ≤16 条环形、只收 `estimated:false` 精确档读数），重启经 seedFromKkv 续命。pendingWrites 为全局收集、归入最近 persist 的会话行——条目内容寻址、会话删除级联只丢加速不丢正确性。该形态为既定口径（跨会话共享是性能红利），不再按「sessionId 入键」收口。

**分块接入（node 精确档）**：`count-openai-style-message.ts`（fa feature 下沉版）encode 函数包 `countTextWithIncrementalTokenizer`，per-message overhead 公式不动。**本变更是该模块分块包装的唯一落点（spec-check 第 1 轮 P1-5 定稿：fa 下沉时保持原样，rn 调用侧不另包——避免双重包装，fa T-FA2 的逐字节基准在本 feature 合入后迁移至 T-TC5 的 ≤1% 容差口径）。**

**防抖**：desktop `loadChatPromptTokenStats` 入口按 sessionId 300ms trailing debounce + 同参在途 Promise 合并；mobile `refreshChatTokenLabel` 同款（复用 inflight 槽模式）；mobile 回滚 1500ms 错峰保留。

## 最终项目结构

```
packages/core/src/infra/tokenizer/logic/
  ├─ chunk-splitter.ts        [新增] 纯函数切分器（句末贪吃→软边界→64 上限）
  ├─ token-chunk-cache.ts     [新增] L2 平面缓存（3 代环形 + 100K 上限 + KKV 持久化读写）
  ├─ prompt-whole-cache.ts    [新增] L1 整串缓存（会话级，进程内 Map）
  └─ count-openai-style-message.ts  [改] encode 包分块（fa 下沉版上叠加）
packages/tokenizer-driver-node/src/count-prompt-llm-input.ts  [改] L1/L2 挂接 + 精确档分块
packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts    [改] L1 挂接；JS 档 L2；native 档仅 L1
packages/core/src/domain/session-kkv/model/session-kkv-domains.ts  [改] 新域 token_chunks
apps/desktop/src/main/services/chat-prompt-tokens.service.ts  [改] 读口防抖+在途合并
apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts      [改] refreshChatTokenLabel 防抖
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `chunk-splitter.ts` | 新增；导出 `splitTextIntoChunks` 与边界字符常量（句末集/软边界集，可测试覆盖扩展） |
| `token-chunk-cache.ts` | 新增：`lookup(chunkHash, scope)` / `record(...)` / `advanceGeneration(sessionId, persistOptions?)` / `seedFromKkv(sessionId)` / `clearForTests()` / `stats()`；三代环形 + 100K 上限；KKV 读写（写：代际推进且真实刷新；读：计数前种子） |
| `prompt-whole-cache.ts` | 新增：L1 Map（sessionId+身份 → 结果），LRU 会话级 32 条 |
| `session-kkv-domains.ts` | 新增 `token_chunks` 域（开放 union，未知键忽略语义同 prompt_tokens） |
| `count-openai-style-message.ts` | encode 包 `countTextWithIncrementalTokenizer` |
| node / rn 驱动 `count-prompt-llm-input.ts` | 计数入口挂 L1→L2 流程（native 档 L1 only）；node 精确档文本走分块包装 |
| 双端读口 | 防抖 + 在途合并（mobile 复用 `refreshChatMetaInflightRef` 模式） |
| 测试 | core `test/infra/tokenizer/{chunk-splitter,token-chunk-cache,prompt-whole-cache}.test.ts`（新）；驱动与双端 service 测试扩展 |

## 详细实现步骤

- Step 1 — phase-cache-splitter — blocking: yes — qa: auto：切分器纯函数 + golden 测试（真实语料快照锁定：连续句末贪吃、软边界回退、64 硬切、同输入两次调用逐字节一致）（T-TC1）。
- Step 2 — phase-cache-core — blocking: yes — qa: auto：L2 平面缓存（三代/上限/身份隔离）+ L1 + KKV 持久化读写与种子载入 + 单测（T-TC2/T-TC3/T-TC4）。
- Step 3 — phase-cache-drivers — blocking: yes — qa: auto：双驱动挂接（node 精确档分块包装；rn JS 档 L2、native 档 L1）+ 驱动测试（含 encode 调用计数断言）（T-TC5）。
- Step 4 — phase-cache-debounce — blocking: yes — qa: auto：双端读口防抖 + 在途合并 + 测试（T-TC6）。
- Step 5 — phase-cache-verify — blocking: yes — qa: auto：验收矩阵回归（`test/infra/tokenizer/` 既有 13 个 .test.ts + 1 个 helper + token-ratio 触发器 + 双端 service）；误差护栏用真实语料夹具（≤1%，基准 0.35%）。

## 测试策略

### 测试用例

- T-TC1 — blocking: yes — 切分器：golden 快照（中文正文/代码块/JSON/URL 含点/省略号/连续换行/10K 无空白串）；确定性（同文本双调用一致）；所有块 ≤64 字符不变量。
- T-TC2 — blocking: yes — L2 行为：append 一条消息仅新块 miss；**编辑少量字符仅变化邻域 miss（实测模式 2 块）**；压缩（移除前缀消息）后剩余块 100% 命中；换计数器身份全 miss；三代内回滚（隔一代回旧集合）命中；第四代淘汰。
- T-TC3 — blocking: yes — 持久化：代际推进写 KKV；清热层后种子载入命中；坏 JSON / 版本号不符 → 静默 miss 不抛错；会话删除后 KKV 域清理。
- T-TC4 — blocking: yes — 误差护栏：真实语料夹具（取验证轮样本）分块加和 vs 整串 encode ≤1%；12K 无空白串 ≤1s；30K 中文既有门限不回退。
- T-TC5 — blocking: yes — 驱动：缓存全命中时 baseEncode 调用 0 次；node 精确档数值与整串 precise 档对拍（容差 1%）；native 档（mock 桥）两次调用第二次桥调用 0 次（L1）。
- T-TC6 — blocking: yes — 防抖：rapid 双触发合并一次；并发 5 触发 1 次计算；mobile 回滚错峰不回归。
- T-TC7 — blocking: yes — 回归：`test/infra/tokenizer/` 全量 + `agent-runner-token-cache.test.ts` + `token-ratio-trigger.test.ts` + 双端 `chat-prompt-tokens.test.ts` 全绿。

## 风险与回滚方案

- **切分规则演进**：规则变更 → 块序列变 → 全量 miss 自然重算（无需迁移）；持久层旧条目失活后被代际覆盖写清掉。golden 快照锁版本行为。
- **误差超线**（>1%，实测最差 0.35%，余量充足）：回退开关 `CHUNK_CACHE_ENABLED=false` 退回「整串一次 encode（分块包装）+ L1」。
- **内存**：100K 条 × (16 hex 键 + number) ≈ 10MB 上限，移动端可接受（Hermes 堆）；上限可配。
- **KKV 写放大**：每次代际推进整表覆盖写（几十 KB/会话），受防抖与「真实刷新」条件约束；若实测写频过高再加最小间隔节流。
- **回滚**：加法式改动，单 commit revert 即回到「全量 encode（fa 的分块与表源收敛仍在）」。
