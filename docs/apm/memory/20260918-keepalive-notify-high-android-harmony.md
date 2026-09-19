---
date: 2026-09-18 22:40
title: 常驻通知在高版本安卓/鸿蒙6 降级为普通通知的机制调研（Android 13/14 行为变更 + 兼容容器）
keywords: 常驻通知, 前台服务, notifee, asForegroundService, Android 13 可划掉, Android 14 setOngoing 失效, dataSync 6小时上限, specialUse, 鸿蒙6, 卓易通, 出境易, Clash, CMFA, VPN 通知
abstract: 用户发现保活常驻通知在低版本安卓正常、鸿蒙6/高版本安卓变普通通知。定案：Android 13 起前台服务通知默认可被用户划掉（不分 targetSdk），Android 14 起 setOngoing(true) 也拦不住（豁免仅锁屏/清除全部/CallStyle/DPC/媒体通知），是系统行为非代码 bug；咱们 manifest 的 dataSync 声明齐全，服务划掉后仍在跑。Clash（CMFA targetSdk 35，setOngoing+specialUse+FOREGROUND_SERVICE_IMMEDIATE，与咱们同构）划不掉是国产 ROM 对 VPN/白名单应用的 ROM 级待遇——原生安卓 14/15 上 v2rayNG/Clash 同样会被划掉（有 issue 实证）。鸿蒙 6 是纯血系统不跑 APK，APK 经卓易通/出境易/伏羲容器运行，FGS 提升被容器降级为普通通知，APK 侧无解。另发现 dataSync 类型在 Android 15+ 有 6 小时上限，常驻开关场景可考虑换 specialUse（侧分发不经 Play 审核）。
---

user:
（恢复记忆后问）鸿蒙 6 或高版本安卓的常驻通知栏是怎么调用的？当前代码在低版本安卓常驻正常，但在鸿蒙和高版本安卓上是普通通知栏。又追问：但 VPN 类软件（如 Clash）的通知不会被简单清除。

assistant:
调研结论（未改代码，纯答疑）：

① 高版本安卓是系统行为，不是 bug。官方 behavior changes：Android 13（API 33，所有 app 不分 targetSdk）起前台服务通知默认可被用户划掉，划掉后服务继续运行、进「活跃应用」FGS 任务管理器；Android 14 起 `FLAG_ONGOING_EVENT`/`setOngoing(true)` 的不可划掉语义也被放开，豁免仅剩：锁屏中、清除全部按钮、CallStyle 通知、DPC 企业包、媒体通知、默认搜索选择器。咱们 notifee 的 `asForegroundService + ongoing: true`（agent-finished-notification.ts）在 <13 设备被系统强制常驻、在 13+（含 targetSdk 36 的咱们）就是可划的普通样式，与观察完全吻合。manifest 的 `ForegroundService` dataSync 类型 + FOREGROUND_SERVICE_DATA_SYNC 权限齐全，14 上不会挂起。

② Clash 划不掉是 ROM 待遇不是代码优势。读了 ClashMetaForAndroid 源码：StaticNotificationModule.kt 就是 `setOngoing(true)` + IMPORTANCE_LOW channel + `FOREGROUND_SERVICE_IMMEDIATE`，manifest 里 ClashService/TunService 声明 `foregroundServiceType="specialUse"` + PROPERTY_SPECIAL_USE_FGS_SUBTYPE，targetSdk 35——与咱们同构。实证：v2rayNG 在 Android 15 连「清除全部」都会清掉常驻通知（2dust issue）、GrapheneOS/Reddit 确认 14 起常驻可划。所以 Clash 在用户手机上划不掉，是国产 ROM（鸿蒙/EMUI/荣耀等）对活跃 VPN 连接/后台白名单应用的常驻策略，同 ROM 给不给咱们取决于「后台运行/锁后台/省电白名单」设置。

③ 鸿蒙 6 是纯血鸿蒙（NEXT 血统），不原生支持 APK。APK 靠卓易通/出境易/伏羲这类安卓兼容容器（独立安卓运行环境镜像）运行，容器对 startForeground 的提升映射不保证，通知降级为普通是容器层预期行为；要真常驻得 ArkTS 原生重写（长时任务 continuousTask + 通知 API），APK 侧无解。

④ 可选改进（待立项）：a) 接受现状+文案说明「可划掉但服务仍在」；b) deleteIntent 自愈重发（需原生模块，notifee 未暴露，体验有争议）；c) dataSync 在 Android 15+ 有 6 小时超时上限（onTimeout 后被停），常驻开关场景容易超时——可评估换 specialUse（咱们侧分发不经 Play 审核，无审核阻力），需真机验证；d) 国产 ROM 引导用户开后台运行/省电无限制。
