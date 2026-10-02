# CR Fix Spec: chat-webview-unify 第二轮 CR（cr2）——上次 CR 终点后的增量

## 元信息

- repo：`D:\Dev\nm-worktree\cwu`（worktree，分支 feat/chat-webview-unify——**全部代码改动**）；文档回写落主仓 `D:\Dev\Js\novel-master`（spec/playbook/CHANGELOG 只读侧的回写例外：backfill 节点按本 spec §backfill 执行）
- base_sha：`08fb5af9`（上轮 cr-fix-spec 的最后一笔，fix-cr 执行轮终点）
- head_sha：工作区未提交态（5 笔已提交：c1158315/af763a77/4c995f6b/6248500a/3b1c0ee6 + 未提交的卡顿攻坚/converge/两顺手修；真实 HEAD 以 `git log -1` 为准）
- prd_path/spec_path：`docs/Iterations/chat-webview-unify/spec-session-list-webview.md`、`spec-transcript-converge.md`、`exit-jank-fix-playbook.md`（事实来源）、`spec.md`（主 spec 背景）
- review_round：3（cr 侧 r1 六域 → r2-full no → r3 yes）；sc2 执行视角：sc2-r1 No-Go（P0=2/P1=8/P2=10）→ doc-fix 18 处 → sc2-r2 **Go**（18 处全闭合、P0 清零、26 条目×14 节点×分组三方双射）→ 遗留 6 条（P1×1/P2×5）已顺手闭合；cr_dag_version：4
- 状态：**fix-spec-ready + execute-ready（sc2-r2 Go；待用户确认投递 fix-cr2-a..n）**

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（cr 侧 r3 过 + sc2-r2 Go：18 处修订全闭合、P0 清零、三方双射完整；遗留 6 条一行级已顺手闭合） |
| fix_spec_path | docs/Iterations/chat-webview-unify/cr2-fix-spec.md |
| dag_version / review_round | 4 / cr3 + sc2-1 |
| P0 / P1 / P2（已写入） | 条目 2 / 8 / 16（共 26 条目；来源计数 2 / 8 / 18，3 处合并：converge/A-2→C-1、jank/C-orch-1→C-4、jank/D-2 拆半并入 C-2/C-4） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none open（9 处处置全部归宿：8 条回写 cr2-K-4 / 1 条由 cr2-K-3 修复后成立） |
| C-orch | ✅（回环边界/双发快照/消息管道协调均已查） |
| C 类合并后 QA | 真机复验清单 5 项（见上节，不阻塞） |
| 执行 DAG | 14 节点三波（wave-1 12 并行 a-k+n / wave-2 l / wave-3 m）；G-1 已由 n 节点认领 |
- 评审来源：`cache/cr2-r1-jank.md`、`cache/cr2-r1-misc.md`、`cache/cr2-r1-converge.md`（子代理 readonly 评审）+ `cache/cr2-r1-manual.md`（主代理手工等效审查——web-list/rn-list/perf-sec 三域因子代理网络故障转手工，已标注）

---

## Must-fix（P0 → P1 → P2）

### cr2-K-1 [P0] iOS pbxproj 守卫脚本被删成 shell 语法错误，macOS 出包必崩
- 维度：K + 构建纪律
- 文件：`apps/mobile/ios/NovelMaster.xcodeproj/project.pbxproj:200`
- 问题：删 chat-transcript 首条 `-f` 检查时把 `if` 关键字一起吃掉，`... ; then` 成 orphan token，`bash -n` 实证 `syntax error near unexpected token 'then'`——Xcode Run Script 阶段解析即崩。
- 改法：在剩余四个 `[ ! -f ... ]` 之前补回 `if `（该行与 BASE 同形、仅少 chat-transcript 一个 `||` 分支）。字节级替换，diff 保持 1 行。镜像守卫断言（防回归护栏）归 fix-cr2-b 节点执行（同文件串行，避免 DAG 冲突）。
- 验收/测试：① shellScript 反转义落 .sh 后 `bash -n` 退出 0（临时文件不提交）；② `git diff 08fb5af9 -- <pbxproj>` 仍 1 行；③ 镜像断言见 cr2-K-2 节点④'（webview-asset-guard.test.ts：从 pbxproj 抠出 shellScript，断言完整 if 形态 + `-f` 分支数恰为 4 + 不含 orphan-then 形态——本次漏出的根因是无自动化护栏）。
- 来源：cr2-r1-converge/K-1

### cr2-K-2 [P0] 退役包构建产物无清理步：三处残留会打进 APK/IPA + 假绿面回流
- 维度：K（退役完整性/假绿）
- 文件：`apps/mobile/scripts/build-webview.mjs:228,147-165`
- 问题：`main()` 只 mkdir 不清 distRoot 下已退役目录；`copyDistToNativeSinks` 只刷新当前四包目标。旧工作区上 `webview-dist/chat-transcript/`、`android/.../assets/webview/chat-transcript/`、`ios/NovelMaster/WebViewDist/chat-transcript/` 三处残留原样进包（iOS `cp -R` 整目录递归）。读侧假绿面已收口但产物面无「不得存在」断言——未来误把旧包加回 PACKAGES 会被旧产物喂饱（正是此前 3 套真断裂测试假绿的成因）。
- 改法：① `build-webview.mjs` 加 `pruneDist(rootDir, keepIds)` helper（只删「目录 && 不在 keepIds」的名字，`.gitkeep` 是文件不动；顶部补 `readdirSync` import）；② `main()` mkdir 后立刻 prune(distRoot)；③ `copyDistToNativeSinks()` 开头对两个原生落点根各 prune 一次（keep 同一份 PACKAGES id）；④ `webview-asset-guard.test.ts` 加「distRoot 与两端原生落点不得存在 PACKAGES 之外的包目录」断言——**差集口径**：三根目录各 `readdirSync(dir, {withFileTypes:true})` 滤 `isDirectory()` 滤 `.gitkeep` 得 names，断言 `expect(names.filter(n => !EXPECTED_PACKAGES.includes(n))).toEqual([])`（`EXPECTED_PACKAGES` 在本文件 :23 已定义直接复用，勿另抄四包清单；正常形态下滤完是四包 id 而非空集——**勿写成 `expect(names).toEqual([])`，照抄即假红**）；可加 `expect(new Set(names)).toEqual(new Set(EXPECTED_PACKAGES))` 锁正向；④' 同文件追加 cr2-K-1 的跨端镜像断言（读法：`readFileSync(PBXPROJ,'utf8')`——pbxproj 是合法 UTF-8 无损坏字节，不需按字节解码——正则取 `shellScript = "…"` 全文 2 处、按 `name = "Copy WebViewDist into App Bundle"` 就近取那条，`JSON.parse('"'+m[1]+'"')` 反转义后断言：完整 `if [ ! -f` 形态 + `-f` 分支数恰 4 + 不含 orphan `]; then` 形态）；⑤ 同文件追加 cr2-C-1 的联合类型双向断言——本文件全部新增断言在 b 节点内按 ④→④'→⑤ 串行；⑥ 顺手把本文件头注释改为「四包资产管线三处手写锚点：Android 守卫清单 / iOS pbxproj -f 清单 / PACKAGES 联合类型」（原「只锁 build.gradle 一处」的口径加了新断言后失真）。
- 验收/测试：手工造残留（webview-dist/ 下 mkdir chat-transcript 塞假文件）→ `npm run build:webview` 后消失 → `build:webview:native` 后两原生落点也消失；新增断言在残留存在时红、清理后绿。注意与 cr2-C-1 同文件（webview-asset-guard.test.ts）——同节点串行。
- 来源：cr2-r1-converge/K-2

### cr2-E-1 [P1] 单元路径无条件窗口化：用户翻出的消息面被截回 40 条
- 维度：E（修法本体回归）
- 文件：`apps/mobile/src/services/session-stream-unit.ts:1043-1049`（performTailReload 缓存命中分支）；关联 `session-stream-unit-manager.service.ts:1104,1625-1636`（removeUnit 全量面→新单元非 force 采纳截断）
- 问题：缓存命中分支无条件 `hydrateWindowFromCache`，不区分冷启动水合与已有消息面。`ChatTabProvider.tsx:261-268` 的 effect 依赖含 chatSubview/hasUnit——每次进出对话跑一次非 force 水合，翻到 200 条的转录塌回 40 并触发全量快照重渲；「已结算单元被新 run 替换」路径在发消息当场塌（removeUnit 搬全量进 idle → 新单元采纳又截到 40）。
- 改法：窗口化限定冷启动——`this.messagesValue.length === 0 ? hydrateWindowFromCache(cached) : cached`（附注释「已有消息面是用户翻出来的，截回去等于当面塌掉」）；`loadIdleTailMessages` 加同款 `idleMessageViews.get(sessionId)?.messages.length === 0` 守卫（幂等但挡未来调用方）。
- 验收/测试（用例落 `__tests__/chat-session-view-cache.test.ts` 采纳点条目 + `__tests__/session-stream-unit-messages.test.ts` 行为条目，均 d 节点独占）：补两条——① loadOlder 撑到 >40 后非 force 缓存水合，断言 messagesValue.length 不减且 hasMore 仍真；② 冷启动（面空+缓存 3×40）采纳 40 条 + hasMore true。现有 `chat-session-view-cache.test.ts` 只锁纯函数，本条锁采纳点条件。
- 来源：cr2-r1-jank/E-1

### cr2-E-2 [P1] 精确升级：延迟计时器无清理出口 + 弃权判据不认会话身份（切会话照跑 2.2s）
- 维度：E（竞态/未达声明语义）
- 文件：`apps/mobile/src/services/chat-prompt-tokens.service.ts:252-253,292-312`；`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:216`
- 问题：(a) `preciseUpgradeDelayTimers` 注释承诺「新请求到来/模块卸载时可清理」但无任何清理函数（startPreciseUpgrade 的 prev-clearTimeout 是死代码）；(b) `shouldBailPrecise` 只判视图不判会话——切会话 A→B 时 chatSubview 仍是 conversation，A 的挂起升级越窗照跑（build 0.7~1.2s + 整串计数 2.2s 堵 JS），恰好落在本轮要消灭的「切会话后卡」窗口；快速进出同会话也命中。
- 改法：① 判据升级双条件：`chatSubviewRef.current !== 'conversation' || tokenLabelSessionRef.current !== sessionId`（tokenLabelSessionRef 在 useLayoutEffect 同步改写，切会话后必不等）；② service 导出 `cancelPreciseUpgradeDelay(sessionId)`，语义限定为「**仅当延迟计时器仍挂起时才收口**」：`timer = preciseUpgradeDelayTimers.get(sessionId)`，timer != null → clearTimeout + delayTimers.delete + **inflight.delete + queued.delete**（换会话时旧补跑槽一并丢弃）；timer == null 则不动（已有轮在途，inflight 由其 finally 负责）。⚠ 收口语义是硬约束：只清 timer 不清 inflight/queued 会把该会话精确升级**永久楔死在估算档**（finally 永不执行、后续请求全部只入补跑槽、无人排空——比原 bug 更隐蔽的回归）；hook 侧两处调用（refreshChatTokenLabel 换 key 分支 + 卸载 cleanup effect）；**cancel 的目标会话 id 必须取发起那一轮的身份**——写入时机钉死：`slot.sessionId` 在 `scheduleTrailing()` 内 `slot.timer = setTimeout(...)` 的同一处写入（`slot.sessionId = sessionId ?? null`，与该轮 timer 同生命周期）；**换 key 分支（:249-260）必须在 `slot.key = key` 之前**读出 `const stale = slot.sessionId` 并调 `cancelPreciseUpgradeDelay(stale)`（写在 key 赋值之后读到的就是新 id，cancel 又打偏）；卸载 cleanup（:315-324）保持 `[]` 依赖、只读 ref（ref 永远是最新一轮，天然正确）。slot 其余 4 个消费点（:171-178/:211-212/:227-231/:261-297）不读 sessionId，增字段不波及。若在 `slot.key = key` 之前读不到旧值则 cancel 落空（不会楔死——改法①的 bail + finally 兜底）；③ startPreciseUpgrade 入口改为「get 旧 timer→若有则清 inflight 再置位」替代死代码 prev 段。
- 验收/测试：service 层补三条——a)「首帧→延迟窗口内 bail 变真→越窗后 resolve 仅首帧一次」（覆盖会话身份维度）；b) **cancel 收口回归**：「起延迟(2500)→cancelPreciseUpgradeDelay(s1)→再次 loadChatPromptTokenLabelResilient(s1) 且 upgradeWorthy→断言第二轮升级确实发生」（朴素只清 timer 的实现必红）；c) hook 层「s1 首帧挂起→切 s2→越窗后 s1 升级回调不发生」——**用例落 `__tests__/use-chat-tab-scope-token-debounce.test.ts`**（该文件已有 slot 基建、本轮已改、无他节点触碰）。真机复验进大会话 1s 内切走后 logcat 无 `[nm-chip] resolve done`。
- 来源：cr2-r1-jank/E-2

### cr2-A-1 [P1] 回环断路器只比 value 不比 path：同实例换 path 时下行被吞、胶囊扩展失效
- 维度：C-orch（回环边界）
- 文件：`apps/mobile/src/components/vfs/CodeEditorWebView.tsx:184-200`
- 问题：早退判据 `value === lastUpstreamTextRef.current`，effect 依赖含 path。PromptEditorScreen 的 prompt.md↔composer.md 同实例切换（草稿未变）→ 早退 → web 侧 currentPath 停旧值 → composerTokenEnabled 恒 false → 胶囊不挂、selectionChange 不上行；FileEditorScreen 换同内容文件同理。
- 改法：基线升级为 `{text, path}` 结构体（两者全等才早退；早退分支同步推进 path 基线）。选型说明：结构体基线语义自洽（一次上行的完整身份），优于额外 lastPathRef。
- 验收/测试：组件级用例「path 变而 value 不变 → setDocument 计数 +1」（现有 code-editor-webview.test.tsx 只锁 value 维度）；真机 PromptEditor 双模式切换后 @ 候选正常。
- 来源：cr2-r1-misc/A-1（选型采用其 open question 2 的结构体方案）

### cr2-A-2 [P1] 保存路径无 flush：注释承诺的收口点 `handle.flushPendingChange` 全仓不存在
- 维度：A + E（时序）
- 文件：`apps/mobile/src/web/code-editor/webview/runtime/editor.ts:16-23`（注释）、`apps/mobile/src/screens/stack/FileEditorScreen.tsx:167-205`（handleSave）
- 问题：注释把「同步 flush 才是收口」写成因果，但收口点不存在；handleSave 直接 vfs.write(path, content)，content 是 RN state，toolbar 按压与 contenteditable blur 的先后无保证——保存可能读到滞后一帧的镜像（真丢字窗口）。
- 改法：handleSave 开头补 `codeEditorRef.current?.blur()`（blur handler 已同步 flush）；editor.ts 注释里不存在的 `handle.flushPendingChange` 字样改为实际机制描述。
- 验收/测试（用例落 `__tests__/file-editor-screen.test.tsx`，g 节点独占）：同帧输入末字后立即点保存，磁盘内容含该字（sessionSaveVfsFile 分支同覆盖）。
- 来源：cr2-r1-misc/A-2

### cr2-D-1 [P1] getMessageIds 收窄后 T-E2 fixture 断言必挂（潜伏回归）
- 维度：G（e2e）
- 文件：`apps/mobile/e2e/pageobjects/chat-transcript.page.ts:46-56`、`apps/mobile/e2e/specs/chat.rollback.e2e.ts:123-141`
- 问题：选择器收窄到 `.row.message.user` 后，T-E2「assistant rewind」仍按未过滤 id 断言（toContain(assistantId)/length===2/idsAfter[1]）——fixture 门控当前 skip 藏着，CI 一开就红且难定位。
- 改法：page object 拆双入口——保留 `getMessageIds()`（user 过滤）+ 新增 `getAllMessageIds()`（不过滤）；T-E2 的 **2 处调用点**（:123 `idsBefore` / :136 `idsAfter`）改调 `getAllMessageIds()`，其上 7 条断言（:124-:127/:137-:141）随之成立（勿逐条挑断言改）。
- 验收/测试：三步可粘贴——① `npm run e2e:fixture`（= inject-tool-turn-fixture.mjs）→ ② `E2E_RUN_FIXTURE_SPECS=1 npx wdio run ./e2e/wdio.conf.ts --spec ./e2e/specs/chat.rollback.e2e.ts` → ③ 报告里 T-E2 的 **1 条 it（含 before）** 必须是 `passed`；**出现任何 `pending`/`skipped` 即判失败**（fixture 段被 env 门控 skip 时 wdio 照样报绿——本条的价值全在 fixture 段真跑，T-E2 受影响断言共 9 条随 2 处调用点改调后自然成立；T-E1 的 :37/:61/:73/:86 四处继续走 user 过滤入口不动）。
- 来源：cr2-r1-misc/D-1

### cr2-A-3 [P1] transcriptOnly 变体在 RN 宿主侧零测试（五处行为面全裸奔）
- 维度：A + G（假绿）
- 文件：`apps/mobile/__tests__/chat-conversation-webview.test.tsx`（补 describe）、`apps/mobile/__tests__/subagent-session-screen-metrics.test.tsx`
- 问题：变体全部五处行为面（init payload / memo 比较器 / menuItems 退回 / 降级横幅豁免 / composerText 可省）零断言；memo 漏字段是该文件**已发生过**的静默 bug（:350-352 注释自认），新加的 transcriptOnly 恰在比较器末尾。
- 改法：复用既有 baseProps/simulateReadyV2/sentTypes 基建补五条——① init 带 transcriptOnly===true / 缺省不发键；② 只改 transcriptOnly 的 memo 回归点（与 :996 sessionList 同款写法）；③ menuItems 长度 1 vs 3 且变体等于 CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS；④ 降级横幅豁免（queryByProps null vs 非 null）；⑤ subagent-session-screen-metrics 的宿主 mock 换成记录 props 的哑组件断言真传了 transcriptOnly。另补 web 侧最小面（converge OQ3 并入）：断言落 `__tests__/chat-conversation-boot-script.test.ts`（本文件本轮已改且无其他节点触碰）——app.css 产物含 transcript-only 隐藏规则（**空白不敏感正则**：`/#app\.transcript-only\s+#composer-dock\s*\{\s*display:\s*none;?\s*\}/`，产物实际是多行带空格形态，照抄单行字符串会假红）+ boot 产物（app.js）含 `"transcript-only"` 字符串；并在 `ChatConversationWebView.tsx:131-149`「统一宿主句柄 = 转录七方法 + **一个** composer 命令式写入」注释块（文件头附近；converge 报告写的 :1437-1445 是 resetStreamTail、非该注释——按文字锚）补一句「变体面断言在同文件 transcriptOnly describe」（converge A-1 验收第 4 条承接）。
- 验收/测试：五条全绿 + 两条 dist 断言绿（**前置：先 `npm run build:webview`**——webview-dist 是 gitignore 产物，干净工作区上未构建即跑会得到与被测行为无关的红）；dispatcher 层既有两条保持绿（两层分工不冲突）。
- 来源：cr2-r1-converge/A-1 + OQ3

### cr2-C-1 [P1] `WebViewAssetPackageId` 仍列退役包 id（六处注册点只改了五处）
- 维度：C + K
- 文件：`apps/mobile/src/webview-host/webview-asset-uri.ts:9`；同节点顺带 `apps/mobile/test-utils/react-native-webview-mock.tsx:12`（converge/A-2：mock 头部注释仍列 chat-transcript 为包——共用 mock 的第一眼清单，误导写新测试的人）
- 问题：联合类型保留 `'chat-transcript'`——类型检查放行一个指向永不存在目录的 URI（运行时白屏）；与 cr2-K-2 叠加构成旧包僵尸存活链。
- 改法：删该行改四包联合；文件头补「本联合类型即 PACKAGES 的类型镜像，增删包必须与 build-webview.mjs 同步」；联合类型双向断言即 cr2-K-2 条目⑤、随 fix-cr2-b 节点落（见 DAG）；mock 注释同步删旧包名。
- 验收/测试：新增断言绿（断言面直接 `readFileSync(webview-asset-uri.ts)` 断 `not.toContain("'chat-transcript'")`——同在 b 节点同文件；若用命令行核验写 `git grep -nF "'chat-transcript'" -- apps/mobile/src/webview-host/webview-asset-uri.ts`（**-F 定死字面量并收窄到被改文件**——宽 grep 在 bash 下单引号被剥离会误命中 uri.ts 注释与 mock 注释）；`git grep -n "chat-transcript" -- apps/mobile/test-utils/` 为空（mock 注释清干净）；tsc 无新增错误。
- 来源：cr2-r1-converge/C-1 + A-2

### cr2-K-3 [P1] README 两处陈述随收敛过期（「五包」「ChatTranscriptWebView 仍存活」）
- 维度：K
- 文件：`apps/mobile/README.md:170,239`
- 问题：`:170` 仍列五包并把 chat-transcript 称为包真源目录；`:239` 说旧组件「only for the subagent-session screen」——新人第一份架构地图级错误。
- 改法：`:170` 改四包口径 + 补「src/web/chat-transcript/ 现为纯 runtime 库（transcript.css 由构建期 join 进 chat-conversation）」；`:239` 改「子会话屏走统一宿主 transcriptOnly 变体，组件与包均已退役」；「六处齐改」句保留并给 webview-asset-uri.ts 标注「有断言守护」。
- 验收/测试：`git grep -n "ChatTranscriptWebView" -- apps/mobile/README.md` 为空（Handle.ts 的命中按 deviation 1 在 spec 验收栏显式豁免）。
- 来源：cr2-r1-converge/K-3

### cr2-C-2 [P2] 中止 effect 不管「已挂起未起跑」的快照
- 文件：`apps/mobile/src/components/chat/ChatConversationWebView.tsx:2019-2027`
- 问题：中止判据只覆盖 inFlight 代次；`pendingSnapshotRef`+`snapshotDeferTimerRef`（0ms 定时器）挂起档不清——列表视图里 fire 会把浏览史分片灌进 WebView（正是要消除的堵塞，窗口窄）。
- 改法：中止 effect 在 inFlight 判据之外无条件清 `snapshotDeferTimerRef`（clearTimeout+null）与 `pendingSnapshotRef.current = null`。
- 验收/测试（快照族用例全部落 `__tests__/chat-conversation-webview.test.tsx`，c 节点独占；l 在 wave-2 后接同文件）：closeChunkGate 形态补「uiRunning 挂起档 + 退出列表后推进宏任务，sessionSnapshot 计数不增」；另补 deferred 统一 flush 断言（jank/D-2 半）：在途分片期间打一次 pushStreamDelta 进 deferred 队列 → 中止 → 重进补铺，断言补铺末片后紧跟 streamDelta/streamBatch 且中止后、补铺前一条都没有（断言落在 sentTypes 下标关系上，不只「出现过」）。
- 来源：cr2-r1-jank/C-1 + D-2 半

### cr2-C-3 [P2] `needsResumeSnapshotRef` 粘性：列表视图里跑成的完整快照不清标记
- 文件：`apps/mobile/src/components/chat/ChatConversationWebView.tsx:2089-2098,1168` 附近
- 问题：标记只在补铺 effect 清；中止后列表视图里因 richText/pendingSubagentSessions/messages 变化跑成的完整快照不清它 → 下次重进白发一次全量（「零补铺」不变量退化为「通常零补铺」）。
- 改法：`sendSessionSnapshotNow` 成功收尾处（onSnapshotComplete 调用行之前）补 `needsResumeSnapshotRef.current = false`。
- 验收/测试（中止后完整快照清标记用例落 `__tests__/chat-conversation-webview.test.tsx`，c 节点）：中止置位 → 列表态改一次 flags.richText 跑完快照 → 重进断言 sessionSnapshot 只 +3 不 +6。
- 来源：cr2-r1-jank/C-2

### cr2-C-4 [P2] 补铺 effect 缺空面守卫（空快照清转录）+ 与开屏轮同 commit 双发
- 文件：`apps/mobile/src/components/chat/ChatConversationWebView.tsx:2089-2098`
- 问题：① 无 `messages.length === 0` 守卫——空面时发空快照把转录清空且标记已被消费（真实消息到达后再全量，3 轮快照抖动）；② 与 ④ 同 commit 双发时白发一次分片流；若 ④ 走 sendPrependPage 增量通道则半截 DOM 无全量兜底。
- 改法：补铺 effect 三重守卫——`if (messages.length === 0) return;`（清标记**之前**）+ `if (sessionKeyRef.current !== sessionKey) return;`（换会话让给 ④ 的开屏轮，两条互斥）；messages 显式入依赖。
- 验收/测试（用例落 `__tests__/chat-conversation-webview.test.tsx`，c 节点）：① 中止置位→重进但 messages 空→断言计数不变且标记仍在，填上后恰好补铺；② 中止置位后重进同时换 sessionKey→断言恰好一轮全量（generation 连续）。
- 来源：cr2-r1-jank/C-3 + C-orch-1 + D-2 半（交错断言）

### cr2-B-1 [P2] `chatSubviewRef` render 期赋值（并发渲染下可停在未提交值）
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:79-82`
- 问题：render body 写 ref 在 React 18 并发根下不安全（被丢弃渲染同样执行赋值）——误判方向对称，其中「误判在 conversation」让 2.2s 计数照跑。同文件 tokenLabelSessionRef 已有正确先例（useLayoutEffect + 注释）。
- 改法：改 `useLayoutEffect(() => { chatSubviewRef.current = chatSubview; }, [chatSubview])`。
- 验收/测试：单测锁不住（TestRenderer 不模拟并发渲染），code review 确认 + 真机快速连点 20 次看 logcat 弃权/执行配比；与 cr2-E-2 同文件同节点落地。
- 来源：cr2-r1-jank/B-1

### cr2-B-2 [P2] 测试硬编码延迟默认值 2500（与生产常量无关联，4 处字面量）
- 文件：`apps/mobile/__tests__/chat-prompt-tokens.test.ts:132-145, 394, 449, 493`
- 问题：4 处 `2500` 字面量——139（afterEach 还原）、394/449（另两处还原）、493（advanceTimersByTimeAsync 推进值）。生产常量一调，「还原默认」静默变错值，故障形态诡异二分成本高。
- 改法：service 的 `PRECISE_UPGRADE_START_DELAY_MS`（:240 已定义）改 export；四处字面量全部引用该常量（含 493 的推进值）。
- 验收/测试：`git grep -n 2500 -- apps/mobile/__tests__/chat-prompt-tokens.test.ts` 仅命中注释行；与 cr2-E-2 同节点。
- 来源：cr2-r1-jank/D-1

### cr2-G-1 [P2] `detachInactiveScreens={false}` 未覆盖栈页 push 盖 Chat tab（未验证入口）
- 文件：`apps/mobile/src/navigation/RootNavigator.tsx:65-70`；结论落 `exit-jank-fix-playbook.md`
- 问题：prop 只管 tab 间；20 个 Stack.Screen 盖住 Chat tab 时走 native-stack 自己的 detach 语义——同病灶（WebView 画面层摘除→白屏一闪）未验证。backgroundColor 兜底只是缓解。
- 改法（验证先行；本条由 **fix-cr2-n** 节点认领，见 DAG）：真机走「大会话→FileEditorScreen→返回」「大会话→子会话屏→返回」盯白屏；不复现→playbook `## 残留（下一刀候选）` 节记残留+说明兜底覆盖观感；复现→最小修法二选一（高频页配 `detachPreviousScreen: false` 或接受现状记残留）。**结论必须落 playbook 同节**，否则下轮无人知道查没查过。无真机窗口时本节点只输出「验证步骤 + 待补结论」占位交 m 落盘，不改代码。
- 验收/测试：playbook `## 残留（下一刀候选）` 节含该条目——真机结论未出时为「验证步骤 + 待补结论」占位形态、结论到位后替换为结论行（两段式与改法一致，验收按当前所处阶段判对应形态）。
- 来源：cr2-r1-jank/G-1（需真机窗口，可与用户约定）

### cr2-A-4 [P2] 合帧三前提与三处 flush 收口零断言（web 侧 editor.ts 无测试网）
- 文件：`apps/mobile/src/web/code-editor/webview/runtime/editor.ts`；测试落位复用 web 测试基建
- 问题：注释承诺（last-wins 无序可乱 / blur 同步 flush / setDocument 丢挂起 / destroy 作废）全部无断言钉住；editor.ts 又在 build tsconfig 排除面内，IDE 之外的防线为零。
- 改法：新增 `apps/mobile/__tests__/code-editor-webview-runtime.test.ts`（**主选：node 环境 + 自建 DOM 桩**——本仓 RN jest preset 锁 `react-native-env.js`（node 子类、无 DOM），**无 jsdom/jest-environment-jsdom 依赖，勿用 `@jest-environment jsdom`**：照抄 `chat-conversation-dock.test.ts:7-9` 的既有形态（FakeElement/FakeClassList/FakeStyle + flushRaf，该文件头注释即本仓口径声明），CodeMirror 6 走 `jest.mock('@codemirror/view')`/`@codemirror/state`/`@codemirror/commands` 最小 stub（只需 EditorView.updateListener.of 能把 update 回调喂进来 + `state.doc.toString()`；**另需 mock 经 `language-for-path` 传递的 `@codemirror/lang-json`/`@codemirror/lang-markdown` 与 `./post` 出口**，否则 import 链断），断言四条——同帧多次 docChanged 只上行一次且为末次全文 / blur 同步 flush / setDocument 丢挂起 / destroy 后迟到 rAF 不上行。jsdom 仅作显式授权可选项（须先加 devDep 并单独立项批准，本轮不做）。若 CM6 stub 化不可行（EditorView 构造绕不开真 document），退化产出=纯模块单测（合帧状态机拆纯模块）+ 四条语义以注释契约记入本条**残留栏**（显式留痕，不静默跳过）。注：新测试 import `@web/...` 产生的 TS6307 噪声与既有三个 DOM 测试同源（tsconfig include/exclude 形态），不进 typecheck 门、勿试图改 tsconfig 消它。
- 验收/测试：断言「上行条数=1」与「上行文本=末态全文」；与 cr2-A-2 同节点（同文件）。
- 来源：cr2-r1-misc/A-3

### cr2-A-5 [P2] 新测试文件 4 处类型错误（tokens 旧 prop / CodeEditorSelection 错导入源）
- 文件：`apps/mobile/__tests__/code-editor-webview.test.tsx:41,65,136,149`
- 问题：`tokens` 是已删 props（组件自取 useTheme）——测试跑的是「props 没生效」形态；`CodeEditorSelection` 真源在 `./CodeEditorBridge`，文件末尾 `__KeepSelection` 在给错导入打掩护。build tsconfig 排除 __tests__ 故不挡 CI，但 IDE 全红且掩盖真实信号。
- 改法：删三处 `tokens={TOKENS}` 与 TOKENS 常量；**连 `import type {CodeEditorSelection}` 与 `__KeepSelection` 一并删**（本文件已无任何 selection 断言面，`__KeepSelection` 是该导入的唯一使用点——只删一半会留 unused import）。附注：本轮全量门**不含 lint**——工作区 eslint 现状 415 problems 超 `--max-warnings 321` 属既有状态，不在 cr2 范围。
- 验收/测试：`npx tsc --noEmit -p tsconfig.json 2>&1 | findstr code-editor-webview.test.tsx` 输出为空（整体 tsc 非零退出属既有 1021 行存量，判据只看该文件的 findstr 结果）；与 cr2-A-1 同节点（同文件）。
- 来源：cr2-r1-misc/A-4

### cr2-B-3 [P2] ResizeObserver 无引用无 disconnect，与 bindShellEvents 可重复调用契约不一致
- 文件：`apps/mobile/src/web/chat-transcript/webview/runtime/boot/bind-shell-events.ts:22-24`
- 问题：RO 结果直接丢弃——同函数 listener 靠「同引用被浏览器去重」实现可重复调用，RO 不吃这套，二次调用每帧多写一次 scrollTop（现网靠 bootTranscript 只调一次兜着，隐式契约未写）。
- 改法：模块级 `let scrollerResizeObserver` + 开头 `?.disconnect()` 再建；或单例 RO 换 observe 目标；`:11` 注释补 RO 去重口径说明。用例落**新建** `__tests__/chat-transcript-bind-shell-events.test.ts`（node 直测：需同时设 `global.ResizeObserver` 桩**与 Fake document 桩**——`bind-shell-events.ts:13` 无守卫调 `document.getElementById`，node 下裸跑 ReferenceError；桩好后连续两次 `bindShellEvents()`，断言桩的 disconnect 被调、尺寸变化只触发一次回调）。
- 验收/测试：连续两次 bindShellEvents 后尺寸变化只触发一次回调。
- 来源：cr2-r1-misc/B-1

### cr2-B-4 [P2] `dock--animated` 只加不摘：重挂时首帧豁免失效（底部滑一下）
- 文件：`apps/mobile/src/web/chat-conversation/webview/dock.ts:582-588,655-667`
- 问题：类在 mount 的 rAF 里挂、unmount 不摘且 #composer-dock 是常驻节点——重挂时类已在身上，首次写 paddingBottom 就带 200ms 过渡（正是首帧豁免要避免的现象）。
- 改法：mount() 的 renderAll() **之前** `classList.remove('dock--animated')`，rAF 回调再 add——不依赖 unmount 摘类，重挂与首挂同路。
- 验收/测试（用例落 `__tests__/chat-conversation-dock.test.ts`——本仓 DOM 测试先例文件，i 节点独占）：单测「unmount→mount 后首帧 padding 写入不带 transition」；进出 chat tab 后底部无上滑；**transcript-only 变体同链路**（misc OQ4 并入）：mount→隐藏（transcript-only 类）→移除类→显示，首帧 padding 写入同样不带 transition（隐藏→显示的跨隐藏态补间此前无任何断言覆盖）。
- 来源：cr2-r1-misc/C-1

### cr2-G-2 [P2] `switchToSessionListView` 实际超时 2×timeoutMs
- 文件：`apps/mobile/e2e/helpers/context.ts:143-161`
- 问题：先吃满一个 timeoutMs 再开一个 timeoutMs 循环，失败排障等双倍时间。
- 改法：`switchToConversationWebView(Math.ceil(timeoutMs / 2))` + 余下预算；或注释写明总预算 2×；失败报错带已耗时。
- 验收/测试：失败路径报错含耗时与阶段（等 context 还是等 data-view）。
- 来源：cr2-r1-misc/D-2

### cr2-B-5 [P2] `suppressClick` 残留吞下一次真实点击（长按后拖动滚动路径）
- 文件：`apps/mobile/src/web/chat-conversation/webview/session-list.ts:273,487`
- 问题：suppressClick 只在 click 消费与 unmount 复位——长按 fire 后拖动滚动（浏览器不派 click）→ 残留 true → 下一次真实点击被吞一次。
- 改法：pointerdown handler 开头 `suppressClick = false`（新手势新意图，与 cancelLongPress 并列一行）。
- 验收/测试（用例落 `__tests__/chat-conversation-session-list.test.ts`，i 节点独占）：补「长按触发→move>10px→up（无 click）→再 down+click→第二次上行 open」。
- 来源：cr2-r1-manual/E-1

### cr2-E-3 [P2] manager 通知触发无效全量重推（new Set 引用链）
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useSessionListBridge.ts:163-170`
- 问题：sync() 无条件 new Set → 引用必变 → payload memo 重算 → memo 比较器（引用比较）放行 → 列表态全量重推（内容未变也推，含 web 整批 DOM 重建）。
- 改法：sync() 内对两集合做内容级判等（size 相同 && 双向 every has），未变时不 setState。
- 验收/测试：用例**钉死落位** `__tests__/chat-conversation-panel.integration.test.tsx`（已引用 useSessionListBridge 且无其他节点触碰；勿落 chat-conversation-webview.test.tsx——该文件已被 c/l 两节点占用）：「列表态连续两次同内容通知→**`sessionList` prop 的引用变化次数只 +1**」——注意该文件里 ChatConversationWebView 是 jest.mock 哑组件（观测面 `lastWebViewProps()`/`mockWebViewPropsList`，同文件 :729/:737 已有同款断言先例），观测的是 prop 而非 postToWeb 计数。
- 来源：cr2-r1-manual/E-2

### cr2-G-3 [P2] viewState 先于 sessionList 的顺序依赖无注释无断言
- 文件：`apps/mobile/src/components/chat/ChatConversationWebView.tsx:2030-2047`（注释）；`chat-conversation-webview.test.tsx`（用例）
- 问题：切回列表同 commit 双下发，顺序靠 effect 声明序——隐含依赖无护栏。
- 改法：sessionList 下发 effect 补一行顺序依赖注释；用例断言 viewState 的 sentTypes 下标 < 首条 sessionList 下标。
- 验收/测试：调换声明序用例变红（牙性）。
- 来源：cr2-r1-manual/G-1

### cr2-K-4 [P2] spec-transcript-converge 状态与验收栏未回写 + 全部 spec deviations 回填
- 文件（全部主仓，backfill 节点执行）：`docs/Iterations/chat-webview-unify/spec-transcript-converge.md`、`spec-session-list-webview.md`、`spec.md`、`exit-jank-fix-playbook.md`、根 `CHANGELOG.md`
- 问题：spec 停在 implementing、验收三条零结论（其中两条当前为假）；7 条 deviations 待回写；两顺手修（CodeMirror 连删/键盘上跳）与键盘残影无 spec 留痕；af763a77 单提交空转（CSS 消费段随 4c995f6b 才落）需注记防二分误导；G-1 栈页验证结论落 playbook（依赖真机，可后补）。
- 改法：① spec-transcript-converge 状态改 implemented（待真机验收）+ 验收栏逐条结论/证据指针 + §D/§A 按 deviations 表回写（Handle 保留=类型单源、skip→hide=ready 闸门依赖挂载、menuItems 常量归属变体、CSS 断言面移产物——均「方向正确的有意偏离」）；② 主 spec 补两顺手修+残影条目（口述需求留痕）；③ CHANGELOG（**落主仓 `D:\Dev\Js\novel-master\CHANGELOG.md` 的 `## [Unreleased]`——worktree 侧无 Unreleased 段不动**；注意本迭代条目**尚未创建**，须先新建条目草稿（要点：会话列表进 WebView 统一文档 / 子会话屏收敛 / 进出会话卡顿四层修复），再在该条目下补一行注记「af763a77 的键盘残影修复其 CSS 消费段随 4c995f6b 才落地，二分排查勿单独 cherry-pick af763a77」）；④ playbook **`## 残留（下一刀候选）` 节**增「栈页 detach 未验证」条目——**显式两段式**：先落「未验证 + 验证步骤 + 待补结论」占位行（防「先合占位、结论永不补」），G-1 真机结论到位后替换为结论行；⑤ 主 spec `spec.md:99` typeahead 候选源措辞按 r6-A1 方案 B 收窄为「进会话/工作区变更/技能变更时拉取」，并把 `:7` 修订记录里的「未闭合」字样清掉（承接 §Open questions 第 8 条）。
- 验收/测试：spec 无空验收栏；状态行与实际一致；验收口径改窄判据——`git grep -n ChatTranscriptWebView -- apps/mobile/README.md` 为空（单路径；组件本体退役由「ChatTranscriptWebView.tsx 已 git D」本身作证，勿把 ChatConversationWebView.tsx 加进 grep 范围——它自身有 12 处命中且本轮无条目删注释）；其余全仓命中（36 处：Handle 类型 13 + ChatConversationWebView/session-stream-unit/adapter 等溯源注释 + `__tests__` 迁移痕迹）在验收栏逐名豁免（全仓清零本迭代不可达，勿作验收）。
- 来源：cr2-r1-converge/K-4 + §deviations 表 + cr2-r1-misc §deviations 1-2

### cr2-K-5 [P2] 无等价面判路的「无护栏清单」未记录（退役 40 用例中 4 族代码在、测试没了）
- 文件：`docs/Iterations/chat-webview-unify/spec-transcript-converge.md`（**§D 退役清单之后新增 `### F. 无护栏判路清单`**——该 spec 现无「测试迁移」独立节，章节实为 背景与目标/改动面 A~E/验收/风险）
- 问题：streamToolInvoking 上行、flagsUpdate 同值去重、T-SUB-CARD 强制直发、T-REPAINT 重挂首快照——行为代码全在但零自动化护栏，像不存在一样被忘掉。全补 10+ 条显著扩轮，倾向记录而非补齐（用户拍板项，见 Open questions）。
- 改法：在 §D 后新增 `### F. 无护栏判路清单`：四条判路逐条列出 + 「改动时需人工回归」警示句。
- 验收/测试：`### F. 无护栏判路清单` 节在 spec 中可见且含四条。
- 来源：cr2-r1-converge/OQ4（按其倾向落记录方案，待拍板确认）

---

## Spec deviations（处置汇总）

| 来源 | 条目 | 处置 |
|---|---|---|
| converge 1 | Handle.ts 保留（spec 列删除） | cr2-K-4 回写为保留项（类型单源） |
| converge 2 | transcriptOnly mount-and-hide（spec 写 skip mount） | cr2-K-4 回写 + ready 闸门理由（**方向正确**：skip 会 8s 白屏） |
| converge 3 | menuItems 旧口径常量保留（spec 写删） | cr2-K-4 回写归属变体 |
| converge 4 | CSS 断言面从源文件差集移到构建产物 | cr2-K-4 补记（比 spec 更强） |
| converge 7 | 验收「仅剩历史文档」被 README 命中 | cr2-K-3 修复后成立 |
| jank 1-3 | playbook 判据语义大于实现 ×3 | cr2-E-1/E-2/C-3 修复后消除；playbook 由 cr2-K-4 增补「采纳点前置条件」表述 |
| misc 1 | 两顺手修+残影无 spec 条目 | cr2-K-4 主 spec 补留痕 |
| misc 2 | af763a77 空转提交 | cr2-K-4 CHANGELOG 注记 |
| manual | 无 | — |

修复完成后 deviations 全部 fixed；**无 open spec_deviations 遗留**。

## Open questions / 待拍板

1. **无护栏判路要不要补测试**（cr2-K-5 按「记录不补齐」预设，待确认）。
2. **removeUnit 全量面是否也窗口化**（jank OQ1：修完 cr2-E-1 后退化为「短暂渲染一次全量再被 40 条接管」，再裁会牺牲无缝交接——倾向不动）。
3. **中止条件扩到 Chat tab 失焦**（jank OQ2：与 cr2-G-1 同场景另一面，牵动「栈页里看流式增量」语义）。
4. **两常量分档/可配置**（jank OQ3）与**测试钩子 __DEV__ 守卫**（jank OQ4）。
5. **RN 载荷重复行防御性去重 / 坏载荷整条丢弃**（manual OQ1-2：自产载荷风险低，倾向不加）。
6. **openConversation 静默吞错**（manual OQ3：需核实内部错误处理，若有 toast 则忽略）。
7. **合帧 16ms 窗口真机验证**（misc OQ1：连删中切文件/插 token 是否丢字——随 cr2-A-1/A-2 真机复验顺带）。
8. **r6-A1 遗留**（typeahead 候选源「进会话拉一次」收窄的 spec.md:99 回填）——上轮挂账，本轮 converge 域确认仍未回填，并入 cr2-K-4。
9. **清理粒度是否连包内陈旧文件一起清**（converge OQ5：buildPackage 逐文件覆盖、包内无陈旧文件；倾向不做全清——收益低且破坏增量观感）。
10. **E-1 修完后第 2 层剩余收益重估**（jank OQ5：快照 prescan 字节测量增量化在「深滚动+侧滑退出」原始症状上的权重，低优先——随 cr2-E-1 真机复验顺带）。
11. **RO 观察链跳帧风险**（misc OQ5：键盘裁切改祖先高度、依赖「祖先→scroller clientHeight→RO」链，部分 WebView 是否跳帧未实测——与 cr2-B-3 同节点顺手实测）。

## 已豁免（用户确认不修）

-（本轮无——上轮已豁免项不变）

## 合并后 QA（manual_user，不阻塞）

- 真机复验：大会话进出浏览面不塌（cr2-E-1）、1s 内切会话无 chip 卡顿（cr2-E-2）、长按连删+同帧保存不丢字（cr2-A-1/A-2）、栈页进出白屏观察（cr2-G-1）、PromptEditor 双模式 @ 候选正常（cr2-A-1）。
- macOS 出包跑一次 Copy WebViewDist 阶段（cr2-K-1 终验；本机无 macOS 环境时由 CI 首跑代验）。

## K 节建议（下游执行时闭合）

- 手工造残留验证 cr2-K-2 后清理临时文件；`bash -n` 临时脚本不提交。
- e2e T-E2 修复后建议注入 fixture 跑一次 rollback spec 全段。
- prettier CRLF 基线（.prettierrc 无 endOfLine）与 chat-transcript-telemetry.test.ts:44 存量断言债——上轮挂账不变，不在本轮范围。

## 执行 DAG（cr_dag_version 4；wave 内并行、波间串行；同文件必同节点）

```
wave-1（12 节点并行）:
  fix-cr2-a  [P0]  cr2-K-1 代码半（pbxproj:200 一行字节级修复；镜像断言归 b）
  fix-cr2-b  [P0]  cr2-K-2 + cr2-C-1（含 mock 注释）+ K-1 镜像断言（webview-asset-guard.test.ts 唯一 owner：prune 断言→K-1 镜像断言→联合类型断言 串行；build-webview.mjs / webview-asset-uri.ts / mock）
  fix-cr2-c  [P1]  cr2-C-2 + C-3 + C-4（ChatConversationWebView.tsx 快照族 + chat-conversation-webview.test.tsx 用例）
  fix-cr2-d  [P1]  cr2-E-1（session-stream-unit.ts + manager 守卫；用例落 chat-session-view-cache.test.ts + session-stream-unit-messages.test.ts）
  fix-cr2-e  [P1]  cr2-E-2 + B-1 + B-2（chat-prompt-tokens.service / useChatTabScope / chat-prompt-tokens.test.ts + use-chat-tab-scope-token-debounce.test.ts）
  fix-cr2-f  [P1]  cr2-A-1 + A-5（CodeEditorWebView.tsx + code-editor-webview.test.tsx）
  fix-cr2-g  [P1]  cr2-A-2 + A-4（editor.ts + FileEditorScreen + code-editor-webview-runtime.test.ts 新建 + file-editor-screen.test.tsx）
  fix-cr2-h  [P1]  cr2-D-1 + G-2（e2e pageobjects / rollback spec / context.ts）
  fix-cr2-i  [P2]  cr2-B-4 + B-3 + B-5（dock.ts + chat-conversation-dock.test.ts / bind-shell-events.ts + chat-transcript-bind-shell-events.test.ts 新建 / session-list.ts + chat-conversation-session-list.test.ts——三组文件互不相交）
  fix-cr2-j  [P2]  cr2-E-3（useSessionListBridge.ts；用例落 chat-conversation-panel.integration.test.tsx）
  fix-cr2-k  [P1]  cr2-K-3（README.md）
  fix-cr2-n  [P2]  cr2-G-1（RootNavigator.tsx；playbook 条目本体归 m 的 K-4④）——仅真机窗口可做；无窗口则本节点只输出「验证步骤 + 待补结论」交 m 落盘，不改代码
wave-2（依赖 c 的 ChatConversationWebView.tsx 落地）:
  fix-cr2-l  [P1]  cr2-A-3 + G-3（transcriptOnly 五条 + dist 断言两条落 chat-conversation-boot-script.test.ts + viewState 顺序用例 + :131-149 注释；chat-conversation-webview.test.tsx 与 subagent-session-screen-metrics）
wave-3（backfill，依赖全部代码节点）:
  fix-cr2-m  [P2]  cr2-K-4 + K-5（主仓文档回写 + playbook 残留节 + CHANGELOG Unreleased 新建本迭代条目；G-1 真机结论到位后替换占位）
```

- 分组约束（多节点触碰的文件清单，靠它反查冲突）：`webview-asset-guard.test.ts` 全部断言收归 b 单节点（prune / K-1 镜像 / C-1 联合，串行）；`ChatConversationWebView.tsx` 与 `chat-conversation-webview.test.tsx` 被 c（wave-1）与 l（wave-2）触碰→波间已串行；`chat-conversation-panel.integration.test.tsx` 仅 j；`use-chat-tab-scope-token-debounce.test.ts` 仅 e；`chat-conversation-dock.test.ts`/`chat-conversation-session-list.test.ts` 仅 i；`RootNavigator.tsx` 仅 n；主仓 docs/ 与 CHANGELOG 只由 m 触碰。
- **兜底纪律：DAG 未点名的测试文件一律不改、不新建——确需新文件必须先在条目里写死文件名并登记进本约束段**（本轮已登记新建：`code-editor-webview-runtime.test.ts`（g）、`chat-transcript-bind-shell-events.test.ts`（i））。
- 执行完毕后全量门：mobile jest 全量（--maxWorkers=2）+ tsc 双侧 + e2e T-CU12 冒烟（**不含 lint**——工作区 eslint 415 problems 属既有超预算状态，不在 cr2 范围）；真机复验按 QA 清单。
