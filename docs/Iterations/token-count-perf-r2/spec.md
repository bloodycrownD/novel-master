---
date: 2026-10-03
---

# token-count-perf-r2 技术规格（SPEC）

## 需求来源

用户口述（2026-10-03 会话，记录于 docs/apm/memory/20261001-chat-webview-unify-spec.md 末轮）。**开发分支拍板：代码在 `feat/tokenizer-native-cancel`（tnc worktree `D:\Dev\nm-worktree\tnc`）上开发，本迭代为单独迭代、独立交付。**

两项实测背书的需求（真机荣耀，[nm-tok-js] / nm-tok 探针数据）：

1. **轻量哈希**：兜底家族精确计数轮 165,680 字符拆 6,798 块、L2 全命中（计数工作量为零）仍耗 4,034ms——大头是 `chunkHash16` 对每块跑一次 noble sha256（Hermes 无 JIT 下 ~0.5ms/块）。
2. **gpt 家族原生词表**：gpt/tiktoken 家族计数在 JS 侧走 js-tiktoken，miss 轮全量计数 Hermes 估 5~10s；原生 WEB 家族暖轮 87.7K 字符 encode 仅 241ms（线性）。给 gpt 上 Android 原生词表，把 miss 轮打进亚秒。

已修不在此范围：DJL 遥测 4.1s（OPT_OUT_TRACKING，已在 tnc 提交 37da31e08 随取消迭代交付）。

## 总体方案

两段独立可交付的改动，共享验证基建：

**Part A（轻量哈希）**：`chunkHash16` 从「hashContent(sha256) 截断 16 hex」换为**双 32 位 FNV-1a 拼接 16 hex 小写**（两次独立 FNV-1a 32 位遍历，全程 `Math.imul`/Uint32 运算，无 BigInt、无 TextEncoder、无堆分配）。改动收敛在 `token-chunk-cache.ts` 单文件：函数签名与返回形态（16 位小写 hex）不变 → L1（整串键）/L2（块键）/双驱动/core 读口五个调用点零改动自动跟随；KKV 持久化 payload 版本 1→2（L2 与 L1 两处），旧 sha256 键条目按版本不符**一次性干净丢弃**（不进三代环形占死槽）。

**Part B（gpt 原生词表）**：assets 新增 cl100k_base / o200k_base 两份 HF tokenizer.json（来源钉死 HF repo+commit，只加 RN 侧、node 侧不加）；Kotlin `TokenizerAssetPaths` 增 tiktoken 条目，编码选择经**现成空槽 `vendorModelId`**（Kotlin 侧 `@Suppress("UNUSED_PARAMETER")`）由 JS 下发已解析的编码名，零桥 arity 改动；`webCache` 键从 family 改为资产键（防 cl100k/o200k 共槽互踢），容量 4→6；计数口径=**Kotlin SP 式直编码整串（不包装）+ JS 侧补 per-message overhead 常数**（公式单源保持在 core JS）；JS 驱动路由改「原生优先 → js-tiktoken 回退 → cl100k heuristic 兜底」三层；gpt2 家族**不**上原生（保持现状 JS 档，出界落 cl100k）。

## 关键决策（探索报告裁决）

| 决策点 | 裁决 | 依据 |
|---|---|---|
| hashContent 本体 | **绝不动** | 它是 VFS content_hash / file_cache blob / 解码缓存的身份键（跨端存储格式）；只换缓存层的 chunkHash16 |
| 新哈希输出形态 | 16 位小写 hex（恒定） | L1/L2/KKV 三处解析器（`token-chunk-cache.ts:236-241`、`prompt-whole-cache.ts:183`）与 `splitEntryKey` 定长切片硬依赖 |
| payload 版本 | L2 与 L1 都 1→2 | 旧 sha256 键条目「能 parse 但永不命中」，bump 版本一次性丢弃更干净（省 6798 条死条目的 parse+建造成本） |
| FNV 串行链性能 | 真机 A/B 验收把关 | FNV 逐字节串行依赖链在 Hermes 上未必远快于 sha256（探索 R3），不达标回滚（单 commit revert） |
| 编码名传递通道 | 复用 `vendorModelId` 空槽 | Kotlin 两处 `@Suppress("UNUSED_PARAMETER")`（`TokenizerModule.kt:58,97`），零桥改动零 arity 风险；JS 的 `resolveRnEncodingName` 已完成解析 |
| family 联合类型 | **不扩**（不加 cl100k/o200k 为 family） | family 外溢到 scope 键/badge/override 选项/压缩系数；编码维度与 family 解耦 |
| 计数口径 | Kotlin 直编码整串 + JS 补 overhead（~7 token 常数） | 与旧口径（overhead+分块和）差 = 分块误差 0.02~0.35%，方向已知；公式单源保持在 core JS，Kotlin 不复刻公式 |
| L1 scope 混用 | **接受**原生与 JS 读数同 scope 共存 | 差 ≤0.5%；分 scope 会一次性 miss 全部 gpt 档缓存不值；写进本 spec 作为显式口径 |
| L1 持久化 | 原生 gpt 读数（est:false）照常落 KKV | 现有「只收精确档」语义天然覆盖 |
| gpt2 家族 | 不上原生 | r50k/gpt2 出界域，JS 侧 `resolveRnEncodingName` 返回 null 时根本不发起原生调用 |
| parity 负例 | `gpt-4o` 换 `gpt2` | `TokenizerEngineTest.kt:79`、`TokenizerParityTest.kt:53` 现拿 gpt-4o 当「无资产家族」反例，gpt 有资产后必红；gpt2 语义贴合（真实家族、原生无资产） |
| node/desktop 侧 | **不加词表**（死重量 +9MB） | desktop gpt 走 WASM tiktoken 不读 assets；README 声明两处资产目录有意分叉 |
| webCache 容量 | 4→6 | WEB 家族 8+tiktoken 2=10 条目抢 4 槽必抖动；+2 槽内存代价数十 MB×2，与既有「LRU 淘汰后懒加载」口径一致 |
| heuristic 家族是否上原生（Part C 补） | 上，标签/口径不变 | 用户实测盲区：自定义 vendor 名落 heuristic 的会话才是「兜底 gpt 慢」主力；cl100k 词表已在包内，换的只是算力不是口径（仍 heuristic/est:true、不加 overhead、0.85 系数照吃） |
| 首刷错峰窗口是否保留（Part D 补） | 撤回，1200→300 | 保护对象（重活堵交互）已被取消链路+原生线程+计数提速逐个拆掉，只剩 JS 装配 200-400ms 需错开动画；精确升级延迟同步 2500→800 |
| gpt 原生路线是否与 JS 表解耦 | 不解耦 | overhead 公式单源在 TS（countOpenAiStyleMessages 空串口径）；表建不起来时即便原生词表在包里也落 heuristic（已知耦合，cr2-B-10 注释+注入用例钉住；解耦=overhead 闭式，留后续） |

## 最终项目结构

```
packages/core/src/infra/tokenizer/logic/
  token-chunk-cache.ts            # chunkHash16 换双 FNV-1a；payload v1→2；注释同步
  prompt-whole-cache.ts            # PERSIST_PAYLOAD_VERSION v1→2
packages/tokenizer-driver-rn/
  src/count-prompt-llm-input.ts    # tiktoken 路由三层化；vendorModelId 槽传编码名；overhead 补加
  src/android-native-bridge.ts     # NativeCountRequest.vendorModelId 语义注释（gpt 档=编码名）
  android/src/main/assets/tokenizers/
    cl100k.json                    # 新增（HF tokenizer.json，实测 2.6MB）
    o200k.json                     # 新增（实测 6.4MB）
    README.md / LICENSE.md         # 来源 manifest（repo id+commit+许可）
  android/src/main/java/com/novelmaster/tokenizer/
    TokenizerAssetPaths.kt         # tiktoken→两资产条目（AssetPathSpec 增资产键维度）
    TokenizerEngine.kt             # webCache 键改资产键、容量 6；gpt 直编码分支（复用 SP 式不包装）
    TokenizerModule.kt             # family==tiktoken 时第三参解释为编码名
  scripts/generate-tokenizer-parity-goldens.mjs  # 修 API 漂移+加 gpt case+raw 字段
  android/src/test/.../TokenizerParityTest.kt    # truncation=false 修复+gpt 分支+负例换 gpt2
  android/src/test/.../TokenizerEngineTest.kt    # spec 断言+负例换 gpt2+gpt encode 冒烟
packages/core/test/infra/tokenizer/
  token-chunk-cache.test.ts        # v:1→v:2 同步+新增 T-H 系列
```

## 变更点清单

1. `token-chunk-cache.ts`：新增私有 `fastHash16`（双 FNV-1a）；`chunkHash16` 改调它；`TOKEN_CHUNKS_PAYLOAD_VERSION=2`；模块头/`:51-52`/`:88-94` 注释；`buildCounterScope` 的「勿改 NUL」注释旁补「本轮已主动换哈希键，旧条目按版本丢弃」说明。**不导出新符号**（allowlist 零变化）。
2. `prompt-whole-cache.ts`：`PERSIST_PAYLOAD_VERSION=2`（仅此一行+注释）。
3. 测试：`token-chunk-cache.test.ts` 坏载荷表 `:336-356` 的 `v:1` 合法样例改 `v:2`、`{v:2}` 非法样例改 `{v:3}`；`:378-385` 往返 `v:1`→`v:2`；`prompt-whole-cache.test.ts` 同步。新增 T-H1~T-H4。
4. `TokenizerAssetPaths.kt`：`AssetPathSpec` 增 `cacheKey`（资产级缓存键，缺省用 primary 路径）；`forFamily("tiktoken")` 返回带两份资产名的路由结果（编码名→spec 的二级映射，静态纯函数 `resolveTiktokenAsset(encodingName)`）。
5. `TokenizerEngine.kt`：`webCache` 键改 `spec.cacheKey`、容量 4→6；`count` 增 gpt 分支：family==tiktoken 时由 Module 传入的编码名解析 spec，加载词表后**直编码整串**（复用 countSpFamily 形态，不包装）；检查点/取消/计时打点与既有分支同构。
6. `TokenizerModule.kt`：`countPrompt`/`countPromptCancelable` 第三参在 `family=="tiktoken"` 时透传编码名给 Engine（去掉该分支的 UNUSED_PARAMETER 抑制，其余分支保持）；参数 JSDoc 注明双语义。
7. `count-prompt-llm-input.ts`（rn 驱动）：`countSerializedImpl` 的 `family==="tiktoken"` 分支改三层路由——`resolveRnEncodingName` 得到编码名且 `isNativeTokenizerAvailable()` → `buildNativeCountRequest` 把编码名塞 `vendorModelId` 槽过桥，成功则 `count = nativeCount + overhead`（overhead 经现有 `countOpenAiStyleMessages` 空串公式，JS 侧）；桥 null/reject（非取消）→ 落回现有 `countTiktoken`；`gpt2` 或编码名 null → 直接 `countTiktoken`（现状）。`[nm-tok-js]` 探针加 `route=native|js` 字段。
8. `android-native-bridge.ts`：`NativeCountRequest.vendorModelId` 注释补「gpt 档承载编码名」；无结构改动。
9. 资产：`cl100k.json`/`o200k.json` 入库（来源=HF hub 转换版，repo id+commit 钉死写进 README manifest；获取脚本一次性不入库，与 glm 紧凑化先例一致）；README/LICENSE 补来源清单与「与 node 侧有意分叉」声明。
10. parity 基建修复：`generate-tokenizer-parity-goldens.mjs` 修 API 漂移（`serializePromptLlmInput(layout, ctx)` / `CountPromptLlmInputParams{layout,ctx,savedModelId}`）、cases 加 `openai/gpt-4o`（o200k）与 `openai/gpt-4`（cl100k）、金标条目增 `rawTextTokenCount`（node 侧裸 encode 整串，不含 overhead——与 Kotlin 直编码同口径）；`TokenizerParityTest.kt` 的 `newInstance` 补 `truncation:false`、gpt case 对 `rawTextTokenCount` 断言容差 ≤0.5%、负例 `gpt-4o`→`gpt2`。
11. mobile 测试：`mobile-prompt-token-counter.test.ts` gpt 家族用例从「不过桥」改「桥可用→过桥（vendorModelId=编码名）+补 overhead / 桥不可用→js 档（现状数值）」；取消链路 describe 增 gpt 原生轮用例；**复跑 mock 宿主 7+1 套件**（spec 7 清单 + `compaction-warm-orchestration.test.ts`，后者 mock encoding 子路径不在旧清单）。
12. 注释顺手修（不改行为）：`chunk-splitter.ts:8-13` 过时的「无生产消费方」声明。

**Part C 追加（heuristic 原生优先，用户实测反馈后补）**：`countSerializedImpl` heuristic 分支前置 `countHeuristicViaNative`——cl100k 词表直编码（borrow tiktoken family + `cl100k_base` 编码名过桥）、不加 overhead（兜底=裸文本近似口径）、标签保持 heuristic/estimated:true、取消异常上抛、失败落回 JS `fallbackCount`；probe route=native-heuristic。

**Part D 追加（延迟窗口回收，用户实测「一直这么慢」定案后补）**：`CHAT_TOKEN_LABEL_FIRST_DEBOUNCE_MS` 1200→300（恒等三元收敛为单常量引用）、`PRECISE_UPGRADE_START_DELAY_MS` 2500→800；两处测试硬编码毫秒（2499/1000）改引常量。弃权判据（视图切走/run 在途/换会话收口）三层兜底不变。

**探针（37da31e08，评审补记）**：nm-tok 拆 copyMs/jniMs；`[nm-tok-js]` 探针壳（L1 miss 轮收尾单条：family/chars/ms/route/kind/est/l2Hit）；cr2-B-01 后探针为**每轮局部 ProbeStats 对象**沿调用链下传（并发双轮互不污染），并发隔离护栏含变异验证。

## 详细实现步骤

- Step 1 — phase-fast-hash — blocking: yes — qa: auto：core 换哈希+版本 bump+T-H1~T-H4（fastHash16 私有实现；token-chunk-cache/prompt-whole-cache 版本；测试同步与新增）。
- Step 2 — phase-hash-gates — blocking: yes — qa: auto：core 定向 `node packages/core/scripts/run-tests.mjs --dir test/infra/tokenizer` + core 全量 + 白名单 + node 驱动 5 套件 + `npm run build -w @novel-master/core`（下游吃 dist）。
- Step 3 — phase-hash-device — blocking: no — qa: manual_user：真机 A/B：兜底会话精确轮 `[nm-tok-js]` 全命中 ms 4034 → 目标 <200ms；不达标整 Part A revert（单提交）。
- Step 4 — phase-gpt-asset — blocking: yes — qa: auto：获取两份 tokenizer.json 入库（来源 manifest 落 README/LICENSE）；JVM 加载冒烟（TokenizerEngineTest 增量用例：两张表 newInstance+短串 encode>0）。
- Step 5 — phase-gpt-parity-gate — blocking: yes — qa: auto：**对拍门**——JVM 新测试：DJL cl100k/o200k vs js-tiktoken 真值（中文/英文/混合/无空白病态/代码块语料，单串 0.5% 或逐 token 等值），**超标即停 Part B 全部后续步骤、升级用户裁决**（Part A 不受影响）。
- Step 6 — phase-gpt-kotlin — blocking: yes — qa: auto：TokenizerAssetPaths/Engine/Module 改动（路由/缓存键/容量 6/直编码分支/负例换 gpt2）+ JVM 测试。
- Step 7 — phase-gpt-driver — blocking: yes — qa: auto：rn 驱动三层路由+overhead 补加+探针 route 字段+`npm run build -w @novel-master/tokenizer-driver-rn`（先 core 后驱动的顺序依赖）。
- Step 8 — phase-gpt-parity-tests — blocking: yes — qa: auto：parity 生成器修复+金标重生成（先 build core+node 驱动 dist）+ParityTest gpt case+truncation 修复。
- Step 9 — phase-gpt-verify — blocking: yes — qa: auto：mobile 定向（mobile-prompt-token-counter/chat-prompt-tokens/use-chat-tab-scope-token-debounce）+ mock 宿主 7+1 + `npx jest --maxWorkers=2` 全量（存量红基线对照归因）+ mobile tsc + core typecheck + `gradlew :novel-master_tokenizer-driver-rn:testDebugUnitTest --tests "com.novelmaster.tokenizer.*"`。
- Step 10 — phase-gpt-device — blocking: no — qa: manual_user：真机出包（gradle 真实路径配方）装机：gpt 会话精确轮亚秒级、标签 `gpt =`、侧滑取消生效、L1 重进秒出；logcat 收 nm-tok（family=tiktoken 冷载/暖轮读数）与 [nm-tok-js] route=native。
- Step 11 — phase-docs — blocking: no — qa: auto：CHANGELOG（Unreleased 两条：计数缓存哈希提速/GPT 家族原生计数）、README 首句更新（「GPT 走 js-tiktoken」表述）、spec 执行终态回填。

## 测试策略

### 测试用例

- T-H1 — blocking: yes — fastHash16 golden：固定输入集（空串/ASCII/中文/emoji/前缀碰撞对）钉死输出 16 位小写 hex 定值，锁 FNV 常量/遍历序/拼接序（防后人改常量无察觉）。
- T-H2 — blocking: yes — 分布与碰撞：真实语料句子块（≥6000 块规模夹具）零碰撞；合成 10 万随机短串碰撞率符合 64bit 生日界量级。
- T-H3 — blocking: yes — 旧格式 KKV 回归：手工构造 v:1+sha256 前缀键的行 seed → 静默 miss、不崩、新格式写回正常。
- T-H4 — blocking: yes — 哈希计数式不变量：N 块恰 N 次哈希调用（防误加 memoization 致块级缓存语义漂移）；耗时护栏只留 5~10× 余量粗线（jest 测不出 Hermes 真值，RULE:103 口径）。
- T-G1 — blocking: yes — Kotlin `resolveTiktokenAsset("cl100k_base"/"o200k_base")` 映射正确；`forFamily("gpt2")` 仍无资产抛异常（负例从 gpt-4o 换 gpt2）。
- T-G2 — blocking: yes — 对拍门（Step 5 本体）：DJL vs js-tiktoken 语料对拍 ≤0.5%（或逐 token 等值，以实测定容差形态并回填 spec）。
- T-G3 — blocking: yes — 三层路由：mock 桥可用→过桥且 `vendorModelId` 收到编码名、count=native+overhead；桥 null→js 档数值（现状断言不动）；桥抛非取消错→同 null 路径。
- T-G4 — blocking: yes — 出界防护：gpt2 家族与 `resolveRnEncodingName` 返回 null 的模型**不发起**过桥（mock 计数 0 次），落 js/heuristic 现状。
- T-G5 — blocking: yes — 标签语义：原生成功 `counterKind=tiktoken`+`estimated=false`（badge `gpt =`）；三层各态的 est/kind 断言。
- T-G6 — blocking: yes — 取消接力：gpt 原生在途轮 cancel → `cancelCount` 收到该轮 requestId、`PromptCountCancelledError` 上抛不落兜底（照抄 T-TC3 模式）。
- T-G7 — blocking: yes — overhead 口径：同输入「原生+overhead」与「纯 js 档」差 ≤0.5%（驱动层对拍）。
- T-G8 — blocking: yes — parity 金标：gpt-4o/gpt-4 case 生成并对 `rawTextTokenCount` ≤0.5%；truncation=false 后既有 claude/gemma case 复核不红。
- T-G9 — blocking: yes — mock 宿主复跑：7+1 套件全绿（含 compaction-warm-orchestration）。

## 兼容性或迁移说明

| 组合 | 行为 |
|---|---|
| 新 JS × 旧 APK（无 gpt 资产） | Kotlin `resolveTiktokenAsset` 抛 → 桥 reject → JS catch→null → 回退 js-tiktoken = 现状（注意：该回退仅 family==tiktoken 分支内部，WEB/SP 家族的「不可用报 heuristic」既有约束不受影响） |
| 旧 JS × 新 APK | tiktoken 走 JS 档，Kotlin 新分支不触发 |
| 升级安装（旧 KKV 行） | payload v1 整体按版本不符丢弃（一次性全量 miss 后收敛），不崩、不占三代槽 |
| L1 scope | 原生与 JS 读数同 scope 共存（差 ≤0.5%，本 spec 显式接受） |
| desktop | Part A 中性（V8 上 sha256 本就噪声级）；Part B/C 零改动 |
| 升级安装（heuristic 档，Part C） | 首触重算一次（换哈希致 L1/L2/KKV 一次性失效，设计内）后由原生承担；读数来源从 JS 分块和变为原生整串，差 ≤0.35%，标签不变 |
| 延迟窗口 800ms（Part D） | 「切会话立刻退出」仍由三层兜住：shouldBail（run 在途/视图切走）+ 换会话 cancelPreciseUpgradeDelay(stale) 收口挂起计时 + 在途轮 cancelPreciseUpgrade 原生取消 |

## 风险与回滚方案

1. **FNV 真机不达标**（Hermes 串行链未必快，探索 R3）→ Step 3 真机 A/B 是闸门，不达标 revert Part A 单提交；备选哈希（xxhash 风格混合）留作二回合。
2. **HF 转换词表与 js-tiktoken 误差超标**（最高风险）→ Step 5 对拍门前置拦截，超标即停 Part B 并升级用户（Part A 独立交付不受影响）。
3. **webCache 4→6 内存压力**（+两表常驻数十 MB）→ 回滚为 4（gpt 两表懒加载+LRU 淘汰，重载一次 ~1s 可接受）。
4. **copyAssetToCache 长度判据**同尺寸换版失效（既有已知）→ 资产 manifest 记录字节长度，换版时核对；不改判据（超范围）。
5. **存量红基线**（batch-delete/forget-session/chat-tab-screen.integration 等 mega-CR 遗留）→ 验证轮先还原 HEAD 对照归因，不算本轮头上。
6. 回滚单元：Part A、Part B 各自独立成提交序列，可单独 revert；探针（37da31e08）与两者正交。

## 执行终态注记（2026-10-03 回填，CR 修复轮后更新）

- **流程裁剪（用户拍板）**：免 code-dev-loop，主代理直改 + 每步门禁照跑。
- **Part A 已提交**：4 文件 +160/-29。门禁：core tokenizer 226/226（含 T-H1~4）、core 全量 879/886 中 7 红 stash 对照实证为分支既有红（read-ref-production-smoke 6 + delete-session-readref-targets 1，mega-CR 遗留）、node 驱动 30/30、core typecheck 干净、dist 重建。
- **Part B 已提交**：14 文件。对拍门一次通过（ParityTest 3/3，DJL cl100k/o200k 直编码 vs js-tiktoken 裸 encode 同值域）；Kotlin JVM 21/21；mobile-prompt-token-counter 26/26（新增 T-G3/T-G7、T-G6）；mock 宿主复跑 6/7 绿；mobile 全量 10 红经 stash 对照全部实证为 main HEAD 既有红（batch-delete 5 / forget-session / chat-tab-screen.integration / webview-asset-guard 包清单顺序 / session-detail-screen / message-actions×3——后五者为本轮新增发现的 main 既有红，建议独立小迭代清偿）；mobile tsc 干净。
- **Part C 已提交（heuristic 原生优先，2 文件 +64）**：mobile-prompt-token-counter 28 用例 + chat-prompt-tokens/token-debounce/compaction-warm 84/84 绿。
- **Part D 已提交（延迟窗口回收，3 文件 +20/-15）**：chat-prompt-tokens/token-debounce/parallel-queries 50/50 绿。**真机验收（用户）**：Part D 后「快了不少」——数字出现时间从 4s 级降到 1s 级（此前被 1200ms 首刷窗+2500ms 精确延迟人为拖后）。
- **CR 修复轮（diff 模式单轮审查 → fix-spec 11 条 → 全部修复）**：cr2-B-01 探针局部对象化（含并发隔离护栏+变异验证：摘 native-gpt 赋值必红）；cr2-B-11 spec 补 C/D/探针/体积/兼容矩阵（本轮）；B-02~B-07/B-09/B-10 注释与护栏（JSDoc 归位/桥契约双语义/chunk-splitter 声明/恒等三元收敛/spCache 回 4/词表钉 commit `1d9f1f1b`/`7956d98f`/T-H4 口径注释/耦合注释）；B-08 四条护栏（gpt 非取消回退/表建不起来放奔原生/出界零过桥/heuristic 取消上抛）。修复后 mobile-prompt-token-counter+chat-prompt-tokens+token-debounce 75/75 绿。
- **执行勘误**：parity 生成器 API 漂移修复时 fixture 从 blocks 改为 layout+ctx 形态（`{system, persist:[], dynamic:[], skillsEnabled:false}`），claude/gemma 金标值随新 fixture 重生成（209/160）；金标 JSON version 1→2。词表实际体积 cl100k 2.5MB / o200k 5.2MB（紧凑化后）。T-H2 以 10 万合成 CJK 短串替代真实语料抽样（更强）；T-H4 落地为确定性+幂等（计数式护栏 ESM 无法 spy，memoization 风险由评审约束，见 cr-fix-spec cr2-B-09）。
- **已知低效（刻意保留）**：gpt 原生回退轮 overhead 预计算重复一次（过桥前预算 + 桥 null 后 countTiktoken 内再算，各 1 次单 token 串 encode）。
- **CHANGELOG 延后**：与 tokenizer-native-cancel 迭代合并时统一补（分支惯例）。
- **open（merge 前拍板）**：[nm-tok-js] 探针门控三选一（保留/`__DEV__` 门/开关化），先真机 release 验 console 是否真出再定。
