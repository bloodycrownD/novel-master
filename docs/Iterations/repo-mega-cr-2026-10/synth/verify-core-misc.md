---
zone: synth-core-misc
agent: verify（W6 逐条验证）
target: synth/core-misc.md
verified_at: 2026-10-01
method: 逐条从代码重推导 + core 包内实跑探针（tsx --test，跑完即删）
discipline: 只读（禁 git 写、禁改 docs/apm/、未改任何生产代码）
---

# W6 验证：core-misc 簇 P1 逐条复核

## 免验清单

| ID | 原判 | 免验理由 | 处置 |
|---|---|---|---|
| M-01 | P1 | 主代理指定免验：三源印证 + W3 实跑复现，证据密度已顶格，W6 复跑边际收益低 | 直接进 backlog 首位；native 路径仍缺真机取证（见「遗留」） |

其余 P1（M-02 / M-03 / M-04 / M-05）**全部逐条从代码重新推导并实跑**。

## 方法说明

W2 的 M-05 是「逐字复刻实现」复现的，W3 的结论多为读码。W6 改用**直接 import 生产模块**
的探针（`packages/core/test/zz-w6-probe*.test.ts`，`tsx --experimental-test-module-mocks
--tsconfig tsconfig.test.json --test`，跑完全部删除，`git status` 复核仅 `package-lock.json`
与本迭代目录有变更）。因此本报告的每条 confirmed 都是**生产代码路径**上的观测，不是复刻。

---

## verdict 表

| ID | 原判 | W6 verdict | 证据强度 | 关键修正 |
|---|---|---|---|---|
| M-01 | P1 | **免验**（沿用） | — | — |
| M-02 | P1 | **adjusted → P2** | 实跑（生产 `parseSkillFrontMatter`） | **原描述的用户可见后果不成立**；真实触发面比原述窄、危害比原述轻 |
| M-03 | P1 | **confirmed** | 实跑（真实 sqlite + 真实 VFS + 真实 assemble） | 无修正；两个入口都实跑复现 |
| M-04 | P1 | **confirmed**（机制升 hard） | 实跑（真实 DB 端到端） | 追加第三处：`prompts_json` 的 `JSON.parse` 裸调用被 DB CHECK 挡住（**反驳 M-17**） |
| M-05 | P1 | **refuted（危害链）→ adjusted → P2** | 实跑（真实 cl100k + 真实 16K 输入） | **不变量确实破了，但「唯一护栏 / O(len²) 回归」这条危害链被实测证伪** |

统计：**confirmed 2 / adjusted 1 / refuted 1**（免验 1）。

---

## M-02 | adjusted：desktop 建技能「立即无效」不成立，P1 → P2

### 重推导

`apps/desktop/renderer/features/skills/skill-ui.ts:21-35` 确实是裸插值，与 mobile
`skill-ui.ts:48-56` 的 `yamlScalar`（`JSON.stringify`）分叉——**分叉本身 confirmed**。
desktop 的 `NewSkillModal.tsx:199` 无条件把 `buildNewSkillDoc(trimmedName, trimmedDesc)`
送进 `ipcSkillsWrite`，也没有任何前置校验。所以「两端实现不等价」成立。

### 实跑（生产 `parseSkillFrontMatter` + 两端真实模板）

| 描述输入 | desktop `valid` | mobile `valid` |
|---|---|---|
| `用途：调研`（**原报告举的例子**） | **true** | true |
| `use: research`（半角冒号+空格） | **false**（YAML 解析报错） | true |
| 含换行 | **false** | true |
| `a # b` | **true，但 description 被截成 `"a"`** | true（完整） |
| ` leading`（前导空格） | true，但 description 被 trim 成 `"leading"` | true |
| `say "hi" now` / `it's fine` / `a [b] c` | true | true |

### 裁定

**原报告的核心论据被自己的例子反驳**：`用途：调研` 用的是**全角冒号**，YAML 只把
`": "`（半角冒号+空格）当映射分隔符，全角冒号在 plain scalar 里完全合法——两端都 valid。
「唯一确定会造成用户可见功能失败的漂移」这个说法不成立。

真实触发面确实存在，但窄得多：
- **半角 `xxx: yyy` 形态**（英文说明习惯，中文用户较少但模型生成/粘贴会带）；
- **含换行的描述**——两端 UI 控件形态不同：desktop 是 `<textarea>`（`:256`，天然可多行），
  mobile 是 `TextInput multiline`（`:335`）。mobile 侧被 `yamlScalar` 挡住，desktop 侧直接炸。
  这是最现实的一条：desktop 用户在描述里换行 → 技能创建后立即「无效技能」。

**危害比原述轻一档**：`.strict()` schema 与 `parseSkillFrontMatter` 都会给出
`invalidReason`（`front matter 不可解析：…`），且 UI 有修复入口，不是静默损坏。
M-22 描述的「静默无效」是另一条机制（strict 死角），不与本条叠加。

### 建议（与原报告一致，落点不变）

下沉 core 为 `domain/skills/logic/build-new-skill-doc.ts`，采用 mobile 的 `yamlScalar` 口径，
两端 re-export。**改动量比原述还小**（desktop 端替换 2 行）。

### 遗留

- `a # b` → description 截断、` leading` → 被 trim，两端都会发生（mobile 也一样，因为
  `JSON.stringify` 保住了原文但 YAML plain scalar 语义会吃掉 `#` 后内容——实际 mobile 的
  引号形式不会，这是 desktop 独有）。**建议在 core 测试里锁死这三种形态的双端口径**，
  否则「下沉统一」之后仍会有差异断言缺失。

---

## M-03 | confirmed：1970 假时间戳进常驻提示词，P1 维持

### 重推导

`load-or-fill-file-cache.ts:214-222` 两个返回 `mtimeMs: 0` 的入口原文确认；
`:152-164` 确实把结果落 `file_cache`；`assemble-workplace-display.ts:188-195` 确实
`mtimeMs: payload.mtimeMs` 原样喂 `renderFileBlock`，**没有 `ctx.mtimeByPath` 之类的兜底**；
`workplace-display.ts:78-84` 确实 `formatLocalMtime(mtimeMs)` 同时写 `createdAt`/`updatedAt`。
控制流逐段与原报告一致。

### 实跑

**入口 A（`fillPolicy: "filename"`）**——真实 sqlite + 真实 VFS + 真实 `assembleWorkplaceDisplay`：

```
[输入] /note.md = "hello-world"，目录规则 fillPolicy=filename, headCount=0, tailCount=0
[输出] createdAt="1970-01-01 08:00:00" updatedAt="1970-01-01 08:00:00"
[指纹] /note.md|filename|0|0
```

`1970? true`。且该选项是**双端 UI 的正式选项**（`DirectoryRuleSheet.tsx:54`、
`DirectoryRuleModal.tsx:32`，label 都是「文件名」），非边缘路径。

> 注：探针第一次没复现，是因为默认 `DEFAULT_WORKPLACE_DIR_RULE.tailCount = 1000`
> 会让全部文件落进 head/tail 优先集直接判 `full`（`workplace-eval.ts:165-168`），
> 必须显式 `headCount:0, tailCount:0` 才走得到 `fill === "filename"` 分支。
> **这本身是一条补充发现**：`filename` 档位只在用户把 head/tail 都调小后才生效，
> 默认配置下不可达——所以「正式选项」成立，但「默认路径」不成立。

**入口 B（catch 降级）**——真实 sqlite：

```
[第一次] findContentSize=null, read 抛错 → {"body":"(missing)","mtimeMs":0}
[渲染]   <file path="/x.md" createdAt="1970-01-01 08:00:00" ...>1|(missing)</file>
[第二次] 换成能正常读的 vfs → {"body":"(missing)","mtimeMs":0}   ← cache 固化，故障恢复也不自愈
```

**「永久固化」这一条被实跑坐实**：一次偶发失败后，即使 VFS 恢复正常，该 path 在本会话
余下所有轮次都渲染成 `(missing)` + 1970。

### 与同文件超限分支的自相矛盾 —— confirmed

`:145-148` 注释明写超限占位符「**不写 file_cache**（避免把占位符粘进缓存）」并专门带回真实
`mtimeMs` 避免 1970；而 `filename` 档位与 catch 路径既写 cache 又带 0。同一个函数里，
三个降级分支有三种口径。

### 测试缺口 —— confirmed

`assemble-workplace-display.test.ts:459-466` 的 1970 断言**只覆盖超限占位符**；
`chunk` 侧 `assertInvariants` 也无覆盖。两个入口均无测试。

### 建议（在原报告基础上微调）

原报告两条建议都成立，补充第三条：
1. 入口 A 在回填前做轻量 `vfs.findContentSize` 拿 mtimeMs（注意 `:142` 已对
   `status !== "filename"` 走这条探测，把 `filename` 也纳入即可，**成本几乎为零**——
   只需把返回的 `mtimeMs` 用上，不返回占位符）；
2. 入口 B 把降级归入「不落 cache」分支，或 catch 内区分 `NOT_FOUND` 与其余异常；
3. 补「createdAt 不得以 1970 开头」的断言，覆盖三个降级分支。

---

## M-04 | confirmed：删模型守卫漏扫会话 pin + provider 删除完全绕守卫

### 重推导

`find-saved-model-references.ts` 三处扫描（workspace `currentModelId` / `agent_definition.prompts_json`
/ `chat_project.agent_config_json`）确认，**确实没有 `chat_session`**。而会话级 pin 确实存在
`chat_session.agent_config_json`（`SessionAgentConfig = {agentId, modelId?}`，
`session.service.ts:114-119` 新建时从 workspace 复制 `modelId`、`:285-303` update 可改），
且确实在运行时生效（`agent-run-shared.ts:107-118` `sessionModelId` 覆盖 agent pin），
失效点确实是 `assert-saved-model-uuid.ts:41-47` 抛 `Saved model not found`。
`chat_session` 表确实**没有** `model_id` 列（`chat-schema.ts:16-24`）。
`provider.service.ts:240-250` 的 `delete-saved-models` 确实直接 `savedModels.deleteByProvider(id)`，
**全程无 `findSavedModelReferences` 调用**。

### 实跑（真实 sqlite 端到端，四条独立探针）

```
[M-04]  会话 agent_config_json = {"agentId":"a1","modelId":"<savedId>"}
        findSavedModelReferences = []            ← 守卫扫不到
        deleteSaved 成功（守卫未拦住）
        删除后剩余模型 = []

[M-04b] chat_project.agent_config_json 非空行数 = 0   ← 结构性永空，confirmed
        （手工 UPDATE 写入一行后 refs = ["chat_project:<uuid>"] —— 扫描逻辑本身是对的，
          只是生产路径永不写这一列）

[M-04c] prompts_json 写入非法 JSON → DB 直接拦：
        CHECK constraint failed: prompts_json IS NULL OR json_valid(prompts_json)
        全表 JSON.parse 异常 = (无)

[M-04d] 删除前 saved models = 1
        bundle.providers.delete(prov.id)  ← 守卫完全不被调用
        删 provider 后 llm_saved_model 残留行数 = 0
```

**四处全部 confirmed**，其中 M-04d 把「删服务商绕过守卫」从读码结论升级为实跑结论。
M-04b 顺带确认了 M-17 的「`chat_project` 扫描结构上永空」。

### 追加发现（反驳 M-17 的一半）

M-17 说 `:56` 的 `JSON.parse(String(row.prompts_json))` 无 try/catch，「任一行 agent prompt
JSON 损坏，整次删除守卫直接抛 SyntaxError」。**实测不可达**：`agent_definition.prompts_json`
的 DDL 带 `CHECK (prompts_json IS NULL OR json_valid(prompts_json))`
（`bootstrap/agent/agent-schema.ts:11`），DB 层就挡住了非法 JSON。

（`AgentDefinitionRow.prompts_json` 类型标成非空 string 与 DDL 的 `NOT NULL` 一致，
M-17 顺带提的「实际列可空」这一点也不成立——DDL 写的是 `TEXT NOT NULL`。）

**M-17 应收窄为**：只剩「`chat_project` 分支结构上永空 + 每次删除全表扫一遍」，
删掉 JSON.parse 崩溃那一条。同理建议核对 `chat_project.agent_config_json` 是否有 CHECK
（实测该列**可写非法 JSON**，`M-04b` 能手工写进去——但那条分支同样没有裸 parse，
`:77` 的 `JSON.parse` 在 `raw != null` 之后 unguarded… 实测手工写入合法 JSON 时正常，
写入非法 JSON 未测，属**低危残留**）。

### 建议（在原报告基础上补一条）

1. 在 `chat_project` 扫描旁补 `SELECT id, agent_config_json FROM chat_session`，命中记
   `chat_session:{id}`（照 M-04b 的探针写法即可）；
2. `delete(provider)` 路径补同样的 in-use 拒绝（`delete-saved-models` 步骤执行前）；
3. **新增**：补一条端到端回归——「会话 pin 存在时 `deleteSaved` 必须抛
   `SAVED_MODEL_IN_USE`」。现有 3 条 `deleteSaved` 测试（`provider-model.service.test.ts:267-325`）
   覆盖了 `currentModelId` / `agent_definition.model` / `chat_project`，**独缺 `chat_session`**。

---

## M-05 | refuted（危害链）：不变量确实破了，但「唯一护栏 / O(len²) 回归」被实测证伪

### 机制层 —— confirmed（生产实现，非复刻）

`chunk-splitter.ts:52-59` 句末分支确实不检查块长。直接 import 生产
`splitTextIntoChunks` 实跑：

| 输入 | 块数 | 最长块 | 划分守恒 |
|---|---|---|---|
| `。`×100 | 1 | **100** | true |
| `\n`×200 | 1 | **200** | true |
| `>`×300 | 1 | **300** | true |
| `！`×500 | 1 | **500** | true |
| 混合句末×480 | 1 | **480** | true |
| 正常中文×320（对照） | 20 | 16 | true |
| 无标点 CJK×500（对照） | 8 | **64** | true |

`assertInvariants("。".repeat(200))` 在当前实现下**会红**（实测
`error: '。×200 违反 ≤64 不变量：最长 200'`）。原报告关于「断言从未红过是夹具覆盖不到」
的诊断 confirmed（`chunk-splitter.test.ts` 的 6 个 `assertInvariants` 调用点，
最长用例是 `"汉".repeat(130)` 与 `"字".repeat(10_000)`——**都是无句末符输入**，
恰好绕开了句末分支）。

### 危害层 —— **refuted**

原报告的因果链是：「块长不变量是逐块 encode ≤64 的**唯一护栏**，破了就回归 O(len²)，
而 `count-text-with-tokenizer.ts:5-22` 的 8K 中文 32.8s → 亚秒级数据全部建立在这个保证上」。

**这条链在代码层就是断的**：`countTextWithIncrementalTokenizer` 走的是
`createIncrementalTokenCounter`，其 `encodePiece`（`incremental-token-counter.ts:240-255`）
**自己**按 `MAX_ENCODE_CHARS = 64` 硬切（`:112`、`:247`），与 `splitTextIntoChunks`
**完全独立**。也就是说 `chunk-splitter` 压根不是那条护栏——
`incremental-token-counter` 才是，且它没被破。

**实测（真实 js-tiktoken cl100k_base，非 stub）**：

| n | 病态（连续句末符，单块 n） | 对照（CJK，块长 64） |
|---|---|---|
| 2000 | 101ms / tok=1001 | 76ms / tok=2000 |
| 4000 | 186ms / tok=2001 | 165ms / tok=4000 |
| 8000 | **372ms** / tok=4001 | **332ms** / tok=4000 |
| 16000 | 786ms / tok=8001 | 973ms / tok=8000 |

病态输入**没有出现任何超线性爆炸**——16000 字符（超限 250 倍）耗时 786ms，
比同规模 CJK 对照（973ms）**还快**。原因是 `encodePiece` 自己的 64 字符硬切在起作用。

交叉对照（直接全量 `encode`，绕过计数器）：

| n | 全量 encode CJK | 计数器（分块） | 倍数 |
|---|---|---|---|
| 2000 | 3370ms | 76ms | 44× |
| 4000 | 14863ms | 165ms | 90× |
| 8000 | **52738ms** | **332ms** | **159×** |

这正好复现了 `count-text-with-tokenizer.ts:16-21` 模块头记录的「8K 纯中文全量 encode 32.8s
→ 增量计数器亚秒级、快 175~195 倍」——**说明那条性能收益的来源是 `incremental-token-counter`，
不是 `chunk-splitter`**。原报告把这笔性能账记在了切分器头上。

### 真实危害（降级后的实际影响）

危害确实存在，但性质完全不同——**不是 CPU 爆炸，是 L2 内容寻址缓存的复用率归零**：

| 场景 | 块数 | 改 1 字后可复用块 | 命中率 |
|---|---|---|---|
| 句末符密集 4000 字符 | 1 → 1 | 0 | **0.0%** |
| 正常中文 3780 字符 | 140 → 140 | 140 | **100.0%** |

8000 字符病态文本 → L2 只有 **1 个条目**，单条目覆盖 8000 字符。改任意一个字符，
整篇缓存全部失效。而正常中文是 140 个条目、改 1 字只失效 1 个。

这正是 `count-prompt-llm-input.ts:79-82` 注释里说的「34.7% 重分块率」设计目标被打穿。

### 裁定与建议

- **机制 confirmed，危害 refuted，P1 → P2。** 原报告「护栏被绕过本身值得修，RULE 已把该护栏
  列为性能前提」的理由**不成立**（那条性能前提由 `incremental-token-counter` 承担且完好）。
- 保留原报告的**修法**（句末贪吃循环加 `end - start < MAX_CHUNK_CHARS` 封顶）——
  修的是缓存粒度与不变量诚实性，改动 1 行，仍然值得做。
- 保留原报告的**两条边界用例**（`assertInvariants("。".repeat(200))` /
  `assertInvariants("\n".repeat(200))`）——实测当前实现下会红，是有效的回归。
- **修法微调**：加封顶后要验证不会把「连续句末符」打散成大量小块从而**恶化**正常路径的
  块数（`"。。。！！！"` 这种 6 字符 golden 用例会从 1 块变 2 块，golden 快照需同步更新）。
- **补充建议**：`chunk-splitter.ts:12-14` 的模块头注释应改口径——它承诺的
  「保证后续逐块 encode 恒 ≤64 字符」在**当前实现下对句末符密集输入不成立**，
  而真正的保证在 `incremental-token-counter.ts:104-112`。注释比实现乐观，属于
  与 M-22 同型的「注释承诺 ≠ 实现」。

---

## 汇总：给 W7 的输入

| 建议 | 内容 |
|---|---|
| **backlog 排序调整** | 原序 M-01 > M-02 > M-03 > M-04 > M-05。W6 建议改为 **M-01 > M-04 > M-03 > M-02 ≈ M-05**：M-02 因论据被自己的例子反驳而降级，M-05 因危害链被实测证伪而降级；M-04 反而因 M-04d 实跑坐实「删服务商静默清空被引用模型」而更靠前。 |
| **M-04 可考虑升 P0 复核** | 失败形态是「会话下次开跑显式抛 `Saved model not found`」，不是静默损坏，故维持 P1。但**若产品口径认为「删服务商导致用户会话突然不可用」等同数据丢失**，值得复议 P0。 |
| **M-17 收窄** | 删掉「`prompts_json` 裸 `JSON.parse` 崩溃」与「该列实际可空」两条（被 `CHECK json_valid` + `NOT NULL` 反驳），只保留「`chat_project` 分支结构上永空 + 每次删除全表扫」。 |
| **M-05 注释订正** | `chunk-splitter.ts:12-14` 的护栏承诺应改为指向 `incremental-token-counter`；`count-text-with-tokenizer.ts` 模块头的性能归因是对的，无需改。 |
| **M-02 建议保留** | 修法与落点不变（core 下沉 + `yamlScalar`），只是优先级下调、且需在 core 测试里额外锁 `#` 截断与前导空格两形态。 |
| **M-03 建议提级修** | 唯一一条「用户当场可见 + 会话内不可自愈 + 与同文件注释自相矛盾」的 P1，且修法成本极低（把 `filename` 纳入 `:142` 已有的 `findContentSize` 探测即可）。 |

## 遗留（W6 未覆盖）

- **M-01 的 mobile native 路径**未真机取证（主代理已免验，此处仅登记）。
- **M-03 的 `1970` 在 `header` 档位**未单独验证（`header` 走 `readWorkplaceFileBody` 的
  正常路径带真实 mtime，判定为不 affected，未实跑）。
- **M-02 的 ZIP 导入路径**（`NewSkillModal.tsx:180-188` 走 `withSkillFrontMatterValues`
  而非 `buildNewSkillDoc`）未纳入本次对照——它属 M-21/M-22 的口径，不属本条。
- 本次全部探针依赖 `novelMasterTestFixture` 的**真实 sqlite + 真实 VFS**，
  未覆盖 Hermes/RN 运行时差异（M-26 相关，不在本簇）。
