---
date: 2026-06-13
dependency:
  - Iterations/vfs-zip-native-compression/prd.md
  - Iterations/import-export-navigation-fix/prd.md
---

# 移除 Mobile VFS ZIP 原生打包 PRD

## 背景

2026-06 合入的 `vfs-zip-native-compression` 在 Android 导出时通过 `react-native-zip-archive` 做原生 ZIP 打包，Core 增加可选 `buildZip` 注入。随后 `import-export-navigation-fix` 发现：

- 中文等非 ASCII 路径无法可靠走 native（ZIP 条目 EFS 与 `parseVfsZip` 解码不一致），实际已强制回退 fflate STORE。
- 纯 ASCII 路径仍可能产出与自研 central directory 解析不兼容的 ZIP 结构。
- 误导性 Toast「原生打包失败，已改用备用方式」与双路径维护成本高于收益。

此前性能瓶颈（fflate DEFLATE ~4s）已通过 **STORE level 0** 降至 ~400ms；native 加速仅为边际优化。用户确认：**撤掉 Mobile native 路径，并移除 Core `buildZip` 注入**，全平台导出统一 `buildVfsZip`（fflate STORE）。

与进行中的 `mobile-vfs-zip-roundtrip` bugfix 可同分支合入：简化打包路径后，导出/导入往返更一致。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 单一打包路径 | Mobile Android / iOS / Desktop / CLI 导出均经 Core `buildVfsZip`，无 `buildZip` 注入 |
| 依赖精简 | `apps/mobile` 移除 `react-native-zip-archive` 及 `vfs-zip-native` 模块 |
| 行为不变 | 含中文路径的 export → import 往返正确；现有 Core Z* 用例（除 buildZip 专项）通过 |
| 体验 | 导出不再出现与 native 降级相关的提示；loading 行为保持 |
| 性能可接受 | 标准 fixture（~40 文件 / ~400K 字符）导出 picker 前 **≤ 1.5s**（与现网 STORE 基线一致，不劣于移除前中文路径场景） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 写作用户 | 会话/项目/全局工作区导出 ZIP（含中文目录名），另存后本 App 或外部工具再导入 |
| 维护者 | 减少双打包路径、native 依赖与误导性降级逻辑 |

## 范围

### 包含范围

- 删除 `apps/mobile/src/native/vfs-zip-native.ts` 及对应单测。
- `vfs-zip.service.ts`：Android 与 iOS 一致，仅 `createVfsZipIoService(conn)`，移除 `hasNonAsciiZipEntryName`、`androidBuildZip`。
- 移除 `react-native-zip-archive` 依赖（`package.json` / lockfile）。
- Core：移除 `VfsZipBuildFn` / `VfsZipBuildInput`、`createVfsZipIoService` 与 `DefaultVfsZipIoService` 的 `buildZip` 选项；`export` 内直接调用 `buildVfsZip`。
- 测试：删除 M-native-*、Z-buildZip-* 及 native 相关 mock；保留 export/import 往返与 EOCD 校验等用例。
- 文档：本迭代 PRD + SPEC；`vfs-zip-native-compression` 标记为 Mobile 侧已回滚（不删历史文档）。

### 不包含范围

- 导入侧 `parseVfsZip`、GBK/EFS 解码、EOCD 校验（属 `import-export-navigation-fix` / roundtrip bugfix）。
- 恢复 DEFLATE 压缩或新的原生打包方案。
- iOS 未来 native zip（M3）follow-up。
- CLI / Desktop 功能变更（本就未用 buildZip）。

## 核心需求

1. **统一导出打包**：所有 host 的 VFS ZIP 导出仅使用 Core `buildVfsZip`（fflate STORE）。
2. **移除 Core 扩展点**：删除 `buildZip` 注入及相关公开类型导出，避免再次引入 silent 双路径。
3. **清理 Mobile native 资产**：删源码、单测、npm 依赖；Android 构建不再链接 zip-archive 原生模块。
4. **测试对齐**：Mobile `vfs-zip.service` 单测覆盖 Android/iOS 均不传 buildZip；Core 保留 session export 路径与 round-trip 断言。
5. **与 roundtrip fix 兼容**：不 revert `saveDocuments copy:true`、EOCD 校验等已修复项。

## 验收标准

- **Given** Android 会话工作区含中文路径文件（如 `笔记/第一章.md`）  
  **When** 用户导出 ZIP 并本 App 内导入  
  **Then** 文件名与内容正确，无 native 相关 Toast 或降级提示。

- **Given** Android 纯 ASCII 工作区  
  **When** 导出 → 导入往返  
  **Then** 与移除前 fflate STORE 行为一致，单测与 Core Z1 类用例通过。

- **Given** 代码库  
  **When** 检索 `react-native-zip-archive`、`nativeBuildVfsZip`、`buildZip`（VfsZip 上下文）  
  **Then** Mobile 与 Core 服务层无残留；`apps/mobile/package.json` 无该依赖。

- **Given** `npm test -w @novel-master/mobile -- vfs-zip` 与 Core `vfs-zip-io` / `vfs-zip-parse` 相关测试  
  **When** 执行  
  **Then** 全部通过（已删除的 buildZip/native 专项用例除外）。

- **Given** iOS 导出  
  **When** 与 Android 对比  
  **Then** 二者均仅调用 `createVfsZipIoService(conn)`，无平台分支打包逻辑。
