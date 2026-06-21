---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-21 24:00:00'
---
# mobile-cloud-sync-rn-compat（已合 main）

## 根因与修复摘要
- RN/Hermes 缺 DOMParser → polyfill + AWS SDK 响应体/流 shim
- 阿里云 OSS 不支持 PutObject If-Match → 驱动端 Head 校验后普通 PUT
- 云同步卡顿 → 文件路径 IO + @noble/hashes 分块哈希 + 进度页

## 关键路径
- `apps/mobile/src/shims/*`、`cloud-sync.service.ts`、`CloudSyncProgressScreen`
- `packages/cloud-sync-driver-s3`、`packages/core/.../cloud-sync-coordinator.ts`

## 文档
- `.apm/kb/docs/Iterations/mobile-cloud-sync-rn-compat/`
- `bugs/cloud-sync-mobile-file-io-perf/`

## 发版
- v1.2.5（含本迭代 mobile 云同步修复）
