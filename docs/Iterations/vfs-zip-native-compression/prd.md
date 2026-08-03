# Mobile VFS ZIP 原生打包加速 PRD

> **范围**：Mobile **导出** ZIP 的打包阶段；Core 增加可选 `buildZip` 注入点；**导入**仍走 Core `zipSvc.import`。  
> **边界**：不含技术方案细节（见 [spec.md](./spec.md)）。  
> **关联**：[vfs-zip-io-agent-tool-policy](../vfs-zip-io-agent-tool-policy/prd.md)、[mobile-workspace-rename-menu](../mobile-workspace-rename-menu/prd.md)（导出 loading 已合入 main）。  
> **分支**：`perf/vfs-zip-native-compression`。

## 背景

Mobile 会话工作区导出 ZIP 时，用户需等待「打包完成」后才会出现系统「另存为」对话框。

2026-06 性能排查结论（真机，约 40 个 markdown、~395K 字符）：

| 阶段 | 耗时 |
|------|------|
| SQLite `scanContents` | ~20 ms |
| fflate 默认 DEFLATE | ~4200 ms（瓶颈） |
| fflate STORE（level 0，已合 main） | ~400 ms |
| 写临时文件 + picker 前合计 | ~775 ms |

**根因**：瓶颈在 RN **JS 线程**上的 `fflate zipSync`，而非 SQLite。STORE 已显著改善，但大工作区仍可能卡在 JS 打包与 **整包 Uint8Array + base64 写盘** 的内存/拷贝成本上。

本需求在 **不改变 ZIP 格式与 Core 域语义** 的前提下，允许 Mobile 用 **原生 ZIP** 替代 JS 打包，并为将来恢复适度 DEFLATE 压缩留空间。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 导出 picker 前更快 | 在 **40 文件 / ~400K 字符** 标准 fixture 上，`zipSvc.export`（含 gather + 打包）**≤ 500 ms**（Android 真机，与 STORE 基线持平或更优） |
| UI 不长时间假死 | 导出全程保留 **loading**；原生打包在后台线程执行，主线程可响应（主观不卡死） |
| 格式兼容 | 导出 ZIP 可被 Core `import` 成功往返；CLI `export-zip` 行为 **不变** |
| 架构清晰 | Core 负责 **读工作区 + 路径映射**；Mobile 仅替换 **打包实现**，不复制 domain 规则 |
| 可回滚 | 未注入 `buildZip` 或原生失败回退时，仍可用 fflate STORE |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 写作用户 | 在会话/项目/全局工作区点击「导出 ZIP」，等待较短后选择保存位置 |
| 产品/验收 | 用固定 fixture 对比迭代前后 Metro 计时或内置 perf 日志 |

## 范围

### 包含范围

- Core：`createVfsZipIoService` 增加可选 **`buildZip` 回调**；未传则默认 `buildVfsZip`（fflate STORE）。
- Core：导出 **gather 逻辑**（`scanContents`、目录条目、`external` 校验、ZIP 条目名）仍在 `DefaultVfsZipIoService.export` 内，**不**下沉到 Mobile。
- Mobile：`vfs-zip.service.ts` 注入原生 `buildZip`；封装于 `apps/mobile` 内，**不**新建 `@novel-master/zip-native` workspace 包。
- Mobile：评估并集成社区原生 ZIP 库（如 `react-native-zip-archive`）或最小 TurboModule；Android **优先**，iOS 同迭代或 follow-up（SPEC 定稿）。
- 测试：Core 单测覆盖自定义 `buildZip`；Mobile 单测 mock 原生层。
- 文档：本迭代 PRD/SPEC。

### 不包含范围

- **导入**原生 unzip（继续 Core `fflate` + 事务 import）。
- 修改 ZIP 路径/编码/校验规则（仍遵循 [vfs-zip-io-agent-tool-policy SPEC](../vfs-zip-io-agent-tool-policy/spec.md)）。
- CLI / Desktop 专用优化（默认 fflate 即可）。
- 新压缩格式（tar、自定义 bundle、SQL dump）。
- 独立 monorepo 包（tdbc/sksp 级别）。

## 核心需求

1. **可选 buildZip 注入**：`createVfsZipIoService(conn, { buildZip })`；不传则与现网 main 一致（STORE）。
2. **Mobile 原生打包**：Mobile 传入 `buildZip`，在原生线程将 `{ entryName → UTF-8 text }` 与目录 marker 打成标准 ZIP，返回 `Uint8Array`（或 SPEC 约定的临时路径再读回）。
3. **Gather 仍在 Core**：Mobile **不得**用 `VfsService.list` + 逐文件 `read` 替代 `scanContents`（避免 N+1 与路径规则分叉）。
4. **失败可回退**：原生打包失败时，Mobile 可降级 fflate STORE 并 Toast 提示（可选，SPEC 定稿）。
5. **导出 UX**：保留 `VfsFileManager` 导出按钮 loading（已合 main）。
6. **兼容性**：现有 `vfs-zip-io.test.ts` 全绿；Mobile `vfs-zip.service.test.ts` 全绿。

## 验收标准

### Core

- **Given** 测试连接中 session 域有 `/a.md`、`/dir/b.md`  
  **When** `createVfsZipIoService(conn, { buildZip: stub })` 且 stub 返回可识别 ZIP  
  **Then** `export` 调用 stub **一次**，且 stub 收到的 entry 名为 `a.md`、`dir/b.md`（无 leading `/`）。

- **Given** 未传 `buildZip`  
  **When** `export(sessionScope)`  
  **Then** 行为与 main 上 STORE 实现一致（现有 Z1–Z* 用例通过）。

### Mobile（Android 真机 · 会话 scope · 标准 fixture）

- **Given** 约 40 个文本文件、合计 ~400K 字符  
  **When** 用户点击导出 ZIP  
  **Then** 导出按钮出现 loading；自点击至系统「另存为」出现，**≤ 1.5 s**（含写临时文件；对照 STORE 基线 ~0.8 s，原生不应更慢）。

- **Given** 同上 fixture 导出的 ZIP  
  **When** 在同一 session 入口执行导入并确认覆盖  
  **Then** 导入成功，文件树与导出前一致（往返）。

### 非目标（不验收）

- 导入速度、CLI 导出速度、ZIP 体积优于 STORE 的压缩率。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| iOS 原生库选型 | 是否与 Android 同库；若延期则 SPEC 标注 Android-first |
| 大文件内存 | 整包 `Uint8Array` 仍可能 OOM；后续可迭代「原生直写 temp 路径」 |
| 社区库维护 | 需 pin 版本并在 SPEC 写回滚（移除依赖即回 fflate） |
