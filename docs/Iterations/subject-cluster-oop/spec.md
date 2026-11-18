# subject-cluster-oop：命名级主体聚类收口

> 目标仓库：`D:/worktree/error-channel-slim`（分支 `feat/error-channel-slim`）
> 基线：`p23-create-factory`（若尚未打 tag 则以其 HEAD 为基线）
> 目标 tag：`p24-subject-cluster`

## 一、判据

**统一原则：概念单元该拥有它的全部操作。** 名字里的主体词是「缺归属」的症状——主体没有归属时，每次操作都得把主体写进名字，于是名字越写越长；归属到位后，主体进 namespace / class，方法名只留动词。

`create*` 与本 spec 的其他动词族是**同一原则的两面**：

| 视角 | p23（create-factory） | 本 spec |
|---|---|---|
| 名字结构 | `create` + 主体（`createVfsService`） | 其他动词 + 主体（`readSessionApiPromptTokenEntry`） |
| 信号方向 | 同一动词（create）、多主体 → 各主体自己的 Factory | 同一主体、多种动词 → 主体 namespace |
| 终态形态 | `VfsServiceFactory.create(...)` | `SessionApiPromptTokenEntry.read(...)` |
| 本质 | 「VfsService 装配」这个概念单元拥有它的全部装配动作 | 「Entry 编解码」这个概念单元拥有它的全部操作 |

终态形态完全一致（object namespace / object with methods），只是主体类型不同（装配主体 vs 数据/流程主体）。**执行层面两期分开**（函数集零交集、p23 已在跑），方法论在 SKILL.md 收口时写成一条统一判据（见 §四 步骤 7）。

**本 spec 的具体判据**：同一主体出现 ≥3 种动词（不含 create——create 族归 p23），说明主体是事实上的概念单元但没有归属。

三个可机械化的信号（执行者跑检测器复核，不要信本 spec 的数字）：

1. **同主体多动词**：camelCase 拆词，首词为动词、其余为主体；同主体 ≥3 种动词 → 聚合候选。
2. **修饰词复读**：`ForTests` ×30、`After*` ×10、`FromLayout` ×6、`InTransaction` ×3 —— 同一缺失上下文批量出现。
3. **超长名**：≥32 字符 38 个。长名不是罪，是「没有归属」的度量。

**误报过滤**（写进检测器）：React 组件名（首词大写名词：`AgentEditorScreen`）、`ByXxx` 查找器（主体在 `By` 前面：`findById`）、分层对（repo 层与 service 层同名族，见 §二 B 类）。

### 1.1 更根本的信号：顶层裸函数本身就是异常态

即使构不成 ≥3 动词的族，**顶层裸 export 函数也不该是默认形态**。作用范围应由结构（namespace / class）表达，而不是由文件位置 + 名字后缀表达。仓库已有正面先例：`common/` 的 25 个函数在 p12 收成了 `Coerce` / `Guards` / `Json` / `Text` / `Number` / `Encoding` / `Xml` / `Hash` / `Errors` / `Release` / `TokenFormat` 11 个 namespace——其中很多就是单函数或小函数族。**同一个仓库两种风格并存，正是「糟糕」的来源**：`common/` 里是 `Text.decodeHtmlEntities`，`domain/vfs/logic/` 里却是裸的 `resolveLogicalPath`。

基线实测（`all-signatures-p24.txt`，3162 签名）：

```
顶层裸 function    2124 个      ← 绝对主导形态
顶层裸 const/let    294 个
已有归属（方法）     少数（SSE parser 的 namespace 成员、类方法）
纯裸文件（裸 ≥3、无方法）  291 个
```

裸函数最多的文件本身就是天然的 namespace 边界：

```
37 裸  apps/mobile/src/web/composer-input/webview/runtime/editor.ts
26 裸  apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts
24 裸  packages/core/src/domain/abort/logic/create-abort-scope.ts
21 裸  apps/desktop/src/main/ipc/handlers/agent.ts
21 裸  apps/mobile/src/components/chat/message-blocks.ts
```

**落地必须分层，一次改 2124 个是灾难**：规则层立即生效（拦新增），存量层按域渐进（本 spec 只做试点，铺开另行排期）。

## 二、调研结果（基线 `all-signatures-p24.txt`，3162 签名）

同主体 ≥3 动词共 **35 族**，逐族定性如下。

### A 类：同文件纯函数族 → object namespace（11 族，本 spec 主体）

| 族 | 动词 | 文件 | 终态形态 |
|---|---|---|---|
| `SessionApiPromptTokenEntry` ×5 | invalidate/parse/read/serialize/write | `core/infra/tokenizer/logic/session-api-prompt-token-store.ts` | `SessionApiPromptTokenEntry = { read, write, invalidate, parse, serialize }` |
| `LogicalPath` ×3 | resolve/to/validate | `core/domain/vfs/logic/vfs-path-mapper.ts` | `LogicalPath = { resolve, to, validate }` |
| `ChatTokenEstimateMemo` ×3 | clear/lookup/remember | `core/infra/tokenizer/logic/chat-token-estimate-memo.ts` | `ChatTokenEstimateMemo = { lookup, remember, clear }` |
| `MobileDatabaseFilePath` ×3 | default/get/resolve | `apps/mobile/src/db/db-file-path.ts` | `MobileDbFilePath = { resolve, get, default }` |
| `RebootWaiter` ×3 | arm/claim/settle | `apps/mobile/src/runtime/reboot-waiter.ts` | `RebootWaiter = { arm, claim, settle }`（十八期「与 callback-slot 分开维持」判的是运行时形态，namespace 化不改运行时） |
| `SessionViewCache` ×3 | clear/get/set | `apps/mobile/src/services/chat-session-view-cache.ts` | `SessionViewCache = { get, set, clear }` |
| `ChatComposerDraft` ×3 | clear/subscribe/write | `apps/mobile/src/storage/chat-composer-draft.ts` | `ChatComposerDraft = { write, subscribe, clear }` |
| `ContextMenu` ×3 | close/layout/render | `apps/mobile/.../runtime/menu/menu.ts` | `ContextMenu = { render, layout, close }`。**注意**：同文件已有十八期 C1 的 `contextMenuViewSlot`，两者职责不同（slot=宿主侧注册，这族=webview 内渲染），先读代码再动 |
| `RowWindow` ×3 | desired/measure/retarget | `apps/mobile/.../render/row-windowing.ts` | `RowWindow = { measure, desired, retarget }` |
| `StreamRichUpgrade` ×3 | clear/flush/schedule | `apps/mobile/.../stream/stream-markdown.ts` | `StreamRichUpgrade = { schedule, flush, clear }` |
| `PreciseUpgrade` ×3 | cancel/run/start | `apps/mobile/src/services/chat-prompt-tokens.service.ts` | **待执行者判**：chat-prompt-tokens 双端平行结构在未采纳台账里，若 desktop 侧有同族则一起收，没有则单端 namespace |

### A′ 类：同目录跨文件族 → 先合并文件再 namespace（2 族）

| 族 | 动词 | 文件 | 处置 |
|---|---|---|---|
| `FsCommand` ×3 | classify/execute/parse | `core/domain/tool/logic/fs-command-classify.ts` + `fs-command.ts` | `classify` 并入 `fs-command.ts`，`FsCommand = { parse, classify, execute }` |
| `ProviderTableSnapshot` ×3 | dump/restore/validate | `core/infra/db-backup/provider-table-snapshot.ts` + `provider-table-snapshot-validate.ts` | validate 并入 snapshot.ts，`ProviderTableSnapshot = { dump, restore, validate }`（十九期 L4b 刚把 validate 改成 Result 通道，函数体不动只搬家） |

### B 类：分层族 → 跳过（repo 层与 service 层是职责不同，不是重复）

| 族 | 分布 | 跳过理由 |
|---|---|---|
| `ComposerDraftJson` ×6 | sqlite-session.repository（get/set）+ session.service（get/set）+ composer-draft.schema（parse/serialize） | repo=存储、service=业务委托、schema=编解码，三层职责 |
| `DirRule` ×4 / `FileRule` ×4 | sqlite-workplace.repository（find/upsert）+ workplace.service（get/set） | 同上分层 |
| `SessionAgentConfig` ×4 | sqlite-session.repository + session.service | 同上分层 |
| `CurrentAgentId` ×4 | persistent-state.service（get/set/reset，十七期 C3 配置表化产物）+ agent-run-shared.ts（resolve 业务逻辑） | 指针三元组与业务 resolve 职责不同 |
| `LlmStreamEnabled` / `SubagentStreamEnabled` / `ThinkingContextEnabled` ×3×3 | persistent-preferences.service 同文件 | **十八期 V1 已裁决**：27 个 typed 门面全有生产消费者（114 调用点），保留。不翻案 |

### C 类：跨文件/跨端族 → 逐个读代码判（5 族，执行者必给结论）

| 族 | 分布 | 判断要点 |
|---|---|---|
| `StreamRowIds` ×5 | mobile 3 文件：transcript-stream-projection / session-stream-unit / session-stream-unit-manager | apply/get/idle/inherit/trim 分居三处——读是否同一状态机的不同侧面；是则收 `StreamRowIds` namespace 落 unit 文件，否则给「三处各自语义」证据 |
| `VfsZip` ×4 | core（build/parse 编解码）+ mobile（export/import 流程） | build/parse 与 export/import 是原语 vs 流程。若判分层则跳过，并把「mobile 的 export/import 调 core 原语」的调用链写进 notes（关联二十期 vfs-zip 劈三段问题） |
| `FileCachePayload` ×3 | session-kkv（hash）+ workplace（parse/serialize） | hash 在 blob 层、parse/serialize 在快照层。二十期刚搬过 `fileCacheKey` 进 workplace——若 hash 也搬则三者同域收一个 namespace；若 blob 层语义独立则跳过并写明 |
| `HostMessage.handle` ×4 | mobile 四个 webview bridge.ts 各一份 | 十八期 C8 只收了 encode/decode 信封（createMessageBridge），`handleHostMessage` 是各桥 runtime 消费端。判：四份是「同一分派逻辑的四次复制」还是「四个 runtime 各自的入口」；前者抽 `createHostMessageHandler`，后者登记保留 |
| `DbMaintenance` ×4 | desktop handler（do/handle）+ desktop/mobile service（run） | do/handle/run 三动词疑漂移。读 desktop handler：do 与 handle 是否同函数转手；是则删其一并把动词统一成 run（与 service 对齐） |

### 误报（过滤规则已处理，不进范围）

`TreeRows` ×4（project/projects/scope/sessions 是四个主体，projects 是名词复数）、`EditorScreen`/`DetailScreen`/`MessageRow`（组件名）、`ById`/`BySession`（查找器后缀）。

### 修饰词复读的处置

| 组 | 数量 | 处置 |
|---|---|---|
| `FromLayout` ×6 | 全在 `core/service/prompt/render-prompt.ts` | **这 6 个已是 `PromptBuilder.xxx` 的成员绑定别名**（十八期 known-false-positives 已登记 5 个）。按 p22 引用别名判据复核：消费方能直引 `PromptBuilder` 的删别名，能删几个删几个 |
| `ForTests` ×30 | 双端散布 | **不改代码**。命名前缀不统一（`__setXxxForTests` / `resetXxxForTests` / `xxxCountForTests`）。写进 SKILL.md §7：测试接缝统一 `xxxForTests` 命名、注入型统一 `__setXxxForTests`；检测器只计数不拦截 |
| `After*` ×10 | refresh/handle/notify 事件族 | **不做**。`refreshComposerStatusAfter*` 双端镜像十八期刚判保留；其余各自域的事件刷新，事件名即语义，namespace 化收益低 |
| `InTransaction` ×3 | message-checkpoint 2 + tdbc 1 | 名字里的 InTransaction 是**前置条件标注**（必须在事务内调用），不是上下文外泄。跳过。但用户点名的 `resolvePathsNeedDeleteInTransaction` 给终态示例：文件是 `resolve-reconcile-paths.ts` → `ReconcilePaths = { resolveNeedDelete(tx, args) }`，35 字符 → 22 字符。归入 A 类待判（执行者读 `resolve-reconcile-paths.ts` 全文后定，同文件还有哪些 reconcile 函数可一起收） |

## 三、明确不做

- **不改任何函数体**（除 C 类判定出「动词漂移需删重复入口」的 `DbMaintenance`）。全部改动是：函数从顶层搬进 object、调用点改 `X.foo(...)` 形态、删空文件。
- **不翻十八期的裁决**（persistent-preferences 27 门面、composer-status 双端镜像、RebootWaiter 三态运行时形态）。
- **不碰 p23 正在做的 create-factory**（两组函数零交集：本 spec 的 A 类全是普通函数族，不是装配工厂；`PreciseUpgrade` 在 mobile services 目录，p23 不涉及）。
- **不合并 `createChatServices` bundle**，不动 public exports 子路径。
- **不做全仓长名改名**。长名只在「同族聚合顺带解决」时才变短，不为改短而改短。

## 四、执行步骤

1. **写检测器** `scripts/list-subject-clusters.mjs`（复用 `list-all-signatures.mjs` 的 AST 提取，四类视图：同主体族 / 修饰词复读 / 长名榜 / **裸函数榜**；误报过滤规则照 §一）。`--gate` 模式 + baseline JSON，**只拦新增族与新增裸导出**。
2. **规则层（波 0，先于一切改码）**：SKILL.md 写入统一判据——「概念单元该拥有它的全部操作；顶层裸 export function 需要理由，默认挂 namespace（文件即天然 namespace，文件名即 namespace 名）」。`check-style.mjs` 加第四段 `bare-exports`：`--changed` 模式只报本次改动新增的顶层裸 export（存量 2124 不拦，防全仓反弹）。React 组件、`.tsx` 文件、test helpers 豁免。
3. **A 类 11 族逐族收口**，每族一个独立 commit：建 namespace → 改调用点 → 删空文件 → 跑该组消费方编译。
4. **A′ 类 2 族**：先并文件再 namespace。
5. **C 类 5 族判定**：每族产出「处置 + 证据（file:line）」，判「收」的当场做，判「跳过」的写进 notes。**判定不出的先跳过，不许硬改。**
6. **FromLayout 6 别名复核**（p22 判据）。
7. **裸函数存量试点（3 个文件，不铺开）**：`editor.ts`（37 函数）、`stream.ts`（26）、`create-abort-scope.ts`（24）。每文件收成一个 object namespace（文件名即 namespace 名），目的是**实测单位成本**（改码量 / 调用点数 / 测试影响），产出「剩余 288 个纯裸文件的排期表」，不在本 spec 内铺开。
8. **收敛**：根 typecheck + core/desktop/mobile 全量 + `check-style --all` 四段（含新 bare-exports，存量豁免） + dup-gate + 新门。
9. **SKILL.md 补 §9.4 名词族的机械化信号**（检测器已实现，skill 引用命令即可；统一判据已在波 0 写入）。
10. 打 tag `p24-subject-cluster` / `p24-subject-cluster-partial`。

**分片提示**：A 类 11 族分布在 core 4 / mobile 7，可按文件分 3-4 片并行（零交集）；C 类判定是只读可并行，改代码串行在判定之后；3 个试点文件分属 mobile×2 / core×1，可并行。

## 五、验收

```
1. 根 typecheck                        exit 0（14 workspace）
2. core / desktop / mobile 全量测试     exit 0
3. check-style 四段                     signatures / inline / methods PASS；bare-exports 新增 0（存量豁免）
4. dup-gate                             新增 0（注意：namespace 化会产生「同方法名」新组——如 SSE parser 的 feed/drain 先例——逐个登记 baseline 并写理由，不算新增违规）
5. list-subject-clusters --gate         新增族 0、新增裸导出 0
6. A 类 11 族的原顶层函数名全仓 grep     0 残留（如 invalidateSessionApiPromptTokenEntry 等旧名）
7. C 类 5 族                            每族一条明确结论（收/跳过 + 证据），不允许「未判定」
8. FromLayout 别名                      按复核结论删，残留的每个带 keep 理由
9. 3 个试点文件                         旧顶层函数名 0 残留；排期表产出（剩余纯裸文件按「函数数 × 消费方数」排序）
```

## 六、风险

| 风险 | 缓解 |
|---|---|
| namespace 化后 dup-gate 报「同方法名」新组（`ContextMenu.render` vs 别处的 render…） | 预期内。SSE parser 先例已定格式：登记 baseline + `judgedAfterP24` 理由 |
| mobile webview 内函数（ContextMenu/RowWindow/StreamRichUpgrade）可能在 bundle 闭包里有本地镜像 | 改前 grep 同名函数，有镜像的按「文案镜像逐字保留、代码镜像合并」判 |
| `PreciseUpgrade` 与未采纳台账的 chat-prompt-tokens 平行结构纠缠 | 判不出就跳过，台账里已有这项，不扩张 |
| object 属性方法被 check-inline/check-signatures 口径变化影响 | 跑三段 + 对比 known-false-positives 数量变化，新增假阳性照旧登记 |
| p23 与本 spec 在 worktree 上时序冲突 | 等待 p23 tag 后开工，基线以 p23 HEAD 为准 |

## 七、检测器规格（步骤 1 的验收）

```bash
node scripts/list-subject-clusters.mjs <repo> --all            # 三种视图
node scripts/list-subject-clusters.mjs <repo> --gate           # 与 baseline JSON 比对，新增族 exit 1
node scripts/list-subject-clusters.mjs <repo> --gate --write-baseline
```

输出四种视图：
1. **同主体族**：主体 | 动词×次数 | 文件列表 | 同文件/跨文件/跨端标注
2. **修饰词复读**：ForTests / After* / FromLayout / InTransaction / With* / By* 计数与清单
3. **长名榜**：≥32 字符，按长度排序
4. **裸函数榜**：按文件聚合的顶层裸 export 函数计数（纯裸文件优先排序），`--gate` 拦新增

过滤规则内置：组件名（首词大写）、`ByXxx` 查找器、`Class.method` 与 `Obj.method` 形态（已是方法）、React 组件与 `.tsx` 文件豁免裸函数判定、test 目录可选 `--include-tests`。
