---
shard: wave-b-core2
owner: s-core-b2
baseline_sha: fe79b781
ledger: ../ledger-v2.md（§2.4 / §2.5 / §2.8 / §10 Wave B）
条目数: 11
量级: N-P1-02=S / M-06=P2(3 行) / summarizeToolInput=S(收敛) / M-03=S / M-04=**M**(独立 commit C3b，见打包约束) /
      M-01=**M**(独立 commit C3c，见打包约束) / CS-02=S / CS-07=S(须在 CS-06 之后) / CS-08=S / B=S / S-D-02=S
---

# Wave B · core 杂项分片（wave-b-core2）

> 本片 = Wave B 的「core 杂项 + 收尾杂项」，含 N-P1-02 / M-06 / summarizeToolInput 三条
> 单列项，ledger §10 Wave B「（同波顺带）」行里归属本机的 7 条，以及 **judge-r1 §A.2(b) 补排
> 并裁定归本片的 M-01**（台账 §10 两张表均未列它，R1 之前一直是漏条）。
> **撰写时已逐条打开 `fe79b781` 当前代码核对行号**（PLAN 第四章第 8 条），台账行号有漂移处
> 以本片为准，漂移点在各条「证据」小节显式标出。

---

## 0 · 打包约束（P1-S 批次）

台账 §10 Wave B 末行把这批归成一个「P1-S 批次」PR，并声明「全部量级 S、零结构变更」。
本机逐条核对后有 **三处必须写清的约束**（其中两处是台账自身与代码/台账的不一致，请 judge 裁）：

### 0.1 批次内部分层（提交顺序，不可打乱）

一个 PR、**六个** commit，顺序如下：

| # | commit | 含条目 | 性质 | 为什么必须在这个位置 |
|---|---|---|---|---|
| C1 | `fix(prompt): 白名单补 skillsEnabled/skillsPrefix` | N-P1-02 | 行为修复 | 独立、零依赖，先落便于二分定位 |
| C2 | `fix(sse): 接受无空格 data: 形态` | M-06 | 行为修复 | 独立；改的是三 parser 的共享前置，须先于 C3 的测试跑 |
| C3a | `fix(provider+workplace+vfs+desktop): P1-S 杂项` | M-03、CS-02、CS-08、B、S-D-02、summarizeToolInput | 行为修复 + 收敛 | 这六条互不相干，同 commit 只为减少 PR 数 |
| C3b | `fix(provider): 删模型/删服务商守卫覆盖会话引用` | M-04 | 行为修复 + 依赖注入 | **量级 M**（见 0.2）：有 deps 增字段的结构改动 + 产品行为面变更，须独立成 commit 以便单独评审与回滚 |
| C3c | `fix(provider): 重试判定加 attempt 级「已产出」闩锁` | M-01 | 行为修复 | **量级 M**（见 0.2）：改重试循环的可重试语义，改错会让黑流被吞或让黑洞不再重试；与 C3b 同族但机理正交，须独立成 commit |
| C4 | `fix(vfs): DELETE 触发器感知 entry 引用` | CS-07 | 纵深防御 | **唯一有跨波依赖的条目**（见 0.3），必须独立成 commit 以便按 CS-06 的合入节奏择机合入 |

⚠️ **C3 被拆成 C3a / C3b / C3c 三个 commit**：硬约束①要求「M-04 单独 commit」（§0.2），
judge-r1 §A.2 补排的 M-01 同样给出「量 M + 改可重试语义」，按同一纪律单列为 C3c。
本表与 §12.1 代码块必须同步为此口径。

### 0.2 量级不一致：M-04 / M-01 不是 S（须 judge 裁）

ledger §2.5 的「量」列给 **M-04 = M**、**M-01 = M**，而 Wave B「（同波顺带）」行声明「全部量级 S」。
核对代码后本机确认 M-04 确非 S 级：

- 改 `find-saved-model-references.ts` 新增一条 `chat_session` 扫描（RULE 已记 `chat_session`
  **没有** `model_id` 列，覆盖存在 `agent_config_json` 的 `{agentId, modelId?}` 里）；
- 改 `provider.service.ts` 的 `delete(id)` **整条删除流水线**（`CoordinatedWrite` 五步中插一步
  in-use 拒绝），这是行为面变更不是补一行。

**默认建议案（本片按此撰写，已由 sr1-core2-b §2.3 裁定采纳）**：M-04 留在本 PR 内、
但**单列为独立 commit（C3b）**，commit 正文注明「本批含 1 条台账量级 M（M-04）」。
若 judge 倾向严守「全部 S」，则 M-04 整条移出本批；⚠️ **移出后无处可挂**：
Wave C「事务边界收窄」格是 core-storage + core-data 的 CS-05/06/07/11 + RT-01，
**没有任何 provider 行的落点**，故移出方案须由 judge 在「Wave C 另立 provider 归属」
或「M-04 独立成 PR」之间二选一，**不可照旧稿挂到 Wave C 的事务边界格**。

🔁 **R2 追加（M-01，judge-r1 §A.2(b) 裁定）**：M-01 是本批**第二条量级 M**，且它比 M-04 更不适合塞进
「零结构变更」的 P1-S 批次——它改的是 `model-request.service.ts` 重试循环的**可重试语义**
（判据从「错误形态」扩为「错误形态 ∧ 本 attempt 是否已产出」），改错的两个方向都有静默后果：
闩锁太松 ⇒ 重复输出 + 重复计费；闩锁太紧 ⇒ 流中断黑洞再也重试不了（首字后断流的
`LlmStreamTimeoutError` 分级就是被这个闩锁覆盖的既有正确行为，见 §11 证据节）。
⇒ 本片按同一纪律处理：**单列为独立 commit C3c**（§0.1），commit 正文注明「本批含 2 条台账量级 M」。
M-01 的归属已被 judge-r1 **明文裁定归本片**（provider 域，与 M-04 同族），故不存在 M-04 那种
「移出后无处可挂」的归属争议——它在本 PR 内是终态，不再是待裁项。

### 0.3 CS-07 的跨波顺序约束（本批唯一阻塞点）

ledger §2.4 CS-07 行明写「**须在 CS-06 之后**」；synth `core-storage.md:191` 的对抗裁决
（pro-8）把它定成「先修 CS-06/CS-12，本条降为纵深防御」。

- CS-06（`writeOrUpdateFile` 不 append revision、不动 ref_count）在 **wave-c2**；
- CS-12（`copyVfsTree` overlay 改 head_version 不建 revision）已降 **P2**、不在任何 Wave。

⇒ **CS-07 的代码改动属 Wave B 分片，但合入时点必须晚于 CS-06**。执行口径：
C4 写好但不与 C1–C3 一起合入；待 wave-c2 的 CS-06 合入 main 后再单独合 C4。
（CS-12 残留的那部分触发面本条修不掉，是已知的纵深防御不完整面，见 §CS-07 风险栏。）

### 0.4 批次级验收线

```
# 类型
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc --noEmit -p apps/desktop/tsconfig.json
# 测试（RULE：core 定向跑必须带两个 flag，否则 tokenizer driver 未注册）
npm test -w @novel-master/core
node scripts/run-tests.mjs "test/**/*.test.ts" --test-concurrency=2      # apps/desktop
npx jest --maxWorkers=2                                                  # apps/mobile
```
mobile 满负载偶发假红按 RULE 降并发复跑；desktop 收集数必须 > 0（N-P0-02 的零收集守卫）。

---

## 1 · N-P1-02 · `normalizeAgentPromptLayoutDomain` 白名单漏 `skillsEnabled` / `skillsPrefix`

**严重度 / 簇**：P1 / core-misc（prompt 域）

### 病症

`normalizeAgentPromptLayoutDomain` 是「域形态 layout → 归一化域 layout」的唯一单源，
用**显式白名单重建对象**。白名单漏了两个字段，于是：
① `skillsEnabled: false` 的 agent 从存储读回来变成**字段缺失**，
`resolve-agent-tool-registry` 的 `=== false` 判不成立 ⇒ **用户已关闭的技能能力静默复活**
（skill 工具重新进 registry，skills 索引重新注入）；② `skillsPrefix` 丢失 ⇒
`formatSkillsIndexBody` 回落到 `DEFAULT_SKILLS_INDEX_PREFIX`，用户自定义的技能索引前缀语
在读侧失效。这是 RULE「白名单完整性」的**第二次**连续漏字段（上一次漏 `customAttach`）。

### 证据（`fe79b781` 亲自核对）

`packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts:61-73`
```ts
  return {
    ...(layout.system != null && layout.system.trim() !== "" ? { system: layout.system } : {}),
    ...(layout.persistEnabled === true ? { persistEnabled: true } : {}),
    ...(layout.dynamicEnabled === true ? { dynamicEnabled: true } : {}),
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    ...(layoutHasCustomAttach(layout) ? { customAttach: layout.customAttach } : {}),
    persist, dynamic: [...layout.dynamic],   // ← skillsEnabled / skillsPrefix 均不在白名单
```
- 唯一生产消费方 `packages/core/src/config-forms/stored-config-validity/assess-agent-definition-wire.ts:86`
  （台账写作 `resolveAgentDefinitionFromStorage`，实为该文件里的同函数 `:78-91`，行号已漂）；
- 受害判定点 `packages/core/src/domain/agent/logic/resolve-agent-tool-registry.ts:71`
  `if (definition.prompts.skillsEnabled === false) {`；
- 前缀回落 `packages/core/src/service/prompt/render-prompt.ts:165-179` 的
  `prefix != null && prefix.trim().length > 0 ? prefix.trim() : DEFAULT_SKILLS_INDEX_PREFIX`
  （台账记 `:174`，实为 `:175-177`——`:174` 是 `const header =`、`:177` 是
  `DEFAULT_SKILLS_INDEX_PREFIX;`；函数起于 `:165`；调用点 `:282`/`:365`）。

### 修法（文件·函数级）

1. `packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts` ·
   `normalizeAgentPromptLayoutDomain`：在 `customAttach` 之后、`persist` 之前插入两条，
   **逐字对齐同仓的规范实现** `validate-agent-prompt-layout.ts:308-314`：

   ```ts
   ...(layout.skillsEnabled === false ? { skillsEnabled: false } : {}),
   ...(() => {
     const prefixRaw = layout.skillsPrefix;
     return typeof prefixRaw === "string" && prefixRaw.trim().length > 0
       ? { skillsPrefix: prefixRaw }
       : {};
   })(),
   ```

   **⚠️ 本条最容易修错的地方**：白名单里既有的 `persistEnabled`/`dynamicEnabled` 用的是
   `=== true`，**`skillsEnabled` 不能照抄**——它的语义是「缺省 = 开，仅显式 `false` 表示关闭」
   （`agent-definition.schema.ts:115-116` 的注释与 wire schema 都是这么定的）。
   写成 `=== true` 会把 `skillsEnabled: false` 过滤掉，**症状不变且更难查**。
   `true` 保持省略即可（`validateAgentPromptLayoutFromMaps` 也是这么归一的，两边输出必须一致，
   否则 `resolveAgentDefinitionFromStorage` 与 `validateAgentPromptLayout` 会来回改写）。

2. 同一文件补模块头注释：注明「本白名单必须覆盖 `AgentPromptLayout` 的全部可选标量字段；
   新增字段时必须同步本白名单与 `test/prompt/normalize-agent-prompt-layout.test.ts`
   的 `全字段白名单往返` 用例的夹具」。
   ⚠️ **注释里不得再写「否则该用例会红」（sr1-core2-a MF-1 核实：那是假承诺）**——
   键集断言两侧的 `full` 都是人手写的夹具：有人给 `AgentPromptLayout` 新增
   `readonly foo?: string` 却忘了加白名单时，`full` 里没有 `foo`、normalize 输出里也没有 `foo`，
   两侧键集**依然相等** ⇒ 测试照样全绿。
   本白名单的字段集合**由 wave-e H2 的类型层守卫在编译期兜底**：
   `satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>`
   （新增字段 ⇒ `Record` 缺键 ⇒ 编译红；删掉已删字段 ⇒ excess property ⇒ 编译红）。
   ⚠️ 实现提示：`tsconfig.base.json` 开了 `noUnusedLocals: true`，该常量若加了却没被同文件的
   断言函数消费，会直接 TS6133 报错。

3. **Wave E 防再犯钩子②不在本条实现**：钩子②要做的是把这个「靶子」升级成仓级门禁
   （把「显式白名单重建对象」这类函数扫一遍、并给 `normalizeAgentPromptLayoutDomain`
   补类型层穷举守卫）。本条只交付靶子 + 一条**回归锁**单测（见验收），
   守卫本体与通用化在 `wave-e.md` H2 Step 1 落地。**依赖栏见下。**

### 验收

- `packages/core/test/prompt/normalize-agent-prompt-layout.test.ts` 新增
  `全字段白名单往返` 用例：构造一个**所有可选字段都取「非省略形态」**的
  `AgentPromptLayout`（`system`/`persistEnabled`/`dynamicEnabled`/`workplace`/`customAttach`/
  `skillsEnabled:false`/`skillsPrefix`），断言
  `Object.keys(normalizeAgentPromptLayoutDomain(full)).sort()` 与
  `Object.keys(full).sort()` **逐项相等**。
  ⚠️ **定位（MF-1 修正，不要当 exhaustiveness 护栏看）**：这条是**回归锁**——
  对「把白名单里已有的一条 spread 删掉」有牙（键集合不等，立刻红），
  对「新增一个 `AgentPromptLayout` 字段却忘加白名单」**零牙**（两侧夹具都没有该键，
  依然相等）。
  「新增字段必红」由 **wave-e H2 的类型层守卫**承担（见修法 2），本条不承诺。
  另需一条直接断言
  `normalizeAgentPromptLayoutDomain({...base, skillsEnabled:false}).skillsEnabled === false`
  ——只断言键集相等挡不住「有人把 `skillsEnabled` 改成 `=== true`」这种把 `false`
  过滤掉的错误修法。
- 命令（**core 定向跑必须带这两个 flag**；RULE「Windows 下跑本仓测试的两个假信号」第 ② 条同源）：
  ```
  npx tsx --experimental-test-module-mocks --tsconfig packages/core/tsconfig.test.json --test packages/core/test/prompt/normalize-agent-prompt-layout.test.ts
  ```
  → `# pass` 全部通过。
  ⚠️ **不要用 `npm test -w @novel-master/core -- <file>`**：core 的 test 脚本是
  `bash -O extglob -O globstar -c 'tsx ... --test test/**/!(performance).test.ts'`
  （`packages/core/package.json:121`），npm 追加的参数会落到 `bash -c` 的 `$0` 位置、
  **tsx 收不到**，结果是静默跑全量（不是定向跑）。
- 端到端断言（可选，放同文件 `resolveAgentDefinitionFromStorage` describe 下）：
  域形态 `{name, prompts:{persist:[],dynamic:[],skillsEnabled:false}}` 读回后
  `health.value.prompts.skillsEnabled === false`。

### 测试策略

- 改：`packages/core/test/prompt/normalize-agent-prompt-layout.test.ts`
  （新增 2 条：白名单键集**回归锁** + `skillsEnabled:false` 直断言；
  另补 1 条 `resolveAgentDefinitionFromStorage` 的 round-trip）。
- 不新增测试文件——本条是既有文件的增量。

### 回归线（必须保持绿）

- `packages/core/test/prompt/normalize-agent-prompt-layout.test.ts` 既有 6 条
  （customAttach 透传/缺省/空白/四字段同存 + 2 条 round-trip）——**注意既有 `:26`
  「缺省字段不出现在返回对象上」的省略语义必须保持**：`skillsEnabled: true` 归一后
  依然**不应**出现在对象上（与 `validateAgentPromptLayoutFromMaps` 对齐）。
- schema / wire 往返回归线归到**真实存在的三份**（MF-4 修正：`packages/core/test/domain/agent/`
  目录不存在，旧稿写的 `agent-definition.schema.test.ts` 无处可跑）：
  - `packages/core/test/agent/agent-definition-validate.test.ts`
  - `packages/core/test/prompt/agent-prompt-layout-wire.test.ts`
  - `packages/core/test/prompt/validate-agent-prompt-layout.test.ts`
- 表单侧 omit 语义（MF-4 修正：旧稿把 `:528-535` 安到了测试文件头上，实为 **src** 文件的行号）：
  `packages/core/src/config-forms/agent/agent-editor-state.ts:528-534`
  （`skillsEnabled === false` 的条件省略 + prefix 的省略逻辑）是 omit 语义的**生产实现**，
  **本条不改它**；`packages/core/test/config-forms/agent-editor-state.test.ts`
  一并跑以防连带（⚠️ 该测试文件里**没有** skillsEnabled/skillsPrefix 的 omit 用例，
  实测只在 `:56-64` 命中 `PROMPT_REGION_LABELS`，不要指望它提供牙齿）。

### 依赖

- **Wave E 防再犯钩子② / H2**（`wave-e.md`「白名单完整性」）：本条是它的**真实靶子**。
  按 MF-2 的归属裁定，**单向引用**：钩子②落地时**必须**以本条 §1 验收的回归锁用例为原型，
  但**守卫本体（类型层 `satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>`）
  归 `wave-e.md` H2 Step 1，本条不产出**。
  反之钩子②的通用化若发现仓内还有第二处同类白名单漏字段，属钩子②的账，不回头改本条。
  ⚠️ 实现提示（交 wave-e H2 作者）：`tsconfig.base.json` 开了 `noUnusedLocals: true`，
  该常量若加了却没被同文件的断言函数消费，会直接 TS6133。
  🔗 **已闭合（judge-r1 B5 → R2-11）**：MF-2 要求的两处同步改已完成，落点 `wave-e.md:934`
  「Step 1（wave-e H2 负责，wave-b-core2 交付靶子回归锁用例）」，两侧口径已一致。
- 无其它前置。**不依赖任何拍板项。**

### 风险与回滚

- 风险面：只影响「域形态存量定义」的读回路径（wire 形态走 `assessAgentDefinitionWire` 的
  `decode`，不经本函数）。唯一行为变化是 `skillsEnabled:false` 的 agent 恢复「技能关闭」语义
  ——**这正是修复目标**，但对「误关了技能又以为没关」的用户是可见变化（skill 工具从工具表消失）。
- 回滚：单文件单函数 revert，无数据迁移、无 schema 变更。

---

## 2 · M-06 · SSE `data:` 无空格形态被整流静默丢弃

**严重度 / 簇**：P2（用户可感，Wave B 提前）/ core-misc（infra-llmproto）

### 病症

三个 SSE parser 都用 `line.startsWith("data: ")` 早退。真实网关若发无空格形态
`data:{"choices":[...]}`，**每一行都被静默丢弃**：`recordMalformedSseLine` 一次都不进
⇒ `assertSseParseSucceededOrThrow` 的判据 `blocks.length === 0 && malformedLineCount > 0`
不成立 ⇒ 不抛错、不重试、无日志、无诊断计数 ⇒ run 以「（本次生成无内容输出）」占位、
`completed` 正常收尾。用户看到的是「秒回一条空消息」。CRLF 已被 `slice(6).trim()` 兼容，
**非缺陷**，登记在案免得重复排查。

### 证据（`fe79b781` 亲自核对，三处同款复制）

```ts
// openai-sse-parser.ts:70-73        anthropic-sse-parser.ts:206-209      gemini-sse-parser.ts:199-202
if (!line.startsWith("data: ")) {    if (!line.startsWith("data: ")) {    if (!line.startsWith("data: ")) {
  return;                              return;                              return;
}                                     }                                     }
const payload = line.slice(6).trim(); const payload = line.slice(6).trim(); const payload = line.slice(6).trim();
```
- 断言不咬人：`packages/core/src/infra/llm-protocol/logic/sse-parse-errors.ts:47`
  `if (blocks.length === 0 && diag.malformedLineCount > 0)`；
- 行切分单源：`packages/core/src/infra/llm-protocol/logic/sse-line-buffer.ts:13-25`
  （`feedSseLines`，**当前不含任何 data 行语义**，是抽共享读法的天然落点）；
- 原生侧无第二份解析：全仓 `packages/**/*.kt` grep `data:` **零命中**（mobile native 只做传输），
  ⇒ 本条是 core-only，改三处即全覆盖。

### 修法（文件·函数级）

1. 新增 `packages/core/src/infra/llm-protocol/logic/sse-data-line.ts`，导出
   `parseSseDataLine(line: string): string | null`：非 `data:` 前缀返回 `null`；
   否则返回 `line.slice(5).trim()`（`slice(5)` 覆盖「无空格」与「一个空格」两种形态；
   第二个 payload 字段前的空格由 WHATWG 允许的 `[space]` 语义吃掉，与现有 `.trim()` 行为一致）。
   payload 为空串时返回 `null`（调用方继续早退，保持 `[DONE]`/空行语义不变）。
2. 三个 parser 各自把
   `if (!line.startsWith("data: ")) return; const payload = line.slice(6).trim();`
   换成
   `const payload = parseSseDataLine(line); if (payload == null) return;`
   —— 位置分别在 `openai-sse-parser.ts:70-73`（`feedOpenAiSseChunk` 内）、
   `anthropic-sse-parser.ts:206-209`（`processAnthropicSseLine`）、
   `gemini-sse-parser.ts:199-202`（`processGeminiSseLine`）。
   其余逻辑（`[DONE]` 早退、`recordMalformedSseLine`、JSON.parse）**一字不动**。
 3. **可选加强——【本期不做（OQ6 默认案, judge 已裁可删, 2026-10-02 记）】**（原案备档: 本 PR 建议同 commit 做，但可单独回滚）: 给「非空、既不是 `data:` 也不是
   `event:` / 以 `:` 开头的注释行 / 空行」的行计一个**可选**字段
   `unrecognizedLineCount?: number`，并让 `assertSseParseSucceededOrThrow` 在
   `blocks.length === 0` 时把它也纳入判定。
   ⚠️ **必须是可选字段**：`SseParseDiagnostics` 在测试里被手写成对象字面量
   （`sse-parse-errors.test.ts:27`/`:45`/`:54` 的 `{ malformedLineCount: 0 }`），
   加必填字段会打红 TS2741（RULE「给导出接口加必填字段前先扫手写假实现」）。
   ⚠️ **误报面**：`event:` 行、`:keep-alive` 注释行、空行必须计入「已知形态」不得计未识别；
   且只在 `blocks.length === 0` 时参与判定，正常流不会因此抛错。
   若实现时发现任何网关的合法形态被判成未识别，**只回滚这一小段**，`parseSseDataLine` 保留。
4. **本条不动 `sse-line-buffer.ts` 的任何一行**：不剥 BOM、不改行切分逻辑、不改
   `SseLineBufferState` 的类型谎言、不加 buffer 上限。
   理由：M-10 的 BOM 是同族但属另一件事，M-32（`SseLineBufferState` 的 `readonly` 谎言、
   `buffer` 强转写、只按 `\n` 切行、无 buffer 上限）是**债务池里已立条、独立落点的条目**；
   本条碰了这几行，将来 M-32 落地时必然 hunk 交叠。
   新建 `sse-data-line.ts` 只是把 data 行的**前缀判定与 payload 切片**抽出去，
   `feedSseLines` 仍原样调用。

### 验收

- 三个 parser **各补一组用例、用各家的协议 payload**（MF-5 修正：旧稿三条共用
  OpenAI 形态的 `{"choices":[…]}`，喂给 anthropic/gemini parser 会因 `event.type` / `candidates`
  都不匹配而 `blocks = []`，且因 JSON 解析成功、`malformedLineCount = 0` 而**不抛错**
  ⇒ 断言 `blocks.length === 1` 必红）。前缀统一用**无空格** `data:`：
  | parser | payload（无空格前缀） | 断言 |
  |---|---|---|
  | openai | `data:{"choices":[{"delta":{"content":"Hi"}}]}` | `blocks.length === 1 && blocks[0].text === "Hi"` |
  | anthropic | `data:{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}` | 同上 |
  | gemini | `data:{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}` | 同上 |
  （三家各自的合法 payload 形态可在 `anthropic-sse-parser.test.ts:145` /
  `gemini-sse-parser.test.ts:161` 找到同款先例。）
  **牙齿**：把 `parseSseDataLine` 改回 `startsWith("data: ")` 形态，这三条必红。
- 同时补「有空格形态不回归」一条（喂 `data: {...}`，**同样按三家各自的 payload**，
  断言同样解析成功），防「改成只认无空格」这种反向错修。
- 可选加强段：喂一段只有 `:keep-alive` 与未知字段 `foo: bar` 的流 → 断言
  `finishOpenAiSse` **抛** `ProviderError` code `MALFORMED_SSE`；只喂 `:keep-alive` → 断言**不抛**
  （误报红线）。
- 命令：`npm test -w @novel-master/core` 全绿（三个 parser 文件在
  `test/infra/llm-protocol/` 嵌套目录，**必须用带 `-O globstar` 的全量脚本或显式指名文件**，
  定向裸跑会漏 flag 见 RULE）。

### 测试策略

- 改：`packages/core/test/infra/llm-protocol/openai-sse-parser.test.ts`（+`SSE-DATA-NS-01/02`）
- 改：`packages/core/test/infra/llm-protocol/anthropic-sse-parser.test.ts`（+`SSE-DATA-NS-01/02`）
- 改：`packages/core/test/infra/llm-protocol/gemini-sse-parser.test.ts`（+`SSE-DATA-NS-01/02`）
- 改（仅可选加强段）：`packages/core/test/infra/llm-protocol/sse-parse-errors.test.ts`
- 命名沿用文件内既有前缀（`SSE-MAL-*` 已在三处存在），用 `SSE-DATA-NS-*` 避免撞号。

### 回归线

- 三个 `*-sse-parser.test.ts` 全部既有用例（含 `SSE-MAL-01/02` 的抛/不抛判据）。
- `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`、
  `llm-sse-transport-port.test.ts`、`sse-chunk-emitter.test.ts`
  （整流层与本条正交，但共享 `SseLineBufferState`，改动后必须一起绿）。
- `packages/core/test/infra/llm-protocol/debug-fetch.test.ts`。

### 依赖

- 无前置；**不依赖拍板项**；不依赖 `§6 #8/#9/#10`（协议层另三条）。
- 🔁 **R2 订正：与 `M-01`（本片 §11「重试探针」）是依赖关系，不是「互不相干」**。
  旧稿写「不依赖 M-01」是按「两条改不同文件」下的结论，而 judge-r1 §A.2(b) 把 M-01 补立为实条目后，
  这个结论必须升级成依赖声明，机理三条：
  ① **M-01 的闩锁以「`onStream` 有没有被驱动」为唯一真源**，而本条修的正是「`onStream`
     少驱动了几段」——本条不修，`M-01` 的「已产出」就永远偏晚置位（漏判为未产出 ⇒ 重复重试）；
     本条修好之后被整流丢弃的 chunk 才会真的流到 `onStream`，闩锁才拿得到真值；
  ② **验收判据共用**：`M-01` 的 `T-RR-1` 断言「已产出后不得二次驱动 `onStream`」，与本条验收里的
     「`data:` 前缀形态不再被整流丢弃」必须同时绿——若只跑 M-01 的用例，会把「本条未修 ⇒
     `text-delta` 少发 ⇒ `T-RR-1` 假绿（`seen.length === 1` 因为压根只收到一次）」误判为通过；
     这条假绿只有在本条修好后才会消失，故 **`C2` 必须先于 `C3c` 落地**（§0.1 顺序即依此）；
  ③ **不得倒过来依赖**：本条的修法与验收**不引用** M-01 的任何代码或用例即可独立成立，
     所以它是「M-01 依赖本条」的单向依赖，两条可并行施工、但合入顺序被 ② 钉死。
- 与 wave-c1 的协议三条（`§6 #8` gemini 同名并行、`#9` max_tokens、`#10` thinkingSignature）
  **改的是不同文件的不同函数**，可并行；但若两者同时改 `gemini-sse-parser.ts` 需在
  合入时人工确认 hunk 不交叠（`§6 #8` 改的是 functionCall 归并键 `:122` 一带，本条改 `:199-202`）。

### 风险与回滚

- 风险：`slice(5)` 相对 `slice(6)` 的一字符位移，若某处 payload 前导空格有语义
  （SSE 规范里 `data:` 后**至多一个**空格被当分隔符）——现有代码本来就在 `.trim()`，
  位移不引入新语义。可选加强段是唯一有误报风险的改动，**可独立回滚**。
- 回滚：三处 parser 各一行 + 一个新文件；删新文件 + revert 三处即回到基线。

---

## 3 · `summarizeToolInput` 三处统一（core 单源）

**严重度 / 簇**：P2（纯收敛，但**用户可见行为漂移**）/ core-misc + apps 双端

### 病症

同一条工具调用，三个面渲染出三种结果：desktop 有 `skill` 特判分支、mobile WebView 有 `task`
特判分支、mobile RN 卡片**两个特判都没有**。后果：
① 同一条 `skill` 调用，desktop 显示 `read global:my-skill`，mobile 两个面显示裸 JSON
（RN 面还被 120 字符截断）；② 同一条 `task` 调用，mobile WebView 显示
`@researcher · 调研章节大纲`，desktop 与 mobile RN 显示裸 JSON。
三条渲染路径全部活着（RN `ToolCallCard` / WebView `ToolGroup` / desktop `ToolCallCard`）。

### 证据（`fe79b781` 亲自核对）

```ts
// apps/desktop/renderer/features/chat/message-blocks.ts:178-193（模块私有）
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  // skill 摘要：`action domain:name`；read 缺省域时只展示 action + name
  if (name === "skill") { ... return `${action} ${domain}:${skillName}`; }
```
```ts
// apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts:8-24（已 export）
export function summarizeToolInput(name, input) {
  if (!input) return '';
  // task 工具：展示 @agent · description，比裸 JSON 可读。
  if (name === 'task') { ... return parts.join(' · '); }
```
```ts
// apps/mobile/src/components/chat/message-blocks.ts:277-295（模块私有，两个特判都没有）
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const path = input.path ?? input.dir ?? input.from;
```
- 三份的公共尾巴**语义近似、写法不同**（MF-7 修正：旧稿写「逐字相同」不成立）：
  desktop `:194` 与 mobile RN `:281` 是 `input.path ?? input.dir ?? input.from`，
  **webview `tool-logic.ts:26` 是 `input.path || input.dir || input.from`（`||`，不是 `??`）**。
  ⇒ `{ path: "", dir: "x.md" }` 在 desktop/RN 下 `path` 取到 `""`（`typeof "" === "string"`）
  返回 `""`；在 webview 下 `""` 为 falsy ⇒ 落到 `dir` 返回 `"x.md"`。
  合并成单源时**必须显式选定一种语义**——见修法 1（取 `??`）与验收第 7 条。
  尾巴其余部分三份一致：空键返回 `""` → `JSON.stringify` 120 截断
  （`slice(0,117) + '…'`）→ catch 退 `keys.join(", ")`。
- **WebView 侧可以引 core 的既有先例**：`apps/mobile/src/web/chat-transcript/webview/runtime/render/row-logic.ts:6`
  `import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';`
  ⇒ synth 建议的「参考 `skill-tool-ref.ts` 镜像」是**更保守的旧方案**；直接引 core 已有先例，
  不必再做第四份镜像。

### 修法（文件·函数级）

1. 新增 `packages/core/src/domain/chat/logic/tool-summary.ts`，导出
   `summarizeToolInput(name, input): string`，实现 = **desktop 分支（skill）+ WebView 分支（task）+
   公共尾巴的并集**。入参签名取三份的**并集**：`input: Record<string, unknown> | null | undefined`
   （WebView 侧 `:12` 的签名最宽，其余两份的调用方都传非空，兼容）。
   - 分支顺序：`!input` → `""`；`name === "skill"` → skill 摘要；`name === "task"` → `@agent · desc`；
     再走公共尾巴。
   - **公共尾巴的语义本条显式定死为 `??`**（MF-7 裁定，取 desktop / mobile RN 两份一致的口径）：
     `const path = input.path ?? input.dir ?? input.from;`
     ⚠️ 这与 WebView 现状（`||`）**不同**，取舍是：webview 对空串 `path` 回落 `dir` 的行为
     更像历史偶然，且 `||` 会让「`path` 明确给空串」被静默忽略。单源取 `??` 意味着
     WebView 的摘要在这个形态下会变——**由验收第 7 条把它钉住**，不得静默漂移。
     🔗 **已闭合（judge-r1 B6）：取 `??`**。不保留 WebView 的 `||` 语义，
          故修法 1 与验收第 7 条的期望值维持 `"x.md"`，两端不两可。
2. `packages/core/src/public/chat.ts` 加一行
   `export { summarizeToolInput } from "../domain/chat/logic/tool-summary.js";`
   ⇒ **必须同步** `packages/core/test/package-exports/snapshots/public-chat-allowlist.json`
   加 `"summarizeToolInput"`（该 allowlist 是白名单快照测试，多一个名字即红）。
3. 三处改为引用单源：
   - `apps/desktop/renderer/features/chat/message-blocks.ts`：删本地函数，
     改 `import { summarizeToolInput } from "@novel-master/core/chat";`（desktop 已通过
     `apps/desktop/shared/logic/config-forms-agent.ts` 走 core 公共面，链路现成）。
   - `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts`：
     **必须写成两步**（MF-6 修正）：
     ```ts
     import { summarizeToolInput } from "@novel-master/core/chat";
     export { summarizeToolInput };
     ```
     ⚠️ **不得写成纯 re-export** `export { summarizeToolInput } from "@novel-master/core/chat";`
     ——纯 re-export **不把该符号引入本模块作用域**，而同文件 `:42` 的 `toolCallSummary`
     正在调 `summarizeToolInput(row.name || '', row.input || {})`
     ⇒ 改纯 re-export 后该行直接 TS2304「找不到名称」，`src/web/tsconfig.json` 全红。
     附带说明：`ToolGroup.tsx:5-9` 本来就**不 import** `summarizeToolInput`（只 import
     `toolCallSummary` / `toolStatusClass` / `toolStatusLabel`），这个 `export` 的唯一实际作用
     就是保住 `:42` 的本地引用，**不是对外新增 API**，review 时别误判为扩散。
   - `apps/mobile/src/components/chat/message-blocks.ts`：同 desktop，删本地函数改 import。
4. **三面 UI 会同步变化**（这是本条的目的，不是副作用）：skill 工具在 mobile 两面从裸 JSON
   变成 `read global:xxx`；task 工具在 desktop 与 RN 从裸 JSON 变成 `@agent · desc`。
   提交信息里必须写明这一条，避免 reviewer 误判为回归。

### 验收

- 新增 `packages/core/test/chat/tool-summary.test.ts`（新文件，node:test + assert/strict；
  MF-9 修正：`test/domain/chat/` 目录**不存在**——`test/domain/` 下只有 `feature-labels/` 与
  `format/`，仓内 chat 域逻辑测试的既有约定是 `packages/core/test/chat/`
  （同族的 `skill-tool-ref.test.ts`、`resolve-chat-link-target.test.ts` 都在那儿)）：
  1. `skill` / `read` + `domain:"global"` → `"read global:my-skill"`；
  2. `skill` / `write` + 无 domain → `"write my-skill"`；
  3. `task` + `{subagentName:"researcher", description:" 调研章节大纲 "}` → `"@researcher · 调研章节大纲"`；
  4. `task` + 只给 description → 退化为 description 本身（无前导 ` · `）；
  5. `{path:"a.md"}` → `"a.md"`；`{}` → `""`；`null` → `""`；
  6. 超长 input → 长度 ≤ 118 且以 `…` 结尾（守住 120 截断契约）；
  7. **（MF-7 新增）空串 `path` 的回落语义**：`{path:"", dir:"x.md"}` → 期望 `""`
     （`??` 只判 `null`/`undefined`，空串不算缺失 ⇒ 直接返回空串）。
     这条专门钉住修法 1 选定的 `??` 语义：按 WebView 现状的 `||` 实现，本条会红。
     ⚠️ 期望值**必须是 `""` 而非 `"x.md"`**——单源取 `??`，取舍见修法 1 的注记。
  **牙齿**：删掉 `skill` 或 `task` 任一分支，对应用例立刻红；把 `??` 写回 `||`，第 7 条立刻红。
- 静态断言（放进同文件或 desktop 侧）：`grep -rln "function summarizeToolInput" apps/` 的结果
  **必须为空**（三份副本已消灭）——这是「单源」的机器可验形态。
- 命令（⚠️ MF-8：**必须先重建 core dist**，RULE「改 dist 消费的包必须重建 dist」。
  本条新增了 `@novel-master/core/chat` 的导出，而两端 app 测试都从 core 的 **dist** 解析：
  desktop `package.json:9` 的 `pretest` 只跑 `ensure-test-native.mjs`（better-sqlite3 ABI）、
  **不 build core**，`@novel-master/core/chat` 走 workspace symlink + exports map ⇒ 命中
  `packages/core/dist/public/chat.js`；mobile `jest.config.js:59-62` 把 `^@novel-master/core/chat$`
  显式映射到 `packages/core/dist/public/chat.js`，而裸 `npx jest` **绕过** `pretest`。
  不先重建 ⇒ 两端解析到没有该符号的**旧 dist**，症状是 import 报错或拿到 `undefined`，
  会被误判成本条改坏了）：
  ```
  npm run build -w @novel-master/core
  npm test -w @novel-master/core
  npx jest --maxWorkers=2                                                  # apps/mobile
  node scripts/run-tests.mjs "test/**/*.test.ts" --test-concurrency=2     # apps/desktop
  ```
  （mobile 那条也可写成 `npm test -w @novel-master/mobile` 走 `pretest` 自动 build core。）

### 测试策略

- 新增：`packages/core/test/chat/tool-summary.test.ts`（MF-9 修正落点，见验收）。
- 改（不动断言，只保证不回归）：`apps/desktop/test/message-blocks-read-ref.test.ts`、
  `apps/mobile/__tests__/message-blocks-read-ref.test.ts`（两者都直接断言
  `summarizeToolInput` 链的摘要输出）。
- WebView 侧：`tool-logic.ts` 改了 import ⇒ 必须 `npm run build:webview`
  （webview 资产是三层产物链，Metro reload 碰不到，见 RULE）。

### 回归线

- `apps/desktop/test/message-blocks-read-ref.test.ts`（4+2 条）、
  `apps/mobile/__tests__/message-blocks-read-ref.test.ts`（4 条）——
  它们的 `read 摘要取 input.path` 断言在新单源下**必须仍然绿**（公共尾巴未改）。
- `packages/core/test/package-exports/` 整套 allowlist 快照测试。
- `apps/mobile` typecheck（含 `src/web/tsconfig.json`）—— webview 文件新引 core 会被它类型检查。

### 依赖

- **前置硬依赖：`public-chat-allowlist.json` 必须同 commit 更新**，否则 package-exports 测试红。
- 无拍板项依赖。
- 与 wave-e 的「`tsconfig.test.json` paths 与 exports 对齐」正交（`chat` 的 paths 映射本就正确）。

### 风险与回滚

- 风险 1：core 公共面 +1 个导出 ⇒ 快照测试与「core 纯函数测试缺口」债务池口径受影响（可接受）。
- 风险 2：WebView 首屏包体 +（极小，tool-summary 零依赖纯函数）；必须跑 `build:webview(:native)`。
- 风险 3：三面 UI 文案同步变化（见 4.3），属预期。
- 回滚：三处 import 还原为本地函数即可；core 新文件与 public 导出一并 revert。

---

## 4 · M-03 · `filename` 档与读失败降级把 `1970-01-01` 假时间戳写进常驻提示词

**严重度 / 簇**：P1 / core-misc（workplace 域）

### 病症

两条回填路径把 `mtimeMs: 0` 写进 `file_cache`，`assemble-workplace-display` 原样喂
`renderFileBlock` → `formatLocalMtime(0)` → 提示词里出现 `createdAt="1970-01-01 08:00:00"`：
① `status === "filename"` 档（**双端 UI 的正式选项**，不是边缘路径）直接返回 `mtimeMs: 0`；
② `vfs.read` catch 降级返回 `(missing)` + `mtimeMs: 0`。
入口 ② 尤其恶劣：按 RULE，`file_cache` 命中无条件返回、**无 mtime 校验**，
改写它的只有改规则/压缩/置位/会话删除 ⇒ 一次偶发 SQL 失败就让该 path 在本会话余下所有轮次
都渲染成 `(missing)`。这与同文件 `:145-148`「超大文件占位符不写 file_cache（避免把占位符
粘进缓存）」的既有决策**自相矛盾**。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:209-223
async function readWorkplaceFileBody(path, status, vfs): Promise<FileCachePayload> {
  if (status === "filename") {
    return { body: "", mtimeMs: 0 };                    // ← 入口 A
  }
  try {
    const result = await vfs.read(path);
    return { body: result.content, mtimeMs: result.mtimeMs };
  } catch {
    return { body: "(missing)", mtimeMs: 0 };            // ← 入口 B
  }
}
```
- `:142` `if (deps.status !== "filename")` ⇒ filename 档**完全绕过** `:176-207` 的
  `probeOversizePlaceholder`（该函数 `:206` 已经会把探测带回的 `size.mtimeMs` 传给占位符，
  注释 `:146-147` 明写「mtime 用探测带回的真实值，避免占位块渲染出 1970 假时间戳」）。
- 消费面 `packages/core/src/service/workplace/assemble-workplace-display.ts:173-195`
  （台账记 `:175-187`，实为 `:173-195` 整块，`:191` 是 `mtimeMs: payload.mtimeMs`）；
  渲染 `packages/core/src/domain/workplace/logic/workplace-display.ts:21` `formatLocalMtime` /
  `:81` `createdAt="..."`。

### 修法（文件·函数级）

1. `load-or-fill-file-cache.ts` · `fillFileCacheFromVfs`：把 `probeOversizePlaceholder` 的
   探测提到 `status` 判断**之外**，让 filename 档也拿到 `size.mtimeMs`。
   建议改法：新增一个只取 meta 的薄封装（或让 `probeOversizePlaceholder` 返回
   `{placeholder, mtimeMs}` 而非单值），然后：
   - filename 档：探测到 `size != null` → 用 `size.mtimeMs`；
     探测失败 / `null` → 保持 `0`（**不阻断组装**，与 `:184-185` 既有降级口径一致）。
   - 非 filename 档：占位符分支行为不变（仍返回、不写 cache）。
2. 同文件 · `readWorkplaceFileBody`：filename 分支改为接收上一步的 `mtimeMs`（无探测值时 0）。
3. 同文件 · catch 降级：把 `(missing)` 归入「**不落 cache**」分支——即 `fillFileCacheFromVfs`
   的 `writeBack` 路径对「降级来源的 payload」短路。
   判据建议用**显式标记**而非正文匹配（`(missing)` 可能真出现在文件正文里）：
   catch 分支置 `degraded: true`，`fillFileCacheFromVfs` 里
   `if (filled.degraded === true) { return filled; }`（跳过 writeBack）。
   **载体必须是本模块内的局部类型**，不得加宽共享的 `FileCachePayload`
   （它在 `rule-snapshot-codec.ts` 里被 `assemble-workplace-display` 与序列化/解析共用，
   一旦加进去 `degraded` 就会进入 `serializeFileCachePayload` 的写入面、留下持久类型污染）：
   ```ts
   type FillResult = { payload: FileCachePayload; degraded?: boolean };   // 本模块私有
   ```
   （等价写法 `FileCachePayload & { degraded?: true }` 的本地交叉类型亦可。）
   `fillFileCacheFromVfs` **内部**只在需要判降级处用 `FillResult`，**返回给调用方的仍是
   `FileCachePayload`**（不外泄 `degraded`）。
   更严格的变体：catch 内区分 `NOT_FOUND`（可落库，下轮仍会是 missing）与其它异常（不落库）——
   **推荐前者**（改动面小、语义确定），把后者列为债务池。
4. 顺带修 `load-or-fill-file-cache.ts:41` 的模块注释「filename 不读盘；缺失用 `(missing)` 占位并仍写入 cache」
   —— 第二半句在本条之后不再成立（Wave E「注释承诺 ≠ 实现」的同类，但本条顺手改成本为零）。

### 验收

- 改 `packages/core/test/workplace/load-or-fill-file-cache.test.ts`：
  - **必须修改**既有用例 `filename 档：不探测（原行为，缺失占位空串仍写 cache）`
    —— 它锁的正是本条要改的行为。改为
    `filename 档：探测拿真实 mtimeMs 写入 cache（不再返回 1970）`。
  - 新增 `read 抛错降级：返回 (missing) 但不写 file_cache`。
    **观测面沿用本文件既有的形态**（3 条既有用例都是「读 kkv 断言值」）：
    `assert.equal(await sessionKkv.get("s1", SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full","/note.md")), null)`
    ——「key 不存在」即等价于「没写入」，且不需要碰 SQL。
    ⚠️ **不要去改 `createMemorySessionKkv`**（`test/helpers/prompt-layout-test-helpers.ts`）：
    它**没有 set 计数器**，加计数器会打破本片「不新增测试文件、只改既有文件」的边界。
    若确实想要调用次数作为更硬的牙齿，允许**在本文件内局部包一层代理**：
    `const setCalls = { n: 0 };` 的 `set` 包装层计数后透传，不改共享 helper。
  - 新增 `探测失败时 filename 档仍返回 body ""（不阻断组装）`。
- 改 `packages/core/test/workplace/assemble-workplace-display.test.ts`：
  新增 `filename 档不得渲染 1970 假时间戳`（对照既有 `:459-466` 的同类断言写法）。
  **断言写成 `!block.includes('createdAt="1970')`，而不是「等于某个具体时间」**——
  后者会锁死夹具的 mtime 值，脆且无额外价值。
- 命令：`npm test -w @novel-master/core`（两个文件都在 `test/workplace/`）。

### 测试策略

- 改：`packages/core/test/workplace/load-or-fill-file-cache.test.ts`（1 改 2 增）
- 改：`packages/core/test/workplace/assemble-workplace-display.test.ts`（+1）
- 不新增测试文件。

### 回归线

- `load-or-fill-file-cache.test.ts` 既有 7 条（超限占位不 read 不写 cache、4× 折算闸门、
  未超限走原路径、探测抛错保守回退、探测返回 null、cache 命中不探测不读）——
  **第 4、5 条是本条最可能踩的**：filename 档提前探测后，「探测抛错 / 返回 null」在
  filename 档也必须继续走原路径，不得抛错阻断组装。
- `packages/core/test/workplace/workplace-display.test.ts`、`workplace-eval.test.ts`、
  `prompt/workplace-layout-c0.test.ts`、`prompt/workplace-prompt-ux.test.ts`。
- `packages/core/test/session-kkv/file-cache-*.test.ts`（缓存编解码与 GC，不受本条影响但同域）。

### 依赖

- 无前置；无拍板项依赖。与 M-04/CS-02 等互不相干。

### 风险与回滚

- 风险：filename 档从「零 IO」变成「每文件一条长度 SQL」——这是 W8 pro 实测 3 文件 6M 字符
  hash 127ms + deflate 173ms 那个量级里**最小的一条**（`findContentSize` 不读正文），
  但常驻前缀文件多时仍是 N 条 SQL。若 reviewer 认为不可接受，备选案：
  只在 assemble 侧用规则快照里已有的 mtime 覆盖（synth 的备选），但那条要动 assemble 的
  数据流，改动面更大——**默认案仍取探测**。
- 回滚：单文件 revert（注释改动一并还原）。

---

## 5 · M-04 · 删模型守卫漏扫会话级 `modelId`；「删服务商」整条绕过守卫

**严重度 / 簇**：P1 / core-misc（provider 域）· **量级 M**（见 §0.2）

### 病症

两处同源缺口：

1. `findSavedModelReferences` 扫了 `kkv_entry`（currentModelId）、`agent_definition.model`、
   `chat_project.agent_config_json`，**唯独没扫 `chat_session.agent_config_json`**。
   而会话级 modelId 覆盖恰恰只存在那里（`chat_session` 表**没有** `model_id` 列）。
   ⇒ 会话 A 选模型 M → `deleteSaved` 的 in-use 守卫放行 → M 被删 → 该会话下次开跑在
   `assertSavedModelUuid` 处抛 `Saved model not found`，UI 零解释。
2. 更严重：`provider.service.ts` 的 `delete(provider)` 走
   `savedModels.deleteByProvider(id)` **批量抹掉该 provider 的全部已保存模型，
   完全不经过本守卫**。即便把守卫补全，这条路依然能静默清空被引用的模型。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/domain/provider/logic/find-saved-model-references.ts:66-71
  const projectRows = await queryTemplate<ChatProjectRow>(
    conn, parser, `SELECT id, agent_config_json FROM chat_project`, {}
  );   // ← 全函数到 :93 结束，chat_session 零扫描
```
```ts
// packages/core/src/service/provider/impl/provider.service.ts:240-250
    write.register({
      name: "delete-saved-models",
      execute: async () => { await this.deps.savedModels.deleteByProvider(id); },
      rollback: async () => { for (const m of savedModels) { await this.deps.savedModels.insert(m); } },
    });   // ← 整条路径零 in-use 校验
```
- 守卫唯一调用方 `packages/core/src/service/provider/impl/provider-model.service.ts:168-189`
  （`:173` 调 `findSavedModelReferences`，`:174-180` 抛 `SAVED_MODEL_IN_USE`）；
  `delete(provider)` 内**零调用**（全仓 grep 只有上述一处）。
- 会话覆盖的存储形态：`packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts:165-185`
  读写 `chat_session.agent_config_json`；文档形态
  `packages/core/src/domain/chat/model/session-agent-config.ts` =
  `SessionAgentConfig = { agentId: string; modelId?: string }`；
  DDL `packages/core/src/bootstrap/chat/chat-schema.ts:21`（该表无 `model_id` 列）。
  ⚠️ **注意与会话侧形态不同**：`chat_project` 存的是 `{mode, definition:{model}}`（要在
  `definition` 里再挖一层），`chat_session` 存的是**顶层** `{agentId, modelId}`。
  照抄 `chat_project` 的取值路径会写成永远命不中的代码。

### 修法（文件·函数级）

1. `find-saved-model-references.ts` · `findSavedModelReferences`：在 `chat_project` 扫描之后
   追加一段 `chat_session` 扫描，读 `SELECT id, agent_config_json FROM chat_session`，
   `JSON.parse` 后取**顶层** `modelId`（`typeof === "string" && trim() === savedModelId`），
   命中记 `chat_session:{id}`。
   - 健壮性：`agent_config_json` 可能不是合法 JSON（存量脏数据）——用 try/catch 包住
     `JSON.parse`，单行解析失败 `continue`，**不得让守卫因一条脏数据整体抛错**
     （抛错等于守卫失效，比不扫更糟）。`chat_project` 段当前无此保护，本条顺手对齐。
2. `provider.service.ts` · `delete(id)`：先加**依赖注入**，再加前置拒绝。
   - **第 0 步（依赖注入，不可省）**：`findSavedModelReferences` 的首参是 `TdbcConnection`，
     而 `DefaultProviderServiceDeps`（`provider.service.ts:28-33`）只有
     `providers / suggestions / savedModels / secretStore`，**没有 `conn`**。
     ⇒ 给 deps 增 `readonly conn: TdbcConnection`，工厂
     `create-provider-services.ts:44-49` 传入（与 `:53-60` 给 `DefaultProviderModelService`
     传 `conn` 同款；工厂侧 `conn` 已在手），并同步 `provider-service.test.ts:211` 的
     直接 `new DefaultProviderService(...)`。
     ⚠️ **不得改走 `providerModels` 注入**：`ProviderModelService` 已持有 `providers`，
     反向注入会成循环 import。这三处施工点就是本条越过「零结构变更」门槛的实体内容
     （§0.2 量级裁定的事实依据之一）。
   - **第 1 步（前置拒绝）**：在 `write.register` 之前，对该 provider 下每个 savedModel 调
     `findSavedModelReferences(this.deps.conn, …)`，任一有引用即抛
     `new ProviderError("SAVED_MODEL_IN_USE", …)`，并在 details 里带 `providerId`
     （`ProviderError` 已有 `providerId` 字段）。
     **写死复用 `SAVED_MODEL_IN_USE`、不新造 `PROVIDER_IN_USE`**：`provider-errors.ts:8-23`
     的码表里**没有** `PROVIDER_IN_USE`（写了会 TS 编译不过或诱使 impl 试错）；而
     `formatIpcError` 对 `ProviderError` 是按 `instanceof` 类分派后**原样透传 `err.code`**，
     `apps/desktop/src` 全量 grep `SAVED_MODEL_IN_USE` **零命中** ⇒ **没有需要同步的映射表**。
     新造码不会「要改映射」，但会让前端拿不到已处理的文案，属净损失。
   - 这一步放在 `CoordinatedWrite` **之外**（前置拒绝，不进事务、不需要 rollback 分支），
     是本条唯一的结构决策：**拒绝发生在任何删除动作之前**，因此不破坏现有五步
     `CoordinatedWrite` 的 rollback 配对。

### 验收

- 改 `packages/core/test/provider/provider-model.service.test.ts` 的
  `describe("ProviderModelService deleteSaved（T-SM8）")`（`:267-325`），
  **照抄既有 `chat_project` 那条（`:303-324`）的形状**新增一条
  `chat_session.agent_config_json.modelId 引用时拒绝删除`：
  建会话 → `ctx.sessions.updateSessionAgentConfig(sessionId, {agentId, modelId: saved.id})`
  → 断言 `deleteSaved` 抛 `SAVED_MODEL_IN_USE`。
- 改 `packages/core/test/provider/provider-service.test.ts`：新增
  `delete provider 时其下被会话引用的 saved model 拒绝删除（不静默清空）`：
  建 provider（非内置）→ 建 saved model → 会话引用它 → 断言 `providers.delete(id)` 抛
  `SAVED_MODEL_IN_USE` **且 `bundle.providerModels.savedList(id)` 仍返回该模型**
  （证明没有「抛错但已删」的半套）。
  ⚠️ **服务层没有 `listByProvider`**：`ProviderModelService` 的公开方法实测只有
  `suggestList / fetch / save / create / savedList / editSaved / deleteSaved /
  updateSettings / resetContextWindowToDefault / getSavedById / getContextWindow /
  getTokenCounterMode`；`listByProvider` 只存在于 repository 层，**照抄会编译失败**。
  用 `savedList(id)`（`:127` 既有方法）。
- 命令：`npm test -w @novel-master/core`。

### 测试策略

- 改：`packages/core/test/provider/provider-model.service.test.ts`（+1）
- 改：`packages/core/test/provider/provider-service.test.ts`（+1）
- 另建议补一条脏数据用例：`chat_session.agent_config_json = '{坏 JSON'` 时
  `deleteSaved` 仍能删掉无引用模型（证明新扫描不会因脏行整体失败）。

### 回归线

- `provider-model.service.test.ts` 全部既有用例（尤其 `deleteSaved（T-SM8）` 的三条 +
  multi-preset / editSaved 组）。
- `provider-service.test.ts` 全部（`delete custom provider removes secret ref`、
  `delete removes secret at default ref when secretRef is null`、`BUILTIN_PROVIDER` 拒绝）。
  ⚠️ **既有这两条 delete 成功用例是本条最大的回归风险面**：它们创建的 provider 下
  是否有 saved model 被引用，决定新前置拒绝会不会把它们拦下来。实现时若发现既有用例变红，
  **先确认是不是夹具真的造出了引用**，不要直接放宽守卫。
- `packages/core/test/provider/sqlite-provider.repository.test.ts`。

### 依赖

- 无前置；无拍板项依赖。
- 与 wave-e 钩子⑤「`findSavedModelReferences` 补 `chat_session` 端到端回归」**是同一条**：
  本条的测试策略已经交付了那半个回归用例，wave-e 只保留「若本条未先行落地则补」的兜底，
  **不得重复立条**。⚠️ **落地后的收敛动作**：本条一旦落地，wave-e `wave-e.md:1210/1638`
  留下的那条 `test.todo` 占位用例应删除、改为**引用本片 §5 的用例**，避免两片各留一条。

### 风险与回滚

- 风险 1（最高）：`delete(provider)` 新增前置拒绝后，**存量用户删不掉服务商**——
  只要它下面有一个模型被任意会话/agent 引用就报错。这是有意的正确行为，但会从
  「静默清空」变成「删不掉」，是可见的产品行为变化。备选案：提供 `force` 参数跳过检查
  （**不推荐**，会绕过守卫的意义）。
- 风险 2：多 provider 大批量删除时守卫是 N+1 次 `chat_session` 全表扫描。
  默认案接受（删除是低频操作）；若 reviewer 要求优化，先加索引/按 providerId 过滤，
  不在本条范围。
- 回滚：两处独立改动，可分别 revert。

---

## 6 · CS-02 · `edit` / `skill edit` 的 `oldString` 允许空串

**严重度 / 簇**：P1 / core-storage（vfs + tool）

### 病症

`oldString` 为空串时两处行为都很坏：
① 单次替换路径 `indexOf("")` 恒返回 `0` ⇒ 在文件开头「命中」，把 `newString` 插到最前面并
报 `replacements: 1` 的**假成功**（用户以为改了，其实在开头插了一段垃圾）；
② `replaceAll` 路径更糟——`indexOf("", searchFrom)` 恒等于 `searchFrom`，且
`searchFrom = idx + normalizedOld.length` 永远回到同一个值 ⇒ **`while (true)` 死循环、
`positions` 数组无限膨胀**（OOM/挂死）。
两个入口的 zod 都不拦：`vfs-tools` 的 `oldString` 是裸 `z.string()`，
`skill-tool` 的 `oldString` 是 `z.string().optional()`。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/domain/vfs/logic/compute-replace-result.ts:53-64
    let searchFrom = 0;
    while (true) {
      const idx = normalizedContent.indexOf(normalizedOld, searchFrom);
      if (idx === -1) break;
      positions.push({ start: idx, end: idx + oldString.length });
      searchFrom = idx + normalizedOld.length;      // ← oldString 为空 ⇒ searchFrom 恒定 ⇒ 死循环
    }
```
```ts
// 同文件 :76-79
  const index = normalizedContent.indexOf(normalizedOld);
  if (index === -1) { throw buildReplaceNotFoundError(path, currentContent, oldString); }
  // ← oldString 为空 ⇒ index === 0 ⇒ 假成功
```
```ts
// packages/core/src/domain/tool/builtin/vfs-tools.ts:339-343（入口 1）
      oldString: z.string().describe("要被替换的原文；须在文件中唯一定位（replaceAll 时除外）。…"),
// packages/core/src/domain/tool/builtin/skill-tool.ts:341（入口 2）
    oldString: z.string().optional().describe("edit 动作的匹配串"),
```
（台账记 `compute-replace-result.ts:53-60`，实为 `:53-64`；入口数 2 已复核成立。）

### 修法（文件·函数级）

1. **纯函数层先兜底**（真源，三条调用路径都受益）：
   `compute-replace-result.ts` · `computeReplaceResult` 在函数体最前面加
   `if (oldString.length === 0) throw buildReplaceNotFoundError(path, currentContent, oldString);`
   —— 复用既有的 `vfsReplaceNotFound` 错误（台账指定的错误口径），**不新造错误码**。
   放在 `normalizeForMatch` 之后或之前都可（空串归一后仍是空串）。
2. `vfs-tools.ts:339-343` · `edit` 工具 `inputSchema`：`z.string()` → `z.string().min(1)`，
   并在 `describe` 里补一句「不得为空串」（`.min(1)` 的默认报错是英文，UI 会把它翻给用户看，
   描述里给中文语义更稳）。
3. `skill-tool.ts:341` · `skill` 工具 `inputSchema`：`z.string().optional()` →
   `z.string().min(1).optional()`（**optional 保持不变**——`action !== "edit"` 时不该要求它）。
4. 两层都要：zod 层给模型友好的报错（工具调用直接返回校验错误给 LLM），
   纯函数层给「未来新增不经 zod 的调用方」兜底。只改一层就是半修。

### 验收

- 改 `packages/core/test/vfs/compute-replace-result.test.ts`：
  新增 `oldString 为空串：抛 REPLACE_NOT_FOUND（不得假成功）`（单次路径）与
  `oldString 为空串 + replaceAll：抛错且不死循环`。
  **第二条必须带超时保护**：`assert.throws(() => computeReplaceResult(p, "abc", "", "X", {replaceAll:true}))`
  在测试超时内返回即通过；死循环实现会让这条**超时失败**（而不是断言失败），这正是我们要的牙齿。
  **牙齿**：删掉第 1 步的守卫，两条用例一条红（假成功）一条挂死（超时）。
- 工具 schema 层：补一条 zod 直测（若既有工具 schema 测试文件存在则加进去，
  否则在 `packages/core/test/domain/tool/` 下随本次新增），断言
  `editSchema.parse({path:"a", oldString:"", newString:"x"})` 抛 zod 错误，
  且 `skillSchema.parse({action:"list", oldString:""})` 也抛（因为给了就必须非空），
  `skillSchema.parse({action:"list"})` 仍通过。

### 测试策略

- 改：`packages/core/test/vfs/compute-replace-result.test.ts`（+2）
- 改：`packages/core/test/tool/vfs-tools.test.ts`（+1）、`packages/core/test/tool/skill-tool.test.ts`（+1）
  ——**目录以此为准**（`test/domain/tool/` 不存在，既有宿主在 `test/tool/`；
  验收栏「若既有工具 schema 测试文件存在则加进去」与本栏以此为准，两栏同口径）
- 不新增测试文件。

### 回归线

- `compute-replace-result.test.ts` 全部既有用例（T-B2-01~08 + replaceAll 组 4 条）——
  ⚠️ 特别确认没有既有用例**依赖**空串行为（本机核对：没有）。
- `packages/core/test/vfs/compute-replace-not-found-error.test.ts`（错误构造不变）。
- `edit` / `skill` 工具的既有用例（`packages/core/test/tool/` 或 `domain/tool/` 下）
  —— zod 收紧可能打红任何传了空串的既有夹具，实现时若红，先确认夹具是不是在测「空串合法」
  （那才是真回归）。
- RULE 铁律「edit 工具 replaceAll 路径严禁用 split/join」——本条不触碰拼接逻辑，
  但 review 时确认 diff 里没混入 `split/join`。

### 依赖

- 无前置；无拍板项依赖。
- 与 CS-03（`longest-common-substring`）同文件族但不同文件，wave-c2 可并行。

### 风险与回滚

- 风险：极低。唯一行为变化是「空串 oldString」从「假成功 / 死循环」变成「明确的未命中错误」。
  唯一风险面是模型侧行为变化——某些模型可能习惯性传空串，改后会拿到错误而不是静默坏结果，
  **这是期望的**（错误信息可读，模型能自我纠正）。
- 回滚：三处独立小改，可分别 revert。

---

## 7 · CS-07 · blob ref_count DELETE 触发器不感知 `vfs_entry` 引用（纵深防御）

**严重度 / 簇**：P1 / core-storage（vfs blob 层）· **合入时点受 CS-06 约束**

### 谱系（sr1-core2-c §1.3 裁定）

ledger §2.4 里 **CS-07 只有一条**（`ledger-v2.md:124`，`bootstrap/vfs/vfs-revision-schema.ts:44-54`）。
所谓「出现两次」发生在**另一层**——§10 波次提案表里同一 ID 被 Wave B（`:457`，塞进
「全部量级 S、零结构变更」的 P1-S 批次）与 Wave C（`:465`，放进事务边界收窄格并带顺序依赖）
各自列举，两处分片的作者都没编造条目，但各自替台账做了归一裁决且**方向相反**。

**本片 §7 为 CS-07 的权威条目**（sr1-core2-c §1.3 裁定：存量库生效机制推导经实测正确、
依赖栏与 §0.3/§12.2 前后自洽、回归线 8 个文件实测全在）；**wave-c2 的 C2-5 已注记化**
（七要素删除、只留一条交叉引用）。其中三样东西按裁定**上收**进本节：

| 上收项 | 落点 |
|---|---|
| ① **UPDATE 触发器一并修**——`UPDATE OF content_hash` 场景 DELETE 触发器根本不会被触发，「同款兜底」推理不成立 | 修法 2 |
| ② **「触发器改名是更廉价的存量库机制」这条纪律**——比指纹对齐更廉价、可作第二道锁（但**单靠改名不够**），与指纹对齐叠加更稳 | 修法 3.3 |
| ③ **测试落点并入既有** `packages/core/test/vfs/vfs-gc-trigger.test.ts`（该文件就是这个触发器的现归属），删掉新文件方案 | 测试策略 |

### 病症

`vfs_content_blob.ref_count` **只由 revision 触发器维护**，而 `vfs_entry.content_hash`
这一路引用对触发器**完全不可见**。只要存在「entry 有 content_hash 但没有对应 revision 行」
的状态（CS-06 造的），该 blob 的 `ref_count` 就常年为 0；此时**任何**一条引用同 hash 的
revision 被删，触发器的归零判定就把 blob 行删掉 ⇒ 共享该 hash 的另一条 entry
`read` 抛「vfs_content_blob 缺失」，**文件永久不可读，只能重新导入**。
内容寻址让同 hash 共享极可能（RULE 实测去重省 61.3%）。
`decoded-content-cache` 的 LRU 会在同进程内掩盖（热态静默成功）⇒ **重启后才暴露**。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:44-54
export const VFS_REVISION_DELETE_TRIGGER_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_revision_delete_dec_blob_ref
AFTER DELETE ON vfs_revision
WHEN OLD.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count - 1 WHERE content_hash = OLD.content_hash;
  DELETE FROM vfs_content_blob WHERE content_hash = OLD.content_hash AND ref_count <= 0;
END`.trim();     // ← 归零判定无 AND NOT EXISTS (... FROM vfs_entry ...)
```
- 同文件 `:57-68` 的 **UPDATE 触发器有一处逐字同款的归零删除**（`:64-65`）：
  ```sql
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL;
  ```
  `UPDATE OF content_hash` 时旧 hash 走的是**这段** DELETE，DELETE 触发器不会被触发
  ⇒ 「DELETE 触发器同款兜底」推理**不成立**，本条必须两个触发器一起修（见修法 2）。
- bootstrap 生效面：`packages/core/src/bootstrap/novel-master-bootstrap.ts:345-374`
  —— `:351` `if (bootVersion >= SCHEMA_BOOT_VERSION)` ⇒ `:353-357` 快路径直接 return；
  `:360-362` 的 `NOVEL_MASTER_SCHEMA_STATEMENTS` 与 `:365` 的 `alignSchemaColumns` **同在慢路径**。
  触发器 DDL 的唯一装配点就是 `NOVEL_MASTER_SCHEMA_STATEMENTS`（`:125` 处
  `...VFS_REVISION_SCHEMA_STATEMENTS`），全仓 grep `trg_revision_delete_dec_blob_ref` 只命中
  `vfs-revision-schema.ts` / `novel-master-bootstrap.ts` / `test/vfs/vfs-gc-trigger.test.ts`，
  **没有任何无条件执行段** ⇒ 只改 DDL 常量本体对 `user_version >= 17` 的存量库一律零效果。
  （对照先例：索引 `idx_chat_message_pending_blob` 确实被放在 `:394-400` 的事务外无条件段，
  本仓知道这个手法，只是触发器没用上。）
- 触发条件来源（Wave C）：`packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:100-101`
  `// 无 revision 层：不写 vfs_revision 行，head + 1 不会撞唯一键，维持现状语义`
  `await repo.update(sk, logical, content, existing.version + 1);`（= CS-06，wave-c2）。

### 修法（文件·函数级）

> 本节已按 sr1-core2-c 的裁定收敛为**唯一可执行路线**：两个触发器一起修；
> 存量库重建走 bootstrap 指纹对齐 + bump `SCHEMA_BOOT_VERSION`，并叠加触发器改名。
> **impl 不再需要在本条内做任何路线决策。**

1. `vfs-revision-schema.ts` · `VFS_REVISION_DELETE_TRIGGER_DDL`：`DELETE FROM vfs_content_blob`
   的 WHERE 追加
   `AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)`。
2. `vfs-revision-schema.ts` · `VFS_REVISION_UPDATE_TRIGGER_DDL`（`:57-68`）：`:64-65` 的归零删除
   追加**同一条** `AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)`。
   **必改，不可省**：`UPDATE OF content_hash` 时旧 hash 走的是这段 DELETE，
   修法 1 的 DELETE 触发器在这条路径上根本不会被触发。
3. **存量库生效机制 = 唯一案（bootstrap 指纹对齐 + bump `SCHEMA_BOOT_VERSION` + 触发器改名叠加）。**

   3.1 **为什么是「指纹对齐」**：触发器是 canonical DDL 的一部分（`:78-83` 的
      `VFS_REVISION_SCHEMA_STATEMENTS`），注释 `:70-77` 说明「旧库由已退役的 migration 创建、
      现已并入 canonical DDL」。⇒ **`CREATE TRIGGER IF NOT EXISTS` 对存量库不会重建已存在的
      触发器**：存量用户库里跑完 bootstrap 后触发器**仍是旧的**。而本仓有 RULE
      「`schema_migrations` 只登记不搬运」与「退役迁移节奏」两条约束，
      新开一条 migration 的成本与将来退役的债都更高，而触发器重建**幂等且无数据搬运**。
      做法：在 bootstrap 的对齐段（`alignSchemaColumns` 一类的地方）加一条
      「触发器指纹对齐」——比对 `sqlite_master.sql` 里该触发器的定义，不一致则 drop + recreate。

   3.2 **必须同时 bump `SCHEMA_BOOT_VERSION`**：`:360-362` 的 DDL 数组与 `:365` 的
      `alignSchemaColumns` **同在慢路径**，而 `:351` 的 `if (bootVersion >= SCHEMA_BOOT_VERSION)`
      让 `user_version >= 17` 的存量库在 `:353-357` 直接 return ⇒ 不 bump 版本则新加的
      对齐语句**永远补不上**（RULE「加 align 条目不 bump 版本则永远补不上」）。
      ⚠️ 触发器改名**不能替代 bump**：改名只解决「同名 `IF NOT EXISTS` 不重建」，
      不解决「快路径压根不执行 DDL 数组」。

   3.3 **叠加「触发器改名」这条纪律**（上收自 wave-c2 C2-5）：把两个触发器改名成带版本后缀的
      新名（如 `trg_revision_delete_dec_blob_ref_v2` / `trg_revision_update_dec_blob_ref_v2`），
      并在 DDL 常量里 `DROP TRIGGER IF EXISTS <旧名>;` + CREATE 新名。
      它比指纹比对更廉价、可作第二道锁，与 3.1 的指纹对齐叠加更稳（指纹比对能覆盖
      「同名下定义漂移」，改名能覆盖「同名下判定逻辑换了一整类」）。
      **但改名单独不够**，3.1 与 3.2 仍必须做。

   3.4 **工作量说明（须写进 PR 正文）**：3.1 的指纹对齐**仓库无既有实现**——
      `sqlite_master` 全仓仅出现在 bootstrap 的 8 处 + 1 条 migration 的建表 SQL 探测，
      `alignSchemaColumns` 现有的对齐对象是**列**、不是触发器 ⇒ 这条对齐机制**须新造**
      （比对 + drop + recreate 三步），不能假称「加一行对齐项」。这是本条的实际成本所在，
      PR 描述里必须承认，别让 reviewer 按「复用既有对齐」估工。

   3.5 **存量库生效的硬约束（sr1-c2-b 两个 P0，并入本节为验收前提）**

   核心一句话：**「建了新名」不等于「旧名失效」。** SQLite 的触发器不是「代码不再引用
   就不存在」的东西——`CREATE TRIGGER IF NOT EXISTS <新名>` 只保证**新名**存在；旧名
   `trg_revision_delete_dec_blob_ref` 在存量库里**仍然注册着、仍然在每次
   `DELETE FROM vfs_revision` 时触发**，照样执行没有守卫的
   `DELETE FROM vfs_content_blob ... WHERE ref_count <= 0`。
   ⇒ 即使 bump 了版本，守卫依然被旧触发器旁路，**CS-07 在存量库上照样复发**。
   由这条推出两个不可省的子动作（无论走默认案②还是任何改名方案都一样）：

   - **子动作一（实现侧 · DROP + CREATE，不是叠加）**：3.1 的指纹对齐一旦检测到
     **旧名**触发器（存在但定义与 canonical 不符），动作必须是
     「`DROP TRIGGER <旧名>` + `CREATE TRIGGER <新定义>`」；也可以整组两个触发器
     DROP + CREATE。**不是、也不允许**只补一条 `CREATE IF NOT EXISTS <新名>` 把新触发器
     叠上去——那样旧触发器与新触发器会**同时注册**、同时对同一次 DELETE 归零，
     旧那条照样把 blob 删掉。
   - **子动作二（验收侧 · 直接查旧名不存在）**：验收必须有一条**直接查 `sqlite_master`**
     的断言，见下方验收第 3 条。**只断言「新名触发器已建」不构成任何修复证据**，
     因为旧代码里那个断言同样成立。

   ⚠️ 连带一条禁用写法：「旧名触发器仍在、新名触发器已建；行为断言 E1 成立」
   这三条在逻辑上**不可能同时成立**（旧名在位 ⇒ blob 照样被删 ⇒ E1 必红）。
   本节及 wave-c2 的 C2-5 都不得再出现这种表述。

   3.6 **备选注记（pending schema migration 方案 · 仅在 3.1–3.3 实施代价超预期时启用）**

   若默认案②的指纹对齐新造机制代价超预期，可退回 pending schema migration 路线：
   新增一条 `vfs-revision-blob-guard-v1`，`up` 内
   `DROP TRIGGER IF EXISTS <旧名>` + `CREATE TRIGGER <新名>`，登记进
   `packages/core/src/bootstrap/schema-migrations/index.ts` 的 `SCHEMA_MIGRATIONS`。
   依据（sr1-c2-b 已实测）：`runPendingSchemaMigrations` 在**快路径与慢路径都会跑**，
      所以存量库与新建库都能升到；且 **DDL 不是数据搬运**，不违反「migration 只登记不搬运」
   的仓内口径。详见 `raw/sr1-c2-b.md` §4 第 1 条。
   ⚠️ **两案择一后另一案删**——不要两条并存，也不要让 impl 在执行期临时改路线；
   选 migration 案时 3.2 的 bump 可免（但 3.5 子动作一的 DROP + CREATE 与子动作二的
   验收断言**仍然必须成立**，那不是 DDL 路线独有的要求）。

4. 同步在 `packages/core/src/bootstrap/` 的对齐段补一条断言/测试：
   「bootstrap 后 `sqlite_master` 中**两个**触发器 SQL 都含
   `NOT EXISTS (SELECT 1 FROM vfs_entry`」（含旧名已被 DROP）。

### 验收

- 改既有文件 `packages/core/test/vfs/vfs-gc-trigger.test.ts`（实测存在，214 行，
  `T-G1: sweep 删除 revision → 触发器自动回收 orphan blob` / `T-G2: …` 等就是
  **这个 DELETE 触发器的现归属**），在同文件内补三条：
  1. **行为断言（牙齿所在）**：造「entry 引用 hash H、`vfs_revision` 无 H 的行、blob H 的
     `ref_count = 0`」的状态（可直接 INSERT 造，不必经 CS-06 的写路径）→ 删一条
     `content_hash = H` 的 revision → 断言
     `SELECT COUNT(*) FROM vfs_content_blob WHERE content_hash = ?` **仍为 1**。
     旧触发器下这条**必红**（blob 被删）。
     **UPDATE 触发器路径同款一条**：`UPDATE vfs_revision SET content_hash = <另一个 hash>`
     把那条「只有 entry 引用、无 revision 行支撑」的旧 hash 换走 → 断言旧 hash 的 blob 行
     **仍在**。只测 DELETE 触发器漏掉的那半个触发面。
  2. **不回归断言**：`ref_count` 归零且 `vfs_entry` **无**任何行引用 H 时，blob 仍被删
     （`COUNT(*) === 0`）——防「把守卫写得太宽导致 blob 永不回收」这个反向错修。
  3. **bootstrap 对齐断言**：新建库 → 跑 bootstrap → 从 `sqlite_master` 读**两个**触发器的
     SQL，断言都含 `NOT EXISTS (SELECT 1 FROM vfs_entry`；再手工塞一条旧定义触发器后重跑
     bootstrap，断言已被替换。
     **这条必须显式断言「旧名已不存在」**，写法即修法 3.5 子动作二：
     ```sql
     SELECT name FROM sqlite_master WHERE type='trigger'
       AND name IN ('trg_revision_delete_dec_blob_ref',
                    'trg_revision_update_dec_blob_ref');   -- 断言结果为空
     ```
     **牙齿**：只实现 `CREATE IF NOT EXISTS <新名>` 叠加、没做 DROP 旧名时，这条必红
     （旧名仍在库里且仍会触发），而「新名已建」与「行为断言成立」两条都照样通过——
     所以这条断言是本条**唯一**能拦住该 P0 的牙齿，不可省、不可用「新名在位」代替。
     ⚠️ 这条**只能在走慢路径的库里验**（新建库 / 已 bump 版本的库）。它验的是「对齐段本身
     能重建」，不是「存量库会自动进对齐段」——后者只能靠 3.2 的 bump 保证，写不进单测。
- 命令：`npm test -w @novel-master/core`（全量）。

### 测试策略

- 改：`packages/core/test/vfs/vfs-gc-trigger.test.ts`（+3，含 UPDATE 路径与 bootstrap 对齐）。
  **不新增文件**——两个新文件路径并存会把同一触发器的守卫拆成两处，后续改触发器的人极易漏改一边。
  （既有的 `vfs/orphan-revision-gc.test.ts` / `revision-ref-count.test.ts` 覆盖的是
  GC 与 ref_count 期望值，**不覆盖触发器 SQL 本体**，所以守卫断言要加在**既有归属文件内**，
  而不是新开一个。）

### 回归线

- `packages/core/test/vfs/orphan-revision-gc.test.ts`
- `packages/core/test/vfs/revision-ref-count.test.ts`
- `packages/core/test/message-checkpoint/revision-gc.test.ts`、
  `rollback-revision-backfill.test.ts`、`deferred-revision-orphan-gc.test.ts`
- `packages/core/test/session-kkv/deferred-file-cache-gc.test.ts`（file_cache blob GC 与
  vfs blob GC 是两套，但共享「归零即删」的心智模型）
- `packages/core/test/bootstrap/file-cache-schema.test.ts`（DDL 面）
- **bootstrap 全套**：`packages/core/test/bootstrap/bootstrap-no-migrate.test.ts` —— 本条**不会**打红它。
  实测该文件对 `TRIGGER` / `vfs` / `SCHEMA_STATEMENTS` **零引用**，全仓亦无任何测试快照
  `VFS_REVISION_SCHEMA_STATEMENTS`（唯一引用者只有 `novel-master-bootstrap.ts` 自身与
  `vfs-gc-trigger.test.ts`）⇒ **不需要**为它补任何清单。仍要跑，只是作为 bootstrap 快慢路径的
  常规回归，不是「可能被打红」的预警项。

### 依赖

- **硬依赖：CS-06（wave-c2）必须先合入。** 见 §0.3。
- CS-12（`copyVfsTree` overlay）是 P2、不在任何 Wave ⇒ 本条修完后**仍有触发面残留**，
  已在风险栏声明，不阻塞。
- 无拍板项依赖。

### 风险与回滚

- 风险 1（正向）：守卫生效后，某些「entry 引用但无 revision」的 blob **不再被回收**
  ⇒ 存储缓慢增长。这是有意的保守方向（宁可留垃圾不可丢数据）。
- 风险 2：走 bootstrap 对齐会动 bootstrap 路径，触发面比其他条目宽，须跑 bootstrap 全套 +
  慢路径/快路径两条。存量库 `user_version` 高 ⇒ 旧版本下快路径直接跳过 DDL，
  正是 RULE「加 align 条目不 bump 版本则永远补不上」描述的陷阱——
  本条已把 `SCHEMA_BOOT_VERSION` 的 bump **写死进修法 3.2**，不再是可选分支。
  ⚠️ bump 后所有存量库会走一次慢路径（`:360-365` 重放 DDL + 对齐），首次启动会变慢，
  这是有意的一次性代价。
- 风险 3（指纹对齐是新造的）：`sqlite_master` 指纹比对机制仓库里**没有既有实现**，
  比对口径（整串 SQL 逐字比 vs 归一化后比 vs 只比关键子串）会影响「改了触发器却判成没改」
  或「没改却每次重建」。建议比对**归一化空白后的整串 SQL**，宁可多重建也不漏重建
  （重建是幂等的）。此口径须写进 PR 正文供 reviewer 核。
- 回滚：**恢复旧触发器定义**——`DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref_v2` /
  `trg_revision_update_dec_blob_ref_v2`（新名若已建，**必须一并 DROP**，
  否则新旧两条会同时注册、旧定义继续按无守卫判定删除 blob），再以**旧名**重建两个触发器，
  并 revert DDL 常量与对齐段；
  `SCHEMA_BOOT_VERSION` 的 bump 如需回退，同步回退版本号（存量库会再走一次慢路径，安全）。
  ⚠️ 触发器没有「代码不再引用就自动消失」这回事，回滚必须显式写清「DROP 新名 + 重建旧名」
  这两步，不能只 revert 代码了事（sr1-c2-b 指出的原错误表述「旧触发器仍在库中但不再被使用」
  已删除：那个状态在 SQLite 里不存在）。

---

## 8 · CS-08 · 批量导出单文件分支不走 `exportRelativePath`，同名文件被静默丢弃

**严重度 / 簇**：P1 / core-storage（vfs 导出）

### 病症

`planBatchExport` 的「选中项本身是文件」分支用 `basenameOf(logical)` 取相对路径，
而目录分支用 `exportRelativePath(...)`。桌面端多选导出 `/卷一/第一章.md` 与 `/卷二/第一章.md`
时，两条都算出 `第一章.md`，第二条被 `seenFileRels` **静默丢弃** ⇒
**导出 ZIP 里少一个文件，且 `files`/`mkdirPaths` 之外无 `skipped`、无 `failed`、UI 零提示**。
中文工程「同名卷章」极常见，这是静默丢用户数据。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/service/vfs/impl/vfs-batch-io.service.ts:399-406
      if (existing != null && existing.entryKind === "file") {
        const fileRel = basenameOf(logical);          // ← 病灶：拍平后的 basename
        if (fileRel.length > 0 && !seenFileRels.has(fileRel)) { … }   // ← 同名者在此静默丢
        continue;
      }
// 对照目录分支 :412 与 :426  →  exportRelativePath(childLogical, logical, selectionCount)
```
- `exportRelativePath` 本体在同文件 `:164-178`；`basenameOf` 在 `:153-159`。
- `BatchExportPlan` 定义 `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts:76-80`
  （**只有 `files` 与 `mkdirPaths` 两个字段，没有任何跳过通道**），
  且经 `packages/core/src/public/vfs.ts:52` 对外导出。
- 唯一消费方 `apps/desktop/src/main/services/vfs-batch.service.ts:280-293`
  （`stageVfsBatchExport`，`:291` 只判「全空则抛『导出内容为空』」，对部分丢失无感）。

### 修法（文件·函数级）

⚠️ **本条有一个必须避开的陷阱**：不能把 `basenameOf(logical)` 直接换成
`exportRelativePath(logical, logical, selectionCount)`。因为
`relativePathUnderAnchor(p, p)` 按定义返回**空串**
（`domain/vfs/logic/vfs-batch-path.ts:72-74` 的 `if (path === root) return "";`），
而调用方 `:413` 有 `if (rel.length === 0 || …) continue;`
⇒ **单选一个文件会被整个丢掉**（比现状更坏）。

正确修法：**文件分支以「选中文件的父目录」为锚点**。

1. `vfs-batch-io.service.ts` 文件分支（`:399-406`）：
   ```ts
   const parent = parentLogicalOf(logical);        // 本文件新增私有 helper
   const fileRel = exportRelativePath(logical, parent, selectionCount);
   ```
   - `parentLogicalOf`：`const i = path.lastIndexOf("/"); return i <= 0 ? "/" : path.slice(0, i);`
   - 语义核对：`/卷一/第一章.md` + 父 `/卷一` →
     单选得 `第一章.md`（与现状一致）✓；多选得 `卷一/第一章.md` ✓（与目录分支同款）✓。
2. `vfs-batch-io.port.ts` · `BatchExportPlan` 增**可选**字段
   `readonly skipped?: readonly BatchExportSkip[]`（`{logicalPath, reason}`），
   填入被 `seenFileRels` 去重掉的路径。
   **必须是可选**：`BatchExportPlan` 走 `public/vfs.ts` 对外导出，加必填字段会让
   任何手写对象字面量（含 apps 侧测试夹具）报 TS2741（RULE 同款坑）。
3. `apps/desktop/src/main/services/vfs-batch.service.ts` · `stageVfsBatchExport`：
   把 `plan.skipped` 汇进返回的 `ExportStageResult`（或至少 `console.warn` + 计数），
   让 UI 有机会提示。**若 UI 侧要显示提示，超出本条范围**——本条只保证数据不丢 +
   信息到达 main 进程。UI 呈现列为债务池。

### 验收

- 改 `packages/core/test/vfs/vfs-batch-io.test.ts`（既有 `T-B5: export plan keeps relative structure` 在同文件）：
  1. 新增 `T-B10: 多选两个同名文件（不同父目录）都要进 plan` ——
     造 `/卷一/第一章.md` 与 `/卷二/第一章.md`，`planBatchExport(scope, [两个])`，
     断言 `plan.files.length === 2` 且两个 `relativePath` **不相等**
     （期望形如 `卷一/第一章.md` / `卷二/第一章.md`）。
     **牙齿**：改回 `basenameOf` 这条立刻红（files.length === 1）。
  2. 新增 `T-B11: 单选一个文件仍导出该文件（防锚点取父目录改错）` ——
     断言 `plan.files.length === 1` 且 `relativePath === "第一章.md"`。
     **这条专门防上面那个陷阱**：任何「锚点用自身」的错修都会让它红。
  3. 新增 `T-B12: 同名冲突进入 skipped 通道` —— 造「文件 `/卷一/a.md` + 目录 `/卷一`」这种
     **仍会撞 rel** 的组合（文件分支得 `卷一/a.md`、目录分支也得 `卷一/a.md`，撞 `seenFileRels`），
     断言 `plan.skipped` **记录了被去重的那条**（`skipped.length === 1` 且 `logicalPath` 为
     `/卷一/a.md`），且 `plan.files` 里不含重复项。
     **这条不是「二选一」**：`skipped` 是**必需通道**、不是死字段——锚点改父目录只消掉了
     「纯多选文件」这一类碰撞，文件与目录同选时的碰撞依然存在，必须有地方报告它。
     若只断言「`plan.skipped` 为空」就等于把这条通道测没了。
- 命令：`npm test -w @novel-master/core` + `node scripts/run-tests.mjs "test/**/*.test.ts" --test-concurrency=2`（apps/desktop）。

### 测试策略

- 改：`packages/core/test/vfs/vfs-batch-io.test.ts`（+3）
- 改（跟随）：`apps/desktop/test/vfs-batch-staging.test.ts` 若断言了 `ExportStageResult` 的
  精确形状，需同步 `skipped` 字段（用可选字段则大概率无需改，实现时确认）。

### 回归线

- `vfs-batch-io.test.ts` 全部既有用例（T-B1~T-B9）。
- `apps/desktop/test/vfs-batch-staging.test.ts` 全部 4 条。
- `packages/core/test/package-exports/` 快照（`public/vfs.ts` 若新增导出则要更新快照；
  本条只改既有 interface 的字段，不新增导出名 ⇒ 预期无需改，实现时确认）。
- `apps/desktop` typecheck（`stageVfsBatchExport` 的返回类型若变了，renderer 侧调用点会红）。

### 依赖

- 无前置；无拍板项依赖。与 CS-05/09/10（wave-c2，同文件 `vfs-batch-io.service.ts`）**改的是不同方法**，
  但**同文件** ⇒ 合入时需人工确认 hunk 不交叠（CS-05 动 `applyBatchIngest`/backfill，
  CS-09 动 ZIP 解析器，CS-10 动 checkpoint 仓储，本条动 `planBatchExport` 内的分支）。
- ⚠️ **hunk 协调义务（MF-C8，须落进 `SPEC.md` 依赖图并指定责任人）**：
  与 wave-c2 的 **C2-1（CS-05，改 `applyBatchIngest`）** 之间的**合并顺序目前两片都无人负责**
  ——wave-c2 那边只写「与 C2-4 同文件同函数段，建议同 PR」，本片只写「人工确认不交叠」。
  两句都不构成可执行的协调约定。落法：C3（CS-08）与 C2-1 里的 `applyBatchIngest` 段
  **由同一人按 wave-c2 → 本片的顺序合入**（wave-c2 先、core2 后），合入者负责跑
  `packages/core/test/vfs/vfs-batch-io.test.ts` 与 wave-c2 对应测试双绿。
  该条须同步登记进 `SPEC.md` 依赖图；本机位不改 `SPEC.md`，留给 spec 汇总机位。

### 风险与回滚

- 风险 1：多选时的导出目录结构会从「拍平」变成「带父目录名」——**这是修复的必然结果**，
  用户在 `%userData%/vfs-batch-export/<uuid>/` 看到的目录层级会变深一级。
  单选场景完全不变（已由 T-B11 锁住）。
- 风险 2：`parentLogicalOf` 对根下文件（`/a.md`）返回 `/` ⇒
  `relativePathUnderAnchor("/a.md","/")` 走 `:69-71` 返回 `a.md` ✓；多选时
  `rootName = basenameOf("/")` 为空串 ⇒ 走 `:175-176` 的 `under` ✓。已核对无洞。
- 回滚：单文件 revert + 可选字段移除。

---

## 9 · B · `formSnapshotJson` 缺 `mode`，改「作用域」下拉不产生 dirty

**严重度 / 簇**：P1 / apps-desktop（+ core config-forms）

### 病症

智能体编辑表单的 dirty 基线由 `formSnapshotJson(input)` 生成的稳定 JSON 比对得出。
该函数逐字段枚举了 17 个字段，**唯独没有 `mode`（智能体作用域：primary / subagent / all）**。
用户在下拉里改「作用域」，快照不变 ⇒ `dirty` 恒 false ⇒ 标题不显示「· 未保存」、
关闭不拦提示、保存按钮不激活 ⇒ **改动被静默丢弃**（除非用户碰巧又改了别的字段）。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/config-forms/agent/agent-editor-state.ts:542-569（节选尾部）
    skillsEnabled: input.skillsEnabled ?? true,
    skillsPrefixText: input.skillsPrefixText ?? "",
    description: input.description ?? "",
    persist: input.persist, dynamic: input.dynamic,
  });      // ← 17 个字段逐条在此，mode 不在其中（对比 :453 的字段名联合里 "mode" 是在的）
```
- 实时快照侧**已经传了** `mode`：`apps/desktop/renderer/features/settings/AgentEditorView.tsx:169-193`
  （`:174` `mode,`），`:196` 依赖数组也含 `mode` ⇒ 说明「mode 是表单字段」这件事是清楚的，
  只是 core 侧把它从输出里漏了。
- 判 dirty：`AgentEditorView.tsx:630`
  `const dirty = savedBaseline != null && snapshot !== savedBaseline;`
- 下拉本体：`AgentEditorView.tsx:744-756`（`value={mode}` / `onChange={e => setMode(...)}`）。
- mobile 同款：`apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts:218-220`
  （`formSnapshotJson(form)`，form 含 `mode`，见 `:84` 初值 / `:121` `mode: def.mode ?? 'all'`）。

### 修法（文件·函数级）

⚠️ **本条有一个三处联动的陷阱，只改 core 一处会把「改作用域不 dirty」变成「永远 dirty」。**

`JSON.stringify` 会**丢弃值为 `undefined` 的键**，而两端的**基线调用点目前都没有传 `mode`**：

- desktop `AgentEditorView.tsx:291-303`（`applyDefinition` 里的 `setSavedBaseline(formSnapshotJson({...}))`）
  —— 传了 name/maxSteps/modelEnabled/…/`...promptForm`，**没有 `mode`**；
- mobile `useAgentEditorFormState.ts:278-290` —— 同样**没有 `mode`**。

⇒ 若只把 `mode: input.mode` 加进 `formSnapshotJson` 的输出，基线 JSON 会缺 `mode` 键
（undefined 被丢），实时快照有 `mode:"all"` ⇒ **两个 JSON 永不相等 ⇒ 打开任何智能体
就显示「· 未保存」**，比原缺陷更糟（且会打红既有的一致性断言）。

**修法（三处同 commit，缺一不可）**：

1. `agent-editor-state.ts` · `formSnapshotJson`：加一行 `mode: input.mode ?? "all",`
   （放在 `name` 之后、`maxSteps` 之前，与 `AgentEditorFormInput` 的声明顺序对齐）。
2. `AgentEditorView.tsx:292` 的基线调用对象加 `mode: def.mode ?? "all",`
   （对齐 core `:476` 的 `definitionToForm` 口径 `mode: def.mode ?? "all"`）。
3. `useAgentEditorFormState.ts:279` 的基线调用对象加 `mode: def.mode ?? "all",`
   （对齐同文件 `:121` 的口径）。
4. 顺带核对 `AgentEditorView.tsx:491`（保存路径）已经传了 `mode`（`:491` 在 grep 结果里），
   确认无需改；若没传则一并补上。

### 验收

- 改 `packages/core/test/config-forms/agent-editor-state.test.ts`（既有同族用例
  `T-CA2c`（`:451`）与 `T-DESC5`（`:1205`）就是「某字段纳入 dirty 比对」的现成模板，照抄形状）：
  新增 `formSnapshotJson 将 mode 纳入 dirty 比对`：
  `const a = formSnapshotJson({...base, mode:"primary"}); const b = formSnapshotJson({...base, mode:"subagent"});`
  断言 `a !== b`。**牙齿**：`mode` 不进输出时两者逐字节相等，用例立刻红。
- 端到端断言（apps 侧，防「只改 core 变永远 dirty」）：
  在 `apps/desktop/test/` 的智能体编辑相关测试里加一条
  `加载后未改动时 snapshot 与 savedBaseline 相等（mode 缺省 all）`；
  mobile 侧对应加一条。**若 apps 侧无对应测试宿主，则退化为在 core 测试里加
  「`mode` 缺省时输出显式为 `"all"` 而非被 `JSON.stringify` 丢键」**：
  ```ts
  const j = JSON.parse(formSnapshotJson({ ...base, mode: undefined as never }));
  assert.equal(j.mode, "all");
  ```
  这条断言直接锁住 §修法 2/3 的必要性（基线侧一旦漏传 `mode`，就会走 undefined 分支，
  断言形态与真实故障同构）。
- 命令：`npm test -w @novel-master/core` + desktop 定向 + mobile 定向（`--maxWorkers=2`）。

### 测试策略

- 改：`packages/core/test/config-forms/agent-editor-state.test.ts`（+2）
- 改或新增：desktop / mobile 侧的 agent editor 测试（若宿主不存在则记为债务并写明）。

### 回归线

- `agent-editor-state.test.ts` 全部既有用例（尤其 `T-CA2c` / `T-DESC5` /
  `formSnapshotJson omits model fields when disabled`（`:389`）——**后者锁的是「条件省略」语义**，
  本条加的 `mode` 是无条件字段，不要误改成条件字段）。
- `definitionToForm`（`:476`）与 `buildAgentDefinitionFromForm`（`:571-618`，`:613` 用 `input.mode`）
  的既有用例——本条不碰它们，但同文件同概念。
- `apps/desktop` 智能体编辑相关既有用例（若 `AgentDefinitionEditorForm.tsx` 也有
  `formSnapshotJson` 调用（`:161`/`:221`），**该文件全仓零引用、已并入 Wave D 批次 3 删除**，
  本条**不改它**，但 review 时确认它的存在不会让 desktop typecheck 变红）。

### 依赖

- 无前置；无拍板项依赖。
- 🔁 **R2 订正：`S-D-04` 不再是「兄弟条目」的悬空引用，它是实条**——judge-r1 §A.2(b) 已裁定
  S-D-04 / E 落 `wave-b-apps.md` 补写（**同 PR**，实条号 `wave-b-apps` **§8 S-D-04 / §9 E**），
  旧稿这里把它当一个「同文件不同问题、互不依赖」的兄弟条目，而全目录当时无任何一片立过它。
  ⇒ 现口径：本条与 **`wave-b-apps` §8 S-D-04**
  是 `AgentEditorView` / `agent-editor-state` 同一条「未保存拦截」链上的两段，**同 PR 合入**：
  - S-D-04 改的是「关闭设置浮层时不拦未保存」（`App.tsx:344` 的 ⚡ 旁路 + `dirtyViews` 零写入）；
  - 本条改的是「dirty 判定本身漏字段」（`formSnapshotJson` 缺 `mode`）。
  - 两者叠加才有完整的「未保存拦截」体验，**仍互不依赖**（可各自落地、各自评审），
    但**必须同 PR**：只落其一时，用户看到的现象是「提示会弹但拦不住」或「能拦住但作用域改了不提示」，
    半套比不落更容易被当成新 bug 报回来。

### 风险与回滚

- 风险（本条的主要风险就是上面那个陷阱）：只改 core 一处 ⇒ **打开任意智能体即显示「未保存」**。
  验收里的「缺省 `"all"`」断言就是专门拦这个的。
- 次要风险：`mode` 进快照后，用户在 UI 改作用域并保存、再打开 ⇒ 快照与基线一致（正确）。
- 回滚：三处同 commit revert。

---

## 10 · S-D-02 · 清理 staging 的 IPC 通道缺路径包含断言

**严重度 / 簇**：P1（可利用性 suspected）/ apps-desktop（main 进程）

### 病症

`handleVfsBatchClearStaging` 把 renderer 传来的 `stagingRoot` **原样**交给
`clearVfsBatchExportStaging`，后者只挡空串，随后 `rm(stagingRoot, {recursive:true, force:true})`。
正常路径下 `stagingRoot` 总是 `join(userData, "vfs-batch-export", <uuid>)`；
但通道本身**不校验**，任何能调这条 IPC 的代码传 `C:\Users\<用户>` 或 `/` 都会被递归删除。
`force: true` 保证不存在的路径不报错，误删没有任何提示。定级 P1、可利用性 suspected
（需要 renderer 侧被攻陷或存在 bug），但**修法只有两行、零风险**，属该落的条目。

### 证据（`fe79b781` 亲自核对）

```ts
// apps/desktop/src/main/ipc/handlers/vfs.ts:423-432
export async function handleVfsBatchClearStaging(req: VfsBatchClearStagingRequest) {
  try { await clearVfsBatchExportStaging(req.stagingRoot); return { ok: true, data: undefined }; }
  catch (err) { return { ok: false, error: formatIpcError(err) }; }
}
```
```ts
// apps/desktop/src/main/services/vfs-batch.service.ts:260-272
export async function clearVfsBatchExportStaging(stagingRoot: string): Promise<void> {
  if (stagingRoot.trim() === "") { return; }          // ← 唯一的校验
  const timer = stagingTtlTimers.get(stagingRoot);
  if (timer != null) { clearTimeout(timer); stagingTtlTimers.delete(stagingRoot); }
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
}
```
- staging 根的权威来源在**同文件** `:295-299`：
  `const stagingRoot = join(app.getPath("userData"), "vfs-batch-export", randomUUID());`
  ⇒ 断言基准就是 `join(app.getPath("userData"), "vfs-batch-export")`。

### 修法（文件·函数级）

1. `vfs-batch.service.ts`：抽一个私有常量/函数
   `vfsBatchStagingBase(): string`（= `join(app.getPath("userData"), "vfs-batch-export")`），
   `:296-299` 的 stagingRoot 构造也改用它（**消除「两处各写一遍基准」的漂移**）。
2. `clearVfsBatchExportStaging` 在空串检查之后加包含断言：
   ```ts
   const resolved = resolve(stagingRoot);
   const base = resolve(vfsBatchStagingBase());
   if (resolved !== base && !resolved.startsWith(base + sep)) {
     throw new Error(`拒绝清理非 staging 路径: ${stagingRoot}`);
   }
   ```
   （`resolve` / `sep` 从 `node:path` 导入；main 进程是 Node 环境，无兼容问题。）
3. **断言失败必须是抛错**（不是静默 return）：静默 return 会让「传错路径」变成
   「清理没做但返回成功」，staging 目录残留。抛错经 handler 的 `formatIpcError` 回 renderer。
4. 顺手把 `:271` 的 `.catch(() => undefined)` 保留（TTL 兜底清理吞错是刻意的，
   与 S-CS-07「不得吞错」不是同一条，别混）。

### 验收

- 改 `apps/desktop/test/vfs-batch-staging.test.ts`（既有 `删除 staging 目录` /
  `IPC clearStaging 幂等` / `stage 后注册 TTL` 三条在同文件）：
  1. 新增 `拒绝清理 staging 根之外的路径`：`assert.rejects(() => clearVfsBatchExportStaging(app.getPath("userData")), /拒绝清理/)`；
  2. 新增 `拒绝清理 staging 根的父目录`（传 `join(base, "..")` ⇒ `resolve` 后落在 base 之外
     ⇒ 拒；**这条专门防「只判 `startsWith(base)` 不带分隔符」的错误实现**——
     `base + "-evil"` 这类前缀撞车必须也拒）；
  3. **必须先改夹具**：既有 `删除 staging 目录` / `IPC clearStaging 幂等` 两条**现在会红**，
     且是必红——它们传的 `stagingRoot` 是 `join(tempDir,"staging-a")`，而
     `tempDir = mkdtemp(join(tmpdir(),"nm-desktop-vfs-staging-"))`
     （`desktop-db-test-env.ts:18`），测试态 `app.getPath("userData")` 被 stub 成
     `/tmp/novel-master-test-user-data`（`electron-stub.mjs:19`）
     ⇒ **两个路径毫无包含关系**，新断言必拒。
     落法：把这两条的 `stagingRoot` 换成
     `join(app.getPath("userData"), "vfs-batch-export", "case-a")`（先
     `mkdir(..., {recursive:true})` 造出 base），再断言它们仍绿（正向不回归）。
     ⚠️ **不要为了让既有用例变绿而放宽守卫**——这正是 §4 M-03 警告过的失败模式。
- 命令：`node scripts/run-tests.mjs "test/**/*.test.ts" --test-concurrency=2`
  （⚠️ RULE：`apps/desktop` 的 `npm test` 不带 glob 参数会**收集 0 条测试**显示假绿，
  必须显式传双引号 glob，并核对 `# tests > 0`）。

### 测试策略

- 改：`apps/desktop/test/vfs-batch-staging.test.ts`
  （**+2 且改 2 条既有用例的夹具**——见验收第 3 条，两条既有用例的 `stagingRoot`
  必须从 `join(tempDir, …)` 换成 `join(app.getPath("userData"), "vfs-batch-export", …)`，
  否则必红；既有用例的**断言本身不改**）
- 不新增测试文件。

### 回归线

- `apps/desktop/test/vfs-batch-staging.test.ts` 全部 4 条（尤其「返回非空 NativeImage」
  与 stage 主链）。
- desktop `typecheck`（新增 import 与常量）。
- `apps/desktop/test/` 全量（RULE：Windows 下的假信号 + `--test-concurrency=2`）。

### 依赖

- 无前置；无拍板项依赖。
- **与 `CS-08` 同文件**（desktop `apps/desktop/src/main/services/vfs-batch.service.ts`）：
  本条动 `:260-272` 的 `clearVfsBatchExportStaging` 与 `:295-299` 的 staging 根构造；
  CS-08 动 `stageVfsBatchExport` 的返回面（`:291` 及以下）。两者同在 C3a ⇒
  **必须先做本条（S-D-02）**：它抽出 `vfsBatchStagingBase()` 并改 `:295-299`，
  CS-08 若先改会在 staging 根构造的 hunk 上冲突。顺序：**S-D-02 → CS-08**。
- 🔁 **R2 订正：与 `S-D-04` 不再互不相干**。judge-r1 §A.2(b) 已把 S-D-04 / E 裁定落
  `wave-b-apps` 补写（实条号 **`wave-b-apps` §8 S-D-04 / §9 E**，同 PR），
  旧稿这里写「与同簇的 S-D-04 互不依赖，可并行」时，
  S-D-04 在全目录并无实条。⇒ 现口径：**同簇同 PR**（§8 / §9 与本片 §9 B、
  本条 S-D-02 同属 Wave B 的「同波顺带」批次），但**三条改的文件互不相交**
  （本条动 desktop main 的 `vfs-batch.service.ts`；S-D-04 / E 动 renderer 的
  `AgentEditorView.tsx`；§9 B 动 core 的 `agent-editor-state.ts`），
  ⇒ **可并行施工、无 hunk 冲突**，同 PR 只是为了批次完整性，不是顺序约束。
  与 §9 B 的先后要求（必须先做）见本条依赖栏上一段。

### 风险与回滚

- 风险：若某些调用方传的 `stagingRoot` 是**规范化之前**的形态（带 `..` 或尾分隔符），
  新断言会拒掉。已知调用方只有 `stageVfsBatchExport` 的返回值（自身构造，绝对干净）与
  renderer 的 dragEnd 回调（透传同一值）⇒ 风险极低。
  若实现中发现某调用方不干净，**正确处置是在调用方规范化，不是放宽断言**。
  同理：**若实现时把既有 `删除 staging 目录` / `IPC clearStaging 幂等` 改红，
  正确处置是修夹具（把它们挪到 `app.getPath("userData")` 下），不是放宽断言**——
  放宽一次，守卫就作废了。
- 回滚：`clearVfsBatchExportStaging` 单函数 revert。

---

## 11 · M-01 · 重试判定缺 attempt 级「本次是否已产出」探针（重复输出 + 重复计费）

**严重度 / 簇**：P1 / core-misc（provider 域）· **量级 M**（见 §0.2）·
台账 `ledger-v2.md:135` 的 **M-01**，judge-r1 §A.2(b) 裁定归本片（R1 之前全目录无实条目）

### 病症

`DefaultModelRequestService.request` 的重试循环**只看错误形态、不看本次 attempt 是否已经吐过东西**。
一次请求若已经流式吐了半段文本、随后在传输层断掉，循环会把它判为「瞬时失败」再发一次，
而第二次 attempt 会**从零重新驱动同一个 `onStream`** ⇒ 用户屏幕上出现同一段文本两遍、
服务商按两次完整生成计费、run 级 usage 基线被重复累加。

台账给这条的机理链是「流中断被当可重试」，R2 核对 `fe79b781` 后确认病灶比那更宽：**唯一
已经做了「已产出就不重试」分级的是超时那一条路径**（`LlmStreamTimeoutError.phase`），
其余所有中途失败位点一律落进「默认可重试」的兜底分支。

### 证据（`fe79b781` 亲自核对）

```ts
// packages/core/src/service/provider/impl/model-request.service.ts:210-243
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        return await adapter.chat({
          ...
          onStream: options?.onStream,      // ← :226 每个 attempt 原样透传同一个回调
        });
      } catch (error) {
        const canRetry =
          attempt <= policy.maxRetries && isRetryableError(error);   // ← :232-233 只看错误形态
        if (!canRetry || isAbortLikeError(error)) {
          throw error;
        }
        ...
```

- `isRetryableError`（同文件 `:69-104`）逐分支核对：
  - `:78-80` `error instanceof LlmStreamTimeoutError` → `return error.phase === "first-chunk"`。
    **这是全文件唯一一处「已产出就不重试」的判据**，且它只覆盖「超时」一条路径（`phase` 由
    `llm-sse-transport.ts:354` 按 `processedLength > 0` 算出）；
  - `:81-84` 非 `ProviderError`（传输层裸错）→ **无条件 `true`**；
  - `:99-102` `ProviderError` 但解析不出状态码 → **`true`**；
  - ⇒ 中途断流的默认答案就是「重试」，与「这次已经吐了半段」无关。
- 中途失败会走到这里的三条传输位点（全部已在吐过 chunk **之后**才 reject）：
  - `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts:568-573`（XHR `onerror`
    → `ProviderError("HTTP_ERROR", "XHR network error")`，`parseHttpStatusFromProviderError`
    拿不到状态码 ⇒ 落 `:99-102` 的 `true`；同文件 `:481-496` 的 `deliverNewText` 证明
    `onChunk` 在 error 之前已经被驱动过）；
  - 同文件 `:673-682`（fetch 分支 `catch` 原样 `rejectOnce(error)` ⇒ **裸 `Error`** ⇒ 落 `:81-84`）；
  - 同文件 `:449-451`（native 分支 `rejectOnce(error)`，同款裸错）。
- 三个 adapter 的流式收尾形态同款（**abort 才吞、非 abort 一律重抛**）：
  `openai.adapter.ts:224-228`、`anthropic.adapter.ts:201-204`、`gemini.adapter.ts:159-162`，
  形如 `} catch (error) { if (!isRequestAborted(error, req.signal)) { throw error; } }`
  ⇒ 三协议的中途失败都会原样冒到上面的重试循环。
- 事件类型（`packages/core/src/infra/llm-protocol/ports/adapter.port.ts:27-53`）：
  `text-delta` / `thinking-delta` / `tool-use` / `usage` / `done`。
  「已产出」的可判据就是前三种；`agent-runner.ts:634-638` 记 `firstContentAtMs` 时用的
  正是 `text-delta || thinking-delta` 这一对，本条沿用同一判据族。
- 下游影响面（`wave-e.md:1451-1455` 的 sr1-e-c §2.2 注记）：desktop / mobile 的 token 精确标签
  靠同一条 `onStream` 推送（`nm:prompt/chatTokenUpdated` / `onPreciseUpgrade`），
  ⇒ **重复的不只是 UI 文本，还有 token 统计与计费展示**，勿按「小重复」估工。
- 失败收尾链（复用，不改）：`agent-runner.ts:659-668` 的 `catch` 重抛 →
  `:932-962` 落一条 `[生成失败]` 消息并发 `EVENT_AGENT_RUN_FAILED`。
  本条只要求错误**能被这既有链路接住**，不新增错误码、不新增事件、不改 runner。
- 测试现状：`packages/core/test/provider/model-request-retry.test.ts` 共 **10 条**
  （`:68` / `:94` / `:116` / `:142` / `:168` / `:194` / `:220` / `:248` / `:275` / `:302`），
  逐条核对：**每一条的 `adapter.chat` 都在产出任何输出之前就 throw，没有一条用 `onStream`**
  ⇒ 这个缺口在 CI 里零覆盖。

### 修法（文件·函数级）

1. `model-request.service.ts` · `DefaultModelRequestService.request`：在 `let attempt = 0;`（`:210`）
   旁加 `let attemptEmitted = false;`，**在每次 attempt 的开头（`:212` `attempt += 1;` 之后、
   进入 `try` 之前）复位**。
   ⚠️ **复位必须是逐 attempt 的**，不是为了语义，而是为了不让闩锁的正确性依赖
   「重试只发生在未产出时」这条当前恰好成立的不变量——将来若引入任何「已产出后续传」类策略，
   逐 attempt 复位是它能成立的前提。
2. 新增 attempt 级 `onStream` 包装，把 `:226` 的 `onStream: options?.onStream`
   换成包装后的回调：
   ```ts
   const PRODUCED_EVENT_TYPES = new Set<LlmStreamEvent["type"]>([
     "text-delta",
     "thinking-delta",
     "tool-use",
   ]);
   ```
   - ⚠️ **import 要补一处**：本文件 `:17-21` 只从 `adapter.port.js` 引了
     `LlmChatResult / LlmProtocolAdapter / LlmProtocolKind` 三个 type，
     **`LlmStreamEvent` 未被引入**（`model-request.port.ts:7` 才引它）。
     写 `Set<LlmStreamEvent["type"]>` 忘了加 import 会直接编译红。
   - 包装体：**先置闩、再转发**（`if (PRODUCED_EVENT_TYPES.has(ev.type)) { attemptEmitted = true; }`
     之后原样调 `options.onStream(ev)`）。顺序反了的话，一旦下游 `onStream` 自身抛错，
     闩锁会来不及置位 ⇒ 变成静默可重试。
   - `options?.onStream == null` 时**直接传 `undefined`、不要造闭包**（非流式请求不该凭空多一层）。
   - `usage` / `done` **不置闩**：它们不承载可见输出。若把它们也算「已产出」，
     「只收到一个 usage 就断流」的黑洞会被误判成已产出而彻底不重试——那是把本条修成反向 bug。
3. `:232-233` 的判定加一个合取项：
   ```ts
   const canRetry =
     attempt <= policy.maxRetries && !attemptEmitted && isRetryableError(error);
   ```
   `!attemptEmitted` 命中时走既有 `throw error`（`:235-237`），
   由 `agent-runner` 的失败收尾链接住，**不新增第三种处理路径**。
4. **不要把闩锁塞进 `isRetryableError`**：它是模块内私有的无状态纯函数，闩锁是 attempt 级状态，
   塞进去就得改签名并把 attempt 传进去 ⇒ 会连带扰动 `:78-80` 的超时分级语义。
   闩锁判据只放在 `catch` 里。
5. **与既有超时分级（`:78-80`）的关系是并存不是替换**：`phase === "first-chunk"` 表达的正是
   「本 attempt 零产出」。落地后二者语义部分重合，但 `phase` 还额外覆盖「idle 而 `onStream`
   未被驱动」的形态（如中途只发了 reasoning 前缀就断），**不得删除 `:78-80`**。
   反过来 `:78-80` 也**不得**被改写成「先看闩锁再判 phase」——那是把两条路径合成一条，
   会让 `T-T4` 两条既有用例的失败归因变得不可分辨。

### 验收

- 改 `packages/core/test/provider/model-request-retry.test.ts`，新增 `T-RR-1`
  （用例体直接采纳 `wave-e.md:1418-1439` 的草案，**但断言必须按落地后的期望改**，见下）：
  - **⚠️ 草案里的 `assert.ok(calls >= 2, ...)` 是「红态」断言，本条落地后必须改成
    `assert.equal(calls, 1, ...)`**。草案作者写它是为了证明「重试确实发生了」，
    而闩锁落地后正确行为就是**不重试**；照抄会得到一条永远红的用例。
    三条断言：`assert.rejects(...)`（错误照常上抛）+ `calls === 1`（不发起第二次 attempt）+
    `seen.length === 1`（`onStream` 只被驱动一次）。
  - 保留草案的 stub 形态（`adapter.chat` 先 `req.onStream?.({ type: "text-delta", ... })`
    再 `throw new Error("ECONNRESET")`——非 `ProviderError` ⇒ `isRetryableError` 判 `true`，
    这是**当前实现必然重试**的路径，正是该用例的牙齿所在）。
- 同文件再加两条护栏用例（缺了它们，闩锁可能往「太紧」的方向跑偏而 CI 全绿）：
  - `T-RR-1b` **无产出仍可重试**：adapter 第一次直接 throw 裸错（不 emit），第二次 emit
    `text-delta` 并正常返回 ⇒ 断言 `calls === 2`、请求 resolve、`seen.length === 1`。
    这条同时是「逐 attempt 复位」的行为证据（第二次 attempt 的 emit 必须照常转发）。
  - `T-RR-1c` **已产出的超时仍不重试（归因不漂移）**：第一次 attempt emit `text-delta` 后
    抛 `LlmStreamTimeoutError("idle")` ⇒ 不重试。证明 §11 修法 5 说的两条路径并存且不互相顶掉。
- 命令：`npm test -w @novel-master/core`。

### 测试策略

- 改：`packages/core/test/provider/model-request-retry.test.ts`（10 → **13**）。
- ⚠️ 本条**不新增测试文件**、不改任何 adapter 与传输层测试：三处传输位点与三处 adapter 重抛
  都只是本条的「触发面」，不需要各自铺用例（它们在真实链路里难以稳定复现，
  铺出来的只会是时序敏感的假红）。

### 回归线

- `model-request-retry.test.ts` 全部 10 条既有用例逐条须绿，其中三条是本条的直接风险面：
  - `:142` `retries on network failures then succeeds`——走的正是 `:81-84` 的裸错 `true` 分支，
    且**不 emit**；若它变红，说明闩锁把「无产出的瞬时失败重试」也掐死了（闩锁太紧）。
  - `:248` `T-T4: 首字前流式超时（first-chunk）按既有上限重试后成功`——
    `phase` 分级未被新闩锁顶掉。
  - `:275` `T-T4: 流中断超时（idle，已有部分输出）不可重试，直接上抛`——
    它当前变绿是因为 `phase` 分级；落地后要确认**不是因为别的巧合**，实现时若发现必须靠
    闩锁才能绿、靠 `phase` 就红，那是误把两条路径合成了一条（见修法 5）。
- 同目录其余五条既有用例全绿：`model-request-sampling.test.ts`、
  `model-request-thinking.test.ts`、`model-request-saved-model-settings.test.ts`、
  `model-request-tools-stream.test.ts`、`model-request-tool-use-session.test.ts`
  （本条不改 `request()` 以外的签名，但它们都会打到同一条循环）。
- `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts` /
  `llm-sse-transport-port.test.ts`（本条不改传输层，但三处触发面在此）。
- agent runner 侧：`packages/core/test/service/agent/` 下与失败收尾（`[生成失败]` 落库 /
  `EVENT_AGENT_RUN_FAILED`）相关的既有用例须绿——本条只改「错误何时被抛出」，
  不改「错误被抛出后怎么办」。

### 依赖

- 无前置；无拍板项依赖。
- **单向依赖 §2（M-06）**：C2 必须先于 C3c 合入，否则 `T-RR-1` 会**假绿**
  （`data:` 无空格形态仍被整流丢弃 ⇒ `text-delta` 压根没到 `onStream` ⇒ `seen.length === 1`
  在「有重试」的实现下也成立）。完整机理见 §2 依赖栏的三条。
- 与 §5（M-04）**同 provider 域但机理正交**：M-04 改 `provider.service.ts` 的删除流水线，
  本条改 `model-request.service.ts` 的重试循环，两文件不相交，可并行施工；
  只在 §0.1 的 commit 排布上同属 provider 组（C3b / C3c 两条并列）。
- 与 wave-e H5.1.3 是**同一缺口的两次记账**：wave-e 侧已按 R2-7 撤销 `test.todo`、
  只保留病因分析与用例草案（见 `wave-e.md:1443-1454`、`:1485`、`:1815`），
  **测试落点归本条**；本条不改 `wave-e.md`。
- 与 wave-c1 的 `§6 #8`（gemini 同名并行）/ `#9`（max_tokens）/ `#10`（thinkingSignature）
  以及 `S-CS-05` 无关。

### 风险与回滚

- 风险 1（行为面，最需要 reviewer 点头）：闩锁生效后，**首字后断流不再自动重试**，
  用户直接看到 `[生成失败]`。这是有意取舍（重复输出 + 重复计费的代价更大），
  但它是**可见行为变化**：从「偶尔能自动续上（代价是重复）」变成「直接失败」。
  若断流率不低，**正确处置是让用户手动重发，不是放开闩锁**。
- 风险 2（已知限制，列债务池，不在本条解决）：已产出后失败时，用户屏幕上已经有那一段流式文本，
  但 runner 走的是「本轮无 assistant 落库」的失败链（`agent-runner.ts:942-948`：
  `assistantAppendedInRun === false` ⇒ 落 `[生成失败]` 消息），
  ⇒ 会话里出现「屏幕上那一段 + 一条 `[生成失败]`」。要保住 partial 得改三个 adapter 的错误面
  （`openAiStreamAccumulatorsToPartialBlocks` / `finishAnthropicSsePartial` /
  `finishGeminiSsePartial` 目前**只在 `aborted` 分支被调**，`:230-239` / `:207-209` / `:165-167`），
  那是独立的一条 PR 的量；**本条的验收不依赖它**。
  ⚠️ **正确处置绝不是「失败后再重发一次」**——那正是本条要消灭的行为。
- 风险 3：闩锁只观测、不改变事件流向（对调用方传入的 `onStream` 是纯旁挂），
  任何调用方自己吞事件都不会让闩锁误判（判据是「被驱动过」而非「内容非空」）。
- 回滚：`request()` 单函数 revert（包装 + 判定两处），测试三用例随之删。

---

## 12 · 分片级注记

### 12.1 P1-S 打包的内部顺序（复述 §0.1，供 impl 代理直接照做）

```
C1   N-P1-02（core prompt，单文件单函数）        —— 零依赖，先落
C2   M-06（core llm-protocol，新增 1 文件 + 3 处一行）—— 零依赖；**须先于 C3c**（§2 依赖栏②）
C3a  M-03、CS-02、CS-08、B、S-D-02、summarizeToolInput
     └ 内部建议再按「文件簇」微排序：core 域（M-03 / CS-02 / CS-08）
       → apps 域（summarizeToolInput / B / S-D-02），减少同文件交叉
C3b  M-04（provider 域，量级 M，独立 commit）      —— deps 增 conn + 产品行为面变更
C3c  M-01（provider 域，量级 M，独立 commit）      —— 重试可重试语义 + attempt 级闩锁
C4   CS-07（core bootstrap vfs DDL）            —— 写好但**不与 C1-C3 一起合入**，
                                                  待 wave-c2 的 CS-06 合入后再单独合
```
**硬约束三条**：
① **M-04 与 M-01 各单列为独立 commit**（台账量级均为 M，§0.2；`provider-errors.ts` 无
   `PROVIDER_IN_USE` 码、复用 `SAVED_MODEL_IN_USE`；M-01 则是重试语义变更，混进 C3a 会让
   「六条互不相干」的分组名不副实）。C3 因此拆成 C3a（其余六条）+ C3b（M-04）+
    C3c（M-01）⇒ 本 PR 合计 **六个逻辑变更单元**（C1 / C2 / C3a / C3b / C3c / C4）。
    ⚠️ **合入形态偏离注记（CR R1 认定, OQ2=乙记账）**: 实际以单 commit `4829b8d1` 一次性交付五组全部内容, 未按六单元独立成 commit; 回滚须按文件路径手工 revert（见 cr-fix-spec CR-F18）。另外 B 条目三处拆两个 commit（core `4829b8d1` + apps `37df8900`）, apps 在前恰好安全, rebase 不得调换顺序；
② 任何新增 core 公共导出（仅 `summarizeToolInput` 一处）必须同 commit 更新
`packages/core/test/package-exports/snapshots/public-chat-allowlist.json`；
③ 本批 C1–C3 **不改任何 schema / 不开新 migration / 不动 `SCHEMA_BOOT_VERSION`**——
唯一的例外是 C4（CS-07）：它已按 §7 修法 3 **写死**走 bootstrap 指纹对齐 + 叠加触发器改名，
因此**必须同时 bump `SCHEMA_BOOT_VERSION`**（不 bump 则对齐段对存量库永远不执行）。
这是独立 commit 的独立决策，不牵连 C1–C3。

### 12.2 CS-07 归一结论（judge 专查项 · 已按 sr1-core2-c §1.3 裁定收敛）

- ledger 里 CS-07 出现两次：Wave B 的「（同波顺带）」行、Wave C 的「事务边界收窄」行
  （后者写作「CS-06/07 revision 对齐」）。
- 逐字核对两处原文（`ledger-v2.md:124` 与 `:457`/`:465`，`synth/core-storage.md:121` 与 `:191`）：
  **同一 file:line（`bootstrap/vfs/vfs-revision-schema.ts:44-54`）、同一根因
  （归零判定不感知 `vfs_entry` 引用）、同一修法（加 `AND NOT EXISTS`）**。
  Wave C 那处**不是第二条缺陷**，而是同一条的**修复顺序约束**（对抗裁决 pro-8 把本条
  定为「先修 CS-06/CS-12，本条降为纵深防御」）。
- **归一结论（已裁）**：**本片 §7 是 CS-07 的权威条目**；**wave-c2 的 C2-5 已注记化**
  （七要素删除、只保留一条交叉引用「CS-07 见 wave-b-core2 §7，须在 CS-06 之后」），
  其 N-2 整节改写为「已归一至 wave-b-core2 §7」，N-1 的顺序约束保留
  （它是跨片顺序的唯一权威表述）。本片 §7 与 §0.3 两处声明此约束，且 §7 谱系小节
  已把 c2 的三样东西（UPDATE 触发器、触发器改名纪律、测试落点并入 `vfs-gc-trigger.test.ts`）
  上收完毕 ⇒ 两片**不再互相引用**，不存在「各说各话」的悬空。
- **台账层遗留（不在本片，待 ledger 机位处理）**：`ledger-v2.md:457` 把 CS-07 塞进
  「全部量级 S、零结构变更」的 P1-S 批次，与 `:465` 的 Wave C 格冲突。台账本身该修——
  建议 Wave B 末行的清单删掉 CS-07（或加「（顺序约束见 Wave C，代码改动不进本批）」注记）。
- CS-12（`copyVfsTree` overlay）是 P2、不在任何 Wave ⇒ **CS-07 修完后仍有触发面残留**，
  已按「纵深防御」定性接受，不在本批解决。

### 12.3 与 wave-e 钩子②（白名单完整性）的联动

- N-P1-02 是钩子②的**真实靶子**：它是 `normalizeAgentPromptLayoutDomain` 白名单
  **连续第二次**漏新增字段（上次 `customAttach`，这次 `skillsEnabled`/`skillsPrefix`）。
- 分工（MF-1 修正后，本片已按此切分，review 时勿判为「钩子②漏做」）：
  - 本片交付 **靶子 + 一条有牙齿的回归锁用例**（§1 验收：键集全等断言
    + `skillsEnabled:false` 直断言），并顺手修掉该白名单当前的两个漏字段。
    ⚠️ 这条键集断言的牙齿范围**只覆盖「删改已有字段」**，对「新增字段」无牙
    （MF-1 核实：两侧夹具都没有那个键，键集依然相等）；
  - wave-e 交付 **仓级门禁**：把「显式白名单重建对象」这类函数扫一遍
    （不止 `normalizeAgentPromptLayoutDomain` 一个），并以
    `satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>`
    **在编译期**兜住「新增字段」（编译红），再把回归锁断言接进提交钩子或 CI 步骤。
- **反向依赖**：wave-e 若在实现钩子②时发现仓内还有第二处同类漏字段，属钩子②的账，
  **不回头扩到本片条目**；本片的 11 条在此之后不再变更（除 reviewer 的 must-fix）。

### 12.4 「（同波顺带）」行的归属核对

ledger §10 Wave B 末行列了 10 项：`M-03 / M-04 / CS-02 / CS-04 / CS-07 / CS-08 / B /
AM-3 / S-D-02 / §6 #8`。按 `SPEC.md` §2 分片分配表，其中 **3 项归其他机位**，本片不重复立条：

| 条目 | 归属分片（SPEC.md §2） | 本片处置 |
|---|---|---|
| CS-04（同族并入 CS-01） | `wave-b-core1`（与 N-P1-01 同一 PR） | 不立条 |
| AM-3 | `wave-b-apps` **§7**（🔁 judge-r1 §A.2(a) 裁定补立，R2 已落条） | 不立条 |
| §6 #8（gemini 同名并行调用） | `wave-c1` | 不立条 |
| 其余 7 项 | 本片 | 已立条（§4/§5/§6/§7/§8/§9/§10） |
| **M-01**（🔁 judge-r1 §A.2(b) **补排**：台账 §10 两张表均未列它，R1 之前全目录无实条目） | 本片（judge 明文裁定归 provider 域，与 M-04 同族） | 已立条（§11） |

⇒ 本片 **11 条** = 单列 3 条（N-P1-02 / M-06 / summarizeToolInput）+ 同波顺带 7 条
+ judge-r1 补排 1 条（M-01）。

🔁 **同批补排但不在本片的**（本片只登记归属，防下轮再被当成漏条重排）：
`AM-3` → `wave-b-apps` **§7**；`S-D-04` / `E` → `wave-b-apps` **§8 / §9**（与本片 §9 B 同属
「未保存拦截」链，同 PR）；`CS-03` → `wave-c2`（core-storage 性能族）。

### 12.5 本片的已知盲区（留给 judge）

1. **M-04 的量级与批次名不符**（§0.2）——量级已由 sr1-core2-b §2.2 **裁定为 M**（维持台账
   「量」列，否定 Wave B 行的「全部 S」声明）；归属亦由 §2.3 **裁定为「留在本 PR、
   单列独立 commit C3b」**，并据此把 §0.1/§12.1 的「四个 commit」改为「五个」
   （🔁 R2 已因 M-01 补排再改为「六个」，见 1b）。
   **残留给 judge 的只有一个**：若 judge 推翻该归属而选择移出本批，则须自行在
   「Wave C 另立 provider 归属」与「M-04 独立成 PR」之间定夺——旧稿的备选案
   「挂 Wave C 事务边界格」已被证伪（该格无 provider 落点），不得复活。
1b. **M-01 的量级与批次名同样不符**（§0.2）——台账「量」列给 M，Wave B 行却声明「全部 S」，
   本片按「量 M ⇒ 单列 C3c」处理。**与第 1 条不同，这条没有归属争议**：
   judge-r1 §A.2(b) 已明文裁定归本片 provider 域，所以它在 C3c 内是终态。
   残留给 judge 的只有一个**行为面拍板**：§11 风险 1 的「首字后断流不再自动重试」
   是可见行为变化（从「偶尔自动续上、代价是重复」变成「直接失败」）。
   本片按「重复输出 + 重复计费比失败更糟」取默认案；若 judge 想保住自动重试，
   正确形态是**先做一次断流率实测再决定**，不是把闩锁放宽。
2. ~~**CS-07 的存量库触发器重建路线二选一**~~ **已闭合**（sr1-core2-c §1.3 裁定 + 本次 must-fix）：
   路线已写死为 §7 修法 3 的「bootstrap 指纹对齐 + bump `SCHEMA_BOOT_VERSION` + 叠加触发器改名」，
   不再需要 judge 或 impl 在执行时二次决策。**残留的开放项只有一个**：指纹对齐机制在仓库里
   无既有实现、须新造（§7 修法 3.4 / 风险 3 的比对口径），这是工作量问题不是路线问题。
   （唯一的后手是 §7 修法 3.6 的 pending schema migration 备选注记——仅在指纹对齐代价
   超预期时按 sr1-c2-b §4 第 1 条启用，**两案择一后另一案删**，不在此处做路线决策。）
3. **CS-08 的 UI 呈现面未做**（跳过的文件如何在 UI 提示）——本条只保证「不丢 + 信息到 main 进程」，
   UI 提示列为债务池。
4. **M-06 的可选加强段（未识别行计数）** 有误报面（`event:` / `:keep-alive` / 空行必须豁免），
   已标为可独立回滚；judge 若认为该段超出「量级 S」纪律，可整段删掉而不影响主体修法。
