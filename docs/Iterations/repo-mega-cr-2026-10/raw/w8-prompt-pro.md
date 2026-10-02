---
zone: w8-prompt-pro
agent: prosecutor（猎杀冗余/死路径/不一致/坏味道）
files_scanned: 21
---

# W8 对抗机位报告 · prompt-pro（`domain/prompt/` + `domain/format/` + `service/prompt/`）

## 摘要

本区是提示词的**装配与出站整形层**：把 agent 的三区配置（system / persist / dynamic）加上
常驻工作区、技能索引与会话消息，组装成 LLM 输入 messages、CLI 预览分段与 token 计数串；
另含 dynamic 区宏（`$time`/`$week_cn`/`$filetree`）展开、thinking 上下文剥离、
orphan tool_result/tool_use 归一化，以及流式 token 速率采样与文案格式化。
共 21 文件 / 约 2200 行生产代码。

## 职责与边界

- **装配（`service/prompt/render-prompt.ts`）**：唯一的组装入口。三条并列路径共享同一套
  布局语义但**各写一遍**——`buildPromptAssemblyFromLayout`（预览分段）、
  `buildPromptLlmInputFromLayout`（真出站 messages）、`computeLlmExportZonesFromLayout`
  （三区边界，供 merge 用）。
- **配置校验（`domain/prompt/logic/validate-*.ts`）**：wire map → 域模型。
  `validate-agent-prompt-layout` 是现行三区校验器；`validate-prompt-blocks` 是**扁平
  `prompts.blocks[]` 旧形态**的校验器。
- **出站整形（`service/prompt/` + `normalize-for-llm-export.ts`）**：thinking 剥离、
  协议适配、orphan 工具块兜底。
- **指标展示（`domain/format/`）**：纯函数，token 速率滑窗、冻结速率 KKV 编解码、
  metrics 条文案。

## 对外接口

全部经 `packages/core/src/public/prompt.ts` 与 `public/format.ts` 转出。关键符号：
`buildPromptAssemblyFromLayout` / `buildPromptLlmInputFromLayout` /
`computeLlmExportZonesFromLayout` / `normalizeForLlmExport` /
`applyThinkingContextForLlm` / `resolvePreviewThinkingContext` /
`expandDynamicMacros` / `validateAgentPromptLayout*` /
`createTokenRateSampler` / `slidingTokenRate` / `parseStreamFinalRateSnapshot`。

## 数据访问

本区**不直接触碰表**，但经上下文间接携带以下 KKV 域：

| 域 | 路径 | 证据 |
|---|---|---|
| `file_cache` / `rule_snapshot` | 经 `PromptRenderContext.workplaceDisplay` 间接 | `model/prompt-render-context.ts:20` |
| 冻结速率快照（`nm-stream-final-rate` 一类） | session KKV 值编解码 | `domain/format/stream-final-rate.ts:43`、`:61` |

文件路径：本区无文件 IO。`workplaceFingerprint` 是 token 记忆缓存键
（`model/prompt-render-context.ts:42` → `infra/tokenizer/logic/chat-token-estimate-memo.ts:234`）。

## 依赖关系

**import 谁**：`domain/chat/content/*`（textBlocks、messageBodyTextFromBlocks、
readMessageMetadata）、`domain/agent/logic/resolve-saved-model-id`、
`domain/provider/logic/infer-llm-protocol-from-model-id`、
`infra/prompt-template/{macro-render,macro-scan,week-cn}`、`infra/date-format`、
`errors/prompt-errors`。

**被谁消费**：`service/agent/impl/agent-runner.ts:498`（`buildPromptLlmInputFromLayout`）、
`:553`（`computeLlmExportZonesFromLayout`）、`:566`（`normalizeForLlmExport`）、
`:574`（`applyThinkingContextForLlm`）、`:580`（`normalizeOrphanToolResultsForLlm`）；
`infra/tokenizer/logic/serialize-prompt-input.ts:20`（token 计数串）；
`apps/desktop|apps/mobile/src/services/{session-prompt-input,prompt-preview}.service.ts`；
`apps/cli/src/prompt/commands.ts:147`。

---

## 发现清单

### F-w8-prompt-pro-1 | P1 | `service/prompt/render-prompt.ts:67-93`

```
const persistCount =
  (options?.skillsIndex?.length ? 1 : 0) + (injectWorkplace ? 2 : 0) + ...
```

**描述**：zone 计算与实际组装对「技能索引段是否存在」用了**两套判定**。
组装侧 `buildPromptLlmInputFromLayout:358-361` 判 `layout.skillsEnabled !== false && ctx.skillsIndex 非空`；
zone 侧 `computeLlmExportZonesFromLayout:81` **只看 `skillsIndex.length`，不看 `skillsEnabled`**。

**实测证据**（`tmp/w8-probe-zone.ts`，layout `skillsEnabled:false` + 非空 skillsIndex）：
```
actual message ids: [prompt:workplace, prompt:workplace:done, prompt:persona, prompt:confirm, m1, m2, prompt:state, prompt:tail]
zones: {"persistCount":5,"dynamicCount":2}
persist prefix per zones: [..., 'm1']   ← 首条真实用户消息被误算进 persist 区
```

**后果链**：`persistCount` 虚高 1 → `normalize-for-llm-export.ts:37` 的 `resolveZone`
把首条真实 user 消息判成 persist 区 → `canMergeAdjacent:69` 不再拦截跨区 merge →
**常驻 persona 文本与真实用户输入被合成一条消息发出**。且每 step 都错，
前缀缓存的「纯追加」假设同时被破坏。

**缓解事实（须一并记录）**：生产侧目前**不会**触发——`resolveAgentToolRegistry:71`
在 `skillsEnabled===false` 时删掉 skill 工具 → `assembleSkillsToolContext:191`
返回 `undefined` → `budgetSkillsIndexEntries:137` 产出 `undefined`，
agent-runner 透传的 `skillsIndex` 恒空。所以这是**依赖跨文件隐式不变量**的脆弱点，
不是现网正在发生的故障。`skill-tool.test.ts:548` 的 TODO 与
`run-agent-turn.ts:182`「D4 置空联动属 Step 10」都说明该不变量**尚未被视为已完成契约**。

**建议**：zone 侧与组装侧共用同一判定（把 `skillsEnabled` 检查搬进
`computeLlmExportZonesFromLayout`），并补一条断言「zone 的 persist 前缀切片
必须与实际 messages 前缀 id 完全相等」的测试锁住不变式。

**置信**：confirmed（错位已实测；生产不可达由调用链推导确认）

### F-w8-prompt-pro-2 | P1 | `domain/prompt/logic/normalize-agent-prompt-layout.ts:54-74`

```
return {
  ...(layout.system != null ...),
  ...(layout.persistEnabled === true ? ... ),
  ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
  ...(layoutHasCustomAttach(layout) ? { customAttach: layout.customAttach } : {}),
  persist, dynamic: [...layout.dynamic],
};
```

**描述**：`normalizeAgentPromptLayoutDomain` 用**白名单重建** layout 对象，
但白名单**漏了 `skillsEnabled` 与 `skillsPrefix`** 两个字段。

**后果链**：唯一生产消费方 `resolveAgentDefinitionFromStorage`
（`config-forms/stored-config-validity/assess-agent-definition-wire.ts:86`）
对**域形态**存量定义（`agent_config_json.definition` / registry `get()` 返回值，
见该文件 `:73-77` 注释）走这个分支 → `skillsEnabled: false` 的 agent 读回来变成
**字段缺失** → 下游 `resolveAgentToolRegistry:71` 的
`=== false` 判不成立 → **skill 工具没被摘除、工具重新注册**，
用户已关闭的技能能力静默复活。反向地，`skillsPrefix` 丢失会让
`render-prompt.ts:174` 回落到 `DEFAULT_SKILLS_INDEX_PREFIX`，用户自定义前缀语失效。

**证据**：域模型 `model/agent-prompt-layout.ts:105`/`:110` 明确定义两字段，
`validate-agent-prompt-layout.ts:308-314` 写入时也**特意**处理了它们——
只有归一化这一处漏，是典型的复制粘贴漂移。

**置信**：confirmed（消费链完整，生产可达——域形态分支正是 registry 主路径）

### F-w8-prompt-pro-3 | P2 | `domain/prompt/logic/validate-prompt-blocks.ts`（整文件）

```
export function validatePromptBlocksFromMap(raw: unknown): readonly PromptBlock[]
export const validatePromptBlocks = validatePromptBlocksFromMap;
```

**描述**：扁平 `prompts.blocks[]` 校验器，**生产代码零消费**。全仓仅
`packages/core/test/prompt/validate-prompt-blocks.test.ts` 引用。
该形态已被三区 layout 取代——`validate-agent-prompt-layout.ts:83-86` 对
`type:"worktree"` 直接抛错提示改用 workplace，`assess-agent-definition-wire.ts:15`
把 `"prompts.blocks"` 列入 `REMOVED_FEATURE_KEYWORDS`。

**后果链**：175 行生产代码 + 178 行测试只锁一个已下线形态。真正的成本是
**认知税与误改风险**：新人搜到 `validate-prompt-blocks.ts` 会以为它是现行校验入口；
且 `type:"abstract"` / `type:"chat"` 的错误文案仍在教用户已被删除的语法
（`:131-136`）。另与 RULE「10 个版本后清退役迁移」的退役节奏不冲突——这是纯代码非迁移。

**建议**：连同 `model/prompt-block.ts`（`PromptBlock` / `PromptBlockRole` 类型仅
此文件使用）与测试一并删除；若需保留历史报错文案，改挂到
`REMOVED_FEATURE_KEYWORDS` 的提示路径上。

**置信**：confirmed（全仓消费方仅测试）

### F-w8-prompt-pro-4 | P2 | `config-forms/stored-config-validity/types.ts:9` + `assess-agent-definition-wire.ts:65-68`

```
export type StoredConfigInvalidCode = "outdated_version" | "broken_wire" | "removed_feature";
...
const code: StoredConfigInvalidCode = isRemovedFeatureError(error) ? "removed_feature" : "broken_wire";
```

**描述**：`outdated_version` 与 `storedSchemaVersion` 是**不可达分支**。
`assessAgentDefinitionWire` 的 ternary 只有两个出口，`storedSchemaVersion` 从未被写入；
但消费侧 `apps/desktop/src/main/ipc/handlers/agent-registry.ts:87`、
`stored-config-health-dto.ts:17` 都在读它，
`labels.ts:15` 还为它备了用户可见文案。

**后果链**：`storedSchemaVersion` 恒 `undefined` → DTO 的 spread 恒不触发 →
IPC 类型 `ipc-types.ts:1272` 里这个联合成员是纯装饰。新增按版本迁移的智能体
schema 时会误以为「已接好版本判定」，实际要新写产出点。

**建议**：要么删掉这两个成员，要么补上真正的版本比较产出点（当前
`CURRENT_AGENT_SCHEMA_VERSION = 1` 已有常量但无人比对）。

**置信**：confirmed（唯一产生点即该 ternary）

### F-w8-prompt-pro-5 | P2 | `domain/prompt/model/prompt-render-context.ts:28-29`

```
/** Session VFS（其他调用方仍可传；`{{$filetree}}` 不再读取）。 */
readonly vfs?: VfsService;
```

**描述**：`vfs` 字段**只写不读**——注释已自陈「不再读取」。全仓消费点为
`PromptRenderContext` 的 12 处引用中，无一读 `ctx.vfs`；唯一的读取语义在
`expand-dynamic-macros.ts:35` 走的是 `ctx.workplace`。
而生产侧仍在**积极填充**它：`agent-runner.ts:428`、`:444`、`:489` 三处
`vfs: this.deps.toolCtx.vfs`。

**后果链**：每次 prepare 组装都在构造一个永远没人用的 VFS 句柄，
读者会误以为存在 VFS 直读的展开路径；`expandDynamicMacros` 的
`DynamicMacroContext` 干脆连 `vfs` 都没有，两侧模型不一致。

**建议**：删字段与三处填充点；若为兼容保留，请在类型上标 `@deprecated`
并注明移除条件。

**置信**：confirmed（消费方检索为空）

### F-w8-prompt-pro-6 | P3 | `domain/prompt/logic/agent-prompt-layout.ts:33-34`

```
/** @deprecated 域 persist 仅 text；请用 {@link PersistTextPromptBlock}。 */
export type PersistPromptBlock = EditorPersistPromptBlock;
```

**描述**：`PersistPromptBlock` 别名被 `public/prompt.ts:11` 导出为公开面，
但与 `EditorPersistPromptBlock`（`:29`）是同一个联合类型——两个名字指向同物，
且都被 `@deprecated` 标注。

**后果链**：公开 API 面上出现两个语义重叠的废弃类型，调用方无从判断该用哪个；
`PersistWorktreePromptBlock`（`:21`）同理，域模型已无 worktree 块，
它只为编辑器过渡态保留却挂在域文件里。

**建议**：公开面只留 `PersistTextPromptBlock`；编辑器过渡形状移到
`config-forms/agent` 一侧，别让废弃形状挂在域模型上。

**置信**：confirmed

### F-w8-prompt-pro-7 | P3 | `domain/prompt/logic/normalize-agent-prompt-layout.ts:24`

```
export function isLegacyWorktreeWireBlock(block: unknown): block is LegacyPersistWorktreeWireBlock
```

**描述**：该导出仅被**同文件 `:43`** 一处内部使用，无外部消费方。

**建议**：去掉 `export`，收窄模块公开面。

**置信**：confirmed

### F-w8-prompt-pro-8 | P3 | `service/prompt/render-prompt.ts:99-109`

```
const lines = trimmed.split("\n");
if (lines.length === 1) { return `${role}: ${lines[0]}`; }
return `${role}: ${lines[0]}\n${lines.slice(1).join("\n")}`;
```

**描述**：`formatSegment` 的两分支**恒等**——多行分支只是把 split 再 join 回去，
结果与 `${role}: ${trimmed}` 完全一致（`lines[0]` + `\n` + 其余行 = 原串）。

**后果链**：读者会以为多行有特殊处理（如续行缩进）而去改它；纯噪声分支。

**建议**：合并为单行实现。

**置信**：confirmed

### F-w8-prompt-pro-9 | P3 | `service/prompt/render-prompt.ts:111-196`

```
function syntheticTemplateMessage(...)
function syntheticWorkplaceUserMessage(...)
function syntheticWorkplaceDoneMessage(...)
function syntheticSkillsIndexMessage(...)
```

**描述**：四个 `synthetic*` 工厂函数是同一段 `ChatMessage` 字面量的复制，
差异仅 `id`/`role`/`content`，共同点 `sessionId/seq:0/provider/raw/createdAtMs/hidden`
五字段逐份重写。

**后果链**：与 F-2 同源的复制粘贴风险已经真实发生过一次（技能字段就是在某个
重建点被漏掉）。这类「白名单重建」在字段演进时会持续出血。

**建议**：抽一个 `syntheticMessage(id, role, content, ctx)` 单一工厂，
其余函数退化为一行调用。

**置信**：confirmed

### F-w8-prompt-pro-10 | P3 | `service/prompt/apply-thinking-context-for-llm.ts:47-56`

```
for (let i = messages.length - 1; i >= 0; i--) {
  const message = messages[i]!;
  if (message.role !== "assistant") { continue; }
  const hasToolUse = (...).some((b) => b.type === "tool_use");
  return hasToolUse ? i : -1;
}
```

**描述**：`findProtocolMinimumRetainIndex` 倒序扫描、**只看最后一条 assistant**，
找到即 `return`（要么它的下标要么 `-1`），循环的继续分支只在「末尾全是
非 assistant」时才会跑到并落到 `:56` 的 `return -1`。

**后果链**：`continue` 与循环后 `return -1` 是同一结果，`:56` 的 `return -1`
只在末尾无 assistant 时可达，与「找到即返回」的主路径逻辑重叠。
行为本身正确（与模块注释「不回溯更早的 assistant」一致），但可读性上
暗示了「会继续往前找」的错误预期。

**建议**：改为 `const last = messages.findLast(m => m.role === "assistant")` 一行。

**置信**：confirmed

### F-w8-prompt-pro-11 | P2 | `service/prompt/normalize-orphan-tool-results-for-llm.ts:19-31`

```
function isToolResultPairedInVisible(toolUseId: string, visibleMessages: readonly ChatMessage[]): boolean {
  for (const msg of visibleMessages) {
    for (const block of msg.content.blocks) {
      if (block.type === "tool_use" && block.id === toolUseId) { return true; }
```

**描述**：文档与函数名都强调「配对基于**可见**历史，hidden 的 tool_use 不算」，
但实现**不过滤 hidden**——它直接遍历传入的 `messages` 全量。

**后果链**：调用方 `agent-runner.ts:580` 传入的是 `strippedMessages`，
其来源 `exportMessages` 已由 `normalizeForLlmExport` 处理，但那条链路
**不做 hidden 过滤**（hidden 过滤发生在更早的 `render-prompt.ts:379`）。
若上游某天把含 hidden 的数组直接喂进来，本函数的可见性契约即被静默破坏，
且**没有任何断言或测试锁住「不读 hidden」**。

**建议**：在函数入口显式 `messages.filter(m => !m.hidden)`（成本 O(n)，与
`render-prompt.ts:305` 的口径对齐），或补一条 hidden 夹具测试把契约钉死。

**置信**：suspected（当前调用链可能恰好无 hidden 消息，未逐层确认到 hidden 是否可能残留）

### F-w8-prompt-pro-12 | P3 | `domain/format/sliding-token-rate.ts:63-70`

```
let firstIndex = lastIndex;
while (firstIndex > 0 &&
  samples[firstIndex - 1]!.tMs >= windowStartMs &&
  samples[firstIndex - 1]!.tMs <= nowMs) { firstIndex -= 1; }
```

**描述**：窗口回溯循环一旦遇到**窗口外样本就整体停止**（不再往更早方向找），
这在序列按 `tMs` 升序（模块注释保证）时是正确的早停优化。但第二个条件
`tMs <= nowMs`（`:67`）与前置的未来样本剔除（`:54-56`）**语义重复**——
`lastIndex` 之后的样本才可能是未来样本，而循环只看 `firstIndex - 1 < lastIndex`。

**后果链**：无行为差异，属冗余判定。但它让读者以为窗口内可能混入未来样本，
增加了维护时的推理成本。

**建议**：删掉 `&& samples[firstIndex - 1]!.tMs <= nowMs`，并在注释里
点明「`firstIndex - 1 < lastIndex`，故恒 ≤ nowMs」。

**置信**：confirmed

---

## 争议与存疑

1. **F-1 的严重度**：若按「现网是否正在出错」衡量，`skillsEnabled=false` 时
   `skillsIndex` 恒空（`resolve-agent-tool-registry.ts:71` →
   `assembleSkillsToolContext:191` → `budgetSkillsIndexEntries:137`），
   生产**不会**触发错位。因此我给 P1 是按「跨文件隐式不变量 + 已实测存在错位代码路径」
   定级，而非按现网故障。若 reduce 阶段认为应降级，我的意见是可降为 P2，
   但**修复本身（两侧共用判定）仍应做**——正因 `skill-tool.test.ts:548` 的
   TODO 与 `run-agent-turn.ts:182` 的「属 Step 10」表明该不变量尚未固化为契约。

2. **F-2 是否生产可达**：`resolveAgentDefinitionFromStorage` 的域形态分支，
   我确认了 desktop 侧**显式禁止**再导出该函数
   （`apps/desktop/shared/logic/config-forms-stored-config-validity.ts:5`「禁止再导出
   `resolveAgentDefinitionFromStorage`」，走 IPC assessed DTO）。因此 desktop 编辑器路径
   不走它。但 core 自身与 mobile 的消费方我只查到测试引用，
   **未能排除存在通过 `config-forms/stored-config-validity/index.ts:11` 间接调用的生产点**——
   该 index 确实导出了此函数。建议 reduce 阶段派验证代理确认 mobile/CLI 侧可达性；
   无论是否可达，字段白名单遗漏本身是确定缺陷。

3. **RULE 拍板项（已标 intentional，不当问题报）**：
   - **回合快照**：`expand-dynamic-macros.ts:32` 的 `content.includes("$filetree")`
     预检 + `ctx.filetree ?? workplace.renderFileTree()` 双形态
     ——RULE「回合快照」条目（`docs/apm/RULE.md:19`）明写「不改文本时零预取
     （沿用 `includes("$filetree")` 预检）」，**故意设计**，标 intentional。
   - **`$filetree` 预检子串匹配**：`includes` 会把 `$filetreeXYZ` 也当作命中，
     属多算一次 IO（最坏退化为实时渲染空串）。因 RULE 已拍板沿用该预检，
     不单独报，仅在此备注。
   - **slash 冗余分支**：`validate-agent-prompt-layout.ts:259` 的
     `options?.persistEnabled === true`（`=== true` 显式比较）、
     `render-prompt.ts:75` 的 `layout.persist.length` 先存 `textBlockCount`——
     均属可读性偏好，不报。

4. **未纳入清单的观察**：`validate-agent-prompt-layout.ts:309-314` 用内联 IIFE
   展开 `skillsPrefix` 条件 spread，与其余字段的写法不一致（可读性，P3 以下，
   未单列）；`render-prompt.ts:118/136/154/189` 四处 `ctx.messages[0]?.sessionId ?? ""`
   在 `messages` 为空时产出空 `sessionId`，属合成消息的无害兜底，未报。

## 方法与只读纪律

- 未读取 `raw/` 下任何其他机位报告与 `synth/`（独立性纪律）。
- 全程无 git 写；未创建/修改 `docs/apm/` 下任何文件（仅只读 `RULE.md`）。
- 数字结论均为实测：zone 错位与 workplaceDisplay 三情形均由
  `tmp/w8-probe-zone.ts` / `tmp/w8-probe-wt.ts` 探针实跑得出；
  基线测试 `test/prompt/*.test.ts test/domain/format/*.test.ts` 实跑 **151 pass / 0 fail**。
- 探针脚本与临时产物落在 `tmp/`（已 gitignore），非 scratch 盘根。