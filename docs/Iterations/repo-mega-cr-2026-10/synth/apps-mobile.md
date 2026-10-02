---
zone: apps-mobile
agent: W5-reduce（归并）
inputs: raw/w1-mobile-chat-ui、raw/w2-mobile-runtime、raw/w2-mobile-ui、raw/w2-mobile-nav、raw/w2-mobile-web、raw/w3-xc-cache-apps、raw/w3-xc-encoding
files_scanned: 7 份 raw 报告（覆盖 mobile 生产文件 47+82+102+70+92 = 393 个，按域测绘实测口径）
merged_findings: 49（P0 0 / P1 3 / P2 20 / P3 26）
raw_findings_in: 108（P0 0 / P1 6 / P2 51 / P3 51，另有 intentional/负例 30+ 未计）
verified_by_reduce: 21 处（grep/读码/node 实测，见各条「reduce 核验」）
measured_at_head: feat/repo-mega-cr @ 9ca5f5ad
---

# W5 归并 · apps-mobile（移动端全簇）

## 摘要

移动端 = 一个 RN 宿主 + 四层产物链最末端。`runtime/`+`services/`+`db/`+`storage/` 是宿主层
（单连接 op-sqlite、core service 装配、`SessionStreamUnitManager` 单元编排、云同步/备份/维护）；
`components/`+`screens/`+`navigation/`+`hooks/` 是视图与路由层；`src/web/**`+`src/webview-host/**`
是四个打进 APK 的 WebView 页面源码；`webview-host/` 试图当 web↔RN 共享纯数真源但**接不回去**。
本波无 P0。三个 P1 全是「生命周期没接上」族：manager 的 `forgetSession` 零生产调用导致会话删除
后四张 Map 残留、云同步 pull 的互斥令牌在异常路径永久泄漏、`RealPrompt` 路由无参数导致跨会话
看错提示词。最大面积的问题是**双端同语义两份实现**（10 处纯重复 + 3 处已发生行为漂移）与
**编码损坏无闸**（10 个文件已入库、提交钩子与 CI 均无检查）。

## 职责与边界（本簇四段的分工）

| 段 | 目录 | 职责 | 边界纪律 |
|---|---|---|---|
| 宿主装配 | `runtime/`、`db/`、`storage/` | 开连接、注册三个原生驱动、拼 core service、bootstrap manager 并注入三桥 | `SessionStreamUnitManager` 刻意不进工厂（避免纯工厂带副作用），由 `novel-master-context.tsx:176-186` 在 runtime 就绪后 `Object.assign` 挂上 |
| 宿主服务 | `services/`（82 文件 11819 行） | 会话流单元编排、云同步(S3+全量库快照)、备份/维护、提示词 token chip、VFS 编排、token 估算绑定 | 本区自身**不直接写业务表**，全部经 core service 工厂 |
| 视图路由 | `components/`（102 文件）、`screens/`、`navigation/`、`hooks/` | UI 原语 + 业务视图 + 路由真源 + 通用 hook 范式 | 业务语义（front matter、目录规则求值、agent 表单映射）一律下沉 core；chat-tab 目录零导航依赖 |
| WebView | `src/web/**`（4 包）、`src/webview-host/**` | 打进 APK 的四个页面 JS + 共享纯函数真源区 | 装配点唯一 `web/<pkg>/webview/main.ts`；`webview-host` 禁 DOM、禁 RN import |

## 对外接口（跨段消费面最大的一组）

- `SessionStreamUnitManager`（1977 行）→ ChatTabProvider / ChatTabScreen / useChatTabController /
  useChatTabScope / ChatSessionListPanel / SubagentSessionScreen 六处消费。
  消息面唯一真源：`snapshot` / `readMessagesSnapshot` / `subscribe` / `loadSessionTailMessages` /
  `loadOlderSessionMessages` / `attachWebview` / `detachWebview`；run 面：
  `startRun` / `stopRun` / `requestStreamReset`；判活：`activeSessionIds` / `interruptedSessionIds`。
- `createMobileNovelMasterRuntime()` → `MobileRuntimeCore`（= 去掉 manager 的 runtime）。
- `useFocusListReload` → 6 个屏（ProviderDetail / Providers / SearchEngines / SkillPanel /
  SkillsSettings / SmartSortRules）的列表范式底座。
- `PAGE_HEADER_CONFIG` → `components/chrome/AppHeader.tsx`（headerShown:false 后顶栏全自绘）。

## 数据访问

- **表**：本簇不直写业务表。经 runtime 工厂触达 `session_run_state`（manager:1117/:1288/:1439
  + writethrough 节流 upsert）、`session_kkv` 域 `stream_metrics`（manager:1804/:1840/:1753）、
  `chat_session.composer_draft_json`（chat-composer-draft.ts:56-71）、`vfs_entry`/
  `vfs_revision`/`vfs_content_blob`（经四个 VFS 工厂）、`llm_saved_model`、agent registry、
  usage stats 底表（`chat_message` 逐消息 token 列）。
- **KKV 模块**：`nm-cloud-sync`（13 键 + SKSP ref `cloud-sync/s3-secret-key`）、
  `nm-mobile-ui`（主题/富文本/通知/transcript 引擎/版本 epoch/6 个 updates 键）。
- **SKSP**：provider/agent/search 凭证（`createCompositeSecretStore(resolveSkspDriver('android'))`）。
- **文件路径**：`{DocumentDir}/default/novel_master_vfs` 等四候选（`db-file-path.ts:62-79`
  按序探测取首个存在者）、`{CacheDir}/cloud-sync-{export,import}-{ts}.nmbackup`、
  `{CacheDir}/{fileName}`（document-io.ts:47，**无随机后缀**）、`{dbPath}.nmbackup.bak`。

## 依赖关系

```
index.js → App.tsx → RootNavigator ─┬─ MainTabs(Chat | Profile)
                                     └─ Stack(28 屏)
ChatTabScreen → ChatTabProvider ─┬─ useChatTabScope（列表/菜单/导航/缓存/token 标签）
                                 ├─ useChatTabMessages（draftRestoreToken + emitter）
                                 └─ useChatTabController → useChatTabMessageActions
   └─ ChatConversationPanel ─┬─ ChatTranscriptWebView ─→ web/chat-transcript（web bundle）
                             ├─ ChatComposer → ComposerAtPathInput → ComposerInputWebView
                             │                  └─ web/composer-input
                             ├─ MessageList（legacy-rn 回滚线，KKV 开关真实可达）
                             └─ VfsFileManager ─┬─ RichDocumentWebView → web/rich-document
                                                └─ CodeEditorWebView → web/code-editor
services/session-stream-unit-manager ── 单元注册表（starting/running 门禁 + settled 宽限 30s
                                       + LRU 8）──▶ eventBus×8 + AppState + notifee
services/cloud-sync.* ──▶ @novel-master/cloud-sync-driver-s3 ─▶ @aws-sdk/client-s3
```
第三方：`@notifee/react-native`、`@react-native-documents/picker`、`react-native-blob-util`、
`@noble/hashes`、`js-tiktoken/lite`、`preact`/`mermaid`/`@recogito/text-annotator`/`@codemirror/*`
（后者四个全部 `packages:'bundle'` 打进 webview IIFE）。**全区无 zstd/brotli/wasm**（RULE：
移动端 Hermes 没有 WebAssembly，实测零命中）。

## 架构小结：本簇骨架与两条关键链路

1. **WebView 三层产物链（RULE:73）——改 `src/web/**` 不经过 Metro，是本簇最大的认知陷阱**。
   链路上任何一环漏掉，代码「改了但没生效」且**零报错**：

   ```
   第 1 层 源     apps/mobile/src/web/<pkg>/**（+ src/webview-host/**）
        │ esbuild bundle/iife/target:es2018/packages:'bundle'   ← build-webview.mjs:107-122
        ▼
   第 2 层 产物   apps/mobile/webview-dist/<pkg>/{index.html,app.js,app.css}
        │ app.css 由 injectCss 把 CHAT_TRANSCRIPT_RICH_CSS / RICH_DOCUMENT_RICH_CSS /
        │   MERMAID_FULLSCREEN_CSS 注入壳 CSS 占位（build-webview.mjs:88-97, 零 _CSS_ 单源）
        │ --copy-native → replaceCopyDir 整目录替换                 ← build-webview.mjs:136-153
        ▼
   第 3 层 落点   android/app/src/main/assets/webview/<pkg>/  +  ios/NovelMaster/WebViewDist/<pkg>/
        │ 只有这一层被打进 APK
        ▼
   运行时         RN <WebView> 加载 file:///android_asset/webview/<pkg>/index.html
                   ↕ postMessage 桥（shared/host-message-channel.ts matchHostMessage 做 v+type 校验）
                   web/shared/host-message-channel.ts 配对 document(window 双注册，Android 走 document)
   ```
   三个易漏点，全部已在本簇落到条目：**① 忘 build core**（webview 消费 `@novel-master/core/chat`
   的 **dist 产物**不是 src，见 AM-49；`prebuild`/`prestart`/`preandroid` 已覆盖常规路径，
   但直接 `npm run build:webview` 会漏）；**② metro reload 碰不到它**（RULE:73，热重载对
   webview 页面无效）；**③ trust 边界分层**（RN 侧 `sanitizeRichHtml`/`prepareTranscriptRichHtml`
   消毒后传入，web 侧只做 `TrustedHtml` 渲染、`mermaid-core.ts:54` 显式
   `securityLevel:'strict'`——`applyStreamBlockCommit` 的裸 `insertAdjacentHTML` 依赖的正是
   这个「RN 侧已消毒」前提，不是 web 侧自己的防线）。
   `webview-host/**` 名义上是 web↔RN 共享真源，实际**只有 `scrollTopForOffsetFromBottom` 一个
   函数真被用**（AM-14）。

2. **流单元管理器（`SessionStreamUnitManager`）在架构里的位置**——它是**消息面与 run 面的
   唯一真源，位于 services 层、在 React 树之外、不进 runtime 工厂**：

   ```
   core 业务事件(eventBus ×8) ─┐
   UI 动作(startRun/stopRun) ─┼─▶ SessionStreamUnitManager（1977 行，React 树外单例）
   WebView 句柄(attach/detach) ─┘        │
        │  按 sessionId 维护 units 注册表（starting/running 门禁 + settled 宽限 30s + LRU 8）
        ├── SessionStreamUnit（1269 行）= 状态机 + 32ms ingress / 64ms apply 两段流式缓冲
        │                              + webview 句柄注册表 + 消息管线
        ├── idleMessageViews   ← 无单元会话的消息面（hydrateSessionMessages 对每个打开过的会话
        │                        无条件 set，**无上限**，对照 view cache 是 500 LRU）
        ├── settledProjections ← 「上次生成」常驻投影（hydrate 无上限回填）
        ├── pendingChildParentByChild / consumptiveSessions / writethroughs
        └── forgetSession（:717）= 四张 Map 的**唯一**按会话清理入口 —— **零生产调用**（AM-1）
   投影出口：snapshot / readMessagesSnapshot / subscribe / interruptedSessionIds
             → ChatTabProvider（Provider 不持任何消息 state）
   ```
   位置选择的三个后果：① manager 不进工厂是为了让 `createMobileNovelMasterRuntime()` 保持纯
   副作用隔离，代价是它由 `Object.assign` 事后挂载、`bootToken>0` 与 `cancelled` 两条分支各自
   负责 dispose（xc-cache-apps F-16 核过：两条都在「销毁连接之前」，时序正确）；② 它在 React 树
   外，所以「会话删除」这种 UI 动作与「释放单元内存」之间**没有任何自动挂钩**，全靠调用方自觉
   ——AM-1 就是这条架构缝的直接产物；③ `idleMessageViews` 取代了原来的 `useChatTabMessages`
   消息 state，于是原 hook 只剩 `draftRestoreToken` + 一个 emitter 监听。

## 发现清单（归并后 49 条，编号 AM-n）

严重度口径：**P1=用户可见错误数据/功能失效且无自愈路径；P2=可观测劣化或有条件触发但有绕行；
P3=债务/一致性/清理项**。凡与上游 W1-W3 裁决冲突处，本节写明「校准理由」。

### P1

**AM-1 | P1 | `services/session-stream-unit-manager.service.ts:717`**
`forgetSession` 的 JSDoc 明写「Step 6 会话删除链路调用」，但生产调用方为 0。reduce 核验：
`git grep forgetSession -- apps/mobile` 全部命中 = 3 个测试文件 + manager 自身注释/定义行。
真实删除链路 `useChatTabScope.ts:521-541 handleDeleteSession` / `:564-589 deleteSelectedSessions` /
`:591-610 handleDeleteProjects` 三处（reduce 已逐行读过）都只做 `runtime.sessions.delete` +
`clearSessionViewCache*`，**不碰 manager**。后果四层：① `idleMessageViews` 里每个已删会话的
整份消息 tail（40 条 + 分页累积，`[...cached.messages]` 深拷贝）永久驻留——**这是删除后仍在内存
保留用户可见数据的隐私面**；② `settledProjections` 无界；③ `pendingChildParentByChild` 双向残留；
④ 已删会话的 hydrated `interrupted` 单元继续占 LRU，列表上仍挂「已中断」徽标
（`interruptedSessionIds` 消费方确认在 `ChatSessionListPanel.tsx:115-118`）。
**与 `raw/w2-mobile-runtime.md` F-2、`raw/w3-xc-cache-apps.md` F-1/F-2/F-3/F-4 五处独立撞车，
本次归并为一条**（修法同批）。** 合并的第二 prong：**`idleMessageViews` 的无上限不依赖删除
路径**——`hydrateSessionMessages:923/:929` 对每个打开过的会话无条件 set（连缓存 miss 的空壳都写），
所以「翻 200 个会话 = 200 个条目」是正常浏览就会发生的。修法：① 三处删除成功分支补
`manager.forgetSession(id)`（项目删除加 `forgetProject` 或前缀清理口）；② `idleMessageViews` /
`settledProjections` 加与 `chat-session-view-cache` 同口径的 500 LRU 兜底，防再有第二条删除路径漏掉。
置信 confirmed。**上游校准**：xc-cache-apps 报 P1×2、mobile-runtime 报 P1，status.md 已记「二次
独立印证」；本条不降级。

**AM-2 | P1 | `services/cloud-sync.service.ts:317-338`**
`pullCloudSync` 的 `acquireMobileDbMaintenanceBusy()` 写在 `try` **之外**，中间隔着一次真实
await（`createCoordinator`：读 KKV 配置 → SKSP 读 secret → `createS3ObjectStorage` →
`createRnS3Client`）。reduce 核验（读码 `:306-350`）：`acquire` 在 317、`let pullBusyHeld = true`
在 318、`await createCoordinator` 在 332、`try {` 在 338——任一环节抛错则 `finally:367` 的
`releasePullBusy()` 永不执行，`db-maintenance-busy.ts:15` 的 `maintenanceBusyCount` 永久 +1。
该计数是 `isMobileDbMaintenanceBusy()` 唯一来源，被 `blob-binary-normalization.service.ts:50`
与 `message-content-compaction.service.ts:26` 两个后台循环当让路守卫 → **一次云同步配置异常就让
消息正文压缩搬运 + blob 二进制归一在本进程内永久停摆**（到下次冷启动），用户无任何提示。
`pushCloudSync` 无此问题。**与 `raw/w4-cloudsync-pro.md` 独立撞车（status.md 已记置信升级）。**
修法：`createCoordinator` 移进 `try`（临时路径用 `let` 声明、finally 判空 unlink），或
try/finally 包住两段；补一条「注入 createCoordinator 抛错 → `isMobileDbMaintenanceBusy()` 回 false」。
置信 confirmed。

**AM-3 | P1 | `navigation/types.ts:16` + `screens/stack/RealPromptScreen.tsx:23` + `:397`**
`RealPrompt: undefined`（路由无参数），页面从 `useMobileScope()` 取**全局持久化的**当前项目/会话；
而入口在 `SessionDetailScreen.tsx:397 navigation.navigate('RealPrompt')`——该页路由参数是
`{projectId, sessionId}`。用户看会话 A 详情页时全局 current 可能是 B → **看到的是 B 的提示词，
无任何提示**。reduce 核验：`RealPromptScreen` 只有这一个数据入口（`:38 buildRealPromptPreviewSegments`
吃 scope），而 SessionDetail 的唯一入口 `ChatTabScreen.tsx:41-48` 传的是 `ctx.projectId/ctx.sessionId`
（当前会话），但进入详情页后**用户可在子会话/其他路径改全局 scope**（`setCurrentSession` 有 5 处
调用点，见 grep），SessionDetail 页本身不冻结 scope。另一入口 `useChatTabController.ts:106-108`
从 chat tab 直接跳，此时 scope 与所在会话一致——所以错数据只从详情页入口发生。
**校准说明**：mobile-nav 原报 P2、status.md 已标「P1 候选（用户可见错数据）」，本条**采纳 P1**。
修法：`RealPrompt` 路由加可选参数 `{projectId?, sessionId?}`，入口显式传；缺省回落 scope。
置信 confirmed（错数据路径已读码闭环，仅「scope 在详情页被改」这一前置条件未做真机复现）。

### P2

**AM-4 | P2 | 10 个文件（清单见下）| 校准自 P1**
编码损坏已**全部入库**（reduce 核验：工作树与 HEAD blob 一致；`session-prompt-input.service.ts`
实测 178 个 U+FFFD 且严格 UTF-8 解码失败）。damage 100% 落在注释 / `it()` 用例标题 / markdown
标题上，**无任何运行时代码或断言被改**（xc-encoding 逐行核过 26 个坏行全是 `*`/`//`/`/**` 开头）。
reduce 复核了 12 个文件的 valid/FFFD 计数，与 xc-encoding 报告**逐项吻合**。
10 个：`apps/mobile/src/services/session-prompt-input.service.ts`(178, invalid)、
`packages/core/test/agent/agent-runner.test.ts`(64)、`openai-content-mapper.test.ts`(4)、
`message-body-text.test.ts`(3, invalid)、`apps/desktop/src/main/ipc/handlers/vfs.ts`(2)、
`docs/Iterations/mobile-chat-composer-annotate-ux/prd.md`(2, invalid)、
`tool-definitions.ts`(1)、`sksp/impl/composite-secret-store.ts`(1)、`sksp/logic/ref-to-env.ts`(1, invalid)、
`sksp/ports/secret-store.port.ts`(1, invalid)；另 `.gitignore`(invalid)、
`apps/mobile/android/app/build.gradle`(intentional, RULE:105 拍板 GBK，但已二次 mojibake + 残留
`&#65533;`，交 RULE 维护者）。
**校准理由**：mobile-runtime 原报 P1、xc-encoding 报 P2。采纳 P2 的依据是——损坏全在注释、
**10/10 引入提交的父版本逐行干净**（可 `git show <引入>^:<path>` 精确回滚）、无运行影响。
**P1 保留给防再犯闸**：① 无 `core.hooksPath`、无 husky/lefthook、CI 四道（format/lint/typecheck/test）
无编码检查 → RULE:111「PS 管道毁编码」纯靠自觉；② 三种损坏口味里**「合法但错字」（`（`→`；`、
`：`→`）`，UTF-8 完全合法、U+FFFD 闸查不到）与「整字符→ASCII `?`」两种只查 U+FFFD 会漏**，
闸门必须同时拦 `invalid-utf8`；③ 损坏会**静默累积**（`session-prompt-input.service.ts` 两次提交
各伤一轮：acb4379e 引入、d3b1049a 加剧）。
落地方案见 `raw/w3-xc-encoding.md` §6（三文件 + 一条 `git config`，白名单按后缀 + 二进制探测而非
硬编码路径；顺序必须先清干净再加闸）。哨兵甄别已完成：sksp 三处 + tool-definitions 一处**全部判定
为损坏非哨兵**（父版本同一行的 `→`/`—` 完好 + 引入提交是零语义动机的机械重构）。
置信 confirmed。**跨簇**：`raw/w2-mobile-runtime.md:149-150` 引用了损坏原文，CR 报告把污染复制进了
文档层，修源码时须同步订正（xc-encoding F-17）。

**AM-5 | P2 | 双端同语义两份实现且已发生行为漂移（3 处）**
`components/skills/skill-ui.ts:53-59 buildNewSkillDoc`（mobile 走 `yamlScalar`=JSON.stringify 转义）
vs `apps/desktop/renderer/features/skills/skill-ui.ts:21-27`（裸插值 `` `name: ${name}` ``）——
reduce 核验两处原文，漂移属实。`validateSkillName` 只禁空白/`/`/前导 `.`，**不禁冒号**，
故含 `:` 的技能名在 desktop 端生成的 front matter 会被 YAML 解析器截断、键错位。
`fillPolicy` 归一：mobile `services/fill-policy-mobile.ts:7` `full → hidden`，desktop
`DirectoryRuleModal.tsx:37-46` 未知值 → `DEFAULT_WORKPLACE_DIR_RULE.fillPolicy`（`header`）——
**同一份数据两端看到不同选项被选中**。`模型分组计数`：`ModelPickerModal.tsx:38-40/:92-96`、
`ProviderDetailScreen.tsx:63/:108-117`、`useAgentEditorFormState.ts:405-412/:424` 三处独立实现，
三个近义私有函数名并存（`modelNameKey`/`nameCounts`/`modelNameCounts`），`useAgentEditorFormState`
甚至内联 `` `${m.providerId}\0${m.modelName}` `` 而不复用本文件的 `modelNameKey`；三处注释都写着
「与 ModelPickerModal 同口径」——作者知道必须同步，但无机制保证。
修法：三个归一化/分组函数下沉 `domain/*/logic/`（core 已有 `withSkillFrontMatter-values.ts` 走同一套
`yamlScalar`、`format-saved-model-display-name.ts` 紧邻）。置信 confirmed。
**跨簇**：`buildNewSkillDoc` 已被 `raw/w3-xc-dup-ends.md` 独立发现（status.md 记「desktop 不加引号
YAML 造非法技能」）——同一条，勿重复计数。

**AM-6 | P2 | 双端纯逻辑重复未收口（10 项，收口清单缺项）**
`@路径` 查询、锚点菜单布局、原子删区间都已正确收口到共享源，但下面 10 处漏了（reduce 逐处核验
git grep 确认双份定义都在）：

| 逻辑 | mobile | desktop |
|---|---|---|
| 工具摘要 `summarizeToolInput`/`toolCallSummary` | `components/chat/message-blocks.ts:277/:315` | `renderer/features/chat/message-blocks.ts:178/:228`（**第三份在 `web/chat-transcript/.../render/tool-logic.ts:8/:38`**） |
| composer 发送态 `deriveComposerSendState` | `components/chat/composer-send-state.ts:14/:27` | `renderer/features/chat/composer-send-state.ts:63/:76` |
| VFS 批量移动路径工具 | `components/vfs/vfs-move-path.ts:1-44`（文件头自陈"从 desktop 拷贝，暂不抽 core"） | `renderer/features/workspace/vfs-tree-dnd.ts:36-68` |
| VFS 路径原语三函数 | `components/vfs/vfs-row-mapper.ts:31-54` | `renderer/features/workspace/vfs-tree-utils.ts:42-93`（文件头写 "aligned with mobile vfs-row-mapper"） |
| prompt 宏白名单解析五函数 | `components/agent/prompt-macro-input.ts:1-163` | `renderer/features/settings/prompt-macro-input.ts` |
| 工具策略触发文案 | `components/agent/ToolPolicyPicker.tsx:41-49` | `renderer/features/settings/ToolPolicyPicker.tsx:12-20` |
| 采样字段清单 + 五纯函数 | `components/provider/SamplingForm.tsx:22-89` | `renderer/features/settings/SamplingForm.tsx` |
| 目录规则选项表 + clamp | `components/sheet/DirectoryRuleSheet.tsx:41-57/:258-264`（`smart` 首位） | `renderer/features/workspace/DirectoryRuleModal.tsx:19-54`（`smart` 末位，**顺序都不同**） |
| WebView 导航守卫（见 AM-16，安全关键） | 4 份 | — |
| highlight.js 语言归一表 `LANG_ALIAS` | `components/rich-content/highlight-code.ts:25-45` | `renderer/components/code-block.tsx:15-35`（**这一处是 intentional**，见 intentional 清单） |

修法与成本提示（mobile-ui 报告的争议点，我采纳）：「抽 core」在本仓**有实打实成本**——core 有
25 个 exports 子路径、新增子路径要同步 `packages/core/tsconfig.test.json` 的 paths（否则测试静默吃
旧 dist）、mobile 端必须走 `dist/` 产物。**排优先级建议：先做 AM-5 三处「同语义两份实现且已漂移」
的（不改位置也能先统一行为），再做纯搬运。** 置信 confirmed。

**AM-7 | P2（校准自 P1）| `components/vfs/VfsFileManager.tsx:309-313`**
```
if (reloadInFlightRef.current) { return; }
reloadInFlightRef.current = true;
```
`reload` 是**丢弃式**并发去重：不排队、不合并、`finally:392` 置回后**无补跑**。第二次调用直接
return。而 `reloadVfsListOnly:397-399` 是它的零成本别名，却在 10 个调用点（`:463/:568/:657/:789/
:819/:879/:924/:950`）各自包一层 `useCallback`，让 `confirmBatchDelete`/`runBatchMove` 的依赖数组
多出一层恒等引用（reduce 已核验全部 10 处调用点与 `:397-399` 定义）。`reload` 单次是
`vfs.list` + `buildListRows` + `getDirRule` 三路并发（+ smart 排序时再拉预编译规则），弱网可达
数百 ms——用户「删除 → 立即刷新」落在飞行窗口内则这次刷新被静默吞掉，列表停在删除前快照。
**校准理由**：mobile-ui 原报 P1 且自陈「严重度存疑、建议 W6 构造 vfs.list 挂起 2s 的用例」——
本条不构成数据损坏、无再触发点但用户有绕行（切目录/退屏重进），按本簇口径降 **P2**。
修法：`reload` 改「飞行中置 pending，落地后若 pending 再跑一轮」；顺手删 `reloadVfsListOnly`，
10 处直呼 `reload`。置信 confirmed（机制）/ suspected（真实触发率，未真机复现）。**转 W6 验证**。

**AM-8 | P2 | `services/snapshot-file-hash.ts:21-42`**
reduce 已读全文核验：`readStream` 打开的原生读流在 `onEnd` 后**没有 `stream.close()`**（也没有
`finally`），而 `onError` 路径直接 `reject` 同样不关。对照组齐全：同区 `db-backup.service.ts:75-84`
的 `writeStream` 就做了 `try/finally { await stream.close() }`。每次云同步 push/pull 至少泄漏一个 fd，
长期使用撞 fd 上限。修法：`try { … } finally { await stream.close().catch(() => undefined) }`。
置信 confirmed。

**AM-9 | P2 | `services/vfs-zip.service.ts:119-145`**
导出走 `zipSvc.export()` 返回完整 `Uint8Array` → `bytesToBase64()` → 一次性 `writeFile`，三段都在
JS 堆里（峰值约为库体积 2.4 倍）。同区 `db-backup.service.ts:37` 明写「大备份（数十～上百 MB）
禁止整包读入 JS / base64 往返」并为此实现了 `writeBytesToFileChunked`（256KB 分块 + writeStream）
——**同区自相矛盾的纪律**。导入侧 `pickZipFileBytes` 无 `maxBytes`，对照组
`vfs-character-card.service.ts:32` 明确传了 `CHARACTER_CARD_MAX_INPUT_BYTES`。导出大工作区时
Hermes 上有 OOM 风险。修法：把 `writeBytesToFileChunked` 提到 `rn-file-io.ts`/`document-io.ts` 共享；
导入侧补 `maxBytes` + `buildTooLargeError`。置信 confirmed。

**AM-10 | P2 | `services/chat-prompt-tokens.service.ts:454-470`**
token chip 的**最坏路径兜底**做了三件重活：(a) `listBySession` 不带 limit，整会话历史（含 hidden 行）
拉进 JS；(b) 拼成巨大 `role: body` 串再 `countTextWithDefaultEncoding`（本文件自己的注释标了
「~5.8s 级原生整串计数」）；(c) 紧接着**再次调 `buildSessionPromptInput`**——而那正是刚刚失败的
函数。build 失败时不是降级到便宜口径，而是把 build 整条链再跑一遍 + 一次全量历史拉取；若失败原因
是稳定性的，每次刷新都踩。修法：兜底只做**有界**读（`listBySessionTail(sessionId,{limit:200})`）+ (b)；
模型标签复用上次成功的 `savedModelId`（缓存 ref），不重调 build。
置信 confirmed。**跨簇**：属 W3「全量读」横切主题（`raw/w3-xc-fullread.md` P0×2 的同族），
严重度请 synth-core-runtime 统一校准（core-service-agent 已提示 852/1201 两处**非热路径**，
本条是 chip 刷新链、频率介于两者之间）。

**AM-11 | P2 | `services/session-prompt-input.service.ts:161-170`**
`SessionPromptInputBundle.input` 被算出来但**两个消费方都不取**（`chat-prompt-tokens.service.ts:139`
解构 `{definition, layout, ctx, rawMessages}`；`prompt-preview.service.ts:66` 解构 `{layout, ctx}`）——
提示词 token chip 每次刷新白付一次完整 prompt layout 序列化，而该文件 `:70-71` 的注释正是为了
治「build 挂钟 18.9s」加的分段弃权。修法：改懒 getter 或直接移除（core 的
`resolveCurrentPromptTokens` 走 `serializePromptLlmInput` 自行序列化）。**改动前须确认 core 侧
无通过该字段消费**——本条只核了 mobile 侧两端点。置信 confirmed（mobile 侧）/ 待核（core 侧）。

**AM-12 | P2 | 层级逆反 3 处**
`components/charts/PieChart.tsx:22` 与 `components/sheet/MetricDetailSheet.tsx:15` 反向 import
`@/screens/stack/token-usage/*`（reduce 已核验这两行，且 `SummaryTab.tsx` 又 import `PieChart`
→ 构成 `components → screens → components` 环）；`screens/stack/SubagentSessionScreen.tsx:41-42`
反向 import `@/screens/tabs/chat-tab/{chat-link-nav,useInterruptedPartialCommit}`，把 W1(chat-tab)
与 W2(stack) 两域在编译期绑死。Metro 能跑（无 ESM 环检测），但 RULE「模块级 import 的
require-cycle 只在依赖解析顺序变化时才炸，worktree 没炸主仓炸」有真实事故前科。
修法：`hitRate`/`formatHitRate` 下沉（desktop 侧已有同名同实现的 `shared/logic/hit-rate.ts` 可一并
对齐）、图表样式移 `components/charts/styles.ts`；chat-link 两模块上提到 `services/` 或
`components/chat/`。置信 confirmed（import 图已核）。
**跨簇**：`raw/w3-xc-dup-ends.md` 已把「mobile 2 个真环」计入全仓 5 真环并给了修复包
（BUILTIN_SKILL_NAMES 下沉 + web/shared/post 抽共享）——**归口在 synth-core-misc，本条不重复计入
环计数**，只保留「层级边界」视角。

**AM-13 | P2 | `src/web/tsconfig.json:8` + 2 处已命中**
```
"lib": ["ES2018", "DOM"],     // 无 "types"
```
`compilerOptions` 没设 `types` → TS 自动纳入 `node_modules/@types/*` 全集，而 reduce 已核验
`node_modules/@types/node/index.d.ts:1394` 写着 `/// <reference lib="es2020" />`（旁证：
`@types/node` 头部注释「These definitions support Node.js and TypeScript 5.8+」）——**ES2020 lib 被
无条件拉进来，`lib:["ES2018"]` 的限制完全失效**。已命中的两处（reduce grep 实测）：`web/chat-transcript/
stream/block-split.ts:42 line.trimStart()`（该文件头 `:18-19` 自述「es2018 兼容：禁 lookbehind 等
新正则特性」，但 trimStart 是 ES2019 API；esbuild 不做 API polyfill，老内核上直接 `TypeError`）、
`web/rich-document/webview/runtime/annotate-collect.ts:132-133 trimStart/trimEnd`。
即 RULE:73 的「按老浏览器环境写」纪律**当前纯靠人肉 review，无任何类型层兜底**。
修法：`web/tsconfig.json` 加 `"types": []`（本区不依赖 Node 全局）→ 加完这两处立即报红，就地换成
`replace(/^\s+/,'')` / `replace(/\s+$/,'')`。置信 confirmed（@types/node 源码行 + grep 实测）。

**AM-14 | P2 | `src/webview-host/chat-transcript/{scroll.ts, menu-overlay-guards.ts, stream-tail-html-state.ts}`**
三个文件头自称「真源」，reduce 已全仓核验消费面：

| 声称的共享真源 | webview 实际用的 | 判定 |
|---|---|---|
| `scroll.ts:38 scrollTopForOffsetFromBottom` | `runtime/render/snapshot.ts:10,261,272,340,435` | **唯一真被用** |
| `menu-overlay-guards.ts:25 shouldIgnoreMenuOutsideDismiss` | `runtime/menu/menu.ts:194-201` 逐字重写 | 分叉，测试只测前者 |
| `scroll.ts:21/61 offsetFromBottom`/`clampScrollTop` | `runtime/scroll/scroll.ts:10-27` 同名、签名改成吃 DOM 元素 | 分叉，测试只测前者 |
| `stream-tail-html-state.ts:5 nextStreamTailHtmlField` | `runtime/stream/stream.ts:566-579` 内联重写 | 分叉，测试只测前者 |
| `menu-overlay-guards.ts:13 shouldCancelLongPressForMove`、`scroll.ts:30/50 scrollTopForBottom`/`scrollTopAfterPrepend` | 无 | 纯死代码 |

约 150 行「共享真源」+ 三份单测，**测的都是没人在跑的那份**：按「真源」口径改共享文件零效果，
webview 内联那份改了测试照样全绿。**方向二选一（这是本簇最需要人拍板的一条，见争议 1）**：
① 删死函数、让 webview 侧 import 真源（`scrollTopForOffsetFromBottom` 已证明这条路通）；
② 若刻意保留 DOM 版作「webview 侧适配」，把「真源」措辞改成「RN 侧历史实现」并给死函数标
`@deprecated`。置信 confirmed（消费面全仓核过）。

**AM-15 | P2 | `storage/chat-composer-draft.ts:18`**
```
const bySession = new Map<string, ChatComposerDraft>();
```
进程级草稿 Map 无上限、无删除链路清理（`clearChatComposerDraft` 只在发送成功时调）。会话删除后
草稿正文长期驻留。对照同族 `chat-session-view-cache` / `chat-list-scroll-cache` /
`chat-transcript-scroll-cache` 三个都接了 `createScopeKeyCache`（500 LRU + `clearByProjectPrefix`）
并被删除链路调用——**composer 草稿是唯一的例外**。修法：改 `createScopeKeyCache<ChatComposerDraft>`，
并在 `handleDeleteSession`/`deleteSelectedSessions`/`handleDeleteProjects` 补清理
（`clearChatComposerDraft` 已导出且接受可选 sessions 参数，不传即只清内存）。置信 confirmed。
**归并自 `raw/w2-mobile-runtime.md` F-16（P3）与 `raw/w3-xc-cache-apps.md` F-6（P2），取高。**

**AM-16 | P2 | WebView 导航守卫 4 份逐字重复（安全关键）**
`shouldStartLoadWithRequest` + `handleOpenWindow` 这一对**只放行包目录内 file:// 加载**的守卫，
reduce 已核验 4 处定义：`components/vfs/RichDocumentWebView.tsx:344`、
`components/vfs/CodeEditorWebView.tsx:192`、`components/chat/ChatTranscriptWebView.tsx:1782`、
`components/chat/ComposerInputWebView.tsx:417`——含同样的注释块「sec/D-1」。任何一次安全收紧
（如加 `blob:`/`data:` 拒绝）漏改一处就是一个 WebView 后门。修法：抽
`webview-host/shared/webview-nav-guard.ts` 导出 `makeShouldStartLoadWithRequest(pkgDirUri)` +
`handleOpenWindow`，四处共用。置信 confirmed。

**AM-17 | P2 | `screens/stack/AboutScreen.tsx:88-93` + `:130`**
`catch` 块里的 `await persistFailedUpdateCheck(appUi)`（KV 写）自身抛错会把原始错误顶掉，并让
`void runManualCheck()` 变成未处理 rejection——用户点「检查更新」**完全无反馈**（连失败 toast 都
没有）。对称地，成功分支的 `await persistUpdateCheckResult` 若失败会被同一 catch 捕获并把状态标成
`'error'`，即「网络检查其实成功」被显示成「上次检查失败」。修法：持久化包 `.catch(()=>undefined)`，
`void runManualCheck()` 处补兜底。置信 confirmed。

**AM-18 | P2 | `screens/stack/SessionDetailScreen.tsx:254-255`**
```
onSubmitEditing={() => commitTitle(titleDraft)}
onEndEditing={() => commitTitle(titleDraft)}
```
RN 的 TextInput 回车提交时两个回调都触发，闭包里 `sessionTitle` 是本次 render 的旧值，两次都满足
`next !== sessionTitle` → **两次 `sessions.rename` + 两次 toast + 两次
`DeviceEventEmitter.emit('session-renamed')`**，且第二次与第一次并发（未 await）。数据幂等不脏，
但多一次 RPC + 双 toast。修法：`commitTitle` 内加 `renamingRef` in-flight 守卫，或只在
`onEndEditing` 承担唯一提交点。置信 confirmed（行为是 RN 语义，reduce 未做真机复现）。

**AM-19 | P2 | `hooks/useFocusListReload.ts:47-68` + `screens/stack/ChatHistorySearchScreen.tsx:141-190`**
通用「聚焦即重载」hook（6 个屏复用）**没有任何请求序号守卫、也没有卸载/取消守卫**（reduce 已读
`reload` 全文确认）。聚焦重载高频触发，而 `ProviderDetailScreen` 的 fetcher 先 `providers.get` 再
`providerModels.savedList`、`SkillsSettingsScreen` 对每个项目串行 `listSkills`——慢的旧请求晚于新的
落地就把新数据覆盖回旧。对照组：同仓 `TokenUsageStatsScreen.tsx:130-141` 明确实现了
`reloadSeqRef` 守卫并注释「过期响应后到整体丢弃」，说明模式被认可、只是通用 hook 漏了。
搜索页同款（`append:true` 与新查询并发时旧 append 会把不属于当前筛选的行混进列表，且无刷新按钮、
污染留到下次查询）。修法：加 `seqRef`（`++seqRef` 后落地前比对）+ unmount 保护。
置信 confirmed（hook）/ suspected（搜索页跨请求竞态未复现）。

**AM-20 | P2 | `theme/ThemeProvider.tsx:34-64` + `storage/app-ui-keys.ts:40`**
主题真源有**两处不一致的回退**：`APP_UI_DEFAULTS[APP_UI_KEY_THEME] = 'light'`，而 ThemeProvider
自己在 key 缺失时走 `system === 'dark' ? 'dark' : 'light'`——「设备暗色但从未手动切过主题」时
AppUi 层声明 light、实际给 dark。且 `loaded` 标志（`:32/:53/:89`）**全仓零消费者**（reduce 已核：
grep `useTheme()` + `loaded` 无结果）→「加载完成前用哪个值」根本没被处理，首帧恒为 light
（`:31 useState<ThemeMode>('light')`），**暗色用户每次冷启动闪一下白**。修法：ThemeProvider 读
`APP_UI_DEFAULTS` 而非内联字面量；首帧初值改 `'system'` 或直接取 `useColorScheme()`，消费方按
`loaded` 决定是否渲染（或删 `loaded`）。置信 confirmed。

**AM-21 | P2 | `components/vfs/VfsFileManager.tsx:997-1006`**
三个 badge 配色里两个**硬编码浅色**（`#dbeafe` / `#fef3c7` + `#92400e`），不随 `tokens.mode` 变化。
暗色模式下 `#0A84FF` on `#dbeafe` 约 2.3:1，低于 WCAG AA 4.5:1。另 `badgeColors` 在 `:1151` 与
`:1159` 同一处渲染被调用两次、每次新建对象。修法：三档 badge 色补进 `theme/tokens.ts`（亮暗各给值），
渲染时算一次存局部变量。置信 confirmed（对比度为按 hex 计算，非实测取色）。

**AM-22 | P2 | `components/agent/agent-editor/useAgentEditorFormState.ts:278-290`**
`savedBaseline` 是**手拼的第二个快照**，与 `:220 formSnapshotJson(form)` 是同一函数的两处独立调用点，
但入参对象由人工枚举。core 侧 `AgentEditorFormInput` 增删字段（本迭代已加 `description`）这里漏一个
→ 打开即 `isDirty=true`，用户看到「有未保存的更改」却什么都没改；反向漏字段则「改了但提示不出」。
同文件 `:115-144 formStateFromDefinition` 已把「def → 全量表单状态」收敛成单源，本函数却绕开它
另拼一份。修法：baseline 改用 `formSnapshotJson({...formStateFromDefinition(def), modelEnabled,
providerId, savedModelId, toolsMode, toolsSelected})`。置信 confirmed。
**跨簇**：`AgentDefinitionEditorForm`（1048 行整文件死代码、双源）由 `raw/w2-desktop-features.md`
F-1 认领（status.md 已实锤），归 synth-apps-desktop；本条是**活的那一半**的内部双源，勿混。

**AM-23 | P2 | `web/chat-transcript/styles/transcript.css:311,402,475-482` + `:38`**
`.tool-phase-bar` 生产零产出方（只有 `e2e/pageobjects/chat-transcript.page.ts:180,214` 与
`e2e/specs/chat.tool-phase-and-order.e2e.ts:45,52` 轮询它，且有 `if (hasPhaseBar)` 软守卫不会红 →
**一段永不执行的断言**，与 RULE:82「恒真的断言是废断言」同类）；`.vfs-turn-row`/`.vfs-turn-bubble`
连 e2e 都没有，纯 CSS 孤儿（对应 user ops 操作日志行，RULE:12 记载已整体拆除）；`.row.tool` 同。
Preact 侧 `MessageRow.tsx:119` 只产出 `row message <role>`、`TranscriptRow = MessageRow`，结构上
不可能再冒出这些类。修法：删四处 CSS；e2e phase-bar 段整体移除（是否一并删 e2e 归 e2e 机位）。
置信 confirmed（全仓 git grep 实测）。

### P3

**AM-24 | P3 | 三个 WebView 组件零 unmount 清理（校准自 P2）**
`ChatTranscriptWebView.tsx` 的 17 个 `useEffect` **零个返回清理函数**（`git grep "return () =>"`
在该文件零命中），`snapshotDeferTimerRef`（`:1033 setTimeout(...,0)`）与 `streamRafRef`（`:673/:730` RAF）
在卸载时不取消；`ComposerInputWebView.tsx`（6 个 effect）、`CodeEditorWebView.tsx`（3 个）同样零 cleanup。
**校准理由**：xc-cache-apps 自陈「请 reduce 按危害而非未来风险定级」——所有待清句柄都是
「下一宏任务/下一帧」级，且回调体有 `webReadyRef` + `webRef.current?.` 双重守卫，**当前不可观测故障**；
`repaintEpoch` 重挂那条潜在路径恰好被 `webReady` 翻 false 挡住（属「靠巧合安全」）。
定 **P3**，但作为三个 WebView 组件的公共骨架基线缺口记录。修法：顶层加统一 unmount effect 取消
两个句柄（RN 的 `cancelAnimationFrame` 全局可用，`:498` 已在用）。置信 confirmed（无 cleanup 属实）。

**AM-25 | P3 | 死文件 / 死导出清理包（12 项，交 synth-dead 权威清单）**
reduce 已逐项 git grep 核验「零生产引用」：`components/chat/{flush-run-ui.ts, tool-turn-actions.ts,
transcript-selectable-role.ts}`（整文件三死；`flush-run-ui` 与 `tool-turn-actions` 仅被
`apps/mobile/__tests__/` 两个测试文件引用，`transcript-selectable-role` 连测试都没有）、
`components/batch/ListBatchBar.tsx`（功能已被 `ManageHeader.tsx:74-128` batchMode 分支完整覆盖）、
`components/icons/TabIcons.tsx` 的 `AgentTabIcon`/`ZipExportIcon`/`ZipImportIcon`、
`components/skills/skill-ui.ts:33-41 skillDomainHintLabel`、
`components/vfs/vfs-row-mapper.ts:210-213 mapVfsFilePath`（已 @deprecated，唯一消费者是该文件自己的测试）、
`components/errors/format-error.ts:83-86 formatVfsError`（+ `src/vfs/errors.ts:4` 的 re-export）、
`hooks/useStreamTailGenerating.ts`（整文件 13 行空壳）、
`navigation/HeaderContext.tsx:32-58` 的 `chat`/`setChat` + `navigation/types.ts:92 ChatHeaderContext`
（真在用的是另一套 `ChatTabNavContext`，且 `chatSubview` 字面量还不同：`'sessions'|'conversation'`
vs `'list'|'conversation'`）、`utils/session-default-title.ts:4 DEFAULT_SESSION_TITLE_PREFIX`、
`db/connection.ts:19-22` re-export 的 `getMobileDatabaseFilePath`（同步版，所有实际读路径都走 async
的 `resolveMobileDatabaseFilePath`）。
**校准说明**：status.md 裁决 2 已放大——`transcript-selectable-role` 与 `tool-turn-actions` 的
**desktop 副本同死**（双端成对删除），`flush-run-ui` 的 desktop 副本是**活的**
（`conversation-abort-retain.ts:7` 在用，reduce 已核验），只死 mobile 半边。本条只做 mobile 侧清单，
desktop 侧归 synth-apps-desktop / synth-dead。置信 confirmed。

**AM-26 | P3 | 回调身份不稳定族（8 处）**
`useChatTabMessageActions.ts:503`（`handleMessageMenuAction` 依赖数组里 6 项未被引用，任一变动白重建）、
`ChatComposer.tsx:527`（未用的 `canResumeWithoutInput`）+ `:416-421 executeRun` 依赖 `scope` 对象而
`ChatConversationPanel.tsx:284` 每次渲染新建 `scope={{projectId,sessionId}}` 字面量 →
`executeRun`/`send` 每次渲染必重建、`ChatTranscriptWebView.tsx:983/:1088/:1172/:1318/:405` 同族、
`ChatTranscriptWebView.ts:414 transcriptListOptions` 每渲染新建裸对象被 5 个 useCallback 当依赖
（导致 `useImperativeHandle` 产出的 handle 每次换身份）、`useChatTabController.ts:86,104,118,127,141,172`
六个 useCallback 以整个 `ctx` 为依赖而 `ctx` 的 useMemo 依赖含每渲染换引用的对象、
`hooks/useBatchDeleteConfirm.ts:29-51` 的记忆化被三个调用点的内联箭头函数系统性破坏。
文件内已有局部缓解（`useChatTabController.ts:23 snapshotSignalRef`、
`ChatTranscriptWebView.tsx:1055 sendSessionSnapshotRef`）说明已被识别但只修了一处。
置信 confirmed。

**AM-27 | P3 | `services/document-io.ts:47`**
临时文件名不含随机/时间戳，直接用 `options.fileName`（`db-backup.service.ts:40` 固定传
`nmbackup.db`、`yaml-shared.ts:28` 传 `${agentId}.agent.yaml`、
`smart-sort-rule-yaml.service.ts:17` 传 `smart-sort-rules.yaml`）。两个并发导出会写同一临时文件 →
内容互相覆盖 / 对方 finally 提前 unlink。对照：同区云同步临时文件正确用了 `Date.now()` 后缀
（`cloud-sync.service.ts:171`）。修法：`tmpPath` 加 `-${Date.now()}` 后缀（`saveDocuments` 的
`fileName` 仍传原始名）。置信 confirmed。

**AM-28 | P3 | `services/agent-create.ts:34`**
agentId 用 `Date.now()` 毫秒时间戳，同一毫秒连建两个会撞 id（`upsert` 静默覆盖前一个，用户丢配置）。
正例：同区 `cloud-sync-config.store.ts:118 generateCloudSyncDeviceId()`（UUID v4 + 手写 hex 回退）。
修法：改 `crypto.randomUUID()`（回退实现可直接复用）。置信 confirmed（形态；撞车概率低，未真机复现）。

**AM-29 | P3 | `db/connection.ts:96`**
`initPromise` 只在 `closeMobileConnection()` 里清空。`open` 或 `bootstrap` 抛错时它保留为一个
**已 reject 的 promise**，此后 `getMobileConnection()` 都复用同一个 rejection。boot 失败走错误屏 +
`retry()`（`novel-master-context.tsx:153-155` 递增 `bootToken` → `bootToken>0` 分支调
`closeMobileConnection()` 复位）所以实际可自愈；但 `db-backup.service.ts:140` 的
`importDatabaseBackupFromPath` 在导入链里直接 `await getMobileConnection()`，会拿到「上一次 boot 的
错误」而不是新错误，误导排障。修法：`initPromise` 加 `.catch` 分支复位（置 undefined 后 rethrow）。
置信 confirmed。

**AM-30 | P3 | `runtime/create-mobile-runtime.ts:149-151`**
`setTimeout(() => { ensureLlmFetchConfigured(); }, 0)` 把 LLM 传输注册推迟到下一宏任务。
`setup-llm-fetch.ts:24` 的 `configured` 是进程级**单向闩**——一旦并发调用两次 runtime 工厂
（retry 时序极端或未来多 runtime），第二次直接 return 不会补注册。当前单一 boot 路径实际无碍。
修法：直接在 return 前同步调用（该函数本身无 await）。置信 confirmed（形态）。

**AM-31 | P3 | `services/session-stream-unit-manager.service.ts:1971-1973`**
`dispose()` 末尾先 `notifyChanged()`（遍历 `listeners` 逐个调用）后 `listeners.clear()`——顺序反了。
dispose 期间 React 树可能已在卸载，订阅者回调打到半死状态；`notifyChanged` 内还会白跑一次
`listCalibratableSessionIds()` 全表遍历。修法：`this.listeners.clear()` 提到 `notifyChanged()` 之前。
置信 confirmed。

**AM-32 | P3 | `services/blob-binary-normalization.service.ts:111-115`**
sibling `message-content-compaction.service.ts:93-99` 做了条件复位（循环收手时
`if (scheduledRuntime === runtime) scheduledRuntime = undefined`），本文件没有——循环无论 done /
stalled / 抛错收手，`scheduledRuntime` 永久留在该 runtime 上，将来补「同一 runtime 再次挂载」的
路径会静默 no-op。修法：与 sibling 对齐加 `.finally()` 条件复位。置信 confirmed（对照 sibling）。

**AM-33 | P3 | 模块级 per-session Map 无上限/无清理（4 处）**
`services/chat-prompt-tokens.service.ts:230 preciseUpgradeInflight` / `:247 preciseUpgradeQueued` /
`:256 sessionRefreshGen`（体量小，每会话一个数字）、`services/agent-finished-notification.ts:35
lastFailedNotifyAt`（reduce 已核验该 Map 定义）。会话删除时无任何清理点（`forgetSession` 也没覆盖它们，
见 AM-1）。与 AM-1 同源但**独立可修**：建议随 AM-1 同批补清理，或给它们套 `scope-key-cache.ts`
的现成 LRU 工厂。置信 confirmed。

**AM-34 | P3 | `services/snapshot-complete-signal.ts:52-58`**
`waiting` 是**单槽**。两个 `consumeNext` 并发进入时第二次覆盖 `waiting`：第一个等待者的 `resolve`
被丢弃且其定时器只会在 `waiting != null`（指向第二个）时触发 → **第二个被错判 'timeout'，第一个的
promise 永不 settle**（永久悬挂）。当前唯一消费方 `useChatTabController.ts:23` 是单例 ref + 单条回滚链，
暂不触发，属埋雷。修法：改 `Set<() => void>` 集合全放行；或在类型上写死「同一信号盒不得并发消费」。
置信 suspected（控制流缺陷逐行确认，并发形态当前 UI 不可达）。

**AM-35 | P3 | `web/code-editor/webview/runtime/theme.ts:31-53` 与 `styles/editor.css:33-58` 双源**
`.cm-gutters`/`.cm-gutterElement`/`.cm-activeLineGutter`/`.cm-activeLine`/`.cm-cursor, .cm-dropCursor`/
`cm-focused .cm-selectionBackground` 一整组规则在 `EditorView.theme({...},{dark:false})` 里又完整写了一遍，
值逐条相同，两处都没有「另一处是同源镜像」的单源注释。今天无视觉差异，但改一处忘另一处的层叠结果
取决于 CM 注入顺序，排查成本高。修法：给 `theme.ts:7 editorTheme` 加同源注释，或让 theme.ts 只保留
CM 必需项、视觉项全交给 css。置信 confirmed（两处逐条比对）。

**AM-36 | P3 | `web/code-editor/.../language-for-path.ts:5-14` 无出处声明**
只有 `.md/.markdown` 与 `.json` 有高亮，其余全无。`apps/mobile/package.json:84-85` 只装了
`@codemirror/lang-json` 与 `lang-markdown` → 这是**依赖层面的取舍**、不是漏配；但代码里没有任何注释
声明这是范围决定，下一个改这里的人会以为 `.ts` 高亮是漏了。修法：函数头补一行范围声明。
置信 suspected（依赖侧是事实，取舍动机无出处，RULE 无对应条目）。

**AM-37 | P3 | `web/chat-transcript/.../render/snapshot.ts:240-248` 隐性耦合**
`applySnapshot` 在会话切换/非 preserve 时整体重置 `state.stream`，但**没有**调
`resetStreamBlockRenderState()`（块级渲染态是 `stream/stream.ts:19-23` 的模块级单例，只由
`streamReset`/`streamCommit` 两条桥消息复位，而 RN 侧只在「上一轮流确实 active」时才发
`streamReset`（`ChatTranscriptWebView.tsx:1255-1259`）。mobile-web 逐路径推演后结论是**当前没有
可复现的缺陷**（三条理由：每轮流必过 streamCommit；首激活那次 streamBlockCommit 必带尾块载荷把
累积洗掉；同一次 split 内多 commit 同步连发插不进 350ms 升级定时器）。报的是**隐性耦合**：
块级渲染态的复位责任全压在「RN 必须发 streamCommit」这个跨仓约定上。修法：在 applySnapshot 的重置
分支补一次幂等的 `resetStreamBlockRenderState()`，把责任收回 web 侧。置信 suspected（当前不可复现）。

**AM-38 | P3 | `screens/stack/SubagentSessionScreen.tsx` 三处**
① `:51 SUBAGENT_TRANSCRIPT_HANDLE_ID` 是**模块级常量**，而 attach/detach 的键是
`(sessionId, handleId)`（`:144`）——主会话→子会话→孙会话用 `navigate` 会**再 push 一层**而非
replace，两层都 attach 同一个 handleId；是否冲突取决于 manager 注册表键实现（**未核**）。
② `:60,86,138,243` 四处仍判 `== null`，而 `types.ts:80-84` 保证三者非空——冗余防御遮住真正的空值风险。
③ `:117-118` 的 eslint-disable 依赖 `[sessionId, hasUnit]`，`hasUnit` 从 true→false（单元出表）
会**再全量水合一次**消息，与注释「后续刷新由投影自驱」有张力，且此时显示已由
`unitView.messages` 接管（`:263`）。修法：handleId 改按 sessionId 生成（或核 manager 键后确认安全）；
清冗余判空；收窄 hasUnit 依赖或补注释。置信 suspected（三处机制成立，触发条件未复现）。

**AM-39 | P3 | `screens/stack/SkillsSettingsScreen.tsx:419-423`**
`keyExtractor` 拼了 `index`，与同文件 `:167-170` 精心设计的稳定 `rowKey`（`global:name` /
`projectId:name`）自相矛盾。列表插入/删除/重排后同一行 key 会变，FlatList 的 item 复用与
`removeClippedSubviews` 行为退化；分组数据每次 reload 重建、顺序还依赖 `runtime.projects.list()`。
修法：直接用 `rowKey(entry.row)`（头以 `header:` 开头、行以 `global:`/`projectId:` 开头，不会撞）。
置信 confirmed。

**AM-40 | P3 | `screens/stack/ModelSamplingScreen.tsx:94-98`**
模型已删除时只 toast 并 `return`，不 `goBack()`，屏继续渲染空白表单（`modelName` 空、
`contextWindowTokens` 空），用户点保存只会得到「模型名称不能为空」。同文件对「缺 savedModelId」
是 `goBack()`（`:129-134`）、对加载异常也只 toast（`:118-121`）——三种失败出口三种待遇；
`ProviderDetailScreen.tsx:147-152` 的「缺参即 goBack」更一致。修法：统一失败出口。置信 confirmed。

**AM-41 | P3 | `screens/stack/CloudSyncProgressScreen.tsx:83-97`**
`BackHandler` 是进程级全局、多 handler 按注册倒序串行，本屏 handler **不判
`navigation.isFocused()`**。同屏同步完成瞬间（`runningRef` 翻 false 与 `navigation.goBack()` 相邻，
`:136-137`）存在极短窗口，下层 VFS 屏的返回可能被本屏这次 false 放行走掉。先例：
`hooks/useVfsBackNavigation.ts:41-53` 就因此加了 `isFocused` 判断。修法：handler 首行加同样判断。
置信 suspected（窗口极窄，未复现）。

**AM-42 | P3 | `screens/stack/SessionDetailScreen.tsx:184-195` 事件双发**
压缩成功时 `session-transcript-changed` 被广播两次（`onSucceeded` 一次、`onFinally` 里
`outcome.ok` 又一次）。两处都带「刻意」注释，区别只是时序（预热落定前后各一次）。后果：聊天页
订阅方重复 reload 整个转录。修法：若订阅侧已去重则标 intentional 并在两处写明，否则合并为一次
（或带 `reason` 字段让订阅方决定）。置信 suspected。

**AM-43 | P3 | `polyfills.ts:70-81`**
`else if` 分支要求 `Blob` 存在**且** `Blob.prototype.arrayBuffer` 不存在——RN/Hermes 上 `Blob` 存在时
`arrayBuffer` 必然是内建标准方法，故该分支实质不可达；可达的是上面的 `FileReader` 分支，它会
**无条件覆盖**内建的 `Blob.prototype.arrayBuffer`。不是 bug（文件头注释解释了动机：AWS SDK 拿
Blob 响应体时 RN 自带实现可能异常），但「全局猴补 + 死分支」组合且注释没标出不可达性。
修法：给 else 分支加注释说明其为不可达兜底；建议 W3 单开「polyfill 有效性」核实项。
置信 suspected。

**AM-44 | P3 | `screens/stack/GlobalTemplateScreen.tsx:44` / `SkillDetailScreen.tsx:85-92`**
`runtime.physicalVfs()` / `globalMetaVfs()` / `projectMetaVfs()` 在 `create-mobile-runtime.ts:184,187`
里都是**每次调用 new 一个 service 对象**，这两屏在 render body 直接调用 → 每次渲染换新 `vfs` prop
（`scope` 同样每次新建）。`VfsFileManager.tsx:278-285` 已用 `vfsRef` 兜住「引用抖动不触发重查」，
但 `:472-473`、`:576-582` 的多个 `useCallback` 依赖里含 `vfs` → 每次渲染重建、下游 memo 全失效。
修法：两屏 `useMemo` 固定 `vfs`/`scope`；更根本的修法是 runtime 层缓存这几个 service 实例。
置信 confirmed。

**AM-45 | P3 | `screens/stack/ProviderDetailScreen.tsx:77-78` + `:104-106`**
① 注释写「默认『模型管理』」，代码默认 `'config'`（服务商配置），且与 `header-config.ts:23` 的静态
标题「模型管理」叠加 → 用户进屏第一眼看到的与注释宣称的高频页相反。② 在 `useFocusListReload` 的
`fetcher`（纯语义闭包）里做**渲染副作用** `setStackOverride`，且无聚焦/取消守卫；另 `:141-145`
单独挂了一个失焦清空的 `useFocusEffect`，两者靠调用顺序对齐（隐式耦合）。对照
`SearchEnginesScreen.tsx:126-136` 的写法更干净。修法：① 改代码或改注释二选一；② 标题 override 移出
fetcher 改独立 `useFocusEffect`。置信 confirmed。

**AM-46 | P3 | `update-check/{check-for-updates.ts:17, parse-release-tag.ts:9}`**
`TAG_PATTERN = /^v?(\d+\.\d+\.\d+)(?:[-+].*)?$/` 把 `v1.6.0-beta.1` 解析成 `1.6.0`。当前用
`/releases/latest`（`resolve-latest-release.ts:47`，GitHub 默认排除预发布）所以**今天不可达**，但
一旦 GitHub 把预发布标为 latest 或改用 `/releases` 列表，已在 1.6.0 的用户会被告知「有新版本
1.6.0」并下载到 beta。修法：`parseReleaseTag` 显式标记/拒绝 prerelease。置信 suspected
（设计上没覆盖的输入空间，非现网 bug）。

**AM-47 | P3 | `web/chat-transcript/.../render/row-logic.ts:6` vs `rows-click.ts:87-88` 注释矛盾 + core dist 时点**
```
import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';   ← row-logic.ts:6
```
而同包 `rows-click.ts:87-88` 的注释明写「识别与路由在宿主侧单源完成（**webview bundle 不依赖 core**）」。
事实是 webview 确实依赖 core，且 core 的 exports 全部指向 `./dist/**` → **webview 资产消费 core 的
编译产物而非 src**，改了 core 忘 `npm run build -w @novel-master/core` 就会以旧文案静默烧进 APK。
**reduce 核验（修正原报告）**：`packages/core/dist/public/chat.js` 在本 worktree **存在**
（原报告称不存在），且 `apps/mobile/package.json` 的 `prebuild`/`prestart`/`preandroid` 三条钩子
**都已经先 build core**（`prestart:28` / `preandroid:29` 显式列了 7 个包 + `build:webview`），
CI `release.yml:91/:99` 顺序也对。**所以「常规路径会静默吃旧 dist」这一说法被削弱**——残留面只有
「绕过钩子直接 `npm run build:webview`」这一条手工路径。据此**校准为 P3 且风险描述改写**。
仍需修的是那条与代码矛盾的注释。置信 confirmed（矛盾属实）/ 风险面已收窄。

**AM-48 | P3 | `docs/apm/RULE.md:21` 条目指向已不存在的实现**
RULE 术语条目「composer tag 多行闪烁」把根因描述为「胶囊内联在 TextInput 内则不可避免」并指向
`ComposerAtPathInput.tsx`；但该文件现在只是 `ComposerInputWebView` 的 props↔桥消息搬运壳，构成该现象的
TextInput + 内联 span 实现**已整体删除**（高亮分段、原子删、选区真源都在 web 单引擎内）。当前该条目
既不是有效排查入口，也可能诱导后来者去「修」一个不存在的实现。
修法：条目标注「实现已替换、现象是否仍在需真机复验」。**纪律**：worktree 读到的是旧提交版 RULE，
主仓有未提交区（status.md 已注），**改 RULE 只能在主仓、须用户提交，勿在 worktree 里动**。
置信 confirmed（实现已替换是事实；现象是否仍存在未真机复验）。

**AM-49 | P3 | mobile 侧其余可观测项（7 条打包）**
`useChatTabScope.ts:437 currentSession` 只从当前 project 的 sessions 列表找，跨项目切会话的中间帧
得到 `undefined` → `ChatTabNavigationProvider.tsx:53-54` 标题退化成 sessionId（已有 `?? id` 兜底，
不炸、只是闪一下）；同文件 `handleDeleteSession:521-541` 与 `deleteSelectedSessions:564-589` 的
`clearSessionViewCache` 循环体逐字重复只差单条/批量；`ChatTranscriptWebView.tsx:1652` 压缩/置位后
hidden 变化的兜底检测是逐条线性扫描、无预算上限（与同文件 `planSnapshotChunkBounds` 的 256KB/50 条
分片形成反差）；`useChatTabStream.ts:25` 文件名与唯一导出 `useChatTabScrollCache` 不符（该文件已无任何
stream 逻辑）；`ChatSessionListPanel.tsx:406/413/421` 三个徽标样式块逐字相同 + `:103-108`/`:116-121`
同一 `manager.subscribe(sync)` 模式两份复制；`ChatConversationPanel.tsx:317-331` android/ios 两分支除
`AndroidKeyboardClipBody` 包裹外逐字相同；`:381` 的 `disabled: controller.onNavigateRealPrompt == null`
恒为 false（该回调在 `useChatTabController.ts:106-108` 无条件定义）。全部 confirmed，低危。

### 跨簇移交（不在本簇计数，勿重复）

| 本簇观察 | 归口 |
|---|---|
| AM-2 云同步 busy 令牌泄漏的完整链路（含 S3 侧） | synth-cloudsync（w4-cloudsync-pro 已独立撞车） |
| AM-10 token chip 全量读的严重度（热/冷路径分类） | synth-core-runtime（xc-fullread P0×2 同族） |
| AM-12 三个层环的「真环计数」 | synth-core-misc（xc-dup-ends 已给修复包） |
| AM-5 `buildNewSkillDoc` 双端漂移 | synth-core-misc / synth-apps-desktop（xc-dup-ends 已记） |
| AM-25 desktop 侧三死文件副本（2 死 1 活） | synth-apps-desktop + synth-dead（status.md 裁决 2） |
| AM-4 编码损坏的 4 个 core/desktop 文件 | synth-core-storage / synth-apps-desktop（xc-encoding 全仓清单） |
| AM-6/AM-16/AM-21 抽 core 涉及 exports 子路径 + dist 重建 | synth-core-*（成本口径需统一，否则各簇重复评估） |

## 已核为干净（负例，W6 无需复查）

来自 xc-cache-apps 的 7 条负例，reduce 采信并在此登记以免重复怀疑：①
`adoptInterruptedUnit` 不传 `onGraceExpired` 是**正确的**（`settleAsInterrupted:505-512` 明说不启动
宽限定时器，中断现场要常驻到用户重进）；`adoptConsumptiveUnit` 传是对的（要经 finishRun 进宽限）。
② `web/shared/host-message-channel.ts:44 bindHostMessageChannel` 无 remove 是正确的——WebView 页面
生命周期 = 组件生命周期，四个调用方全在 `main.ts` 顶层跑一次。③ `ShellNavProvider` 的
`onAgentStream`/`onWorkspaceMutated` 双路订阅成对，deps 抖动是退订+重订、不是泄漏；旁路订阅本身
**intentional**（RULE:41）。④ `useAgentStream.ts:132` 的 cleanup（clearTimeout + flushUsageNote + off）
**三样齐全且顺序正确**，是全仓订阅清理的样板。⑤ `useAgentStreamMetrics.ts:246` 的 250ms tick interval
清理成对、deps 里的 `rateSampler` 是稳定 ref 单例。⑥ `run-finish-calibration-probe.ts:72` 惰性启停 +
去重排程 + dispose 全清，**实现质量高**。⑦ `session-stream-unit.ts:280` 的两条 timer 由
`destroy():575-590` 在**所有**出表路径清理且幂等，`units` 由 LRU 8 兜底 → 有界无泄漏。
另：mobile-runtime 争议 2 自行推演后**判定无须修**的 `hydrateFromRunState` `startedAtMs=0` 假历时
（`adoptInterruptedUnit` 分支不写 settled 投影，`settleAsInterrupted` 不设 `elapsedMsValue` →
实际不可观测）；争议 3 的 `starting` 单元 finally 兜底不留 settled 行（重启水合识别为中断现场，
符合事实，判可接受）。xc-cache-apps 争议 5 的 `interruptedSessionIds` 对称性缺口推演后**路径闭合**。

## intentional 清单（已核实为有意设计，不作缺陷计）

| 项 | 出处 | 理由 |
|---|---|---|
| `MessageList` 全链路 + `message-blocks.buildChatListItems` | 文件头 + `storage/chat-transcript-engine.ts:13` | `@deprecated` 但由 KKV 开关 `chatTranscriptEngine:'legacy-rn'` **真实可达**，是免重装的回滚线（`ChatConversationPanel.tsx:220/248` 的三元分支就是它）。**不是死代码。** |
| `isDisplayableAttachment` 过滤非 annotate 的 user_ops | RULE 术语条目「user ops（已拆除）」+ 点名本文件 | 展示层丢弃遗留历史附件，原始数据不删 |
| `ChatSessionListPanel` 「· 活跃中」挂 `isRunning` | 注释带日期 + 真机实录编号（GWT-7, 2026-09-30） | 为修「run 收尾 4 分钟仍显示活跃中」「重启后凭空出现」刻意改的 |
| `useChatTabScope.ts:108-128` 切会话同步清 token chip（useLayoutEffect） | 注释标 r4-app-2 | post-paint 的 useEffect 会漏一帧 |
| `ComposerAtPathInput` 双层壳 + `ComposerInputWebView` 受控桥（打字不回写） | 注释标 v1.5.9 | IME 防线（`setSelectionRange` 打断组合态会把光标拽回去），踩过坑的定稿 |
| `highlight-code.ts` 的 `LANG_ALIAS` 双端各存一份 | 注释「与对方保持同一张表（T-CB13 一致性契约）」+ `apps/desktop/test/code-block-render.test.tsx:242` 与 `apps/mobile/__tests__/code-block-render.test.tsx` 两套对称测试 | **拍板的双端契约**。但测试各自断言自己的表、没有跨端比对，「表本身写错」照样双绿 → 建议加一条跨端 fixture 比对断言，把「约定」升级为「机制」 |
| `highlight-code.ts:6-11` 注册 10 个 highlight.js 语言子模块 | 同上 T-CB13 | 同源契约 |
| `RichDocumentWebView.tsx:42-45` 自备「复制」划词菜单 | react-native-webview `menuItems` 语义限制 | 盖掉原生 Copy |
| `components/debug/run-timing.ts` | RULE 明确记载为诊断工具 | `__DEV__` 门控、生产全 no-op、17 处调用点 |
| `PromptMacroTextInput.tsx:5-8` 保留 `splitPromptMacroSegments`/`tryAtomicMacroDelete` | 注释「RN 侧着色链随 WebView 化整体退役」 | 迁移已完成，注释是决策留痕；`atomic-range-delete.ts:10-17` 保留原函数是给等价性对照测试（`__tests__/atomic-range-delete.test.ts:79` 显式断言逐组等价） |
| `file-annotate-gate.ts:13-17` 批注入口门闩「仅 previewMode + session scope」 | RULE 记载小米/HyperOS 上批注不可用是拍板 hold | 不是 bug |
| `mermaid-viewer-gestures.ts:129-134 rebasePanAfterBake` 恒等映射 | 注释自陈「几何上是恒等，独立成函数是给坐标系锁定断言留挂点」 | 刻意测试挂点，勿当冗余删 |
| `rich-document/styles/document.css:84-124` 批注三组样式 | 文件头「非主路径遗留，保留仅为存量 class/旧 HTML 不崩，禁止新代码依赖」 | `::highlight()` 在老内核整条被忽略（降级不崩），与「按老浏览器环境写」口径一致 |
| `shared/decode-entities.ts` 两个零消费导出 | 文件头「须与 RN `decode-literal-html-entities.ts` 语义对齐」+ parity 测试 | 存在理由就是让 parity 测试能断言两侧一致 |
| `ToolGroup.tsx:39 console.warn` | 注释「file:// 环境无 process.env，所以不加 dev 守卫」 | 现状是刻意诊断手段；建议加模块级一次性计数，别按 render 次数刷 |
| `apps/mobile/android/app/build.gradle` 的 GBK 编码 | RULE:105 明文拍板 | 但已**二次 mojibake + 残留 `&#65533;`**，越过 RULE 记录状态再退化一层 → 交 RULE 维护者，本批不动 |
| `db-file-path.ts:38-79` 保留 quick-sqlite 旧布局候选 | RULE「TDBC 驱动层」 | quick-sqlite 是保留的回滚线，回滚即需按旧布局定位库文件 |
| `blob-binary-normalization` / `message-content-compaction` 两个后台循环 | RULE「schema migration 清理有约定节奏」 | 谓词驱动，约 10 个 tag 后随迁移退役，现在是生命周期内 |
| 全区无 zstd/brotli/wasm | RULE「移动端 Hermes 没有 WebAssembly」 | 实测零命中，纯 JS / deflate 系 |
| `agent-finished-notification.ts:505-534` 模块级 notifee 注册 | 进程生命周期语义 | notifee 后台事件只能模块级注册一次（9.x 无退订函数） |
| `chat-prompt-tokens.service.ts:393-402` begin/end 四格配对表 | 注释即规格 | reduce 核对 `compaction-warm-orchestration.ts:72/98` 与 `chat-prompt-tokens.ts:441/449` 配对正确，计数 1→2→1→0 成立；建议 W3 一致性扫描单列 |
| `fill-policy-mobile.ts:10 full → hidden` 映射 | 目录规则 fillPolicy 旧值兼容 | 归一函数带 fallback、非破坏性（但与 desktop 归一结果不同，见 AM-5） |
| `TokenUsageStatsScreen` 空态拦全部页签 / `useBatchDeleteConfirm` 部分成功语义 | 文件头写明的定案（需求①勘误后） | 用户定案，不因形态反直觉而报 |
| `RootNavigator.tsx:93-104 withStackLayout` 的 `React.ComponentType` | 现状无害 | 28 个屏确实零 props；建议注释标明「屏一律零 props」这条隐含契约 |
| `web/chat-transcript/.../ui/stream/StreamTail.tsx:11` 引用的 `check-ct-ui-no-state.mjs` | `apps/mobile/scripts/` 实测只有 3 个脚本，该脚本已删 | README:201 已把话改成「纪律保留为代码约定」，但 StreamTail 是三个白名单文件里唯一还引用已删脚本的 → 删那一行与另两份（`MessageRow.tsx:5`/`RowList.tsx:10` 已用修正措辞）对齐 |

## 争议与存疑（上交主代理裁决，本层不抹平）

1. **AM-14 的方向二选一**（webview-host 三「真源」模块）：**接回去**（让 webview 侧 import 共享纯数）
   vs **删掉**（承认它们已是历史实现）。两种修法方向相反。mobile-web 倾向接回去，理由是
   `scrollTopForOffsetFromBottom` 已证明这条路走得通（`snapshot.ts:10` 就在用）；但 `scroll.ts` 里
   那几个是 DOM 形的 webview 版，签名不同、不是纯机械替换，要改 `runtime/scroll/scroll.ts` 的调用面。
   reduce 补充证据（reduce 已核验）：`scrollTopForOffsetFromBottom` 是**唯一**被用的，其余 7 个导出
   零生产消费。**需要人拍板。**
2. **AM-7（VfsFileManager reload 丢弃式去重）的等级**：原报 P1 且自陈无真机复现。reduce 降 P2
   （不丢数据、有绕行）。若主代理认为「删除后列表停在旧快照」属用户可见错误数据，可回 P1；
   建议先过 W6（构造 `vfs.list` 挂起 2s 的用例）。
3. **AM-1 是否整体降 P2**：xc-cache-apps 自陈争议 1——「徽标最多多挂到 LRU 淘汰（≤8 个）」可降 P2；
   mobile-runtime 争议 1 反向主张 P1。reduce **不降级**并给出新理由：`idleMessageViews` 里存的是
   `[...cached.messages]` 深拷贝，**会话删除后用户可见数据仍以内存副本形式留存**（隐私面），
   且这一项的无上限不依赖删除路径（正常浏览即涨）。若主代理仍要降 P2，请保留「加 LRU」这半个修法。
4. **AM-4 的等级**：mobile-runtime 原报 P1，xc-encoding 报 P2。reduce 采纳 P2（损坏全在注释、
   10/10 父版本干净可精确回滚、无运行影响），但把**防再犯闸**单列为 P2 的核心理由。若主代理认为
   「闸门缺失 + 静默累积」本身够 P1，可把 AM-4 拆成两条（损坏清理 P2 / 闸门 P1）。
5. **AM-22 与 `AgentDefinitionEditorForm` 死文件的关系**：`raw/w2-desktop-features.md` F-1 实锤
   `AgentDefinitionEditorForm` 1048 行整文件零 import（死代码），而 `AgentEditorView` 内联同款表单
   构成双源。AM-22 是**活的那一半**（`useAgentEditorFormState`）的内部第二份手拼快照。两者是否应
   合并成「agent 表单单源化」一条，reduce 无权判断（涉及 desktop 侧归属），上交。
6. **AM-6/AM-12/AM-16 的成本口径**：「抽 core」在本仓有实打实成本（25 个 exports 子路径、新增子路径
   要同步 `packages/core/tsconfig.test.json` 的 paths 否则测试静默吃旧 dist、mobile 端必须走 dist
   产物）。mobile-ui 原报告的争议 5 建议「先做同语义两份实现（AM-5）的，再做纯搬运（AM-6 的）」——
   reduce 采纳该优先级建议，但**成本估算本身应在 synth-core-* 层统一一次**，避免每个簇各估一次。
7. **AM-3 的触发条件未真机复现**：错数据路径（详情页 → RealPrompt 拿全局 scope）已读码闭环，
   但「用户在详情页期间全局 scope 被改成别的会话」这一前置条件我是靠 `setCurrentSession` 的 5 个调用点
   推断的，未做真机走查。若 W6 证明该前置不可达，AM-3 降 P2。
8. **两处 reduce 与上游口径不一致、已在正文标注**：AM-47（原报告称 `packages/core/dist` 不存在 →
   reduce 实测**存在**，且 prebuild/prestart/preandroid 三钩子已先 build core，故风险面从「常规路径
   静默吃旧 dist」收窄为「手工绕过钩子」）；AM-25（原报告称三死文件「全仓零引用」→ reduce 实测
   `flush-run-ui` / `tool-turn-actions` 仍被 `apps/mobile/__tests__/` 两个测试文件引用，删除时须连测试
   一起删）。两处均为**下调风险描述**，不改变条目存在性。
