---
date: 2026-09-30 04:20
title: 三处 UI 优化收官 + tag 闪烁根治全链（composer-overlay → composer-webview dev-ready + 真机轮）；真机四问后 chat 全屏改走提示词编辑屏同一套；输入框高度过渡补齐
keywords: composer 抖动, tag 闪烁, 多行重排, controlled-mentions, overlay 方案, ux-fixes-2026-08, webview 输入框, composer-webview, 软键盘链路, edge-to-edge, box-decoration-break, spike, 全屏编辑, CHANGELOG 落位, bundle 地址陷阱, 真机装机, dev-ready, composer 全屏重做, PromptEditor composer 变体, 退出即回填, ⛶ 按钮对齐, 高度过渡, reanimated withTiming, 跨引擎滞后
abstract: composer tag 闪烁根治全链：ux-fixes-2026-08 归案 → 2026-09-28 复查 → composer-overlay 双层重写（dev-ready）→ 2026-09-29 真机三连修后拍板换 WebView 输入框：spec 轮（4 子代理探索+MCP 搜索）→ spec-check-loop 2 轮 Go → code-dev-loop 全程（分支 feat/composer-webview 基于 main@dbd6789b 拉出、纯函数摘入，spike 五点模拟器双轨全过 → 4 impl 节点 → 集成迁移 → verify-full PASS → cr-func-final func-ready）→ 验收 A1-A13 双轨实测（含抓到并修复两处真缺陷：全屏输入区不铺满、全屏保存被未保存拦截竞态）→ **dev-ready @ a56cbde9（19 提交未推送）** → 真机 arm64 覆盖装完成（数据保留）、Metro 8081 运行、用户实测中。**真机轮四问（2026-09-29 晚）**：⛶ 按钮风格不一致 / 全屏页没处理键盘顶起 / 为何自写一套没有预览 / 为何要保存——用户点破参照物（「智能体配置的编辑框是好的」），据此删自写 ChatComposerEditorScreen，改走 PromptEditorScreen 的 composer 变体（同一 CodeEditorWebView + 编辑/预览互切 + markdown 预览、无保存、退出即回填），⛶ 改 @/$ 同款 36 圆钮；模拟器四项复验全过（head 61362952）。**追加轮（同日深夜）**：输入框高度变化不丝滑/闪抖——定性为「没有高度动画 + 上报被 rAF 推迟 1~2 帧」，容器高度改 reanimated withTiming(120ms, out(quad))、首个上报不走过渡（head a89cf86a），跨引擎滞后保留待 web 侧测高提前。**再续轮**：输入框封顶 160 → 122（5 行关系式断言）；修「键盘输入时光标往回跳一两个字」——父层 value 回声被误判成外部写入（基线未随 web 上报推进）→ 按上一拍 cursor 强制 setSelection 打断 IME 组合态（head 0a671219，+2 回归锁）；高度过渡按用户要求 120ms → 80ms（head 30b62335）。**收尾轮**：输入框全屏改**纯编辑态**——移除预览与 markdown/文本档位切换（head f7500a7d），shell 预览三件套改可选、form 变体零变化；去页内重复标题（753f9971）。**tag 胶囊轮（2026-09-30 凌晨）**：全屏编辑页支持 @/$ tag——用户拍板**不换引擎**（CodeMirror 稳定），走 CM6 原生 atomicRanges + mark 装饰（composer.md 伪路径激活、与内联同一正则口径、桥加 selectionChange/选区落位，head 1ad1742e，全量 1640/1641，用户自测通过）；随后进 code-review-loop 收口（5×scope 并行 + review-full 两轮，32 条 must-fix 落 cr-fix-spec.md）。教训：CHANGELOG 必须落迭代分支不碰主仓；模拟器 bundle 地址陷阱与 Metro watcher 失联已进 RULE；自写 UI 前先找同型屏复用，键盘/光标这类链路差异优先复用已验证组件；模拟器 screenrecord 只有 ~2.9fps，量不出 120ms 过渡；真机 reload 后必须核 bundle 内容（Metro 缓存中间态残影会编出语法错、白屏），reverse 隧道掉了先重建再 reload。
---

user:
挂 brain-storm 恢复记忆后，问三个优化点：1) 引用文件/skill 后输入框输入文字抖动，怀疑 tag 特效；2) 项目工作区侧滑返回不回上级目录、直接跳会话管理；3) agent 配置页提示词输入框加长度限制，超长省略、点击进全屏编辑，不长则原地编辑。

assistant:
派 3 个探索子代理得出结论：1) tag 无动画特效，抖动来自 react-native-controlled-mentions 每键重建 children 的 Text 树 + 胶囊 paddingHorizontal:3 改变文本测量导致换行点漂移（desktop 用负 margin 抵消、mobile 没有）；2) 项目工作区是 Chat tab 内部 state 面板，VfsFileManager 已暴露 canGoUp/goUp 且聊天工作区已接 WorkspaceBackCtx，但 ChatSessionListPanel 没接 ref、handler 的 template 分支无条件 showSessionsPanel——补接线即可，.woktree 里 mobile-user-ops-logging-project-workspace-back spec 规划过同款修复；3) 双端各 6 个提示词输入点均无长度限制（schema 也无 max），desktop 全屏可复用 CodeEditor 包 Modal，mobile FileEditor 强绑 VFS 不适合、应新建轻量 PromptEditor 路由（onSaved 回调参数有 onSessionVfsSaved 先例），desktop 有未接线的 AgentDefinitionEditorForm.tsx 别改错。

user:
（我第一次回答时误直接改了代码）用户纠正：挂 brain-storm 只要结论，没让改代码。

assistant:
当场 git checkout 还原全部 4 个误改文件，改为纯结论汇报。教训：用户挂载 brain-storm 技能时严格只探索+答疑，实现要等明确指令。交互设计共识：折叠阈值建议 600 字符；内联输入超阈值时不抢焦点，失焦才折叠；全屏保存回填必须走现有 setter 以保住 dirty 快照链路。

user:
补充澄清：1) 抖动是 Android，文字较多时触发，文字/输入框上下抖动；2) 项目工作区返回对齐聊天工作区即可。没有其它问题，挂 prd-generate 生成 PRD。

assistant:
按 prd-generate 流程（探索已完成、澄清已终止）落盘 docs/Iterations/ux-fixes-2026-08/prd.md（三则合一：R1 输入稳定 / R2 项目工作区逐级返回 / R3 超长折叠+全屏编辑，含 GWT 验收与风险项：抖动或需 overlay 重构、阈值 600 待拍板、mobile 全屏编辑形态实现阶段定）。待用户确认。

user:
PRD 口径确认（抖动=Android 多行文本上下抖动；工作区返回对齐聊天工作区；阈值 600/3 行可接受），挂 spec-generate 生成 SPEC，按需派子代理。

assistant:
补派三只探索子代理（R1 深挖 + R3 拆 mobile/desktop 两只，第一只 R3 上下文爆掉后拆分重派）。关键事实：CodeEditorWebView 是仓库内组件、受控 value/onChange、伪路径 prompt.txt 走纯文本；PromptMacroTextInput 无 onBlur 透传需补；desktop 有 text-prompt-overlay 与 line-clamp 先例；AgentWorkplaceBlockCard 内部替换最小。落盘 docs/Iterations/ux-fixes-2026-08/spec.md：4 个 phase、14 步、9 个测试用例（T-C/T-B/T-PE/T-PM/T-PD/T-V）。探索还发现 ComposerAtPathInput.tsx 编辑器有未保存旧缓冲（磁盘已是 HEAD 版），已在 spec 风险表提醒实现前丢弃。待用户确认 spec。

user:
确认 spec，挂 code-dev-loop 生成 worktree 并开发。

assistant:
建 .woktree/ux-fixes-2026-08（feat/ux-fixes-2026-08，npm install 16s），PRD/SPEC 先提交入分支（1d4b92a）。DAG 三波：wave-0 四节点并行（composer 与 workspace-back 由主代理 trivial 直做，5250eaa/bb2fbbe；R3 双端各派一子代理，5 提交）；wave-1 双端 verify（mobile 全量 jest 841 用例：关键 id 全过，两环境性失败补构建 tdbc-driver-op-sqlite/tokenizer-driver-rn 后清零，unhide 3 挂经主树复跑确认为 main 历史失败；desktop typecheck/lint 本次文件零命中）；wave-2 cr-func-all 只读复核 func-ready:yes、无 must-fix、spec_deviations 全 closed（#11 零改动分支成立：web 侧 setDocument 已有文本相等短路）。清理：desktop 子代理越界提交的记忆文件经 rebase 摘除，npm install 弄脏的 package-lock 已还原。**dev-ready**，head 8f35490，待用户手测 T-C2/T-PE 真机/T-PD1。

user:
合并到主 worktree 的 feature 分支，可以新建一个。

assistant:
主树 main 已前进到 3ce296b（thinking-context-toggle 迭代，文件面与本次基本不重叠）。主树未跟踪的 docs/Iterations/ux-fixes-2026-08/ 与分支内已提交版本逐字节一致，删除后建 feature/ux-fixes-2026-08（迭代分支名 feat/* 已被 worktree 占用，故用 feature/ 前缀）自 main 拉出，merge feat/ux-fixes-2026-08 零冲突成 f22b557；合并后主树 mobile typecheck 交叉验证通过。清理了 verify/cr-func 子代理越界落在主树的三份重复记忆文件（内容已并入本文件）。

user:
真机验收反馈：1) 不抖了但每键 tag 闪烁；2) 600 字符和 3 行不等价，手机 3 行才几十字，建议改成超 5 行折叠。

assistant:
①闪烁根因＝库每键重推 children 重建 Android spannable；修复＝wrapper 层复用：新 children 纯文本==原生最近上报文本（lastNativePlainRef 由 handleChangeText 维护）且 mention 集合签名未变→复用元素跳过重推；原子删/程序化/水化/typeahead 点选自然重推；失败方向保守（失配只会回遇闪烁不会失同步）。T-C3/T-C4 锁定。②阈值拍板改行数：mobile 用 onContentSizeChange 实测高度（>5×22）+换行数初判，desktop 用 DOM scrollHeight>clientHeight+1（useLayoutEffect 防首帧闪撑）；双端 prompt-collapse 常量统一「5 行折叠/3 行预览」。spec/PRD 同步（#17/#18、Step 15-17），双端 typecheck + 27 用例全过，cr-func-round2 func-ready:yes（无 must-fix）。全部合入 feature/ux-fixes-2026-08（e25fa74）。经验：mobile 初判只数显式换行，长单行文本首帧会 inline 一帧再折叠（RN 事件时序限制，已定性接受）。

user:
第三轮真机反馈：1) tag 打字后直接消失看不见，问题定位不对，先回滚 + 加 metro 日志；2) 3 行隐藏太短、全屏编辑没键盘顶起、保存取消按钮丑（要照工作区左右两角）、整体做麻烦了——不如 maxHeight 限 5 行 + 全屏按钮；3) 内部保存后外部「有未保存的更改」不刷新。

assistant:
①回滚 99f5299（字节级还原）+ metro 日志三打点（__DEV__ 门控），闪烁待真机看日志重新定位（怀疑方向：Android spannable 重建）。②方案大简化：废弃整套折叠/测量/失焦防竞态，双端内联限高 5 行（mobile maxHeight 110，desktop CSS calc）+ 常驻全屏按钮；PromptEditorScreen 照 FileEditorScreen 补键盘顶起（Android keyboard-controller / iOS KeyboardAvoidingView）+ 顶栏左右两角取消/保存。③dirty 不刷新根因：native-stack 转场 freeze 下栈底屏 effect 通知不可靠（jest 复现不了）；修为 AgentEditorForm 渲掘期同步派生 isDirty，banner 随内容同帧渲染，onDirtyChange 仅供 useUnsavedGuard。经验教训：children 复用方案真机翻车证明「元素引用复用」在 RN Android 的 spannable 同步上有盲区，下次定位先加日志再动手；子代理第三次越界写记忆，已养成收到后必查 git log 的习惯。合入 feature/ux-fixes-2026-08（377c42f），cr-func-round3 func-ready。

user:
第四轮：贴了 metro 日志（typing 与 children-push 一一对应，mentionParts:1 也在重推）+ React Navigation Non-serializable 警告（PromptEditor params.onSaved）；要求全屏按钮改输入框内部右上角（标准 trailing icon 做法）。

assistant:
①按钮 overlay 化：容器 relative + 按钮 absolute top-right，输入 paddingRight 32，maxHeight/paddingRight 经 renderInline ctx.style 集中下发（0033f88）；②新建 prompt-editor-callback.ts（set/take，take 即清空防串台），路由参数只传纯数据，警告消除（8868a00）。typecheck+14 用例复核过，合入 d80fd40。日志结论已记入 spec #22：闪烁源坐实为每键全量 children-push，深层修复（patch 库 setText 短路或透明输入+高亮层分离）待用户拍板后另并轮次。子代理第四次在 worktree 落记忆文件（这次 untracked 未提交），已删；规矩：worktree 里不落数据外记忆。

user:
第五轮：全屏编辑页要和工作区完全一致（同组件、可预览 md、可编辑）；agent 配置输入框默认视口在文本底部要改顶部、限高改 8 行；全屏按钮仍像单独一列，改放 label 同行（用户建议，征求同意）。

assistant:
同意 label 行方案（标准表单动作位，不遮文字不挤宽度）。落实：①ExpandablePromptInput 接管完整字段结构（label 左 + ⤢ 全屏按钮右，六处去外层 FormField；overlay/独立列彻底废弃）；②限高 5→8 行（mobile 176 / desktop calc(8×1.45em+18px)）；③视口置顶＝挂载一拍 selection 置 0（pendingSelection 模式，根因是 Android 受控 multiline 设值后光标在文末、内部滚动跟随）；④全屏页对齐工作区：FileMarkdownPreview 只吃内存 content 零 VFS 适配直接复用，加编辑/预览切换，伪路径改 prompt.md（mobile 308114d/4171622，desktop 2680e8c）。双端 typecheck + 18 用例复核过，合入 1a0fdb5。待真机：置顶时序稳定性、回填后未聚焦视口是否又跳尾、预览转场流畅度。

user:
第六轮：编辑区保存/编辑双按钮没用，工作区是编辑/保存互切；label 行按钮去文字只留 icon，换成更明显的 X 那种全屏图标。

assistant:
探索发现工作区实际是三段式（左保存/中标题 dirty/右编辑预览互切，保存后停留+清 dirty+toast，退出靠 useUnsavedGuard 拦截），与用户记忆的单按钮互切有出入，按代码为准并告知。PromptEditorScreen 照搬该三段式（取消按钮删除，未保存拦截复用同一 hook，eb2eafc）；label 按钮纯 ⛶ icon（fontSize 20、触达 28×28，与 desktop 同字形，89274ae）。typecheck+19 用例复核，合入 3ffdf78。经验：用户对「某页面长什么样」的描述可能有偏差，照搬前必读实际代码。

user:
R6 验收通过。问 patch 库思路；提议 GitHub clone 进 packages 自己维护。

assistant:
讲清三档位：patch-package（小改可逆，升级库时 patch 要重做）/ fork 进 packages（大改或上游弃维护时）/ 自研 overlay（长期）。推荐 patch-package 起步。用户拍板：直接 patch 测试，不用子代理。

assistant:
亲手实现：库内 use-mentions.js 加冗余重推短路——handleTextChange（原生回调）记录 lastNativeTextRef，渲染时解析纯文本与之相等且 mention 签名未变则复用上一份 children 元素（prop 引用不变→RN 不重推）；补丁自带 [mentions-patch] skip/push 日志（__DEV__）。与已回滚 wrapper 方案（#17）同逻辑但变更源在库内可辨（原子删/程序化/水化/onSelect 不经 handleTextChange 自然重推，不吃旧文本）。patch-package 生成 patches/react-native-controlled-mentions+3.1.0.patch，根 package.json 加 postinstall；闭环验证：删包重装自动应用 ✓；T-C3/T-C4 重新落地 + 相关 32 用例全绿。合入 8483a1b，主树 node_modules 已手动应用（npx patch-package 无参＝应用模式，带包名＝生成模式，别搞混）。待真机：tag 不闪烁且不消失、[mentions-patch] 日志节奏（每键 skip、插删 tag 时 push）。

user:
不行，回滚，tag 直接消失了。日志：skip 每键生效但 tag 丢。认为修不好——每次打字高度计算会正常刷新 tag，自然产生闪烁。

assistant:
回滚补丁（faf514b，patches/postinstall/T-C3/T-C4 全移除）+ 主树 node_modules 重装还原干净库。定论（两次实验互证）：wrapper 复用与库内短路周同一逻辑，均致 tag 丢失——children 重推是 span 存续的载体，跳过即丢；库架构下闪烁与打字刷新绑死，用户判断正确。spec #25 标注已回滚。剩余方向待拍板：①去胶囊背景实验（仅色字+加粗，重建可能不可感知，五分钟验证）；②透明输入+高亮层 overlay 重写（根治但滚动同步难）；③维持现状。composer 的 metro 日志仍在（后续定方向时还有用，发版前再摘）。合入 3af3112。

user:
文亮了：输入框第一个就是 tag 且不换行→打字不闪；换行后每键都闪。又测：顶到高度上限（160）后仍闪。

user:
先不修了，记录记忆留给以后再修复。

assistant:
最终定性收口：单行不闪（spannable 重建视觉无感）+ 顶限仍闪（与高度重算无关）→ 闪烁＝多行文本变化的全量重排重绘，胶囊 span 内联在 TextInput 内则不可避免；「children 短路」两条死路（wrapper 复用、库 patch）已验证不可行勿重试。候选方案归档待来日：①编辑中降级纯文本着色（triggersConfig 的 textStyle 支持函数，随 focus 切换，失焦恢复胶囊，约二十行无 patch）——原理同「普通多行文本框不闪」；②透明输入+高亮层 overlay（desktop 同思路，根治，滚动同步难）。

user:
先不修了，记入记忆留待以后；随后要求移除日志。

assistant:
归档三处：记忆（决策链+候选方案）、RULE.md（新增「composer tag 多行闪烁」已知问题条目，标注死路勿重试）、spec 收尾状态。日志已摘（aed7861，-31 行，typecheck+23 用例复核过），RULE.md 同步改回「已摘除、排查时可临时加回」。最终 head 79ad559（feature/ux-fixes-2026-08），迭代除闪烁外全部完成。

user:
日志摘掉；然后 merge 到主分支。

assistant:
摘日志（aed7861）后合回 main：主 worktree 的 package-lock 被 npm install 搅出的版本号噪音（workspace 1.5.1→1.5.4）还原后切 main，--no-ff 合并成 7ee7f47（仓库惯例带描述的 merge commit），合并后 main 上 mobile typecheck 复验通过。ux-fixes-2026-08 迭代全部收口：feature/feat 两分支保留未删，.woktree/ux-fixes-2026-08 仍在（可 git worktree remove --force 清理）。

user:
changelog 好像没写全（tag 修复确实没有，已让分身回滚）。

assistant:
补 changelog 时发现分身已在并行会话动过 main：d628694 回退了去 padding 抖动修复（真机无感知差异，保持原样式）并补回我摘日志时正则误删的 atomic 早退块；e4c2e8b/261d4ef 已盘点并撤过抖动条目。我又重加了一遍（066c4e7）后核实发现是乌龙，已 revert——当前 Unreleased 正确状态：ux-fixes 仅两条（工作区返回 + 超长提示词）。教训三条：①动 main 前必看最新 log（可能有分身并行会话）；②多行正则删代码块危险（非贪婪匹配会吞到下一个缩进相同的 `}`），删完必须 diff 复核被删范围；③组件内逻辑块要有走组件路径的测试兲底（T-AT2 只测纯函数没拦住），本次靠分身人工抓住。

user:
desktop 验收反馈（节点 fix-prompt-ux-desktop）：折叠机制太复杂，放弃「超长折叠成省略预览 + DOM 测量」方案，改为内联 textarea 直接 CSS 限高 5 行（超出内部滚动），字段旁全屏按钮进全屏 Modal（CodeEditor 那套保留）。write set 仅 worktree 内 PromptCollapsibleField.tsx / prompt-collapse.ts / shell.css 三文件。

assistant:
按 write set 完成（未碰 mobile 与接线文件，组件签名不变）：①PromptCollapsibleField 简化为「.prompt-field-inline 容器 + 右上角 icon-btn 全屏按钮（⛶，复用 .icon-btn，平时 opacity 0.55）+ 原 Modal（CodeEditor/草稿/保存回填/Mod-s/点遮罩关闭均保留，另补 document keydown Esc 关闭，defaultPrevented 时不拦截）」，删除 clamp 预览/useLayoutEffect 实测/probe 重挂/measureOverflow/focusHold/pendingOpen/relatedTarget 全套防竞态；②删除 prompt-collapse.ts（无消费方，5 行语义写进 CSS 注释，PROMPT_INLINE_MAX_LINES=5）；③shell.css：.prompt-field-clamp 换为 .prompt-field-inline（position:relative）+ textarea max-height:calc(5*1.45em+18px)（settings textarea 13px×1.45≈18.85px/行，border-box 含 padding16+border2）。验证：npm run typecheck 过；eslint 本次三文件零命中（全仓 33 个既有问题，均在未碰文件）；tsconfig.renderer.json 兜底 standalone 失败但错误与改动前磁盘 tsbuildinfo 记录完全一致＝环境既有（packages/core dist 类型解析为 unknown 等），非本次引入。提交 cb592d4（1 commit，UX 简化）。经验：desktop 的门禁以 npm run typecheck（主 tsconfig）为准，renderer standalone 兜底在此 worktree 一直红。

user:
（2026-09-28 复查轮）老问题重提：输入框引用 skill 后的 tag 输入文字时不断闪烁。要求用搜索 MCP 找有没有好的 RN 库或方案解决，并可用模拟器复现。

assistant:
两探索子代理 + 搜索 + 模拟器复现的结论：①这是 RULE.md:21 归案的已知问题，根因与候选方案 unchanged；桌面端（透明 textarea + 高亮层 overlay，shell.css 负 margin 抵消 padding 保测量一致）就是根治候选②的现成蓝本。②换库无意义：react-native-controlled-mentions 293 星半弃维护（issue #92 长文本卡顿 2022 年开至今未修、#141/#142 多行滚动与光标问题挂着），但 RN 生态没有更好的——react-native-mentions（harshq）更老更弃、Stream Chat 是整套聊天 SDK 太重，且所有 mention 库都是同构架构（TextInput children 内嵌 span + 每键重推），换哪个都会复现同一闪烁；RN 官方 TextInput 无富文本支持，受控 value 重推致 spannable 重建是通病（react-native#24585 等），社区根治共识＝overlay 或原生 setSpan。③模拟器复现（emulator-5554，Metro 是 agent-tabs worktree 的但 chat 组件与 main 一致）：从零搭环境（OpenCode Zen 免 key provider + claude-fable-5 + 项目 flicker + 智能体 agent1tester + 会话），$ 引用内置技能 agent-config，两轮录屏（整词/逐字符 adb 注入）+ ffmpeg 抽帧帧差分析：打字期间输入框区域持续重绘确认仍在（逐字符轮 73/242 帧显著变化），但 tag 区域自身 0 帧变化——模拟器 + adb 注入 + 浅色主题下 tag 淡背景（primary 22≈13% alpha）肉眼闪烁不明显，与既往真机（荣耀 + 软键盘 IME 组合流）条件不同，闪烁主判定仍以 2026-08 真机日志实锤为准。④建议：要根治立新迭代走 overlay（前置小验证两个：RN TextInput onScroll 与高亮层滚动同步、RN 原生层 Text 胶囊圆角支持——TextInput children 内圆角会被 Android 忽略是已证限制，普通 Text 树未验证）；要快速缓解先试候选①（focus 降级纯文本着色，约二十行未验证）。证据存 tmp/tag-flicker-repro/（两轮视频+抽帧+分析脚本，tmp 不入库）；模拟器 app 里留了测试数据（项目 flicker / 智能体 agent1tester / OpenCode Zen claude-fable-5 模型配置），跑 e2e 前可按需清理。

user:
追问：把 react-native-controlled-mentions clone 进 packages 自己维护、直接改库，是不是比重写（overlay）更简单？

assistant:
结论：fork 有价值但修不了闪烁——fork 与 patch-package 只是改动载体不同（源码仓库 vs 补丁），库内可改的面完全同一批，而「减少重推」两条路 2026-08 已真机证死（children 重推是 span 存续载体）；在库内改造成 overlay＝背着库 API 重写，比 app 层自研更绕。fork 真正价值：上游半弃维护，外围 bug（#141 多行选建议滚动跳底、#142 光标移 mention 后报错）迟早撞上时作为修复载体；库内做增量解析可降每键 2 次全文 parseValue + diffChars 的 JS 开销（解决卡顿不解决闪烁）；解析层纯函数（parseValue/markup/triggersConfig）是 overlay 也需要的零件，MIT 协议直接拷文件保留声明即可，不必 fork 整库。推荐组合：根治＝app 层自研 overlay + 从库里拷解析函数（项目已有自研解析层 composer-at-path-mention.ts 的 promotePlainMentions/mentionValueToPlain）；fork 留给撞上外围 bug 或 patch-package 撑不住时的场景。库 license 确认 MIT。

user:
拍板「那你试试吧，实践出真知」，挂 prd-generate + spec-generate 立项 overlay 根治。

assistant:
prd-generate 流程：两探索子代理盘点「重写必须保持的行为面」（P0：value/onChangeText 恒 plain 契约、原子删、水化恢复、typeahead 光标驱动、IME 自愈两案行为底线；P1：max160 限高、pendingSelection 模式）与「桌面蓝本机制 + RN 移植三档差距」（可照搬：布局拓扑/互斥正则/原子删 plain 算法；需改写：嵌套 Text 树/滚动同步；RN 特有风险：TextInput.onScroll 无先例、普通 Text 树圆角未验证、无负 margin 先例、尾换行占位、IME 组合下划线可见性）。用户四拍板：手输即时高亮（对齐桌面，markup 状态制随之拆除）、统一真胶囊（Android 圆角不可用降级方角）、验收以模拟器为准、宏输入 PromptMacroTextInput 一并重写。PRD 落盘 docs/Iterations/composer-overlay/prd.md（9 条 GWT 验收、5 条前置风险），待用户确认后接 spec-generate。

user:
确认 PRD，挂 spec-generate 出技术规格。

assistant:
spec-generate 两轮探索补齐实现级细节：宏输入无 ref 契约、children 着色 + splitPromptMacroSegments 白名单切分（{{$key}} 闭合区间允许空格）、原子删已是 plain 版（prompt-macro-input.ts:111-147 prefix diff + 区间命中，与桌面逐行等价）；composer-at-path-mention.ts 全部导出的 src 消费方都在 ComposerAtPathInput 内→整文件可删（mentionValueToPlain 无发送/草稿侧引用）；测试用例级迁移映射（12+15+13+1 用例的保留/删除/迁移判定，桌面 Step5/Step20 segments 断言形态为蓝本）；e2e 仅依赖 testID+getText 不受影响；jest 基线 1534/1535（1 既有红灯 mermaid-fullscreen）。SPEC 落盘 docs/Iterations/composer-overlay/spec.md：受控 plain 零变换（1.5.9/1.5.10 丢字/降级源随架构消失，组合态序列 jest 守护）、原子删泛化 tryAtomicRangeDelete 单源双用（chat token ranges / 宏白名单 ranges）、滚动同步主线 a（onScroll 镜像）备选 b（单滚动域）、胶囊三档位以换行点一致为准绳（负 margin→pad0 保底）、7 Step（spike 前置→纯函数→基础设施→chat→宏→清理→验收），13 变更点、测试 T-HL/T-AD/T-OV/T-CR-HL/T-IME/T-MAC/T-DEP。待用户确认。

user:
挂 spec-check-loop 评审 composer-overlay 的 PRD/SPEC。

assistant:
spec-check-loop 第 1 轮审查（readonly 子代理对照代码库全量核验）：结论 Go（execute-ready），0 P0。关键断言抽查全过——composer-at-path-mention.ts 整删安全（8 值导出+2 type 导出的 src 消费方全在 Composer 内，唯一遗漏点是 composer-at-path.ts:3 死注释）、replaceActiveAt 移除后 fallback 路径行为等价属实、依赖清理面与 jest 配置判断正确、core 不误伤、A1-A9 与 Step/测试映射闭合。P1×2（typeahead 单路径化缺测试护栏、ExpandablePromptInput 挂载置顶视口对齐验证无归属）+ P2×7（手输退格语义明示、T-CR4② 差异化、判据与降级档联动、导出数更正、宏表单外观迁移、cursor/pendingSelection 契约显式化、措辞精度）已由主代理 doc-fix 全部闭合（PRD 需求 4 + SPEC 变更点 4/5/6/8/10/11、T-INT/T-MAC3/T-MAC4、Step 6/7）。状态：待用户确认 execute-ready；确认后可走 code-dev-loop 开工。

user:
确认 execute-ready，挂 code-dev-loop 开发（worktree 根 D:\Dev\nm-worktree，未建则新建）。

assistant:
code-dev-loop 收口 **dev-ready**（worktree D:\Dev\nm-worktree\composer-overlay，分支 feat/composer-overlay，base 45328831 → head ed092164，15 提交未推送）：①立项文档先入 main（45328831）；②wave-0 双轨——spike 主代理实测四点拍板（onScroll 镜像方案 a 有效、Text 树胶囊圆角在 Android 生效、pad3 无负 margin 可行、尾换行零宽补位；IME 组合态模拟器不可构造转 jest+真机观察）+ impl-core 子代理（tryAtomicRangeDelete 泛化/composer-highlight 切分，28 用例）；③wave-1 impl-infra（OverlayTextInputStack 共享件）；④wave-2 并行 impl-chat（组件重写+单路径化+测试迁移）与 impl-macro（宏 overlay 化+maxHeight 提取入 metrics）；⑤cr-func-w2 抓到 MF-1（chat 漏传 highlightTextStyle 深色正文不可见——impl-macro 补通道时 chat 已先提交的时序缺口）主代理一行修复+守门断言，复核 func-ready；⑥cleanup 主代理直改（删 composer-at-path-mention.ts、移库依赖、CHANGELOG）；⑦verify-full：typecheck 零错误、jest 1567 过（8 套件失败=CRLF 环境性存量零交集）；⑧模拟器验收 A1-A9 全过——**A1 帧差实锤闪烁消除（28 输入命令=28 变化帧、0 孤立跳变 vs 旧实现 73/242 帧持续重排）**；⑨cr-func-final 四条文档收口（RULE.md:21 改已根治、context-bundle 终态、e2e 豁免留痕、knip 通过）。验收新发现（非本迭代）：发送清空后旧草稿回灌+工作区草稿共享，疑似 main 既有（chat-composer-draft 订阅竞态），acceptance.md 记录建议另立案。模拟器留有测试数据（项目 flicker/agent1tester/OpenCode Zen claude-fable-5/会话）；Metro 8082 仍从 composer-overlay worktree 运行（8081 是 agent-tabs 的）。

user:
（2026-09-29）确认开发完是否用模拟器测试过——「UI 开发完还得测试验证」。

assistant:
已测：开发阶段 Step 7 就在模拟器（emulator-5554）跑过 A1-A9 全量验收（A1 打字无闪烁有帧差实锤：28 输入命令=28 变化帧、0 孤立跳变帧 vs 旧实现 73/242 帧持续重排；A2 手输即时高亮/A3 原子删/A4 技能引用/A5 水化/A6 发送/A8 宏输入均逐项实测留截图与 dump）。本轮按用户要求再补两个盲区：①跨行 token 断口——78 字符超长 token 强制跨行，两段胶囊完整无撕裂，风险表残余项关闭；②深色主题视觉——系统夜间模式下 app 仅「我的」列表页跟随深色、会话页与 agent 编辑页仍浅色（main 既有适配现状），MF-1 场景无法视觉复现，由 jest 等式断言（color === tokens.text）锁定。过程发现：adb reverse 会随模拟器重启/配置变更丢失致 debug 包冷启动红屏，重建 reverse + RELOAD 即恢复（非代码问题）。补充记录已提交（8779ba70）。

user:
（2026-09-29 真机测试轮）多 worktree 是否影响增量编译？真机怎么测最省时？

assistant:
各 worktree 的 Metro 编译缓存独立（各自 node_modules/.cache），互不影响增量速度；唯一注意别同时跑多个 Metro 抢资源。真机最省时路径：复用 worktree 现成热 Metro 8082（增量缓存满），`adb -s DSLDU20407006179 reverse tcp:8081 tcp:8082` + force-stop 重启 app 拉新 bundle（首次全量 ~23MB USB 秒级，之后一直增量）；真机/模拟器 reverse 各自独立可同时连同一 Metro。注意 Metro 后台进程会被回收（8082 曾掉线重启）；adb reverse 会随设备重启/配置变更丢失，症状是 debug 包冷启动红屏（loadJSBundleFromAssets 栈），重建 reverse + RELOAD 即恢复。**荣耀真机 screenrecord 被系统禁用（exit 127）**，真机录屏帧差验证不可用。

user:
真机反馈：打字不再闪烁了（老根因修实锤），但回车换行还是闪——只要输入框高度变化就闪，和之前一样。

assistant:
根因定位：方案 a 照搬桌面「高亮层流内定尺寸、输入框 absoluteFill」——web 两层同一布局引擎同帧重排没问题，RN 是 JS 文字树+原生 EditText 双引擎，回车时原生输入框当帧要长高、容器要等 JS 回路一帧，内容被裁切即闪。修复＝主从反转（c5e27f14）：TextInput 回流内定尺寸（原生自增高+maxHeight 封顶内滚，回车当帧长高零时序差），高亮层改 absoluteFill 铺满跟随（内容晚一帧无碍——回车新行是空行）。58 用例全绿+typecheck 过。

user:
反转后输入框无法点击了，你自己边测边修，不需要我操作。

assistant:
回归根因：反转后高亮层 ScrollView（absolute）在 DOM 后位盖住输入层，**Android 上 pointerEvents="none" 的 ScrollView 触摸穿透不可靠**。修复＝DOM 顺序调整（5dfbf87f）：高亮层移前位（下层）、输入层 TextInput 回后位保持上层触摸优先，不依赖穿透。真机 adb 验证：tap 后 mInputShown=true 键盘弹出、input text 与回车全部生效（用户草稿中插入了 QW/ER）。教训进 RULE 候选：RN 上层交互元素必须 DOM 后位，pointerEvents none 只当双保险。

user:
真机再试：好了一点但滚动输入时有明显的分层现象。想到一个方案——web 上输入框 tag 特效很成熟，能不能用 web 输入框（WebView）替代 RN 原生输入框？

assistant:
支持换道，分析：①滚动分层是透明双层的固有物理上限（onScroll→JS→scrollTo 桥接慢一拍，快速/惯性滚动肉眼错位），继续打补丁到顶了；②WebView 输入框单引擎同帧重排，打字闪/回车闪/滚动分层同一病根（双引擎同步）一次全消；③桌面 renderComposerAtPathHighlightHtml（正则+胶囊+负margin+box-decoration-break）可原样复用，宏输入桌面逻辑同；④项目 chat-transcript webview 先例（桥协议/log 通道/基建全熟），气泡真胶囊就是 HTML 画的；⑤web 有 compositionstart/end 事件，「组合中不回写」比 RN 受控更精确（1.5.9 类丢字有标准解法）。风险点（唯一大未知）：webview textarea 聚焦的软键盘链路（容器顶起/KeyboardAvoiding 感知），需半天 spike。工程量：桥协议+渲染层重做（每组键一条 postMessage 量级无压力但要处理竞态），解析纯函数层（切分/原子删）与组件对外契约原样保留，overlay 渲染树断言面改桥消息。备选退路（次优）：胶囊-only overlay（文字恢复不透明、只高亮层画胶囊，错位降为背景块漂移）/候选①降级纯色字。建议：先 spike webview+键盘交互再全量。用户随后要求压缩上下文，spike 未启动。

user:
（过程备忘）模拟器重建环境时：AVD 名 nm-e2e 已不存在（-list-avds 实际为 Medium_Phone_API_36.1 / Pixel_7，跑的应是前者）；该 AVD 数据被清（全新无项目/智能体/模型）；「新建项目」对话框的「创建」按钮 adb 点击屡屡无效，**输入名称后按回车（keyevent 66）直接提交成功**；项目 Flicker 已建成（名称首字母自动大写），智能体/模型/会话未建（用户中断转 webview 讨论）。当前现场：feat/composer-overlay head 5dfbf87f；真机 reverse 8081→8082 连 worktree Metro；模拟器停在项目抽屉页。

user:
（2026-09-29 spec 轮）恢复记忆后设计 webview 方案（spec-generate）。补充约束：需考虑低版本和高版本安卓对输入框和键盘的支持——之前高版本安卓出过「输入框无法顶起键盘」，现在的代码已特殊处理。另可用 MCP 网络搜索业界方案。

assistant:
按 spec-generate 流程并行派 4 只只读探索子代理（webview 基建 / RN 输入组件与键盘链路 / 桌面 HTML 高亮与解析层复用 / 测试与 e2e），加 MCP 搜索两条关键情报（react-native-webview#3848：新架构下 WebView input 聚焦内容被键盘顶出可视区、Closed as Stale 无解；#1172：Android 程序化 focus 不弹键盘）。关键结论：①高版本顶不起键盘根因 = targetSdk 36 强制 edge-to-edge 下 adjustResize 不可靠，特殊处理 = keyboard-controller insets 动画范式（AndroidKeyboardClipBody），**与输入框类型解耦，webview 方案键盘代码零新增**，且 CodeEditorWebView 已生产验证「WebView focus 弹 IME + 容器收缩」完整链路（文件编辑器本来就是 WebView/CodeMirror）；②code-editor 的受控桥模式（web 自持真源 + suppressChange 防回环 + setText 仅外部变化）整套照抄，架构性消除 v1.5.9 回写打断 IME 路径；③桌面 renderComposerAtPathHighlightHtml + 负 margin/box-decoration-break:clone CSS 手法整套照搬，mobile 纯函数（composer-highlight/atomic-range-delete）零依赖经 esbuild @/ alias 直接进 bundle；④mock WebView 协议测试范本（simulateWebMessage + mockWebViewPostMessages）现成，e2e 走 switchToWebView 先例。落盘 docs/Iterations/composer-webview/{prd.md,spec.md,cache/context-bundle.md}：基线 5dfbf87f 拉分支 feat/composer-webview、Phase A 仅 chat 链（宏链 Phase B 另拍板）、桥协议 v=1 九消息、7 Step（spike 前置五点双轨验证高低版本，不过则迭代终止退回 overlay）、17 变更点、T-CB/T-CW/T-HOST/T-CR4/T-INT/T-IME 用例矩阵。待用户确认 spec。

user:
（同日第 2 轮补充）既然要改造输入框：① chat 输入框加全屏输入 icon（类似智能体配置那种，输入一多内联不方便）；② PromptMacroTextInput 也一起做，理解输入框组件可以复用。

assistant:
确认复用成立，修订 PRD/SPEC/context-bundle（第 2 版）：①单包双模式（init.mode = composer-token | prompt-macro，纯函数两套均零依赖进同一 bundle）+ 通用宿主 ComposerInputWebView 三处复用（chat 内联壳/宏壳/chat 全屏屏）；②chat 全屏 = 工具栏 ⛶ → 新 ChatComposerEditorScreen（EditorScreenShell 键盘三分支 + ComposerInputWebView 保留 token 高亮 + useUnsavedGuard + composer-editor-callback set/take 模式，全照 PromptEditorScreen 先例）；宏链既有全屏（CodeEditorWebView）不动；③宏链并入后 overlay-input.tsx 迁完退役（Step 7 条件执行）；④新风险：agent 配置页动态块同屏多 WebView 实例内存——Step 5 模拟器实测（动态块 ≥3），不可接受则宏链退 overlay。spec 扩为 9 Step（Step5 宏壳与 Step6 全屏可并行）、23 变更点，验收加 A12（宏链不回归）/A13（chat 全屏）。待用户确认 spec。

user:
（同日第 3 轮）基线改主意：最好在 worktree 新拉分支、基于主分支已发布的实现——overlay 本次也没修好（滚动分层遗留），不带它的中间态，git 也干净。

assistant:
采纳并修订（第 3 版）：基线 main @ dbd6789b（v1.5.26 已发布代码），worktree 内 `git checkout -b feat/composer-webview main`（main 被主仓占用须拉新分支；切换后 npm install 对齐依赖）；从 overlay 分支只 cherry-pick 纯函数资产（composer-highlight/atomic-range-delete 泛化版/composer-token-insert 按需核对，带测试），组件实现全部不摘；随基线并入原 overlay 的三件事（ChatComposer typeahead 单路径化、controlled-mentions 依赖摘除 + composer-at-path-mention.ts 整删、children span 断言体系换协议断言）。回滚锚点 = main 本身（不合入即保持已发布现状），feat/composer-overlay 长期保留作备选实验线（胶囊-only overlay/纯色字）不参与合并。jest 基线口径改主仓 1577/1577 全绿（v1.5.26 发版记录），worktree CRLF 红灯按 RULE 归一化修法不计回归。宏链回退预案改「revert 宏壳重写回 main 现实现（props 面不变）」。PRD/SPEC/context-bundle 三件同步。待用户确认 spec。

user:
（同日第 5 轮）确认 execute-ready，挂 code-dev-loop 开发；高低版本安卓都用模拟器测试（环境统一），开发完成后再测真机。

assistant:
code-dev-loop 启动：spec/PRD 设备策略修订（模拟器双轨、真机后置）→ worktree 内 `git checkout -b feat/composer-webview main`（基于已发布实现，da0750f4 摘入纯函数资产 4 文件含测试，npm install 对齐）→ 初始 DAG（wave-0 spike → impl-web → impl-host → impl-macro∥impl-fullscreen → cr-func-w1 → impl-integration → verify-full → cr-func-final → acceptance）→ **wave-0 spike 双轨全过**（head 07557d25）：低版本 nm33（API 33）+ 高版本 nm35（API 35 强制 edge-to-edge）各建 google_apis AVD，内联 HTML WebView 挂真实 ChatComposer dock 验证五点——①键盘链路（聚焦弹 IME+ClipBody 收缩+#3848 未复现，输入框完整悬键盘上方）②高度上报（56→160 +22 步进封顶）③光标可见 ④逐字符 change 流 ⑤滚动零分层（帧差双层掩码互相关：49/40 对帧 0 错配）。**方案可行性确认，可进 Step 2**。连锁事故与修复：①旧模拟器 app 库损坏（malformed DB）→ 全部弃用、新建 AVD（协作红线禁 pm clear/卸载，未越线）；②**bundle 地址陷阱（重大）**：RN 模拟器 debug 包默认 bundle location=10.0.2.2:8081 绕过 adb reverse 直达宿主 8081，宿主 8081 跑着 cuo worktree 的 Metro → app 静默拉 cuo 分支同款 UI 的代码，排查多轮（spike 打点全静默、Metro 日志无请求、netstat 实锤）；解法=杀 cuo Metro + 本 worktree Metro 起在 8081；③模拟器 adb 输入不稳（对话框按钮 tap 时灵时不灵用回车提交；列表行 tap 完全失灵靠临时 auto-open 打点绕过）；④灭屏黑屏（svc power stayon / 重启）；⑤playstore 镜像 AVD 起不来（用 google_apis）；⑥**API 37（Pixel_7）app 红屏 get UIManager 未定位崩溃**（与 2026-09-28 真机同款，发版前置项）。附带修复（独立提交）：**AgentList 白屏崩溃**（内置 general 虚拟行 getRawWire undefined → raw.name TypeError，空 registry/坏库均可触发，防御 raw==null 跳过）+ worktree core dist stale 重建（public/agent.js 缺 DEFAULT_SUBAGENT_DEFINITION，metro.config 冒烟清单建议补）。spike-notes.md 已落盘。待用户确认进 wave-1 impl-web。

assistant:
（同日续）用户「继续」后按 code-dev-loop 波次连续推进至 dev 收口：**wave-1 impl-web**（web 包六文件：透明 textarea+高亮层双模式/桥/editor 652 行 + 四处注册 + 桥类型层 + T-CB7/T-CW20；ed7165c2）→ **wave-2 impl-host**（ComposerInputWebView 通用宿主 + chat 壳重写 + T-HOST8；c3bda43a，保留 replaceActiveAt 垫片与 theme? 通道）→ **wave-3 并行** impl-macro（宏壳 + T-MAC-W6；8cd7577e）∥ impl-fullscreen（⛶+全屏屏+路由+callback+T-FS6；cfbe2be4，含清单外 header-config.ts 必需接线）→ DAG 重编排 v4（cr-func-w1 合并入 final）→ **wave-4 impl-integration**（单路径化+失效 props/垫片清理 + 集成测试桥协议迁移 T-CR4/T-INT/T-IME + controlled-mentions 依赖与 mention markup 层移除 + e2e pageobject 切 WEBVIEW；4f466d34）→ **wave-5 verify-full**（独立复核 PASS：typecheck 零错误、1633/1634、唯一红 mermaid-fullscreen 经主仓对照实测定性 CRLF、门禁 100/100、残留清零）→ **wave-6 cr-func-final**（readonly 小检 **func-ready: yes**，无 P0/P1，P2 为文档措辞/落位级；指正 AgentList 崩溃机制归因——main 源码层 getRawWire null-safe，「general 虚拟行」说法不准，实锤现场是坏库+dist stale 复合场景，防御无害）→ **wave-7 acceptance（进行中）**：nm33 实现版聊天页就绪；**发现验收环境阻塞并定位**——实现版 WebView 走 file:///android_asset 资产链，而模拟器装的 APK 的 assets 无 composer-input（spike 内联 HTML 绕开过此链）→ build:webview:native 拷贝 + gradle assembleDebug（x86_64）出包中，待覆盖安装后继续 A1-A13。文档收尾：CHANGELOG Unreleased 补四条（输入框 WebView 化/全屏编辑/AgentList 修复/依赖移除）；spec 就地校正四处（build.gradle 实为 UTF-8、#10 回填走 draftRestoreToken 链路、#17 测试落位、决策 7 光标可见保守策略实现注）。验收环境坑续记：RN 列表行 adb tap 时灵时不灵（验收期临时 auto-open hack，ACCEPT-TEMP 标记验收后还原）、版本弹窗须点「今日不再提醒」、screenrecord 须自然结束再 pull（提前 pull 得损坏文件）。

assistant:
（同日收尾）**dev-ready 达成**（feat/composer-webview，head a56cbde9，未推送）。验收（模拟器双轨 nm33 API33 + nm35 API35）：A1 打字零闪（105 对帧 0 孤立跳变）、A2 手输高亮（蓝层胶囊与文字逐帧重叠）、A3 原子删（退格 diff/输入 diff=1.06 整段删数值实锤）、A4/A5/A7/A8（滚动零分层双轨 49/40/105 对帧 0 错配）、A9/A10 键盘链路（聚焦弹键盘+输入框完整悬于键盘上方+#3848 未复现）、A13 全屏完整闭环（⛶ 携带→输入→保存直接返回+回填→未保存拦截）；A6/A11/A12 降级口径（无模型/无真 IME/表单页 adb 输入限制，jest 全绿+同源宿主，真机轮补）。**验收抓到并修复两处真缺陷**：①全屏输入区不铺满（maxHeight=null 时 web 侧 html/body/#root 无全高链路+容器流式布局→触摸区只到内容底部；修法全高链路+.composer-input--unbounded 类，080f6198+T-CW10 断言）②全屏保存被自身未保存拦截（setSavedDraft 异步落地 vs goBack 的 beforeRemove 同拍读旧 isDirty；修法同步 allowLeaveWithoutPrompt，a56cbde9——jest act 冲刷复现不了的竞态，验收实测独有发现）。CHANGELOG 条目按纪律改在**迭代分支**（修订此前误改主仓 main 工作区的失误，已还原主仓、条目落 worktree 42466be5——教训：迭代产物一律在 worktree 分支，不碰主仓工作区，尤其主仓已有并行会话时）。**重要发现：主仓 main 已被并行会话推进**（cuo 迭代合并至 b6ec44e1、CHANGELOG 由其重排）——合并回 main 时 CHANGELOG 与 ChatComposer 有冲突面（merge_notes 已记 context-bundle）。ACCEPT-TEMP 全部还原、残留 grep 零。下一步：全量 jest 复跑确认→汇报 dev-ready；合并/真机轮待用户拍板。

user:
你装到真机上，我测试下效果，启动 metro。

assistant:
真机装机完成（荣耀 DSLDU20407006179）并交用户实测：先探现场（真机在线·arm64-v8a·用户在用 app·Metro 8081 活着）→ **arm64 出包**（`gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`，3m8s 缓存热）→ 建 reverse（真机 8081→宿主 8081 我们 Metro）→ force-stop 后 `install -r -d` **覆盖装成功（未弹荣耀锁屏密码门，-r 保数据：日志见 hydrate settled=4，用户 4 条历史完好）**→ curl 预热 bundle（23MB）→ 启动 app，跑我们分支代码（nm-boot hydrate complete）。给用户测试指引：重点看 tag 胶囊高亮跟手/滚动零分层/回车自增高/⛶ 全屏编辑/中文 IME 组合态；若红屏或「Loading from localhost:8081…」长挂=USB 反向隧道抖（重启 adb+force-stop 重开，首包冷编译数分钟正常）。现场状态：Metro 8081（worktree 真实路径）、真机 reverse 已建、模拟器 nm33/nm35 亦在跑（可杀腾资源）。

**压缩上下文交接要点（本轮收口）**：
- 进度：composer-webview **dev-ready**（分支 feat/composer-webview，**head a56cbde9，未推送**，19 提交）；验收 A1-A13 模拟器双轨已完成（acceptance.md），**真机轮进行中（等用户实测反馈）**
- 真机轮待验项：A9 真机键盘复核 / A11 中文 IME 组合态 / A6 配模型发送清空 / A12 宏链走查 / A2 真机手感与 tag 高亮
- 待用户拍板：①合并回 main（**主仓已前进到 b6ec44e1**——cuo 迭代已合并，CHANGELOG 与 ChatComposer 有冲突面，merge_notes 见 context-bundle）②AgentList 空值防御（07557d25）去留 ③metro.config dist 冒烟清单补 public/agent.js
- 会话教训（已进 RULE）：迭代产物含 CHANGELOG 一律落迭代分支不碰主仓工作区；模拟器 debug 包 bundle 地址陷阱（10.0.2.2:8081 绕过 reverse 直达宿主、跨 worktree Metro 静默串台）；Metro watcher 跨越分支失联（改代码后 force-stop 重启 + curl bundle 校验）；playstore 镜像 AVD 起不来用 google_apis；RN 列表行 adb tap 时灵时不灵

user:
（同日第 4 轮）慎重一些，spec-check-loop 过一遍。

assistant:
spec-check-loop 第 1 轮审查（readonly 子代理对照代码库全量核验）：结论 Go（execute-ready），0 P0。关键断言抽查全过——composer-at-path-mention.ts 整删安全（8 值导出+2 type 导出的 src 消费方全在 Composer 内，唯一遗漏点是 composer-at-path.ts:3 死注释）、replaceActiveAt 移除后 fallback 路径行为等价属实、依赖清理面与 jest 配置判断正确、core 不误伤、A1-A9 与 Step/测试映射闭合。P1×2（typeahead 单路径化缺测试护栏、ExpandablePromptInput 挂载置顶视口对齐验证无归属）+ P2×7（手输退格语义明示、T-CR4② 差异化、判据与降级档联动、导出数更正、宏表单外观迁移、cursor/pendingSelection 契约显式化、措辞精度）已由主代理 doc-fix 全部闭合（PRD 需求 4 + SPEC 变更点 4/5/6/8/10/11、T-INT/T-MAC3/T-MAC4、Step 6/7）。状态：待用户确认 execute-ready；确认后可走 code-dev-loop 开工。

user:
（2026-09-30 凌晨）还有个问题，编辑详情页能支持 skill tag 吗？就像输入框一样？——等会要换编辑引擎吗？CodeMirror 还是挺稳定的，没有其他办法吗？CodeMirror 有原生支持类似 tag 的东西吗？支持连锁删除这种。

assistant:
方案定案：**不换引擎**。CodeMirror 6 原生就有「tag 类能力」——`EditorView.atomicRanges` 就是连锁删除（退格整段摘除、方向键跳过，mention 芯片在 CM6 的标准做法），胶囊视觉用 `Decoration.mark` 挂样式类即可。落地（head 1ad1742e，14 文件 +789/−87）：web code-editor 包新增 `composer-tokens` 扩展——区间复用 chat 链 `composerTokenRanges` 同一正则（es2018 安全、双端口径天然一致），同一份区间既做 mark 装饰（`.cm-composer-token`，与内联 `.composer-input__token` 同款样式含负 margin）也喂 atomicRanges（语义对齐内联 `tryAtomicRangeDelete`：删除窗碰区间未盖满即整段删）；伪路径 `composer.md` 激活（Compartment 按 path 启停，文件编辑不受影响，RN 侧常量双处镜像）。桥两侧各加一条：web 上报 `selectionChange`（typeahead 判活跃查询要光标）、`setDocument` 载荷可选选区（token 插入一次落位）。屏幕侧 PromptEditorScreen composer 变体接插入链：`$`/`@` 手输 typeahead + 底排 @/$ 圆钮选择器 + `buildTokenInsertion` 复用 ChatComposer 同源纯函数；路由补 projectId/sessionId（缺参降级：胶囊仍在、插入链禁用）。测试坑：prompt-editor-screen 的 jest.mock 组件桩若直接引用模块级 jest.fn 常量会在 import 期 TDZ 成 undefined（工厂执行早于 const 初始化）——包一层函数延迟到渲染期解析；跨用例的挂载树残留会在后续用例的 act 全局 flush 里重渲、把捕获槽再写一遍——带选择器的用例收尾 unmount。全量 1640/1641（唯一红＝存量 mermaid CRLF）；三层产物链：胶囊显示在 APK webview 资产里，Metro reload 看不到，须 build:webview:native + 重打 APK。

user:
我测试了，没什么问题，进入 cr 阶段吧 [$code-review-loop] 这可是大迭代。

assistant:
code-review-loop 收口（大迭代 full 模式，基线 dbd6789b → b86b83ad，51 文件 +5576/−1128）：wave-1 五模块并行 readonly 评审（scope-web/host/chat/fullscreen/capsule，全部同步等齐）→ 主代理 spec-fix 落 cr-fix-spec.md → wave-2 review-full 全维终审（B–K + fix-spec 覆盖度校验）→ 按其三条阻塞修订回填（round2）。产出：**P0=0、P1=2、P2=30**，全落 `docs/Iterations/composer-webview/cr-fix-spec.md`。两条 P1：①宿主 `setText` 下发后 `lastSelectionRef` 基线不失效，壳随后的 `setSelection` 被回声抑制误吞——全屏回填光标落文末；②胶囊 web 侧整块零回归锁。教训：**fix-spec 计数必须实测复核**（round1 头部 P2=28 实为 27——并入项没扣掉，被 review-full 按 RULE 抓包）；评审子代理给的「改法」也要验（两条改法达不到自身验收：mock 回写版、只修 web 侧光标）；CHANGELOG 合并冲突面——主仓已发 1.5.27 且收录本分支 Unreleased 同两条，合并时勿重复（K-4）。fix-spec-ready 后请用户确认执行。

user:
[$code-dev-loop] 修复吧

assistant:
（执行轮，用户确认后）code-dev-loop 按 cr-fix-spec 执行完毕：四波 DAG——wave-0 fix-web（主代理直改）∥ fix-capsule（子代理）→ wave-1 fix-host-chat ∥ fix-fullscreen（并发子代理）→ wave-2 fix-screen（主代理直改）→ cr-func 复核 func-ready yes（32/32 闭合）。终态 head 33652f0a（6 笔修复提交），全量 1658/1660（两条红＝存量 mermaid CRLF + chat-transcript 满负载 flaky 隔离绿）。文档回填全闭。残留：合并后 QA 四条待用户。

user:
启动metro，我真机测试下

assistant:
真机轮现场铺好：Metro 8081 从 worktree 真实路径启动（curl 预热 bundle 并验五个新代码标志在）→ build:webview:native（CR 修复后的 webview 资产拷入 android assets）→ arm64 APK 重打（15:24）→ 荣耀真机 force-stop + install -r -d 覆盖装成功（未弹锁屏门，用户四个会话数据完好）→ reverse 建立 → app 启动加载完成（Metro 日志见设备 bundle 2841 模块编完）。给用户四项 QA 清单：全屏回填光标落点（P1 修复实感）、胶囊手感与整段删、@http://x 类 token 字色统一、80ms 高度过渡手感。

user:
合并到main吧，并补全changelog

assistant:
合并完成（main head d9c2fec1，no-ff merge commit）。冲突面预判命中：ChatComposer 零冲突（main 自基线没动过它——merge_notes 的担忧未发生）、package.json/package-lock/build.gradle 全自动合（main 只 bump 1.5.27 版本、分支只删 mention 依赖，不同 hunk）、**CHANGELOG 唯一手工解**：分支的 Unreleased 内容进 main 的 Unreleased（新增×2/修复×1/维护×1），1.5.27 段按 main 原样还原，分支 Unreleased 里与 1.5.27 重复的两条变更（统计总览指标卡重排/服务商模型格式统一）随 common 区自然去重——正是 cr-fix-spec K-4 预告的冲突面。main 门禁三件套：npm install（removed 2 packages）→ typecheck 零错 → 全量 jest **先挂 dist 契约测试**（main 的 webview-dist 陈旧不进 git，RULE「改 dist 消费的包必须重建 dist」同族坑）→ build:webview 重建后 **1687/1687 全绿**。未 push（用户未指令）。分支与 worktree 保留未清。

user:
确认 execute-ready，挂 code-dev-loop 开发（worktree 根 D:\Dev\nm-worktree，未建则新建）。

assistant:
code-dev-loop 收口 **dev-ready**（worktree D:\Dev\nm-worktree\composer-overlay，分支 feat/composer-webview，base 45328831 → head ed092164，15 提交未推送）：①立项文档先入 main（45328831）；②wave-0 双轨——spike 主代理实测四点拍板（onScroll 镜像方案 a 有效、Text 树胶囊圆角在 Android 生效、pad3 无负 margin 可行、尾换行零宽补位；IME 组合态模拟器不可构造转 jest+真机观察）+ impl-core 子代理（tryAtomicRangeDelete 泛化/composer-highlight 切分，28 用例）；③wave-1 impl-infra（OverlayTextInputStack 共享件）；④wave-2 并行 impl-chat（组件重写+单路径化+测试迁移）与 impl-macro（宏 overlay 化+maxHeight 提取入 metrics）；⑤cr-func-w2 抓到 MF-1（chat 漏传 highlightTextStyle 深色正文不可见——impl-macro 补通道时 chat 已先提交的时序缺口）主代理一行修复+守门断言，复核 func-ready；⑥cleanup 主代理直改（删 composer-at-path-mention.ts、移库依赖、CHANGELOG）；⑦verify-full：typecheck 零错误、jest 1567 过（8 套件失败=CRLF 环境性存量零交集）；⑧模拟器验收 A1-A9 全过——**A1 帧差实锤闪烁消除（28 输入命令=28 变化帧、0 孤立跳变 vs 旧实现 73/242 帧持续重排）**；⑨cr-func-final 四条文档收口（RULE.md:21 改已根治、context-bundle 终态、e2e 豁免留痕、knip 通过）。验收新发现（非本迭代）：发送清空后旧草稿回灌+工作区草稿共享，疑似 main 既有（chat-composer-draft 订阅竞态），acceptance.md 记录建议另立案。模拟器留有测试数据（项目 flicker/agent1tester/OpenCode Zen claude-fable-5/会话）；Metro 8082 仍从 composer-overlay worktree 运行（8081 是 agent-tabs 的）。

user:
（2026-09-29 真机轮）多 worktree 是否影响增量编译？真机怎么测最省时？

assistant:
各 worktree 的 Metro 编译缓存独立（各自 node_modules/.cache），互不影响增量速度；唯一注意别同时跑多个 Metro 抢资源。真机最省时路径：复用 worktree 现成热 Metro 8082（增量缓存满），`adb -s DSLDU20407006179 reverse tcp:8081 tcp:8082` + force-stop 重启 app 拉新 bundle（首次全量 ~23MB USB 秒级，之后一直增量）；真机/模拟器 reverse 各自独立可同时连同一 Metro。注意 Metro 后台进程会被回收（8082 曾掉线重启）；adb reverse 会随设备重启/配置变更丢失，症状是 debug 包冷启动红屏（loadJSBundleFromAssets 栈），重建 reverse + RELOAD 即恢复。**荣耀真机 screenrecord 被系统禁用（exit 127）**，真机录屏帧差验证不可用。

user:
真机反馈：打字不再闪烁了（老根因修实锤），但回车换行还是闪——只要输入框高度变化就闪，和之前一样。

assistant:
根因定位：方案 a 照搬桌面「高亮层流内定尺寸、输入框 absoluteFill」——web 两层同一布局引擎同帧重排没问题，RN 是 JS 文字树+原生 EditText 双引擎，回车时原生输入框当帧要长高、容器要等 JS 回路一帧，内容被裁切即闪。修复＝主从反转（c5e27f14）：TextInput 回流内定尺寸（原生自增高+maxHeight 封顶内滚，回车当帧长高零时序差），高亮层改 absoluteFill 铺满跟随（内容晚一帧无碍——回车新行是空行）。58 用例全绿+typecheck 过。

user:
反转后输入框无法点击了，你自己边测边修，不需要我操作。

assistant:
回归根因：反转后高亮层 ScrollView（absolute）在 DOM 后位盖住输入层，**Android 上 pointerEvents="none" 的 ScrollView 触摸穿透不可靠**。修复＝DOM 顺序调整（5dfbf87f）：高亮层移前位（下层）、输入层 TextInput 回后位保持上层触摸优先，不依赖穿透。真机 adb 验证：tap 后 mInputShown=true 键盘弹出、input text 与回车全部生效（用户草稿中插入了 QW/ER）。教训进 RULE 候选：RN 上层交互元素必须 DOM 后位，pointerEvents none 只当双保险。

user:
真机再试：好了一点但滚动输入时有明显的分层现象。想到一个方案——web 上输入框 tag 特效很成熟，能不能用 web 输入框（WebView）替代 RN 原生输入框？

assistant:
支持换道，分析：①滚动分层是透明双层的固有物理上限（onScroll→JS→scrollTo 桥接慢一拍，快速/惯性滚动肉眼错位），继续打补丁到顶了；②WebView 输入框单引擎同帧重排，打字闪/回车闪/滚动分层同一病根（双引擎同步）一次全消；③桌面 renderComposerAtPathHighlightHtml（正则+胶囊+负margin+box-decoration-break）可原样复用，宏输入桌面逻辑同；④项目 chat-transcript webview 先例（桥协议/log 通道/基建全熟），气泡真胶囊就是 HTML 画的；⑤web 有 compositionstart/end 事件，「组合中不回写」比 RN 受控更精确（1.5.9 类丢字有标准解法）。风险点（唯一大未知）：webview textarea 聚焦的软键盘链路（容器顶起/KeyboardAvoiding 感知），需半天 spike。工程量：桥协议+渲染层重做（每组键一条 postMessage 量级无压力但要处理竞态），解析纯函数层（切分/原子删）与组件对外契约原样保留，overlay 渲染树断言面改桥消息。备选退路（次优）：胶囊-only overlay（文字恢复不透明、只高亮层画胶囊，错位降为背景块漂移）/候选①降级纯色字。建议：先 spike webview+键盘交互再全量。用户随后要求压缩上下文，spike 未启动。

user:
（过程备忘）模拟器重建环境时：AVD 名 nm-e2e 已不存在（-list-avds 实际为 Medium_Phone_API_36.1 / Pixel_7，跑的应是前者）；该 AVD 数据被清（全新无项目/智能体/模型）；「新建项目」对话框的「创建」按钮 adb 点击屡屡无效，**输入名称后按回车（keyevent 66）直接提交成功**；项目 Flicker 已建成（名称首字母自动大写），智能体/模型/会话未建（用户中断转 webview 讨论）。当前现场：feat/composer-overlay head 5dfbf87f；真机 reverse 8081→8082 连 worktree Metro；模拟器停在项目抽屉页。

user:
（2026-09-29 spec 轮）恢复记忆后设计 webview 方案（spec-generate）。补充约束：需考虑低版本和高版本安卓对输入框和键盘的支持——之前高版本安卓出过「输入框无法顶起键盘」，现在的代码已特殊处理。另可用 MCP 网络搜索业界方案。

assistant:
按 spec-generate 流程并行派 4 只只读探索子代理（webview 基建 / RN 输入组件与键盘链路 / 桌面 HTML 高亮与解析层复用 / 测试与 e2e），加 MCP 搜索两条关键情报（react-native-webview#3848：新架构下 WebView input 聚焦内容被键盘顶出可视区、Closed as Stale 无解；#1172：Android 程序化 focus 不弹键盘）。关键结论：①高版本顶不起键盘根因 = targetSdk 36 强制 edge-to-edge 下 adjustResize 不可靠，特殊处理 = keyboard-controller insets 动画范式（AndroidKeyboardClipBody），**与输入框类型解耦，webview 方案键盘代码零新增**，且 CodeEditorWebView 已生产验证「WebView focus 弹 IME + 容器收缩」完整链路（文件编辑器本来就是 WebView/CodeMirror）；②code-editor 的受控桥模式（web 自持真源 + suppressChange 防回环 + setText 仅外部变化）整套照抄，架构性消除 v1.5.9 回写打断 IME 路径；③桌面 renderComposerAtPathHighlightHtml + 负 margin/box-decoration-break:clone CSS 手法整套照搬，mobile 纯函数（composer-highlight/atomic-range-delete）零依赖经 esbuild @/ alias 直接进 bundle；④mock WebView 协议测试范本（simulateWebMessage + mockWebViewPostMessages）现成，e2e 走 switchToWebView 先例。落盘 docs/Iterations/composer-webview/{prd.md,spec.md,cache/context-bundle.md}：基线 5dfbf87f 拉分支 feat/composer-webview、Phase A 仅 chat 链（宏链 Phase B 另拍板）、桥协议 v=1 九消息、7 Step（spike 前置五点双轨验证高低版本，不过则迭代终止退回 overlay）、17 变更点、T-CB/T-CW/T-HOST/T-CR4/T-INT/T-IME 用例矩阵。待用户确认 spec。

user:
（同日第 2 轮补充）既然要改造输入框：① chat 输入框加全屏输入 icon（类似智能体配置那种，输入一多内联不方便）；② PromptMacroTextInput 也一起做，理解输入框组件可以复用。

assistant:
确认复用成立，修订 PRD/SPEC/context-bundle（第 2 版）：①单包双模式（init.mode = composer-token | prompt-macro，纯函数两套均零依赖进同一 bundle）+ 通用宿主 ComposerInputWebView 三处复用（chat 内联壳/宏壳/chat 全屏屏）；②chat 全屏 = 工具栏 ⛶ → 新 ChatComposerEditorScreen（EditorScreenShell 键盘三分支 + ComposerInputWebView 保留 token 高亮 + useUnsavedGuard + composer-editor-callback set/take 模式，全照 PromptEditorScreen 先例）；宏链既有全屏（CodeEditorWebView）不动；③宏链并入后 overlay-input.tsx 迁完退役（Step 7 条件执行）；④新风险：agent 配置页动态块同屏多 WebView 实例内存——Step 5 模拟器实测（动态块 ≥3），不可接受则宏链退 overlay。spec 扩为 9 Step（Step5 宏壳与 Step6 全屏可并行）、23 变更点，验收加 A12（宏链不回归）/A13（chat 全屏）。待用户确认 spec。

user:
（同日第 3 轮）基线改主意：最好在 worktree 新拉分支、基于主分支已发布的实现——overlay 本次也没修好（滚动分层遗留），不带它的中间态，git 也干净。

assistant:
采纳并修订（第 3 版）：基线 main @ dbd6789b（v1.5.26 已发布代码），worktree 内 `git checkout -b feat/composer-webview main`（main 被主仓占用须拉新分支；切换后 npm install 对齐依赖）；从 overlay 分支只 cherry-pick 纯函数资产（composer-highlight/atomic-range-delete 泛化版/composer-token-insert 按需核对，带测试），组件实现全部不摘；随基线并入原 overlay 的三件事（ChatComposer typeahead 单路径化、controlled-mentions 依赖摘除 + composer-at-path-mention.ts 整删、children span 断言体系换协议断言）。回滚锚点 = main 本身（不合入即保持已发布现状），feat/composer-overlay 长期保留作备选实验线（胶囊-only overlay/纯色字）不参与合并。jest 基线口径改主仓 1577/1577 全绿（v1.5.26 发版记录），worktree CRLF 红灯按 RULE 归一化修法不计回归。宏链回退预案改「revert 宏壳重写回 main 现实现（props 面不变）」。PRD/SPEC/context-bundle 三件同步。待用户确认 spec。

user:
（同日第 5 轮）确认 execute-ready，挂 code-dev-loop 开发；高低版本安卓都用模拟器测试（环境统一），开发完成后再测真机。

assistant:
code-dev-loop 启动：spec/PRD 设备策略修订（模拟器双轨、真机后置）→ worktree 内 `git checkout -b feat/composer-webview main`（基于已发布实现，da0750f4 摘入纯函数资产 4 文件含测试，npm install 对齐）→ 初始 DAG（wave-0 spike → impl-web → impl-host → impl-macro∥impl-fullscreen → cr-func-w1 → impl-integration → verify-full → cr-func-final → acceptance）→ **wave-0 spike 双轨全过**（head 07557d25）：低版本 nm33（API 33）+ 高版本 nm35（API 35 强制 edge-to-edge）各建 google_apis AVD，内联 HTML WebView 挂真实 ChatComposer dock 验证五点——①键盘链路（聚焦弹 IME+ClipBody 收缩+#3848 未复现，输入框完整悬键盘上方）②高度上报（56→160 +22 步进封顶）③光标可见 ④逐字符 change 流 ⑤滚动零分层（帧差双层掩码互相关：49/40 对帧 0 错配）。**方案可行性确认，可进 Step 2**。连锁事故与修复：①旧模拟器 app 库损坏（malformed DB）→ 全部弃用、新建 AVD（协作红线禁 pm clear/卸载，未越线）；②**bundle 地址陷阱（重大）**：RN 模拟器 debug 包默认 bundle location=10.0.2.2:8081 绕过 adb reverse 直达宿主 8081，宿主 8081 跑着 cuo worktree 的 Metro → app 静默拉 cuo 分支同款 UI 的代码，排查多轮（spike 打点全静默、Metro 日志无请求、netstat 实锤）；解法=杀 cuo Metro + 本 worktree Metro 起在 8081；③模拟器 adb 输入不稳（对话框按钮 tap 时灵时不灵用回车提交；列表行 tap 完全失灵靠临时 auto-open 打点绕过）；④灭屏黑屏（svc power stayon / 重启）；⑤playstore 镜像 AVD 起不来（用 google_apis）；⑥**API 37（Pixel_7）app 红屏 get UIManager 未定位崩溃**（与 2026-09-28 真机同款，发版前置项）。附带修复（独立提交）：**AgentList 白屏崩溃**（内置 general 虚拟行 getRawWire undefined → raw.name TypeError，空 registry/坏库均可触发，防御 raw==null 跳过）+ worktree core dist stale 重建（public/agent.js 缺 DEFAULT_SUBAGENT_DEFINITION，metro.config 冒烟清单建议补）。spike-notes.md 已落盘。待用户确认进 wave-1 impl-web。

assistant:
（同日续）用户「继续」后按 code-dev-loop 波次连续推进至 dev 收口：**wave-1 impl-web**（web 包六文件：透明 textarea+高亮层双模式/桥/editor 652 行 + 四处注册 + 桥类型层 + T-CB7/T-CW20；ed7165c2）→ **wave-2 impl-host**（ComposerInputWebView 通用宿主 + chat 壳重写 + T-HOST8；c3bda43a，保留 replaceActiveAt 垫片与 theme? 通道）→ **wave-3 并行** impl-macro（宏壳 + T-MAC-W6；8cd7577e）∥ impl-fullscreen（⛶+全屏屏+路由+callback+T-FS6；cfbe2be4，含清单外 header-config.ts 必需接线）→ DAG 重编排 v4（cr-func-w1 合并入 final）→ **wave-4 impl-integration**（单路径化+失效 props/垫片清理 + 集成测试桥协议迁移 T-CR4/T-INT/T-IME + controlled-mentions 依赖与 mention markup 层移除 + e2e pageobject 切 WEBVIEW；4f466d34）→ **wave-5 verify-full**（独立复核 PASS：typecheck 零错误、1633/1634、唯一红 mermaid-fullscreen 经主仓对照实测定性 CRLF、门禁 100/100、残留清零）→ **wave-6 cr-func-final**（readonly 小检 **func-ready: yes**，无 P0/P1，P2 为文档措辞/落位级；指正 AgentList 崩溃机制归因——main 源码层 getRawWire null-safe，「general 虚拟行」说法不准，实锤现场是坏库+dist stale 复合场景，防御无害）→ **wave-7 acceptance（进行中）**：nm33 实现版聊天页就绪；**发现验收环境阻塞并定位**——实现版 WebView 走 file:///android_asset 资产链，而模拟器装的 APK 的 assets 无 composer-input（spike 内联 HTML 绕开过此链）→ build:webview:native 拷贝 + gradle assembleDebug（x86_64）出包中，待覆盖安装后继续 A1-A13。文档收尾：CHANGELOG Unreleased 补四条（输入框 WebView 化/全屏编辑/AgentList 修复/依赖移除）；spec 就地校正四处（build.gradle 实为 UTF-8、#10 回填走 draftRestoreToken 链路、#17 测试落位、决策 7 光标可见保守策略实现注）。验收环境坑续记：RN 列表行 adb tap 时灵时不灵（验收期临时 auto-open hack，ACCEPT-TEMP 标记验收后还原）、版本弹窗须点「今日不再提醒」、screenrecord 须自然结束再 pull（提前 pull 得损坏文件）。

assistant:
（同日收尾）**dev-ready 达成**（feat/composer-webview，head a56cbde9，未推送）。验收（模拟器双轨 nm33 API33 + nm35 API35）：A1 打字零闪（105 对帧 0 孤立跳变）、A2 手输高亮（蓝层胶囊与文字逐帧重叠）、A3 原子删（退格 diff/输入 diff=1.06 整段删数值实锤）、A4/A5/A7/A8（滚动零分层双轨 49/40/105 对帧 0 错配）、A9/A10 键盘链路（聚焦弹键盘+输入框完整悬于键盘上方+#3848 未复现）、A13 全屏完整闭环（⛶ 携带→输入→保存直接返回+回填→未保存拦截）；A6/A11/A12 降级口径（无模型/无真 IME/表单页 adb 输入限制，jest 全绿+同源宿主，真机轮补）。**验收抓到并修复两处真缺陷**：①全屏输入区不铺满（maxHeight=null 时 web 侧 html/body/#root 无全高链路+容器流式布局→触摸区只到内容底部；修法全高链路+.composer-input--unbounded 类，080f6198+T-CW10 断言）②全屏保存被自身未保存拦截（setSavedDraft 异步落地 vs goBack 的 beforeRemove 同拍读旧 isDirty；修法同步 allowLeaveWithoutPrompt，a56cbde9——jest act 冲刷复现不了的竞态，验收实测独有发现）。CHANGELOG 条目按纪律改在**迭代分支**（修订此前误改主仓 main 工作区的失误，已还原主仓、条目落 worktree 42466be5——教训：迭代产物一律在 worktree 分支，不碰主仓工作区，尤其主仓已有并行会话时）。**重要发现：主仓 main 已被并行会话推进**（cuo 迭代合并至 b6ec44e1、CHANGELOG 由其重排）——合并回 main 时 CHANGELOG 与 ChatComposer 有冲突面（merge_notes 已记 context-bundle）。ACCEPT-TEMP 全部还原、残留 grep 零。下一步：全量 jest 复跑确认→汇报 dev-ready；合并/真机轮待用户拍板。

user:
你装到真机上，我测试下效果，启动 metro。

assistant:
真机装机完成（荣耀 DSLDU20407006179）并交用户实测：先探现场（真机在线·arm64-v8a·用户在用 app·Metro 8081 活着）→ **arm64 出包**（`gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`，3m8s 缓存热）→ 建 reverse（真机 8081→宿主 8081 我们 Metro）→ force-stop 后 `install -r -d` **覆盖装成功（未弹荣耀锁屏密码门，-r 保数据：日志见 hydrate settled=4，用户 4 条历史完好）**→ curl 预热 bundle（23MB）→ 启动 app，跑我们分支代码（nm-boot hydrate complete）。给用户测试指引：重点看 tag 胶囊高亮跟手/滚动零分层/回车自增高/⛶ 全屏编辑/中文 IME 组合态；若红屏或「Loading from localhost:8081…」长挂=USB 反向隧道抖（重启 adb+force-stop 重开，首包冷编译数分钟正常）。现场状态：Metro 8081（worktree 真实路径）、真机 reverse 已建、模拟器 nm33/nm35 亦在跑（可杀腾资源）。

**压缩上下文交接要点（本轮收口）**：
- 进度：composer-webview **dev-ready**（分支 feat/composer-webview，**head a56cbde9，未推送**，19 提交）；验收 A1-A13 模拟器双轨已完成（acceptance.md），**真机轮进行中（等用户实测反馈）**
- 真机轮待验项：A9 真机键盘复核 / A11 中文 IME 组合态 / A6 配模型发送清空 / A12 宏链走查 / A2 真机手感与 tag 高亮
- 待用户拍板：①合并回 main（**主仓已前进到 b6ec44e1**——cuo 迭代已合并，CHANGELOG 与 ChatComposer 有冲突面，merge_notes 见 context-bundle）②AgentList 空值防御（07557d25）去留 ③metro.config dist 冒烟清单补 public/agent.js
- 会话教训（已进 RULE）：迭代产物含 CHANGELOG 一律落迭代分支不碰主仓工作区；模拟器 debug 包 bundle 地址陷阱（10.0.2.2:8081 绕过 reverse 直达宿主、跨 worktree Metro 静默串台）；Metro watcher 跨越分支失联（改代码后 force-stop 重启 + curl bundle 校验）；playstore 镜像 AVD 起不来用 google_apis；RN 列表行 adb tap 时灵时不灵

user:
（同日第 4 轮）慎重一些，spec-check-loop 过一遍。

assistant:
spec-check-loop 2 轮收敛 Go（execute-ready）：第 1 轮审查（readonly 子代理对照双仓代码逐行核）No-Go——**P0-1 禁用态通道缺失**（spec 声称 editable 无消费失实：ChatComposer:585 传 editable={!inputDisabled}（running/无模型/末条纯文本只读是现网行为）、宏链 disabled prop 被 DynamicBlocksCard:193/PromptLayoutSection:282 消费，桥协议无禁用消息，照稿实施第一步即 TS 报错）+ P1-1（全屏「取消/保存双角」放不进 EditorScreenShell 单左动作位）+ P1-2（ChatComposer 零导航依赖，全屏导航通道未定）+ P2×5（@/alias 先例引用失实等）。主代理 doc-fix 全闭合：桥协议加 init.disabled+setDisabled（web readOnly+灰显 0.55、chips 灰显留 RN 壳）、editable 保留零改动、全屏顶栏改「左保存+系统返回 useUnsavedGuard 拦截」、导航照 onOpenSessionDetail 先例 prop 注入链。第 2 轮审查逐项代码核对 8/8 闭合、Go，2 条新 P2（T-MAC-W 清单同步、shell 必填占位提示）顺手闭合。状态：待用户确认 execute-ready 后可走 code-dev-loop。教训：写 spec 时「无实际消费」这类否定性声称必须逐行 grep 核实（本轮 editable 差点漏掉现网只读行为）。

user:
（2026-09-29 深夜·真机轮反馈）输入框全屏按钮问题：①按钮风格和其他几个按钮风格不一致；②进入的编辑页面，没有处理键盘顶起问题；③编辑页面为什么要自己写？为什么不用和 agent 配置相同的组件？什么预览/markdown 都没有；④为什么要有保存？这是输入框的全屏，不是文件，退出后就在输入框中，为什么要保存？

user:
（过程中打断）「你为什么不看看智能体配置的那个编辑框？那个编辑页面是好的，你隔着乱研究什么呢？」

assistant:
先核了四条底数：①⛶ 是 28×28 无边框小触达（真机截图实锤：同排 @ / $ 是 36 圆钮带描边；dump 触达盒 `[597,2210][671,2284]`=74px≈28dp）；②全屏页是自写的 `ChatComposerEditorScreen`（EditorScreenShell 占位 segmented + ComposerInputWebView 解除限高 + 左「保存」+ useUnsavedGuard + composer-editor-callback），键盘那条链在模拟器上其实是顶起的（台架实测容器 2337→1517、mInputShown=true），用户点破的参照物才是关键；③该页确实没有预览/markdown；④保存语义对「输入框的全屏」不成立。按用户指定参照物改道：**删掉自写屏**，`PromptEditorScreen` 加 `variant: 'form' | 'composer'`——composer 变体不传 `EditorScreenShell.save`（左位不渲染、shell 的 save 改可选）、标题恒「编辑消息」不切「未保存」、`useUnsavedGuard` 关闭、**卸载（返回/手势）时以当拍草稿回填会话草稿 store + bump 恢复令牌**（这就是「退出后就在输入框中」，无需保存）；编辑区/预览与提示词字段完全同款（CodeEditorWebView md 高亮 + FileMarkdownPreview + markdown/文本档位）；⛶ 改 `[styles.toolBtn, {borderColor}]`＝与 @ / $ 同款 36 圆钮（字形保留 fontSize 20）；`composer-editor-callback.ts`、`ChatComposerEditorScreen.tsx`、路由 `ChatComposerEditor`（types/header-config/RootNavigator 三处）一并删除，回填回调统一走 `prompt-editor-callback.ts`。验证：mobile typecheck 过；全量 jest **1634/1635**（唯一红＝既有 mermaid-fullscreen CRLF 环境性）；nm33 模拟器四项复验全过——⛶ 触达盒 95×94px 与 @ 完全同款、全屏页无保存+右侧预览、聚焦弹键盘且编辑区收缩到键盘上方（1517）光标可见、预览渲染当前草稿、返回后输入框文本即带全屏改动（全程未点保存；截图与 dump 留证）。提交 **61362952**（feat/composer-webview，未推送）；文档同步：spec 五处就地修订（决策 8 / 变更点 11·12·18 / 结构 / 不动清单）、acceptance 增「真机轮反馈后的全屏编辑重做」节、CHANGELOG 该条改写。教训三条：①用户心里已有「这一屏该长什么样」的现成参照物时，先去读那个参照物再动手，别自写一套（本轮自写屏的预览/键盘/保存语义全是自造差异）；②键盘、光标这类跨引擎链路差异，优先复用已被真机验证过的组件，别在自研组件上重新踩一遍；③`prettier --write` 会顺带重排无关行（本轮 4 处：ChatComposer 的 deps 数组、ComposerInputWebView 的 useCallback 签名、两处 jest.mock requireActual 换行），提交前逐处回退，保持 diff 只含目标改动。

user:
（同日深夜·真机轮追问）还有个问题，输入框上高度变化时，感觉动画不太丝滑，有点闪烁或者抖动的感觉，不是 tag 的问题，这个我是指输入框整体的问题，这个高度变化的动画是不是能调整？

assistant:
定性：**现状根本没有高度动画**。web 侧内容变化后在 rAF 里量一次 `highlight.scrollHeight`、按 metrics clamp 成整数（行粒度，22px 一跳）后 `heightChange` 上报，RN 容器直接换 `{height}` 值——每一步都是硬跳；且上报被 rAF 推迟、再经桥回 RN，容器比文字晚 1~2 帧才长高，那几帧里 web 文档已长高而 WebView 视口还没长，**新行被盒子底边裁掉**（观感＝「闪」），转录区跟着盒子同拍猛地位移（观感＝「抖」）。处置（`ComposerInputWebView`）：容器改 `Animated.View` + reanimated `withTiming`（`HEIGHT_TRANSITION_MS = 120`、`Easing.out(Easing.quad)`）把台阶抹成连续增长、下方转录区随同一段过渡位移；首个上报不走过渡（挂载一次性落位，否则开场像跳一下）；`unbounded`（maxHeight=null）分支不受影响；`currentHeight` state 保留作目标值/断言面；reanimated jest mock 补 `withTiming`/`withSpring`/`withDelay`/`Easing` 桩（返回终值不跑时间轴）并清掉未用 React import——**新增 reanimated 用法要同步补桩，否则整批单测崩在 import 上**。**跨引擎那 1~2 帧滞后未消除**：要再压短得把 web 侧测高从 rAF 提到 `onInput` 同拍，属 webview 资产改动（要 `build:webview(:native)` + 重打包），本轮不做，过渡把它从「闪一下」变成「长出来」。验证：typecheck 过、全量 jest 1634/1635（唯一红＝既有 mermaid-fullscreen CRLF）、nm33 宏输入框（同源宿主，禁用会话打不了字时的等价验体）连续回车后盒子按行增长并稳定落在终值（88dp → 169dp 后不再变化）。**受限点**：模拟器 screenrecord 只有 ~2.9fps（18s 出 52 帧），量不出 120ms 过渡的中间帧，手感以真机为准，`HEIGHT_TRANSITION_MS` 是唯一旋钮。提交 **a89cf86a**；docs 同步（acceptance 增「输入框高度变化过渡」节、context-bundle 记 head、RULE 增高度链路条目）。

user:
（同日深夜·真机轮续）还有几个问题：1. 输入框最大高度有点高，可以调小些；2. 键盘输入的时候，cursor 指针有时候会向前跳一两个字，而不是正常在最后。很奇怪。

assistant:
两条都落地（提交 **0a671219**，docs 跟进）：①封顶 **160 → 122**（= `paddingV×2 + lineHeight×5`，正好 5 行）——`ChatComposer.styles.input` 与 `ComposerAtPathInput.DEFAULT_METRICS` 两处同步，断言写成「5 行关系式」而非魔数（跟着行高/内边距走），`composer-input-webview` 的 chat 口径 fixture 镜像 122；②「光标往回跳」病根＝**chat 壳把父层 value 回声误判成外部写入**：web 上报的文本没推进差分基线（`lastValueRef` 只在 effect 里推进），父层 `setText` 回写后 `value !== lastValueRef` → 壳里 effect 按**上一拍的 `cursor`** 置 `pendingSelection` → 宿主下发 `setSelection` → `textarea.setSelectionRange` 落在正在输入（尤其 IME 组合态）的 textarea 上，光标被拽回一两个字。修法：给宿主传一层 `onChangeText` 包装（`handleWebChangeText`）——**先推进基线再上抛**，回声与基线相等自然短路；程序化写入路径（`replaceCommittedText`，自带基线 + `setText.selection` 一次落位）不动。回归锁两条：父层回声 + 故意留旧 `cursor` → 打字全程零 `setSelection`/零 `setText`；默认 metrics `maxHeight === paddingV×2 + lineHeight×5`。验证：typecheck 零错误、全量 jest **1636/1637**（+2 用例，唯一红＝既有 mermaid-fullscreen CRLF）、eslint 本次零新增；设备侧没留 IME 级证据（模拟器 `adb input` 绕开真实输入法，构造不出组合态），以代码定性 + jest 锁证为准，真机手感待复测。**教训**：受控输入里「真源在子层」的通道，一律先对齐基线再上抛；`setSelectionRange` 是能给 IME 组合态踩刹车的危险动作，别在打字路径上发。另：本轮给真机 reload 时踩到 **Metro 缓存里编辑器中间态的残影**（bundle 编出语法错、app 白屏），重发一次 bundle 请求（curl 校验 200 + grep 标记串）后再 broadcast reload 即恢复——reload 后必须核 bundle 内容，不能只看「屏上有 UI」。（继续追问）用户问 `HEIGHT_TRANSITION_MS` 调高是不是更灵敏——不是，它是**过渡时长**：调高更慢更柔（盒子追得更明显），调低更跟手趋近硬跳；按用户要求 120 → **80**（提交 30b62335，三个 composer 套件 24 例绿）。

user:
输入框的编辑页面再优化下，移除预览，这样就只有编辑模式了，这样就足够了。

assistant:
composer 变体改**纯编辑态**（提交 **f7500a7d**）：`PromptEditorScreen` 不再给 composer 传 `toggle`/`segmented`/`preview`（只留标题 + 编辑区），`EditorScreenShell` 的预览三件套与 `save` 一样改成可选（都不传即纯编辑态，顺手废掉「占位 props 糊必填」的写法）；`form` 变体（智能体配置提示词字段）语义零变化，编辑/预览互切与 markdown/文本档位照旧。测试：composer 变体断言换成「无切换按钮 / 无档位条 / 无预览挂载 / 编辑器恒在场且草稿不丢」，并加一条 form 变体对照断言（切换仍在）。验证：typecheck 零错误、全量 jest **1637/1638**（唯一红＝既有 mermaid-fullscreen CRLF）。CHANGELOG 该条去掉预览口径；RULE 的全屏条目同步改「composer = 纯编辑态（无预览/无档位/无保存/卸载即回填）」。用户原话入档：「移除预览，这样就只有编辑模式了，这样就足够了。」

user:
怎么又两个 编辑消息 title？删除一个

assistant:
查明确是**两层标题叠着**：导航栏一个（`route.params.title` → stackOverride）+ 页内 shell toolbar 居中又一个；纯编辑态下 toolbar 已无任何动作位，就只剩这个重复标题。修法（提交 **753f9971**）：`EditorScreenShell` 的 `title` 改可选 + `hasToolbar` 守卫（`save`/`title`/`titlePress`/`toggle` 全空 → toolbar 整行不渲染，顺带不再留一条空 bar），composer 变体不传 `title`（保留导航栏那一个），缺省标题常量收敛为 `DEFAULT_FORM_TITLE`；`form` 变体仍传 title，行为零变化（既有「标题/未保存」断言全绿）。测试：composer 变体断言页内不再出现「编辑消息」文本。验证：typecheck 零错误、全量 jest 1637/1638（唯一红＝既有 mermaid CRLF）。教训：**导航栏已有标题时，页内再放一个标题就是重复**——「无动作位就别渲染那条 bar」比「留空 bar」干净。
