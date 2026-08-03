---
date: 2026-06-13
dependency:
  - Iterations/import-export-navigation-fix/prd.md
  - Iterations/vfs-zip-native-compression/prd.md
bug: mobile-vfs-zip-roundtrip
status: fixed
---

# Mobile VFS ZIP 导出导入往返失败 PRD

> **所属迭代**：`import-export-navigation-fix`  
> **平台**：Android Mobile（主要复现）  
> **类型**：数据完整性 / 导入导出缺陷

## 背景

用户在 Mobile 工作区执行 **导出 ZIP → 另存为 → 再导入** 时，出现以下可复现链路：

1. 导出阶段偶发 Toast：「原生打包失败，已改用备用方式」（Android 原生 zip 回退 Core STORE 属预期分支之一）。
2. 将导出的 ZIP 从同一位置或另存路径导入时，报错：**「导入失败: failed to read ZIP archive」**。
3. 用十六进制查看用户保存的 ZIP，常见仅有 `PK` 头或明显截断，中央目录（EOCD）缺失。

该问题阻断工作区备份/迁移的核心路径，与迭代 PRD 中「VFS ZIP 域内全量替换」目标直接冲突。

## 根因摘要

| 优先级 | 根因 | 影响 |
|--------|------|------|
| 高 | `exportVfsZip` 在 Android 上 `saveDocuments({ copy: false })`，`finally` 中立即 `unlink` 缓存源文件；另存为对话框可能尚未完成复制即删除源，导致用户落盘 ZIP 损坏 | 导出文件不可用，导入必失败 |
| 中 | `parseVfsZip` 改用自研 `parseZipCentralDirectory` 后，对部分 `react-native-zip-archive` 原生 ZIP 结构兼容性不足 | 未走 fallback 时原生导出 ZIP 导入失败 |

对照：`agent-yaml.service.ts`、`events-yaml.service.ts` 导出均已使用 `copy: true`。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 导出 ZIP 完整落盘 | Android 另存为后，文件含有效 EOCD，大小与缓存写入一致，可再次被 `parseVfsZip` 解析 |
| 导入兼容原生与 Core ZIP | 自研 central dir 解析失败时自动回退 `fflate.unzipSync`，不丢失 GBK 路径解码主路径收益 |
| 截断 ZIP 可读错误 | 导入前 `assertZipArchive` 检测缺失 EOCD 时给出明确错误，而非泛化 `failed to read ZIP archive` |
| 无行为回归 | 现有 GBK/UTF-8 中文路径导入、域内全量覆盖语义不变 |

## 范围

### 包含

- `apps/mobile/src/services/vfs-zip.service.ts`：`saveDocuments` 改为 `copy: true`；`assertZipArchive` 增加 EOCD 扫描。
- `packages/core/src/domain/vfs/logic/vfs-zip-parse.ts`：central dir 失败时 fallback `unzipSync`。
- 单测：`apps/mobile/__tests__/vfs-zip.service.test.ts`、`packages/core/test/vfs/vfs-zip-parse.test.ts`。

### 不包含

- `db-backup.service.ts`（同类 `copy` 问题可单独跟进）。
- iOS 原生 zip 启用（仍走 Core STORE）。
- Desktop / CLI 导出保存流程（无 `saveDocuments` 路径）。

## 验收标准

- **Given** Android 会话工作区有至少一个文件  
  **When** 导出 ZIP 并另存至 Downloads  
  **Then** 保存文件可被系统文件管理器打开，重新导入同一 ZIP **成功**，域内文件与导出前一致。

- **Given** 导出过程触发原生 zip 失败并 Toast 备用方式  
  **When** 导入刚导出的 ZIP  
  **Then** 导入 **成功**（不再出现 `failed to read ZIP archive`）。

- **Given** 人为截断的 ZIP（仅有 local header、无 EOCD）  
  **When** 尝试导入  
  **Then** 错误信息包含 `missing EOCD` 或等价中文语义，便于用户识别损坏文件。

- **Given** GBK 编码文件名的外部 ZIP  
  **When** 导入  
  **Then** 文件名仍正确解码（central dir 主路径不受影响）。
