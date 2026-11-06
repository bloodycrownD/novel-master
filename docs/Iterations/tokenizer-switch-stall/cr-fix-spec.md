# CR Fix Spec: 切模型计数卡顿修复（tokenizer-switch-stall）

## 元信息

- repo：`D:\Dev\Js\novel-master-tokfix`（worktree，分支 `fix/tokenizer-switch-stall`）
- base_sha：`1e6559aab`
- head_sha：`662deceef`
- prd_path / spec_path：未提供（本 PR 为缺陷修复，规格即真机实测与对拍金标）
- review_round：3
- dag_version：3
- 模式：diff（独立 PR）
- 状态：fix-spec-ready

## Must-fix（P1 → P2）

### B-1 [P1] 已被顶替的升级计时器回调仍会起飞，同会话出现两轮并发整串计数

- 维度：B 正确性
- 文件：`apps/mobile/src/services/chat-prompt-tokens.service.ts:425-429`
- 问题：`clearTimeout` 只能撤回**尚未到期**的计时器。切模型（`service.ts:573-576`）或换会话时会 `clearTimeout(prevTimer)` 并用新 request 覆盖 `preciseUpgradeDelayTimers`；若旧计时器在 JS 线程被 1s 级 build 堵住的窗口里已经到期、回调已入队，该回调仍会执行。`runPreciseUpgrade` 起步时才取代数（`service.ts:441`），取到的是**新代数**，gen 闸放行，于是被顶替的旧 request 又跑一整轮整串装配加原生计数，与新轮并发——正是本 PR 要消灭的「同会话两轮并发整串计数」。附带二次伤害：回调里的 `preciseUpgradeDelayTimers.delete(sessionId)` 会删掉**新轮刚登记的计时器条目**，之后 `cancelPreciseUpgradeDelay` 误判「无挂起计时」而不再收口新轮的 inflight/补跑槽。
- 改法：
  ```ts
  const timer = setTimeout(() => {
    // 已被新轮顶替（切模型/换会话）的旧计时器即便回调已入队也不得起飞：
    // 否则同会话两轮并发整串计数，且会误删新轮的计时器登记。
    if (preciseUpgradeDelayTimers.get(sessionId) !== timer) {
      return;
    }
    preciseUpgradeDelayTimers.delete(sessionId);
    void runPreciseUpgrade(sessionId, request);
  }, preciseUpgradeStartDelayMs);
  ```
  加固（同批）：`runPreciseUpgrade` 开头加 `if (preciseUpgradeInflight.get(sessionId)?.round !== request.round) return;`，与 finally 的 `stillOwner` 同判据。
  注释同步：`cancelPreciseUpgradeDelay` 现有注释「timer == null 说明这一轮已经起跑」（`service.ts:311`）在加入守卫后不完整，需补「或回调已出队但已过期」。
- 验收/测试：**注意 jest fake timers 复现不了病灶**——切模型时 `clearTimeout(timerA)` 会让旧回调在 advance 时根本不执行，删掉守卫用例照样绿。改为：spy `global.setTimeout` 只截第一发并**存下回调不排程**；切模型起 B 轮后**手动调用旧回调**（模拟「已入队」），再调 `cancelPreciseUpgradeDelay(sessionId)` 并 advance，断言 B 轮永不执行。这条才钉得住「旧回调不得删新轮 timer 条目」的副作用。现有「延迟窗内 `cancelPreciseUpgradeDelay` 后推进满延迟」用例保持绿。
- 来源：review round 1 / B-1；验收改法来自 round 2

### B-2 [P2] `spUnavailable` 用 `catch (Throwable)` 永久记忆一次性失败，且完全静默

- 维度：B 正确性 / I 可观测性
- 文件：`packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerEngine.kt:271-278`（另见 `:262-265` 短路）
- 问题：任何失败都被写进 `spUnavailable`——OOM、`copyAssetToCache` 拷到一半、DJL 初始化异常，一律让该家族在整个进程内永久降级到 cl100k 近似。低内存设备一次 OOM 就足以把 yi/jamba 永久判死；且 `catch (_: Throwable)` 吞掉原因，logcat 只能看到后续 `spUnavailable=true`，定位不到第一次为何失败。
- 改法：
  ```kotlin
  } catch (e: LinkageError) {   // UnsatisfiedLinkError / NoClassDefFoundError 的父类
    spUnavailable.add(family)
    Log.w(LOG_TAG, "SP native unavailable for family=$family", e)
    null
  } catch (e: Throwable) {
    Log.w(LOG_TAG, "SP tokenizer load failed for family=$family", e)  // 不记忆，下次可重试
    null
  }
  ```
- 验收/测试：Engine 依赖 `Context`，JVM 单测覆盖不到（现状如此）。真机 logcat 验收——首次 yi/jamba 计数出现一条 `nm-tok` warning，后续轮次出现 `spUnavailable=true` 计时行；内存不足不再永久降级。
- 来源：review round 1 / B-2

### C-1 [P2] 切模型注释仍称「gemini 走 SentencePiece 8.4s」，与本 PR 的 HF 迁移自相矛盾

- 维度：C 质量
- 文件：`apps/mobile/src/services/chat-prompt-tokens.service.ts:566-572`；同步 `apps/mobile/__tests__/chat-prompt-tokens.test.ts:1235-1236`
- 问题：`f3fce8baa` 已把 gemma（gemini 家族）从 SentencePiece 转成 HF `tokenizer.json`，SP 家族只剩 yi/jamba 且构造即失败。注释却拿「gemini 走 SentencePiece，整串 encode 实测 8.4s」当取消在途轮的理由——按这条注释去 SP 路径找 8.4s 会找不到；实际成本已是「HF 首次加载 13.7MB 词表 + 整串 encode」。
- 改法：改成「切模型前 gemini/gemma 走 SP 整串 encode 实测 8.4s（本 PR 起转 HF，但 13.7MB 词表首次加载与整串 encode 仍是秒级）」，测试注释同步。
- 验收/测试：纯文案，无行为变更。
- 来源：review round 1 / C-1

### C-2 [P2] 「裸编码」有两套表达，新增裸编码家族容易漏

- 维度：C 质量 / C-orch
- 文件：`packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerEngine.kt:93-97` 与 `TokenizerAssetPaths.kt:59-65`
- 问题：dispatch 写的是 `family == "tiktoken" || spec.bare`，但 `forTiktokenEncoding` 返回的 spec 刻意不设 `bare`。同一概念两个入口，将来新增裸编码家族时只要忘改 dispatch 就会静默走成 WEB 包装（稳定多 3~5 token）。
- 改法：`forTiktokenEncoding` 返回 `AssetPathSpec(..., bare = true)`；`count()` 的 dispatch 只留 `spec.bare -> countBareJsonFamily(...)`；`family == "tiktoken"` 只保留在选表逻辑 `resolveTiktokenAssetSpec` 里。
- 验收/测试：`TokenizerEngineTest.resolveTiktokenAssetSpecMapsBothEncodingsAndThrowsOutOfDomain` 补 `assertTrue(cl.bare)` / `assertTrue(o2.bare)`；`gptEncodingsLoadAndCountFixedStringAboveZero` 行为不变。
- 来源：review round 1 / C-2

### C-3 [P2] 转换脚本默认会写出 yi/jamba 的 JSON，且脚本内注释与实现不符

- 维度：C 质量 / K 收尾
- 文件：`packages/tokenizer-driver-rn/scripts/convert-sp-to-hf.py:26, 45-53, 59-61, 75`
- 问题：
  1. `FAMILIES` 含 yi/jamba，按文件头文档的默认命令跑一次就会往 assets 落 `yi.json`/`jamba.json`，与 Kotlin 侧「yi/jamba 暂留 model 档」的决策冲突；这两个文件没人读，却会被打进 APK（各约 3~4MB）。
  2. 第 26 行注释称 dict 值为「(SP 模型文件, transformers 慢分词器类, 额外 kwargs)」，实际只有文件名；`load_slow` docstring 称「失败时回退到 LlamaTokenizer」，实际按家族分支、没有回退。
  3. 第 59-61 行「源模型缺失 → `return True`」，`--check` 把缺模型报成 PASS，summary 里与真正通过不可区分。
  4. 第 75 行注释直接写了 3 个 U+FFFD 字面字符，与紧接着「check-encoding 会判成源码写坏」自相矛盾（当前 `.py` 不在扫描白名单，门禁未红；白名单一加即红）。
- 改法：拆 `WRITE_FAMILIES = {"gemma", "llama", "mistral"}`（yi/jamba 只在 `--check` 对拍跑）；**`--family yi` 不带 `--check` 时 skip 并打印提示、不写盘**；**`--family` 传未知名字要校验报错**（现在直接 KeyError 崩栈）；修两处注释；缺模型返回 `False` 或 summary 单列 `SKIP`；第 75 行改用 `\ufffd` 转义或纯文字描述；**脚本头写明「默认 `--check` 因 yi/jamba 偏差返回 1 属对拍结果、不是门禁」**。
- 验收/测试：不带 `--check` 跑完**不得新增 `yi.json`/`jamba.json`**（三个已有 json 内容一致应为干净；`scripts/__pycache__` 需忽略或清理，否则 git status 会多出该目录）；`--check --family yi` 能跑完六组并给出明确结果（**不预设 FAIL**——±1 偏差未验证必然触发）；`node scripts/check-encoding.mjs` 仍 0 命中。
- 来源：review round 1 / C-3；验收修正来自 round 2

### E-1 [P2] `webCache` 注释里的常驻条目数已过期（10 → 13）

- 维度：E 性能 / C 质量
- 文件：`packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerEngine.kt:52-57`
- 问题：注释仍写「WEB 家族 8 个 + tiktoken 两表常驻共 10 条目」，本 PR 把 gemma/llama/mistral 塞进 `webCache` 后是 **13 个键、容量仍 6**。互踢一次就重付秒级词表加载，gemma.json 13.7MB / 58 万 merges，解析比 WEB 家族更重——与本 PR 要治的切模型卡顿同源。
- 改法：注释改成 13 条目，写明「6 槽只兜最常用的 6 个家族，跨家族频繁切换会互踢重载」；容量是否上调见 open_questions #1。
- 验收/测试：注释与代码一致，无行为变更。
- 来源：review round 1 / E-1

### G-1 [P2] 对拍测试不覆盖生产的裸编码口径，`bare` 契约零断言

- 维度：G 测试
- 文件：`packages/tokenizer-driver-rn/android/src/test/java/com/novelmaster/tokenizer/TokenizerParityTest.kt:102-110`（`countNative`），关联 `:130-152`
- 问题：该测试按 `spec.kind` 分派、不认 `bare`。gemma 现在 `kind=json, bare=true`，测试却走 `countWebNative`（`WebPromptConverter` 的 system 包装，尾部加 `\n\nAssistant:`），而金标 160 是 Node SP **裸编码**口径。实测：裸编码 = 160（与金标一致），加包装 = 163；容差 `max(3, ceil(160*0.01)) = 3`，用例是「3 <= 3」擦边通过，且根本没测生产的裸编码分支。此外 `bare`、llama/mistral 的 json/bare 映射没有任何断言（`TokenizerEngineTest.kt:126-130` 只断言了 gemma 的 primary/kind）。
- 改法：`countNative` 与生产同构——`if (family == "tiktoken" || spec.bare) -> countBareNative(...)`，裸档用 `encode(serialized, false, false)` 且不包装；补 `assertTrue(resolveAssetSpecFor("gemma").bare)` 以及 llama/mistral 的 `primary=*.json, bare=true`；两处 HF 加载参数与生产对齐（`truncation=false`）。
- 验收/测试：Android 单测绿；**bare 家族改用精确断言** `assertEquals(cliTokenCount, native.tokenCount)`，不再走容差——当前容差 `max(3, ceil(160*1%)) = 3` 正好等于包装差 3，「3<=3」测不出任何东西；故意把 gemma 的 `bare` 改成 false 时测试必须红。
- 来源：review round 1 / G-1；容差改法来自 round 2

### G-2 [P2] 新增的「家族原生失败 → 原生 cl100k 近似」分支无测试

- 维度：G 测试
- 文件：`packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:528-544`
- 问题：本轮新增的兜底路由没有任何用例断言它被走到。`apps/mobile/__tests__/mobile-prompt-token-counter.test.ts:442-460` 的 `mockCountPrompt` 全程 reject，两条路径最终都落 JS fallback 且数值相同（都是 cl100k），既绿也证明不了新分支存在。
- 改法：加用例——`available=true`，`mockCountPrompt` 第一次 reject、第二次 resolve `{tokenCount: N, counterKind: "tiktoken"}`，**N 必须与 `cl10kCount(text)` 的值不同**；断言 `result.count === N`、`counterKind === 'heuristic'`、`estimated === true`，且 `mockCountPrompt` 恰好 2 次、第二次参数是 `('...', 'tiktoken', 'cl100k_base')`。
- 验收/测试：成功/失败两条覆盖；已有取消用例（T-TC8②）保持绿。**`countTextWithDefaultEncoding` spy 不能作断言**——兜底走的是 `getDefaultRnEncoding()` + `countChunksWithL2`，那个导出根本不在路径上，spy 恒为 0。用例须**不带 `sessionId`** 直接调 `__test__.countSerialized` 三参，否则会走 `countPromptCancelable`、`mockCountPrompt` 恒 0。
- 来源：review round 1 / G-2；断言改法来自 round 2

### K-1 [P2] CHANGELOG 的 `[Unreleased]` 缺本 PR 的两条用户可见修复

- 维度：K 收尾
- 文件：`CHANGELOG.md:8-12`
- 问题：Unreleased 目前只有一条「智能体配置表单代码迁出 core」的维护项；本 PR 两条用户可感知修复（切模型频繁时卡顿、发送期间 chip 精确标签被 `gpt ≈` 顶掉）没有留痕，与仓库「发版前在 `## [x.y.z]` 下补充内容」的约定不一致，发版时会漏进 GitHub Release 说明。
- 改法：在 `## [Unreleased]` 下加 `### 修复` 两条（mobile）：切模型时主动取消旧模型的精确计数轮，频繁切模型不再堵住后续计数；发送期间 chip 保留上一次精确标签，不再退回 `gpt ≈`，发送完成后刷新为新值。**另加一条 `### 改进`**：gemma / llama / mistral 家族的 chip 读数从 `gpt ≈`（cl100k 近似）改为家族精确值 `=`，与桌面/CLI 口径一致。
- 验收/测试：文案与行为一致；发版脚本只读该段。
- 来源：review round 1 / K-1

### K-2 [P2] 新增代码行不符合 mobile 的 prettier 配置

- 维度：K 收尾
- 文件：`apps/mobile/src/services/chat-prompt-tokens.service.ts:268`（88 列）、`:420`（100 列）、`:447`（87 列）、`:478`（86 列）；另 `apps/mobile/__tests__/chat-prompt-tokens.test.ts:1237`（81 列）
- 问题：`apps/mobile/.prettierrc.js` 未设 `printWidth`（默认 80），用仓库内 prettier 2.8.8 实测这些行会被重排。CI 的 `Format` 步是 blocking（`.github/workflows/ci.yml:60-61` → `npm run format:check`）。**本轮新增的是 `268 / 420 / 447 / 478` 与测试文件 `1237`**；base 侧既有违规在 base 行号 `286 / 578`（即 head 的 `299 / 624`），测试文件 base 本身有 24 行会被重排。
- 改法：`cd apps/mobile && npx prettier --write src/services/chat-prompt-tokens.service.ts __tests__/chat-prompt-tokens.test.ts`
- 验收/测试：口径二选一、须写清走哪条——(a) 整文件 `prettier --check` 通过（service 文件会顺带重排 6 行存量代码，测试文件 24 行，可接受就选这条）；(b) 只保证新增行不再增加，并记录 base 的 Format 步本就红。
- 来源：review round 1 / K-2；行清单与口径来自 round 2，数字修正来自 round 3

## Spec deviations

none（本 PR 为缺陷修复，规格即真机实测与对拍金标）

## Open questions / 待拍板

1. **`webCache` 容量是否从 6 上调**（新增 3 家族后 13 键挤 6 槽）？上调按「每家族数十 MB」线性增内存，需要真机内存与互踢重载耗时两组数据。
2. **资产 +11.2MB**（13,718,017 + 1,401,471 + 1,360,802 减去原三个 `.model` 的 5,234,169）与 gemma 首次 HF 加载耗时，是否已在真机测过？APK 内 assets 会压缩，但 cacheDir 拷贝与解压后占用是实打实的。
3. **run 结束后到升级落地的窗口**（约 800ms 延迟 + 计数）chip 仍可能闪一次 `gpt ≈`。本 PR 只冻结 run 中，这是否可接受？
4. **切模型用 session 级取消**（`cancelSessionNativeCounts`）会连带取消同会话所有在途原生计数。当前移动端只有 chip 一条原生计数路径，无实际影响；将来新增同会话原生计数需改成 requestId 级。
5. **转换脚本没 pin transformers 版本**（仅 README 文字写 4.48.3）。当前环境重跑与入库资产逐字节一致，建议把版本断言写进脚本，否则换环境可能产出同长度不同内容的 json，`copyAssetToCache` 的长度校验拦不住。
6. **metro 别名修复**（`58e46c185`）与本 PR 主题无关，混在同一 PR 会让发版说明与 bisect 变模糊；不构成缺陷，建议后续拆分或 changelog 单列。
7. `service.ts:372-373` 注释说 `savedModelId`「解析失败时为空串」，但 `upgradeWorthy=true` 路径上必非空（无模型分支提前 return），`?? ''` 实际走不到。是否收成非可选类型（低优先级）。

## 已豁免（用户确认不修）

（空）

## 合并后 QA（manual_user）

1. 真机切 gemini，chip 应显示 `gemma =`（无 `≈`）。日志核对：JS 侧 `[nm-tok-js]` 行看 `route=` / `kind=` / `est=`（应为 `kind=gemma est=false`），原生侧 `nm-tok` 行只有 `family=` / `chars=` / `vocabLoadMs=` / `encodeMs=` / `totalMs=`，**别找错行**。
2. 同一段文本真机读数与 Node 侧 `sentencepiece` 裸编码**完全相等**（不是容差内）。
3. 频繁切模型（glm ↔ gemini ↔ glm）无卡顿，`[nm-chip] cancel dispatch` 出现且后续轮不排队。
4. 发送消息期间 chip 保持上一次精确标签（`deepseek =`）不跳 `gpt ≈`，run 结束后更新数值。
5. 首次切到 gemini 时留意 HF 加载 13.7MB 词表的耗时（`nm-tok` 的 `copyMs`/`jniMs`）。

## K 节建议（下游执行时闭合）

- 跑 `npm run format:check`（mobile）确认 K-2 已消；若 base 本就红，记录在案。
- 跑 `node .agents/skills/nm-code-style/scripts/check-style.mjs --changed`，`signatures`/`inline`/`methods` 须全 PASS；`exports`/`oop` 的既有发现按交付报告表格说明。按项目规则 #179，收尾还要一次 `--all` sweep，并在交付报告附固定表格（DEAD / FAKE_PUBLIC / TEST_ONLY / INLINE_CANDIDATE 未解决项）。
- 提交后确认 `check-encoding` 0 命中（含 `.py` 若加入白名单）。
- **[P3] 转换脚本先写盘后对拍**（`convert-sp-to-hf.py:74-99`）：对拍失败时坏资产已经落在 assets 里，`return 1` 只是退出码。改成先对拍、成功再写，或 FAIL 时删掉产物。
- **[P3] `useChatTabScope.ts:273-277` 的 catch 分支绕过冻结闸**：run 在途时若刷新 reject，仍会无条件 `tokenLabel: ''` 把 chip 清空。新闸只覆盖成功写回、没覆盖失败写回；至少补注释说明，或补一条用例。
- **[P3] `scripts/__pycache__` 未进 `.gitignore`**（当前已是未跟踪状态），交付前清理或忽略，否则 C-3 的 git status 验收与提交面都会被它干扰。
