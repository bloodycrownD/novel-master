---
name: mobile-adb-vision
description: novel-master 移动端轻量 UI 巡检闭环：adb 操控安卓模拟器（首选，AVD nm-e2e 无头跑）或荣耀真机（备选，需用户解锁）→ uiautomator 定位 + input 模拟操作 → screencap 截图 → 派 vision 子代理（glm-5.3-flash）审图找 bug。需要在安卓设备上巡检 mobile UI、截图找 bug、模拟点击操作时使用；正式回归仍走 Appium wdio 套件（apps/mobile/e2e/）。
---

# 移动端 adb 截图巡检 + vision 审查

## 定位：与 wdio e2e 的关系

| 场景 | 用哪个 |
|---|---|
| 轻量 UI 走查、截图找 bug、快速冒烟 | 本 skill（adb + vision，无需 wdio/Appium） |
| 正式回归（既有 5 个 spec：smoke/vfs.rename/rollback×2/tool-phase） | `apps/mobile/e2e/` 的 Appium wdio 套件 |

本 skill 是「人肉走查的自动化替身」：模拟操作 → 截图 → vision 看图报疑点，主代理判定。走查结论按三分类处理（脚本侧问题 / 产品缺陷 / 设计意图），可参照 desktop-e2e-vision skill 的结论分类口径。

## 1. 环境事实（硬路径，勿重找）

- **adb**：`~/Android/Sdk/platform-tools/adb`（不在 PATH，写全路径或先 alias）
- **emulator**：`~/Android/Sdk/emulator/emulator`（KVM 加速，`/dev/kvm` 可用）
- **AVD**：`nm-e2e`——Pixel 5 规格 1080x2340、API 36 google_apis x86_64（与项目 targetSdk 36 对齐，分辨率与真机一致）
- **JAVA_HOME**：`~/tools/jdk-17.0.20.1+1`（sdkmanager/avdmanager 需要 17；系统 Java 11 会报 `UnsupportedClassVersionError`；无 sudo，勿 apt）
- **APK**：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`（不存在时跑 `npm run e2e:build-apk`，会带上 webview 资产——webview 改动必须重装 APK，见项目记忆）
- **真机**：荣耀 `DSLDU20407006179`（Android 12，浅色系统）USB 在线时可直接用，但优先用模拟器（见下）
- 两台设备并存时 adb 命令**必须** `-s emulator-5554`（模拟器）/ `-s DSLDU20407006179`（真机）指定，否则报 more than one device

## 2. 模拟器路径（首选）

锁是无密码 swipe 锁，`wm dismiss-keyguard` 一句解开，全程无需人碰。

```bash
ADB=~/Android/Sdk/platform-tools/adb

# 启动（无头，不占桌面；-wipe-data 可选：想重置到全新首启时加）
nohup ~/Android/Sdk/emulator/emulator -avd nm-e2e -no-window -no-audio \
  -no-boot-anim -gpu swiftshader_indirect -no-snapshot [-wipe-data] \
  > /tmp/emulator-nm-e2e.log 2>&1 &

# 等 boot + 解锁 + 常亮
$ADB -s emulator-5554 wait-for-device
$ADB -s emulator-5554 shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
$ADB -s emulator-5554 shell wm dismiss-keyguard
$ADB -s emulator-5554 shell svc power stayon usb   # USB 在线期间保常亮

# 装 APK + 启动
$ADB -s emulator-5554 install -r <repo>/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
$ADB -s emulator-5554 shell am start -n com.novelmaster/.MainActivity
```

已知时序：首启（全新数据）6 秒左右停在「正在加载...」占位页，约 20 秒进主界面；进主界面后大概率弹「版本检查」模态（盖在最上层），要走到主界面本身需先点「关闭」。巡检前先等加载退场，别把加载页当 bug。

跑完不用关模拟器（下次巡检直接复用）；要彻底重来就 kill 进程 + `-wipe-data` 重启。

## 3. 真机路径（备选，先问用户）

真机是用户日用机，动它之前必须用户点头。限制实测如下：

- **锁屏**：指纹/密码锁 adb 解不开（`wm dismiss-keyguard` 只亮屏）——需用户手动解锁一次，再 `svc power stayon usb` 保常亮（只防自动灭屏，不防手动按电源键）
- **灭屏时** `screencap` 返回纯黑 PNG（~15KB，无信息），不是报错
- **锁屏时** `input tap/swipe` 被锁屏吃掉，到不了 app
- 屏幕上是用户真实数据，截图前注意隐私

## 4. 操作循环（两台设备通用）

```bash
# 拿坐标：RN 节点 text/bounds 可读，python 算中心点
$ADB -s <dev> shell uiautomator dump /sdcard/ui.xml
$ADB -s <dev> pull /sdcard/ui.xml /tmp/ui.xml
python3 -c "
import re
xml = open('/tmp/ui.xml', encoding='utf-8').read()
for m in re.finditer(r'text=\"([^\"]*)\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', xml):
    t = m.group(1)
    if t:
        x1,y1,x2,y2 = map(int, m.groups()[1:])
        print(f'{t!r}: ({(x1+x2)//2},{(y1+y2)//2})')
"   # 按需过滤关键词

# 模拟操作
$ADB -s <dev> shell input tap 408 1490          # 点击（坐标来自上一步）
$ADB -s <dev> shell input swipe 540 1800 540 600 400   # 上滑（可用来验证是否已滚到底）
$ADB -s <dev> shell input keyevent 4            # 返回

# 截图（每步一截，命名带序号，方便 vision 引用）
$ADB -s <dev> exec-out screencap -p > /tmp/nm-<场景>-<序号>.png
```

要领：

- 每次界面跳转后 `sleep 2~3` 再截，RN 导航动画和列表挂载需要时间
- **验证滚动定位类疑点**（如「进入会话没滚到底」）：退出重进 + 立刻截（缩短延时抓现行），再 swipe 后截一帧对照——两帧逐像素一致即已在最大滚动位置
- 疑点复现不了就明说「未复现，倾向偶发竞态」，别硬下结论

## 5. vision 审查（每批截图跑完即派）

**主会话模型不支持图片输入**，`read` 图只会得到 omitted——看图必须派 `vision` 子代理（`~/.pi/agent/agents/vision.md`，glm-5.3-flash）。

派遣 prompt 模板（subagent 工具，agent 填 `vision`）：

```
请用 read 工具读取这张安卓手机截图：<png路径>（1080x2340，<模拟器 API 36 / 荣耀真机 Android 12>，
novelmaster React Native 应用，<浅色/深色>主题）。

背景：<当前在哪个页面、刚做了什么操作、预期应该看到什么>。

请描述：
1. 当前显示的界面结构（顶栏/列表/内容/底部导航各有什么）
2. 布局有无异常：错位、重叠、文字截断、空白区块、渲染破损
3. 报错迹象：红屏/黄屏（RN 错误）、崩溃弹窗、toast、加载卡死

最后给出结论：界面是否正常，可疑 bug 迹象按置信度排序。
```

要点（从实战来的）：

- **给足背景**：分辨率、机型、主题、刚做的操作、预期状态。注意别把假设当事实塞进去（曾把「深色主题」写进 prompt，用户设备明明是浅色，vision 白报了一条「主题不对」）
- 多张对比图（如复测前后）一次派一个任务，让它逐帧对比，结论更硬
- vision 擅长抓：布局破损、截断、静默失败（前后帧无差异）、渲染不一致；它给的是**观察**，算不算产品 bug 由主代理对照代码/设计判定
- vision 子代理继承项目记忆规则，会自己往 `docs/apm/memory/` 写审查记录——**交付后抽查一眼**（它把「主会话派遣」写成「用户」之类的主语小误差可放过，技术细节错了要处理）

## 6. 已知设备侧差异与遗留线索（2026-09-07 首轮记录）

- 模拟器（API 36）上状态栏时间顶端被裁半截，疑与 targetSdk 36 edge-to-edge 相关，真机未见——待查
- 真机底部 tab「对话/我的」疑似缺手势导航安全区 padding（中置信度）——待查
- 进入会话偶发未滚到底（首进停长消息中部，复测正常，疑滚底跑赢异步挂载）——待蹲复现
- 真机状态栏灰底与白顶栏衔接不协调（外观小瑕疵）

新一轮巡检先看这些线索有没有被修掉/复现，结论写进巡检记录。

## 7. 收尾（不可省）

1. apm 记忆：巡检结论追加到 `docs/apm/memory/20260907-mobile-e2e-capability.md`（同主题续写，刷新 frontmatter date；vision 自己写的审查记录文件无需合并，注明路径即可）
2. 发现的产品缺陷按项目惯例登记（bugs/ 或对应 PRD），现象 + 截图编号 + 复现步骤写全
3. 汇报：通过面、新疑点（置信度）、遗留线索状态
