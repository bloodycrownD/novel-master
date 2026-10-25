# 2026-10-12 第七轮退役（mc7）+ 字符 icon 系统字体漂移两案例 + v1.5.41 试用流程

## v1.5.41 试用门流程（用户拍板）
改动量大（composer 原生化 + 三修复 + mc6/mc7 两轮退役共 -2.4 万行），**不直接打 tag**：本机 assembleRelease 给用户真机试用（OK 后再 tag 触发 CI 正式发布）。正式 CI 的 versionCode = GITHUB_RUN_NUMBER（最新 126），试用包注入 code=126 保证正式版（≥127）可覆盖升级；debug 包 code=1，试用 release 期间刷 debug 需先卸载。构建产物：`apps/mobile/android/app/build/outputs/apk/release/`（5 ABI split，arm64-v8a 装真机 79.9MB）。release 签名 fallback debug.keystore（自分发场景，与 debug 同签名可 -r 覆盖）。

## 字符 icon 系统字体漂移（鸿蒙 7 真机实测，荣耀 Android 12 正常）
同根因两案例：**文本字符当 icon 用，字形随系统字体漂移**。
- **⛶ 全屏钮偏移**（RN Text，NativeChatComposer）：鸿蒙 7 上字形不在按钮中心。修法：`lineHeight = fontSize` + `includeFontPadding: false`——Android 默认字体 padding 撑大行盒，容器居中的是行盒而非字形；此修法消 padding 类偏移，字形本身画偏的场景只能部分改善（若鸿蒙仍偏需实测补偿或换自绘 SVG）。commit 4f7c8657a。
- **转录折叠三角 ▼/▶ 变形**（webview css，CollapsibleHeader）：鸿蒙 7 把 ▶ 画成 email 标签形。修法：字符移除，css border 三角（`chevron--open/closed` 方向修饰）跨系统形状必然一致；**border-color 用 currentColor** 让既有 color 规则与 user-compose 白色 override 自动继续生效。className 断言随 collapsapsible-section-classes.test 同步。同 commit。
- **遗留同类风险（未动，用户未报）**：ToolPolicyPicker trigger 的 ▼（RN Text）。
- 方法论：几何形状码位（▼▶⛶◀▸ 等）glyph 跨字体差异最大，icon 一律不用字符（RN 自绘 View/SVG，webview css border/clip-path/SVG）。

## 第七轮迁移退役（mc7，commit a5ef45e6d，merge fff964ffc）
用户拍板：blob 二进制归一 + vfs-content-packing 两任务**提前一个 tag 出列**（「差一个 tag 也没保留必要」），与 mc6 同批并入 v1.5.41（未发版直接改写 CHANGELOG 合并口径）。存储页「存量数据迁移」卡**整卡移除**（含 UI + 后台任务代码 + 专属测试，21 文件整删 + 22 收口，净 -9541 行）。
- 确认门（真机库 120MB）：nm-blob-binary 两表 done（09-28，failedCount=0，两表全行 64 位 hex 键零 base64 残留）+ nm-vfs-pack zeroCandidateWatermark（10-05，failedGroups=0）。
- 保留红线逐项验证：pack-codec.ts（pack 现行读路径）/ vfs-content-pack-schema + bootstrap pbm-7 无条件幂等补建段 / pack 两表全部读写 / blob-bytes-codec（存量 base64 读侧兼容）。
- 门禁对照零新增红（core 2 红时区既有、desktop 16 环境红一致、mobile 零新增）。

## mc7 待决清单（未扩大删除面，下轮评估）
1. `runStartupMaintenanceOnce` / `runPendingStartupMaintenance`（core 公共导出）已无生产消费方——是否随下一轮退役
2. desktop `typecheck-renderer-baseline.json` 含 3 条已删文件 TS6307 identity（路径还指向旧 worktree "mcr"）——可降基线
3. `scripts/device/verify-device-db.mjs`、`scripts/measurements/vfs-pack-measure*.mjs` 一次性脚本建议下轮清理
4. merge 后主仓 webview-dist/assets 已重建（含 chevron css 新产物）

## 其他
- mc6/mc7 两轮合并均遇 RULE.md 未提交修改挡 merge（历次迭代尾部经验追加未提交）——处理套路：`stash push -- docs/apm/RULE.md` → merge → `stash pop`（不同区域自动合并成功，两次验证）。
- mc7 worktree：`D:\Dev\nm-worktree\mc7`（junction node_modules + workspace dist 补齐），发版后清理。
- 双包分发：release APK 用 `adb push` 到 Download 让用户自装（adb install 会被荣耀安装确认框拒——用户拒了确认框 install 报 INSTALL_FAILED_ABORTED 是正常现象，不是构建问题）。
