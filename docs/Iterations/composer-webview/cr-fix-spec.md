# CR Fix Spec: composer-webview 迭代收口评审

## 元信息

- repo：D:\Dev\nm-worktree\composer-overlay（分支 feat/composer-webview；迭代文档在主仓 D:\Dev\Js\novel-master）
- base_sha：dbd6789b（main，v1.5.26）
- head_sha：b86b83ad（真实 HEAD 以 `git log -1` 为准）
- prd_path：docs/Iterations/composer-webview/prd.md
- spec_path：docs/Iterations/composer-webview/spec.md
- review_round：2（wave-1 五节点 + wave-2 review-full；round2 为 review-full 修订回填）
- dag_version：3
- 模式：full（5×scope 并行 → spec-fix → review-full → 修订回填 → review-full 复核）
- 状态：**已执行完毕（2026-09-30，code-dev-loop 收口）**——32/32 闭合（cr-func 复核：29 闭合 + 3 差异闭合均为等价或更强，func-ready yes）；执行提交 50f09e69 / 92ef3afd / b78b71b5 / bd726ca5 / 85d47688 / 33652f0a（末笔为 cr-func 抓出的断言牙齿补修）；文档回填（spec.md 六处 / RULE 与 acceptance 的 120→80 / acceptance 胶囊节与环境限制补注）已由主代理闭。残留仅「合并后 QA（manual_user）」四条（见文末）。

汇总（round2 修订后）：P0=0，P1=2，P2=30，合计 32 条。计数口径（round2 复核员建议措辞修正）：wave-1 五节点原报 P2=28；capsule/G-2 按其建议并入 G-1 后 round1 实际落盘 **27 条**（头部误标 28，系转写时未扣并入项——基数 27 已逐节点复核：web5+host6+chat5+fullscreen4+capsule7）+ review-full round2 新增 3 条（capsule/B-4、capsule/C-3、fullscreen/C-2）= 30；host/B-4 与 K-1 分别并入 host/B-2 改法与 K 节，不另立条目。四节点 not-ready 的唯一驱动是本文件未落盘；fullscreen 节点骨架判定 ready（其 4 条 P2 一并入册）。全量 jest 基线 1640/1641（唯一红＝存量 mermaid-fullscreen CRLF）。

---

## Must-fix（P0 → P1 → P2）

### host/B-1 [P1] setText 下发后 setSelection 被回声抑制误吞——全屏回填光标落文末
- 维度：B
- 文件：apps/mobile/src/components/chat/ComposerInputWebView.tsx:299-312（setText effect）、:116-121（sameSelection）
- 问题：外部写入（全屏回填/水化）走 `setText{text}` 时 web 侧光标被推到文末，宿主 `lastSelectionRef` 基线不动；若壳随后的 `setSelection{旧cursor}` 恰与基线同值即被判回声丢弃，光标停在文末——违反 spec 变更 10「光标按 clamp(旧 cursor, 新长度) 口径而非强制置末」。
- 改法：`setText` 下行 effect 里，下发后置 `lastSelectionRef.current = null`（写值必然动光标，基线作废）；effect 声明顺序在 setSelection effect 之前，同 commit 内先作废后放行。命令式 `handle.setText`（自带 selection）不改——web 落位即期望位，保留基线反而白赚一次回声抑制。
- 验收：composer-at-path / composer-input-webview 测试全绿（T-HOST5 回声抑制断言不受影响）；补一条「外部 value 变化 + 壳下发旧值 cursor → setSelection 必须放行一次」的协议用例（红于现状）。
- 来源：scope-host round1

### capsule/G-1 [P1] 胶囊 web 侧整块零回归锁（含新桥协议与 setDocument 选区三分支）
- 维度：G
- 文件：apps/mobile/src/web/code-editor/**（composer-tokens.ts / editor.ts / theme.ts / styles/editor.css）；apps/mobile/src/components/vfs/CodeEditorBridge.ts
- 问题：胶囊装饰 + atomicRanges、setDocument 三分支早退与选区落位、胶囊 CSS、`--primary-muted` 派生全部无断言；RN 侧仅 prompt-editor-screen composer describe 7 条 + composer-fullscreen 3 条用例（round2 数字修正），风险最大的跨引擎一半裸奔。双处镜像常量（composer.md）也只锁了 RN 侧。
- 改法：照本仓 dist 契约范式（`__tests__/code-editor-boot-script.test.ts`）：① 断言 `webview-dist/code-editor/app.js` 含 `atomicRanges` / `cm-composer-token` / `composer.md` / `selectionChange`（顺带锁镜像常量，替代单边 G-2）；② 断言 `app.css` 含 `.cm-composer-token` 与 `--primary-muted`；③ `code-editor-bridge` 编解码测试补两条往返：Web→RN `selectionChange{start,end}`、RN→Web 带 `selectionStart/End` 的 `setDocument`。注意 dist 不进 git、产物 LF 稳定（spec 纪律禁的是源码文本断言的 CRLF 红灯，dist 断言是既定范式）。
- 验收：新断言在「删掉 composer-tokens.ts 的 atomicRanges provide / 改 composer.md 常量」时必红（牙）；`npm run build:webview` 后跑测。
- 来源：scope-capsule round1（G-1 吸收 G-2）

### web/B-1 [P2] build.gradle 资产门禁注释「三包」过期且无双真源指引
- 维度：C
- 文件：apps/mobile/android/app/build.gradle:156-157（清单 :164）
- 问题：注释首句仍写「三包」，实际四处包清单已含 composer-input；且与 `scripts/build-webview.mjs` 的 `PACKAGES` 是双真源、无交叉指引——将来漏同步时门禁静默放过。
- 改法：只改注释：首句改「（chat-transcript / rich-document / code-editor / composer-input 四包）」，追加「本列表须与 scripts/build-webview.mjs 的 PACKAGES 同步」。按 RULE 字节级替换纪律（该文件混合编码，勿顺手改其它中文字节；`git diff --numstat` 核对只动注释行）。
- 验收：numstat 行数与改动预期一致；gradle config 阶段不报错。
- 来源：scope-web round1

### web/B-2 [P2] unbounded 模式高亮层与 textarea 不等高，长文滚动必错位
- 维度：B
- 文件：apps/mobile/src/web/composer-input/styles/composer-input.css:36-38、:45-57
- 问题：`maxHeight=null` 时高亮层是流内内容高（被 body overflow:hidden 裁掉且自身不滚），textarea 是视口高自滚——两层错位正是本迭代要根治的病症。当前无生产消费方故 P2，但 acceptance 声明该分支保留为协议能力，不能带病入库。
- 改法：`.composer-input--unbounded .composer-input__highlight { height: 100%; }`（两层同为视口高、同一滚动体，syncScroll 才成立）；该段注释补一句「不限高模式下高亮层必须限到视口高，否则长文滚动两层错位」。
- 验收：T-CW10 原样通过（CSS 层无自动断言面）；acceptance「环境限制」节补注「unbounded 无生产消费方、长文滚动未实机验证」。
- 来源：scope-web round1

### web/C-1 [P2] `inset: 0` 无 longhand 降级，老 WebView 输入框整体错位
- 维度：C（兼容）
- 文件：apps/mobile/src/web/composer-input/styles/composer-input.css:74（round2 行号修正：:73 是 `position:absolute`）
- 问题：`inset` 需 Chromium 87+；minSdk 26 且目标机型厂商内核滞后，不识别时 absolute 无 top/left 直接塌位——与包内「老 WebView 禁新语法」约束冲突的唯一漏网。
- 改法：`inset: 0;` 后补 `top: 0; right: 0; bottom: 0; left: 0;`（longhand 全兼容，零风险）。
- 验收：build:webview 产物 CSS 两条俱在。
- 来源：scope-web round1

### web/C-2 [P2] 三处注释把 maxHeight=null 消费方写成「chat 全屏」（已过期）
- 维度：C
- 文件：web/composer-input/webview/runtime/model.ts:16-18、editor.ts:190、:341、styles/composer-input.css:35
- 问题：chat 全屏已改走 PromptEditorScreen/CodeEditorWebView，该分支无生产消费方；web 侧三处仍描述成活路径，误导后来者当热路径改或当死代码删。
- 改法：三处统一成宿主侧（ComposerInputWebView.tsx:10-12）口径：「不限高模式（metrics.maxHeight=null）：当前无生产消费方（全屏已改走 PromptEditor），保留为协议能力，勿当死代码删」。
- 验收：纯注释改动，resolveUnbounded/T-CW10 不变。
- 来源：scope-web round1

### web/G-1 [P2] resolveAtomicCaret 只断言 min() 一支；宏模式尾换行无断言
- 维度：G
- 文件：apps/mobile/__tests__/composer-input-dom.test.ts（describe 段内追加）
- 改法：补两条纯函数用例——① 删除窗起点早于区间起点（`resolveAtomicDelete('a @tok','aok')==='a '`、`resolveAtomicCaret(...)===1`）；② `renderHighlightHtml('第一行\n','prompt-macro')` 尾补 `<br/>`。
- 验收：把实现 `Math.min` 改 `Math.max` 时新用例必红（牙自检）。
- 来源：scope-web round1

### host/B-2 [P2] reanimated mock 的 useSharedValue 每渲染新对象——高度动画断言无牙
- 维度：G（测试基建）
- 文件：apps/mobile/test-utils/react-native-reanimated-mock.tsx:14-16
- 问题：mock 每次 render 返回新 `{value}`，`animatedHeightStyle` 等价直读 state；删掉 `applyHeight` 里的 `heightAV.value = withTiming(...)` 整行，T-HOST4/T-HOST7 照样绿——「真值驱动视觉」零覆盖。
- 改法（round2 采纳 review-full 修订 host/B-4——原稿 `ref.current.value = value` 逐渲染回写等于没改）：`useSharedValue` 改「仅初始化写一次、之后不回写」：`export function useSharedValue<T>(value: T) { const ref = React.useRef({ value }); return ref; }`；注意 1ad1742e 的 diff 删掉了该文件的 `import React from 'react'`，需一并补回。全仓仅 ComposerInputWebView 消费 useSharedValue，无回归面。
- 验收：改完后删 `applyHeight` 里 `heightAV.value = withTiming(...)` 整行 → T-HOST7 必红（style 停在初值 minHeight 而 state 已是新值）；保留则绿。
- 来源：scope-host round1；round2 修订（review-full host/B-4）

### host/G-1 [P2] 「5 行封顶」回归锁没锁生产路径（ChatComposer.styles.input）
- 维度：G
- 文件：apps/mobile/__tests__/composer-at-path.test.tsx:282-302（保留作兜底锁）+ chat-composer.integration.test.tsx（新增）
- 问题：现测例不带 style 走 DEFAULT_METRICS；把 `ChatComposer.styles.input.maxHeight` 改回 160 断言照样绿。RULE 要求两处同步，只有一处被测。
- 改法：integration 测试 ready 后读 `init` 载荷（已有 `hostPayloadsOfType` 辅助），断言 `metrics.maxHeight === paddingV*2 + lineHeight*5`（关系式，勿写魔数）。
- 验收：改 `styles.input.maxHeight` 为 160 时新断言红。
- 来源：scope-host round1

### host/G-2 [P2] webReady 门控 / themeUpdate 同值 / setDisabled 同值三条契约零测试
- 维度：G
- 文件：apps/mobile/__tests__/composer-input-webview.test.tsx（追加）
- 改法：三条用例——(a) 不 simulateWebReady、flush 后 `mockWebViewPostMessages` 为空；(b) theme 换新对象同内容重渲，`themeUpdate` 恰一条（专打 JSON.stringify 比对线）；(c) `editable` 同值重渲零 `setDisabled`。
- 验收：分别去掉三处 `if (!webReady) return` / 同值短路后对应用例必红。
- 来源：scope-host round1

### host/G-3 [P2] 导航守卫零测试（外部页面伪造桥消息防线）
- 维度：G（安全关联）
- 文件：apps/mobile/__tests__/composer-input-webview.test.tsx（追加）
- 改法：直取 `onShouldStartLoadWithRequest` 三组断言：包目录 index.html → true；`https://example.com/x` → false 且 `Linking.openURL` 被调；`content://evil` → false 且未调。
- 验收：守卫改 `return true` 或删包目录前缀时必红。
- 来源：scope-host round1

### host/C-1 [P2] onHeight / blur 零消费方 + 两个 *Type 死导出
- 维度：C
- 文件：apps/mobile/src/components/chat/ComposerInputWebView.tsx:71、:90-98；ComposerInputBridge.ts:83-84
- 改法（采 reviewer 方案①）：删 `onHeight` prop（容器高度宿主自管，T-HOST7 改断容器 style / currentHeight）；删 `HostToComposerInputType` / `ComposerInputToHostType` 两个 RN 侧零引用导出（web 侧 model.ts 镜像已够）；`handle.blur` 保留 + 补注释「当前无调用方，留作发送后收键盘等未来需求」（spec 写的是 prop 形态 onBlurRequest，实现为 imperative，形态偏差记 spec_deviations 待拍板）。
- 验收：全量 jest 绿；grep 无残留引用。
- 来源：scope-host round1

### host/C-2 [P2] replaceCommittedText 撞未就绪窗口光标期望静默丢失
- 维度：B
- 文件：apps/mobile/src/components/chat/ComposerAtPathInput.tsx:210-227
- 改法：`replaceCommittedText` 里 `setPendingSelection(null)` 改为 `setPendingSelection({start: pos, end: pos})`——就绪时由 host/B-1 修复保证 setSelection 放行一次；未就绪时随 ready 后 selection effect 补发。
- 验收：T-HOST2 setText 载荷断言不受影响（命令式路径自带 selection）。
- 来源：scope-host round1

### chat/C-1 [P2] `mention:false` 开关命名残留（mention 概念已整体退役）
- 维度：C
- 文件：apps/mobile/src/components/chat/ChatComposer.tsx:250-267、:589
- 改法：改 `{viaShell?: boolean}`（默认 true），调用点 `{viaShell: false}`，注释改「viaShell:false 供 onChangeText 回声路径——replaceCommittedText 会回调 onChangeText，再走整段写入会无限递归」。全仓 1 处调用点。
- 验收：`grep -rn "mention: false"` 零命中；integration 测试全绿（行为不变）。
- 来源：scope-chat round1

### chat/C-2 [P2] themeFromTokens 六字段映射两份（DRY）
- 维度：C
- 文件：ComposerInputWebView.tsx:101-110（导出）+ PromptMacroTextInput.tsx:109-119（改引）
- 改法：导出 `themeFromTokens`，宏壳 `useMemo(() => themeFromTokens(tokens), [tokens])`，删内联字面量。
- 验收：T-MAC-W2 init.theme 断言原样通过（等价证明）。
- 来源：scope-chat round1

### chat/C-3 [P2] RN 选区事件合成逻辑两份（DRY）
- 维度：C
- 文件：ComposerAtPathInput.tsx:163-180 + PromptMacroTextInput.tsx:121-131
- 改法（round2 修订：真正重复的是「基线推进 + pendingSelection 解除 + 事件合成」三件套，且必须回答与 chat/C-1 的牵制——宏壳 onChangeText 目前是裸传，若只抽事件合成不给宏壳补等价的基线推进包装，宏链会复现 0a671219 修过的「父层 value 回声当外部写入→光标被拽回」）：抽共享纯函数 `toNativeSelectionEvent(next)`（放 ComposerInputWebView.tsx 旁导出）+ 评估宏壳 onChangeText 是否需同款「先推进基线」包装（宏链父层是否有回写行为先核实现场再定；若无回写则裸传安全，留注释说明）。chat 壳的 lastValueRef 差分是壳级语义不合并；合成处保留「为何整体断言类型」注释。
- 验收：两壳测试零变化全绿；若宏壳补了基线推进，补一条对应回声用例（照 composer-at-path 的写法）。
- 来源：scope-chat round1；round2 修订（review-full open_question：与 chat/C-1 牵制、量级说小）

### chat/G-1 [P2] 两条恒真断言（字面量自证）
- 维度：G
- 文件：apps/mobile/__tests__/chat-composer.integration.test.tsx:822、:863-865
- 改法：822 改断真实状态（`composerShell(root).props.value` 不含 `{@}`）；863-865 删除（真牙已在 855-861 的 setText 载荷 + value/草稿断言）。
- 验收：删掉 `replaceCommittedText` 实现时 T-CR4①② 必红（牙自检）。
- 来源：scope-chat round1

### chat/G-2 [P2] `$ 选择器`路径零覆盖 + SkillPicker mock 装饰 + mockRuntime 缺 skills
- 维度：G
- 文件：chat-composer.integration.test.tsx:46-48、:213-227；被测面 ChatComposer.tsx:419-473
- 改法：① SkillPicker mock 照 FileReferencePicker 捕获 `onConfirm`，补「$ 选择器确认 → setText 带选区 + cursor 落位 + 草稿同步」用例；② 补「已有活跃 @ 查询时点 @ 选择器 → 从 @ 起替换不残留半截」用例（覆盖 replaceStart=activeAt.start 分支）；③ mockRuntime 补 `skills: () => ({effectiveSkills: async () => []})`。
- 验收：新用例红于「insertSkillToken 回退旧双路」形态。
- 来源：scope-chat round1

### fullscreen/B-1 [P2] ⛶ 在 scope 未就绪时是死按钮（点了全无反应）
- 维度：B + C-orch
- 文件：apps/mobile/src/screens/tabs/ChatTabScreen.tsx:155-175、ChatConversationPanel.tsx（prop 注入）
- 问题：守卫是静默 return，而 ChatComposer 只按回调是否为 null 置 disabled——scope 未就绪时按钮可点但无反应。
- 改法：照同文件 `onOpenSessionDetail` 先例——`ChatConversationPanel` 传 `scopeReady ? onOpenComposerFullscreen : undefined`，让按钮走既有 disabled 通路。
- 验收：mockRoute 缺 scope 的集成用例断言 ⛶ disabled（可顺手在 composer-fullscreen 补）。
- 来源：scope-fullscreen round1

### fullscreen/C-1 [P2] AgentList 防御注释失实 + 属无关夹带
- 维度：C
- 文件：apps/mobile/src/components/agent/AgentList.tsx:167-171
- 改法：注释改真实原因（「getRawWire 仅在行于 listIds 与逐条读之间被并发删掉时返回 null，跳过避免渲染半截行」；general 走 GENERAL_ROW 合成、不经此循环）；防御本体保留（无害且类型合规）。不拆提交；CHANGELOG 措辞随新增条目 fullscreen/C-2 一并改。
- 验收：纯注释；AgentList 相关测试不受影响。
- 来源：scope-fullscreen round1

### fullscreen/C-2 [P2] CHANGELOG 的 AgentList 条目带着同一份失实归因
- 维度：C / A
- 文件：仓库根 CHANGELOG.md（worktree 分支）Unreleased「修复」节首条
- 问题：代码注释的机制描述已由 fullscreen/C-1 认定失实（general 走 GENERAL_ROW 合成、不经该循环），CHANGELOG 同款措辞「内置 general 子智能体在注册表无实体行……」原样保留——用户可见文案比注释更易被当权威。
- 改法：改成中性可辩护措辞（如「补空值防御：取值返回空时跳过该行，避免智能体列表页整页崩溃」），触发路径留给待拍板的 AgentList 归因；不删条目。
- 验收：Unreleased 修复节无「无实体行」表述。
- 来源：review-full round2（新增）

### fullscreen/G-1 [P2] form 变体「卸载不回填」无对照断言
- 维度：G
- 文件：apps/mobile/__tests__/prompt-editor-screen.test.tsx（form describe 追加）
- 改法：`setPromptEditorOnSaved(onSaved)` → 改稿 → unmount → 断言 `onSaved` 未被调用（锁死 `if (!isComposer) return undefined` 守卫）。
- 验收：删掉 isComposer 守卫时该用例必红。
- 来源：scope-fullscreen round1

### fullscreen/G-2 [P2] hasToolbar 守卫无直接断言面（空 bar 回归会溜过）
- 维度：G
- 文件：EditorScreenShell.tsx（toolbar View 挂 testID="editor-screen-toolbar"）+ prompt-editor-screen.test.tsx
- 改法：composer 用例断言该 testID 长度 0，form 用例补长度 1 对照。
- 验收：把 toolbar 改无条件渲染时 composer 断言必红。
- 来源：scope-fullscreen round1

### capsule/B-1 [P2] selectionChange 无条件上报——文件编辑路径每步光标白跨桥
- 维度：B + C-orch
- 文件：apps/mobile/src/web/code-editor/webview/runtime/editor.ts:32-41
- 改法：updateListener 的 `selectionSet` 分支加 `&& composerTokenEnabled(currentPath)` 门（胶囊扩展本就只挂 composer 路径，语义同源、零新增状态）。
- 验收：capsule/G-1 的 dist 断言不受影响；文件编辑（不传 onSelectionChange）路径无 selectionChange 消息（可在 RN 侧补断言或以代码审阅确认）。
- 来源：scope-capsule round1

### capsule/C-orch-1 [P2] --primary-muted 在 web 侧自算，与 composer-input「宿主算色」口径相反
- 维度：C-orch
- 文件：web/code-editor/webview/runtime/theme.ts:89-96、shared/host-theme.ts（HostTheme 加可选 `primaryMuted?`）、CodeEditorBridge.ts（CodeEditorTheme 加字段）、CodeEditorWebView.tsx（themeFromTokens 补 `${tokens.primary}22`）
- 改法：HostTheme 加 `primaryMuted?: string`（可选字段，chat-transcript/rich-document 不下发、行为不变）→ theme.ts 删自算段、走 applyHostTheme 条件式写入 `--primary-muted`。
- 验收：dist CSS 的 `--primary-muted` 兜底值仍在；init 后实际值来自宿主（T-MAC-W2 类断言或 dist 契约）。
- 来源：scope-capsule round1

### capsule/C-1 [P2] actionBtn 是 ChatComposer toolBtn 的第三份逐字复制
- 维度：C
- 文件：PromptEditorScreen.tsx:467-486（styles.actionBtn）+ ChatComposer.tsx:751-758（toolBtn）
- 改法：抽共享样式（如 `components/chat/composer-toolbar-style.ts` 导出 `composerToolBtnStyle`），两处同引；保留 T-FS1 样式相等断言。
- 验收：两处 flatten 后逐项相等；T-FS1 绿。
- 来源：scope-capsule round1

### capsule/B-2 [P2] canTypeahead 不看 runtime 态——未就绪点 @ 直接抛「Runtime is not ready」
- 维度：B
- 文件：apps/mobile/src/screens/stack/PromptEditorScreen.tsx:130（canTypeahead 定义行）
- 改法：条件补 `&& runtime != null`（一行；按钮 disabled 与选择器挂载已复用该变量）。
- 验收：mock runtime=null 时 @/$ 按钮 disabled、选择器不挂载（现有缺 scope 用例扩一参即可）。
- 来源：scope-capsule round1

### capsule/B-3 [P2] 进全屏光标落 0 且无插入符——直接插 @/$ 会插到整篇开头（web 侧）
- 维度：B
- 文件：web/code-editor/webview/runtime/editor.ts:127-146（mountEditor）
- 问题：进全屏 mount 无 selection → CM 光标落 0，无插入符可见；直接点底排 @/$ 时 token 插到整篇开头。
- 改法（最小扩面，round2 与新增 capsule/B-4 成对——只修 web 侧时 RN 侧 cursor state 仍为 0，症状原样存在）：mountEditor 的 selection 缺省按路径分流——`selectionSpec(text, selection) ?? (composerTokenEnabled(path) ? {anchor: text.length} : undefined)`，仅 composer 伪路径默认光标落文末；文件编辑保持现状（cursor 0）不动。「文件编辑打开也落文末」的统一方案列为待拍板。
- 验收：与 capsule/B-4 联合验收：进全屏（initialText 非空）不点编辑器直接按 @/$ → setText 载荷 selectionStart === initialText.length；改回缺省 undefined 必红。
- 来源：scope-capsule round1；round2 修订（review-full capsule/B-4 指出原改法只修一半）

### capsule/B-4 [P2] RN 侧 cursor 初值没跟上——插入链吃的 cursor state 恒为 0
- 维度：B
- 文件：apps/mobile/src/screens/stack/PromptEditorScreen.tsx:121（`const [cursor, setCursor] = useState(0)`）
- 问题：插入链（insertSkillToken / insertPathTokens → buildTokenInsertion(draft, cursor, …)）消费的是 RN 侧 cursor state；CM 的 EditorState.create 不触发 updateListener，挂载后 web 不补发 selectionChange，cursor 停在 0——即使 capsule/B-3 把视觉光标落文末，token 仍插到整篇开头。
- 改法：`const [cursor, setCursor] = useState(() => (isComposer ? (initialText ?? '').length : 0));`（与 web 侧默认选区成对；用户一点编辑器 handleSelectionChange 立即接管）。
- 验收：进全屏不点编辑器直接按 `composer-editor-skill-btn` → setText 载荷 selectionStart === initialText.length；改回 useState(0) 必红。
- 来源：review-full round2（新增）

### capsule/C-3 [P2] capsule/C-2 的 `:is()` 改法违反「老 WebView 禁新语法」纪律
- 维度：C（兼容）
- 文件：apps/mobile/src/web/code-editor/styles/editor.css:64-73
- 问题：`:is()` 需 Chromium 88+，与 web/C-1 正在补 longhand 的 `inset`（87+）同档——同批修一处漏一处又引入一处，自相矛盾。
- 改法（round2 替代 capsule/C-2 原稿的 `:is(...)` 写法）：逗号分隔普通选择器列表——`.cm-content .cm-composer-token span, .cm-content .cm-composer-token em, .cm-content .cm-composer-token strong, .cm-content .cm-composer-token a, .cm-content .cm-composer-token code { color: inherit; }`。
- 验收：build:webview 后 app.css 出现该组选择器且**不含** `:is(`。
- 来源：review-full round2（新增）

### capsule/C-2 [P2] 语法高亮内层 span 着色盖掉胶囊字色（@链接/字符串/注释类 token）
- 维度：C（视觉）
- 文件：web/code-editor/styles/editor.css:64-73
- 改法（round2 修订两处）：写法用 capsule/C-3 的逗号选择器列表（勿用 `:is()`）；**执行时先在 webview 内 dump 一次实际 DOM/计算样式验证成因**——改法只在「语法高亮 span 是 token mark 的内层」时生效；若 CM 把两类 mark 合并到同一元素、靠 style-mod 注入顺序决胜，则需 `!important` 或更高特异性（该验证结论回填本条验收栏再动手）。
- 验收：手测 `@http://x` / `@"q"` 类 token 胶囊字色统一（模拟器截图留证，入 acceptance）。
- 来源：scope-capsule round1；round2 修订（review-full open_question：成因未验，先验 DOM 再定稿）

### capsule/G-3 [P2] 插入链两分支无用例 + mockSkillPickerProps 死脚手架
- 维度：G
- 文件：PromptEditorScreen.tsx 插入链（round2 行号修正：composer describe 在 prompt-editor-screen.test.tsx:447-632；`mockSkillPickerProps` 声明 :57）
- 改法：补两条——① `mockSkillPickerComponent` 捕获后 `onConfirm('写作')` → 断言 `setText('$写作 ', …)`（覆盖 replaceStart=activeSkill.start 分支）；② `onConfirm([])` → 断言零 setText（空数组早退）。
- 验收：新用例红于「insertSkillToken 回退不替换半截查询」形态。
- 来源：scope-capsule round1；round2 行号修正

---

## Spec deviations

- **open（文档回填，随 fix-spec 执行轮一起做；round2 补 2 处、round2 已闭 1 条）**：
  1. ~~RULE/acceptance 的 120ms→80ms~~（round2 已由主代理就地回填，闭）。
  2. `spec.md` 变更 8/11/12、变更 18（T-FS 段「编辑/预览互切」措辞）及 spec:127「不动」清单（EditorScreenShell 行写「仅 save 改可选」，实际 title/titleDanger/segmented/previewMode/preview 五 prop 改可选 + hasToolbar 守卫）均落后于实现；`ChatTabScreen.tsx:147` 注释同样过期。按 acceptance「纯编辑态/去重复标题」两节与 RULE 2026-09-30 胶囊段回填，并补记本迭代增量（胶囊/typeahead/路由参数/桥两条新消息）。
  3. ~~acceptance.md 缺 `1ad1742e` 验收条目~~（round2 已由主代理补节，闭——含三层产物链口径）。
  4. spec 变更 7 写 prop 形态 `onBlurRequest`，实现为 imperative `handle.blur()`——按 host/C-1 的处置（保留 + 注释）在 spec 就地更正措辞。
- **既有待拍板（context-bundle 在案，不由本 fix-spec 闭合）**：AgentList 白屏归因、metro.config 冒烟清单补 public/agent.js、API 37 AVD get UIManager 崩溃（发版前置）。
- **fixed**：⛶ 触达 28×28 vs 36 圆钮冲突——代码按决策 8 修订实现（36 圆钮 + T-FS1 锁），spec 行文随上表第 2 条回填；自写全屏屏删除面全仓零残留（fullscreen 节点核实）；FileEditorScreen 零受影响（核实）。

## Open questions / 待拍板

1. ⛶ 是否与 `inputDisabled`（生成中/无模型/末条纯文本）联动禁用——现仅 @/$ 联动，⛶ 不受限（fullscreen 节点提出，产品口径）。
2. CM 原子区比内联更严（阻止光标进入 token 内部；内联可进、仅删除原子）——用户是否接受；建议在 composer-tokens.ts 头注释补一句「比内联更严」后定稿。
3. 文件编辑打开时光标是否也统一落文末（capsule/B-3 采了最小扩面，统一方案待拍板）。
4. typeahead 双活互斥（round2 措辞修正）：dock 以 bottom 锚定、内容向上生长——`@`/`$` 同时活跃时两块列表纵向堆叠会**向上溢出编辑区顶部**（无 maxHeight、无裁剪，可能盖住编辑器上方区域）；是否加显式互斥守卫或 maxHeight。
5. HostTheme 扩展 `primaryMuted?` 可选字段的共享口径（capsule/C-orch-1 依赖，默认按方案执行）。
6. 宏链 `maxHeightFromStyle` 对「style 完全没给」是否回落 176（web 节点 open_question，宿主域）。
7. caret guard 的 `lastScrollTop` 不随 textarea 自滚刷新的副作用口径（web 节点，两可）。
8. `blur()` 通道去留（host/C-1 已选保留+注释；若用户不要可删）。
9. `composer-at-path.ts` 两个仅测试消费的 re-export、`simulateWebMessage` 6 处重复是否抽 harness（测试基建，非阻塞）。
10. web 侧 init 前兜底 maxHeight 160 是否对齐 122（倾向不改）。
11. build.gradle 存量注释乱码是否另行清理（勿与本迭代混）。
12. `primary + alpha` 派生全仓 4 处散落（composer 宿主/code-editor 宿主两处 `+'22'`、chip 样式 `+'14'/'33'`）是否收进 withAlpha 工具（round2 新增；倾向不动）。
13. `CodeEditorWebView` 另有 `onOpenWindow` 兜底而 `ComposerInputWebView` 没有——composer-input 页无链接/window.open，实际不可达，防御纵深不对等是否补齐（round2 新增；倾向不镀金）。
14. `CodeEditorWebView.tsx` 三处英文注释属存量（本 diff 未触碰）——K 节顺带清理与否（round2 新增，低优先）。

## 已豁免（用户确认不修）

（无）

## 合并后 QA（manual_user，不阻塞）

- 真机（荣耀）胶囊视觉与手感：胶囊底色/圆角与内联一致、退格整段删、方向键跳过 token。
- 80ms 高度过渡手感复核（HEIGHT_TRANSITION_MS 唯一旋钮）。
- 全屏回填光标落点（host/B-1 修复后：回填回输入框光标应停在原位置而非文末）。
- `@http://x` 类含特殊字符 token 的胶囊字色统一（capsule/C-2 修复后）。

## K 节建议（下游执行时闭合）

1. 文档回填四条（见 Spec deviations open 表——RULE/acceptance/spec/ChatTabScreen 注释）。
2. 本 fix-spec 全部代码项执行后跑：mobile typecheck + 全量 jest（--maxWorkers=2）+ eslint（涉改文件）+ `npm run build:webview`（web/C-1、capsule/G-1、capsule/C-2+C-3 触及 web 资产）+ 真机/模拟器 APK 重装复验胶囊。
3. prettier：涉改文件多为存量非 prettier-clean，按 RULE「格式化后逐处回退无关 hunk」纪律执行。
4. **CHANGELOG 合并冲突面（round2 重写——原稿「与 1.5.27 无冲突」失实）**：worktree 分支 CHANGELOG 无 1.5.27 段；主仓已发 `[1.5.27] - 2026-09-29` 且其「变更」节收录了本分支 Unreleased「变更」节的同两条（统计总览指标卡重排、服务商/模型格式统一——dbd6789b 存量）。合并回 main 时 CHANGELOG 必须手工合：Unreleased「变更」节那两条勿重复；本迭代条目并入 Unreleased 对应节。同时按 context-bundle merge_notes 的既有提示核对 ChatComposer 冲突面（以本分支单路径化版本为准再核 cuo 侧改动）。
5. CHANGELOG 的 AgentList 条目措辞随 fullscreen/C-2 改写（勿与本节第 4 条混为一条）。
6. CodeEditorWebView.tsx 三处英文注释（存量）可在本轮顺带清理（低优先，open_question 14）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | **yes**（review-full round2 复核通过：三条 round1 阻塞全闭合、条目实测 32=2+30 与三处口径一致、无改法缺陷/代码不符/只批评条目残留） |
| fix_spec_path | docs/Iterations/composer-webview/cr-fix-spec.md |
| dag_version / review_round | 3 / 2（wave-1 五 scope + review-full round1 修订回填 + round2 复核通过） |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 2 / 30（合计 32；计数口径见元信息——capsule/G-2 并入 G-1、host/B-4 并入 host/B-2、K-1 并入 K 节，均不另立条目） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open×4（全为文档回填且已成可执行条目；建议用户确认「按现状收窄 + 回填入册」后转 fixed——round2 已顺手闭 2 条）+ 既有待拍板 3 |
| C-orch | ✅（chat 单路径化、capsule 双真源、fullscreen 注入链均已核；review-full 复核 typeahead 双活措辞已修正） |
| C 类合并后 QA | 已列（不阻塞） |
