# spec：子会话屏收敛进统一宿主 + chat-transcript 文档壳退役 + CSS 基底 join 化

状态：implemented（2026-10-01 拍板「①②都做，收敛代码」；2026-10-02 fix-cr2 轮收尾回写——代码全量落地，真机验收待窗口）

## 背景与目标

chat-webview-unify 已把主链（转录+输入 dock+会话列表）收进 chat-conversation 单文档。chat-transcript 文档壳仅剩一个渲染场景：**子会话屏（SubagentSessionScreen，子代理会话详情页——只要转录，不要输入框/列表）**。本 spec：

1. 给统一宿主加「转录 only」变体，子会话屏切换过去；
2. 退役 chat-transcript 的**文档壳**（index.html / webview 入口 main.ts / RN 宿主组件 ChatTranscriptWebView(.Handle) / uri 门面 / 构建条目），**保留**其 runtime 库身份（chat-conversation 在引）；
3. 消掉 chat-conversation.css 的基底段手抄（构建期 join transcript.css）。

## 改动面

### A. ChatConversationWebView 加 transcriptOnly 变体

- props 加 `transcriptOnly?: boolean`（memo 比较器补该字段）。
- RN 侧行为：
  - ready 能力协商：init 消息带 `transcriptOnly`（见 C）；ready 回包无 composer-dock 能力位时**不再渲染降级横幅**（横幅条件加 `!transcriptOnly`）。
  - viewState 恒发 `conversation`（视图切换在该变体无意义；子会话屏由 stack 导航进出，不走路由切换）。
  - 划词菜单：该变体由调用方传 menuItems 子集（子会话屏只留复制/全选），协议无需改。
- web 侧行为（init 收到 transcriptOnly=true）：
  - **mount-and-hide（实现回写，2026-10-02）**：dock.mount 与 sessionList.mount 仍全量执行，`#app` 加 `transcript-only` 类（CSS 隐藏 #composer-dock；data-view 固定 conversation）。原 spec 写「装配序跳过 mount」，实现改为挂载后隐藏——ready 闸门（shouldEmitConversationReady）依赖 dock/composer 挂载成功，skip mount 会让子会话屏整页落 8s 错误态白屏；挂载但隐藏在现有闸门设计下是更稳的选择，勿按本文旧措辞「修正」回 skip。
  - dispatcher/dock 域消息无消费者自然 no-op，不改协议。

### B. SubagentSessionScreen 切换宿主

- `ChatTranscriptWebView` → `ChatConversationWebView transcriptOnly`；props 按同名映射（messages/sessionKey/streaming/划词/滚动恢复等）；Handle 用法（如 scrollTo）核对迁移。
- 切词菜单改用统一宿主菜单常量子集。

### C. 协议（ChatConversationBridge）

- init payload 加 `transcriptOnly?: boolean`（v 号不动——新增可选字段，旧 dist 忽略，兼容）。

### D. 退役清单（chat-transcript 文档壳）

删：
- `src/web/chat-transcript/index.html`、`src/web/chat-transcript/webview/main.ts`
- `src/components/chat/ChatTranscriptWebView.tsx`
- `src/webview-host/chat-transcript/uri.ts`
- `scripts/build-webview.mjs` PACKAGES 的 chat-transcript 条目；`android/app/build.gradle:178` 包名单同步
- 相关测试迁移/退役（旧宿主组件测试）

**实现回写（2026-10-02，两处有意保留）**：
- `ChatTranscriptWebViewHandle.ts` **保留**（原列删除）——七方法句柄是 RN/web 两侧共享契约的类型单源（统一宿主 handle 以它为超集），退役组件不退役类型单源；改名收益低于 webview-host/chat-transcript 目录重命名的连带成本。验收口径相应调整（见下）。
- `chat-transcript-selection-menu.ts` 的旧口径常量 **保留并改归属**（原写删）——`CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS` 现作为统一宿主 transcriptOnly 变体的菜单口径（无 dock 时全选/粘贴是死按钮，三项=复制是正确形态），宿主按 `transcriptOnly` 二选一。

### F. 无护栏判路清单（fix-cr2 轮记录，改动时需人工回归）

以下判路的行为代码完整保留在统一宿主内，但**退役迁移后无自动化断言守护**（40 用例退役只补了 6 条最小等价，成本/收益权衡后按「记录不补齐」处置——如需补齐另行立项）：
1. `streamToolInvoking` 上行（webReady 后 toolInvoking 变化通知）——`ChatConversationWebView.tsx` 的 syncStreamToolInvoking。
2. `flagsUpdate` 同值去重（prevSentFlagsRef 比较逻辑）。
3. `T-SUB-CARD`（pendingSubagentSessions 变化 → force 直发快照）。
4. `T-REPAINT`（可见性重挂后 ready 首个快照 force 直发）。

留（runtime 库身份，目录名暂不改——改名牵 web 侧相对路径与 RN 侧 webview-host/chat-transcript/ 常量重导出，收益低）：
- `webview/runtime/**`、`transcript-capabilities.ts`、`stream/**`、`styles/transcript.css`（join 源）
- `webview-host/chat-transcript/{scroll,menu-overlay-guards,anchored-menu-layout}.ts`（RN/web 共用常量）

iOS pbxproj 有五个 index.html 存在性检查，删 chat-transcript 条目需同步（文本编辑，逐行核对）。

### E. CSS 基底 join（推翻 build-webview.mjs:60-61「不做数组 join」决策）

- build 脚本：chat-conversation 的 css 输入改 `[transcript.css, chat-conversation.css]`，拼接顺序 = transcript 在前（保层叠序与现状一致）。
- `chat-conversation.css` 删基底手抄段（头部自述「基底 = transcript.css 全文」的整段），只留增量（dock/列表/转场等）。
- `chat-conversation-boot-script.test.ts` 的「合成包 CSS 覆盖 transcript.css 全部顶层 selector」断言——join 后天然满足，断言保留（防 join 逻辑回归）。**实现回写（2026-10-02）**：断言面已从「源文件差集」移到**构建产物**（T-CC-CSS-13 按 dist 产物 app.css 的 selector 集合断言差集）——join 后合成包源文件本就不含基底 selector，源文件差集会恒空集变永真；产物面断言更强且附带反面用例。

## 验收（2026-10-02 fix-cr2 轮回写）

- 子会话屏：jest 侧已锁——transcriptOnly 变体五条行为断言 + 子会话屏接线哑元断言 + dist 产物两条（fix-cr2-l，101/101 绿）；**真机验收待窗口**（转录渲染/滚动/划词复制/无输入框/无降级横幅的人工过一遍）。
- 全量 jest 绿：2026-10-02 `npx jest --maxWorkers=2` **245/245 套件、1967/1967 测试全绿**（含 fix-cr2 全部新增用例）；build:webview:native 无 chat-transcript 落点：fix-cr2-b pruneDist 实证（三处造残留 → 清理日志 → 复跑全绿）；真机装机冒烟待窗口（与上项同批）。
- 旧组件退役口径（窄判据）：`git grep ChatTranscriptWebView -- apps/mobile/README.md` 为空（fix-cr2-k 清零）；组件本体 `ChatTranscriptWebView.tsx` 已删除（git D 作证）。全仓其余命中（Handle 类型单源 13 处 + 溯源注释 + `__tests__` 迁移痕迹）**豁免**——全仓清零在本迭代不可达，勿作验收。

## 风险

- 子会话屏 handle 命令面若超出统一宿主（滚动命令等），需在统一宿主补 handle——核对后定。
- pbxproj 文本编辑易错——逐行核对，构建失败即回滚该块。
