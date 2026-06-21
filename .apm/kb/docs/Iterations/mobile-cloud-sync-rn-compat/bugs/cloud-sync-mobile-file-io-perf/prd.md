---
date: 2026-06-21
dependency: Iterations/mobile-cloud-sync-rn-compat/prd.md
---

# cloud-sync-mobile-file-io-perf Bug PRD

## 背景

Mobile 云同步 RN 兼容修复完成后，Push/Pull 在阿里云 OSS 上功能可用，但真机推送约 6MB 快照耗时 2+ 分钟，且界面长时间无响应，体感接近「卡死」。本地「导出/导入数据库」在相同数据量下明显更快。

## 现象描述

- Push：导出数据库很快（~85ms），但随后界面冻结约 30s+（读文件 + 算哈希），上传阶段再耗时 1–2 分钟
- Pull：预期存在对称问题（整包下载进内存、JS 算哈希、`bytesToBase64` 写库）
- 用户可继续看到 Toast「推送中…」，但滑动、动画卡顿严重

## 复现步骤

1. Android 真机，配置有效阿里云 OSS
2. 数据库约 6MB（含项目/会话数据）
3. 数据管理 → 推送到云端
4. 观察 logcat `[cloud-sync]`：`read_snapshot_done` ~9.6s、`sha256_done` ~23s

## 预期行为

- 云同步 Push/Pull 的**本地处理阶段**（哈希、读写盘）耗时应接近本地导入/导出的量级（秒级而非数十秒）
- 同步进行中 UI 仍可基本交互（网络上传/下载耗时另计）
- Desktop / Mobile 云同步语义与错误码不变

## 实际行为

- Push 在 `exportDatabaseBackupToPath`（原生 `fs.cp`）之后，将快照**再次**整包读入 JS（base64 → `Uint8Array`），并用纯 JS SHA256 阻塞主线程
- Pull 导入走 `importDatabaseBackupFromBytes`，需 `bytesToBase64` 写回磁盘
- 本地导出不经 JS 内存；云同步多走「内存中转」路径

## 影响范围

- Mobile Push / Pull 主线程阻塞与总耗时
- 不影响：测试连接、status.json 读写、OSS 条件 PUT 兼容、Desktop 既有行为（同步获得文件路径优化）

## 验收标准

- [ ] Push 6MB 级快照：`sha256` 阶段从 ~20s 降至秒级（真机 `[cloud-sync]` 对比）
- [ ] Push 不再在 hash 前额外 `read_snapshot` 整包读入（走 `putFile` 单次读）
- [ ] Pull 导入使用 `importDatabaseBackupFromPath`（`fs.cp`），不经 `bytesToBase64`
- [ ] Core coordinator / S3 driver / db-backup 单测通过；`npm run build` 通过
- [ ] Desktop 云同步仍可用（文件路径快路径或 bytes 回退）

## 回归测试要点

- Coordinator CS-P1b / CS-P5b 文件路径 Pull/Push
- S3 driver `putFile` / `getToPath`
- Mobile `importDatabaseBackupFromPath` 使用 `cp` 而非 base64 写文件
- 无 `hashSnapshotFile` 注入时仍走 bytes 回退路径
