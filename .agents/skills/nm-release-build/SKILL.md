# Skill: nm-release-build

novelmaster（nm）Android release 包的**本地打包**流程。所有步骤在 2026-10-19 的 v1.5.42 实战上验证通过（D:/Dev/Js/novel-master 单域一次成功，13 分钟）。按顺序执行，每步的坑都标注了。

## 前提（不满足就先修，别绕）

- **repo 必须在短路径**：`D:/Dev/Js/novel-master`。路径长是 release 链上三连坑的根因（ninja .o >260 / codegen relativize 跨 subst 盘断 / metro 从 subst 起 junction 跳回真实盘跨根）——四条绕行路全部失败过，唯一解是路径短。若 repo 在别处长路径，先同盘 mv 改短（秒完成），再走下面的「迁移后重建」段。
- **不要用 subst 双域**：不要试图「gradle 从 X: 起、metro 从 D: 起」的混合配置——relativize 跨盘必断。
- **不要动 build.gradle/settings.gradle**：D:/Dev/Js/novel-master 短路径下零 hack，全部默认相对路径。

## 版本号

- `versionName` 兜底在 `apps/mobile/android/app/build.gradle`（`?: "1.5.42"` 形态）。main 分支的 release commit 通常已 bump；没 bump 就临时改兜底串，出完包还原。
- `versionCode` 用 gradle property 传：`-PversionCode=N`。
  **⚠️ 2026-10-19 用户定版（最终规则，推翻本行旧规则）：本地包的 versionCode 必须 = GitHub 最新 release 的 versionCode，不能比它高。**
  - GitHub CI（release.yml）versionCode=GITHUB_RUN_NUMBER（自增，查最新：`gh run list --workflow=release.yml --limit 1 --json number`）。
  - 本地重打包（同版本修 bug 再出包）就用**同一个 code 重打**——同 code 覆盖安装（`adb install -r` 或手机端直接装同版本）Android 允许。
  - **禁止 > CI 最新号**（曾错打 129/130/131 占了 CI 未来 run 的号→CI 正式包装不上已装本地包的设备→只能卸载丢数据）；**禁止 < CI 最新号**（设备上装过更高本地包时降级被拒）。
  - 设备已装包比本地包 code 高时：Android 拒绝降级（INSTALL_FAILED_VERSION_DOWNGRADE），release 包无 `-d` 旁路，只能卸载重装。
  - 打包后必须 aapt 验证（见下）。

## 流程（顺序执行）

```powershell
# 1. core 构建（bundle 依赖 core dist）
cd D:/Dev/Js/novel-master; npm run build -w @novel-master/core

# 2. webview dist 重建（merge main 后必须——白闪契约测试读 dist 产物）
cd D:/Dev/Js/novel-master\apps\mobile; npm run build:webview
#   若报 [gate C] 棘轮 RED：对比 baseline 是否 main 也有同样计数（main 也有→依赖漂移第四例，
#   无 lockfile 重装导致第三方库新增调用点），正当抬基线：
#   node scripts/build-webview.mjs --update-compat

# 3. 依赖三件套（node_modules 不完整时）
cd D:/Dev/Js/novel-master; yarn install
npx patch-package --patch-dir patches
cd node_modules\react-native-enriched-markdown; node postinstall.mjs
#   验证 stamp 存在（缺它 gradle 直接红）：
#   Test-Path cpp\highlight\vendor\grammars\.stamp  → 必须 True
#   RaTeX/iOS 下载失败可忽略（Android 出包不需要）

# 4. 清 build 缓存（换过路径/换过分支必做——旧绝对路径 autolinking 缓存会报悬空 projectDirectory）
node -e "require('fs').rmSync('D:/Dev/Js/novel-master/apps/mobile/android/build',{recursive:true,force:true});require('fs').rmSync('D:/Dev/Js/novel-master/apps/mobile/android/app/build',{recursive:true,force:true})"

# 5. 出包
cd D:/Dev/Js/novel-master\apps\mobile\android
gradlew.bat assembleRelease -PversionCode=129 --no-daemon
#   成功标志：BUILD SUCCESSFUL（全量约 13-15 分钟；C++ 冷编占大头，改动小则 1-2 分钟增量）
```

## 收 APK

产物在 `app/build/outputs/apk/release/`（abi splits 自动产 5 架构）。交付两个到 Downloads：

```js
// collect-apk.mjs
import fs from 'node:fs';
const dir = 'D:/Dev/Js/novel-master/apps/mobile/android/app/build/outputs/apk/release';
for (const f of ['app-arm64-v8a-release.apk', 'app-universal-release.apk']) {
  const dest = 'C:/Users/BloodyCrown/Downloads/' + f.replace('app-', 'novelmaster-<版本>-').replace('-release.apk', '.apk');
  fs.copyFileSync(dir + '/' + f, dest);
}
```

- `arm64-v8a`（~88MB）：主流 64 位手机
- `universal`（~186MB）：全架构兜底

## 验证清单

1. `BUILD SUCCESSFUL` + `GRADLE-EXIT: 0`
2. **aapt 硬验版本号（必须做，别信 latin1 grep——manifest 是 UTF-16 二进制，字符串 includes 会假阳/假阴）**：
   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\aapt.exe" dump badging C:\Users\BloodyCrown\Downloads\<apk> | Select-Object -First 1
   # 期望输出含 versionCode='<N>' versionName='<x.y.z>'
   ```
3. git 工作区 CLEAN（出包不应留下任何源码改动；`yarn.lock` 未跟踪属 repo 惯例）
4. 交付前删掉 Downloads 里被本次取代的旧包（防拿错）

## 陷阱速查（全部实踩过）

| 症状 | 根因 | 处置 |
|---|---|---|
| `ninja: error: Filename longer than 260` | 路径长 | repo 挪短路径（D:/Dev/Js/novel-master），无解法二 |
| `this and base files have different roots: X:\... and D:\...` | subst 双域 relativize 跨盘 | 弃 subst，单域 |
| metro `Unable to resolve module @novel-master/core/xxx`（gradle 内 bundle 挂但 CLI 手跑能过） | metro 从 subst 起，workspace junction realpath 跳回真实盘跨根 | 同上，metro 必须真实短路径域 |
| `projectDirectory 'X:\node_modules\...' does not exist` | build 缓存里旧绝对路径 autolinking 残留 | 清 android/build + app/build |
| `tree-sitter grammars are not installed` | postinstall 没跑/没装完 | 直跑 enriched-markdown 的 postinstall.mjs，确认 .stamp |
| `[gate C] RED: ... baseline N -> measured M` | 我方源码或第三方漂移新增受限构造 | 我方代码→改写；第三方漂移→--update-compat 抬基线并写明理由 |
| `enriched-markdown` codegen 挂 | 同 260 长路径族 | 短路径解 |
| npm rebuild 后 patch 丢失 | patch-package 顺序 | install 后立即 npx patch-package |
| 装完打开还是旧版本 | versionCode 低于设备已装值，Android 拒绝降级 | aapt 验 code；新 code > Downloads 最近 vc 包+1 |

## 装机规则（出自 AGENTS.md）

- release 包给用户/其他设备自装，不在调试机 adb install（除非用户要求）。
- 任何设备**永远禁止 uninstall/清除数据**；覆盖装被拦（INSTALL_FAILED_ABORTED）时停下报告用户。
- debug 真机包走 metro dev server（8081+adb reverse），内嵌 bundle 的 debug 包是白烧时间。
