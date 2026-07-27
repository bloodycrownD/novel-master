---
date: 2026-07-26
agile_trace: true
---

# rn-content-blob-zlib-b64 实现规格（SPEC）

## 根因 / 方案摘要

**根因**：`SqliteVfsContentStore` put 恒写 `encoding='zlib'` + `Uint8Array` BLOB；get 经 `asUint8Array` 拒绝 string。RN/quick-sqlite 上将 BLOB 读成 string（或 TEXT 亲和）时抛错，文案为「期望 Uint8Array/ArrayBuffer, 实际 [object String]」。

**方案**：落地父级 SPEC 的 RN `zlib-b64`——put 在 React Native 上 zlib 后再 base64 以 TEXT 写入；get 按 `encoding` 双格式解码，并对存量 `zlib`+string 按 base64 兜底（对齐 sksp-android）。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/domain/vfs/content-store/logic/blob-bytes-codec.ts` | **新建**：base64↔bytes、`VFS_CONTENT_ENCODING_ZLIB_B64`、`isReactNativeRuntime` |
| `packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts` | 保留 zlib 压缩；与 b64 常量分文件 |
| `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts` | put 分平台；get `decodeCompressedBytes`；可选 `preferZlibB64` 注入 |
| `packages/core/test/vfs/content-store.test.ts` | 补 zlib-b64 往返、存量 string 兜底、手动 insert、同 hash 不改 encoding |

## 详细改动说明

### put

- `preferZlibB64 ?? isReactNativeRuntime()` 为真：`compressZlib` → `bytesToBase64` → 绑 **string**，`encoding='zlib-b64'`，`byte_len = b64.length`
- 否则：现路径 tight `Uint8Array`，`encoding='zlib'`，`byte_len = compressed.byteLength`
- 同 `content_hash` 已存在：直接复用，**不改** encoding/bytes

### get

| encoding | bytes 形态 | 行为 |
|----------|------------|------|
| `zlib` | Uint8Array / ArrayBuffer | `asUint8Array` → unzlib |
| `zlib` | string | `base64ToBytes` → unzlib（存量兜底） |
| `zlib-b64` | string 或 UTF-8 字节 | 取 base64 文本 → `base64ToBytes` → unzlib |
| 其它 | — | 抛「不支持的 content blob encoding」 |

末尾仍 `TextDecoder` 成 UTF-8 string；端口签名不变。

### 平台探测

`navigator.product === "ReactNative"`（与 `llm-sse-transport` 一致）；单测用 `preferZlibB64: true|false` 注入。

## 测试策略

### 测试用例

- T-CS2：Node 仍断言 `encoding === zlib` 且 bytes 为 Uint8Array
- RN 注入 put → `zlib-b64` 往返 get
- 手动 INSERT `zlib-b64` 行后 get
- `encoding=zlib` + bytes 为 base64 string 的 get 兜底
- 同 hash：先 Node put，再 preferZlibB64 put，不改写既有行

验证：`npm run test:fast -w @novel-master/core -- test/vfs/content-store.test.ts`；`npm run test:vfs -w @novel-master/core`（164 pass）。

## 风险与回滚方案

| 风险 | 缓解 / 回滚 |
|------|-------------|
| 存量 string 并非合法 base64 | 解码失败仍抛错；真机抽查 |
| RN 探测误判 | 注入点 + 与现有 SSE 探测一致 |
| 跨端同库 | get 双端均认两种 encoding |

回滚：还原上述 4 个文件对应提交 `9bece370`；不改 schema。
