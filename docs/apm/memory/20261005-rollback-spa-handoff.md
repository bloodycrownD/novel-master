---
date: 2026-10-05
tags: [mobile, chat-webview-unify, rollback, spa, handoff, worktree-despa]
source: 用户拍板「只退 SPA 化」交接文档（新会话从这里开工）
---

# 交接：只退 SPA 化（rollback-spa）——worktree despa 开工指南

## 任务定义（用户 2026-10-05 拍板，切面 B）

回滚 chat-webview-unify 迭代中的 **SPA 化子集**，**保留合成包**。用户对 unify 的定性（已达成共识）：收敛为主（桥协议/工厂化/CSS join/converge，逻辑面小）+ 一个行为核心（SPA 化）。动机：1.5.29 稳定无此族问题；SPA 的「文档常驻 + 手工会话边界」是 bug 之源（见下族谱）。

**保留（不回滚）**：chat-conversation 合成包（转录+composer dock 同文档）、dock 全区 web 实现（划词三项/粘贴门控/typeahead）、tool-card-click（工具卡片点击查看结果，长在 web 转录上）、ui-card-unify、子会话屏 transcriptOnly 变体、v2 握手与 8s 兜底、webview-background-ready-fail 全套。

**拆除（SPA 化专属）**：
1. 会话列表回 RN：`ChatSessionListPanel` 从壳恢复成完整组件（第二阶段把它退役为壳，逻辑搬进了 web 的 session-list.ts——恢复 = 从 v1.5.29 tag 捞回 + 适配现数据面；**这是移植大头**）。
2. 恢复 key 重挂：`ChatConversationPanel` 恢复条件渲染 + `key={`session-vfs-${sessionId}-${vfsRefreshKey}`}`（workspace-stale 修复后的形态，天然兼容）。
3. 拆 viewState 桥链：`chatSubview`→viewState 下发、web 侧 `#session-list`/`data-view` 切显隐、`useSessionListBridge`（数据面三徽标下发 + listAction 11 项分发）、CONVERSATION_LIST_TYPES 协议域。
4. SPA 专属补丁按需退：`[sessionKey]` 清场链、needsResume 补铺、8s 兜底的 sessionKey 依赖——key 重挂恢复后多数天然不需要，**以 v1.5.29 形态为基准对照**决定拆/留（别全拆，部分修复与重挂形态兼容）。
5. e2e 页对象改回 RN 会话列表（switchToSessionListView 的 web 判据 `#app[data-view]` 改回原生定位）。
6. SPA 形态测试族处理：T-SI 全族、sessionKey 重置链 describe、viewState 顺序护栏（G-3）等会红——它们测的路径不存在了，删/改写。

## 环境与 base

- **worktree**：`D:\Dev\nm\despa`，分支 `feat/rollback-spa`。
- **base**：main（28bcb9d0b = v1.5.36）+ cherry-pick 一笔 `63c51b439`（visibility 脏重挂误伤修复——**独立于 SPA 的 bug**，退 SPA 后子会话盖主屏场景仍存在，必须带上；含回归锁用例「栈内被盖」，变异验证过）。
- **不含** tsi 分支（feat/transcript-session-isolation）的任何提交——那是「修 SPA 边界」的迭代，退 SPA 后问题天然消失，带进去只会增加拆除面。tsi worktree（D:\Dev\nm\tsi）保留未删，其 spec 在 `docs/Iterations/transcript-session-isolation/`（主仓）可作 SPA 衍生 bug 的完整病理参考。
- 新 worktree 三件套：`npm install` → 根 `npm run build` → `apps/mobile npm run build:webview`（缺了整批假红）。
- 改 web 源码须 `build:webview`（dist 不进 git）；出包 `build:webview:native` + gradle（从 despa 直接跑，路径短无需 subst）；Metro 从真实路径起。

## SPA 衍生 bug 族谱（退 SPA 后从根消失，写 CHANGELOG 用）

并发会话消息串台（四路径：旧闭包快照覆盖/deferred 重放/空会话残留/中断合成行错丢）、workspace-stale-on-session-switch、visibility 脏重挂误伤（已单独修）、OQ-1 回列表丢行（存量缝隙）、切会话首帧错配自愈、needsResume 补铺全套。

## 已知代价（用户已知情接受）

- **切会话销毁重建 WebView 的卡顿回来**——这是当初推动 SPA 化的直接动因（用户当时原话「会话间切换还是会卡」）。缓解可选：重建期 loading 态优化；根治靠下条。
- **强烈建议顺手做 minify**：`apps/mobile/scripts/build-webview.mjs` 的 esbuild `minify: false` 改 true（约 :405-423 参数区），app.js 8.53MB → 约 1/3，所有 WebView 冷启动受益（含切会话重建与子会话新实例）。注意门 C 棘轮（compat 基线只许降不许升）与 dist 契约测；若某测试依赖未压缩形态需同步。此项独立可验、独立可回退。

## 探索起点（新会话应先派探索核实，勿当权威）

- `ChatConversationPanel.tsx`：SPA 化波次把条件渲染/key 拆掉的位置（git log -S "session-vfs" / 对照 v1.5.29 同文件）；`useSessionListBridge` 的接线。
- `ChatSessionListPanel.tsx`：壳化现状 vs v1.5.29 完整形态（`git show v1.5.29:apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx`）。
- `apps/mobile/src/web/chat-conversation/webview/session-list.ts` + `model.ts` 的 CONVERSATION_LIST_TYPES + `dispatcher.ts` 列表域 + 宿主 `handleUpstream` listAction 分支——五处协议落点（当初怎么加的见 `docs/Iterations/chat-webview-unify/spec-session-list-webview.md`，反向拆解用）。
- `SubagentSessionScreen.tsx` 不动（transcriptOnly 合成包保留）。
- e2e：`e2e/pageobjects/*.page.ts` 的 `switchToSessionListView`/session-list 相关（第二阶段 wave-3 迁 web context 的那批改动，git log 可追）。

## 纪律提醒（继承 RULE）

主仓不编码（despa worktree 干）；子代理禁 git 写/禁碰 docs/apm/；变异验证用文件备份恢复；测试计数以实跑为准；mobile 全量门 `--maxWorkers=2`（batch-delete 5 条存量红不背锅）；`detachPreviousScreen` 在 native-stack v7 已移除**不存在**，别再往那个方向试。

## 验收口径

切会话（含空会话/并发两各自生成）、子会话进出、后台回来、批量删除——全场景 UI 走查 + e2e；SPA 衍生族场景（串台/残留）确认天然消失；门禁三段 tsc + 全量 jest + build:webview 门 B/C。

## 关联文档

- 本迭代（tsi）全套：主仓 `docs/apm/memory/20261005-chat-concurrent-msg-mixup-brain-storm.md`（诊断→spec→开发→CR→sc→修复→真机验收全过程）
- unify 当初怎么做的：主仓 `docs/Iterations/chat-webview-unify/`（spec.md / spec-session-list-webview.md / spec-transcript-converge.md / exit-jank-fix-playbook.md / bugs/）
- visibility 修复上下文：本记忆第十~十一轮

---

user:
（新会话恢复本交接记忆）恢复记忆，我需要你开工实现 spa 回滚，注意不影响到 token 统计优化等相关的逻辑。补充：子代理 token 你不用担心，随便派遣，随便并发，效率越高越好。

assistant:
（执行轮全链，当日完成）三路只读探索（RN 宿主 / web 协议面 / SPA 补丁与测试族）给出行号级清单 → 四路 impl 并发（RN 宿主链 / web 拆除 / 测试改写 / e2e+README）→ 主代理收口。**关键探索结论**：SPA 落点高度收敛（RN 6 文件 + web 6 处 + 协议双侧）；8s 兜底对 sessionKey 的依赖是**注释级非代码级**（armReadyTimeout 依赖数组只有 clearReadyTimeout，保留项仅改 3 处注释）；token 统计链全在 RN（ChatMetaBar/ChatStreamMetricsBarLive/useChatTabScope token 段），web 侧零 token 概念，与拆除面正交。**ChatConversationPanel 不能照抄 v1.5.29**（那版用已退役的 ChatTranscriptWebView/MessageList/ChatComposer），正确形态=现版合成包上做减法+恢复 `key={chatScrollKey}`；VfsFileManager key 保持 `session-vfs-{sessionId}-{vfsRefreshKey}`（workspace-stale 修复形态勿冲掉）。

实现要点（超出交接记忆的部分）：① 原组件无卸载 cleanup，视图切离 effect 删除后 0ms defer 定时器会在 key 重挂卸载后照常 fire——新增空依赖卸载 cleanup 掐 snapshotDeferTimerRef+丢 pendingSnapshotRef（顺序同 flushPendingSnapshot）。② ChatTabProvider 的 chatSubview gate 与 v1.5.29 逐字一致，条件渲染恢复后反而必要，未动。③ 交接记忆的「T-SI 测试族」实为 **T-CSL 前缀**（web 会话列表测试族）。

**minify 顺手项已做**（esbuild minify:true，chat-conversation app.js 8.53MB→3.83MB 约 45%），dist 契约测同步七文件：断言四模式=标识符→字符串/属性面、布尔→双形态 `(false|!1)` 两种构建都锁、顺序断言→降级 entry.test 行为断言（真跑 main.ts 注册序本就更强）、`not.toContain(标识符)` 防回归断言换字符串锚（minify 下恒真失效）。**两个新坑**：① esbuild 路径注释被 minify 剥掉，dist 面 indexOf 顺序锚点全灭；② 假绿比红危险——T-PH-07 原断言 `/minify:false/` 在压缩打开后仍命中构建脚本注释里的字样（修行首锚+true/false 双向）。**契约测形态结论**：`v:2` 类信封指纹在 minify 下不存在（v 走变量构造），协议语义由 bridge.test 信封单测锁、dist 面不重复。asset-guard 的「三根目录包集合一致」要求**先跑 build:webview:native**（新 worktree assets 空是环境前置红非回归）。

门禁：typecheck 三段 0 错、定向 9 套件 171/171、契约 45/45、全量 2055/2060（唯一红=batch-delete 5 条已知存量）、门 C×4、asset-guard 12/12、变异拔牙实证（摘 key 必红）。提交两笔：`72c6a6ad1` 回滚主体（26 文件 +1560/−5386）、`fbb2e7785` minify+契约同步（8 文件，独立可回退）。CHANGELOG Unreleased 三条已写（worktree）。spec 落主仓 `docs/Iterations/rollback-spa/spec.md`。

user:
装到真机看看。刚才掉线了重新 reload。感觉没什么问题，发布下吧（batch-delete 5 条存量顺手修下）。

assistant:
（真机 + 发版轮，当日完成）真机链路：despa 出包 8m50s（checkWebViewAssets 过）→ **Metro 端口三连占**（8081=tsi 的 Metro、8082=主仓 Metro+QQ IPC、8083 也有主）→ 换 **18081** + `adb reverse tcp:8081 tcp:18081` 重指 → force-stop + `adb install -r -d` 覆盖装（这次荣耀锁屏门未拦）→ BUNDLE 100%、Metro 日志 warning 里 `D:\Dev\nm\despa\node_modules` 路径实锤加载本 worktree 代码。**掉线处置**：USB 抖动会丢 reverse（`reverse --list` 空），重建隧道 + force-stop 重启即恢复——别急着重装 APK。用户 UI 走查通过（切会话/子会话/后台/批量删除）。

发版 v1.5.37（patch+1 规则）：main 未被并行推进 → `--ff-only` 合入（连同 base cherry-pick 共 34 文件 +1989/−5587）→ CHANGELOG 定稿 + bump 三件套字节级（numstat 全 1/1）+ package-lock → **batch-delete 存量红顺手修**（mockRuntime 缺 sessionStreamUnitManager.forgetSession，deleteSelectedSessions 首轮即抛——测试一直跑在抛错路径而非部分成功路径，补 mock 后 5/5，mobile 全量首次 2060/2060 零红面）→ 门禁 mobile 三段 tsc 0 错+全量 2060/2060、desktop 600/600（主仓 run-tests.mjs 已修过 cmd 收集坑，带 zero-collect 守护可直接跑）→ tag v1.5.37 + push tag/main（Release CI 触发）。发版笔：`46982885c` 测试修复 + `ab436341d` chore(release)。
