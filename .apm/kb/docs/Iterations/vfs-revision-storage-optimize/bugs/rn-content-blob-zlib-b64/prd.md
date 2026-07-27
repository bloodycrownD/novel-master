---
date: 2026-07-26
dependency: Iterations/vfs-revision-storage-optimize/prd.md
---

# rn-content-blob-zlib-b64 Bug PRD

## 背景

父级迭代将工作区正文改为内容寻址 + zlib 压缩落库。SPEC 约定 Hermes/RN 落库 encoding 为 `zlib-b64`（zlib 后再 base64，以 TEXT 规避 quick-sqlite BLOB 问题），但实现只写了 Node 式 `zlib` raw BLOB。

## 现象描述

Mobile「编辑文件」读取失败，弹窗：

> 读取失败: vfs_content_blob.bytes 期望 Uint8Array/ArrayBuffer, 实际 [object String]

聊天工作区等经同一 `ContentStore.get` 的读路径同样失败或显示缺失。

## 复现步骤

1. 在 Mobile 打开含工作区文件的会话（升级后已迁入 content blob 的库）。
2. 进入「编辑文件」或触发工作区/VFS 读取。
3. 观察报错弹窗。

## 预期行为

Mobile 上可读出完整 UTF-8 正文；新写入按 `zlib-b64` 落库；Desktop 行为不变；对外仍是完整字符串。

## 实际行为

`ContentStore.get` 将 `bytes` 列当 BLOB 收成 `Uint8Array`，RN 读回为 string 时直接抛错，上层表现为读取失败。

## 影响范围

- Mobile：文件编辑器、工作区组装、Agent `read`、真提示预览等一切 `vfs.read` → ContentStore 路径
- Desktop：成功路径不受影响；需能读 Mobile 写出的 `zlib-b64` 行（跨库）

## 验收标准

- [x] Mobile 新写入：`vfs_content_blob.encoding = zlib-b64`，且可读回原文
- [x] Node/Desktop 新写入：仍为 `encoding = zlib` + raw 字节
- [x] get 两端均支持 `zlib` 与 `zlib-b64`
- [x] 存量 `encoding=zlib` 且 `bytes` 为 string 时可兜底解码（不再抛 asUint8Array）
- [x] `packages/core` content-store / vfs 相关测试通过

## 回归测试要点

- `test/vfs/content-store.test.ts`（含 zlib-b64 往返与存量 string 兜底）
- `npm run test:vfs -w @novel-master/core`
- 真机：打开旧库读文件；新建/保存后再读
