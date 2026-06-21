---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-21 24:00:00'
---
# mobile-cloud-sync-rn-compat — 已合 main 并发版 v1.2.5

## 状态：已发布 v1.2.5

## 已完成
- feature/mobile-cloud-sync-rn-compat 已 fast-forward 合并到 main（c4481b7c）
- 远程 main 已推送
- 版本 bump：1.2.4 → 1.2.5（desktop + mobile）

## 本迭代要点
- Mobile 云同步 RN/Hermes 兼容（DOMParser、AWS SDK shim、TransformStream）
- 阿里云 OSS 条件 PUT 客户端校验
- 文件路径级快照 IO + 分块 SHA256
- CloudSyncProgress 独立进度页
