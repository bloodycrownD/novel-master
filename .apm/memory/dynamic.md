---
createdAt: '2026-07-29 21:38:22'
updatedAt: '2026-08-11 20:59:28'
---
## 背景
feat/event-config-merge-and-migration-cleanup 分支上做两件事：压缩配置 UI 合并重构 + 新增 Linux SKSP driver。用户在 Linux 环境开发 desktop 时遇到 `Unsupported SKSP platform: linux`——SKSP 之前只有 Windows/macOS driver，Linux 故意抛错。

## 目的
完成压缩配置 UI 合并（已完成）；新增 Linux SKSP driver 让 desktop 能在 Linux 上启动；环境问题（Electron/gradlew/adb）按需修。

## 现状
1. 压缩配置 UI 合并已完成（b987e7e/7f41c61/a500665），cr-func func-ready。
2. gradlew 权限位修复（bbb459e）。
3. Electron 二进制用 npmmirror 镜像装好，path.txt + dist 在位。
4. **Linux SKSP driver 已实现（ec51b41）**：新建 @novel-master/sksp-linux 包（Secret Service + AES-256-GCM + SQLite，照搬 mac 结构），core platform.ts 加 linux 分支，desktop/CLI runtime 接 linux driver。
5. 验证：core platform test 5/5、CLI sksp test 3/3、desktop typecheck 干净、sksp-linux build 通过。sksp-linux/mac 的 SQLite 测试因 better-sqlite3 native :memory: 问题在本机失败（pre-existing 环境问题，非代码问题）。
6. 待用户试跑 npm run dev 确认 desktop 能起。
