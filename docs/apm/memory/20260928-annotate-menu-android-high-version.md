---
date: 2026-09-28 22:10
title: 批注选区菜单"高版本不生效"四轮闭环定案：HyperOS 替换选区菜单致红米 K70 至尊失效，无官方口子，用户拍板不适配（hold）
keywords: 批注, annotate, menuItems, onCustomSelectionActionModeCallback, react-native-webview, startActionMode, ActionMode.Callback2, Android 高版本, Chromium 选区菜单, RichDocumentWebView, 鸿蒙容器, by-design 门控, 模拟器验证, Pixel_7 AVD, ps16k, LMK, subst, 打点取证, 红米 K70 至尊, HyperOS, ActionPopupWindow, 传送门, hold, 拍板不适配
abstract: 四轮闭环：①brain-storm 推断"新 Chromium 绕过 startActionMode"；②模拟器实测（Pixel_7 API37/Chromium153 + 三处打点）证伪该假设——标准 Android 上 menuItems 机制完全正常（.md 弹[复制,批注]，.txt plain 弹系统三件套）；③用户提供失效机型红米 K70 至尊（HyperOS），MCP 搜索锁定根因：小米系统级替换 AOSP 文本选区菜单（ActionPopupWindow），startActionMode 入口不被调用、弹 WebView 默认"复制/搜索/网页分享"；④调查"小米口子"结论无官方适配 API（dev.mi.com 无文档、社区只能 hack、xiaomi.eu 逆向者断言只能等小米修）；方案收敛为 selectionchange+RN 浮层（业界标准绕法，desktop 已有并存先例）。**用户拍板（2026-09-28）：hold 不适配，小米设备上批注能力接受不可用**；RULE.md 批注词条已补记防重复排查。留存：打点 worktree D:\Dev\nm-worktree\nmAnn（分支 verify/annotate-menu@17cb1643）。
---

user:
「批注功能在高版本不生效，选中文字后未显示批注/复制，而是原生的按钮菜单」（发起 brain-storm 排查答疑）

assistant:
## 结论

mobile 的「批注/复制」划词菜单不是网页内 DOM 自绘，而是 react-native-webview 13.16.1 的 `menuItems` + `onCustomMenuSelection` 机制：`RichDocumentWebView.tsx:42-45` 定义 `[{复制,copy},{批注,annotate}]`，`:389-394` 仅 `annotateEnabled` 时挂载。Android 原生实现（`node_modules/react-native-webview/android/.../RNCWebView.java:156-216`）靠重写 `View.startActionMode(callback, type)`，在 `ActionMode.Callback2.onCreateActionMode` 里只添加自定义两项、不调系统 callback——所以**机制生效时菜单里只有复制/批注两项**；用户看到系统原生菜单（含分享/全选等）即证明 override 从未执行。

高版本失效机制：该 hack 依赖 WebView 内核在文字选区时回调 `View.startActionMode`；新版 Chromium（Android System WebView）把选区菜单改为内核自绘浮条（SelectionPopupController inline popup），不再走该入口 → 替换逻辑整条失效。联网核实（Chromium issue 41168021、Zotero android #297、SO 22336903 佐证 override 选区菜单是长期难题）确认这是机制级失效而非项目代码回归：menuItems 挂载代码自 2026-07-19（8778eaf9）后无功能性变更，mobile-perf-2026-09 迭代只动 chat-transcript 不涉 rich-document。注意网上「menuItems 是 iOS-only」的说法过时（那是 #2522 时代），13.16.1 Android 实现已存在，但依赖上述脆弱入口。

app 原生工程手工探索确认：`apps/mobile/android/app/src/main/java` 仅 MainActivity.kt/MainApplication.kt，无自定义 ActionMode/WebView 代码，styles/manifest 无 windowActionModeOverlay 类配置——原生侧完全裸依赖库实现，项目侧无任何按 Android/WebView 版本分流的代码。

## 排查时须先排除的 by-design 分支（弹原生菜单是设计行为）

1. 非 .md 文件：v1.5.21（273d06dc，2026-09-19）起 txt/yaml 等在 Markdown Tab 走 plain RN Text 渲染，批注菜单按设计不挂（拍板记录 `20260919-mobile-md-overlimit-html-leak.md` 第 38 行）。
2. 门控不满足：`file-annotate-gate.ts:18-29` 要求 previewMode + session 工作区 + sessionId 非空；全局/项目/技能/物理文件、编辑态一律 false。
3. 预览引擎/渲染分支：KKV `vfsMarkdownPreviewEngine` 被切成 `rn`（默认 webview）、plain tab（renderKind!=='markdown'）、正文超限 mdOverLimit——任一命中都不渲染 WebView 或不挂菜单。

门控满足与否高低版本表现应一致，用户「低版本正常、高版本失效」的表述更指向环境差异（WebView 版本），但排查仍须先过这三条。

## 修复候选（未拍板）

① 升级/patch react-native-webview 覆盖 Chromium 新入口（fork RNCWebView.java 同时覆盖 startActionMode 两签名或 window 级 onActionModeStarted）；② Web 层自绘菜单兜底（selectionchange/touchend 定位选区 + DOM 菜单 + postMessage）——`annotate.ts:1-7` 注释表明这条路被刻意排除过（会与系统菜单打架），采用须同时禁用系统菜单路径，方案级变更；③ RN 侧「选中后浮出按钮」类入口，不依赖 ActionMode，改动最小。真机定性手段：chrome://inspect 看 `window.__nmCollectRecogitoSelection` 是否挂载（区分「菜单未弹」vs「inject 后采集失败」）、设置→应用→Android System WebView 看版本并与正常设备对照（变量是 WebView 版本而非 OS 版本）。

## 待用户补充

设备具体环境（Android 版本 + Android System WebView 版本，或鸿蒙容器型号）、复现文件是否 .md、是否在聊天会话工作区 MD Tab 打开。上游 react-native-webview 对该失效是否已有 issue/修复版本未最终核实到确切里程碑。

---

user:
「没有搞版本真机给你测试，不过可以用模拟器验证。如果需要更改代码验证，建议你在这个目录创建一个worktree，更方便。」（指定 D:\Dev\nm-worktree 为 worktree 落点）

assistant:
## 第二轮：模拟器打点实测（结论反转）

用户拍板无真机、走模拟器 + worktree。执行：`git worktree add -b verify/annotate-menu D:\Dev\nm-worktree\nmAnn main`（HEAD 17cb1643）→ npm install + `npm run build --workspaces` + `build:webview:native` → 三处打点 → `subst X:` 短路径 `gradlew assembleDebug`（8m08s）→ 装入 Pixel_7 AVD 无头实测。打点：①`RNCWebView.java` 的 `startActionMode(callback,type)` 入口与 `onCreateActionMode`；②`RNCWebViewManagerImpl.setMenuCustomItems`（验证 props 到原生）；③`MainActivity.onActionModeStarted` override（window 级探针，直接打印菜单项）。

### 核心结果（logcat NMMenu 铁证）

- **note.md（会话工作区、Markdown Tab、WebView 门控全满足）长按划词**：`setMenuCustomItems: size=2`（props 到原生）→ `startActionMode(callback, type=1) invoked; menuCustomItems=size 2` → `onCreateActionMode invoked; adding 2 custom items` → `Activity.onActionModeStarted: menu=[复制,批注]`。浮条以 app 主题色（青绿 0,133,119）渲染、范围 x104-304/y728-780（Chromium 自绘浮条，uiautomator 树不可见属正常）。**第一轮「新 Chromium 绕过 startActionMode」的推断被证伪**——标准 Google WebView 153（API 37 / Android 17）上机制完全正常。
- **note.txt（非 .md，plain RN Text 渲染）长按**：不走 WebView（零 NMMenu startActionMode），window 级探针 `onActionModeStarted: menu=[Copy,Share,Read aloud]`——**系统原生菜单，与用户「原生的按钮菜单」症状完全吻合**。v1.5.21 起 273d06dc 非 md 在 Markdown Tab plain 化是拍板取舍，用户感知为"批注失效"。
- 点击「批注」按钮的完整闭环（→recogitoCreate→modal）无法在模拟器完成：合成触摸（input tap / motionevent）点不中 Chromium 自绘浮条（每次触发重新选择）——模拟器合成事件限制，非产品缺陷；菜单内容已由 window 级探针直接给出，闭环无必要。

### 残余嫌疑（按可能性排序）

①用户划词的是非 .md 文件（txt/yaml/json…，弹系统菜单 by-design）——症状像素级吻合；②国产容器/ROM WebView（鸿蒙卓易通/出境易、华为荣耀定制内核）不走标准 startActionMode——需真机确认；③其他门控（非会话工作区、引擎 rn、编辑态）。**"标准 Android 高版本"本身可以排除**。

### 验证方法论（可复用）

首启门控链全 UI 建立（库只读纪律）：对话 tab「新建会话」静默失败根因 = `handleCreateSession` 要求 projectId（useChatTabScope.ts:250）——正确顺序：项目抽屉建项目 → 我的-智能体配置新建 agent1（否则 toast「workspace 未配置 Agent，且 registry 为空」，.catch 吞错无日志）→ 新建会话 → 聊天工作区-更多操作-新建文件 → 编辑保存 → 预览。

### 新环境坑（Pixel_7 AVD / API 37 ps16k 镜像）

1. **hw.ramSize 默认 2048 会 LMK 杀前台 app**（Kill com.novelmaster to free 218MB rss，min watermark）——config.ini 调 4096 解决（主机 31GB 充裕）。
2. ps16k 镜像对非 16KB 对齐 app 每次启动弹兼容警告（点 Don't Show Again 可关）。
3. **该模拟器 `input text` 大量丢字符**（%s 转义错乱 + 随机丢字母，两次实测 26 字符只进 9 个）；正文乱码无碍验证（划词不需要语义）。
4. **toggle 型按钮（预览↔编辑）禁止双击保险**——两下切回原态；「保存」「新建」等单次动作按钮则常需点两下。
5. metro 必须在 gradle 构建结束后启动（构建期间启动，watcher 盯 .cxx 竞态 ENOENT 崩）。
6. uiautomator dump 看不到 Chromium 自绘浮条（合成层），取证用 window 级探针日志 + 截图像素扫描（按主题色定位菜单 bounds）。
7. Pixel_7 首启 WebView 145.0.7632.218，Play 后台自动升 153.0.8010.36——ps16k 镜像自更新活跃。

### 留存物

worktree `D:\Dev\nm-worktree\nmAnn`（分支 verify/annotate-menu@17cb1643，未合并；MainActivity 打点在 git diff，RNCWebView/ManagerImpl 打点在 node_modules 不跟踪）——真机复测时可复用（重编后 logcat -s NMMenu 直接看三段证据）。模拟器 Pixel_7 已于当晚验证结束后退出（AVD 内存 4GB 配置已固化在 config.ini，emulator -avd Pixel_7 重启即用；首启有 16KB 兼容警告需点掉）；metro 后台进程仍在（真实路径 D:\Dev\nm-worktree\nmAnn\apps\mobile 起，模拟器不在时为空转，可随时停）。

---

user:
「失效机型是红米k70至尊，可能得你mcp搜索试试了」

assistant:
## 第三轮：机型定性（MCP 搜索）——根因锁定小米系统级替换文本选择菜单

用户提供失效机型：红米 K70 至尊（天玑 9300+，HyperOS——2024-11 起 HyperOS 2/Android 15，2026 年起 HyperOS 3.0.304.0/Android 16）。MCP 搜索三路证据：

1. **Xiaomi.eu 帖 56767（实锤）**：维护者 Igor Eisberg（逆向修复过该问题）结论——「Xiaomi disables AOSP's text selection popup and replaced it with their own implementation」；小米实现非标准（`onPrepareActionMode` 从不被调用；Android 11 官方 ROM 的 ActionPopupWindow 实现"removed any possibility of support for custom actions"= 彻底无解）；帖内 RN 开发者报 react-native-selectable-text（`setCustomSelectionActionModeCallback`）在小米上同样失效、其它安卓正常；"Android 12 起正常支持"仅限 xiaomi.eu 自制 ROM 补丁，官方国行 ROM 不在其列。
2. **火山引擎文章 829026（华为同族案例）**：部分华为设备 WebView 选区菜单触发走 `showContextMenu` 而非 `startActionMode`，重写 startActionMode 整体失效——国产 ROM 替换文本选择菜单是家族性问题。
3. **dcloud + SO 45165150**：小米「传送门」（Taplus）系统级劫持长按致 app 无法监听（独立嫌疑，可能叠加）；MIUI 时代 setCustomSelectionActionModeCallback 就已失效。

**终局结论**：K70 至尊失效 = HyperOS 系统级替换文本选择菜单实现（叠加可能的传送门长按劫持）→ react-native-webview menuItems 的 `startActionMode` 重写整条不被执行 → 弹小米系统菜单。与第二轮实测互洽：标准 Android（Google WebView 153/API 37）正常，问题只存在于国产 ROM 替换层——用户「其它机型正常、K70 至尊失效」的机型特异性完全吻合。**menuItems 路线在小米官方 ROM 上无解**（系统级行为，非 app bug，无法靠升级库解决）。

修复方向（待拍板）：① Web 层自绘菜单（selectionchange+DOM 浮层；系统菜单会并存弹出，是当初被排除的原因，需接受并存或配合禁系统选择交互）② RN 侧独立入口（预览态「新建批注」按钮 → 选择原文 → 确认，不依赖选区菜单，改动最可控）③ 真机取证复用 verify worktree：`onActionModeStarted` 探针可区分两种机制——报出系统菜单项=菜单替换；完全不触发=长按劫持（传送门）。用户自查：看弹出的菜单是否含小米特色项（翻译/识别/搜一搜/超级小爱）；设置搜「传送门」关掉再试。

---

user:
「菜单是复制/搜索/网页分享」+ 方案讨论（默认选原文模式可行性、菜单错位成本）+「小米系统这样更改底层API，理论上应该会开放其他口子吧？」

assistant:
## 第四/五轮：菜单形态确认 + 方案收敛 +「小米口子」调查

1. **菜单形态实锤**：用户 K70 至尊弹出「复制/搜索/网页分享」= WebView 默认选区三件套（无小米 AI 项 → 不是传送门劫持）。因 react-native-webview 包装的 onCreateActionMode 只加自定义项、不调原始 callback——若 startActionMode 重写被调用菜单只会有两项；出现默认三件套 = **重写入口整体未被调用**（华为式绕路：菜单触发不走 View.startActionMode）。
2. **方案收敛（用户质疑修正）**：「错位/定位避让」是所有 RN 浮层路线的共同成本（选区定位逻辑都要写 + 小增量避让：系统浮条在选区上方、RN 浮层放下方，仅底端翻转），不是「默认无模式」独有代价。真正分野收敛为：menuItems=赌 ROM（已输）；RN 浮层=共同底座；显式 vs 无模式=打扰面 + 是否借「点选句子」（tap 不触发系统菜单）绕开并存（代价：失去任意子串选择）。desktop 端 1.4.01 起「保留系统复制菜单 + 自家浮动条」并存形态已验证可行；mobile 当初排除并存是因 DOM 浮层被系统菜单盖住（WebView 内层），RN 层浮层无此问题。倾向：默认无模式 + selectionchange + RN 浮层。
3. **「小米口子」调查（MCP 搜索）——结论：没有官方口子**：
   - dev.mi.com 开发者平台只有系统版本适配指南（Android 12/15）与 WebView 折叠屏适配，**无任何选区菜单定制 API 文档**；
   - 掘金《EditText长按菜单中分享功能的隐藏方法》：小米等手机连菜单项隐藏都做不到，社区通用应对是 hack（拦截 startActivityForResult 让分享功能失效）；
   - xiaomi.eu 修复者是逆向恢复 AOSP 代码而非用小米接口，原话「It's up to Xiaomi to fix this nonsense」（只能等小米修）；
   - 版本摇摆：MIUI 12 曾支持自定义项 → Android 11 版本移除（"game over"）→ Android 12 起 xiaomi.eu 自制 ROM 恢复——官方国行各版本行为不可依赖；
   - 业界事实标准=绕开：阅读类 App（微信读书等）从不用系统选区菜单，全部自绘选择交互；掘金 2024-12《Android WebView（完全）自定义文本选择弹窗》即完全自绘方案教程。华为同族问题同样无口子（火山文章答案也是绕：showContextMenu 拦截）。
   - 判断：小米替换选区菜单是自家功能入口（搜索/翻译）的产品决策，无动力维护第三方自定义兼容；**等口子不如绕开**——支持方案 ②（selectionchange + RN 浮层）的技术判断。

---

user:
「记录下吧，先hold吧，小米不适配也没什么其他好办法了，顶多批注能力用不了」

assistant:
## 终局拍板（2026-09-28）

用户拍板：**hold，不做小米适配**——selectionchange + RN 浮层方案搁置不实施；小米/HyperOS 设备（红米 K70 至尊等）上批注划词能力接受不可用，作为已知取舍。配套动作：RULE.md「批注（annotate）」词条补记该结论（跨会话规则，防止未来会话把它当 bug 重复排查或误立项）；metro 空转进程停掉；打点 worktree（D:\Dev\nm-worktree\nmAnn，分支 verify/annotate-menu）与模拟器 AVD（4GB 配置已固化）保留，备日后真机复测或重启适配时复用。若未来重启适配，技术底座已备齐：方案定稿为「默认无模式 + selectionchange + RN 层浮层」（详见第四/五轮），desktop 端并存形态先例可参照。
