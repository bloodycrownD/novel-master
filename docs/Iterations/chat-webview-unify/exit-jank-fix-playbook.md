# 进出会话卡顿：定位与修复 playbook（chat-webview-unify 第二阶段，2026-10-01）

用户报告「从大会话（会话2）侧滑退出非常卡，其他会话没有」，经四层逐层剥洋葱定位+修复，最终实测：侧滑到屏幕呈现 150-200ms（即时量级），用户确认修复。**该病根与 WebView 化无关，旧版 RN 同样存在**——chip 计算堵 JS 线程在旧版就有，webview 化只是换了受害者形态。

## 架构判据（回答「为什么计算任务卡 WebView」）

渲染已搬进 WebView，但**交互中枢还在 RN**：侧滑返回的链条是「系统手势 → RN BackHandler（JS 线程）→ postMessage 下发 viewState → web 应用 data-view」。任何占住 RN JS 线程（或原生模块队列）的重活都会让指令发不出去，WebView 空有即时渲染能力却收不到命令。**解耦方向不是继续搬家，而是把中枢里每件重活「让路化」**：交互来了它退（切片/弃权），交互走了它再干（延迟/空闲启动）。

## 四层病灶与修法

### 第 1 层：快照分片流在途堵塞退出指令

- **信号**：对照实验——进大会话停 10 秒再滑不卡、刚进就滑卡（分片流持续数秒）。
- **机理**：开屏快照逐片 yield 发送，与 viewState 共用 WebView 消息管道按序处理；快照 effect 依赖不含视图状态，退出后剩余分片继续灌。
- **修法**（`ChatConversationWebView.tsx`）：视图切离 conversation 时**顶掉 `inFlightSnapshotGenerationRef` 代次**中止剩余分片（分片循环每片发送前自检代次）；被中止的半截 DOM 由 `needsResumeSnapshotRef` 标记，**重进时 preserve 全量补铺一次**自愈；快照不在途的正常进出零补铺（SPA 零成本重进不退化）。

### 第 2 层：view-cache 浏览史全量水合，进会话载荷随浏览深度膨胀

- **信号**：只有被深度滚动过的会话卡（冷启动回源 41 条的不卡）。
- **机理**：`chat-session-view-cache` 存「浏览史全量」（loadOlder 每次 prepend 把整个消息面写回缓存单调增长），三处水合点（`session-stream-unit.performTailReload` 缓存命中分支 / `session-stream-unit-manager.hydrateSessionMessages` / `loadIdleTailMessages`）整面采纳——水合、re-render 传参、快照 prescan（逐条 JSON.stringify 测字节 O(总字节)）、分片流全部随之膨胀。
- **修法**：`hydrateWindowFromCache`（窗口 = `SESSION_VIEW_HYDRATE_WINDOW` = 40，尾部裁剪 + hasMore 置真），三处采纳点统一窗口化。浏览史仍留缓存/DB，`loadOlderMessages` 以消息面首行 seq 为锚回 DB 照常补——UI 要多少搬多少。handover 路径不裁（显示面无缝交接，重进时被 hydrate 覆盖不构成绕过）。

### 第 3 层：chip 精确升级轮 2.2s 堵死 JS，back 事件排队（真凶，藏在探针之前）

- **信号**：`[nm-chip] resolve done +2241ms (preferEstimate=false)`——决定性证据一直躺在日志里；期间 ReactNativeJS 零输出（同步段占死线程）；back 键到达 JS 恰在 resolve 完成同一拍；系统日志证实 back 43.649 就到了 app 原生层（dispatchInputEvent），堵在 app 内部不是系统。
- **机理**：进会话首帧估算档（162ms）后立刻启动「家族真分词器整串计数」（GLM 走 NovelMasterTokenizer 原生桥），秒级同步段+原生队列占用。shouldBail 弃权机制此前只接了「发送链竞争」，没接「退出竞争」。
- **修法**（`chat-prompt-tokens.service.ts` + `useChatTabScope.ts`）：
  1. 升级轮**延迟启动** `PRECISE_UPGRADE_START_DELAY_MS = 2500`（`startPreciseUpgrade` 拆 start/run 两函数；inflight 标记在延迟窗口即占位防并发；timer 可清理）；
  2. 升级轮 shouldBail 叠加**视图判据**（`options.shouldBailPrecise` ← `chatSubviewRef.current !== 'conversation'`；chatSubviewRef 为 render 期同步镜像 ref）；
  3. 测试钩子 `__setPreciseUpgradeDelayForTests(0)` = 立即启动（旧行为），存量两阶段用例零改动。

### 第 4 层：chip 首帧轮也是重活，300ms 防抖后即跑（「切会话后就能复现」）

- **信号**：冷缓存首帧 `build done +1004ms / resolve done +1161ms`。
- **修法**（`useChatTabScope.ts`）：新会话**首刷长窗** `CHAT_TOKEN_LABEL_FIRST_DEBOUNCE_MS = 1200`（`slot.hasLabel` 选档；会话内后续刷新保持 300ms 响应）；首帧轮 shouldBail 同样加视图判据（无观众即弃、重进重算）。

### 修复后的进会话时间线

0~1.2s 零 chip 重活（随便切随便退）→ 1.2s 估算首帧（轻）→ +2.5s 后才可能跑精确计数（退出即弃）。

## 定位工具沉淀（可复用）

1. **三点计时桩**：`[sl-debug]` 打点 back-key reached JS / backFromConversation run / viewState posted——锚定 RN 侧链路三拍。
2. **injectJavaScript echo 探针**：post viewState 后立刻注入脚本，它在 WebView JS 队列里排在指令后，执行时刻≈web 应用完成时刻（读回 data-view 自证）；decode 白名单外旁路收 echo。测「RN→web 应用」耗时。
3. **双 rAF painted 探针**：echo 内 requestAnimationFrame 嵌套两层后回报——applied→painted 之间即 style/layout/paint 渲染段。
4. **系统手势日志**：logcat 全量抓 `GestureNav_Strategy` / `GestureBackAnimation` / `InputReader` / `HwPhoneWindowManager`——锚定手指按下/滑动/抬起/back 发放的系统时刻，分辨「系统手势层」vs「app 内部」。
5. **chip 分段打点**：`[nm-chip-build]` / `[nm-chip]`（build/resolve 分段+preferEstimate 档位）。

## 排查顺序经验

先排除 app 内（探针 1→2→3 逐段照亮），每段 <100ms 才去看系统层（工具 4）；「用户的操作节奏实验」（停 10 秒/停 3 秒/立刻退）是最廉价的高区分度实验——不同节奏卡不卡直接分层病灶。**用户对自身操作的复现描述（「切会话后就能复现」）比任何推测都值钱**。

## 测试坑

- jest fake timers（RN preset 环境）对 hook 内 setTimeout 的推进语义不可靠：实测 `advanceTimersByTime(100)` 能 fire 1200ms 的 timer（全局裸 setTimeout 的 probe 正常，差异在 RN 环境）——**窗口边界断言不可写**，只锁合并/触发语义（advance 2000 全量推进）；用真计时器的套件真等（350→1300）。
- fake timers 会接管 setImmediate：用例内 `await setImmediate` 挂死连环超时；flush 用 `advanceTimersByTimeAsync`，afterEach 兜底 `useRealTimers()`（超时强杀不走 try/finally）。
- cmd 管道符会被 jest 当 pattern 吃掉跑成全量——输出重定向到文件再读。

## 残留（下一刀候选）

1. **计数中段尾延迟**：进入后 ~2.5-4.5s 窗口内（首帧/升级正在跑）侧滑，仍要等不可中断段返回。根治：`buildSessionPromptInput`/`serializePromptLlmInput` 切片化（纯 JS，热更可部署）；原生计数可取消（Kotlin 侧 cancel API，需出包）。
2. **L1 整串缓存两次进入间 miss**（内容指纹变化原因待查）——miss 才导致每次进入都重算精确档。
3. 85ms 级 ChatTabScreen re-render、快照 prescan 字节测量增量化——低优先。
4. **栈页 detach 未验证（cr2-G-1，两段式占位——真机结论到位后替换本条）**：`detachInactiveScreens={false}` 只覆盖 tab 间切换；Chat tab 之上 20 个 Stack.Screen（子会话屏/全屏编辑/会话详情）push 盖住时走 native-stack 自己的 detach 语义，同病灶（WebView 画面层摘除→白屏一闪）未验证，`backgroundColor` 兜底只是缓解。验证步骤：真机走「大会话→FileEditorScreen→返回」「大会话→子会话屏→返回」盯白屏——不复现则本条关闭记残留说明；复现则最小修法二选一（高频栈页配 `detachPreviousScreen: false`，或接受现状）。**结论：待真机窗口（未验证）**。
