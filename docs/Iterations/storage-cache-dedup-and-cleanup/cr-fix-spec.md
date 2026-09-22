# CR Fix Spec — storage-cache-dedup-and-cleanup（首轮评审修复规格）

## 0. 元信息

| 项 | 值 |
| --- | --- |
| repo | `D:\Dev\Js\novel-master` |
| base_sha | `13549791` |
| head_sha | `7fd6a9af` |
| prd | `docs/Iterations/storage-cache-dedup-and-cleanup/prd.md`（只读参考） |
| spec | `docs/Iterations/storage-cache-dedup-and-cleanup/spec.md`（只读参考） |
| fix-spec | `docs/Iterations/storage-cache-dedup-and-cleanup/cr-fix-spec.md`（本文件） |
| review_round | 1（四路 review-scope：desktop / core-store / core-maint / mobile 汇总） |
| dag_version | 2 |
| 状态 | draft |

> 本文件只约束**文档与实现代码的修复动作**；prd.md / spec.md 为只读参考，本 wave 不改动。
> 改法均已在评审轮认定，本文件忠实落盘；下游执行时可润色措辞，但不得弱化改法与验收标准。

---

## 1. Must-fix

按严重度 P0 → P1 → P2 排列。本轮无 P0；P1 共 2 条，P2 共 8 条。

### MF-1 · desktop/B-1 [P1] 维度 B+A：runDbMaintenance 缺自身 busy 守卫

- **id**：desktop/B-1
- **严重度**：P1
- **维度**：B（并发/状态正确性）+ A（spec 兑现）
- **文件**：`apps/desktop/src/main/services/db-maintenance.service.ts`（守卫区位于 `runDbMaintenance`，现行实现约 49-55 行）
- **问题**：`runDbMaintenance` 入口只查 `isDesktopAgentActive()` 与 `isDesktopCloudSyncBusy()`，未查自身的 `isDesktopDbMaintenanceBusy()`——spec 风险表承诺「handler 拒绝并发」未兑现。由于 `stat` 是线程池异步操作，busy 置位后的首个 `await` 会立刻让出事件循环，并发 invoke 可穿过守卫重复执行整条清理链路；且先完成者会在 `finally` 中提前复位 `maintenanceBusy`，使状态回报失真（AC-B3 的窗口失效）。数据本身无损——连接级串行执行兜底——故定 P1 而非 P0。
- **改法**：在守卫区（两个既有检查之后、`setDesktopDbMaintenanceBusy(true)` 之前）追加：
  ```ts
  if (isDesktopDbMaintenanceBusy()) {
    throw new Error("数据清理进行中，请稍后再操作");
  }
  ```
  所需的 `isDesktopDbMaintenanceBusy` 直接从 `./db-maintenance-busy.js` 导入（与 MF-5 删除 service re-export 后的统一导入口径一致，避免两处改动打架）。
- **验收测试**：T-DMD1（`apps/desktop/test/db-maintenance-handlers.test.ts`）补第三分支——置位 busy 后调用 handler，返回 `{ok: false}` 且 `message` 为上述中文文案。
- **来源**：review-scope-desktop/R1

### MF-2 · core-store/C-1 [P1] 维度 C(DRY)：四 helper 双模块逐字复制

- **id**：core-store/C-1
- **严重度**：P1
- **维度**：C（DRY / 演化一致性）
- **文件**：
  - `packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts`（约 42-110 行）
  - `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts`（约 48-114 行）
- **问题**：`tightBytes` / `asUint8Array` / `asBase64Text` / `decodeCompressedBytes` 四个 helper 在上述两模块近乎逐字复制。其中 `decodeCompressedBytes` 承载「RN 存量 zlib+string 按 base64 解」等平台口径知识（历史上真实演化过），一旦 encoding 再新增形态，两份副本必有一份静默掉队。
- **改法**：将四 helper 提取到共享模块 `zlib-codec.ts` 统一导出（建议置于 `packages/core/src/domain/vfs/content-store/logic/`，与 `base64ToBytes` 所在的 `blob-bytes-codec.ts` 同目录，最终路径由执行者定夺，前提是两条 import 均无循环依赖）。要点：
  - `decodeCompressedBytes` 加 `label` 参数化错误文案中的表名（对齐 sqlite-vfs-content-store 现行 `label` 形态，如 `"vfs_content_blob.bytes"` / file-cache 侧对应表名）；
  - 需从 `blob-bytes-codec.ts`（`packages/core/src/domain/vfs/content-store/logic/blob-bytes-codec.ts`）import `base64ToBytes`，并确认无循环依赖；
  - 两处删私有副本，改为 import；
  - `zlib-codec.ts` 模块头注释注明三方共用（vfs content-store、session-kkv file-cache、以及 RN 平台口径）。
- **验收测试**：
  - `packages/core/test/vfs/content-store.test.ts` 与 `packages/core/test/session-kkv/file-cache-store.test.ts` 全绿（纯提取重构，零行为变化）；
  - package-exports 快照同步（若 `zlib-codec` 为新增导出）。
- **来源**：review-scope-core-store/R1

### MF-3 · desktop/B-2 [P2] 维度 B：runDbMaintenance 的 stat 先于 runtime，防御口径自相矛盾

- **id**：desktop/B-2
- **严重度**：P2
- **维度**：B（防御口径一致性）
- **文件**：`apps/desktop/src/main/services/db-maintenance.service.ts`（现行实现约 57-59 行：`stat(dbPath)` 在 `getDesktopRuntime()` 之前）
- **问题**：同文件的 `getDbMaintenanceStats` 特意先 `getDesktopRuntime()` 再 `stat`（防御冷启动、库尚未 bootstrap 落盘时的 ENOENT，见其 24-27 行注释），而 `runDbMaintenance` 内顺序相反——两函数防御口径矛盾。
- **改法**：将 `getDesktopRuntime()` 提到 `stat` 之前，与 `getDbMaintenanceStats` 对齐。
- **验收测试**：T-DMD2 / T-DMD3 全绿，行为不变。
- **来源**：review-scope-desktop/R1

### MF-4 · desktop/B-3 [P2] 维度 B：pull 的 getLocalMeta 在 try 外，抛错则 syncBusy 永不复位

- **id**：desktop/B-3
- **严重度**：P2
- **维度**：B（状态泄漏 / 守卫连锁）
- **文件**：`apps/desktop/src/main/services/cloud-sync.service.ts`（`pull()` 现行实现约 231-235 行：`syncBusy = true` 之后、`try` 之前有 `await this.configStore.getLocalMeta()`）
- **问题**：`getLocalMeta()` 抛错则 `syncBusy` 永不复位。这是既有缺陷，但本迭代把 `isDesktopCloudSyncBusy` 设为数据清理守卫后，影响扩大为「pull 卡死 + 数据清理被永久锁死直至重启」。
- **改法**：将该语句移入 `try` 块首行（对齐同文件 `push()` 既有写法——push 的 `getLocalMeta()` 本就在 try 内）。
- **验收测试**：补一条单测或源码断言——mock `getLocalMeta` 抛错后，`isDesktopCloudSyncBusy()` 复位为 `false`。
- **来源**：review-scope-desktop/R1

### MF-5 · desktop/C-1 [P2] 维度 C：busy 标志双导入路径，违反 services/ 无 re-export 惯例

- **id**：desktop/C-1
- **严重度**：P2
- **维度**：C（导入路径统一）
- **文件**：`apps/desktop/src/main/services/db-maintenance.service.ts` + `apps/desktop/src/main/services/cloud-sync.service.ts` + `apps/desktop/test/db-maintenance-handlers.test.ts`
- **问题**：`isDesktopDbMaintenanceBusy` / `resetDesktopDbMaintenanceBusyForTest` 存在「service re-export」与「busy 模块直接 import」双路径，而 services/ 目录无 re-export 惯例。
- **改法**：删除 `db-maintenance.service.ts` 中的 re-export（现行 14-17 行），测试改从 `db-maintenance-busy.js` 直接导入，消费点统一为单一路径。
- **验收测试**：`git grep db-maintenance-busy` 确认导入路径唯一；desktop 测试套件全绿。
- **来源**：review-scope-desktop/R1

### MF-6 · core-store/G-1 [P2] 维度 G：zlib-b64 RN 形态零测试覆盖，encode 无注入点

- **id**：core-store/G-1
- **严重度**：P2
- **维度**：G（测试覆盖）
- **文件**：`packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts` + `packages/core/test/session-kkv/file-cache-store.test.ts`
- **问题**：`encodeFileCacheValue` 用裸 `isReactNativeRuntime()` 分支（现行约 133 行）且无注入点（vfs 侧已有 `preferZlibB64` 专为单测注入的先例）；zlib-b64 RN 形态的 get 解码与解压失败分支零测试覆盖——RN 用户首次读写即生产首跑。
- **改法**：`encodeFileCacheValue` 增加第二可选参数 `forceZlibB64?: boolean`（缺省走运行时探测，repository 调用点不动，仅测试直调注入）。补两个用例：
  1. 手工 INSERT `encoding='zlib-b64'` 行，断言 `get` 还原原文；
  2. 手工 INSERT 坏字节 blob 行，断言 `get` 返回 `null` 不抛。
- **验收测试**：新用例全绿。
- **来源**：review-scope-core-store/R1

### MF-7 · core-maint/G-1 [P2] 维度 B/G：T-DM2 注释与实测不符，误导维护

- **id**：core-maint/G-1
- **严重度**：P2
- **维度**：B/G（注释准确性）
- **文件**：`packages/core/test/infra/db-maintenance.test.ts`（约 165 行）
- **问题**：T-DM2 注释称「wal_checkpoint 同样在事务内被拒」，与实测不符——DELETE journal 下事务内 checkpoint 静默成功，报错的只有 VACUUM。该注释误导后续维护者。
- **改法**：注释改为「实测 DELETE journal 下事务内 wal_checkpoint 不报错，防护完全落在 VACUUM 的原生报错上」。
- **验收测试**：注释更新，测试仍绿。
- **来源**：review-scope-core-maint/R1

### MF-8 · core-maint/G-2 [P2] 维度 G：T-DM1 断言 `<=` 保守弱化，应收紧为 `<`

- **id**：core-maint/G-2
- **严重度**：P2
- **维度**：G（断言强度）
- **文件**：`packages/core/test/infra/db-maintenance.test.ts`（T-DM1）
- **问题**：spec 写「文件体积下降」，断言却为 `<=`（不增大），属保守弱化。测试已前置断言 `freelistPages > 0`，VACUUM 归还空闲页后文件必然严格缩小，`<` 是安全断言（主代理已拍板收紧）。
- **改法**：`<=` 收紧为 `<`，断言消息同步更新。
- **验收测试**：T-DM1 全绿。
- **来源**：review-scope-core-maint/R1

### MF-9 · mobile/C-1 [P2] 维度 C+B：为取 configured 布尔值发起全量云同步状态网络请求

- **id**：mobile/C-1
- **严重度**：P2
- **维度**：C（冗余调用）+ B（网络往返）
- **文件**：`apps/mobile/src/screens/stack/StorageConfigScreen.tsx`（`refreshCloudConfigured`，现行 47-54 行）
- **问题**：为取 `configured` 一个布尔值而调用全量 `getCloudSyncStatusView`——已配置用户每次页面聚焦都会触发一次 S3 网络往返且结果整体丢弃；存储页重排后本页不需要任何远端信息，属迁出未收窄的残留路径。
- **改法**：改从 `services/cloud-sync-config.store` 导入 `getCloudSyncLocalStatus`（该函数已导出，定义于 `cloud-sync-config.store.ts:196`；`cloud-sync.service.ts:41` 有 import 先例），本地读取 `configured`，不发网络请求；`getCloudSyncStatusView` 留给 `CloudSyncStorageScreen` 使用。
- **验收测试**：`apps/mobile/__tests__/storage-config-screen-source.test.ts` 断言同步修改（含 `not.toMatch(/getCloudSyncStatusView/)`）；配置展示行为不变。
- **来源**：review-scope-mobile/R1

### MF-10 · mobile/G-1 [P2] 维度 G+A：T-DMM2「库仍可正常读写」断言归属未显式记录

- **id**：mobile/G-1
- **严重度**：P2
- **维度**：G（测试矩阵归属）+ A（矩阵对照）
- **文件**：`apps/mobile/__tests__/db-maintenance.service.test.ts`（T-DMM2）
- **问题**：spec T-DMM2 的「库仍可正常读写」在 mobile mock 版式下断言不到，且归属未显式记录，矩阵对照时会当作缺口。
- **改法**：在 T-DMM2 用例注释中显式记录归属——该断言由 SQLite VACUUM 原子性 + core T-DM 系列承接，mobile mock 版式（照 `db-backup.service.test.ts`）不重复断言。
- **验收测试**：注释补齐，T-DMM2 映射无隐式缺项。
- **来源**：review-scope-mobile/R1

---

## 2. Spec deviations（spec 偏差账）

### open（待修复验证）

- **desktop「handler 拒绝并发」承诺未兑现**：spec 风险表承诺数据清理 handler 拒绝并发调用，实现未查自身 busy 标志。与 MF-1（desktop/B-1）同源；MF-1 修复后，下轮 review 验证转 fixed。

### fixed（用户拍板的 spec 外追加，记录即可，无需动作）

- mobile 存储页重排四区 + 云端存储设置新页 + 灰色分区标题移除；
- 拆页后 `syncControlsDisabled` 简化为 `agentActive`（与 PRD AC-B3 mobile 分端口径自洽）；
- core-maint 工厂形态 `createDbMaintenanceService`（语义等价）；
- `tsconfig.test.json` paths 修复。

---

## 3. Open questions / 待拍板（均不阻塞本 wave）

1. **mobile：agentActive 时点清理仍先弹 Alert 确认、确认后才被服务层拒绝**——与既有导入口径一致，spec 也写明沿用既有口径，但 PRD AC-B3 字面是「点击无效」；粒度差是否接受待用户拍板（倾向接受，无需改码）。
2. **mobile：Agent 停止后存储空间卡不自动恢复统计**（维持「—」直至重新聚焦）——与既有云同步焦点刷新口径一致；是否补「agentActive 变 false 时重拉」待拍板（倾向不修）。
3. **desktop：runMaintenance / runExport / runImport / runPull / runPush 均 try/finally 无 catch**——IPC 层 reject 为 unhandled、无 toast，与既有惯例一致；是否全局统一补 catch，留 review-full 或用户拍板。

---

## 4. 已豁免

本轮无已豁免条目。

---

## 5. 合并后 QA（manual_user）

真机重装后数据清理全链复测（体积展示 / 清理 / 前后对比）——已有 e2e 证据，合入后抽查即可。

---

## 6. K 节建议（下游执行约定）

- 执行 MF-1 ~ MF-10 时顺带跑定向 prettier / eslint；
- 修复完成后重跑 desktop / mobile 定向测试与 core fast 测试套件；
- MF-1 与 MF-5 同文件（`db-maintenance.service.ts`），注意导入口径统一为 `db-maintenance-busy.js` 直连，两改合并提交可避免中间态冲突。
