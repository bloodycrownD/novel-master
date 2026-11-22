# 20261123 release 出包默认 arm64-only（commit ad5ecd813）

- `apps/mobile/android/app/build.gradle` splits 块 property 化：默认 `include "arm64-v8a"` + `universalApk false`；`-PabiSplits=all` 才开全架构+universal。
- `.github/workflows/release.yml` 已同步加 `-PabiSplits=all`（CI 发版行为不变）。
- `-PreactNativeArchitectures` 只控制 NDK 编译目标，管不到 splits 打包——本地快出包要两个参数都收窄：`assembleRelease -PversionCode=N -PreactNativeArchitectures=arm64-v8a`（splits 默认已 arm64）。
- 实测：全架构全量 12m → arm64 增量 2m；nm-release-build SKILL.md 已更新（出包命令 + 收包说明）。
- 版本对齐规则（2026-10-19 定版重申）：本地包 versionCode 必须等于 GitHub 最新 release 的 code（gh run list --workflow=release.yml 查），本例 136 / 1.5.50，同 code 覆盖安装合法、可随时用 GitHub 官方包覆盖回来。
