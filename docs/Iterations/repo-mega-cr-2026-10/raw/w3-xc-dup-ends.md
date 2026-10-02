---
zone: xc-dup-ends
agent: 横切代理（双端重复实现普查 + 循环环修复方案）
files_scanned: 1523（mobile src 378 + desktop ts/tsx 1145）；深度精读 46 对文件
---

## 摘要

mobile 与 desktop 是同一产品的两个前端壳，共用 `packages/core`，但两壳各自持有一份
「纯逻辑副本」。本机位以同名文件对 + 导出符号名对为线索普查出 69 组同名文件对、
109 个两端同名导出符号，逐对实测漂移度并给出可下沉 core 的清单。另一路独立复算
`L0/circular-alias.md` 的 13 个 SCC，得出**真环只有 5 个而非 7 个**（L0 口径把
「单边 value 边」也算环），逐环给出修复方案。核心结论：多数重复是「同一份纯函数抄两遍」，
少数已漂移成行为分叉（`summarizeToolInput` 三份三种行为、`hitRate` 分母口径不同、
`session-default-title` 前缀文案不同、`buildNewSkillDoc` YAML 转义不同）。

---

## 职责与边界

- **职责**：普查 apps/mobile 与 apps/desktop（main / renderer / shared）之间的重复实现，
  度量漂移度，判定哪些是可下沉 core 的纯逻辑；对 L0 报告的循环依赖逐环给修复方案。
- **不做**：不改实现代码（只读纪律）；不裁定 UI 重复是否合理（那属各域机位）；
  不覆盖 packages/core 内部重复（core 域机位负责）；不覆盖 apps/cli。

## 对外接口

无（本机位为只读评审，不新增/修改任何导出符号）。

## 数据访问

不触碰 DB / KKV / 文件系统。所有结论来自源码静态阅读 + 自建脚本实测
（脚本落在 `tmp/w3dup/`，未纳入 git）。

| 用途 | 脚本 |
|---|---|
| 同名文件对 + 字节大小 + IDENTICAL/DIFF | `tmp/w3dup/pair.mjs` |
| 漂移度（去空白行 Jaccard + token Jaccard + 导出符号差集） | `tmp/w3dup/sim.mjs` |
| 两端同名导出符号扫描（文件名不同但函数同名的跨线索） | `tmp/w3dup/fnscan.mjs` |
| 别名感知 SCC 复算（value 边 / type 边分图） | `tmp/w3dup/scc.mjs` |
| L0 十三个环逐环 value/type 边拆解与真环判定 | `tmp/w3dup/verify-rings.mjs` |

---

## 依赖关系

被 W5 reduce 与主代理消费：①重复实现台账供 P2/P3 优化 backlog；
②循环环结论**修正 L0 的 7→5**，影响 L3 架构图的依赖分层判读。

---

## 漂移度分级口径

| 档 | 判据 |
|---|---|
| **A 逐字** | 规范化后内容完全一致（仅缩进/引号风格差异） |
| **B 近似** | token Jaccard ≥ 0.70，导出符号集相同或仅差 DTO 适配壳 |
| **C 已漂移分叉** | 存在**用户可见的行为差异**（文案不同 / 分母口径不同 / 特判分支不同） |

---

## 发现清单 · 第一部分：双端重复实现

### 组 1 —— 工具摘要 `summarizeToolInput`（三份实现，两种行为）★最严重

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-1 |

**证据（三份实现，同一函数名）：**

`apps/desktop/renderer/features/chat/message-blocks.ts:178-193`
```ts
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  // skill 摘要：`action domain:name`；read 缺省域时只展示 action + name
  if (name === "skill") { ... return `${action} ${domain}:${skillName}`; }
```

`apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts:8-24`
```ts
export function summarizeToolInput(name, input) {
  if (!input) return '';
  // task 工具：展示 @agent · description，比裸 JSON 可读。
  if (name === 'task') { ... return parts.join(' · '); }
```

`apps/mobile/src/components/chat/message-blocks.ts:277-295`
```ts
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const path = input.path ?? input.dir ?? input.from;   // 无 skill 分支、无 task 分支
```

**描述**：三份实现，特判分支互不重叠——desktop 有 `skill` 摘要、mobile WebView 有 `task` 摘要、
mobile RN 卡片**两个特判都没有**。三条渲染路径都活着：
`ToolCallCard.tsx:75`（RN，走 mobile message-blocks）、
`web/chat-transcript/webview/ui/render/ToolGroup.tsx:57`（WebView，走 tool-logic）、
`apps/desktop/renderer/features/chat/ToolCallCard.tsx`（desktop）。
**用户可见后果**：同一条 skill 工具调用，在 desktop 显示 `read global:my-skill`，
在 mobile WebView 显示裸 JSON `{"action":"read","name":"my-skill","domain":"global"}`，
在 mobile RN 卡片显示同样裸 JSON 但被 120 字符截断。task 工具则反过来——
mobile WebView 显示 `@researcher · 调研章节大纲`，desktop 与 mobile RN 显示裸 JSON。

**建议**：把 `summarizeToolInput` 下沉 core（建议 `packages/core/src/domain/chat/logic/tool-summary.ts`），
**同时合并两个特判分支**（`skill` 与 `task` 都收），从 `packages/core/src/public/chat.ts` 导出。
三处改为 re-export。这同时消灭 mobile 内部的双份实现（跨壳重复 + 同壳内 WebView/RN 重复）。
注意 webview 侧要能被 bundler 打进 boot script（`npm run build:webview`），core 已是
`@novel-master/core` 依赖，参考已有先例 `apps/mobile/src/web/chat-transcript/webview/runtime/util/skill-tool-ref.ts`。

**置信**：confirmed（三份源码逐一读过 + 消费者 grep 确认全活）

---

### 组 2 —— `hitRate` 命中率：分母 null 口径已漂移（C）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-2 |

**证据：**

`apps/desktop/shared/logic/hit-rate.ts:14-21`
```ts
export function hitRate(cacheRead: number | null, billed: number): number | null {
  if (cacheRead == null || billed <= 0) { return null; }
```

`apps/mobile/src/screens/stack/token-usage/format.ts:55-60`
```ts
export function hitRate(cacheRead: number, billed: number): number | null {
  if (billed <= 0) { return null; }     // 无 cacheRead == null 分支
```

**描述**：desktop 接受 `number | null` 并对 null 返回 null（展示「—」）；
mobile 签名只接受 `number`。两端调用方都做了 `?? 0` 兜底
（`SummaryTab.tsx:167`、`TokenUsageStatsView.tsx:835`），
但 **DetailTab 路径不兜底**：`DetailTab.tsx:125-128` 直传
`selectedDayBucket.cacheReadTokens`（类型 `number`，但无 cache 列的 provider 语义上可为 0）。
`MetricDetailSheet.tsx:159` 与 `MetricsDetailPopover.tsx:188` 都用 `last.cacheReadTokens`
（类型 `number | null`）直传——**desktop 侧因签名收 null 而安全，mobile 侧因外层
`last.cacheReadTokens == null ? '—'` 先行短路也安全**（`MetricDetailSheet.tsx:156-157`）。
即当前无实际 bug，但签名分叉本身就是未来误用的引信：mobile 侧新增一个直传
`number | null` 的调用点会静默拿到 `NaN%` 或 `Infinity%`（`null / billed` = 0，
被 `Math.round(0 * 100)` 渲染成 `0%`，把「无数据」误报成「命中率 0%」）。

**建议**：下沉 core（`domain/chat/logic/hit-rate.ts`），签名统一取 desktop 的
`(cacheRead: number | null, billed: number)`，两端删除私有实现改为 re-export。
RULE.md:45 已把「命中率分母按计费口径」定为持久规则，这条是它的实现侧双源。

**置信**：confirmed（签名与四处调用点逐一读过；当前无实际数值错误）

---

### 组 3 —— `session-default-title`：前缀文案已漂移（C）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-3 |

**证据：**

`apps/mobile/src/utils/session-default-title.ts:2,4`
```ts
export const DEFAULT_SESSION_TITLE_PREFIX = '新会话';
const NUMBERED_TITLE_RE = /^新会话(\d+)$/;
```

`apps/desktop/renderer/utils/session-default-title.ts:2,4`
```ts
export const DEFAULT_SESSION_TITLE_PREFIX = "会话";
const NUMBERED_TITLE_RE = /^会话(\d+)$/;
```

**描述**：除缩进与引号风格外**逐字相同**（token Jaccard 0.941），但前缀文案不同：
mobile 新建会话叫「新会话1」，desktop 叫「会话1」。两端正则各自硬编码前缀，
若只改文案漏改正则，**旧会话的编号会被当成非默认标题重新计数**，
出现两个「新会话1」（`nextDefaultSessionTitle` 只在 `used.has(n)` 时递增）。
当前两端文案恰好自洽（各自的正则与各自的前缀一致），所以无实际 bug，
但这是典型的「改一半就炸」结构。

**建议**：下沉 core 为 `domain/chat/logic/default-session-title.ts`，
**前缀作为参数**（`nextDefaultSessionTitle(existingTitles, prefix)`）或按平台分两个导出常量。
推荐前者：core 不该决定中文文案，调用方传 `'新会话'` / `'会话'`，
正则由前缀派生（`new RegExp('^' + escapeRegExp(prefix) + '(\\d+)$')`），
从此消除「前缀与正则不同源」这个失效模式。

**置信**：confirmed

---

### 组 4 —— `buildNewSkillDoc`：YAML 转义口径已漂移（C）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-4 |

**证据：**

`apps/mobile/src/components/skills/skill-ui.ts:47-50,53-58`
```ts
function yamlScalar(value: string): string { return JSON.stringify(value); }
export function buildNewSkillDoc(name, description) {
  return ['---', `name: ${yamlScalar(name)}`, `description: ${yamlScalar(description)}`, ...
```

`apps/desktop/renderer/features/skills/skill-ui.ts:21-26`
```ts
export function buildNewSkillDoc(name: string, description: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, ...   // 无引号
```

**描述**：mobile 用 `JSON.stringify` 生成 YAML 双引号标量，注释明写
「description 含冒号 / 引号 / 换行时不会破坏 front matter 解析」；
desktop **裸插值**。**用户可见后果**：desktop 端新建技能时，
描述里含 `:`（如「用途：调研」）会让 YAML 解析成嵌套 map 或直接抛错，
`parseSkillFrontMatter` 返回 `valid: false` + `invalidReason: 'front matter 不可解析：…'`
（`packages/core/src/domain/skills/logic/parse-skill-front-matter.ts:52-60`），
技能创建后立即显示为「无效技能」。mobile 端同一输入正常。
这是本次普查中**唯一确定会造成用户可见功能失败的漂移**。

**建议**：下沉 core 为 `domain/skills/logic/build-new-skill-doc.ts`，
采用 mobile 的 `yamlScalar` 口径（JSON 字符串即合法 YAML double-quoted scalar，
core 已有 `stringify-text.js` 可用）。两端 re-export。
`w2-core-skills.md:546` 已记「两处 UI 侧手拼 front matter 不复用」但未识别出转义分叉，
本条升级为 C 级并给出 core 落点。

**置信**：confirmed

---

### 组 5 —— `SKILL_ENTRY_FILE`：desktop 本地重定义（B，且是 L0 已知范式的反面）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-5 |

**证据：**

`packages/core/src/domain/skills/logic/skill-paths.ts:16-17`
```ts
/** 技能入口文件（path 缺省值）。 */
export const SKILL_ENTRY_FILE = "SKILL.md";
```

`apps/desktop/renderer/features/settings/SkillDetailView.tsx:21-34`
```ts
/** SKILL.md 置顶，其余按路径字典序。 */
function sortSkillFiles(files: readonly string[]): string[] {
  return [...files].sort((a, b) => {
    if (a === "SKILL.md") { return -1; }
    if (b === "SKILL.md") { return 1; }
    ...
const SKILL_ENTRY_FILE = "SKILL.md";     // ← 本地重定义，未从 core 导入
```

`apps/mobile/src/screens/stack/SkillDetailScreen.tsx:147-151`
```tsx
isProtectedPath={path => path === `${skillRoot}/SKILL.md` ? '…' : null}
```

`packages/core/src/domain/tool/builtin/skill-tool.ts:41` 注释亦写
「与服务层 SKILL_ENTRY_FILE 同值」——即**第三份认知**（注释级），
说明作者自己知道有三处，硬编码是靠注释维系的。

**描述**：`SKILL_ENTRY_FILE` 是 core domain 单源（`skill-paths.ts` 的文件头注释
明写「防止出现第二份路径逻辑」），但 desktop 视图层与 mobile 屏幕层各自硬编码
`"SKILL.md"`，共 **4 处字面量**（desktop 2 处、mobile 1 处、core 注释 1 处）。
core 的 `public/skills.ts` 未导出 `SKILL_ENTRY_FILE`，所以两端想引也引不到——
这是「单源建了但没开出口」的典型。

**建议**：① `packages/core/src/public/skills.ts` 加
`export { SKILL_ENTRY_FILE, SKILLS_ROOT } from "../domain/skills/logic/skill-paths.js"`；
② desktop `SkillDetailView.tsx` 删本地 const，`sortSkillFiles` 改用常量；
③ mobile `SkillDetailScreen.tsx:148` 改模板串常量拼接。

**置信**：confirmed

---

### 组 6 —— 存储迁移状态行 / 三态文案：两端各一份纯函数（B，形态不同）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-6 |

**证据：**

`apps/mobile/src/screens/stack/storage-config-migration-values.ts:23-59`
```ts
export function messageCompactionValue(status: MessageCompactionStatus | null): MigrationValue {
  if (status == null) { return {value: '—', tone: 'default'}; }
  return status.done ? {value: '已完成', tone: 'success'}
    : {value: `进行中（剩余 ${status.pendingCount} 条）`, tone: 'default'};
}
export function blobBinaryValue(status: BlobBinaryTableStatus | undefined): MigrationValue { ... }
```

`apps/desktop/renderer/features/settings/migration-row-value.ts:34-62`
```ts
export function migrationRowValue(dbStats: DbStatsResult | null, row): MigrationRowValue {
  if (row.kind === "messageCompaction") { ...同文案... }
  const status = dbStats?.blobBinary.tables.find(...);   // 表注册表驱动
```

**描述**：**三态文案逐字相同**（`—` / `已完成` / `进行中（剩余 N 条）` /
`已完成（N 条需人工处理）`），tone 三态映射也相同。差异只在形态：
mobile 拆两个函数（`messageCompactionValue` / `blobBinaryValue`），
desktop 收一个 `migrationRowValue(dbStats, row)` 用 `MIGRATION_ROWS` 表驱动。
两文件头注释都提到「用户拍板 2026-09-28」与「ic-22 抽出为纯 ts 模块便于直测」——
**同一个拍板在两端各实现了一次**。
文案漂移的代价：改一处忘另一处，两端存储页显示不同状态字样。

**建议**：下沉 core 为 `domain/infra/logic/migration-status-view.ts`，
导出 desktop 的表驱动形态 `migrationRowValue({messageCompaction, blobBinaryTables}, kind)`
（core 侧入参用中性结构而非 DTO，避免 core 依赖 IPC 类型）。
两端各保留 3~5 行适配（mobile 把 `BlobBinaryTableStatus[]` 查表、desktop 直接透传
`dbStats` 的两个字段），文案与 tone 映射单源。

**置信**：confirmed

---

### 组 7 —— `composer-send-state`：逻辑同源，输入形态分叉（B）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-7 |

**证据：**

`apps/mobile/src/components/chat/composer-send-state.ts:24-38`
```ts
export function deriveComposerSendState(lastMessage: ChatMessage | undefined): ComposerSendState {
  if (lastMessage == null) { return {canResumeWithoutInput: false, lastMessageIsPlainUserText: false}; }
  return {canResumeWithoutInput: lastMessage.role === 'user', lastMessageIsPlainUserText: isPlainUserText(lastMessage)};
```

`apps/desktop/renderer/features/chat/composer-send-state.ts:69-77`
```ts
export function deriveComposerSendState(lastMessage: ChatMessageDto | undefined): ComposerSendState {
  ...
  const msg = chatMessageFromDto(lastMessage);            // ← DTO→domain 适配壳
  return {canResumeWithoutInput: lastMessage.role === "user", lastMessageIsPlainUserText: isPlainUserText(msg)};
}
```

**描述**：`deriveComposerSendState` 本体 8 行、逻辑逐字相同（token Jaccard 0.432 的低分
完全来自 desktop 多出的 40 行 `blockFromDto` / `chatMessageFromDto` DTO 反序列化壳）。
`findLastVisibleMessage` 也是——mobile 收 `ChatMessage[]`、desktop 收 `ChatMessageDto[]`，
循环体逐字相同。desktop 的 DTO 适配是有价值的（`@shared/ipc-types` 与 core `ChatMessage` 不同构），
但**推导逻辑本身与形态无关**。

**建议**：下沉 core 为 `domain/chat/logic/composer-send-state.ts`，
导出 `deriveComposerSendState(last: {role, content} | undefined)`——只依赖
`role` 与 `content` 两个字段，DTO 与 domain `ChatMessage` 都满足（结构化子类型）。
desktop 的 `chatMessageFromDto` 保留在 renderer 侧（它有 `metadata → raw` 的形态映射，
是 IPC 边界知识，不该进 core）。`findLastVisibleMessage` 改为 core 泛型
`<T extends {hidden?: boolean}>(messages: readonly T[]): T | undefined`。
core 已有邻居 `composer-send-intent.ts` / `composer-sendable-input.ts`，
本文件是同一族逻辑的第三块拼图，放一起更顺。

**置信**：confirmed

---

### 组 8 —— `flush-run-ui`：语义已分叉（B→C 边缘）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-8 |

**证据：**

`apps/mobile/src/components/chat/flush-run-ui.ts:13-24`
```ts
export async function flushRunUi(onMessagesChanged: FlushMessagesChanged, onStreamEnd: (ctx) => void, prevCount: number) {
  const messages = (await onMessagesChanged({immediate: true})) ?? [];   // immediate 绕过 200ms 合并
  onStreamEnd({messages, prevCount});
}
```

`apps/desktop/renderer/features/chat/flush-run-ui.ts:5-11`
```ts
export async function flushRunUi(onMessagesChanged: () => void | Promise<void>, onStreamReset: () => void) {
  await onMessagesChanged();
  onStreamReset();
}
```

**描述**：骨架相同（reload → reset），但 mobile 多了两个实质机制：
①`{immediate: true}` 绕过 run 内 200ms 合并并 **await DB 拉取**；
②`prevCount` 传给 onStreamEnd 供调用方判断是否新增气泡。
desktop 侧两者都没有，desktop 也没有对应的「200ms 合并」问题（renderer 不做合并）。
**这是平台差异导致的合理分叉，不建议强行统一**——但两端同名同导出名会误导后来者。

**建议**：`flushRunUi` / `flushAgentStepUi` 保持各端私有（**标 intentional**），
但把 mobile 侧 `immediate` 机制的注释提到文件头说明「为何两端签名不同」，
避免下一个人又去「统一」它。可选：改名为 `flushRunUiAfterDbReload` 之类带机制的名字。

**置信**：intentional（平台差异），但缺文档保护

---

### 组 9 —— `tool-turn-actions`：hide 分支形态分叉（B）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-9 |

**证据：**

mobile `tool-turn-actions.ts:10-27` 用闭包收敛单路径：
```ts
const setVisibility = hidden ? async (id) => runtime.messages.hide(id) : async (id) => runtime.messages.show(id);
await setVisibility(assistantMessageId);
if (resultsId != null) { await setVisibility(resultsId); }
```
注释：「hide / show 镜像分支收敛单路径（comp-chat/C-9）：同一操作闭包」。

desktop `tool-turn-actions.ts:11-33` 保留了 `if (hidden) {...} else {...}` 双分支平铺，
且**在非 tool_use 消息上提前 return**（mobile 无此提前返回，靠 `resultsId == null` 自然短路）。

**描述**：`deleteToolTurn` 两端逻辑逐字等价（token Jaccard 0.566 主要来自尾行逗号风格）。
`hideToolTurn` 是**同一意图的两种写法**——mobile 已按 comp-chat/C-9 收敛过一轮，
desktop 没跟上。行为等价（提前 return vs resultsId 为 null 都跳过第二次调用），
但 mobile 那次收敛的结论没有双端同步。

**建议**：`deleteToolTurn` 的「找 assistant → 解析配对 resultsId → 先删 results 再删 assistant」
是可下沉 core 的纯逻辑（下沉为 `resolveToolTurnPairing(messages, assistantId): {assistantId, resultsId | null}`），
两端只保留各自的 IPC / runtime 调用。
`hideToolTurn` 保持各端（IO 形态不同），但 desktop 建议照 mobile 的闭包写法收敛，
保持两端代码形态一致以便未来 diff。

**置信**：confirmed

---

### 组 10 —— `transcript-selectable-role`：函数集几乎全同（B）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-10 |

**证据**：`sim.mjs` 实测 12 个导出符号**完全相同**
（`MessageBatchMode`、`transcriptSelectableRole`、`isTranscriptRowSelectable`、
`computeHideRangeFromSelection`、`computeShowRangeFromSelection`、
`computeVisibilityBatchAffectedIds`、`selectVisibilityBatchEligibleIdsFromAnchor`、
`isTailBatchRowSelectable`、`selectTailBatchEligibleIdsFromAnchor`、
`computeTailBatchAffectedIds`、`computeTailBatchRangeFromSelection`、`tailBatchDeleteAfterSeq`），
逐行 Jaccard 0.345、token Jaccard 0.550。差异只在两端各自的行构造器
（mobile `chatMessagesToTailBatchRows` vs desktop `buildTailBatchRows`）与
`isTailBatchMode` 的归属。

**描述**：这是本次普查中**导出面重合度最高**的一对——12 个纯计算函数，
全是 `readonly` 入参、纯返回值、零 IO 零 React，是教科书级的 core 下沉候选。

**建议**：整文件下沉 core（`domain/chat/logic/transcript-batch-selection.ts`），
12 个函数全部搬过去，从 `public/chat.ts` 导出。两端只留行构造器
（`chatMessagesToTailBatchRows` / `buildTailBatchRows`，各自绑 DTO 形态）。
**这是本报告收益最高的一条**：一次搬走 12 个函数 × 2 份 = 24 处重复，
且下沉后两端批量选择的边界行为由同一份代码保证（批量误删是难以复现的 P0 级事故）。

**置信**：confirmed

---

### 组 11 —— 逐字重复清单（A 档，可零成本下沉）

以下对规范化后内容完全一致或仅差格式，`tokenJaccard = 1.000`：

| 文件对 | 相似度 | 建议 |
|---|---|---|
| `apps/mobile/src/hooks/useBatchSelection.ts` :: `apps/desktop/renderer/hooks/useBatchSelection.ts` | tokenJaccard **1.000**，44 行逐字（仅首行注释措辞不同：「Agent/Provider/会话列表」vs「项目/会话/Provider」） | 下沉 `packages/ui/` 或 core `domain/`；44 行 × 2 份 |
| `apps/mobile/src/hooks/useStreamTailGenerating.ts` :: `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | tokenJaccard **1.000**，8 vs 6 行 | 同上；实际是 `uiRunning` 的恒等映射，两端可直接内联掉 |
| `apps/mobile/src/web/code-editor/webview/runtime/language-for-path.ts` :: `apps/desktop/renderer/components/ui/language-for-path.ts` | tokenJaccard **1.000**，13 行 | 下沉 `domain/tool/logic/language-for-path.ts`（路径→语言名的映射是领域知识） |
| `apps/mobile/src/update-check/parse-release-tag.ts` :: `apps/desktop/src/main/update-check/parse-release-tag.ts` | **IDENTICAL**（字节级完全相同，396 字节） | 下沉；这是全仓唯一字节级相同的双端文件 |

**置信**：confirmed（`pair.mjs` 字节比对 + `sim.mjs` token 比对双重确认）

---

### 组 12 —— 近似重复（B 档，tokenJaccard ≥ 0.70，core 单源已部分就位）

| 文件对 | 行 Jaccard | token Jaccard | 公共导出 | 漂移判定 | 可下沉清单 |
|---|---|---|---|---|---|
| `session-prompt-input.service.ts` 双端 | 0.564 | **0.878** | 5/5 全同 | B | `buildSessionPromptInput` + `ChatPromptBuildBailedError` + 3 类型；IO 侧（store 取值）各端留 |
| `prompt-preview.service.ts` 双端 | 0.663 | **0.966** | 2/2 全同 | B | `buildRealPromptPreviewSegments` 几乎逐字；直接下沉 |
| `check-for-updates.ts` 双端 | 0.516 | **0.724** | 1/1 | B | 纯网络编排（fetch + 比较 semver），可下沉；desktop 多 `resolveLatestReleaseFromList` |
| `agent-yaml.service.ts` 双端 | 0.283 | **0.750** | 2/2 | B | `decodeAgentYamlText` / `encodeAgentYamlText` 纯文本编解码，下沉；`export*WithDialog` 留各端 |
| `user-vfs-turn-execute.service.ts` 双端 | 0.214 | **0.717** | 2/2 | B | `isSessionVfsScope` + `executeSessionUserVfsOp` 的 scope 判定纯逻辑可下沉 |
| `app-meta.ts` 双端 | 0.478 | **0.722** | 5/5 | B | `GITHUB_REPO` / `githubRepoUrl` / `githubReleasesUrl` / `githubLatestReleaseApiUrl` / `licenseUrl` 五个 URL 构造函数，两端逐字。下沉到 core 的 `domain/release/`（或 apps 共享包）。**风险**：仓库地址是发布相关常量，双份意味着改仓库地址要改两处 |
| `update-check/types.ts` 双端 | 0.857 | **1.000** | 3/3 | B | `LatestRelease` / `UpdateCheckStatus` / `UpdateCheckData` 三类型逐字同 |
| `composer-at-path.ts` 双端 | **0.800** | 0.688 | 7/7 全同 | B | 7 个 `@路径` token 纯函数（`atPathTokensFromPickerSelection` / `countScannedAtPathAttachments` / `filterAtPathTypeaheadCandidates` / `findActiveAtQuery` / `formatComposerAtPathToken` / `replaceActiveAtWithToken` / `AtPathRef`），core 已有 `scan-at-path-attachments.ts` 相邻，直接下沉 |
| `agent-run.service.ts` 双端 | 0.376 | **0.701** | 5/5 | B | `resolveCurrentAgentId` / `resolveCurrentAgentDefinition` / `AgentRunError` 纯逻辑可下沉；`resolveMobileSavedModelId` vs `resolveDesktopSavedModelId` 是平台差异（留） |
| `prompt-macro-input.ts` 双端 | 0.516 | **0.745** | 6/7 | B | `PROMPT_INSERTABLE_MACROS` / `findWhitelistMacroRanges` / `tryAtomicMacroDelete` / `insertTextAtSelection` + `WhitelistMacroRange` 下沉；mobile 多 `splitPromptMacroSegments`、desktop 多 `renderPromptMacroHighlightHtml`（各端渲染相关，留） |
| `types.ts`（update-check）双端 | 0.857 | 1.000 | 3/3 | B | 同上 |

**置信**：confirmed

---

### 组 13 —— 各自持有私有实现、只有名字相同（不建议下沉，仅记录）

以下对**功能同名但实现分叉**（token Jaccard 0.18~0.31），多为「恰好都叫这个名字」，
强行统一会引入错误耦合：

| 文件对 | tokenJaccard | 判定 |
|---|---|---|
| `stream-token-estimator.ts`（mobile 159 行 vs desktop **19 行**） | 0.181 | **已漂移分叉**：mobile 有 7 个导出（`resolveStreamTokenEncodingName` / `createStreamTokenEstimator` / `primeStreamTokenModelHint` / `createSessionStreamTokenEstimator` 等），desktop 只有一个 19 行的 `createDesktopStreamTokenEstimator`。RULE.md:96 记载「mobile 用既有依赖的 shim，desktop renderer 直接用 js-tiktoken」——**依赖不同是有意设计**，标 intentional，不统一 |
| `useAgentStreamMetrics.ts`（mobile 26 行 vs desktop **227 行**） | 0.214 | 已漂移：desktop 内联了完整 hook（含 `AgentStreamEstimatorFactory`），mobile 只导出 3 个 view 函数。类型共享、逻辑不共享 |
| `skill-ui.ts` 双端 | 0.238 | **已漂移分叉**（详见组 4）：`buildNewSkillDoc` 同名不同行为；其余导出**完全不交集**（mobile `skillDomainBadgeLabel/Color/HintLabel` vs desktop `skillDomainLabel/isValidSkillNameInput/toSkillRef/skillKey/parseSkillKey/dispatchOpenSettingsView`） |
| `app-ui-prefs.ts` 双端 | 0.493 | 已漂移：导出符号**零交集**（mobile `createAppUiPreferences` vs desktop `DESKTOP_UI_KV_MODULE` + 9 个 `DESKTOP_UI_KEY_*` 常量）。desktop 显式列 key，mobile 收在对象里——**两种风格，不是有意分叉，是历史沉淀**。建议对齐风格而非下沉 |
| `db-maintenance-busy.ts` 双端 | 0.500 | 逻辑等价（`count > 0` / `+= 1` / `max(0, -1)`），desktop 多 `setDesktopDbMaintenanceBusy`（旧式布尔入口）与 `resetDesktopDbMaintenanceBusyForTest`。**可下沉为 core 的 `createBusyCounter()` 工厂**（零依赖闭包），但优先级低 |
| `agent-activity.ts` 双端 | 0.743 | **命名分叉**：`subscribeMobileAgentActivity` vs `subscribeDesktopAgentActivity`（后 5 个函数同构）。建议 core 导出 `createAgentActivityTracker()`，两端各包一层带平台前缀的薄壳 |
| `vfs-operations.service.ts`（mobile 158 vs desktop 39 行） | 0.506 | 6 个导出同名（`createVfsFile` / `createVfsDirectory` / `deleteVfsEntry` / `renameVfsFile` / `renameVfsDirectory` / `remapPathUnderDir`），mobile 多 7 个 `session*` 包装。底层 6 个是 core VFS service 的直接转发，**属于 IPC/runtime 边界，留各端** |
| `db-backup.service.ts` 双端 | 0.439 | 5 个导出同名，182 vs 176 行但 Jaccard 仅 0.204——文件选择器调用形态不同（RN DocumentPicker vs electron dialog）。底层备份编解码已走 core，**留各端** |
| `yaml-shared.ts` / `smart-sort-rule-yaml.service.ts` / `vfs-character-card.service.ts` | 0.105~0.315 | 三对都是「同名导出 + 平台 IO 分叉」模式（`exportYamlFile` vs `exportYamlWithDialog`）。**这是正确的分层，不下沉** |
| `vfs-zip.service.ts` | 0.451 | 同上模式（`exportVfsZip` vs `exportVfsZipWithDialog`），但 `zipBaseNameFromPath` 是纯函数可下沉 |

**置信**：confirmed（逐对读过差异部分）

---

### 组 14 —— 跨线索重复（文件名不同但函数同名，`fnscan.mjs` 补获）

同一功能在两端落在**不同文件名**下，同名文件对法抓不到，靠导出符号名扫描补出：

| 功能 | mobile 位置 | desktop 位置 | tokenJaccard | 可下沉 |
|---|---|---|---|---|
| VFS 树路径工具 | `components/vfs/vfs-row-mapper.ts`（170 行） | `renderer/features/workspace/vfs-tree-utils.ts`（89 行） | 0.311 | `parentLogicalPath` / `isDirectChild` / `entryName` 三函数同名同义（路径分段与父子判定是纯逻辑）→ core |
| VFS 拖拽移动 | `components/vfs/vfs-move-path.ts`（32 行） | `renderer/features/workspace/vfs-tree-dnd.ts`（77 行） | 0.279 | `isSelfOrAncestorPath` / `resolveMoveDestination` 纯逻辑可下沉；`NM_VFS_PATHS_MIME` / `encode-decodeVfsDragPayload` 是 desktop DnD 专有（留） |
| markdown 预览判定 | `components/vfs/FileMarkdownPreview.tsx`（486 行） | `renderer/layout/preview-utils.ts`（36 行） | 0.077 | `isMarkdownPreviewPath`（路径后缀判定）可下沉；`isLikelyMarkdownContent` / `shouldRenderMarkdownPreview`（内容嗅探）desktop 专有 |
| 批注映射 | `web/rich-document/webview/runtime/annotate-recogito-map.ts`（113 行） | `renderer/layout/preview-recogito.ts`（152 行） | 0.376 | `draftToRecogitoAnnotation` / `draftsToRecogitoAnnotations` 同名可下沉 |
| 工作台目录规则 | `services/workplace-operations.service.ts`（118 行） | `renderer/features/workspace/workspace-actions.ts`（209 行） | 0.216 | `setDirRuleEnabled` / `emptyDirRuleForm` 同名可下沉 |
| 聊天滚动 | `webview-host/chat-transcript/scroll.ts`（45 行） | `renderer/features/chat/chat-messages-scroll.ts`（22 行） | 0.531 | `nearBottom` / `offsetFromBottom` / `scrollTopForBottom` / `NEAR_BOTTOM_THRESHOLD_PX` 四个同名（阈值常量！`NEAR_BOTTOM_THRESHOLD_PX` 在 mobile 定义于 `web/shared/constants.ts`、desktop 定义于 `chat-messages-scroll.ts`——**同一 UI 常量两份定义**）→ core |
| 代码块语言归一 | `components/rich-content/highlight-code.ts` | `renderer/components/code-block.tsx` | 0.242 | `normalizeFenceLang`（fenced code lang 归一）可下沉 |
| 命中弹层 | `components/sheet/MetricDetailSheet.tsx` | `renderer/features/chat/MetricsDetailPopover.tsx` | — | `lastRowBilledInput` 在两端**同名同实现逐字相同**（mobile `:29-42` / desktop `:27-40`），是 `hitRate` 的分母配套，应与组 2 一并下沉 |
| 变更日志解析 | `web/shared/mermaid-core.ts` | `renderer/components/MermaidMarkdown.tsx` | — | `nextMermaidId` 同名；RULE.md:49 已把 mermaid 双路线定为**有意分化**（WebView 沙箱 vs RN），标 intentional，不动 |

**置信**：confirmed

---

### 组 15 —— 端内重复（同一 app 内多份，非跨端）

普查中撞见两处「同一 app 内两份」：

1. **mobile `summarizeToolInput` 三份中的两份在 mobile 内**（组 1）——RN `message-blocks.ts`
   与 WebView `tool-logic.ts` 各一份，行为不同。
2. **`NEAR_BOTTOM_THRESHOLD_PX` 在 mobile 也有隐患**：`web/shared/constants.ts` 定义，
   而 `webview-host/chat-transcript/scroll.ts` 也用到（需确认是否重复定义，
   本机位未逐行确认，标 suspected）。

**置信**：confirmed（1）/ suspected（2）

---

## 发现清单 · 第二部分：循环依赖

### 组 16 —— L0 的「7 个真环」实为 5 个（P1 级方法论问题）

| 项 | 值 |
|---|---|
| 文件 | F-xc-dup-ends-16 |

**证据**：我用自建脚本（`tmp/w3dup/scc.mjs`，别名感知 + `import type` 边分离）
对 `packages/core`（1083 节点，2155 条 value 边 / 1172 条 type 边）与
`apps/mobile`（640 节点，1450 value / 228 type）跑 Tarjan SCC，**只保留 value 边**：

```
==== core  value-edge SCCs: 3
  RING-1 (3 files)  seed-builtin-skills.ts / create-skills-service.ts / skills.service.ts
  RING-2 (2 files)  fs-command-classify.ts / fs-command.ts
  RING-3 (2 files)  resolve-thinking-wire.ts / thinking-level-presets.ts
==== mobile  value-edge SCCs: 2
  RING-1 (6 files)  chat-transcript/webview/runtime/{bridge,menu/menu,render/snapshot,scroll/scroll,stream/stream-markdown,stream/stream}
  RING-2 (2 files)  composer-input/webview/runtime/{bridge,editor}
```

再用 `verify-rings.mjs` 把 L0 报告的 13 个环逐个拆边（`tmp/w3dup/verify-rings.mjs`），
结果与 L0「剔 type 边后仍在 7 个」的判定**不一致**：

| L0 环号 | L0 判定 | 我的实测 | 差异原因 |
|---|---|---|---|
| CYC-001 | runtime-safe（含 type 边） | **非环**（type 4 / value 0） | 4 条边全是 `import type`，编译后全擦除 |
| CYC-002 | runtime-safe | **非环**（type 2 / value 0） | 同上 |
| CYC-003 | runtime-safe | **真环**（value 3，三角） | 确认 |
| CYC-004 | runtime-safe | **非环**（value 1 / type 1，单向） | 唯一 value 边 `agent-editor-state → agent-tool-catalog`，回边是 type，**SCC 断裂** |
| CYC-005 | runtime-safe | **部分真环**（value 6 / type 5） | 9 文件大 SCC 里，`fs-command ↔ fs-command-classify` 是真 2 环；其余 7 个文件靠 type 边连成一片，**不是真环** |
| CYC-006 | runtime-safe | **非环**（value 1 / type 0，单向） | L0 记「session-fs-errors 环上无实际使用的绑定」——**它对 rollback-confirm-copy 的引用只出现在 JSDoc `{@link import(...)}` 里**（`session-fs-errors.ts:210`），不是真 import 语句 |
| CYC-007 | runtime-safe | **非环**（value 1 / type 2） | 唯一 value 边 `count-prompt-llm-input → registry`，回边 `registry → tokenizer-driver.port` 是 type |
| CYC-008 | runtime-safe | **真环**（value 2） | 确认 |
| CYC-009 | runtime-safe | **非环**（value 1 / type 1，单向） | 回边 `assemble-agent-runner-deps → run-agent-turn` 是 `import type`（该文件全部 8 条 import 都是 type） |
| CYC-010 | runtime-safe | **非环**（value 1 / type 3） | 唯一 value 边 `session-stream-unit-manager → agent-run`，另两条回边是 type |
| CYC-011 | runtime-safe | **真环**（value 14，6 文件全互连） | 确认 |
| CYC-012 | runtime-safe | **非环**（value 1 / type 1，单向） | 回边是 type |
| CYC-013 | runtime-safe | **真环**（value 2） | 确认 |

**描述**：L0 的「7 个真环」是把**含至少一条 value 边的 SCC** 都算成了环，
但 value 边只有一条、回边是 type 的 SCC 在编译后**根本不成环**（`import type`
被 TS 整条擦除）。L0 自己的表格其实已经标了这些环内绝大多数绑定是「类型位（编译后擦除）」，
却仍在汇总行写下「7 个环在运行时真实存在」——**汇总口径与明细自相矛盾**。

按我的口径，**运行时真实存在的环是 5 个**（core 3 + mobile 2），与 L0 表格首行的
「runtime-risk 环 0 / runtime-safe 环 13」不矛盾（都是 0 个 TDZ 风险），
但与汇总行的「7」矛盾。**L3 架构图若引用「7 个真环」会误导依赖分层的严重度判断。**

**建议**：① 修正 `L0/circular-alias.md` 汇总行为「5 个运行时真环（core 3 / mobile 2）」，
并加一列「L0 原判 / 实测」；② L0 已知局限里「解析器是正则 + 启发式」应补一条
**「JSDoc `{@link import(...)}` 会被误判为 import 语句」**——这是 CYC-006 假阳性的直接成因，
我在复算第一版也被它坑过一次（第一版解析器同样把 JSDoc 里的 import 当边，
直到发现「环上无实际使用的绑定」这条线索才回头查）。

**置信**：confirmed（两套独立脚本交叉验证 + 逐环读源码确认每条边的 import 形式）

---

### 组 17 —— 逐环修复方案

以下 5 个环全部 **runtime-safe**（无顶层求值，L0 判定正确），
所以**都不是 P0 正确性事故**，是 P2/P3 可维护性债。修复优先级按「改动面 × 收益」排。

---

#### 环 A = CYC-003 · core · 3 文件 ★**最高优先级**

```
skills.service.ts --value(import {BUILTIN_SKILL_NAMES})--> seed-builtin-skills.ts
seed-builtin-skills.ts --value(createSkillsService)--> create-skills-service.ts
create-skills-service.ts --value(new SkillsService)--> skills.service.ts
```

**问题本质**：`service 层 → bootstrap 层 → service 层` 的**层级倒挂**。
bootstrap 是启动期的编排层，service 是业务层；业务层反过来依赖启动期编排，
是典型的分层污染。`seed-builtin-skills.ts` 的文件头注释自称
「BUILTIN_SKILL_NAMES 是单一来源：服务层的删除/新建拦截与本 seed 共用同一份名单」——
**共用一份名单 ≠ 共住一层**，作者把「单源」与「同层」混为一谈了。

**修复方案（下沉 domain，已知范式）**：

1. 新建 `packages/core/src/domain/skills/model/builtin-skill-names.ts`：
   ```ts
   /** 内置技能名名单（删除/新建拦截与 bootstrap seed 共用的单一来源）。 */
   export const BUILTIN_SKILL_NAMES: ReadonlySet<string> = new Set(["agent-config"]);
   ```
2. `seed-builtin-skills.ts` 改 `import { BUILTIN_SKILL_NAMES } from "@/domain/skills/model/builtin-skill-names.js"`
   并 `export { BUILTIN_SKILL_NAMES }`（保持既有对外形状，若有外部消费者）。
3. `skills.service.ts:33` 同样改指向 domain。
4. 断环验证：service → domain（向下）、seed → domain + service（seed 是编排，向下都可以）。
   **环消失**。

**注意**：`AGENT_CONFIG_SKILL_MD`（135 行正文）与 `AGENT_CONFIG_SEED_VERSION` 不建议一起搬——
它们是 seed 的资产不是 domain 的知识，留在 bootstrap 无妨（它们没被 skills.service 引用，
不构成环边）。**只搬 `BUILTIN_SKILL_NAMES` 这一个绑定，环就断了。**

**收益**：消除 core 里最大的层级倒挂环；与 `skill-paths.ts`（已是 domain 单源，
`SKILLS_ROOT` / `SKILL_ENTRY_FILE`）形成同一族，且组 5 的 `SKILL_ENTRY_FILE`
出口问题可一并解决（`public/skills.ts` 加导出）。

**置信**：confirmed

---

#### 环 B = CYC-005 子环 · core · 2 文件

```
fs-command.ts --value(classifyFsCommand)--> fs-command-classify.ts
fs-command-classify.ts --value(parseFsCommand)--> fs-command.ts
```

**问题本质**：`parse`（词法/结构解析）与 `classify`（语义分类）互相调用。
`fs-command-classify.ts` 既是分类器又是解析器的消费者，**职责没切干净**。

**修复方案（三选一，推荐 c）**：

- **a. 类型参数下沉**：`parseFsCommand` 的入参/出参类型（`FsCommand` / `FsToolInput`）抽到
  `domain/tool/model/fs-command.ts`，两个 logic 文件都只依赖 model → 环断在 model。
  但 `classifyFsCommand` 仍在运行时调 `parseFsCommand`，环可能仍在，取决于调用点。
- **b. 合并**：`classifyFsCommand` 是 `parseFsCommand` 的薄封装就并入 `fs-command.ts`。
  需先确认 `classifyFsCommand` 是否有独立的 skill-tool 特判逻辑值得独立。
- **c. 惰性注入（推荐，零行为风险）**：`fs-command-classify.ts` 不在模块顶层 import
  `parseFsCommand`，改为在 `classifyFsCommand` 函数体内 `await import(...)` 或由
  `fs-command.ts` 反向注入。当前已是惰性求值（不在顶层），所以**运行时无风险**，
  本方案纯粹是为了让静态分析工具（及后续 L0 复算）能报出「0 环」。

**建议**：选 c，成本最低（改 1 行 import 为函数内 require / 提一个参数），
且不触碰 9 文件大 SCC 里其余 7 个「非真环」成员的既有形状。

**附**：CYC-005 的 9 文件 SCC 里另外 7 个文件（`vfs-tools` / `skill-tool` /
`builtin-tool-context` / `validate-agent-definition` / `validate-agent-tool-policy` /
`agent-registry.port` / `persistent-state.port`）**不是真环**——它们的连边全是
`import type`（已实测 5 条 type 边）。**不需要修**，L0 报告把它们混在一起会让人误以为
要重构 9 个文件。修的时候只碰 `fs-command.ts` 与 `fs-command-classify.ts` 两个。

**置信**：confirmed

---

#### 环 C = CYC-008 · core · 2 文件

```
resolve-thinking-wire.ts --value(thinkingLevelToModelThinkingParams)--> thinking-level-presets.ts
thinking-level-presets.ts --value(resolveEffectiveMaxTokens)--> resolve-thinking-wire.ts
```

**问题本质**：两个互为对偶的纯函数（thinking level ↔ wire params）互相调用，
本质是**一个概念被切成两个文件**。

**修复方案**：

1. 先判定二者是否真的互为对偶：`thinkingLevelToModelThinkingParams`（level→params）
   与 `resolveEffectiveMaxTokens`（settings→maxTokens）**不是对偶**，
   是同一次「思考参数解析」的两个步骤。
2. 因此正解是**合并为一个模块** `domain/provider/logic/thinking-params-resolve.ts`，
   两个函数搬进去；或**把 `resolveEffectiveMaxTokens` 移到 `model/model-thinking-params.ts`**
   （它是 settings→params 的推导，属 model 层关注点，`thinking-level-presets.ts` 与
   `resolve-thinking-wire.ts` 同属 logic 层）。
3. 推荐 2：`resolveEffectiveMaxTokens` 依赖 `SavedModelSamplingSettings`（model 层类型）
   与 `LlmProtocolKind`（infra port 类型），**下沉到 model 会引入 domain→infra 的反向依赖**
   （`LlmProtocolKind` 定义在 `infra/llm-protocol/ports/adapter.port.ts`）——
   **这条要谨慎**。所以推荐 1（合并为单 logic 模块），零依赖方向变化。

**收益**：断环 + 两个纯函数同文件，thinking 参数解析的完整逻辑可一次读完。

**置信**：confirmed（依赖方向已核：`LlmProtocolKind` 确实来自 infra port）

---

#### 环 D = CYC-011 · mobile · 6 文件（WebView transcript runtime）

```
bridge.ts ⇄ {menu/menu.ts, render/snapshot.ts, scroll/scroll.ts, stream/stream.ts, stream/stream-markdown.ts}
```
14 条 value 边，6 文件两两互连（`bridge` 是中心节点，5 个叶子都回引 `bridge`）。

**问题本质**：WebView 侧的**事件总线与实现模块互相引用**。
所有叶子模块（如 `menu.ts`、`scroll.ts`）都需要 `post()` 往 RN 侧发消息，
于是 import `bridge.ts` 的 `post`；而 `bridge.ts` 又要调叶子的处理函数。**这是观察者模式
的双向注册，天然成环。**

**修复方案（三选一，推荐 a）**：

- **a. 抽出 `post` 到独立的 `webview/post.ts`（推荐）**：
  `post` 只有一个实现（`window.ReactNativeWebView.postMessage` 之类），
  把它连同其类型抽成 10 行的独立模块，5 个叶子改从它 import。
  `bridge.ts` 不再是叶子的唯一依赖来源，**环立刻断**。
  代价极小，收益是让 `bridge.ts` 从「中心节点」降为「普通消费者」。
- **b. 依赖注入**：`bridge.ts` 初始化时把 `post` 注入各叶子。
  WebView boot script 是单入口，注入成本低，但比 a 复杂。
- **c. 不修**（当前 runtime-safe，惰性求值无 TDZ 风险）。
  **不推荐**：6 文件 14 边的环是本次普查最大的一个，后续任何人在 `bridge.ts` 加
  顶层 `const x = leaf.someFn()` 都会立刻变成 runtime-risk。**a 的成本远低于这个风险。**

**建议**：a。这是 5 个环里唯一一个「值得现在修」的（其余 4 个改动面更小但风险也更低）。

**置信**：confirmed

---

#### 环 E = CYC-013 · mobile · 2 文件（WebView composer-input）

```
bridge.ts --value(applyInit/applyText/applyTheme/applySelection/applyDisabled/blurComposerInput)--> editor.ts
editor.ts --value(post)--> bridge.ts
```

**问题本质**：与环 D 同构但是**退化版**——只有 2 文件 2 边。

**修复方案**：与环 D 的 a 方案完全相同：把 `post` 抽到
`apps/mobile/src/web/composer-input/webview/runtime/post.ts`（或与 transcript 侧共用
`web/shared/post.ts`——`web/shared/` 已是 mobile WebView 三域共享目录，RULE 与
`20260830-mobile-cr-dedup-abstraction` 记忆记载「web 三域 post/applyTheme/双通道监听三份平行」
正是同一个问题）。

**建议**：与环 D 一起做，且**两处共用 `web/shared/post.ts` 一个文件**——
这同时回应了历史记忆里那条「三份平行」的技术债（那次只做了 mobile 内部收敛，
没意识到 chat-transcript 与 composer-input 是两个 WebView 域各自的平行实现）。

**置信**：confirmed

---

### 修复优先级汇总

| 环 | 文件数 | value 边 | 修复成本 | runtime 风险 | 建议 |
|---|---|---|---|---|---|
| A (CYC-003) | 3 | 3 | 低（搬 1 个常量到 domain） | 无 | **必做**：唯一有层级倒挂语义问题 |
| D (CYC-011) | 6 | 14 | 低（抽 `post`） | 无 | **必做**：最大环，防未来 TDZ |
| E (CYC-013) | 2 | 2 | 极低（与 D 共用一个文件） | 无 | **必做**（搭 D 的车） |
| C (CYC-008) | 2 | 2 | 中（合并两文件，需核依赖方向） | 无 | 可做 |
| B (CYC-005 子环) | 2 | 2 | 极低（改惰性 import） | 无 | 可做 |

**5 个环全部 runtime-safe，无一需要紧急处理。** 但 A 与 D+E 合计只改 3 个文件
（`builtin-skill-names.ts` 新建 + `post.ts` 新建 + 3 处 import），
却能让 core 与 mobile 的静态环数归零，性价比极高，建议打包成一个迭代。

---

## 争议与存疑

1. **「7 个真环 vs 5 个真环」的口径分歧（组 16）**：我确信 5 个是对的（两套独立脚本 +
   逐环读 import 语句验证每条边的 `import type` / `import` 形式），
   但 **L0 报告是别的机位产物的确定性普查**，我改它的汇总数字属于越界。
   我在本报告只给证据与建议，**不代改 L0 文件**（只读纪律），由主代理裁决。
   若主代理采纳，建议同时更新 L0 的「已知局限」补 JSDoc 误判这条。

2. **组 8（flush-run-ui）标 intentional 但缺文档**：我判断 `{immediate: true}` 机制
   是平台差异（mobile RN 有 200ms 合并、desktop renderer 没有），不该强行统一。
   但我没有找到任何文档或规则**明确**说这是有意的——我是从代码形态推断的。
   标 `intentional(suspected)`：若主代理或 W2 机位能找到拍板出处，可升级为确认。

3. **组 15 第 2 条（mobile `NEAR_BOTTOM_THRESHOLD_PX` 是否重复定义）标 suspected**：
   我确认了 desktop 侧常量在 `chat-messages-scroll.ts`、mobile 侧在 `web/shared/constants.ts`，
   但**没有逐行确认 mobile 的 `webview-host/chat-transcript/scroll.ts` 是否也自己定义了一份**。
   若确有两份，是 P2（同一 UI 阈值两份定义，改一处忘另一处会导致两端「吸底」手感不一致）。

4. **「可下沉 core」清单的边界判断**：我给每个函数标了「可下沉 / 留各端」，
   但**「可下沉」不等于「应该下沉」**。core 的 public 面有快照测试
   （`packages/core/test/` 下的 package-exports 快照，记忆记载
   「core/public 加导出要同步快照」），每加一个导出都要改快照。
   组 10（12 个函数）与组 12（11 对）加起来会让 core public 面显著变大，
   **是否值得要主代理与 W5 reduce 权衡**——我给的是「技术上可下沉」，
   不是「应该现在下沉」。

5. **desktop 的 DTO 适配壳要不要一起搬**：组 7 我建议 `chatMessageFromDto` 留在 renderer，
   理由是它含 IPC 边界知识。但也有人会主张 DTO→domain 的映射也该进 core
   （让 core 提供 `chatMessageFromDto`，两端共用）。我倾向留在 renderer，
   因为 `@shared/ipc-types` 是 desktop 私有类型，core 不该认识它。**这一条可能有争议。**

6. **组 3（session-default-title）的文案差异可能是有意的**：mobile 叫「新会话1」、
   desktop 叫「会话1」，可能不是漏改而是两端各自的 UX 措辞决策。
   我没找到拍板记录。**如果是有意的，下沉方案要保留「前缀由调用方传入」的设计**
   （我在建议里已经这么写了），所以这个分歧不影响修复方案本身。

7. **未覆盖**：`apps/cli` 与 mobile/desktop 的重复（zone 外）；packages/core 内部
   的重复（core 域机位负责）；测试文件里的重复（`__tests__` 与 `test` 已排除）；
   WebView 内联 HTML/CSS 的重复（不在 ts/tsx 范围）。
