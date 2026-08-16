---
date: 2026-08-16
---

# replace-quick-sqlite：移动端 SQLite 驱动替换（quick-sqlite → op-sqlite）技术规格（SPEC）

## 需求来源

[prd.md](./prd.md)（`requirement_path: docs/Iterations/replace-quick-sqlite/prd.md`，无前置依赖）。背景：`react-native-quick-sqlite@8.2.7` 已官方废弃（README 声明迁移至后继库），且真机（Honor EBG-AN00，Android 12）大事务 migration 中稳定复现两类原生层故障：

1. `disk I/O error`：`table-constraints-v1b` migration 重建 `chat_message` 表、分块搬运至第 8-9 块（事务内累计写入约 3MB）时 100% 复现；桌面 better-sqlite3 对同一库副本 100% 成功；WAL/DELETE 两种 journal 模式、async/sync 两种执行方式、全新物理文件均无法规避。
2. `SIGSEGV`（部分启动次出现）：崩溃地址按 little-endian 解码为消息文本字节（如 `"wSvzmPU2"`），即数据被当指针解引用——原生层内存损坏。

已排除：数据坏行（桌面全绿）、磁盘空间（58G 余量）、WAL 脏帧（checkpoint + 切 DELETE 无效）、async 并发缺陷（sync 同样炸）。

**根因定位（换库调研的关键发现）**：op-sqlite [issue #137](https://github.com/OP-Engineering/op-sqlite/issues/137)（已关闭）描述了完全同源的问题——Android 12 及以下，大查询/大事务触发 SQLite 写临时文件时报 `disk I/O error (code 10)`，该 issue 直接引用 quick-sqlite 的同源 issue #80。根因是 SQLite 默认允许将临时文件落盘，而部分设备的临时目录不可写。官方解法为编译期 flag `SQLITE_TEMP_STORE=2`（临时结构全走内存）。这解释了「桌面绿、真机红」「事务长到固定体积才炸」的全部现象。SIGSEGV 则是 quick-sqlite 独立的 heap 损伤症状（op-sqlite 无同类报告）。

## 设计目标

1. 移动端 SQLite 驱动从废弃的 `react-native-quick-sqlite@8.2.7` 替换为 `@op-engineering/op-sqlite`（同作者的第二代实现，维护活跃，peer 依赖 `react-native: "*"`，兼容我方 RN 0.85.3 / Hermes / 新架构）。
2. 改动收敛在 `packages/tdbc-driver-rn` 的 adapter 层 + `apps/mobile` 的依赖与库文件路径探测；core / desktop / cli / conformance 零改动。
3. 既有用户库文件（`files/default/novel_master_vfs`）升级后必须原地可用——不允许出现「升级即丢库」。
4. 真机大事务 migration（当前崩溃场景）成为验收硬门槛。

### 选型结论（探索报告 C）

| 候选 | 结论 |
|------|------|
| `@op-engineering/op-sqlite` @ 18.0.0 | ✅ 选定。API 与现有调用面映射成本最低（`executeSync` 存在、`columnNames` 真实存在、rows 为纯数组）；disk I/O error 有官方文档背书的解法；发布节奏每周级 |
| `react-native-nitro-sqlite` | 备选。官方后继名分，但需额外引入 `react-native-nitro-modules` 运行时依赖 + nitrogen 代码生成链，且其文档对结果结构的描述自相矛盾（`results` vs `rows._array`），映射成本与构建链风险均更高 |

版本锁定 `18.0.0`（含 bridge invalidation SIGSEGV 修复 PR #434/#436；发布 3 天，若真机验证发现新问题回退 `17.2.0`）。

## 总体方案

### 平行新包，旧包零改动

不修改 `tdbc-driver-rn`，新增平行驱动包 `packages/tdbc-driver-op-sqlite`（与 `tdbc-driver-better-sqlite3` / `tdbc-driver-rn` 的双驱动包先例对称）。旧包与 quick-sqlite 依赖原样保留作回滚线——回滚仅涉及 mobile 侧两行 import 与 driver 名切换。

协议层代码（`RnConnection` / `RnDriver` / `mutex` / `row-mapper` / `bindings`，均与具体 SQLite 库无关）**复制**到新包而非跨包复用：约 300 行重复换取完全隔离；旧包验证通过后整体删除时，新包无依赖残留。新包内类型同步更名（如 `RnSqliteAdapter → OpSqliteAdapter`），命名残留问题一并解决。

```
core (TdbcConnection 协议)                        ← 零改动
  └── packages/tdbc-driver-op-sqlite（新包，注册名 "op-sqlite"）
        ├── OpSqliteDriver   （复制自 RnDriver，追加 temp_store PRAGMA + 旧布局路径探测）
        ├── OpSqliteConnection（复制自 RnConnection，事务编排原样：BEGIN/COMMIT + 事务内 executeSync 分流 + SAVEPOINT 嵌套）
        └── impl/（op-sqlite adapter + native/dynamic 两个入口变体）
  └── packages/tdbc-driver-rn                      ← 零改动，保留作回滚线（验证通过后的删除属后续 cleanup）
        └── registerRnDriver（注册名 "rn"，mobile 切换后不再被引用）
```

### API 映射（探索报告 C 核心结论）

| 现调用面（quick-sqlite） | op-sqlite 18.x 等价物 | 适配动作 |
|---|---|---|
| `open({name, location})` | `open({name, location})` → `DB` 对象 | 签名一致；**落盘路径语义待真机 `getDbPath()` 核对**（见风险 1） |
| `QuickSQLite.executeAsync(dbName, sql, params)` | `await db.execute(sql, params?)` | 去掉 dbName；注意**命名反转**：op-sqlite 的 `execute` 是异步 |
| `QuickSQLite.execute(dbName, sql, params)`（同步） | `db.executeSync(sql, params?)` | 事务内同步分流策略原样平移 |
| `rows: {_array, length, item}` | `rows: Record<string, Scalar>[]` 纯数组 | `row-mapper.ts` 已兼容数组形态，验证即可 |
| `columnNames`（声明了但 8.2.7 运行时没有） | `columnNames: string[]` 真实存在 | 净增益，直接透传 |
| `metadata: {columnName}[]` | `metadata: {name, type, index}[]` | adapter 内做一次字段名转换（`name → columnName`） |
| `handle.close()` | `db.close()` | 语义相同 |

不使用 op-sqlite 的 `transaction()` 包装、`executeBatch`、`loadFile`（现有 `RnConnection` 的事务编排与 batch 循环保留不动，后续迭代再评估优化）。

### 防 disk I/O error 的双保险

1. **编译期**：仓库根 `package.json` 加配置块（op-sqlite 的配置读取是向上遍历找第一个 package.json，monorepo 必须放根）：
   ```json
   "op-sqlite": { "sqliteFlags": ["-DSQLITE_TEMP_STORE=2"] }
   ```
2. **运行期**：新包 `OpSqliteDriver.open` 在 `PRAGMA foreign_keys = ON` 旁追加 `PRAGMA temp_store = MEMORY`——即使编译 flag 因配置位置问题静默未生效，运行期兜底。

journal_mode 保持 SQLite 默认（DELETE），本迭代不引入 WAL——最小变量原则，与崩溃无关（已验证 WAL/DELETE 均炸、均非根因）。

### 存量库文件兼容（不允许丢库）

quick-sqlite `open({location: 'default'})` 把库落在 `files/default/novel_master_vfs`；op-sqlite 的默认落盘路径不同（待真机核对）。策略：

1. 新包 `OpSqliteDriver.open` 时优先探测旧布局绝对路径（`DocumentDir/default/novel_master_vfs`），存在则以**绝对路径**打开旧文件（op-sqlite `open` 的 `location` 支持绝对路径，实施时以 `getDbPath()` 日志验证）。
   > 实现补记（cr-func 核对）：实际采用 `failOnCreate: true` 试开策略——探测命中后以「创建即失败」模式打开旧文件，打开失败（说明路径不存在）则落回 op-sqlite 默认布局。相比「先探测再打开」多防一层竞态：避免探测通过但打开瞬间新建空库掩盖旧数据。旧目录解析与实际路径查询提升为 adapter 可选方法 `getLegacyDefaultDir()` / `getDbPath()`（新包自有契约，不波及旧包与 core；mock 不实现后两者）。
2. 旧文件不存在（新装用户）→ 走 op-sqlite 默认布局。
3. `apps/mobile/src/db/db-file-path.ts` 的候选路径集合同步扩充两种布局（备份/恢复是文件级拷贝，依赖此函数），保留 quick-sqlite 旧布局候选以兼容未升级完成的存量与回滚场景。

### bindings 与 blob

复制 `normalizeQuickSqliteBindings` 的防御逻辑到新包（`Uint8Array →` 独立 `ArrayBuffer` 拷贝、`undefined → null`）——对 op-sqlite 无害，且 VFS blob 写入路径的堆安全不赌假设。op-sqlite 原生支持 TypedArray 绑参，简化留待后续验证后再做（非本次范围）。

## 最终项目结构

```
packages/tdbc-driver-op-sqlite/（新包，全部新增）
  package.json                        # name: @novel-master/tdbc-driver-op-sqlite；peer: @op-engineering/op-sqlite（optional）
  tsconfig.json / test 脚手架          # 照抄 tdbc-driver-rn
  src/
    adapter.ts                        # 契约（复制改名：RnSqliteAdapter → OpSqliteAdapter、QuickSqliteResult → OpSqliteResult）
    connection.ts                     # OpSqliteConnection（复制自 RnConnection，含事务内 executeSync 分流 + setTimeout(0) 让出）
    driver.ts                         # OpSqliteDriver（注册名 "op-sqlite"；open 加 temp_store PRAGMA + 旧布局路径探测 + getDbPath() 日志）
    mutex.ts / row-mapper.ts / bindings.ts / index.ts / native.ts   # 复制（注释更新为 op-sqlite 语境）
    impl/op-sqlite.adapter.ts         # open 持住 DB 对象；execute→db.execute（异步）；executeSync→db.executeSync；metadata 字段转换
    impl/op-sqlite-native.adapter.ts   # 静态 import（Metro 入口）
    impl/op-sqlite-dynamic.adapter.ts  # 动态 import（Node 测试入口）
  test/
    mock-adapter.ts / conformance.test.ts / transaction-batch.test.ts / nested-batch-parity.test.ts   # 复制（import 改指本包）
    op-sqlite.adapter.test.ts / bindings.test.ts / row-mapper.test.ts   # 复制改写

packages/tdbc-driver-rn/               # 零改动（回滚线，后续 cleanup 删除）

apps/mobile/
  package.json                        # 加 @op-engineering/op-sqlite@18.0.0（quick-sqlite 保留不删）
  src/db/connection.ts                # registerRnDriver → registerOpSqliteDriver；driver: 'rn' → 'op-sqlite'（两行）
  src/services/db-backup.service.ts   # 同上两处切换
  src/db/db-file-path.ts              # 候选路径扩充两种布局
  __tests__/connection.test.ts        # 断言同步更新

仓库根 package.json                    # "op-sqlite" 配置块（sqliteFlags）
package-lock.json                     # 更新
```

不改动：`packages/tdbc-driver-rn`、`apps/mobile/android/**`、`apps/mobile/ios/**`（纯 autolink，无显式引用）、core、desktop、cli、`.github/workflows`（build workspaces 通配新包，按包名构建的 release job 不受影响）。

## 变更点清单

| # | 文件 | 变更 | 依据 |
|---|------|------|------|
| 1 | 仓库根 `package.json` | 加 `"op-sqlite": { "sqliteFlags": ["-DSQLITE_TEMP_STORE=2"] }` | 报告 C §2/§5（#137 官方解法；monorepo 配置必须放根） |
| 2 | `apps/mobile/package.json` | 加 `@op-engineering/op-sqlite@18.0.0`（quick-sqlite 保留作回滚线） | 报告 C §2 |
| 3 | `packages/tdbc-driver-op-sqlite/`（全新包） | 协议层复制改名 + op-sqlite adapter 三入口变体 + 测试复制改写 | 报告 A §2/§4、C §3 |
| 4 | `apps/mobile/src/db/connection.ts` + `src/services/db-backup.service.ts` | `registerRnDriver` → `registerOpSqliteDriver`、`driver: 'rn'` → `'op-sqlite'`（各两行） | 报告 A §2（消费面） |
| 5 | `apps/mobile/src/db/db-file-path.ts`（+ `__tests__/connection.test.ts`） | 候选路径扩充两种布局 | 报告 A §4、B §5-1 |
| 6 | `apps/mobile/README.md` | 驱动版本、故障排查文案更新 | 报告 A §4 |

**零改动**：`packages/tdbc-driver-rn`（回滚线）、core、desktop、cli、原生构建文件、CI workflow。

## 详细实现步骤

- Step 1 — phase-deps — blocking: yes — qa: auto：安装依赖与编译配置。`apps/mobile/package.json` 加 `@op-engineering/op-sqlite@18.0.0`（**quick-sqlite 不删**，作回滚线）；仓库根 `package.json` 加 `op-sqlite.sqliteFlags` 配置块；`npm install` 更新 lockfile。注意：worktree 的 node_modules 是主仓软链，安装会物理写主仓 `node_modules`——安装期间确保主仓无并行 Metro/gradle 构建。
- Step 2 — phase-package-scaffold — blocking: yes — qa: auto：新包骨架。创建 `packages/tdbc-driver-op-sqlite`（package.json / tsconfig / npm test 脚本照抄 tdbc-driver-rn；根 workspaces 若为 `packages/*` 通配则自动纳入）；复制协议层六文件（adapter / connection / driver / mutex / row-mapper / bindings）与 index/native 入口，类型同步更名（`Rn*` → `OpSqlite*`），驱动注册名 `"op-sqlite"`。此步完成后包能空转 build 通过（adapter 实现为占位）。
- Step 3 — phase-adapter — blocking: yes — qa: auto：实现 adapter。`impl/op-sqlite.adapter.ts`（`open` 持住返回的 `DB` 对象；`execute → db.execute`（异步）、`executeSync → db.executeSync`；`metadata` 的 `name → columnName` 转换；`rows` 数组形态直接透传）+ native/dynamic 两个入口变体。
  > 实现补记（cr-func 核对）：op-sqlite 18.0.0 发布的 `lib/typescript/src/index.d.ts` 存在 `export * from "./functions"` 无扩展名导入的 bug，NodeNext 模块解析下静默解析为空导致 typecheck 挂。故新增 `src/op-sqlite.d.ts` 最小 ambient 补丁（约 70 行，仅覆盖新包用到的 API 面）。**升级 op-sqlite 到修复版后应删除此文件**（文件头注释已标注）。
- Step 4 — phase-driver-open — blocking: yes — qa: auto：`OpSqliteDriver.open` 增强：追加 `PRAGMA temp_store = MEMORY`（运行期兑底编译 flag）；旧布局路径探测——`DocumentDir/default/novel_master_vfs` 存在时以绝对路径 open（保持存量库原地可用），并在 open 后执行 `getDbPath()` 打日志核对实际落盘路径（真机验证的证据输出）。
- Step 5 — phase-mobile-switch — blocking: yes — qa: auto：mobile 切换与路径兼容。`src/db/connection.ts` 与 `src/services/db-backup.service.ts` 各改两行（import + driver 名）；`db-file-path.ts` 候选路径集合扩充 op-sqlite 布局 + 保留 quick-sqlite 旧布局；同步更新 `__tests__/connection.test.ts` 断言。
- Step 6 — phase-tests — blocking: yes — qa: auto：测试复制改写。conformance（C1-C11）/ nested-batch parity（NB 系列）/ transaction-batch / mock-adapter 复制到新包（import 改指本包，断言零改动）；`op-sqlite.adapter.test.ts` 重写（fake bindings 为连接对象形状：`execute`/`executeSync` 实例方法、纯数组 rows、`{name}` metadata）；`bindings` / `row-mapper` 用例同步。
- Step 7 — phase-local-verify — blocking: yes — qa: auto：本地门禁全跑：`npm run build -w @novel-master/core -w @novel-master/tdbc-driver-op-sqlite`、`npm run test -w @novel-master/tdbc-driver-op-sqlite`、`npm run typecheck -w @novel-master/tdbc-driver-op-sqlite`、`npm run test -w @novel-master/mobile`（jest）。旧包 `tdbc-driver-rn` 测试也跑一遍确认零改动未被波及。⚠️ CI 的 test/typecheck 全部 `continue-on-error`，本地跑是唯一门禁（报告 B §3）。
- Step 8 — phase-device-verify — blocking: yes — qa: manual_user：真机验证（用户执行，agent 编排）。从本 worktree 起 Metro + 重装 APK（原生依赖变更，fast reload 无效）；验收序列：a) 冷启动 bootstrap + `table-constraints-v1b` migration 在 25MB 存量库上完整跑通（此前 100% 崩溃场景）；b) `getDbPath()` 日志核对库文件路径 = 存量旧文件；c) 进应用、开会话、读消息（blob/VFS 读回归）；d) 发一条消息（写路径回归）；e) 备份导出/导入（db-file-path 候选路径回归）。
- Step 9 — phase-docs — blocking: no — qa: auto：`apps/mobile/README.md` 驱动信息更新；CHANGELOG Unreleased 补条目；APM 记忆更新（换库结论 + SQLITE_TEMP_STORE 根因 + 平行包回滚策略）。

## 测试策略

CI 不设防（test/typecheck `continue-on-error: true`，原生编译只在 tag 触发的 release job），**本地全量 + 真机是唯一有效验证**。mock adapter 走 better-sqlite3 且不实现 `executeSync`——Node 侧测试全程走 async 路径，事务内同步分流只有真机触发，故 Step 7 不可省。

### 测试用例

- T-RN1 — blocking: yes — 新包 adapter 单元：op-sqlite bindings 形状（连接对象方法、异步 `execute`、同步 `executeSync`、metadata 字段转换、纯数组 rows 透传）。（→ Step 3/6）
- T-RN2 — blocking: yes — 新包 conformance 套件（C1-C11）与 nested-batch parity（NB 系列）在 mock 上零改动通过，证明协议层复制无损。（→ Step 6/7）
- T-RN3 — blocking: yes — bindings/row-mapper 单元：归一化逻辑对新旧两种 rows/metadata 形态均正确。（→ Step 6）
- T-OLD1 — blocking: yes — 旧包 `tdbc-driver-rn` 测试原样通过（零改动验证）。（→ Step 7）
- T-MOB1 — blocking: yes — `db-file-path` 候选路径覆盖 op-sqlite 与 quick-sqlite 两种布局（jest）。（→ Step 5）
- T-MIG1 — blocking: yes — 真机：25MB 存量库上 `table-constraints-v1b` migration 完整跑通、库文件路径不变、行数守恒（chat_message 2192 / vfs_revision 5073 / m_c_f 21875）。（→ Step 8）
- T-MIG2 — blocking: yes — 真机：读写回归——开会话读历史消息（含 blob）、发消息、备份导出/导入。（→ Step 8）
- T-NEW1 — blocking: no — 全新安装（无旧库文件）走 op-sqlite 默认布局正常建库。——模拟器或开发者卸载重装验证。（→ Step 8）

## 风险与回滚方案

1. **【高】Android 落盘路径一致性未验证**：op-sqlite 对默认 location 的解析与 quick-sqlite 是否同为 `files/default/` 未从源码逐行确认。缓解：Step 4 的绝对路径打开策略 + `getDbPath()` 日志核对（Step 8b 是硬验收）。若绝对路径 open 不被支持，回退方案为启动时一次性文件搬迁（旧路径 → 新路径，`db-file-path` 候选机制天然支持）。
2. **【高】`SQLITE_TEMP_STORE=2` 配置静默不生效**：op-sqlite 配置块读取向上遍历第一个 package.json，放错层级不会报错。缓解：运行期 `PRAGMA temp_store = MEMORY` 双保险（Step 4）；真机验证时通过 `PRAGMA temp_store` 查询值确认。若真机仍在 migration 中途报 disk I/O error，说明根因不止 temp store——回退评估 nitro-sqlite 路线。
3. **【中】18.0.0 发布仅数天**：含 async 修复但也可能有新问题。回退版本 `17.2.0`（一行依赖改动 + 重装）。
4. **【中】blob 绑定语义差异**：复制 `normalizeQuickSqliteBindings` 拷贝防御，不赌 op-sqlite 的缓冲管理；T-MIG2 的 blob 读写作真机验收。
5. **【低】worktree 共享 node_modules**：安装物理写主仓。安装窗口内避免并行构建；主仓 `main` 分支不受影响（软链是 worktree 级的）。
6. **【低】协议层 300 行复制**：与旧包短期双轨。旧包删除（验证通过后的 cleanup）时一并消除，不构成长期维护负担。
7. **回滚总案（平行包策略的核心收益）**：mobile 侧两行换回 `registerRnDriver` + `driver: 'rn'`，重装即回滚——旧包与 quick-sqlite 依赖原样保留在依赖树中，无版本冲突、无文件搬迁、无数据迁移。新包 `feat/replace-quick-sqlite` 分支（基于 `feat/sql-cr-fixes-integration`）整体废弃即可，集成分支零污染。
