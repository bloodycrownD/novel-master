---
date: 2026-10-06
---

# 输入框原生化（composer-native-2026-10）技术规格（SPEC）

## 需求来源

非标准 PRD 输入：用户口述（2026-10-06，完整上下文见 `docs/apm/memory/20261005-rn-native-msg-list-brain-storm.md` 第 6~8 轮）。核心诉求与拍板：

1. 聊天页去 WebView 的终态架构已拍板（原生列表 + EnrichedMarkdownText/streamdown 渲正文 + **原生输入框** + mermaid WebView 岛），实施顺序**输入框先行**（用户原话「输入框肯定得做，甚至得一个做，要不然就等于 webview 移除失败了」）。
2. 输入框**改造现成库**而非全自研：基座选 Software Mansion `react-native-enriched-markdown` 的 `EnrichedMarkdownTextInput`（Fabric-only、RN 0.83+、MIT、v1.1.1、极活跃，dev 依赖 pin RN 0.85 与本项目 0.85.3 对口）。
3. 范围边界：转录侧本迭代**不原生化**，仅拆回独立 webview；宏链（`PromptMacroTextInput`）与全屏编辑（`PromptEditorScreen`）继续走 `ComposerInputWebView`，不动；VFS 两个 webview 不动；桌面端零改动。

探索报告（四路并行）摘要见 `cache/explore-summary.md`；本 spec 的变更点均可追溯到该报告中的文件与符号证据。

## 设计目标

1. 聊天页输入框从 chat-conversation WebView 文档内的 dock，替换为 **RN 原生组件**（基于 EnrichedMarkdownTextInput + 本仓 fork 补丁）。
2. 行为对齐基线 = 探索报告 A 的行为清单（A 文本编辑 / B 高度 / C IME / D 选区 / E typeahead / F 粘贴 / G token / H 草稿 / I chips / J 发送 / K dock 布局 / L 主题 / M 禁用 / N 恢复链 / O 划词菜单 / P 键盘 / Q 候选源）；纯函数层（core + RN 既有）**全部保留复用**，行为语义不变。
3. 转录侧拆回独立 chat-transcript webview（新建独立入口，退役 chat-conversation 合成包），为后续「转录原生化」迭代清出地基。
4. 草稿零迁移：草稿存储格式不变（明文 `{text, attachments}`），老草稿水化后胶囊照常渲染。

## 总体方案

### 核心决策

**D1 库的角色 = 「可样式化的原生 TextInput」**。不用库的 mention 流程作为 token 真源——token 语义保持**正则扫描为真源**（现有 `COMPOSER_TOKEN_RE` / `composerTokenRanges` / `tryAtomicRangeDelete` / `scanAtPathAttachments` 体系原样保留）。理由：现有链路（边打字边出胶囊、草稿明文、发送扫描、typeahead 触发）全部建立在「正则扫明文」上，保留它 = 行为对齐风险最小、core 发送管线零改动；库的 mention 生命周期事件（onStartMention 等）不启用。

**D2 fork 补丁两枚（patch-package 交付，非整库 fork）**。补丁对象全部是 npm 包内文本源文件（.ts/.kt）——patch-package 生成/应用纯文件 diff，Kotlin 源就在包内 `android/src/**`、autolink 从该路径编译，打补丁即生效，无需动 Maven；补丁只触源码不碰资产目录，与库自身 postinstall 的资产下载零冲突。
- 补丁一（胶囊视觉），涉及文件（包内相对路径，前缀 `node_modules/react-native-enriched-markdown/`）：
  - `src/types/MarkdownStyle.ts`：`LinkStyle` 加可选 `borderRadius / paddingHorizontal / paddingTop / paddingBottom`（仅 Android 消费，iOS 忽略——本仓只出 Android）；
  - `src/EnrichedMarkdownTextInput.tsx` + `src/normalizeMarkdownTextInputStyle.ts`：新字段透传归一；
  - `android/.../input/styles/LinkStyleHandler.kt`：消费新字段；
  - 新增 `android/.../spans/RoundedBackgroundSpan.kt`：实现取 **`ReplacementSpan`** 子类方案（`getSize` 返回文本实测宽 + paddingH×2，`draw` 画 roundRect 圆角底；纵向按字形 ascent/descent 贴边定界（真机 QA 修正：原「lineHeight 锁定行框 + paddingV 视觉吸收」在部分字体下行框露边/切字，改为按字形实际范围定界）——跨行表现是 Spike 首验证项，ReplacementSpan 不可跨行折断，长 token 溢出处理与行高影响在 Spike 定夺，备选 `LineBackgroundSpan`/MetricAffectingSpan 组合）；
  - 数值：cornerRadius=8dp（真机 QA 修正：4dp 圆润度不足）、paddingH=4dp、paddingV=1dp，色值走主题映射（primary 字色 + primaryMuted 底色）。Web 版 `margin: 0 -4px` 负 margin 技巧在 span 层不可达，接受「胶囊占宽略大于 web 版」的视觉差（真机截图对比时核对）。
- 补丁二（外部 range 注入），涉及文件：
  - `src/EnrichedMarkdownTextInputNativeComponent.ts`：`Commands` 常量加 `setTokenRanges`（参考既有 `insertMention` 命令的注册形态）；
  - `src/EnrichedMarkdownTextInput.tsx`：`EnrichedMarkdownTextInputInstance` 接口加 `setTokenRanges(ranges: Array<{start: number; end: number}>)` 方法，内部走 `Commands.setTokenRanges`；
  - `android/.../input/EnrichedMarkdownTextInputManager.kt`：`receiveCommand` 分发注册；
  - `android/.../input/EnrichedMarkdownTextInputView.kt`：实现——区间转胶囊 span + 并入既有 `deleteLinkBeforeCursor` 原子删路径（与 LINK range 同款整删语义）。
  - RN 侧每次 onChangeText 后用现有正则算出 token 区间下发；这是「边打字边出胶囊」「老草稿水化出胶囊」的统一机制。

**D3 草稿水化路径（零迁移）**：草稿仍存明文；水化 = 读明文 → `composerTokenRanges` 扫描 → 合成 markdown（`@path` → `[@path](nmtoken://path)`，`$skill` 同理 scheme=`nmskill://`）→ `setValue(markdown)`（库原生解析 range）→ 再 `setTokenRanges` 兜底。发送扫描继续吃 `onChangeText` 的明文（库的 LINK range 序列化只用于视觉，不参与发送语义）。
- 说明：依赖库的明文输出形态（onChangeText 对 LINK range 输出 displayText）在 spike 步实测确认；若明文含 markdown 括号残留则改为以「RN 侧维护的文本真源」为准（见 D6），库仅作显示。

**D4 转录拆分**：chat-conversation 合成包退役；chat-transcript 包新建独立入口（index.html + main.ts）。装配方式：`createTranscriptRuntime({bindChannel: true, emitReady: false})`（`bindChannel:true` 与合成包的 `bindChannel:false` 差异是结构性的：合成包有 dispatcher 先绑通道、两 runtime 不再自绑；独立入口无 dispatcher，runtime 自绑；`emitReady` 在 factory.ts 里默认 true，但 runtime 自发的 ready 是 v:1 envelope，宿主只认 v:2，必须显式关掉）——由**入口层自包一条 v:2 ready**（照 chat-conversation `main.ts` 的 `shouldEmitConversationReady` 同法），能力位**不含** composer-dock。chat-transcript 从「合成包的内嵌依赖」升为独立构建包，四件套**增**侧：`build-webview.mjs` PACKAGES 加 chat-transcript 条目（新 index.html/app.js/app.css）、门 B 白名单沿用既有 chat-transcript 组（独立入口新增模块按需入组）、`webview-compat-baseline.json` 的 chat-transcript 条目沿用（棘轮计数若因入口拆分变化，按既有 `--update-compat` 流程抬基线并在 PR 写明）、`build.gradle` checkWebViewAssets 包清单 chat-conversation→chat-transcript 替换（仍 4 包）。

**D4b ChatConversationWebView 剥离清单**（删留明细，行号为 2026-10-06 HEAD 参考位）：
- **删 props**：composer/dock 域 props 组（`:233-275` 一带）——`composerText / composerCursor / composerState 下发组（hasModel/running/error/chips/placeholder/typeahead 候选源/keyboardUp/safeAreaBottom 等）/ onComposerChangeText / onComposerSelectionChange / onDockAction`；`transcriptOnly` 保留（文档仍需 CSS 侧隐藏能力时沿用现机制）。
- **删桥消息**：下行 `setText / setSelection / setDisabled / blur / composerState / composerPaste / selectAll`；上行 `change / selectionChange / dockAction`（`handleUpstream` `:1558-1626` 中对应分支）。
- **删逻辑**：`resetComposerBaselines`、IME 桥侧防线 M2/M4/M5（选区跨桥回声类）、`COMPOSER_PASTE_MAX_CHARS` 桥侧消费、恢复链中 composerState/草稿 setText 两步（恢复链缩为 `init → 快照直发`）。
- **保留**：transcript 12 条域全部、快照分片（`planSnapshotChunkBounds`）、deferred 三通道纪律、visibility 重挂（hiddenAppState 判定）与 repaintEpoch、`key={chatScrollKey}` 重挂、ready v2 握手与 8s 兜底。

**D4c Bridge 收口**：`ChatConversationBridge.ts` 删 composer/dock 域消息类型（上列 10 条）与 `CONVERSATION_CAPABILITY_COMPOSER_DOCK`；**宏链与全屏编辑走独立的 `ComposerInputBridge.ts`（`COMPOSER_INPUT_BRIDGE_VERSION`），与该文件零耦合，不受影响**。

**D5 输入框外围全 RN 化**：新建 `NativeChatComposer` 组件（组件文件结构见下），包含 chips 行 / hintRow / error 行 / toolbar 四钮（⛶ @ $ 发送终止）/ typeahead 浮层（RN absolute View，`onCaretRectChange` + 输入框 `onLayout` 锚定）/ 粘贴菜单定制。候选计算复用 `computeTypeaheadView`（从 web 包迁到 RN 层共享）与 core 纯函数（`findActiveAtQuery` / `filterAtPathTypeaheadCandidates` / `filterSkillTypeaheadCandidates` / `buildTokenInsertion`）。

**D6 打字真源不变**：打字时 RN 不回写 setValue（对齐 A1/C6）；文本真源 = 库内部态，RN 侧持有「最后已知明文」基线（M1 同构），外部写入（Picker 插入 / typeahead 点选 / 草稿水化 / 发送清空）走统一命令式通道（ref 方法 `setText(markdown, cursor?)`，内部推进基线后触发 change 上抛——对齐 M7/F6/E10）。

**D7 高度链**（真机 QA 修正：封顶态动态切）：`scrollEnabled={inputClamped}`——未封顶时自动长高，封顶后转库内部滚动（View 层补触摸拖滚：拖滚激活 `requestDisallowInterceptTouchEvent` + 有选区不激活 + UP/CANCEL 解除拦截），`style.maxHeight=122`（与 `CONVERSATION_COMPOSER_METRICS` 同源常量，从 5 行公式导出）；高度变化经 `onLayout` 上抛，保留 HEIGHT_EPSILON 死区与首帧豁免语义；dock 容器不再需要 80ms withTiming（原生布局当帧生效，动画仅保留键盘 padding 过渡）。

**D8 IME 防线裁撤**：桥消失后，M2/M4/M5（选区跨桥回声类）整体退役；保留 M1（change 先推进基线）、M6（打字真源）、M7（命令式通道）三个语义，实现收敛在 `NativeChatComposer` 内部。中文 IME 组合态下的 setTokenRanges 时序与原子删行为列入 spike 验证项。

**D9 粘贴门控**：库无 onPaste 拦截 → 用 `selectionMenuConfig` 关内置粘贴、`contextMenuItems` 加自定义「粘贴」项回调 RN（复用现有 `uiRunning` 闸门 + `Clipboard.getString` + `COMPOSER_PASTE_MAX_CHARS=256KB` 截断链）；外部粘贴经库的 markdown 解析行为在 spike 实测，若「纯文本被误转 markdown」（如 `- ` 变列表）不可接受，补丁三追加 `plainTextPasteOnly` 开关（在 `pasteMarkdown()` 处短路为纯文本插入）。

**D10 配置与安装**：`apps/mobile/package.json` 加 `enriched-markdown` 块：`enableCodeHighlight:false, enableMath:false, enableVideo:false`（→ 库自身 postinstall 零资产下载，spike 验证）；依赖为 npm 包 + patch-package 补丁（`patches/react-native-enriched-markdown+x.y.z.patch`）。**时序**：npm 安装生命周期先跑各依赖自身 postinstall（此处为空操作）、后跑应用侧 postinstall（`patch-package` 应用补丁）——`npm install` 与 `npm ci` 同序，CI 无需额外步骤；补丁更新流程 = node_modules 内改源 → `npx patch-package react-native-enriched-markdown` 重新生成；版本锁定精确补丁号（`~`/`^` 均不用），升版本必须重生成补丁。非 workspace 包，无需进 release.yml build -w 清单；jest 侧加 `test-utils/enriched-markdown-mock.tsx`（mock 输入组件与 Instance 命令）+ moduleNameMapper + transformIgnorePatterns。

### 最终项目结构

```
apps/mobile/src/components/chat/
  NativeChatComposer.tsx              # 新建：原生输入框组件（输入本体+外围）
  native-composer/
    token-ranges.ts                   # 新建：明文→token ranges→合成 markdown（水化/下发）
    typeahead-overlay.tsx             # 新建：typeahead 浮层（computeTypeaheadView 迁入）
    dock-style.ts                     # 新建：RN 参照常量（对齐 dock-style-reference.ts 数值）
  ChatConversationWebView.tsx         # 改造：剥离 composer/dock 域，纯转录宿主
  ChatConversationBridge.ts           # 改造：删 composer/dock 域消息与能力位
  useChatComposerController.ts        # 改造：回调签名适配 NativeChatComposer（语义不变）
apps/mobile/src/web/
  chat-transcript/
    index.html                        # 新建：独立入口壳
    webview/main.ts                   # 新建：独立入口装配（emitReady v2、无 dock 能力位）
  chat-conversation/**                # 退役删除
apps/mobile/
  patches/react-native-enriched-markdown+x.y.z.patch   # 新建（补丁一/二[/三]）
  test-utils/enriched-markdown-mock.tsx                # 新建：jest mock
scripts（无改动）
docs/Iterations/composer-native-2026-10/   # 本迭代
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `apps/mobile/package.json` | +依赖 react-native-enriched-markdown、+patch-package、+`postinstall":"patch-package"`、+`enriched-markdown` 配置块 |
| 2 | `patches/react-native-enriched-markdown+x.y.z.patch` | 新建：RoundedBackgroundSpan + setTokenRanges（+可选 plainTextPasteOnly） |
| 3 | `apps/mobile/src/components/chat/NativeChatComposer.tsx` + `native-composer/*` | 新建：D5~D8 全部行为 |
| 4 | `apps/mobile/src/components/chat/ChatConversationWebView.tsx` | 剥离 composer/dock 域（桥消息、M 桥侧、composer props、恢复链缩短为 init→快照） |
| 5 | `apps/mobile/src/components/chat/ChatConversationBridge.ts` | 删 composer/dock 消息类型与 `CONVERSATION_CAPABILITY_COMPOSER_DOCK` |
| 6 | `apps/mobile/src/components/chat/useChatComposerController.ts` | 回调签名**不变**（onChangeText/onSelectionChange/handleDockAction 既存签名保留）；变化仅在接线——数据来源从桥上行（ChatConversationWebView handleUpstream 转发）改为 NativeChatComposer 组件事件直连；handleDockAction 调用方从 web dockAction 上行改为 RN toolbar/typeahead 直调；insertTokensIntoComposer 落点从 postToWeb('setText') 改为 NativeChatComposer ref 的命令式 setText 通道（M7 等价） |
| 7 | `apps/mobile/src/web/chat-transcript/index.html` + `webview/main.ts` | 新建独立入口（emitReady:false + 入口层 v:2 ready，能力位无 composer-dock） |
| 8 | `apps/mobile/src/web/chat-conversation/**` | 删除。测试处置：**删** `chat-conversation-dispatcher.test.ts`（:20/:29 直 import 包 dispatcher/model）、`chat-conversation-dock.test.ts`（:33 直 import）、`chat-conversation-entry.test.ts`（:342 require 包 main + fs 直读 main.ts 源码）——三个锁的都是合成包契约，随包退役；**调整** `chat-conversation-boot-script.test.ts`——fs 直读 chat-conversation 包源码/样式的断言组随包删除，T-CU10 样式数值断言迁移为「RN ⇄ native-composer/dock-style.ts 参照常量」形态后文件保留、`chat-conversation-bridge.test.ts` / `chat-conversation-webview.test.tsx` / `chat-conversation-panel.integration.test.tsx`（随 RN 组件剥离改造改写，不随包删）；**原样保留** `composer-input-bridge/dom/factory` 三个测试（import 的是 @web/composer-input 包，该包不动） |
| 9 | `apps/mobile/src/web/chat-conversation/webview/dock-style-reference.ts` | 数值迁入 `native-composer/dock-style.ts` 后随包删除 |
| 10 | `apps/mobile/scripts/build-webview.mjs` | PACKAGES：删 chat-conversation、**增 chat-transcript**（独立入口）；门 B 白名单删 chat-conversation 组、chat-transcript 组沿用并按独立入口新增模块补条目 |
| 11 | `apps/mobile/webview-compat-baseline.json` | 删 chat-conversation 条目；chat-transcript 条目沿用（入口拆分致计数变化走 --update-compat 流程） |
| 12 | `apps/mobile/android/app/build.gradle` | checkWebViewAssets 包清单 chat-conversation → chat-transcript 替换（仍 4 包） |
| 13 | `apps/mobile/jest.config.js` + `test-utils/enriched-markdown-mock.tsx` | 新 mock + moduleNameMapper + transformIgnorePatterns |
| 14 | `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` | 组合改为「转录 webview + NativeChatComposer」；键盘 padding/滚动跟随接原生 |
| 15 | `.github/workflows/*` | 无需改（非 workspace 包；npm ci 自动 postinstall，CI 有网）——发版前跑一次真机验证即覆盖 |

## 详细实现步骤

- Step 1 — phase-lib-spike — blocking: yes — qa: manual_user：独立 worktree 安装库与两枚补丁，真机 PoC 验证：胶囊圆角视觉/打字中实时胶囊（setTokenNotes 链路）/中文 IME 组合态（组合期间不下发 ranges、提交后再扫）/原子删/5 行封顶高度/粘贴行为（markdown 误转与否→决定补丁三）/onChangeText 明文形态（决定 D3 水化路径分支）/postinstall 全关特性后零下载。**go/no-go 门槛：胶囊视觉与 IME 行为双过才算 go**。
- Step 2 — phase-transcript-standalone — blocking: yes — qa: auto：chat-transcript 独立入口（index.html + main.ts；`createTranscriptRuntime({bindChannel:true, emitReady:false})` + 入口层自包 v:2 ready、能力位无 composer-dock）；ChatConversationWebView 按 D4b 清单剥离 composer/dock 域；子会话屏回归验证；ChatConversationPanel 临时以「转录 webview + 空 dock 占位」过渡；构建四件套同步（PACKAGES/baseline/checkWebViewAssets 增 chat-transcript、门 B 组核对）。
- Step 3 — phase-native-composer-core — blocking: yes — qa: auto：NativeChatComposer 输入本体（EnrichedMarkdownTextInput + 补丁命令）、明文基线/命令式 setText 通道（D6）、token ranges 下发链（D2 补丁二消费）、高度钳制与死区（D7）、水化路径（D3）。
- Step 4 — phase-native-composer-dock — blocking: yes — qa: auto：chips 行 / hintRow / error / toolbar 四钮与状态机（J 组语义，复用 `resolveSendButtonState` 等纯逻辑，迁 RN）、typeahead 浮层（D5：候选纯函数迁移 + onCaretRectChange 锚定 + 幂等键语义）、粘贴菜单门控（D9）。
- Step 5 — phase-panel-integration — blocking: yes — qa: manual_user：ChatConversationPanel 组合（转录 webview + 原生 composer）；键盘顶起联动（useAnimatedReaction 布尔翻转保留，dock padding 过渡保留）；转录区高度随输入框长高的当帧收缩验证；恢复链新序（面板挂载 → webview init/快照 ‖ composer 草稿水化，两链并行不再握手）。
- Step 6 — phase-retire-chat-conversation — blocking: yes — qa: auto：删 chat-conversation web 包；测试按变更点 #8 处置（dispatcher/dock/entry 三个随包删、boot-script 断言迁移、bridge/webview/panel.integration 改写、composer-input 三测试不动）；四件套收口（PACKAGES/门 B/baseline/checkWebViewAssets 完成 chat-conversation→chat-transcript 替换）；pruneDist 清产物；`build:webview` 门 C 棘轮核对。
- Step 7 — phase-device-qa — blocking: no — qa: manual_user：真机全量回归（截图逐屏对比 unify 当初的 UI 一致性硬验收反向再做：胶囊/dock/键盘/划词菜单/typeahead）；荣耀真机（DSLDU20407006179）过 PC 安装门流程照 RULE；`--maxWorkers=2` 全量 jest 门禁。

## 测试策略

纯函数层既有测试全部保留（composer-at-path / composer-token-insert / atomic-range-delete / skill-typeahead-filter / scan-*-attachments 等）。新增测试以「mock 原生输入 + 断言 wrapper 行为」为主，样式对齐沿用 T-CU10 的「参照常量相等断言」手法（RN 侧 ⇄ dock-style.ts 常量）。

### 测试用例

- T-NC1 — blocking: yes — onChangeText 后按 COMPOSER_TOKEN_RE 计算 ranges 并下发 setTokenRanges（变异：删下发必红）→ Step 3
- T-NC2 — blocking: yes — 命令式 setText 推进明文基线且触发 change 上抛（M7/E10/F6 对齐）→ Step 3
- T-NC3 — blocking: yes — 打字路径不回写（输入回调链无 setValue 调用）→ Step 3
- T-NC4 — blocking: yes — 高度钳制：maxHeight 常量=122、死区 0.5、首帧豁免 → Step 3
- T-NC5 — blocking: yes — 草稿水化：明文→合成 markdown→setValue→ranges（老草稿 `@path` 明文照常出胶囊）→ Step 3
- T-NC6 — blocking: yes — 原子删：ranges 区间退格整删 + 光标落点（复用 tryAtomicRangeDelete 断言链）→ Step 3
- T-NC7 — blocking: yes — 发送门闩/按钮状态机三分支（disabled/running/send）与 dock 布局渲染条件 → Step 4
- T-NC8 — blocking: yes — typeahead：触发/过滤上限 5/幂等键/点选插入补空格与光标（复用 buildTokenInsertion 断言）→ Step 4
- T-NC9 — blocking: yes — 粘贴门控：uiRunning 拒、256KB 截断、inputDisabled 拒 → Step 4
- T-NC10 — blocking: yes — 样式相等：胶囊色值/圆角/padding、chips maxHeight36/radius14、toolbar 36 钮 ⇄ dock-style.ts 参照常量 → Step 4
- T-TS1 — blocking: yes — chat-transcript 独立入口 ready v2 且能力位不含 composer-dock；收到 composer 域消息不崩（宽松解码）→ Step 2
- T-TS2 — blocking: yes — 子会话屏 transcriptOnly 行为回归（无 dock、菜单/滚动/快照不变）→ Step 2
- T-RT1 — blocking: yes — 退役后 `build:webview` 产物仅含 4 包、门 C 棘轮零抬升、checkWebViewAssets 通过 → Step 6
- T-RT2 — blocking: yes — 全量 jest（--maxWorkers=2）零新增红（存量红以 base 对照）→ Step 6/7

## 兼容性或迁移说明

- **草稿零迁移**：存储格式不变；老草稿水化路径见 D3。若 D3 的「库明文输出」实测不符，回退分支为「RN 侧文本真源 + 库仅显示同步」，草稿仍零迁移。
- **发送管线零改动**：scanAtPathAttachments / scanSkillAttachments / composer-sendable-input 等吃明文的 core 逻辑不动。
- **宏链与全屏编辑不受影响**：ComposerInputWebView 与 composer-input 包保留（其 heightReport:true 链路只服务宏链，本迭代后无其它消费方）。
- **子会话屏**：统一改走剥离后的纯转录宿主，行为面（CSS 隐藏 dock 的降级横幅等）以 transcriptOnly 变体既有行为为准。
- **UI 一致性**：按 unify 当初的逐屏截图对比 + 接缝专项（键盘顶起/滚动联动/分界排布/划词菜单）反向验收；胶囊负 margin 视觉差在 Step 1 spike 一并定夺（接受或补丁调优）。

## 风险与回滚方案

| 风险 | 应对 |
|------|------|
| 补丁与上游版本漂移（库迭代快） | 锁精确版本；补丁面收敛在 2~3 个文件；关注上游动向，RoundedBackgroundSpan/setTokenRanges 具备上游 PR 潜质 |
| 胶囊视觉不达硬验收 | spike 即 go/no-go 门槛；不达则退回「色块胶囊（无圆角）」并提请用户拍板降级，或转 D2-加强（自绘 span 层） |
| IME 组合态下 ranges 下发抖动/错位 | 组合期间（keyPress 检测 composing）暂停下发、提交后统一重扫；spike 实测中文输入 |
| onChangeText 明文形态与假设不符 | D3/D6 已设回退分支（RN 侧真源） |
| postinstall/离线安装 | 三特性全关 → 零资产下载（spike 验证）；若仍下载，配置 NATIVE_ASSETS 手动补齐路径进 README |
| 回滚 | 本迭代全程在独立 worktree 分支；Step 6（退役）之前主链 webview 路径完整保留，任一步不过门即弃分支回 main，零残留 |
