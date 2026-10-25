---
date: 2026-09-29
---

# composer-webview Step 1 Spike 结论（WebView 输入框可行性）

设备策略（用户拍板 2026-09-29）：迭代内高低版本安卓均用模拟器，真机验收挪至开发完成后。

- 低版本轨：`nm33`（AVD，API 33 / Android 13，google_apis x86_64，全新 userdata）——emulator-5554
- 高版本轨：`nm35`（AVD，API 35 / Android 15，**强制 edge-to-edge 第一版**，google_apis x86_64）——emulator-5554（重启后复用了端口）

Spike 实现方式：WebView `source={{html}}` 内联 HTML（透明 textarea + 高亮 mirror 层 + postMessage 桥 + visualViewport 监听）挂进真实 ChatComposer dock（继承 ChatConversationPanel 的 `AndroidKeyboardClipBody` 键盘链路），**绕开构建链**（Metro reload 即生效）。spike 原型未入 PR（已清理，仓库无残留）。

## 五点验证结果（双轨全过）

| # | 验证点 | API 33（低版本） | API 35（高版本，edge-to-edge） |
|---|---|---|---|
| ① | 聚焦弹键盘 + 容器收缩 + **#3848 专项检查** | ✓ 弹键盘（mInputShown=true）、ClipBody 收缩、输入框完整悬于键盘上方 | ✓ 同左；IME frame=[0,1517]，transcript 收缩至 [0,566-1146]、输入框 [54,1238-1385] **全部在键盘上方，无内容顶出/上滚** |
| ② | 高度上报自增高 | ✓ 56→78→100→122→144→160 精确 +22 步进，封顶 clamp 生效，rAF 节流无抖动 | ✓ 160 封顶，逐条干净 |
| ③ | visualViewport 光标可见 | ✓（几何：输入框全高可见） | ✓（同左） |
| ④ | 基础输入链路（IME 组合态留真机） | ✓ 逐字符 change + selectionChange 流 | ✓ 逐字符 change 流（含 @token） |
| ⑤ | 快速滚动零分层（帧差） | ✓ 49 对帧、胶囊层与文字层垂直位移逐帧一致（相关 ~1.0），0 错配（`spike-scroll-check.py` 双层掩码互相关） | ✓ 40 对帧、0 错配 |

结论：**方案可行，进入 Step 2 开发**。社区 issue react-native-webview#3848（WebView 输入内容被键盘顶跑）在双轨上均未复现；键盘链路沿用现状范式 A（keyboard-controller insets 动画），未新增任何按 API level 的分支代码。

## 附带发现与修复（main 既有问题，spike 环境搭建时实锤）

1. **智能体列表页白屏崩溃（已修，commit 07557d25）**：registry list 注入的内置 general 虚拟子智能体无实体行，`AgentList.reload()` 循环对 `getRawWire(id)` 返回的 undefined 直接访问 `raw.name` → TypeError 白屏。**空 registry 首次进入 / 坏库数据均可触发**（本轮在 API 35 新库与坏库模拟器上两次实锤）。修复：`raw == null` 跳过。建议后续为该页补空 registry 渲染路径的组件测试。
2. **core dist stale（环境必修）**：worktree 的 `packages/core/dist` 是旧分支时代构建的，`public/agent.js` 缺 `DEFAULT_SUBAGENT_DEFINITION` 导出（metro.config 的 dist 冒烟清单未覆盖该导出）→ 智能体页模块加载即 undefined。修复：`npm run build -w @novel-master/core` 重建。**建议把该导出加入 metro.config 冒烟清单**（本次未改，属 main 配置变更需拍板）。
3. **API 37（Pixel_7 AVD）上 app 红屏**：`Error: Got unexpected undefined`（minified 栈 `get UIManager`）——与 2026-09-28 真机记录的同款未定位崩溃一致（发版前置项）。高版本轨因此改用 API 35 AVD。

## 环境陷阱记录（模拟器 e2e 复用警示）

- **bundle 地址陷阱**：RN 模拟器 debug 包默认 bundle location 为 `10.0.2.2:8081`（**不经过 adb reverse，直达宿主 8081**）；宿主 8081 若跑着**别的 worktree 的 Metro**（本轮为 cuo 的），app 会静默拉别的分支的代码且 UI 同款难辨——排查时用 `netstat`（模拟器内 `10.0.2.2:8081`/`127.0.0.1:8082` 连接）+ 「Metro 日志是否收到 BUNDLE 请求」双向对齐。**本轮最省事解法：把本 worktree 的 Metro 起在宿主 8081（默认地址即命中）**，或 dev 菜单改地址（注意该对话框的 APPLY 按钮 adb tap 可失灵，用**输入后回车**提交）。
- **该模拟器 adb 输入不稳定**：对话框按钮 tap 时灵时不灵（与 2026-09-28 记的「新建项目创建按钮 tap 无效、回车有效」同族）；列表行 tap/motionevent 完全无响应时段存在（本轮靠临时 auto-open 打点绕过，未定位根因）。
- **模拟器显示输出偶发死黑屏**（mWakefulness=Awake 但 screencap 全黑）：重启模拟器恢复。
- **playstore 系统镜像的 AVD 起不来**（nm36 两次 offline 卡死）；**google_apis 镜像正常**（nm33/nm35 均秒起）。新建 AVD 一律用 google_apis。
- **灭屏**：模拟器空闲自动灭屏（svc power stayon true 可防，冷启动后需重设）。

## 证据资产

- 帧差分析：`tmp/spike-scroll-check.py`（双层掩码互相关，蓝=胶囊/黑=文字，逐帧位移一致性）
- 录屏与抽帧：`tmp/spike-scroll.mp4`（API 33）、`tmp/spike-35.mp4`（API 35）、`s2-*/s35-*.png` 帧序列
- 布局/键盘系统证据：`tmp/ui-*.xml`（uiautomator dump，含 WebView bounds）、dumpsys input_method/window 输出
