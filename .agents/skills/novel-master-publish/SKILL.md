---
name: novel-master-publish
description: Publishes novel-master releases—version bumps, git tags, and GitHub Release workflow. Use when releasing a version, bumping desktop/mobile package.json, pushing v* tags, or when the user asks to publish or 发版.
---

# Novel Master 发版

**Git tag、产物版本、关于页/更新检查显示的版本必须一致。**  
tag 形如 `v1.0.4` → 应用内版本为 `1.0.4`（去掉前缀 `v`）。

## Checklist（在 `main` 上完成后再打 tag）

```
- [ ] 在 CHANGELOG.md 补充本版本 `## [x.y.z]` 更新说明（CI 会写入 Release「更新说明」）
- [ ] bump apps/desktop/package.json version
- [ ] bump apps/mobile/package.json version
- [ ] 确认 apps/mobile/android/app/build.gradle 默认 versionName 与 tag 一致
- [ ] 跑受影响 workspace 测试与构建（至少 desktop、mobile）
- [ ] 在 main 提交版本 bump + CHANGELOG（commit 勿含 .env、keystore 等敏感文件）
- [ ] git tag vX.Y.Z
- [ ] git push origin vX.Y.Z   # 触发 Release
- [ ] git push origin main     # 推荐；不触发 CI
```

## Release 说明（CHANGELOG.md）

- 根目录 [CHANGELOG.md](../../../CHANGELOG.md) 按 `## [x.y.z]` 维护面向用户的更新说明
- 推送 `v*` tag 后，[release.yml](../../../.github/workflows/release.yml) 会读取对应段落，写入 GitHub Release 的 **「更新说明」** 区块
- Desktop / Mobile 关于页与更新弹窗优先展示该区块（见各端 `update-check/excerpt-release-notes.ts`）
- 若 tag 版本在 CHANGELOG 中无对应条目，Release 页会显示占位提示

## 命令

```bash
git tag v1.0.5
git push origin v1.0.5    # 触发 Release；上传 tag，不更新远程 main ref
git push origin main      # 同步远程 main（可选但推荐）；同样不触发 CI
```

Release 失败需重跑：`git tag -f v1.0.5 && git push origin v1.0.5 --force`（仍只保留一个 tag 名）。

## CI（`.github/workflows/release.yml`）

- **唯一** GitHub Actions workflow；`push`/`PR` **不触发**，仅 `push` 匹配 `v*` tag 时运行
- 并行构建：**Android APK** + **Windows NSIS** + **macOS DMG**
- Android job 在 `assembleRelease` **之前**必须 `npm run build:webview:native -w @novel-master/mobile`（产物 gitignore；漏拷则聊天 WebView `ERR_FILE_NOT_FOUND`）
- CI 内会对 desktop / mobile 再执行 `npm version <tag无v> --no-git-tag-version --allow-same-version`；**仍须先在仓库 bump `package.json`**，dev 构建与关于页才正确
- 产物发布到 GitHub Releases：`bloodycrownD/novel-master`

## 更新检查

- Desktop / Mobile 各端 `update-check/` 查 `releases/latest`（**不进 `packages/core`**）
- 自动检查开关在 KKV `nm-desktop-ui` / `nm-mobile-ui`，**不是** `nm-preferences`

## 暂不要

- 未讨论前不要改 release workflow 为分端发版（见 [about-and-update-check spec](../../../.apm/kb/docs/Iterations/about-and-update-check/spec.md)）

## Git

**仅在用户明确要求时** `git commit` / `push`；不要擅自提交。
