# Mobile VFS ZIP 原生打包加速 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **平台**：`@novel-master/core` + `apps/mobile`（Android 优先，iOS 跟随）  
> **分支**：`perf/vfs-zip-native-compression`（从 `main` @ STORE 优化合入后拉出）  
> **关联 SPEC**：[vfs-zip-io-agent-tool-policy](../vfs-zip-io-agent-tool-policy/spec.md)（ZIP 格式与 import 语义不变）

---

## 设计目标

1. **Core 增加可选 `buildZip` 注入**：gather 不变；打包可插拔。
2. **Mobile 用原生 ZIP 替代 JS `fflate` 打包**，缩短 RN 导出阻塞、降低大工作区 JS 堆压力。
3. **CLI / 默认路径不变**：未注入时仍 `buildVfsZip` + STORE（`level: 0`）。
4. **不新建 monorepo 原生包**：逻辑放在 `apps/mobile/src/native/`（或 `services/`），依赖社区 RN 库。
5. **Import 仍走 Core** `zipSvc.import`（`parseVfsZip` + 事务全量替换）。

---

## 现状（代码探索）

| 模块 | 现状 | 本迭代影响 |
|------|------|------------|
| `DefaultVfsZipIoService.export` | `scanContents` → Map → `listEntriesUnderPrefix` → **`buildVfsZip`** | 最后一步改为 `this.buildZip ?? buildVfsZip` |
| `buildVfsZip` | `fflate` `zipSync`，**STORE level 0**（main） | 仍为 **默认** 实现 |
| `createVfsZipIoService` | 仅 `testHook` 选项 | 增加 **`buildZip?: VfsZipBuildFn`** |
| `VfsZipIoService` 端口 | `export` / `import` 签名不变 | 无破坏性变更 |
| `VfsEntryRepository.scanContents` | core-internal，一次 SQL 拉正文 | Mobile **不**直接调用 |
| `zipEntryNameFromLogical` 等 | `domain/vfs/logic/vfs-zip-path.ts`，**未 barrel 导出** | gather 留在 service，Mobile 无需复制 |
| `apps/mobile/.../vfs-zip.service.ts` | `createVfsZipIoService(conn).export` → base64 写缓存 → `saveDocuments` | 传入 `buildZip: nativeBuildVfsZip` |
| `VfsFileManager` | `exportingZip` loading（main） | 保持不变 |
| Mobile 依赖 | 无 zip 原生库；已有 `react-native-blob-util` | 新增 **一个** ZIP 库（见下） |

**性能基线（2026-06 真机，40 文件 / 394708 chars）**

| 实现 | `zipSvc.export` | pre-picker |
|------|-----------------|------------|
| fflate DEFLATE default | ~4300 ms | ~4500 ms |
| fflate STORE | ~400 ms | ~775 ms |

---

## 总体方案

### 架构

```mermaid
flowchart TB
  subgraph mobile [apps/mobile]
    VFM[VfsFileManager exportingZip]
    VZS[vfs-zip.service exportVfsZip]
    NB[nativeBuildVfsZip buildZip]
    NAT[react-native-zip-archive 或等价]
    VFM --> VZS
    VZS --> ZIPSVC
    VZS --> BLOB[react-native-blob-util 写缓存]
    BLOB --> PICKER[saveDocuments]
  end

  subgraph core [@novel-master/core]
    ZIPSVC[DefaultVfsZipIoService.export]
    SCAN[scanContents + path map]
    DEF[buildVfsZip 默认 STORE]
    ZIPSVC --> SCAN
    SCAN --> HOOK{buildZip 注入?}
    HOOK -->|否| DEF
    HOOK -->|是| NB
    NB --> NAT
  end
```

### 核心契约：`VfsZipBuildFn`

```typescript
/** ZIP entry name（无 leading `/`）→ UTF-8 文本；与 buildVfsZip 入参一致。 */
export type VfsZipBuildInput = {
  readonly files: ReadonlyMap<string, string>;
  readonly directoryEntryNames: readonly string[];
};

/**
 * 将 gather 结果打包为标准 ZIP 字节。
 * 由 host 注入（Mobile 原生）；默认实现为 fflate STORE。
 */
export type VfsZipBuildFn = (
  input: VfsZipBuildInput,
) => Uint8Array | Promise<Uint8Array>;
```

**`CreateVfsZipIoServiceOptions` 扩展**

```typescript
export type CreateVfsZipIoServiceOptions = {
  readonly testHook?: VfsZipImportTestHook;
  /** 替换 fflate 打包；省略时使用 buildVfsZip（STORE）。 */
  readonly buildZip?: VfsZipBuildFn;
};
```

**`DefaultVfsZipIoService` 行为**

- 构造函数保存 `buildZip?: VfsZipBuildFn`。
- `export()` 在 gather 完成后：

```typescript
const build = this.buildZip ?? buildVfsZip;
return await build({ files: zipFiles, directoryEntryNames: directoryZipNames });
```

- `buildZip` 为 sync 或 async 均支持（`await` 统一处理）。

### Mobile 原生打包

**推荐依赖（Android-first）**

| 候选 | 说明 |
|------|------|
| `react-native-zip-archive` | 常用，`zip(fileDir, targetZip)`；需先把 entry 写入临时目录 |
| 自写 TurboModule | 仅当社区库不满足 UTF-8/STORE 需求时 |

**`nativeBuildVfsZip` 流程（初版）**

1. 在 `CacheDir/vfs-export-{uuid}/` 写入每个 file entry（保持相对路径，必要时 `mkdir` 父目录）。
2. 写入空目录 marker（`.keep` 或平台 API 的 dir entry，最终 ZIP 须含 `dirname/` 空 entry——与 Core gather 的 `directoryEntryNames` 一致）。
3. 调用原生 `zip` 到 `CacheDir/vfs-export-{uuid}.zip`。
4. 用 `react-native-blob-util` 读回 **二进制**（避免 base64 中间态若库支持 `readFile path base64` 仍可复用现有 helper）。
5. 删除临时目录与 zip；返回 `Uint8Array`。
6. **压缩级别**：原生侧默认 **STORE**（与 Core 默认一致）；后续若需 DEFLATE，在 PRD 指标达标后再开。

**`vfs-zip.service.ts` 变更**

```typescript
const zipSvc = createVfsZipIoService(runtime.conn, {
  buildZip: nativeBuildVfsZip,
});
const bytes = await zipSvc.export(scope);
```

**可选降级（M2）**

```typescript
try {
  buildZip: nativeBuildVfsZip,
} catch {
  // 无原生模块 / 打包失败 → 不传 buildZip 或显式 buildVfsZip
}
```

### Import

- **不改动**：`importVfsZip` 仍 `readPickedZipAsBytes` → `zipSvc.import(..., { confirmed })`。
- 原生导出的 ZIP 必须被 Core `parseVfsZip` + `validateVfsZipEntries` 接受（UTF-8 text、路径规则不变）。

### 为何不拆 `gatherVfsZipExportPayload` 公开 API

- 单注入点 `buildZip` 已满足 Mobile 需求，改动面最小。
- gather 仍私有在 service 内，避免 Mobile 依赖 `VfsEntryRepository` 或未导出 path helper。
- 若后续 CLI 也需流式导出，再另增 `gatherVfsZipExportPayload` 不迟。

---

## 最终项目结构

```text
packages/core/src/
  domain/vfs/ports/vfs-zip-io.port.ts     # + VfsZipBuildFn / VfsZipBuildInput（或独立 types 文件）
  service/vfs/create-vfs-zip-io-service.ts # + buildZip 选项
  service/vfs/impl/vfs-zip-io.service.ts   # export 调用注入 buildZip
  domain/vfs/logic/vfs-zip-build.ts      # 默认 STORE；不变或抽 re-export
  index.ts                                 # export VfsZipBuildFn 类型

packages/core/test/vfs/
  vfs-zip-io.test.ts                       # + buildZip stub 用例

apps/mobile/src/
  native/vfs-zip-native.ts                 # nativeBuildVfsZip（新建）
  services/vfs-zip.service.ts              # 注入 buildZip

apps/mobile/__tests__/
  vfs-zip-native.test.ts                   # mock 原生层（新建）
  vfs-zip.service.test.ts                  # 断言 createVfsZipIoService 收到 buildZip

apps/mobile/package.json                   # + zip 原生依赖
```

**刻意不新增**

- `packages/zip-native-*` workspace
- Core import 侧 native hook

---

## 变更点清单

| 文件 | 变更 |
|------|------|
| `vfs-zip-io.port.ts` | 导出 `VfsZipBuildInput`、`VfsZipBuildFn` |
| `create-vfs-zip-io.service.ts` | options.buildZip；传入 service |
| `vfs-zip-io.service.ts` | 构造保存 buildZip；export 末尾调用 |
| `index.ts` | barrel 导出类型 |
| `vfs-zip-io.test.ts` | `Z-buildZip: custom builder receives gather output` |
| `vfs-zip-native.ts` | 原生打包实现 |
| `vfs-zip.service.ts` | 注入 `nativeBuildVfsZip` |
| `package.json` (mobile) | 依赖 + 链接说明写入 mobile README（可选一句） |

---

## 详细实现步骤

### M1 — Core 注入点（可独立合入验证）

1. 在 `vfs-zip-io.port.ts` 定义 `VfsZipBuildInput` / `VfsZipBuildFn`（TSDoc：entry 名约定、目录 marker 以 `/` 结尾）。
2. 扩展 `CreateVfsZipIoServiceOptions` 与 `DefaultVfsZipIoService` 构造函数。
3. `export()` 最后一行改为 `return await resolveBuildZip(...)`。
4. 新增测试：`buildZip` spy 收到正确 Map/目录列表；未注入时 Z1–Z* 仍过。
5. `npm run build -w @novel-master/core` + `npm test -w @novel-master/core -- test/vfs/vfs-zip-io.test.ts`。

### M2 — Mobile 原生封装（Android）

1. 选型并添加 `react-native-zip-archive`（或 SPEC 评审通过之替代）。
2. 实现 `nativeBuildVfsZip({ files, directoryEntryNames })`：
   - 临时目录写文件；
   - 空目录 entry 写 `dirname/.vfs_dir_marker` 或直接依赖库目录压缩语义，**导出 ZIP 须含 `dir/` 空 entry**（与 Z* 目录 round-trip 用例对齐）；
   - zip → 读 bytes → 清理。
3. `vfs-zip.service.ts` 注入；保留 `assertZipArchive`。
4. Jest：`jest.mock` 原生模块，断言被调用且 export 仍走 saveDocuments mock。
5. 真机：40 文件 fixture 计 `zipSvc.export` 与 pre-picker（应 ≤ STORE 基线或更优）。

### M3 — iOS（可同 PR 或 follow-up）

1. 验证 pod install / 原生 zip API。
2. 与 Android 共用 `nativeBuildVfsZip` JS 层。
3. 真机 smoke：导出 → 导入往返。

### M4 — 降级与文档

1. （可选）原生异常时 fallback `buildVfsZip` + `showToast` 一行提示。
2. 更新本 SPEC 状态；PR 描述附 perf 对比表。

---

## 测试策略

### Core（`packages/core/test/vfs/vfs-zip-io.test.ts`）

| ID | 用例 |
|----|------|
| Z-buildZip-1 | 注入 stub，`export` 后 stub 调用 1 次，files 含预期 entry 名 |
| Z-buildZip-2 | stub 返回固定 magic bytes，`export` 原样返回 |
| Z-buildZip-3 | 未注入 buildZip，Z1 session 路径断言仍成立（回归 STORE） |

### Mobile

| ID | 用例 |
|----|------|
| M-native-1 | mock `nativeBuildVfsZip`，`exportVfsZip` 创建 service 时传入 buildZip |
| M-native-2 | mock 原生 zip 成功，`saveDocuments` 被调用 |
| M-native-3 | 原生 throw → fallback（若实现 M2 降级） |

### 手工（Android 真机）

1. 标准 40 文件 session：导出 → 记录 pre-picker 时间。
2. 导出 ZIP → 同 scope 导入 → 文件列表一致。
3. 导出中按钮 loading 可见且不可重复点击。

---

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 原生 ZIP 目录 entry 与 Core 不一致 | M2 用现有 Z 目录 round-trip 测；对照 `unzipSync` 条目名 | 移除 `buildZip` 注入，回 STORE |
| 社区库 RN 0.85 不兼容 | M2 前 spike；pin 版本 | 不合并 mobile 依赖，仅合 M1 Core |
| 临时目录泄漏 | `finally` 删目录；uuid 子路径 | — |
| iOS 延期 | PRD 标注 Android-first | Mobile 条件编译：iOS 仍 fflate |
| 内存峰值 | 仍返回 Uint8Array；后续迭代「原生写 temp + 流式 save」 | — |

**回滚步骤**

1. Revert mobile `buildZip` 注入与依赖。
2. Core 保留 `buildZip` 可选字段（对 CLI 无影响）或整 PR revert。
3. 用户侧行为回到 main STORE（~400 ms 级 export）。

---

## 兼容性说明

- **ZIP 格式**：仍为标准 ZIP；entry 名、UTF-8、目录 `/` 约定不变。
- **CLI**：不传 `buildZip`，零行为变化。
- **Core 公共 API**：仅 **新增** 可选 option 与类型；`VfsZipIoService` 方法签名不变。
- **与 main 关系**：main 已 STORE + export loading；本迭代在其上叠加 Mobile 原生打包。

---

## 实现状态（2026-06-06）

| 里程碑 | 状态 | 备注 |
|--------|------|------|
| M1 — Core `buildZip` 注入 | **完成** | `VfsZipBuildFn` / `CreateVfsZipIoServiceOptions`；Z-buildZip-1–3 通过 |
| M2 — Mobile 原生封装（Android） | **完成** | `nativeBuildVfsZip` + `react-native-zip-archive` STORE；M-native-1/2 通过 |
| M3 — iOS | **延期** | Android-first；iOS 仍走默认 fflate STORE，待 follow-up |
| M4 — 降级与文档 | **完成** | 原生失败 → `buildVfsZip` fallback + toast；M-native-3 通过 |
| 手工 QA（Android 真机） | **通过** | 用户确认 40 文件 fixture 导出/往返无问题 |

---

## 实现前确认（编码门禁）

- [x] 用户确认本 `spec.md`
- [x] 原生库选型（Android）：`react-native-zip-archive`；iOS 延期
- [x] 分支 `perf/vfs-zip-native-compression` 已创建且基于最新 `main`
