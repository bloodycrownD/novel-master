---
date: 2026-09-29
---

# composer-webview Step 9 验收记录（模拟器双轨）

设备策略（用户拍板）：迭代内高低版本安卓均用模拟器，真机验收挪至开发完成后。

- 低版本轨：`nm33`（API 33 / Android 13，google_apis x86_64）
- 高版本轨：`nm35`（API 35 / Android 15，强制 edge-to-edge 第一版）
- 应用包：worktree 自建 debug APK（含 composer-input 资产，13:34 版 + 14:0x 两处验收修复版）

## 验收结果（A1–A13）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A1 | 打字零闪烁 | ✓ | B1 录屏 105 对帧统计：输入/回车期间 0 孤立跳变帧（旧实现闪烁特征为持续重排涟漪）；输入生效（逐字符 change） |
| A2 | 手输即时高亮 | ✓ | B1 帧双层掩码检测蓝层（胶囊）存在且与文字层逐帧重叠（105 对帧 0 错配） |
| A3 | 原子删 | ✓ | 数值判定：输入 `@t.md`（5 字符）diff=1.69，单次退格 diff=1.80（ratio 1.06≈1.0）——单次退格整段删除 |
| A4 | 技能引用（$） | ✓ | B1 输入 `$cfg` 同样进入高亮层检测（蓝层存在） |
| A5 | 水化/回填 | ✓ | 全屏保存回填：聊天页输入框高度自 147px→205px（内容落回），草稿链路（draftRestoreToken）实测闭 |
| A6 | 发送清空 | 降级口径 | 模拟器无模型（发送被「选择模型后可发送」拦），jest 发送门闩/草稿用例覆盖；真机轮补 |
| A7 | 回车高度变化不闪 | ✓ | B1 录屏内回车 ×2，0 孤立跳变；输入框 56dp→78dp 自增高（WebView bounds 实测） |
| A8 | 滚动零分层（主验收） | ✓ | 双轨录屏帧差：API33 49 对帧、API35 40 对帧、实现版 105 对帧——胶囊层与文字层垂直位移逐帧一致（相关 ~1.0），0 错配 |
| A9 | 键盘链路（高版本 API 35） | ✓ | 聚焦 mInputShown=true；IME frame 顶 1517，输入框 [54,1238-1385] **完整悬于键盘上方**、transcript 收缩至 1147——#3848 未复现；输入+回车正常 |
| A10 | 键盘链路（低版本 API 33） | ✓ | 同 A9 全链路（聚焦弹键盘 / ClipBody 收缩 / 内容不顶跑 / 输入）；且弹键盘时输入框区无遮挡 |
| A11 | IME 组合态 | 降级口径 | 模拟器 adb 构造不出真组合态（既定口径），jest 组合态序列守护（T-IME1/2 绿）；真机轮观察 |
| A12 | 宏链不回归 | 降级口径 | jest T-MAC-W1..6 全绿 + 纯函数 13 例原样 + 同源宿主（与 chat 同一 ComposerInputWebView，A1-A3 链路等价成立）；agent 配置页受模拟器列表/表单项 adb 输入限制未实机走查 |
| A13 | chat 全屏编辑 | ✓（**形态已按真机轮反馈重做，见下节**） | 原自写全屏屏：⛶ 进入（携带文本）→ 全屏输入区聚焦弹键盘 → 输入 → 保存**直接返回**且回填输入框（高度增长实锤）→ 未保存返回被拦截（「留下/离开」实测）；键盘顶起正常 |

## 真机轮反馈后的全屏编辑重做（2026-09-29，head `61362952`）

用户在真机（荣耀 DSLDU20407006179 / Android 12）实测 ⛶ 全屏后提四问，逐条落地（用户当场指定参照物：「看看智能体配置的那个编辑框，那个编辑页面是好的」）：

| # | 用户反馈 | 处置 |
|---|---|---|
| 1 | ⛶ 按钮风格与同排其它按钮不一致 | 改与 @ / $ 同款 36 圆钮 + hairline 描边（原 28×28 无边框），字形保留 fontSize 20 |
| 2 | 进全屏后没处理键盘顶起 | 换用智能体配置那套编辑屏：`CodeEditorWebView` + `EditorScreenShell` 的键盘链（该页真机/模拟器均已验证） |
| 3 | 为何自写编辑页、没有预览/markdown | 删自写 `ChatComposerEditorScreen`，改走 `PromptEditorScreen` 的 composer 变体——同一组件、同一 `CodeEditorWebView`（md 高亮）+ 编辑/预览互切 + markdown 预览渲染 |
| 4 | 为何要有「保存」（这就是输入框的全屏） | composer 变体无保存按钮、不拦退出：编辑器卸载（返回/手势）即以当拍草稿回填会话草稿 store + bump 恢复令牌，文本原样回到输入框 |

模拟器验收（nm33 / API 33，Metro 载 worktree 分支 JS，截图与 uiautomator dump 留证）：

- ⛶ 触达盒 `[576,2199][671,2293]`（95×94 px ≈ 36dp）与 @ `[691,2199][785,2293]` 完全同款；
- 全屏页 = `编辑消息` 标题 + 右侧`预览`切换、**无保存按钮**；聚焦后 `mInputShown=true`、编辑区收缩至键盘上方（1517），光标可见，可正常输入；
- `预览`打开后 markdown/文本 档位切换 + 预览正文渲染当前草稿，键盘自动收起；
- 返回后聊天输入框内容即带全屏里改的文本（`EditText` 文本实测一致），**全程未点任何保存**。

配套清理：`composer-editor-callback.ts` 与 `ChatComposerEditorScreen.tsx` 删除；`ComposerInputWebView`/Bridge 的 `maxHeight=null`（不限高）分支保留为协议能力并标注「当前无生产消费方」（原为全屏屏而加，web 侧 `.composer-input--unbounded` 与 T-CW10 断言保持）。测试：`composer-fullscreen.test.tsx` 重写为入口/接线/退出回填，`prompt-editor-screen.test.tsx` 新增 composer 变体 describe；移动端全量 jest 1634/1635（唯一红为既有 mermaid-fullscreen CRLF 环境性失败）。

## 输入框高度变化过渡（2026-09-29 真机轮追加，head `a89cf86a`）

用户追加反馈：打字时输入框高度变化「不太丝滑，有点闪烁或抖动」——明确不是 tag 问题，是输入框整体，问高度变化的动画能不能调。

定性（代码核对）：现状**没有高度动画**。web 侧内容变化后在 rAF 里测一次高，`heightChange` 上报一个按行 clamp 好的整数（行粒度，22px 一跳），RN 容器直接换 `{height}` 值——每一步都是硬跳；且上报被 rAF 推迟、再经桥回 RN，容器比文字晚 1~2 帧才长高，那几帧里 web 文档已长高而 WebView 视口还没长，新行被盒子底边裁掉（观感＝「闪」），转录区跟着盒子同拍猛地位移（观感＝「抖」）。

处置：容器高度改 `Animated.View` + reanimated `withTiming`（初版 120ms、后按用户手感拍板调至 **80ms**，`Easing.out(quad)`），台阶抹成连续增长、转录区随同一段过渡位移；首个上报不走过渡（挂载一次性落位）；`HEIGHT_TRANSITION_MS` 单点可调。**跨引擎 1~2 帧滞后本轮未消除**（要再压短需把 web 侧测高从 rAF 提到 input 同拍，属 webview 资产改动）。jest mock 补 `withTiming`/`Easing` 桩，`currentHeight` state 保留（断言口径不变）。

验证：mobile typecheck 零错误；全量 jest 1634/1635（唯一红＝既有 mermaid-fullscreen CRLF）；模拟器（nm33，Metro 载分支 JS）在同样机制的宏输入框上实测——连续回车后盒子按行增长并稳定落在终值（88dp → 169dp 后不再变化，无来回抖动）。**端上观感受限**：模拟器 screenrecord 帧率仅 ~2.9fps（18s 出 52 帧），量不出 120ms 过渡的中间帧，过渡手感以真机为准（`HEIGHT_TRANSITION_MS` 是唯一旋钮）。

## 输入框全屏去掉预览（2026-09-29 真机轮追加，head `f7500a7d`）

用户反馈：**「输入框的编辑页面再优化下，移除预览，这样就只有编辑模式了，这样就足够了。」**

处置：`composer` 变体改成**纯编辑态**——不传 `toggle` / `segmented` / `preview`，shell 只渲染 toolbar + 编辑器；`EditorScreenShell` 的预览三件套（`toggle` / `segmented` / `previewMode`+`preview`）随之全部改可选（都不传即纯编辑态，不再需要「占位 props 糊必填」）。`form` 变体（智能体配置提示词字段）语义零变化，仍保留「编辑/预览」互切与 markdown/文本档位。

回归锁（`prompt-editor-screen.test.tsx`）：composer 变体 → 无 `prompt-editor-toggle`、无 SegmentedControl、无预览组件挂载、编辑器恒在场且草稿不丢；并加一条 form 变体对照断言（切换仍在）。验证：mobile typecheck 零错误；全量 jest 1637/1638（唯一红＝既有 mermaid-fullscreen 的 CRLF 环境性红灯）。

**同轮追加（head `753f9971`）**：用户发现「两个 编辑消息 title」——导航栏一个（`route.params.title` → stackOverride）+ 页内 shell toolbar 居中又一个；纯编辑态下 toolbar 已无任何动作位，只剩这个重复标题。修法：`EditorScreenShell` 的 `title` 改可选 + `hasToolbar` 守卫（`save`/`title`/`titlePress`/`toggle` 全空即整行不渲染，顺带不再留一条空 bar），composer 变体不传 `title`（导航栏那一个保留），缺省标题常量收敛为 `DEFAULT_FORM_TITLE`；form 变体（提示词字段）仍传 title，行为零变化（既有标题/未保存断言全绿）。

## 封顶降到 5 行 + 光标回声修复（2026-09-29 真机轮追加，head `0a671219`）

用户真机反馈两条：

| # | 反馈 | 处置 |
|---|---|---|
| 1 | 输入框最大高度有点高 | 封顶 160 → **122**（= `paddingV×2 + lineHeight×5`，正好 5 行）；`ChatComposer.styles.input` 与 `ComposerAtPathInput.DEFAULT_METRICS` 同步；断言写成「5 行关系式」而非魔数，`composer-input-webview` 的 chat 口径 fixture 同步 122 |
| 2 | 键盘输入时光标偶尔往回跳一两个字 | 病根＝chat 壳把「父层 value 回声」误判成外部写入：web 上报的文本没推进差分基线（`lastValueRef`），父层 `setText` 回写后 value 变了，壳里 effect 便按**上一拍的 `cursor`** 强制摆一次选区；`setSelectionRange` 落在正在输入（尤其 IME 组合态）的 textarea 上会把光标拽回去。修法：宿主 `onChangeText` 包一层「先推进基线再上抛」，回声与基线相等即短路；程序化写入路径（`replaceCommittedText`，自带基线 + `setText.selection` 落位）不变 |

回归锁（`composer-at-path.test.tsx`）：①父层回声 + 故意留旧 `cursor` → 打字全程零 `setSelection`、零 `setText`；②默认 metrics 的 `maxHeight === paddingV×2 + lineHeight×5`。验证：mobile typecheck 零错误；全量 jest 1636/1637（+2 用例；唯一红＝既有 mermaid-fullscreen CRLF）；eslint 本次改动零新增。**设备侧没留 IME 级证据**：模拟器上 `adb input` 绕开真实输入法（构造不出组合态），光标修复以代码定性 + jest 回归锁为准，真机手感待用户复测。

## 全屏编辑页支持 @/$ tag 胶囊（2026-09-30，head `1ad1742e`）

用户问「编辑详情页能支持 skill tag 吗？就像输入框一样？」并拍板**不换编辑引擎**（「CodeMirror 挺稳定的」）——tag 能力走 CodeMirror 6 原生路径落地：

- **胶囊 + 连锁删除**：web code-editor 包新增 `composer-tokens` 扩展——`@路径`/`$技能名` 区间复用 chat 链 `composerTokenRanges` 同一正则；`Decoration.mark` 画胶囊（与内联 `.composer-input__token` 同款样式），同一份区间喂 `EditorView.atomicRanges`（退格整段摘除、方向键跳过，语义对齐内联 `tryAtomicRangeDelete`）。
- **伪路径激活**：`composer.md`（RN 侧 `COMPOSER_EDITOR_PATH` 与 web 侧 `COMPOSER_TOKEN_PATH` 双处镜像）；文件编辑（真/伪 md 文件）不受影响，`$xx` 仍是普通文本。
- **插入链**：手输 `$`/`@` 触发 typeahead（复用 SkillTypeahead/AtPathTypeahead 与候选加载逻辑）、底排 @/$ 圆钮开 FileReferencePicker/SkillPicker、`buildTokenInsertion` 统一拼 token 与光标；路由补 `projectId`/`sessionId`（缺参时胶囊高亮仍在、typeahead/选择器静默降级）。桥两侧各加一条消息：web 上报 `selectionChange`、`setDocument` 可选选区。

验证：mobile typecheck 零错误；全量 jest 1640/1641（唯一红＝既有 mermaid CRLF）；`build:webview` 产物含 `cm-composer-token`/`atomicRanges`/`selectionChange` 标志（实测 grep）；模拟器（nm33）装含新资产的 APK 走到会话编辑页确认入口在位；**功能验收以用户自测为准**（用户原话「我测试了，没什么问题」）。

**三层产物链口径（重要）**：本块改了 `src/web/code-editor/**`，胶囊显示依赖 APK 内 webview 资产——`build:webview` + `build:webview:native` + 重打 APK 安装后可见，**Metro reload 看不到**（真机要装新 APK 才有胶囊）。

**后续**：本块随后进入 code-review-loop 收口评审（见 `cr-fix-spec.md`，5×scope 并行 + review-full 两轮），评审发现的 32 条 must-fix（P1×2：宿主 setSelection 回声误吞致全屏回填光标落文末、胶囊 web 侧零回归锁）与文档回填项以 fix-spec 为准执行。

## 验收中抓到并修复的两处真缺陷（自写全屏屏时期，均已被上节重做覆盖）

1. **全屏输入区不铺满（080f6198）**：`maxHeight=null`（全屏）时 web 侧只解除了高亮层封顶，容器仍按内容高度流式布局（`html/body/#root` 无全高链路），触摸区只到内容底部——实测「全屏中部点击无响应」。修法：全高链路 + `.composer-input--unbounded` 类（`resolveUnbounded` 判定切换）+ T-CW10 回归断言。
2. **全屏保存被自身未保存拦截（a56cbde9）**：`setSavedDraft` 异步落地，`goBack` 的 `beforeRemove` 当拍仍读到旧 `isDirty`，保存后弹「未保存」确认。修法：保存前同步调 `allowLeaveWithoutPrompt()` 放行。jest 的 act 冲刷使该竞态在单测中天然为真（T-FS4 覆盖不到），本项为验收实测独有发现。

## 环境限制与口径（如实记录）

- **模拟器 adb 输入不稳**：RN 列表行/部分对话框按钮 tap 时灵时不灵（两轮实锤）——验收期以临时 auto-open 打点驱动进入会话（ACCEPT-TEMP，验收后已还原、未入提交）；版本检查弹窗须点「今日不再提醒」；screenrecord 须等自然结束再 pull。
- **A6/A11/A12 按降级口径**：模拟器条件所限（无模型 / 无真 IME / 表单页输入限制），以 jest 全绿 + 同源宿主等价 + 真机轮补的书面口径成立，均已在表内标注。
- **unbounded（maxHeight=null）分支按协议能力保留**：当前无生产消费方（chat 全屏已改走 PromptEditor/CodeEditorWebView），CR 轮已修其高亮层不等高的 CSS 错位，但**长文滚动未实机验证**（无消费方场景）；下次点亮该分支时须补实机走查。
- **tag 胶囊 C-2（胶囊内层强制继承着色）为源码级验证**：成因经实读 @codemirror 产物确认（mark 装饰嵌套 span、高亮单类特异性 0,1,0 < 胶囊 0,2,0）；`@http://x` / `@"q"` 类 token 的胶囊字色统一**待真机/模拟器截图留证**（已列 cr-fix-spec 合并后 QA）。
- 真机轮（开发完成后）计划：A9 真机复核（荣耀 DSLDU20407006179）+ A11 组合态观察 + A6 发送清空（配模型）+ A12 宏链走查。

## 证据资产（worktree tmp/，不入库）

`acc-b1.mp4`（实现版输入/回车/滚动）、`spike-scroll.mp4`/`spike-35.mp4`（spike 双轨）、`s1~s3.png`（原子删数值判定）、`ui-1xx.xml`（各阶段 uiautomator dump，含 WebView bounds 与键盘几何）、`acc-diff-stat.py` / `spike-scroll-check.py`（帧差与双层检测脚本）。
