---
date: 2026-10-03
tags: [mobile, webview, android, background-recycle, chat-conversation]
source: 真机验收轮用户报障
---

# WebView 长时间后台回来「对话页加载失败」诊断

## 用户诉求

真机（DSLDU20407006179，imex 分支 13 笔已装）长时间放后台后回来，聊天页显示「对话页加载失败 / 输入组件版本可能过低，请重启应用 / 重载」。用户猜测 webview 被回收。

## 诊断结论（assessment，修复待拍板）

错误页 = `ChatConversationWebView.tsx` 的 `readyFailed` 态：8s 握手兜底计时器（READY_TIMEOUT_MS=8000，`armReadyTimeout`）到期且 `webReadyRef.current === false`。

真机 logcat 实锤（tmp/logcat-webview-crash.log，worktree imex）：

1. **长时间后台 = 整个 app 进程被系统杀**，不是只有 WebView：`21:25:35 ActivityManager: Killing 29560:com.novelmaster (adj 0): stop com.novelmaster due to from pid 2321`（荣耀后台管理发起的 stop）。用户回前台 = 冷启动。
2. 短后台→回前台的 visibility dirty 重挂链（`visibility {hidden:false}` + `statePushSinceResumeRef>0` → repaintEpoch+1）是健康的：21:20 三次重挂 ready 都 ~100ms 到达。
3. 21:28 冷启动握手 3.5s 成功——冷启动路径本身没病，**19:11 那次是冷启动变体失败**（日志已被冲掉，最可能分支：恢复时 Activity/屏幕不可见 → Chromium 对 hidden WebView 冻结 JS → DOMContentLoaded/ready 延迟超过 8s → 计时器误判；RN JS 线程不依赖 Activity 可见性，计时器会准时到期）。
4. react-native-webview 13.16.1 的 `onRenderProcessGone`：只发事件不做恢复；**本组件没监听**（也无 AppState 监听）——渲染进程死=白屏死态、宿主无感知（webReadyRef 停留 true）。
5. web 侧 ready：DOMContentLoaded 后立即发，不依赖 fonts/首帧；但有装配闸门（composer/dock 壳未命中不发）——现时段无「装配未完成」日志，排除。

## 修复方向（待用户拍板）

- **计时器加 AppState 感知**：到期时若 app 非前台，顺延到回前台再判/重计时（锁屏冻结不再误判）。
- **回前台自动恢复**：AppState active 且 readyFailed → 自动 handleReload（免手点；重启/重载虽能单次恢复，但用户不该被迫手动做这件事）。
- **补 onRenderProcessGone 监听**：渲染进程死 → 主动重挂（repaintEpoch+1），别留白屏死态。
- 文案改为与真实故障匹配（如「页面未响应，点重载恢复」）。

## 第二轮：用户纠偏（2026-10-03）

- **纠正我方表述**：错误页出现后「重启应用能恢复，点重载也能修好」——此前写「重启不解决问题」不准确。重启/重载只是**单次恢复**有效，根源（系统杀进程/冻结后冷启动变体撞 8s 误判）仍在，再放后台还会复现。
- **用户定性（正确）**：这是 chat-webview-unify 的**回归**——RN 原生实现（FlatList/TextInput 时代）没有这个问题。RN 版整个页面单进程渲染，不存在跨进程 ready 握手；进程被杀重启就是普通冷启动，不会出现专用错误页。WebView 版是双进程协作（RN 宿主 + Chromium 渲染进程），8s 兜底计时器把「系统冻结/回收对面」误判成「装配失败」，把系统资源事件穿透成了用户可见错误页——这就是回归本质。
- 修复定位随之更新：不是「治错误页」（本来就能恢复），是把 WebView 版的恢复韧性拉回 RN 版水平——回前台自动恢复 + 计时器前后台感知 + onRenderProcessGone，目标是用户**看不到**这个错误页。

## 第三轮：用户拍板修复（agile-dev）

- 类型 bug / 敏捷名称 `webview-background-ready-fail` / 父级 chat-webview-unify（回归源）。
- 改动落 imex worktree（feat/vfs-import-export-menu 分支，真机在测的包；edit 工具顺手修先例同分支）。文档落 worktree docs/Iterations/chat-webview-unify/bugs/webview-background-ready-fail/。
- 修复四点：①armReadyTimeout 到期时 AppState 非 active 不判死，回前台重新计时 ②AppState active 且 readyFailed 自动 handleReload ③补 onRenderProcessGone 监听→重挂 ④误导文案修正。RN TS 改动，Metro reload 即生效（不涉及 webview dist）。

## 第四轮：修复落地（agile-dev 完成）

- 探索子代理补齐事实（9 条风险点：jest AppState mock currentState 为 undefined 是最大坑）；实现子代理单笔 e9960db82 落地四点修复 + telemetry 补 render_process_gone 事件 + 组件级套件新增四用例；主代理抽查 diff 全符合设计并复跑门禁（两套 71/71 + tsc 0 错）。
- 关键设计拍板：非前台显式列举 background/inactive（未知态当前台，兼容 jest 与启动早期）；回前台自愈复用 handleReload（错误态 early-return 后唯一自洽入口）；readyFailedRef 镜像避免订阅反复摘挂。
- 附带修复：chat-tab-screen.integration 残留 mock 已删模块 session-messages-loader（6594b67c9 Wave D 删净）补 {virtual:true}——HEAD 既有加载期红，非本轮引入，commit message 已标注。
- 留痕：worktree docs/Iterations/chat-webview-unify/bugs/webview-background-ready-fail/{prd,spec}.md（提交 4b3b2fc29）。分支 feat/vfs-import-export-menu 现 15 笔（e9960db82 代码 + 4b3b2fc29 文档）。
- 真机验证待用户：Metro（PID 34212）与 reverse 在线，纯 RN TS 改动 reload 即生效（不涉及 webview dist 重建）；复现路径=长时间后台→回前台应自动恢复不再见错误页。

## 第五轮：merge+changelog+worktree 清理（迭代收口）

- 用户拍板 merge。冲突预处理：主仓未跟踪 vfs-import-export-menu 草稿（prd 逐字同/spec 差一行 D1 门闸口径——分支版为正式版）照先例清草稿取分支版；chat-webview-unify/bugs/ 两边不同文件不挡（主仓旧 workspace-stale-on-session-switch.md 保留）。
- merge --no-ff 521a1ebcb（48 文件 4406+/234- 零冲突，main 零领先纯 ff 场景）→ changelog a5a2994a2（Unreleased 四条：变更×2 菜单收敛+edit 诊断可读、新增×1 单文件导入导出、修复×1 后台回收自愈；缓存统一并入新增设计不单列、virtual mock 测试基建不写）。未 push（等指令）。
- worktree 清理：先 taskkill Metro（PID 34212，占文件）→ worktree remove 因 node_modules 超长路径残目录 → `rd /s /q "\\?\D:\Dev\nm-worktree\imex"` 长路径前缀删净 → 空父目录同删 → 分支 feat/vfs-import-export-menu 已删（was 4b3b2fc29）。
- 注意：真机 debug 包 bundle 来自已删的 worktree Metro——app 现状仍可运行，但 reload 会失败；后续真机调试需从主仓（main=已含全部改动）起 Metro + 重装/重连。

## 复现/验证手段

锁屏放置 5-10 分钟（荣耀后台管理 stop）→ 解锁回 app 看是否落错误页；同时 `adb logcat` 盯 `ActivityManager: Killing`、`nm-boot`、`chat-conversation` 三类行。
