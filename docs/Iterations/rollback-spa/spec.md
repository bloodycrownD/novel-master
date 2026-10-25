# rollback-spa：只退 SPA 化（保留合成包）

- **worktree**：`D:\Dev\nm\despa`，分支 `feat/rollback-spa`
- **base**：main（28bcb9d0b = v1.5.36）+ cherry-pick 63c51b439（visibility 脏重挂误伤修复，独立于 SPA 的 bug，退 SPA 后子会话盖主屏场景仍存在，必须带上）
- **不含** feat/transcript-session-isolation 的任何提交（tsi 是「修 SPA 边界」的迭代，退 SPA 后问题天然消失）
- **日期**：2026-10-05

## 任务定义（用户拍板，切面 B）

回滚 chat-webview-unify 迭代中的 **SPA 化子集**（WebView 文档常驻 + web 会话列表 + 手工会话边界），**保留合成包**。动机：v1.5.29 稳定无此族问题；SPA 的「文档常驻 + 手工会话边界」是 bug 之源。

### 保留（不回滚）

- chat-conversation 合成包（转录 + composer dock 同文档）
- dock 全区 web 实现（划词三项 / 粘贴门控 / typeahead）
- tool-card-click（工具卡片点击查看结果）
- ui-card-unify、子会话屏 transcriptOnly 变体
- v2 握手与 8s 兜底、webview-background-ready-fail 全套（含 63c51b439 visibility 修复）
- RootNavigator `detachInactiveScreens={false}`（切 tab 白屏防线，与 SPA 无因果）
- token 统计链全部（ChatMetaBar / ChatStreamMetricsBarLive / useChatTabScope token 段 / chat-prompt-tokens 服务——与拆除面正交，零触碰）

### 拆除（SPA 化专属）

| # | 项 | 落点 |
|---|---|---|
| 1 | 会话列表回 RN | `ChatSessionListPanel.tsx` 从 v1.5.29 整体捞回（431 行完整组件 + 现 testID），`ChatTabScreen` 恢复条件渲染 + 21 props 平铺 |
| 2 | 恢复 key 重挂 | `ChatConversationPanel` 给 `ChatConversationWebView` 恢复 `key={chatScrollKey ?? 'no-session-scroll'}`（切会话销毁重建）；VfsFileManager key 保持 `session-vfs-${sessionId}-${vfsRefreshKey}`（workspace-stale 修复形态） |
| 3 | 拆 viewState 桥链 | `useSessionListBridge.ts` 整删；`ChatConversationWebView` 的 view/sessionList/onListAction props、三个下发 effect、listAction 分支；`ChatConversationBridge.ts` 列表协议域（CONVERSATION_LIST_TYPES/ACTIONS 等）；web 侧 `session-list.ts` 整删 + `main.ts`/`dispatcher.ts`（第四域）/`model.ts`/`index.html`（#session-list 子树与 data-view）/`chat-conversation.css`（列表段 + view-fade-in 转场） |
| 4 | SPA 补丁拆除 | sessionKey 清场链 7 处（key 重挂后 React 自动归零）；needsResume 全套（ref/置位/清零/补铺 effect）；新增卸载 cleanup 掐 snapshotDeferTimerRef（原挂在视图切离 effect 上，迁移到卸载路径） |
| 5 | e2e 回原生 | `context.ts` 删 isSessionListView/switchToSessionListView；`app.page.ts` createSession/openLatestSession 回 UiSelector；对话页继续走 WebView context（合成包保留） |
| 6 | 测试族处理 | T-CSL/T-CSL-D 全族整删；sessionKey 重置链/快照中止补铺/G-3/viewState 下发 describe 删；新增「切会话 key 重挂」回归锁（变异拔牙验证：摘 key 必红） |

### 8s 兜底等保留项的注释级依赖

8s 兜底对 sessionKey 的依赖查实为**注释级而非代码级**（armReadyTimeout 依赖数组只有 clearReadyTimeout）——保留全部逻辑，仅改 3 处注释口径为「切会话经 key 重挂、onLoad 天然重新计时」。

## 顺手项：WebView 产物 minify（独立可回退）

`build-webview.mjs` esbuild `minify: false → true`：chat-conversation app.js 8.53MB → 3.83MB（约 45%），rich-document 3.42MB；所有 WebView 冷启动受益（含切会话重建与子会话新实例）——直接缓解「切会话销毁重建卡顿回来」这一已知代价。

**dist 契约测同步**（minify 影响断言面）：函数/变量名被重命名、`false→!1`、esbuild 路径注释被剥（顺序断言锚点失效）；字符串字面量/属性名/CSS/HTML 不变。断言改造四模式：标识符→字符串/属性面；false→双形态 `(false|!1)`；顺序→降级到 entry.test 行为断言（真跑 main.ts，本就更强）；`not.toContain(标识符)` 防回归断言换字符串锚（minify 下恒真失效）。

## 已知代价（用户知情接受）

- **切会话销毁重建 WebView 的卡顿回来**（当初 SPA 化的直接动因）——缓解：minify 提速冷启动；根治：无（回到 v1.5.29 形态）。
- SPA 衍生 bug 族（并发串台四路径 / workspace-stale 存量缝隙 / 回列表丢行 / 首帧错配自愈 / needsResume 补铺全套）随回滚从根消失。

## 执行方式

三路只读探索（RN 宿主 / web 协议面 / 补丁与测试族）给出行号级清单 → 四路 impl 并发（RN 宿主链 / web 拆除 / 测试改写 / e2e+README）→ 主代理收口（tsc 三段 / 定向 jest / 变异验证 / 门 B/C / minify 同步 / 全量门禁）。

## 门禁与验收

- mobile typecheck 三段：0 错（tsconfig.build / src/web / e2e）
- 定向 9 套件：171/171；dist 契约（boot-script + entry）：45/45
- 变异拔牙：摘 ChatConversationWebView key → 「切会话 key 重挂」用例红（已实证，文件备份恢复）
- build:webview + build:webview:native：门 C ×4 GREEN、checkWebViewAssets 过、asset-guard 12/12
- mobile 全量 jest（--maxWorkers=2）：**2055/2060，257/258 套件**——唯一红面 `use-chat-tab-scope-batch-delete` 5 条已知存量红（mock 缺 sessionStreamUnitManager，纪律点名不背锅）
- 真机验收（待用户在场）：切会话（含空会话/并发两各自生成）、子会话进出、后台回来、批量删除全场景 UI 走查；SPA 衍生族（串台/残留）确认天然消失

## 终态

- 提交 1 `72c6a6ad1`：回滚主体（26 文件，+1560/−5386）
- 提交 2 `fbb2e7785`：minify + 契约测同步（8 文件，+350/−191）——独立可回退
- 以上两笔经 fast-forward 合入 main（连同 base 的 63c51b439 cherry-pick，34 文件 +1989/−5587）
- 发版轮追加：`46982885c` 修 batch-delete 五条存量红（mock 缺 sessionStreamUnitManager，修复后 mobile 全量首次零红面）、`ab436341d` chore(release) v1.5.37
- **v1.5.37 已发版**（tag 已推送，Release CI 触发）。真机验收（荣耀 DSLDU20407006179）用户走查通过
- 真实 HEAD 以 `git log -1` 为准
