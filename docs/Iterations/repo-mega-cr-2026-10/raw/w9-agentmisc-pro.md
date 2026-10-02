---
zone: w9-agentmisc-pro
agent: 检察官（对抗机位·猎杀冗余/死路径/不一致）
files_scanned: 51
---

# W9 agentmisc-pro 报告（对抗机位·检察官）

## 摘要

九个小域拼成 core 的「智能体骨架」：agent 定义与其校验/patch 合并/工具策略过滤、
agent 会话端口、session_run_state 行模型与仓储、角色卡 PNG/JSON→md 树转换链、
尾深度（depth）计算与 hide-message 区间锚定、事件名与载荷类型、user-VFS 统一
tool turn 开关、模块级 KKV 仓储、压缩条件（token 比率 / 可见条数 floor）触发器、
智能排序规则的编译/预览/导入导出与仓储。整体是纯逻辑 + 薄仓储层，单文件均短、
注释密度高。**问题集中在导出面过剩（内部专用却 export）与单源声明被平行实现
打破**，无 P0。

## 职责与边界

- **定义面**：`agent/model/*` 定义 `AgentDefinition` wire↔domain 往返；`logic/validate-*`
  把写入门禁与读门禁钉在同一 schema 上；`merge-agent-definition-patch` 承担 LLM
  「改什么填什么」的 patch 语义。
- **运行面**：`agent/session/agent-session.port` 是 runner 唯一的会话抽象； doom-loop
  是 runner 的两层循环熔断；`agent-run-id` 是 runId 单源。
- **状态面**：`session-run-state` 只存「每 session 一行」的 run 快照 + 计数指标，
  供跨重启水合「上次生成」。
- **转换面**：character-card 是把 SillyTavern 角色卡（PNG tEXt/chara 或 JSON）
  规范化为 VFS 相对路径 md 树的纯函数链，带体积三闸。
- **触发面**：compaction-conditions 定义「该不该压缩」（OR 组合）与压缩文档 schema。
- **排序规则面**：smart-sort-rule 负责规则 CRUD 仓储、正则编译/校验、编辑器预览
  （匹配 + 高亮切分 + `/p/f` 字面量解析）与 YAML bundle 导入导出。

## 对外接口（关键导出）

| 符号 | 位置 |
|---|---|
| `agentDefinitionSchema` / `agentDefinitionDocumentSchema` / `promptsDocumentSchema` | `domain/agent/model/agent-definition.schema.ts:136,277,88` |
| `validateAgentDefinition` / `validateAgentToolPolicy` | `domain/agent/logic/validate-agent-definition.ts:26`、`validate-agent-tool-policy.ts:55` |
| `resolveAgentToolRegistry` | `domain/agent/logic/resolve-agent-tool-registry.ts:57` |
| `resolveSavedModelId` / `resolveSummarySavedModelId` | `domain/agent/logic/resolve-saved-model-id.ts:27,39` |
| `DOOM_LOOP_THRESHOLD` / `CROSS_ROUND_WINDOW` / `assertNoDoomLoopInBlocks` / `assertNoCrossRoundDoomLoop` | `domain/agent/logic/doom-loop.ts:14,16,59,73` |
| `AgentSession`（port）/ `InMemoryAgentSession` | `domain/agent/session/agent-session.port.ts:16`、`impl/in-memory-agent-session.ts:18` |
| `AgentRunResult` / `ModelRoundSummary` | `domain/agent/model/agent-run-result.ts:18,10` |
| `matchDepth` / `validateDepthSlice` / `messageIdsInSlice` | `domain/depth/logic/depth-slice.ts:16,29,53` |
| `depthByMessageId` / `listVisibleForDepth` | `domain/depth/logic/depth-from-tail.ts:19,31` |
| `resolveHideMessageRange` | `domain/depth/logic/resolve-hide-message-range.ts:53` |
| `compactionConditionsSchema` / `DEFAULT_HIDE_START_DEPTH` / `CompactionConditions` | `domain/compaction-conditions/model/*` |
| `CompactionConditionTrigger` / `CompositeConditionTrigger` / `TokenRatioConditionTrigger` / `VisibleFloorTrigger` | `domain/compaction-conditions/{ports,triggers}/*` |
| 9 个 `EVENT_*` 常量 + `NovelMasterEventType` + 9 个 Payload | `domain/events/model/event-types.ts:8-120` |
| `isUserVfsUnifiedToolTurnEnabled` 等 4 个 | `domain/feature-flags/user-vfs-unified-tool-turn.ts` |
| `KkvRepository` / `KkvReaderPort` | `domain/kkv/repositories/kkv.port.ts:12`、`ports/kkv-reader.port.ts:8` |
| `SessionRunStateRepository` / `SessionRunState` | `domain/session-run-state/repositories/*`、`model/session-run-state.ts:39` |
| 角色卡全链（`parseCharacterCardToMdTree` 等 12 个） | `domain/character-card/**` |
| smart-sort-rule 全链（14 个文件全导出） | `domain/smart-sort-rule/**` |

## 数据访问

| 表 / 域 | 触点 |
|---|---|
| `agent_definition`（`agent_id`/`prompts_json`） | `agent/repositories/impl/sqlite-agent-definition.repository.ts:37,47,61,74,88,104,113` |
| `session_run_state` | `session-run-state/repositories/impl/sqlite-session-run-state.repository.ts:69,82,131,142,150` |
| `kkv_entry`（module/key/value） | `kkv/repositories/impl/sqlite-kkv.repository.ts:37,47,61,71` |
| `smart_sort_rule` | `smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.ts:53,65,79,105,133,141,151` |
| VFS（只读引用常量/路径校验） | `character-card/logic/validate-md-tree-paths.ts:8,12`（引 `VFS_ZIP_MAX_ENTRY_PATH_LEN` / `assertLogicalPathAllowed`） |
| 模块级内存态（非表） | `feature-flags/user-vfs-unified-tool-turn.ts:14`（`preferenceSnapshot`） |

写路径全部是单语句 UPSERT/DELETE，`session-run-state` 端口注释明确「不进事务」
（`session-run-state.port.ts:16-19`），与 RULE 的 tdbc 嵌套事务铁律一致——**无违例**。

## 依赖关系

- **import 谁**：`domain/chat/model/message`、`domain/prompt/logic/*`（prompt layout wire/
  校验/normalize）、`domain/tool/builtin/vfs-tools`（`normalizeAgentToolPolicyName`、
  `FILE_TOOL_NAMES`）、`domain/tool/logic/tool-registry`、`domain/workplace/logic/smart-sort`、
  `domain/vfs/logic/*`、`infra/tdbc/*`、`infra/serialization/*`、`infra/tokenizer/*`、
  `errors/*`、`service/session-kkv/session-kkv.port`（触发器端口引 service 类型，唯一一处域→service 反向依赖）。
- **被谁消费**：`service/agent/*`（runner / registry / run-agent-turn）、
  `service/compaction-conditions/*`、`service/smart-sort-rule/*`、`service/workplace/*`、
  `service/vfs/impl/character-card-import.service.ts`、`service/session-run-state/*`、
  `service/kkv/*`、`infra/db-maintenance/*`，以及三个 public barrel
  （`public/agent.ts`、`public/compaction.ts`、`public/smart-sort-rule.ts`、`public/feature-flags.ts`）。
  移动端/desktop 经 `@novel-master/core/<subpath>` 消费 feature-flags 与 smart-sort。

## 发现清单

### F-w9-agentmisc-pro-1 | P2 | agent/logic/doom-loop.ts:78-84 ＋ agent/model/agent-definition.schema.ts:149

```ts
if (crossRoundWindow < 4 || crossRoundWindow % 2 !== 0 || toolUses.length < crossRoundWindow) { return; }
```
```ts
doomLoopCrossRoundWindow: z.number().int().positive().optional(),
```

**描述**：schema 对 `runtime.doomLoopCrossRoundWindow` 只约束「正整数」，而跨轮 ABAB
检测的算法前提是「≥4 且为偶数」。用户/agent 配成 3 或 5 时，`agent-runner.ts:798`
照传，函数**静默 return**——熔断被无声关闭，写入侧与读出侧都不报错，也无 UI 提示。
（runner 侧窗口裁剪 `> crossRoundWindow * 4` 同样按该值算，配错时窗口也随之变形。）
**建议**：schema 侧改为 `z.number().int().min(4).refine(v => v % 2 === 0)`，或在
`validateAgentDefinition` 里补一条 runtime 约束校验，让非法值在写入时报 `INVALID_SCHEMA`。
**置信**：confirmed（schema 与算法条件逐字对照）

### F-w9-agentmisc-pro-2 | P2 | compaction-conditions/logic/token-estimate.ts:10-15

```ts
const _heuristic = new HeuristicTokenCounter();
export function estimateTokens(messages: readonly ChatMessage[]): number {
  return _heuristic.countMessages(messages);
}
```

**描述**：全仓 `grep -rn -w estimateTokens packages/core/src packages/core/test apps`
只有两处命中——本文件与 `packages/core/test/infra/tokenizer/heuristic-token-counter.test.ts:29`，
生产侧**零调用**（token-ratio 触发器早已改走 `resolveCurrentPromptTokens`）。
更糟的是那条测试是恒真断言：
`assert.equal(counter.countMessages(messages), estimateTokens(messages))` 两边同调一个方法，
按 RULE「验收断言要有牙」第①条判据（把实现改成错的它也不红）属于废断言，
却让这个死模块在覆盖率上看起来有「使用方」。
**建议**：删除 `token-estimate.ts`（连同那条恒真断言改写为对 `CHARACTERS_PER_TOKEN_RATIO`
的独立算式断言）。
**置信**：confirmed（实测 grep 全仓）

### F-w9-agentmisc-pro-3 | P2 | depth/logic/depth-slice.ts:70-77

```ts
export function depthSliceFromWire(raw: Record<string, unknown>): DepthSlice {
```

**描述**：`depthSliceFromWire`（kebab/camel 双字段解析）在 `packages/core/src`、`packages/core/test`、
`apps/**` 三处 grep 下**只命中自身定义**，没有 public barrel 再导出、没有任何消费方。
同文件另两个导出（`matchDepth`/`validateDepthSlice`/`messageIdsInSlice`）都有活跃调用。
属事件编排器移除后的残留（深度 slice 曾从事件配置 wire 解析而来，见
`service/compaction-conditions/impl/compaction-conditions-store.service.ts` 已改为直接构造）。
**建议**：删除该函数；若确有 CLI/YAML 入口需求，走 public barrel 显式暴露后再实现。
**置信**：confirmed

### F-w9-agentmisc-pro-4 | P2 | depth/logic/depth-from-tail.ts:19-28 ＋ public/compaction.ts:8

```ts
export function depthByMessageId(visibleMessages: readonly ChatMessage[]): ReadonlyMap<string, number> {
```
```ts
export { depthByMessageId, listVisibleForDepth } from "../domain/depth/logic/depth-from-tail.js";
```

**描述**：`depthByMessageId` 只被 `public/compaction.ts` 再导出，全仓（src/test/apps）无任何
import。压缩链路实际只用同文件的 `listVisibleForDepth`（`hide-message.action.ts:20,57`）。
即：**对着已发布的公共 API 子路径挂了一个永不执行的导出**，双端/外部调用方按 barrel
文档猜接口时会踩空。
**建议**：删除 `depthByMessageId` 与 barrel 里对应行；若确有外部消费者需求则补测试锁定。
**置信**：confirmed

### F-w9-agentmisc-pro-5 | P2 | 九处「只在本文件内被用」的 export（导出面过剩）

| 符号 | 定义位置 | 仓内消费方 |
|---|---|---|
| `depthFromTailIndex` | `depth/logic/depth-from-tail.ts:11` | 仅同文件 `depthByMessageId` |
| `persistBlockValueSchema` | `agent/model/agent-definition.schema.ts:25` | 仅同文件 |
| `dynamicTextBlockValueSchema` | `agent/model/agent-definition.schema.ts:27` | 仅同文件（已随 `export{}` 出 barrel 但无人 import） |
| `DoomLoopChecksConfig` | `agent/logic/doom-loop.ts:18` | 仅同文件 |
| `DEFAULT_HEURISTIC_SAFETY_FACTOR` | `compaction-conditions/triggers/token-ratio.trigger.ts:37` | 仅同文件默认回退 |
| `DEFAULT_HIDE_START_DEPTH`（schema 侧再导出） | `compaction-conditions/model/compaction-conditions.schema.ts:52` | 无人从该路径 import（barrel 走 model 文件） |
| `normalizedCardToMdTree` | `character-card/logic/character-card-to-md-tree.ts:112` | 仅同文件 |
| `stripUtf8BomText` | `character-card/logic/parse-character-card-json.ts:15` | 仅同文件 |
| `assertMdTreeRelativePathAllowed` | `character-card/logic/validate-md-tree-paths.ts:26` | 仅同文件 |
| `extractPngCharaBase64` | `character-card/logic/extract-png-chara.ts:58` | 仅同文件（`extractPngCharaJsonText` 内部） |

**描述**：这批符号均只在定义文件内部被调用，却被 `export`，其中三个还被
`export { … }` 追加到 barrel 尾部（`agent-definition.schema.ts:282-286`），等于
把内部实现细节抬成公共 API 契约。典型危害：`persistBlockValueSchema` 与
`persistTextBlockValueSchema` 同物两名（见 F-14），外部无法判断哪个是权威。
**建议**：逐个去掉 `export`（保留内部函数），barrel 里的再摘掉；如确有外部依赖
（CLI/desktop）先补上 import 再保留。
**置信**：confirmed（逐符号 `-w` 全仓 grep，只列上表即为「仅同文件」）

### F-w9-agentmisc-pro-6 | P3 | depth/logic/depth-slice.ts:16-26

```ts
const start = slice.startDepth ?? 0;
const end = slice.endDepth ?? INFINITY;
if (slice.startDepth == null && slice.endDepth != null) { return depth <= end; }
if (slice.startDepth != null && slice.endDepth == null) { return depth >= start; }
return depth >= start && depth <= end;
```

**描述**：两个前置分支是纯冗余。`startDepth == null` 时 `start = 0`，而 depth 恒 ≥0，
`depth >= 0` 恒真，于是通用表达式 `depth >= start && depth <= end` 与分支结果**逐例相等**；
`endDepth == null` 时同理（`INFINITY`）。三分支可塌缩成一行。
**建议**：删掉两个 if，只留 `return depth >= start && depth <= end`（并在 `validateDepthSlice`
已保证非负整数的前提下成立），或至少补注释说明为何要保留可读性分支。
**置信**：confirmed（`validateDepthSlice` 已挡负数，调用链 `messageIdsInSlice` 先调它）

### F-w9-agentmisc-pro-7 | P3 | depth/logic/resolve-hide-message-range.ts:53-57

```ts
export function resolveHideMessageRange(
  visible: readonly ChatMessage[],
  _slice: DepthSlice,
  messageIds: readonly string[]
)
```

**描述**：`slice` 参数被下划线前缀显式弃用，函数体只按 `messageIds` 集合 + seq 区间工作。
唯一调用方 `hide-message.action.ts:73` 仍在实参位置传 `slice`。死参数会诱使后续维护者
误以为区间语义由 slice 决定（实际由 `messageIdsInSlice` 预先算出 id 集合决定）。
**建议**：删参数并同步改调用点；若为将来保留则注释写明「保留是为了签名可读」，
否则属于纯负担。
**置信**：confirmed

### F-w9-agentmisc-pro-8 | P3 | depth/logic/depth-slice.ts:61

```ts
const depth = n - 1 - i;
```

**描述**：与 `depth-from-tail.ts:11` 的 `depthFromTailIndex(n, i)` 是同一公式的第二份实现，
且后者就在同域内（`depthFromTailIndex` 甚至被本文件所在目录 import 不到——反向依赖）。
两处若有一处改动（尾深度口径变化）就会静默分叉。
**建议**：`messageIdsInSlice` 改调 `depthFromTailIndex`，或把该公式提到 `depth-slice.ts`
并让 `depth-from-tail.ts` 反向引用，消除双源。
**置信**：confirmed

### F-w9-agentmisc-pro-9 | P3 | smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.ts:21-31

```ts
(["smart", "fixed_min", "fixed_max"] as const).includes(captureKind as …)
  ? (captureKind as SmartSortCaptureKind) : "smart",
```

**描述**：值域单源 `SMART_SORT_CAPTURE_KINDS`（`smart-sort-rule.ts:36`，注释明写
「DDL CHECK / CLI 校验 / GUI 选项共用单源」）在本仓储被平行实现成硬编码三元组，
`smart-sort-rule-io.ts:30` 与 `smart-sort-rule.schema.ts:18` 都是引单源的。
新增第四档（拍板很可能发生，spec 风格一直在加档）时此处会静默回落成 `"smart"`。
**建议**：改用 `SMART_SORT_CAPTURE_KINDS.includes(captureKind as SmartSortCaptureKind)`。
**置信**：confirmed

### F-w9-agentmisc-pro-10 | P3 | kkv/ports/kkv-reader.port.ts:8-12 vs kkv/repositories/kkv.port.ts:12-20

```ts
export interface KkvReaderPort { get(module,key): Promise<string>; set(...); delete(...); }
```
```ts
export interface KkvRepository { get(module,key): Promise<KkvEntry|null>; … }
```

**描述**：同一张 `kkv_entry` 表在 `domain/kkv` 下并存两套端口，`get` 返回形态还不同
（裸 string vs 包装 entry）。`KkvReaderPort` 全仓仅一个消费方
（`domain/provider/repositories/impl/kkv-model-suggestion.repository.ts:37`），
而 `KkvRepository` 走 `service/kkv` 包装。两套签名让「KKV 读口」这件事没有单源，
新增消费方时无从判断该实现哪个。
**建议**：合并为一个端口（或让 `KkvReaderPort extends Pick<KkvRepository, …>`），
把 provider 域那处窄化需求改为 `Pick<KkvService, 'get'|'set'>` 之类的显式投影。
**置信**：confirmed（两端口 grep 消费方数如上）

### F-w9-agentmisc-pro-11 | P3 | events/model/event-types.ts:45

```ts
readonly stopReason: string;
```

**描述**：`AgentRunResult["stopReason"]` 是四值字面量联合
（`agent/model/agent-run-result.ts:22`），事件载荷却放宽成任意 `string`。
实测三个 publish 点（`agent-runner.ts:965`、`run-agent-turn.ts:411`）传的都是联合内字面量，
所以暂无实害；但载荷是跨进程（desktop forward-event-bus）契约，放宽后下游
（`ShellNavProvider`/`useAgentStream`）失去穷尽检查能力，新增 stopReason 时不会被编译期发现。
**建议**：改为 `AgentRunResult["stopReason"]`（events → agent 的类型 import 无环风险，
两者都已是无依赖叶子模块）。
**置信**：suspected（当前无实害，属类型收窄机会）

### F-w9-agentmisc-pro-12 | P3 | events/model/event-types.ts:89

```ts
readonly source: "usage";
```

**描述**：token 来源的枚举单源在 `session-run-state/model/session-run-state.ts:21`
（`StreamTokenSource = "usage" | "heuristic"`），事件载荷却又内联了一份字面量，
且注释解释「heuristic 兜底不经事件总线」——即**有意为之的分叉**。
问题在于没有 import 那个类型，两处将来任一新增/改名都不会互相牵动。
**建议**：若口径确定不再变，改为 `source: StreamTokenSource & "usage"` 或直接
`source: Extract<StreamTokenSource, "usage">`，让注释里的「单源」在类型层也成立。
**置信**：suspected（行为有意，缺的是类型锚定）

### F-w9-agentmisc-pro-13 | P3 | agent/model/agent-definition.schema.ts:215-216

```ts
model: doc.model,
runtime: doc.runtime,
```

**描述**：`documentToDefinition` 无条件写入 `model` / `runtime` 两个键，缺省时值为
`undefined`。领域类型声明的是 `readonly model?: string`（可选属性），对象上却带
一个「值为 undefined 的自有属性」。当前 `exactOptionalPropertyTypes` 未开、不影响编译，
但 `{...current}` 浅合并（`merge-agent-definition-patch.ts:29`）与 `Object.entries`
类逻辑会对该键有不同观感；同文件其它字段（`description`/`mode`/`tools`）都已用
展开条件写法保持一致，唯独这两行不是。
**建议**：改为 `...(doc.model != null ? { model: doc.model } : {})` 等，与邻近风格统一。
**置信**：suspected

### F-w9-agentmisc-pro-14 | P3 | agent/model/agent-definition.schema.ts:25

```ts
const persistBlockValueSchema = persistTextBlockValueSchema;
```

**描述**：纯别名。语义上 persist 块与 dynamic 块的差别在 `lifecycle` 字段
（`dynamicTextBlockValueSchema:32` 有、persist 无），此别名暗示「将来两者会分叉」，
但当前是同一对象；双名并存让 F-5 里的「哪个是权威」问题更具体。
**建议**：persist 位置直接引 `persistTextBlockValueSchema`，或把别名注释为
「刻意别名以标记语义位点」；当前无注释，属无解释的中间层。
**置信**：confirmed

### F-w9-agentmisc-pro-15 | P3 | character-card/logic/extract-png-chara.ts:72

```ts
if (crcEnd > bytes.length || length < 0) {
```

**描述**：`length` 由 `readUInt32BE`（`:35-43`）经 `>>> 0` 得到，恒为 `[0, 2^32)` 的
非负数，`length < 0` 恒假——死条件。边界防护实际只靠 `crcEnd > bytes.length`。
**建议**：删 `length < 0`；若原意是防 `offset+length` 溢出（大 length 时
`dataEnd` 可能溢出到负），应改成对 `dataEnd`/`crcEnd` 的显式上界检查。
**置信**：confirmed

### F-w9-agentmisc-pro-16 | P3 | depth/logic/resolve-hide-message-range.ts:68-69 ＋ service/compaction-conditions/hide-message.action.ts:66-68

```ts
const seqs = inSlice.map((m) => m.seq);
const minSeq = Math.min(...seqs);
```

**描述**：`Math.min(...arr)` 展开为函数实参，超长会话（可见消息十万量级）会撞
V8 实参上限抛 `RangeError`。当前 slice 窗口通常几十条（hideStartDepth 默认 6），
`hide-message.action` 那次展开也只对窗口内 id 集合做，故属低概率；
但这是一条「数据量涨上去才会炸」的路径，且压缩恰好发生在长会话上。
**建议**：改成单次 `for` 归约取 min/max（窗口本来就很小，收益主要在健壮性）。
**置信**：suspected

### F-w9-agentmisc-pro-17 | P3 | feature-flags/user-vfs-unified-tool-turn.ts:14,22

```ts
let preferenceSnapshot: boolean | undefined;
export function resetUserVfsUnifiedToolTurnSnapshotForTests(): void { preferenceSnapshot = undefined; }
```

**描述**：生产模块持有可变模块级状态，并额外导出**纯测试用**的重置函数
（`reset…ForTests`），随 `dist` 一起发给三端。RULE 的其它「测试辅助」惯例是放在
测试侧或 `__DEV__` 门控后；另外 `:32` 直接读 `process.env`，RN/Hermes 侧
`process.env` 仅有 `NODE_ENV`，该分支在移动端恒不命中（属可接受的运维口径，但值得写进注释）。
接线本身**是活的**：desktop `vfs.ts:161` 等 4 处、`mobile VfsFileManager.tsx:176`
`FileEditorScreen.tsx:177`、CLI/desktop/mobile 三处 runtime 均在用，故本条只是形态问题、非死路径。
**建议**：重置函数移出 dist（挪到测试 helper），`process.env` 分支补「移动端恒不命中」注释。
**置信**：confirmed（接线已实测）

### F-w9-agentmisc-pro-18 | P3 | compaction-conditions/model/compaction-conditions.schema.ts:19,21

```ts
"visible-floor": z.number().int().nonnegative().optional(),
"hide-start-depth": z.number().int().nonnegative().optional(),
```

**描述**：schema 已经是 `schemaVersion: 4` 严格文档，却仍保留 kebab-case 双写别名。
按 store 实现（`compaction-conditions-store.service.ts`），v2/v3 文档都先被迁移成
camelCase 的 v4 原型再 decode，**v4 文档里不该再出现 kebab 键**——这两个字段只在
「绕过 store、直接把 v4 文档写进 KKV」时才会命中，属残留兼容面。
**建议**：与 RULE「迁移退役到期项」节奏一并清（当前基线 v1.5.5，第五轮清理窗口未到，
故只登记不催）；transform 里的 `?? doc["visible-floor"]` 可同步删。
**置信**：suspected（清理窗口未到，不作为本轮必修）

### F-w9-agentmisc-pro-19 | P3 | depth/logic/depth-from-tail.ts:31-35

```ts
export function listVisibleForDepth(allMessages: readonly ChatMessage[]): ChatMessage[] {
  return listVisibleSorted(allMessages);
}
```

**描述**：零逻辑转发层，与被转发的 `listVisibleSorted` 返回值完全相同，
唯一作用是给「按深度取可见集」这件事一个 depth 域的名字。
与 F-3/F-4 同属「为概念命名而增的转发符号」，若收敛深度域导出面时应一并处理。
**建议**：保留亦可（语义别名有可读性价值），但若执行 F-4 的删除，请顺带确认该转发是否还需要。
**置信**：confirmed

### F-w9-agentmisc-pro-20 | P3 | character-card/logic/sanitize-entry-filename.ts:13-23

```ts
const ILLEGAL_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;
```

**描述**：清洗 illegal 字符、剥首尾 `.` 与空格，但未拦 Windows 保留设备名
（`CON`/`PRN`/`AUX`/`NUL`/`COM1..9`/`LPT1..9`）与结尾点/空格以外的 `foo.` 之外的
「以点结尾已被 while 循环覆盖」情形。VFS 是逻辑路径，落库不受影响；但角色卡导入
支持 ZIP/文件树导出到真实文件系统（desktop），遇到 `世界书/CON.md` 这类条目名时
在 Windows 上会写失败。
**建议**：加一条保留名黑名单（拼 `.md` 前的 baseName 上判定），或统一加下划线前缀。
**置信**：suspected（取决于导出路径是否落真实 FS，未逐条验证导出实现）

### F-w9-agentmisc-pro-21 | P3（intentional，不计缺陷）| session-run-state/model/session-run-state.ts:21-29

```ts
export type StreamTokenSource = "usage" | "heuristic";
export type SessionRunStateTokenSource = StreamTokenSource;
```

**描述**：同一 union 的两个名字并存。文件注释已写明「历史命名，展示层一律 alias 到
本类型，新增来源只改一处」，属**拍板接受的历史命名**，非冗余缺陷。
**建议**：不改；登记为已知别名，避免后续扫描重复上报。
**置信**：intentional（引用本文件 `:23-29` 注释自证）

## 争议与存疑

1. **F-1 的修法归属有分歧**：在 schema 加 `min(4)+偶数` 会让存量已写入的奇数配置
   在**读**侧不被拒（strict 只在写入校验触发），出现「老数据继续静默失效、新数据
   报错」的双口径。另一条路是在 `assertNoCrossRoundDoomLoop` 里把非法值钳到最近的
   合法偶数（`Math.max(4, v - (v % 2))`）并 warn，不改 schema。两条路都可行，
   需主代理/用户拍板选「写入报错」还是「读时钳制」。
2. **F-2 是否连带删测试未决**：`heuristic-token-counter.test.ts` 那条断言虽恒真，
   但删掉 `estimateTokens` 后该用例仍保留了 `countText` 的有效断言，
   只需把第二句改成独立算式，是否顺手改属测试侧决定。
3. **F-5 的删除面可能溢出**：`dynamicTextBlockValueSchema` / `persistBlockValueSchema`
   被追加进 barrel 尾部导出后，**外部仓库**（若 desktop 有 fork 逻辑）理论上可能引用；
   本次只在 monorepo 内 grep，未覆盖外部消费者，建议删除前确认已发版 dist 无外部依赖。
4. **F-20 未验证导出落盘链**：角色卡导出到真实文件系统的那一段不在本区（属 vfs service 层），
   「Windows 保留名会写失败」是条件性推断，标 suspected 而非 confirmed。
5. **未审及**：本区所有文件的 schema 与 DDL 列约束一致性（如 `session_run_state.token_source`
   是否有 CHECK）需查 bootstrap DDL，不在本区，未下结论。