# CR Fix Spec: cr-r4（合并 main 之后的自有增量评审）

## 元信息

- repo / 分支：`D:\Dev\nm-worktree\crr3`（fix/cr-r3）
- base_sha / head_sha：`6b599214`（merge main 之后）→ `6a0b4b24`（真实 HEAD 以 `git log -1` 为准）
- 范围：31 文件 +2627/-83 = 四批自有提交：①e605cc73+d3b1049a（组装中止 + fingerprint + 估算记忆 + 双端接线）②41b32b03（估算增量分解）③add4b386（mobile 切会话清 chip）④7ed2ad35/8b079649/97779817（解压产物缓存统一层 + 测试 + 存量红修复）
- 对照口径：`fix-record-20260930-decode-cache.md`、`fix-record-20260930-phase2-delivery.md`、`features/message-token-cache/spec.md`、`cr-fix-spec-r3.md`、`docs/apm/RULE.md`（worktree 版）
- review_round / dag_version：1（diff 模式；两段式 = evidence×3 并行 → review×1 裁决，证据包 `cache/cr-r4-e{1,2,3}-*.md`）；执行轮 wave-0 四节点 + cr-func **func-ready: yes**
- 主代理抽查：r4-core-2 与 r4-app-1 两条 P1 已按 file:line 回读实锤；r4-core-1/3/4 与 r4-app-2 的关键事实与代码一致
- 状态：**已执行完毕（dev-ready，见「执行记录」「终验记录」）**

## Must-fix（P0 = 0；P1 = 3；P2 = 6）

### r4-core-1 [P1] 估算记忆键缺 layout 段——「同键 ⇒ 序列化产物同值」不成立
- 维度：B
- 文件：`packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts:140-160`（buildChatTokenEstimateMemoKey）、`resolve-current-prompt-tokens.ts:320-325`
- 问题：键只含 `model|fp|msgStamp|toolsStamp`，而序列化产物还受 **layout（system/persist/dynamic）** 与 `ctx.now`/filetree 影响。agent 定义被编辑（system/persist/dynamic 变）时键不变 → 命中旧读数；模块头声明「同键 ⇒ 序列化产物必然同值」被推翻（声明级 spec deviation）。
- 改法：键补一段**廉价 layout 摘要**——`hashContent(JSON.stringify({system, persist, dynamic})).slice(0,16)`（layout 仅几千字符，成本相对整串线性扫可忽略）。`{now}`/filetree 是回合快照、回合内不变：在键的注释里写清「键按回合有效，跨回合靠 msgStamp/layout 段变化自愈」的边界，不为它们加段。
- 验收：新用例「fp/msgStamp/tools 逐字相同、仅 `layout.system` 变 → lookup 必 miss」；模块头声明同步改为与键一致。
- 来源：review-r4-diff（e1-1）

### r4-core-2 [P1] run 侧丢弃 fingerprint——压缩评估全程无记忆/无增量分解
- 维度：B + E
- 文件：`packages/core/src/service/agent/impl/agent-runner.ts:417`（解构）、`:481-489`（promptRenderCtx）
- 问题：`const { workplaceDisplay, prefixPaths } = await assembleWorkplaceDisplay(...)` 把已产出的 `fingerprint` 丢弃，`promptRenderCtx` 不含 `workplaceFingerprint` → 压缩评估（token-ratio trigger 消费 `evaluation.ctx`）永远走无指纹路径：既不命中记忆、也不走增量分解，①②批的收益在 run 侧评估链完全未生效。
- 改法：解构补 `fingerprint`；`promptRenderCtx` 补 `workplaceFingerprint: fingerprint`（该字段只被 resolve/memo 消费，渲染侧忽略，零行为影响）。
- 验收：用例断言「压缩评估那次 resolve 收到的 `ctx.workplaceFingerprint` 非空」；或断言评估期不再发生整串 `serializePromptLlmInput`（可用 spy 计数）。
- 来源：review-r4-diff（e1-10）

### r4-app-1 [P1] refreshChatMeta 落地无身份闸——旧会话 meta 可写进新会话
- 维度：B
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:332-338`
- 问题：`await metaPromise` 后的 `setAgentMeta(prev => ({...prev, ...meta, tokenLabel: prev?.tokenLabel ?? '…'}))` 无会话身份闸——切会话后，旧会话在途的 `loadChatAgentMeta` 落定会把**旧会话的 agentName/modelName 等**写进新会话（tokenLabel 因显式保留恰好幸免）。提交信息宣称「meta合并」残留源已收口，实现只保住了 tokenLabel。
- 改法：落定前加闸——判 `refreshChatMetaInflightRef.current?.promise === metaPromise` 再 set（单槽在途 ref 已存在，语义就是「只有最新一轮才许落地」）；catch 分支的 `setAgentMeta(undefined)` 同闸。
- 验收：新用例「s1 的 loadChatAgentMeta 挂起 → 切 s2 → 放行 s1 → s2 的 meta 字段（agentName/modelName）未被 s1 覆盖」。
- 来源：review-r4-diff（e3-2）

### r4-core-3 [P2] 估算写可覆盖已落地的精确档（与「升级语义」相悖）
- 维度：B
- 文件：`packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts:82-88`（rememberChatTokenEstimateMemo）
- 问题：同键下，起于精确写之前、落于其后的估算写会无条件覆盖精确条目 → 下一估算帧回落估算档（下一轮精确轮自愈，但违背模块头「升级语义」宣称的单调性）。
- 改法：`remember` 内若同键既有条目 `estimated === false` 而新条目 `estimated === true`，保留既有（不覆盖）。
- 验收：单测「先写精确档、再写同键估算档 → 读回仍是精确档」。
- 来源：review-r4-diff（e1-6）

### r4-core-4 [P2] 指纹段不带正文体量——mtime 同而正文异时指纹假同
- 维度：B
- 文件：`packages/core/src/service/workplace/assemble-workplace-display.ts:191`
- 问题：指纹段 = `path|status|mtimeMs`；树复制（vfs-tree-copy）保留源 mtime、写侧只有毫秒精度，存在「mtime 同、正文异」的路径 → 指纹假同 → 记忆/指纹估读返回陈旧值。
- 改法：指纹段补 `|${payload.body.length}`（近零成本）。
- 验收：单测构造「同 path/status/mtime、不同 body」→ 指纹必须不同。
- 来源：review-r4-diff（e1-8 残余 + 裁决升级）

### r4-core-5 [P2] memoKey 两处逐字重复构造
- 维度：C（DRY）
- 文件：`packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts:320-325` 与 `:434-439`
- 问题：两处 `buildChatTokenEstimateMemoKey({...})` 参数逐字相同、分处两作用域无共用。r4-core-1 落地后参数变长，重复面变大。
- 改法：在所在作用域提取 `resolveMemoKey()` 局部函数；**保持调用位置不变**（估算分支的构造必须留在 `bail()` 之后，勿把 `JSON.stringify(messages)` 挪到序列化重活之前）。
- 验收：纯重构，相关测试全绿。
- 来源：review-r4-diff（e1-11）

### r4-app-2 [P2] 切会话清场是 useEffect——「一帧不漏」无机制保障
- 维度：B
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:109-116`
- 问题：清场 effect 在提交后才跑，切会话那一帧仍可能绘出旧数字；提交信息宣称「旧数字一帧不漏」但机制是 post-paint 的。
- 改法：换 `useLayoutEffect`；或渲染期派生态（记录 label 所属 sessionId，渲染时按 `labelSessionId === sessionId` 取值）。取前者（改动最小）。
- 验收：切会话后的首个 commit 即断言 `tokenLabel === '…'`（与 r4-app-4 的用例修复合并做）。
- 来源：review-r4-diff（e3-3）

### r4-app-3 [P2] mobile build 测试「恰 4 次」依赖 fixture 形态
- 维度：G
- 文件：`apps/mobile/__tests__/session-prompt-input.service.test.ts:141`、`:172`
- 问题：`toHaveBeenCalledTimes(4)`/`bailCalls()).toBe(4)` 只因 fixture 未开 workplace 块才成立（开了就会 >4）——断言含义随 fixture 漂移。
- 改法：fixture 显式开 workplace 块并把期望写成「4 + 组装内检查点次数」，或固定不开并在断言旁写死前提注释。
- 验收：改后断言仍表达「分段弃权按序触发」的意图（非恒真、非随 fixture 漂移）。
- 来源：review-r4-diff（e3-4 收窄；e3 证据包 4-D「mobile 无段序断言」系取证失误——`__tests__/session-prompt-input.service.test.ts:144-173` 四段翻真用例存在，勿照抄）

### r4-app-4 [P2] chip 清场用例第一条断言恒真
- 维度：G
- 文件：`apps/mobile/src/screens/tabs/chat-tab/__tests__/use-chat-tab-scope-token-debounce.test.ts:295-336`
- 问题：三段断言里的①（切到 s2 后 `tokenLabel === '…'`）恒真——s1 读数全程挂起未落地，切会话瞬间 state 本就是 `'…'`，删掉新增 effect 也照样过；「旧数字一帧都不许出现」的前提从未被制造。
- 改法：先让 s1 标签真落地（防抖到期 + 读数回填）再切 s2，才构成前提；与 r4-app-2 合并成一条有牙用例。
- 验收：本地变异验证一次——去掉新增清场 effect，该用例必须红。
- 来源：review-r4-diff（e3-10）

## Spec deviations

- **r4-core-1 对应的声明级偏离**（memo 模块头「同键 ⇒ 序列化产物必然同值」与实现不符，且与 `features/message-token-cache/spec.md:37` 的 L1 内容指纹键语义不同源）→ 随 r4-core-1 修复闭合，模块头注释同步改。
- 已记录、本轮不重复立项的偏离：三条观测面切换（blob-gc / rollback-ref-count / vfs-tree-copy-batch）、bulk delete/回滚不 forget（id 不复用前提）、命中后仍逐条 serializeFileCachePayload、file_cache fire-and-forget 回写、L1/L2 seed-once、token-ratio 不透传 shouldBail。

## Open questions / 待拍板（不阻塞 fix-spec-ready）

- **r4q-1 内容池延长「已回收 blob」的明文寿命**：`scanContents`（`sqlite-vfs-entry.repository.ts:880-883`）「缺 blob 必抛」在热态失效，树复制慢路径可能静默成功而非回滚失败——正文按 hash 保证正确，是**失败语义冷/热不一致**（重启才暴露）。取舍：接受并补记 vs 要求保留失败语义（命中前加存在性校验 = 额外 SQL）。**建议：接受 + 补记**（与 GC 语义正交，校验成本回到每次读一条 SQL）。
- **r4q-2 池不分连接/库域**：生产每进程单连接成立；出现第二连接时会按 message id 串池。**建议：暂不动，`infra/content-cache` 模块头补一句「单连接前提」**。
- **r4q-3 兜底链不可弃权**：mobile `chat-prompt-tokens.service.ts:468`、desktop 异常回落重跑完整 build 均不传 shouldBail。量级未量化。**建议：挂账待真机读数再定**。
- **r4q-4 可选硬化**：blob 归一任务「只换字节形态、明文不变」无断言锁。**建议：补一条「归一后解码明文逐字节不变」用例**（一颗牙，便宜）。
- **r4q-5 memo 按 sessionId 无上界**：每会话一条、从不逐出（条目极小）。**建议：顺手加 64 条截断（与 workplaceEstimateByFp 同款）**。
- **r4q-6 双端 buildSessionPromptInput 无机制化 parity**：本轮实测未退化（mobile 四段翻真用例存在），属「要不要抽 core 共享骨架」的架构决策。**建议：暂不动，留待 WebView 统一化迭代一起拍**。

## 已豁免（用户确认不修）

- 无。

## 合并后 QA（manual_user，不阻塞）

- 真机切会话/进会话：`[nm-chip-build]` 分段耗时应显著变短（解压产物缓存 + 增量分解的端到端效果）；切会话旧数字一帧不漏（r4-app-2/4 修后复核）。
- 双端压缩标签直达精确档、run 期间 chip 不动（沿用 cr-r3 QA 清单）。
- 云同步 pull / 导入备份后消息内容正确（bootstrap 清池的端到端场景）。

## K 节建议（执行时闭合）

- 执行完 9 条后：eslint 过新增行；core/desktop/mobile 三处 typecheck；测试门 = core 全量（时区 2 例已知）+ desktop 全量（tmp/desktop-full.mjs）+ mobile 全量（--maxWorkers=2）；core dist 重建后才跑双端测试。
- 执行序建议：r4-core-1 → r4-core-2 → r4-app-1（P1 先行）→ r4-core-3/4/5 一批 → r4-app-2+3+4 一批（app 侧三条同文件相邻，合并做 + 一次变异验证）。
- r4q-4/r4q-5 若用户点头，随 P2 批顺手做；r4q-1/2 补注记即可。

## 执行记录（2026-09-30，code-dev-loop wave-0 四节点）

9 条 must-fix + r4q-4/r4q-5 顺手件全部落地；r4q-1/2 以模块头注记收口。各节点均自带变异验证（改错必红）。

**已裁定偏离（相对本 spec 字面，方向经主代理核实接受）**：
1. **r4-core-1 摘要字段面放宽**：layout 摘要比 spec 字面的 `{system, persist, dynamic}` 多纳入 `persistEnabled/dynamicEnabled/workplace/customAttach/skillsEnabled/skillsPrefix`。理由成立：开关位一拨、整段正文进出序列化产物而三区文本逐字不变，只哈希三区文本则「同键 ⇒ 产物同值」仍不成立。成本同量级（一次 stringify + sha256）。
2. **r4-app-1 闸判据改轮次计数**：spec 字面的 `refreshChatMetaInflightRef.current?.promise === metaPromise` 恒假（槽内存外层 IIFE promise，metaPromise 是内层 loadChatAgentMeta 返回），照写 meta 永不落地。实现改为槽内 `round` 轮次比较（`isCurrentRound()`），语义等价且覆盖四条分支（成功合并/链尾标签刷新/失败清场/无会话清场）——比 spec 字面更完整。
3. **r4-app-2 测试补静态机制锁**：jsdom + act 下 useEffect/useLayoutEffect 行为面不可区分，行为断言无法锁机制；测试里补一条源码静态守卫（断言清场用 useLayoutEffect）作为变异②的唯一判据。属加料，保留。
4. **r4-app-3 走「开块 + 公式常量」路线**：fixture 显式开 workplace 块（2 文件），检查点总数实测 **7 = 4 段界 +（快照后 1 + 每文件 1 次 × 2 文件）**，序号写成公式常量；断言旁注明构成并补「组装真跑过」前提断言。

**主代理顺手件**：`prompt-render-context.ts` 与 memo 模块头两处指纹描述的文档漂移（补 `|bodyLen` 段说明）。

**验证**：四节点定向全绿（tokenizer 219 / agent 309 / workplace 111 / mobile chip 8 套件 53 + build 7/7 + 归一 27/27）+ 各自变异红/绿证据；core dist 已重建、core tsc 干净。三道全量门（core → desktop → mobile）结果见下方「终验记录」。

## 终验记录（三道全量门）

- core 全量：**3057 / 3055**，仅 T-C2/T-C6 时区已知基线 2 例（core dist 已重建、`tsc --noEmit -p tsconfig.json` 干净）。
- desktop 全量：**620 / 620**（tmp/desktop-full.mjs 收集器）。
- mobile 全量：**1735 / 1734**，仅 mermaid-fullscreen autocrlf 已知基线 1 例（`--maxWorkers=2`；比 r4 前多 4 例 = 本轮新增用例）。

## Fix-Spec Closure

| 项 | 状态 |
| --- | --- |
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/context-usage-overhaul/cr-fix-spec-r4.md |
| dag_version / review_round | 1 / 1（diff 单轮，两段式） |
| P0 / P1 / P2（已写入） | 0 / 3 / 6 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | r4-core-1 声明级偏离随修复闭合；其余为已记录取舍 |
| C-orch | 已查：双端 build 有等价足迹断言（e3 证据包 4-D 为取证失误，已纠正）；r4q-6 留拍板 |
| open_questions | 6（均有建议方向，不阻塞） |
| 合并后 QA | 见上，manual_user 不阻塞 |
