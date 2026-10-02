---
zone: xc-encoding
agent: cross-cutting (encoding-corruption)
files_scanned: 3581
files_list: 输入 10 文件 + 全仓 git ls-files 严格 UTF-8 复扫（3040 个非 ASCII tracked 文件）+ 引入提交 `git log -p --follow` 逐版字节级 census（14 个文件的全部历史版本，共 ~120 个 blob）
measured_at_head: 9ca5f5ad（`git log --oneline -1`；工作区对 10 文件均干净，`git status` 仅 `package-lock.json` M + `docs/Iterations/repo-mega-cr-2026-10/` ??，即**损坏已全部入库**，非未提交脏文件）
---

# W3 · xc-encoding —— U+FFFD / 编码损坏横切

## 摘要

全仓因 Windows 侧非 UTF-8 转码产生的字符损坏面。10 个受检文件里 **每一个的引入提交的父版本都是干净的**，因此全部可从 git 精确回滚或重写；**损坏 100% 落在注释 / `it()` 测试名 / markdown 标题上，无任何运行时代码或断言被改**——这是本主题最关键的一条结论，它把优先级钉在 P2 而不是 P1。真正的隐患不是这 261 个字符，而是**两条同源机制同时无闸**：① 损坏会静默累积（`session-prompt-input.service.ts` 两次提交各伤一轮）；② 有一类损坏是"合法但错字"（`（`→`；`、`：`→`）`），**只查 U+FFFD 的闸会漏掉它**。

## 职责与边界

本区不是业务域，是**横切的数据完整性面**：仓库内所有以 UTF-8 存储、但被 Windows GBK 路径（PowerShell `Set-Content`、GBK 编辑器、GBK 编码的 `build.gradle`）写坏的文件。判定标准统一为两条二元信号：

- `literal-fffd`：文件字节流里真的存在 `EF BF BD`（U+FFFD 三字节序列）。
- `invalid-utf8`：文件**不是合法 UTF-8**（严格解码失败）。这一条覆盖面更大，且是本次多数文件的唯一信号。

**关键口径修正**：任务书给的"U+FFFD 计数"会误导。10 文件里只有 **3 个**真有字面 U+FFFD（`agent-runner.test.ts` 64 / `openai-content-mapper.test.ts` 4 / `vfs.ts` 2 / `tool-definitions.ts` 1 / `composite-secret-store.ts` 1，共 5 个），其余 5 个（`session-prompt-input.service.ts` 178 / `message-body-text.test.ts` 3 / `prd.md` 2 / `secret-store.port.ts` 1 / `ref-to-env.ts` 1）**字面 U+FFFD 计数为 0**，它们是"非法 UTF-8 字节"或"ASCII `?` 顶替"。按字面 U+FFFD 写的闸会漏掉一半。

## 对外接口

无导出符号。本区产出是**修复清单**与**防再犯闸门方案**（第 3、6 节），不涉及 API 变更。

## 数据访问

不触碰表 / KKV 域 / 文件路径。以下是逐文件损坏点定位（file:line 均为**当前 HEAD 工作区实测行号**）。

| # | 文件 | 损坏行（当前行号） | 信号 | 引入提交 | 父版本 | 父版是否干净 |
|---|---|---|---|---|---|---|
| 1 | `apps/mobile/src/services/session-prompt-input.service.ts` | 28,29,30,31,33,34,35,36,46,56,57,58,63,71,80,81,91,92,93,94,110,111,112,113,114,146（26 行） | invalid-utf8 + ASCII `?` | **acb4379e**，再由 **d3b1049a** 加剧 | c9f1e4e9 | ✅ 干净（0 坏行） |
| 2 | `packages/core/test/agent/agent-runner.test.ts` | 294,351,417,460,520,789,1133,1474（8 行 / 64 FFFD） | literal-fffd | **eff17cc6**（0→5）、abc7b038（→4）、**487b86b1**（→100） | 1ef67294 | ✅ 干净（0 坏行） |
| 3 | `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts` | 13,56,82,146（4） | literal-fffd | **12ecd6d1** | d8974c43 | ✅ 干净 |
| 4 | `packages/core/test/chat/message-body-text.test.ts` | 22,44,53（3） | invalid-utf8 | **175ac8fb** | d054a523 | ✅ 干净 |
| 5 | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 2,81（2） | literal-fffd | **eff17cc6** | 25cae6de | ✅ 干净（L2）；L81 为该提交**新增** |
| 6 | `docs/Iterations/mobile-chat-composer-annotate-ux/prd.md` | 12（标题行） | invalid-utf8 + ASCII `?` | **e326bb41** | 58f7f632 | ✅ 干净 |
| 7 | `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts` | 2 | literal-fffd | **175ac8fb** | f30a2427 | ✅ 干净 |
| 8 | `packages/core/src/infra/sksp/ports/secret-store.port.ts` | 2 | invalid-utf8 | **943709ee** | `943709ee^` | ✅ 干净 |
| 9 | `packages/core/src/infra/sksp/logic/ref-to-env.ts` | 8 | invalid-utf8 | **943709ee** | `943709ee^` | ✅ 干净 |
| 10 | `packages/core/src/infra/sksp/impl/composite-secret-store.ts` | 17 | literal-fffd | **943709ee** | `943709ee^` | ✅ 干净（后续 c3da98d6 改动未修好） |

**10/10 的父版本都干净** —— 这是整份清单能"落纸即修"的前提，也让 `git show <引入>^:<path>` 成为可信的回滚源（`--follow` 对 #6~#10 的重命名链要手追：`.apm/kb/docs/…` → `docs/…`、`packages/sksp/src/…` → `packages/core/src/infra/sksp/…` → `…/sksp/{ports,logic,impl}/…`）。

## 依赖关系

- 上游成因（已入 RULE，**不是本区新问题**）：`docs/apm/RULE.md:111`「PowerShell 管道改写 UTF-8 文本文件必须显式编码（2026-09-28 为难）」——`Get-Content -Raw | … | Set-Content` 对无 BOM UTF-8 会按系统 ANSI(GBK) 写回，中文全变乱码。`docs/apm/RULE.md:105` 记了 `build.gradle` 是 GBK 编码、修改必须走字节级替换。
- 下游消费者：本迭代 `raw/w2-mobile-runtime.md:149-150` 引用了 #1 的损坏原文（4 处），**CR 报告把损坏文本又抄了一遍**，将来修完源码需同步修报告，否则闸门/复扫会持续命中它。该文件当前 untracked（`docs/Iterations/repo-mega-cr-2026-10/` 为 `??`），不在 `git ls-files` 闸门范围内。

## 发现清单

### F-xc-encoding-1 | P2 | `apps/mobile/src/services/session-prompt-input.service.ts:110-114` | 引入 acb4379e / 加重 d3b1049a | confirmed
5 行**整段是原始 CP936(GBK) 字节**（`a1 fa`=、 `a3 ac`=（ `d3 eb`=） `cd ac`=行 `b6 ce c4 da`=谁内 …），混在 UTF-8 文件里，编辑器/工具按 UTF-8 读即整段乱码。

```
L110: 20 20 2f 2f 20 61 73 73 65 6d 62 6c 65 20 a1 fa 20 70 72 65 70 61 72 65 …
```
按 CP936 重解码得到完整原文（**未丢字节，可 100% 还原**）：
```
// assemble → prepare(S0)，与 agent-runner 同源。workplace 段内部按文件粒度
// 挂分段弃权判据（2026-09-30「16s 原子组装段」治本）：run 起步后本刷新在
// 第一个文件边界就死，不再把整段组装跑完才弃权；中止错误就地转抛 build 的
// 统一哨兵类，读口 catch 的判定不变。fingerprint 透传给 ctx——token 估算
// 读数的记忆缓存靠它免掉重复序列化/计数。
```
**处置：可整体还原（唯一一处纯机械恢复的编码损坏）。** 注意这 5 行是 d3b1049a 新增的长注释；被它替换掉的 acb4379e 短版 L110（`// assemble → prepare(S0)，与 agent-runner 同源。`）也丢了 2 字符，但已无回滚价值。

### F-xc-encoding-2 | P2 | `apps/mobile/src/services/session-prompt-input.service.ts:28-36,46,71` | 引入 acb4379e | confirmed
acb4379e **新增**的 `ChatPromptBuildBailedError` 文档块（10 行）、`shouldBail` JSDoc、分段计时注释。父版本 c9f1e4e9 里**没有这些行**，git 内无干净副本 → **需重写**。丢失形态是"3 字节字符的末字节被顶成 ASCII `?`"：
```
L28 … e6 96 b0(e新→新) e5 8c 3f          ← 末字节 0x8X → 0x3F
L31 … 73 65 3f 2a 62 75 69 6c 64         ← "…+ build 分段" 处 0x84 → 0x3F
```
语义可从姊妹文件 `apps/mobile/__tests__/chat-prompt-tokens.test.ts:451-454`（**同段叙述的干净版**）反推，重写成本低。

### F-xc-encoding-3 | P2 | `apps/mobile/src/services/session-prompt-input.service.ts:56-58,63,80-81,91-94,146` | 引入 acb4379e | confirmed
11 行在父版本 c9f1e4e9 有**干净对应行**（父 L33-35 / L40 / L46-47 / L51-54 / L86）→ **可整体还原注释**。同时暴露两种额外损坏形态：
- `：`(U+FF1A) → `）`(U+FF09)、`（`(U+FF08) → `；`(U+FF1B)：**合法但错误的字符替换，UTF-8 完全合法，U+FFFD 闸查不到**（证据：父 L33 尾部 `ef bc 9a`「：」在子版变成 `ef bc 89`「）」）。
- 替换会**翻倍**：父 L46 的 `20 3f 3f 20`（`??`）在子版变成 `20 3f 3f 3f 3f`（`????`），说明转码被**至少跑了两次**。

**处置：整体还原（`git show c9f1e4e9:<path>` 取父版原行），不要手工修**——手工修会漏掉 F-xc-encoding-4 那类"合法错字"。

### F-xc-encoding-4 | P2 | 全域（机制层） | 置信 suspected
损坏是**有损非 UTF-8 转码**，且至少两个口味：
- 口味 A：字符被顶成 ASCII `?`（丢字节）→ 常留下非法 UTF-8。
- 口味 B：字符被换成**另一个合法字符**（`（`→`；`、`：`→`）`）→ 文件仍是合法 UTF-8。
- 口味 C：整段保留原始 CP936 字节（F-xc-encoding-1）。
口味 B 的规律在 GBK 字节层看得最清楚：`（`=A3A8→`；`=A3BB、`：`=A3BA→`）`=A3A9，两个 trail 字节都 **XOR 0x13**；但同一规律推不出 `→`/CJK 的丢失，**故机制未定案，标 suspected**。实务含义：**任何只按 U+FFFD 计数设计的清理/闸门都不完整**。

### F-xc-encoding-5 | P2 | `packages/core/test/agent/agent-runner.test.ts:294,351,417,460,520,789,1133,1474` | 引入 eff17cc6 / abc7b038 / 487b86b1 | confirmed
全部 64 个字面 U+FFFD 集中在这 8 行（7+13+8+11+12+2+9+2），形态是 **UTF-8 字节被当 CP936 解读**后的残留：
```
L417 HEX: … 61 62 6f 72 74 20 ef bf bd ef bf bd ef bf bd de b5 da b6 ef bf bd …
                  abort␣ FFFD FFFD FFFD <GBK残留> FFFD …
L520 HEX: … ef bf bd×9 3f 3f 73 74 72 65 61 6d 20 …   ← "??" 两次顶替
L1133 HEX: 2f 2a 2a 20 ef bf bd d3 bb e1 bb b0 ef bf bd …
```
这 8 行都是 `it("T-ARP-C1…C4" / T-ITA-03 / tool_results…)` 的**用例标题**和 1 条 JSDoc，**全部是 abc7b038 之后新写的、父版本没有对应行**（按 ASCII 骨架在 `1ef67294` 全文搜索，命中 `NONE`）。
**处置：需重写。** 语义可从用例编号 + 同文件内未损坏的 `assert` 体反推（例：L460 `T-ARP-C4: abort <FFFD> tool <FFFD> append <FFFD> tool_results`，断言在 L520 之后）。**注意：仅标题坏，断言与被测逻辑完好，测试行为不受影响。**

### F-xc-encoding-6 | P2 | `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts:13,56,82,146` | 引入 12ecd6d1 | confirmed
4 处，全是 `→`(U+2192) 丢失，**父版本 d8974c43 逐行干净**，原值确定：
```
L13: "O1: text + tool_use → assistant message with tool_calls"
L56: "O2: OpenAI tool_calls response → tool_use blocks"
L82: "O3: tool_result → role tool messages with tool_call_id"
L146:"O6: image url block → vision image_url part"
```
**处置：整体还原（4 字符，`→`），零歧义。**

### F-xc-encoding-7 | P2 | `packages/core/test/chat/message-body-text.test.ts:22,44,53` | 引入 175ac8fb | confirmed
3 处 `→` 丢失，父版本 d054a523 干净：`"text only → hello"` / `"thinking only → empty"` / `"image → [image]"`。
**处置：整体还原（3 字符）。**

### F-xc-encoding-8 | P2 | `apps/desktop/src/main/ipc/handlers/vfs.ts:2,81` | 引入 eff17cc6 | confirmed
- L2 = `—`(U+2014) 丢失，父版本 25cae6de 干净，原值 ` * VFS IPC handlers — list/read/write/mkdir/delete/rename for global/project/session scopes.` → **可整体还原**。
- L81 = eff17cc6 **新增**的 `/** VFS 变更成功后通知 renderer 刷新 Explorer（消费方 ①）<?>*/`，1 字符丢失、无父版 → **需重写**（按上下文推断为 `。`，置信 suspected，需人确认）。
**处置：L2 整体还原 + L81 需重写（1 字符）。**

### F-xc-encoding-9 | P2 | `docs/Iterations/mobile-chat-composer-annotate-ux/prd.md:12` | 引入 e326bb41 | confirmed
**不是有意改标题，是损坏**——逐码位可证。父版本 58f7f632 的 L12 是 `# Mobile 聊天 Composer · 批注 · 消息操作 UX 修复 PRD`；子版把 `聊天`(2字) `批注`(2) `消息操作`(4) `修复`(2) 顶成 10 个 ASCII `?`，把 `·`(U+00B7) 顶成 2 个 FFFD：
```
[9]U+003F [10]U+003F   ← 聊天
[21]U+FFFD            ← ·
[23]U+003F [24]U+003F ← 批注
[26]U+FFFD            ← ·
[28..31]U+003F×4      ← 消息操作
[36]U+003F [37]U+003F ← 修复
```
**处置：整体还原标题行（取 `git show 58f7f632:.apm/kb/docs/Iterations/mobile-chat-composer-annotate-ux/prd.md` 的 L12）。** 这是唯一一处"字符被完整顶成 `?` 但同句里另有 FFFD"从而被 invalid-utf8 闸顺带捞到的样本。

### F-xc-encoding-10 | P2 | `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts:2` | 引入 175ac8fb | confirmed —— **哨兵甄别：否**
```
父 f30a2427 L2:  * Tool registry → LLM tool definitions.
子 175ac8fb L2:  * Tool registry <?>LLM tool definitions.
```
丢的正是 `→`(U+2192)。`175ac8fb` 的标题是 `refactor(core): update imports, index exports, and CLI callers`——**纯 import 重构，提交里没有任何理由改这行文档注释**；且父版同句是干净的 `→`。
**判定：确认为损坏，非哨兵字符。**（若真是哨兵，父版不会有正常的 `→`。）

### F-xc-encoding-11 | P2 | `packages/core/src/infra/sksp/ports/secret-store.port.ts:2` | 引入 943709ee | confirmed —— **哨兵甄别：否**
```
父 943709ee^ L2:  * Secret Key Storage Protocol — async secret store port.
子 943709ee   L2:  * Secret Key Storage Protocol <?>async secret store port.
```
丢 `—`(U+2014)。`943709ee` = `refactor(core): organize infra adapter modules into ports/impl/logic`，是 `R073` **纯目录搬家**（git 相似度 73%），父版逐行干净。
**判定：确认为损坏，非哨兵。**

### F-xc-encoding-12 | P2 | `packages/core/src/infra/sksp/logic/ref-to-env.ts:8` | 引入 943709ee | confirmed —— **哨兵甄别：否**
```
父 943709ee^ L8: * `provider/<id>/apiKey` → `NOVEL_MASTER_PROVIDER_<ID>_API_KEY`.
子 943709ee   L8: * `provider/<id>/apiKey` <?>`NOVEL_MASTER_PROVIDER_<ID>_API_KEY`.
```
丢 `→`。同 F-xc-encoding-11 的纯搬家提交 `R078`。
**判定：确认为损坏，非哨兵。** 这行是 sksp 的 `ref → 环境变量名` 映射口径说明，**不能删**。

### F-xc-encoding-13 | P2 | `packages/core/src/infra/sksp/impl/composite-secret-store.ts:17` | 引入 943709ee | confirmed —— **哨兵甄别：否**
```
父 943709ee^ L17: * Read order: env hit → DB; writes go to DB only.
子 943709ee   L17: * Read order: env hit <?>DB; writes go to DB only.
```
丢 `→`。同 `R086` 纯搬家。后续 `c3da98d6`（`fix(core): 统一 SKSP 密钥生命周期，env 空壳退…`）改过本文件但**没修这行**，损坏已存活 2 个月+、跨 2 次提交。
**判定：确认为损坏，非哨兵。** 这行是 env 覆盖 DB 的读序契约说明，**不能删**。

> **哨兵甄别小结（任务重点）**：sksp 三处 + tool-definitions 一处，四处的共同点是「父版本同一行字符完好 + 引入提交是零语义动机的机械重构（import 重构 / 目录搬家）」。哨兵要成立需要"作者故意写入"，而父版的正常 `→`/`—` 正是反证。四处**全部判定为损坏，可放心按 F-xc-encoding-10~13 整体还原**。

### F-xc-encoding-14 | P2 | `.gitignore:24-25` | 置信 confirmed（未做引入提交考古）
全仓复扫新发现，**不在 10 文件输入单里**：`.gitignore`（1536 字节）不是合法 UTF-8，L24-25 的中文注释是**原始 GBK 字节**：
```
L24: # Android 构建产物：RN 打包 bundle 与 autlink 自动拷贝进 res 的第三方资源
L25: # （index.android.bundle / node_modules 图标拷贝 / keep.xml 均为构建生成，勿入库）
```
（以上由 CP936 重解码得到，**可完整还原**。）风险点是任何人用 UTF-8 工具改 `.gitignore` 就会雪上加霜。
**处置：整体还原（CP936→UTF-8 重写该文件，ASCII 行字节不变）。**

### F-xc-encoding-15 | P3 | `apps/mobile/android/app/build.gradle:12,44,113,114,117,118,170` | intentional（部分）
同样不是合法 UTF-8，但**这是 RULE.md:105 明文拍板的设计**：「`build.gradle` 是 GBK 编码，修改必须走字节级替换」，并记录了 1.5.23 发版时改 `?: "1.5.22"` 一行导致 10 行中文注释变乱码的事故。因此**不按 bug 报**。但要留档：当前 CP936 重解码后看到的是**二次 mojibake**（`锛夛紝` = UTF-8 被当 GBK 读过的痕迹）并夹带字面 `&#65533;` HTML 实体，即**它已越过 RULE 记录的状态、又退化了一层**。
**处置：标 intentional 出处（RULE.md:105），但把"已二次 mojibake + 残留 `&#65533;`"作为待办上报给 RULE 维护者**，不在本批修。

### F-xc-encoding-16 | P2 | 提交闸缺失（无 `core.hooksPath`，无 husky/lefthook） | 置信 confirmed
`git config --get core.hooksPath` 为空；`D:\Dev\Js\novel-master\.git\hooks` 只有 `*.sample`；根 `package.json` 无 husky/lefthoyk/simple-git-hooks 依赖。CI（`.github/workflows/ci.yml:55-66`）只跑 `format:check` / `lint` / `typecheck` / `test`，**没有任何编码/字符完整性检查**。也就是说 RULE.md:111 那条"2026-09-28 为难"的规则**纯靠自觉**，本次 10 处损坏正是它失效的直接后果。
**处置：见第 6 节最小方案。**

### F-xc-encoding-17 | P3 | `docs/Iterations/repo-mega-cr-2026-10/raw/w2-mobile-runtime.md:149-150` | 置信 confirmed
上游 CR 报告**引用了损坏原文**（4 处：抄自 `session-prompt-input.service.ts` L28-30），把污染复制进了文档层。该文件目前 untracked，所以没进 `git ls-files` 闸门，但一旦 `docs/Iterations/repo-mega-cr-2026-10/` 提交入库就会成为闸门的固定误报源。
**处置：修完 F-xc-encoding-2/3 后同步订正该报告的引文，或在报告里改成"原文已损坏，见 source"以免二次污染。**

## 争议与存疑

1. **F-xc-encoding-4 的具体转码链未定案（suspected）。** 能确认的是"有损非 UTF-8 转码、至少两次、至少三个口味"；不能确认是哪条工具链。两个待验假设（均未证实，不建议按其动手）：① `Get-Content | Set-Content` 无 `-Encoding utf8`（RULE.md:111 已知坑，解释口味 A/C）；② 某个 GBK 编辑器/插件把「`（`→`；`」按 GBK trail 字节 XOR 0x13 映射（解释口味 B，但推不出 CJK 丢失）。**取证需要**提交者的编辑器/工具链信息，超出 git 考古能力边界。
2. **`vfs.ts:81` 丢失的那 1 个字符是 `。` 还是别的**（suspected）。按 `/** …（消费方 ①）*/` 的收尾惯例推断为 `。`，但无父版可证，**必须人工确认后再落笔**。
3. **`agent-runner.test.ts` 8 行的原文无法从 git 恢复。** 三次引入提交（eff17cc6 / abc7b038 / 487b86b1）的父版都没有对应行，字节已丢；重写时需要看用例编号语义 + 同文件未损坏的断言体，属于**人工重写**而非机械还原，成本最高的一项。
4. **`session-prompt-input.service.ts` 的重写文本应以谁为准。** `apps/mobile/__tests__/chat-prompt-tokens.test.ts:451-454` 有同段叙述的干净版，但它是**测试视角的简写**，不能逐字替代服务里的类文档。建议按"父版已存在行直接还原 + 新增行按测试文件语义重写"两步走，不要整块照抄。
5. **闸门的 `?` 启发式（口味 A 的完整字符顶替）目前无法做到零误报。** prd.md 那种"整字符 → `?`"在文件其余部分恰好合法时才逃过 invalid-utf8 检测。只能做**告警不拦截**（见 6.3），强行拦截会撞上 `??` / `?.` / `?:` 这类合法语法。
6. **`docs/Iterations/cr-fix-spec/review/phase0/knip-raw-output.txt`** 223KB 工具原始输出，也不是合法 UTF-8。**未定**它是 GBK 工具输出还是含 ANSI 控制序列；按 review 原始产物处理（归入 allowlist）比逐字修更合理。
7. **本次 10 处损坏全部落在注释 / `it()` 标题 / markdown 标题**——已逐行核对，F-xc-encoding-1/2/3 的 26 个坏行经 `valid.ps1` 定位后全部是 `*` / `//` / `/**` 开头的注释行，`agent-runner.test.ts` 8 行全是 `it("` 或 `/**` 开头，**无字符串字面量、无断言表达式、无 SQL**。因此**无运行时行为影响**。这一条是本区优先级定在 P2 的依据；若后续扫描发现损坏落进字符串字面量，应立即升级为 P1。

## 6. 提交钩子防再犯 —— 最小方案（落纸，未实操）

按任务要求**只给方案，不动 git**（禁 `checkout` / `restore` / `config`）。以下三步全部是新增文件 + 一次 `git config`，不触碰任何现有源码。

### 6.1 判定规则（比任务书给的更严一档）

任务书写的是「非 ASCII 文件 U+FFFD>0 拒绝」。实测后**必须加一条 `invalid-utf8`**，否则会漏掉 10 个目标文件里的 5 个（session-prompt-input、message-body-text、prd.md、secret-store.port、ref-to-env 的字面 U+FFFD 计数是 **0**）。

闸门判定（对**白名单外的文本文件**）：
1. **纯 ASCII 直接放行**（`bytes.every(b => b < 0x80)`）——这一步同时把成本压到最低，实测 3581 个 tracked 文件里只有 3040 个非 ASCII。
2. `new TextDecoder('utf-8', { fatal: true }).decode(buf)` **抛错 → 拒绝**（非合法 UTF-8）。
3. buf 含 `EF BF BD` → **拒绝**（字面 U+FFFD）。
4. 命中 2 或 3 时，输出**行号 + 该行前 60 字符**，让作者一眼看到是自己哪行被写坏。

### 6.2 文件白名单（必须，否则 61 个文件全红）

全仓 `git ls-files` 严格 UTF-8 复扫实测：**3581 个 tracked 文件，3040 个非 ASCII，61 个未通过严格解码**。其中**只有 13 个是文本/文档（真损坏）**，另 48 个是二进制资产与工具原始输出：

- 真损坏 13 个：本报告 10 个 + `.gitignore` + `apps/mobile/android/app/build.gradle`（F-xc-encoding-15，intentional）+ `docs/Iterations/cr-fix-spec/review/phase0/knip-raw-output.txt`。
- 二进制 48 个：tokenizer 资产 `packages/tokenizer-driver-{node,rn}/**/assets/tokenizers/*.model`（gemma/nerdstash/nerdstash_v2/jamba/yi/llama/mistral）、图标 PNG（`apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher*.png` 16 个 + `apps/mobile/ios/NovelMaster/Images.xcassets/AppIcon.appiconset/*.png` 8 个 + `assets/{desktop,mobile,group,icon}.*` 4 个）、`apps/mobile/android/app/debug.keystore`、`apps/mobile/android/gradle/wrapper/gradle-wrapper.jar`、`packages/core/.apm/kb/index/search.json.gz`。

**白名单口径建议用「按后缀 + 二进制探测」而不是硬编码路径**：`.model .png .jpg .jpeg .webp .jar .keystore .gz .zip .woff .woff2 .ttf .otf .ico .pdf` 命中即跳过；knip 原始输出按路径跳过（`docs/**/knip-raw-output.txt`）。这样以后新增图标/模型不用改白名单。

### 6.3 落地形态（三文件 + 一条 config，全部新增）

```
scripts/check-encoding.mjs     # 规则 6.1 + 白名单 6.2；支持两个模式：
                               #   node scripts/check-encoding.mjs            → 扫全仓（CI 用）
                               #   node scripts/check-encoding.mjs --staged   → 只扫 git diff --cached 的文件（pre-commit 用）
.githooks/pre-commit           # #!/bin/sh + set -e + exec node scripts/check-encoding.mjs --staged
                               # 失败时 echo 提示：多半是 PowerShell Set-Content 忘了 -Encoding utf8（见 RULE.md:111）
```
启用（一次性，用户执行）：
```
git config core.hooksPath .githooks
```
package.json 加两个脚本，便于 CI 复用同一份实现：
```
"encoding:check": "node scripts/check-encoding.mjs"
```

**为什么选 `core.hooksPath` 而不是 husky**：本仓 devDependencies 里**没有** husky/lefthook/simple-git-hooks（实测），引一个包只为跑 20 行 Node 脚本不划算；`core.hooksPath` 零依赖，`.githooks/` 进版本库，Windows / macOS / Linux 通用（`#!/bin/sh` 由 Git for Windows 自带）。

### 6.4 落地顺序（必须先清干净再加闸，否则第一次提交就红）

1. 先按第 3 节把 13 个文本文件修完（F-xc-encoding-1 优先，它是唯一能机械 100% 恢复的）。
2. 再加 `scripts/check-encoding.mjs` + `.githooks/pre-commit`，此时**全仓应当 0 失败**——这是闸门正确性的自检。
3. `git config core.hooksPath .githooks`。
4. 在 `.github/workflows/ci.yml` 的 `format:check` 之后插一步 `run: npm run encoding:check`（pre-commit 可被 `--no-verify` 绕过，CI 是第二道）。
5. 在 `docs/apm/RULE.md:111` 那条 PowerShell 规则末尾补一句「已由 `scripts/check-encoding.mjs` 强制」，并新增一条「GBK 编码文件只有 `apps/mobile/android/app/build.gradle` 一个，改它走字节级替换（RULE.md:105）」，把 `.gitignore` 从隐雷变成显式约束。

### 6.5 已知盲区（明说，不假装覆盖）

- 口味 B（`（`→`；` 这类**合法错字**）规则 6.1 **查不到**——文件是合法 UTF-8 且无 FFFD。只能靠 §F-xc-encoding-3 的"从父版还原"路径修，无法自动化拦截。
- 口味 A 的"整字符 → ASCII `?`"在文件其余部分恰好合法时（如 prd.md 若同句没有 `·`）也会逃过。建议在脚本里加一条**只告警不拦截**的启发式：文本行内出现 `\?{2,}` 且该行同时含非 ASCII 时打 WARN。实测合法 `??`/`?.` 集中在纯代码行且多与 ASCII 标识符相邻，误报率可接受；WARN 不阻断，不影响提交。
- 闸门只看**字节层**，无法识别"作者手动敲了个错别字"。那属于 code review 范畴。

## 附：可复现的核查命令（只读，供复核）

```powershell
# 全仓严格 UTF-8 复扫（本报告 6.2 的 61/13 数字来源）
node tmp\gate-scan.mjs
# 逐提交 FFFD census（引入提交定位）
git cat-file blob <commit>:<path> > tmp\b.bin   # 必须用 cmd 重定向，PowerShell 的 > 会做文本转码
# 原始 GBK 段落恢复（session-prompt-input L110-114）
node -e "const b=require('fs').readFileSync('apps/mobile/src/services/session-prompt-input.service.ts');console.log(new (require('util').TextDecoder)().decode(b))"
```
