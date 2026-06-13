---
date: 2026-06-13
---

# 移除 Mobile VFS ZIP 原生打包 技术规格（SPEC）

## 设计目标

- 撤销 `vfs-zip-native-compression` 在 Mobile 与 Core 的可插拔打包层，**唯一打包实现**为 `buildVfsZip`（fflate STORE）。
- 降低与 `parseVfsZip` 的格式分歧、中文路径降级与维护成本。
- 与 `fix/mobile-vfs-zip-roundtrip` 已修复项（`copy:true`、EOCD、`unzipSync` 回退）叠加后，export/import 路径一致。

## 总体方案

```mermaid
flowchart LR
  UI[VfsFileManager export/import]
  SVC[vfs-zip.service.ts]
  CORE[createVfsZipIoService]
  EXP[DefaultVfsZipIoService.export]
  BUILD[buildVfsZip fflate STORE]
  UI --> SVC --> CORE --> EXP --> BUILD
```

- **Before**：Android `exportVfsZipBytes` 分支注入 `androidBuildZip` → native 或 fflate；Core `export` 末尾 `this.buildZip ?? buildVfsZip`。
- **After**：Mobile 与 Desktop/CLI 相同：`createVfsZipIoService(conn)` → `export` 内直接 `buildVfsZip(zipFiles, directoryZipNames)`。

## 最终项目结构

```
packages/core/src/
  domain/vfs/ports/vfs-zip-io.port.ts     # 删除 VfsZipBuildInput / VfsZipBuildFn
  service/vfs/create-vfs-zip-io-service.ts # 删除 buildZip 选项
  service/vfs/impl/vfs-zip-io.service.ts   # export 直接 buildVfsZip
  index.ts                                 # 停止导出 VfsZipBuildFn 等

apps/mobile/src/
  services/vfs-zip.service.ts              # 删除 Platform 打包分支与 native import
  native/                                  # 删除整个 vfs-zip-native.ts（目录可空删）

apps/mobile/__tests__/
  vfs-zip.service.test.ts                  # 删除 M-native-*，统一平台断言
  vfs-zip-native.test.ts                   # 删除文件

apps/mobile/package.json                   # 移除 react-native-zip-archive
```

## 变更点清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/mobile/src/native/vfs-zip-native.ts` | 删除 | native 打包实现 |
| `apps/mobile/__tests__/vfs-zip-native.test.ts` | 删除 | native 单测 |
| `apps/mobile/src/services/vfs-zip.service.ts` | 修改 | 移除 `nativeBuildVfsZip`、`hasNonAsciiZipEntryName`、`androidBuildZip`、`exportVfsZipBytes` 的 Android 分支；`exportVfsZip` 统一 `createVfsZipIoService(conn).export` |
| `apps/mobile/__tests__/vfs-zip.service.test.ts` | 修改 | 删 M-native-1/3/4；iOS/Android 均断言 `createVfsZipIoService(conn)` 单参 |
| `apps/mobile/package.json` | 修改 | 移除 `react-native-zip-archive` |
| `package-lock.json` | 修改 | `npm install` 同步 |
| `packages/core/.../vfs-zip-io.port.ts` | 修改 | 删 `VfsZipBuildInput`、`VfsZipBuildFn` |
| `packages/core/.../create-vfs-zip-io-service.ts` | 修改 | `CreateVfsZipIoServiceOptions` 仅保留 `testHook` |
| `packages/core/.../vfs-zip-io.service.ts` | 修改 | 删 `buildZip` 字段；`export` 直接 `return buildVfsZip(...)` |
| `packages/core/src/index.ts` | 修改 | 停止 export `VfsZipBuildFn`、`VfsZipBuildInput`（若有） |
| `packages/core/test/vfs/vfs-zip-io.test.ts` | 修改 | 删除 `Z-buildZip-1/2/3` |

**不变**：`buildVfsZip`、`parseVfsZip`、Mobile import 流程、Desktop/CLI `vfs-zip.service`、`testHook`（import rollback 测试）。

## 详细实现步骤

### 1. Core 内联打包

`DefaultVfsZipIoService.export` 末尾替换为：

```typescript
return buildVfsZip(zipFiles, directoryZipNames);
```

- 删除 `defaultBuildZip`、`buildZip` 构造字段、`VfsZipBuildFn` import。
- `createVfsZipIoService` 不再传递 `buildZip`。

### 2. Core 端口与导出清理

- 从 `vfs-zip-io.port.ts` 移除 `VfsZipBuildInput`、`VfsZipBuildFn` 及 TSDoc。
- `index.ts` 移除对上述类型的 re-export（grep 确认无外部引用）。

### 3. Mobile service 简化

`exportVfsZip` 改为：

```typescript
const zipSvc = createVfsZipIoService(runtime.conn);
const bytes = await zipSvc.export(scope);
```

- 删除 `exportVfsZipBytes` 辅助函数（若仅用于平台分支）。
- 删除 unused imports：`Platform`（若 import 路径仍需要则保留）、`buildVfsZip`、`VfsZipBuildFn`。

### 4. 删除 native 模块与依赖

- 删除 `vfs-zip-native.ts`、`vfs-zip-native.test.ts`。
- `apps/mobile/package.json` 移除 `react-native-zip-archive`。
- 根目录 `npm install` 更新 lockfile。
- Android：依赖移除后常规 rebuild；无额外 Gradle 手改（autolinking 自动卸载）。

### 5. 测试更新

**Core** — 删除 `Z-buildZip-1/2/3`；现有 `Z1` session export、UTF-8 round-trip 用例即回归 STORE 唯一路径。

**Mobile** — 保留：

- writes cache + save-as + `copy: true` + unlink
- import EOCD / keepLocalCopy
- cancelled picker
- `VfsZipError` 不重试

新增或调整：

- `Android export uses Core default createVfsZipIoService(conn)` — 与 iOS 相同单参调用。

### 6. 与 roundtrip 分支

建议在 `fix/mobile-vfs-zip-roundtrip` 上追加本迭代 commit，或 rebase 后一并 PR → main。

## 测试策略

### 测试用例

| ID | 层 | 描述 |
|----|-----|------|
| R1 | core | session export 路径与 Z1 一致（STORE） |
| R2 | core | `buildVfsZip` 中文路径 export → `parseVfsZip` 往返 |
| R3 | mobile | `exportVfsZip` 调用 `createVfsZipIoService(conn)` 无第二参数 |
| R4 | mobile | export 写 cache、`saveDocuments` `copy:true`、finally unlink |
| R5 | mobile | import 截断 ZIP 报 `missing EOCD` |
| R6 | repo | grep 无 `nativeBuildVfsZip`、`react-native-zip-archive` |

**命令**：

```bash
npm test -w @novel-master/core -- vfs-zip
npm test -w @novel-master/mobile -- vfs-zip
```

**真机（可选）**：中文目录 export → 另存 → import 同一文件。

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 大工作区 JS 线程 STORE 略慢 | 已接受；~400ms 级基线；可后续独立 perf 迭代 |
| 移除 Core buildZip 失去扩展点 | 用户明确选择；未来需要时再引入更窄接口 |
| Android 原生模块缓存 | clean rebuild / 删 `android/app/build` |

**回滚**：revert 本迭代 commit；恢复 `react-native-zip-archive` 与 buildZip 注入（不推荐，除非 perf 回归不可接受）。
