---
date: 2026-09-08 01:05
title: mobile e2e 能力与真机截图+vision 代理找 bug 闭环
keywords: [e2e, appium, wdio, uiautomator2, emulator, android, mobile, adb, screencap, vision]
abstract: 确认 mobile e2e 为 Appium 2 + WDIO + UiAutomator2 可驱动模拟器/真机；随后验证「adb 真机截图 → vision 子代理看图」闭环可用，实测灭屏截黑图、锁屏界面可截、有密码锁屏 adb 解不开、stayon usb 可保常亮。
---

user: 有个问题哈，你看 novelmaster 项目的 mobile 是支持 e2e 测试的对吧？是可以操纵安卓模拟器的？

assistant: 确认支持。技术栈是 Appium 2 + WebdriverIO（wdio）+ UiAutomator2 驱动，配置在 apps/mobile/e2e/ 下：
- wdio.shared.conf.ts 定义 Android capabilities（appPackage=com.novelmaster，优先用本地构建的 debug APK 安装，APK 不存在则用 noReset 直启已装应用），wdio service 自动拉起 Appium 子进程，驱动装在项目本地 .appium 目录（ensure-appium-driver.mjs 保证）。
- 可以操纵安卓模拟器或 USB 真机：README 明确前置是 ANDROID_HOME + 运行中的 emulator/USB 设备，Appium 通过 UiAutomator2 做安装、启动、点击、输入、截图、page source 抓取；afterTest 里还能切换 NATIVE/WEBVIEW context（webview 聊天区也能测）。
- 现有 5 个 spec：smoke.launch、vfs.rename-conflict、chat.rollback、chat.rollback-vfs、chat.tool-phase-and-order；page object 模式组织在 pageobjects/。
- 常用命令（apps/mobile 下）：npm run e2e（全量）、npm run e2e -- --spec e2e/specs/xxx.e2e.ts（单 spec）、npm run e2e:prepare（装 UiAutomator2 驱动）、npm run e2e:build-apk（含 webview 资产的 APK）、npm run e2e:fixture（宿主机 sqlite 往设备库注入 tool-turn 测试数据）。
- 限制：C1 级用例不能在无头 agent 环境跑，需要真实模拟器/设备；失败自动落盘截图 + page source 到 e2e/artifacts/。

user: 你看看是不是有个 vision agent？那能不能你运行模拟器，然后截图，再让代理看看有没有 bug？

assistant: 有 vision 子代理（~/.pi/agent/agents/vision.md，zai-coding-cn/glm-5.3-flash，已端到端验证）。本机 SDK 在 ~/Android/Sdk 但无 emulator/system-images（没装过模拟器，KVM 可用可补装）；意外发现用户真机 DSLDU20407006179（荣耀 EBG-AN00，Android 12）正连着 adb，提出两条路：补装 AVD 或直接用真机截图+vision 找 bug。用户选真机。

user: 真机可以的，但是真机锁屏会影响权限吗？

assistant: 实测结论（Android 12 荣耀真机）：①USB 调试授权不受锁屏影响（设备已 authorized）；②灭屏时 screencap 返回纯黑 PNG（15KB 无内容）；③亮屏+锁屏时可截到锁屏界面本身（vision 子代理读出壁纸/时钟/USB 调试通知，闭环验证成功），但 app 界面在锁屏后面截不到；④锁屏时 input tap/swipe 被锁屏吃掉到不了 app；⑤该机有指纹/密码，adb 无法解锁（wm dismiss-keyguard 只亮屏不解锁）；⑥防再锁方案：用户手动解锁一次后 adb shell svc power stayon usb 保持 USB 连接期间常亮（只防灭屏，不防手动按电源键）。

user: （解锁后）开屏了，你测试下？

assistant: 完整闭环跑通：svc power stayon usb 上常亮 → am start 拉起 app（已在前台）→ 截图会话列表页 → 派 vision 子代理分析（结构完整无报错；疑点：底部 tab 疑似缺安全区 padding、「新会」名疑截断、状态栏灰底不搭——浅色主题系提示词预设错非 bug）→ uiautomator dump 拿元素坐标（RN 节点 text 属性可读，会话卡片中心点可算）→ input tap 点进「新会」会话 → 截图聊天页 → vision 分析（markdown 链接渲染全符合预期、无报错；疑点：进入会话后视口停在长消息中部疑似自动滚底未生效）→ 复测：退出重进同一会话 2.5s 立刻截图，视口已正常在底部（末行完整+无滚动余量），「停在中部」未复现，改判偶发竞态（滚底可能跑赢长消息异步挂载）。结论：adb 操作+截图+vision 找 bug 的全自动闭环可用；遗留线索：进入会话滚底偶发竞态、底部 tab 安全区 padding。vision 子代理也在 docs/apm/memory/20260907-mobile-launch-screenshot-review.md 记了截图分析详情。

user: 其实感觉还是不太方便，还是用模拟器更方便，手机还有锁屏的问题

assistant: 搭好模拟器环境并验证首启：①系统 Java 11 跑不了 sdkmanager（class file 61.0 需 17），无 sudo，从清华 Adoptium 镜像下载便携版 JDK 17 到 ~/tools/jdk-17.0.20.1+1（官方 api.adoptium.net 直连会被断）；②sdkmanager 装 emulator + system-images;android-36;google_apis;x86_64（匹配项目 targetSdk 36），licenses 之前已接受；③avdmanager 建 AVD nm-e2e（Pixel 5 规格 1080x2340，与真机同分辨率）；④headless 启动：nohup emulator -avd nm-e2e -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -wipe-data；⑤无密码 swipe 锁 wm dismiss-keyguard 一句解开（对比真机指纹锁解不开），svc power stayon usb 保常亮；⑥安装现成 app-debug.apk（189MB，当晚 00:59 e2e 产物）Success；⑦首启验证：6 秒帧「正在加载...」spinner 占位页（正常中间态），20 秒帧已进入主界面（会话空列表 + 版本检查弹窗「当前已是最新版本」），无红屏/崩溃，首启验收通过。注意两台设备并存时 adb 必须 -s emulator-5554 指定。模拟器上小瑕疵：状态栏时间顶端被裁半（疑与 targetSdk 36 edge-to-edge 相关，真机上未见）、底部 tab 文字贴手势条。

user: 创建一个 skill 吧，主要就是如何 e2e 测试，如何用 vision agent，就是你上面干的事情。

assistant: 新建项目级 skill .agents/skills/mobile-adb-vision/SKILL.md：移动端 adb 截图巡检 + vision 审查闭环。内容：与 wdio e2e 套件的分工（轻量巡检 vs 正式回归）；硬路径事实（adb/emulator/AVD nm-e2e/JAVA_HOME 17/APK 路径/真机序列号、多设备 -s 指定）；模拟器首选路径（headless 启动、boot 等待、dismiss-keyguard、stayon、装 APK、首启时序与版本弹窗）；真机备选路径（锁屏限制四条、先问用户）；操作循环（uiautomator dump 坐标提取 python 脚本、tap/swipe/keyevent、逐步截图、滚动疑点复测法）；vision 派遣模板与实战要点（主会话模型看不了图必须派 vision、背景要给足但别把假设当事实、多帧对比一次派、vision 观察由主代理判定、抽查它自己写的记忆）；首轮遗留线索四条（状态栏裁半/安全区 padding/滚底竞态/状态栏配色）；收尾（apm 记忆、缺陷登记、汇报口径）。


---

2026-09-22 增量轮（storage-cache-dedup-and-cleanup 数据清理，Windows 环境首次）：本机 Android SDK 在 LOCALAPPDATA（adb/emulator 在 PATH），AVD 用 Medium_Phone_API_36.1（nm-e2e 不存在——skill 环境块是旧 Linux 机器的）。全链结论：数据清理功能 e2e 通过——造数 6.5MB 孤儿 blob（python 经 adb 通道：exec-out run-as cat 拉库→seed→/data/local/tmp 中转推回，sdcard 通道被 SELinux 拒）→ UI 库体积 6.2 MB→清理→236 KB，设备文件 6545408→241664 bytes；vision 五张全正常。Windows 新坑三条：① e2e:build-apk 的 APK 缺 RN JS bundle（debug 变体默认连 metro），需先 npx react-native bundle --dev false 打进 assets 再 assembleDebug；② 模拟器残留 7-27 史前库（files/default/ 旧路径）升级触发器炸 no such column: ref_count——低于 v1.5.5 基线的库不在支持范围但报错形态不友好（线索留档）；pm clear 后新库在 databases/novel_master_vfs；③ adb shell run-as cat 拉 SQLite 二进制会被 pty CRLF 污染（malformed），必须走 exec-out 通道。遗留线索更新：底部导航「我的」贴边在模拟器 API 36 也观察到（此前真机中置信度线索），持续留查。
