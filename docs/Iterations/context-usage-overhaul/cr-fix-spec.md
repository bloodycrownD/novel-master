# CR Fix Spec: context-usage-overhaul 全分支（四 feature + 性能修复链）

## 元信息
- repo：D:\Dev\nm-worktree\cuo（分支 feature/context-usage-overhaul）
- base_sha：f78f04a8 / head_sha：4f0a0eeb（26 提交、123 文件 +8621/-1035；head 以 `git log -1` 为准）
- prd_path：docs/Iterations/context-usage-overhaul/prd.md + features/*/{prd,spec}.md（四 feature）
- review_round：2 / dag_version：3（wave-1 四路 evidence → wave-2 review-full r1 裁决 → 主代理 spec-fix → review-full r2 校验：18 条全核「文件/行号/改法/验收」通过、两条 P1 代码级抽查通过、无漏定）
- 评审证据：cache/cr-e1-tokenizer.md、cache/cr-e2-runner-compaction.md、cache/cr-e3-kkv-workplace.md、cache/cr-e4-apps-integration.md（head_sha=4f0a0eeb 时生成）
- 状态：fix-spec-ready（已确认：两条 deviation 用户拍板收窄；进入 code-dev-loop 执行）

## Must-fix（按 P0 → P1 → P2）

### cr-tok-1 [P1] node 驱动强制估算档报 est:false 并落 KKV 持久层；双驱动同输入分叉
- 维度：B + A
- 文件：`packages/tokenizer-driver-node/src/count-prompt-llm-input.ts:248-264`（tiktoken 档 est:false）、`:211-215`（record 无条件收集）；`packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:215`（est===false 收集约束被绕过）
- 问题：读口对 WEB/SP 家族强制 `tokenizerOverride:"tiktoken"` 后，node 驱动 tiktoken 档报 `counterKind:"tiktoken", estimated:false` → `promptWholeCache.record` 收进 pendingWrites → 读口 `persistPendingWrites` 把估算读数以精确档形态写进 KKV，跨重启 seed 后 CLI/测试直调驱动拿到 est:false 的 cl100k 近似（fa 迭代要消除的「近似冒充精确」新形态）。rn 驱动同输入走 fallbackCount 报 `heuristic+est:true`（不落 KKV）——同输入双驱动分叉 `(tiktoken,false)` vs `(heuristic,true)`，数值口径也不同（node 含 OpenAI 消息 overhead 包装，rn 裸 cl100k 块和）。
- 改法：node 驱动 `computeCount` tiktoken 档增加判定——`resolveTokenizerFamily(vendorModelId,"auto") !== "tiktoken"`（即 tiktoken 身份来自 override 强制而非模型自身）时 `estimated=true`（counterKind 保留 "tiktoken"）。效果：强制档不再满足 record 的 est===false 收集条件、不落 KKV；rn 端天然 est:true，两端 estimated 对齐。counterKind 分叉（tiktoken/heuristic）保留——badge 两端同落 `gpt ≈`、触发器 `heuristic||estimated` 两端都命中，属 fa 既成解析语义。L2 块缓存不受影响（scope 含 override 段隔离续命）。
- 验收/测试：node 驱动新增直调用例——WEB 家族 vendorModelId + override:"tiktoken" → `estimated===true` 且 promptWholeCache 无新持久条目；gpt 系 + auto → 仍 est:false（防回归）；读口既有断言（resolve-current-prompt-tokens.test 统计优先组）不红。
- 来源：review-full r1（cr-tok-1）

### cr-chat-1 [P1] setMessageFloorAtMessage 跨会话 messageId 不校验（相对旧行为回归）
- 维度：B
- 文件：`packages/core/src/service/chat/impl/message-transcript-effects.service.ts:87-98`
- 问题：新版锚点 `this.deps.messages.get(messageId)` 全局按 id 查，无 `anchor.sessionId !== sessionId` 校验；旧实现 `listBySession(sessionId).find(...)` 对跨会话 id 天然 404。传入他会话的合法 user 消息 id 时，会拿他会话的 seq 对本会话错误范围执行 hideRange/showRange + 清两域 + 失效，静默写坏数据。
- 改法：get 成功后补 `if (anchor.sessionId !== sessionId) throw chatNotFound("message", messageId, { sessionId })`（与 message.service.ts:420 同款惯例）。
- 验收/测试：新增用例——两会话各建消息、跨会话传 id → 断言抛 chatNotFound 且两会话 hidden 状态零变化、KKV rule_snapshot/file_cache 未清、prompt token 条目未失效。
- 来源：review-full r1（cr-chat-1）

### cr-kkv-1 [P1] encodeFileCacheValue 生产零调用方（死代码）
- 维度：C
- 文件：`packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts:92-105`（含 `:22-34` EncodedFileCacheValue 接口，若仅它消费）
- 问题：587b2323 把 set 路径改为 hash→存在性检查→未命中才 compress 后，该函数退出生产路径；唯一消费者是 `test/session-kkv/file-cache-store.test.ts` 夹具（5 处引用）。
- 改法：删除文件内导出 `encodeFileCacheValue`（round 2 已核：repository 只 import hash/compress/decode 三符号，**无 index 再导出面、无 allowlist 快照联动**，勿找不存在的联动点）；`EncodedFileCacheValue` 接口若仅它消费一并删；测试夹具 6 处调用（file-cache-store.test.ts:65/387/440/484/532/564）改 `hashFileCachePayload` + `compressFileCacheBodyForBlob` 组合或文件内私有 helper。
- 验收/测试：tsc/build 过、file-cache-store.test 全绿。
- 来源：review-full r1（cr-kkv-1）+ r2 措辞修正

### cr-md-1 [P1] md PRD 核心需求 1「『最近请求』≠『最近一轮』口径标注」双端未落地（PRD→spec 转译丢失）
- 维度：A
- 文件：`apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx:156/:239-241`；`apps/mobile/src/components/sheet/MetricDetailSheet.tsx:120/:199-204`
- 问题：PRD `features/metric-detail-sheet/prd.md:34` 要求弹窗内以字段口径标注「最近请求」≠「最近一轮」（不做数值对齐）；双端「最近请求」段无任何与指标条整轮读数不同源的口径说明。实现与 spec 一致（spec:72 只规定了另一句脚注），属 spec 转译丢失 PRD 要求。
- 改法：双端「最近请求」SectionTitle 或脚注第二行补同文案标注（如「最近请求为单步真值，与指标条整轮读数不同源」），双端文字一致。
- 验收/测试：desktop `test/metrics-detail-popover.test.tsx`、mobile `__tests__/metric-detail-sheet.test.tsx` 各加一条断言含该口径文案。
- 来源：review-full r1（cr-md-1）

### cr-comp-1 [P2] run-compaction.ts:52 函数级 JSDoc 与实现相反
- 维度：C
- 文件：`packages/core/src/service/compaction-conditions/run-compaction.ts:52`
- 问题：JSDoc 仍写「hide-message → 清 rule_snapshot/file_cache → 失效」；模块头 :12 与实现 :77-80 已是「不清两域」。
- 改法：JSDoc 改为「hide-message → 失效 prompt token cache（rule_snapshot/file_cache 不清，见模块头）」。
- 验收：文案与断言一致，纯注释。
- 来源：review-full r1（cr-comp-1）

### cr-comp-2 [P2] T-CC2 用例标题与断言方向相反
- 维度：G
- 文件：`packages/core/test/compaction-conditions/run-compaction.test.ts:123`
- 问题：标题「清 RULE_SNAPSHOT + FILE_CACHE」，:174-178 断言两域**保留**。
- 改法：标题改「保留 RULE_SNAPSHOT + FILE_CACHE」。
- 验收：纯文案，测试仍绿。
- 来源：review-full r1（cr-comp-2）

### cr-tok-2 [P2] buildCounterScope 分隔符注释与实现不符
- 维度：C
- 文件：`packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts:60-61`（注释）vs `:69`（实现 `join("\\u0000")` 字面文本）
- 问题：注释称 NUL 字符分隔，实现是字面 `\u0000` 六字符文本（功能等价）。
- 改法：注释改为「以字面 `\u0000` 文本作分隔符」。**不改实现**（改实现会整体更换 scope 键，全部 L1/L2/KKV 缓存一次性 miss）。
- 验收：纯注释。
- 来源：review-full r1（cr-tok-2）

### cr-tok-3 [P2] rn fallbackCount 注释过时（失败重试语义）
- 维度：C
- 文件：`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:112-115`
- 问题：注释称「失败被缓存、本进程不重试」；encoding-registry 实为 TTL 5 分钟后允许重试。
- 改法：改写为「失败缓存 null，TTL 5 分钟后允许重试（encoding-registry）」。
- 验收：纯注释。
- 来源：review-full r1（cr-tok-3）

### cr-tok-4 [P2] promptWholeCache pendingWrites 无会话归属、头注释语义不符
- 维度：C
- 文件：`packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts:60-65`（全局数组）、`:270-312`（persist 归入当前调用会话行）、`:18`（头注释「该会话最近 16 条」）
- 问题：多会话交错时 A 会话条目落 B 会话行；内容寻址 + scope 隔离使功能自愈（无脏读），但会话删除级联清理会连带丢他会话条目（仅丢加速不丢正确性）。
- 改法（本期最小）：修正头注释如实声明「跨会话共享的 pending 归入最近 persist 的会话；条目内容寻址、会话删除只丢加速不丢正确性」。行为收敛（条目带 sessionId 过滤）收益低，本期不做。执行时顺带在 tokenChunkCache 持久化处（token-chunk-cache.ts:151-161 serializeCurrentGeneration，同形态整表归属）补一句同类声明（tc spec:23 对 L2 有「当前代整表写 KKV」字面背书，故 L2 侧只补注释不另立条目）。
- 验收：纯注释。
- 来源：review-full r1（cr-tok-4）+ r2 L2 联动补充

### cr-tok-5 [P2] 读口「家族判定与驱动同源」注释声明过强
- 维度：C
- 文件：`packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts:159-169`
- 问题：读口用 `params.tokenizerOverride ?? "auto"` 判定家族，不查 `registry.getTokenizerOverride`（双驱动查）；该钩子当前仅测试注入（create-default-registry.ts:18），产品无实际分叉，但注释未声明该前提。
- 改法：注释补前提「registry override 钩子当前仅测试注入；若产品未来注入偏好，读口需同步查询」。
- 验收：纯注释。
- 来源：review-full r1（cr-tok-5）

### cr-runner-1 [P2] anchorStepUsage 与 run 末终值写不判 persistMessages
- 维度：B
- 文件：`packages/core/src/service/agent/impl/agent-runner.ts:351-366`（anchorStepUsage）、`:939-952`（run 末写）
- 问题：EphemeralOverlay（persistMessages=false）的 usage 会写进 KKV 持久层，与 overlay 内存会话语义不符（当前无活调用方、run-agent-turn 恒 true，属防御性缺口）。
- 改法：两处加 persistMessages 守卫（对称于 :889 既有先例）。
- 验收/测试：overlay 形态 run（InMemory 会话 + persistMessages:false 直调 run）断言 KKV 无条目。
- 来源：review-full r1（cr-runner-1）

### cr-ui-1 [P2] format-stream-metrics-line.ts 头注释「输出 {N} t」与实现 tok 不一致
- 维度：F
- 文件：`packages/core/src/domain/format/format-stream-metrics-line.ts:4` vs `:57`
- 改法：注释改 `{N} tok`。验收：纯注释。
- 来源：review-full r1（cr-ui-1）

### cr-ui-2 [P2] subagent-session-screen-metrics.test.tsx 用例标题「输出 N t」未随断言更新
- 维度：C
- 文件：`apps/mobile/__tests__/subagent-session-screen-metrics.test.tsx:202/:216`（断言 :211/:226 已是 tok）
- 改法：标题同步 tok。验收：纯文案。
- 来源：review-full r1（cr-ui-2）

### cr-ui-3 [P2] SessionDetailDrawer `__tokens-pct` 类名承载完整 label
- 维度：C
- 文件：`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:532`（类名）+ `shell.css` + 测试引用（如有）
- 问题：重排后该节点承载「源记号+连接符+占比」完整 label，类名错位。
- 改法：改 `__tokens-label`，同步 shell.css（round 2 实测联动仅 tsx + shell.css:6728 两处，**测试零引用**）。
- 验收：desktop 相关测试全绿。
- 来源：review-full r1（cr-ui-3）+ r2 联动核定

### cr-ui-4 [P2] desktop hitRate/formatHitRate 两份同文实现
- 维度：C-orch
- 文件：`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:91-101`、`apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx:42-51`
- 问题：md spec:28 拍板「弹窗内各自复用」；desktop 侧是复制而非复用（mobile 已单份复用）。
- 改法：抽到 desktop shared（如 `shared/logic/`）单份，两消费方 import。
- 验收：两组件测试全绿；tsc 过。
- 来源：review-full r1（cr-ui-4）

### cr-ui-5 [P2] ipc-types.ts 注释示例大写 K 与 labelCount 小写 k 不符
- 维度：C
- 文件：`apps/desktop/shared/ipc-types.ts:880`（示例「`gpt ≈ 2.3K tokens`」）
- 改法：注释示例改小写 `2.3k`。验收：纯注释。
- 来源：review-full r1（cr-ui-5）

### cr-rel-1 [P2] CHANGELOG Unreleased 缺本迭代条目
- 维度：K
- 文件：`CHANGELOG.md`
- 问题：Unreleased 仅 2 条（统计卡重排、服务商/模型格式），不含四 feature 与统计优先口径 / KKV 批量读 / 免重压缩 / memo 拆除 / hide 头投影。
- 改法：按 novel-master-changelog skill 惯例在 Unreleased 补齐（merge 前与发版轮闭合）。
- 验收：skill 校验过。
- 来源：review-full r1（cr-rel-1）

### cr-test-1 [P2] 测试缺口打包补强
- 维度：G
- 文件/改法/验收：
  1. 读口「anchorSeq 悬空 → delta=0 自愈」（resolve-current-prompt-tokens.ts:77-78 注释声明、无用例）：resolve 测试补「anchorSeq 大于现存最大 seq → tokenCount === 基线」；
  2. `test/session-kkv/file-cache-store.test.ts` 补 getMany 边界：>400 键分片、blob 行缺失 / decode 失败当 miss（不回退旧表）、新旧表混合 missing 回退 legacy；
  3. 免重压缩「压缩未执行」直接断言（现 T-R-skip 仅结果等价；可加 compressFileCacheBodyForBlob spy 或等价手段）。
- 来源：review-full r1（cr-test-1）

## Spec deviations

**用户已确认（fixed）**：
| 条目 | spec 位置 | 现状 |
|---|---|---|
| 标签格式 `{badge} {cur} / {cw} ({pct}%)` 小写 k/m | tl spec T-TL2 示例（tl:83） | format-token-count.ts:72-93 + 测试锁定 | fixed |
| 压缩不清 rule_snapshot/file_cache；置位/导入/规则刷新保留 | run-compaction.ts 头注释自证 | fixed |
| chat-token-label-memo 先建后拆（revert/reapply 对 07bd55e6→d7ebbff3→fa4a02a7） | merge 时整理 | fixed |
| 统计优先口径整链（每 step 回锚 / 基线+增量 / WEB/SP 强制估算 est:true / 0.85 扩到 estimated——与 fa PRD:34、主 PRD:48 字面冲突但系用户拍板） | token-ratio.trigger.ts:78-81 | fixed |
| listBySession includeHidden:false 双端接入 | 拍板 5 | fixed |
| tok / tok/s 单位链（含统计页同步）；msg 首载不做查询优化 | 拍板 6 | fixed |

**用户已确认收窄（fixed，2026-09-29 用户拍板「收窄吧」）**：
1. L1 KKV 持久化键形态：**按现状收窄**——hash16 内容键 + 驱动侧 "" 桶跨会话共享为既定形态；执行动作 = tc spec 补「L1 持久化形态」注记（随本 fix-spec 执行落地）。
2. X1 验收口径：**按 spec 收窄**（SessionDetailDrawer 三处已达成）；renderer 9 处 BASE 存量违规另立任务（K 节），不进本轮。

## Open questions / 待拍板

1. ~~L1 KKV 持久化键形态~~ **已拍板（2026-09-29）：按现状收窄**，spec 补注记。
2. ~~X1 口径~~ **已拍板（2026-09-29）：按 spec 收窄**，9 处 BASE 存量另立任务。
3. Kotlin SP 档无 WEB 同款包装（TokenizerEngine.kt:98-100 直接 encode）——node 侧 sentencepiece 口径是否同构未核（范围外），SP 家族双端数值一致性未认定。不阻塞。
4. runner 每 step 全量 listBySession + JS 滤 hidden（chat-agent-session.ts:30-33）——includeHidden:false SQL 过滤未覆盖此热路径；属既有行为非本迭代回归，建议后续任务化。
5. 强制档双端数值口径差异（node 含 OpenAI 消息 overhead、rn 裸 cl100k 块和）——cr-tok-1 修复后两端 estimated 均 true、标签一致（PRD:57 只要求源标签一致）；数值是否统一待用户定。不阻塞。
6. run 内 KKV 写/删 fire-and-forget 进程早退丢写——store 头注释声明接受（下次 completed run 重写），已知取舍不改。

## 已豁免（用户确认不修）
（暂无）

## 合并后 QA（manual_user）
- md Step 5 desktop 手工弹窗验收待做（含外点关闭 / Esc / 定位；T-MD4 portal 外壳无自动测试）。
- fa Step 7 真机验收已过、md 移动端已验收（记录在案）。
- 统计优先口径真机体感复验：run 中 chip 应显示 远程 =（api 基线+增量）、压后刷新应毫秒级（gpt ≈ 档）。

## K 节建议（下游执行时闭合）
- cr-rel-1 CHANGELOG 条目按 novel-master-changelog skill 补齐（merge 前）。
- 历史整理：07bd55e6→d7ebbff3→fa4a02a7 revert/reapply 对在 merge 时 tidy。
- 本 fix-spec 全部条目执行完毕后按组跑定向测试：node 驱动 / core chat+compaction+tokenizer / mobile 双套件 / desktop 双套件。
- （deviation-2 若选 A）renderer 9 处 BASE 存量 X1 违规另立任务清单。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（附条件：两条 deviation 待用户拍板；选「收窄/推荐项」则零增量即生效） |
| fix_spec_path | docs/Iterations/context-usage-overhaul/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 4 / 14 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | 8 fixed（6 评审期拍板 + 2 收窄拍板，2026-09-29） |
| C-orch | ✅（cr-ui-4；其余 N/A——分层/平台边界属必要 hop） |
| C 类合并后 QA | md desktop 手工验收 / 统计优先真机体感复验（不阻塞） |
